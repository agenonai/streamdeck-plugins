import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { FSWatcher } from "node:fs";
import { resolveCredentials, type CredentialsResult } from "./credentials.js";
import { probe } from "./health.js";
import { parseKubeconfig, type KubeconfigState } from "./parse.js";
import { resolveKubeconfigPath } from "./paths.js";
import { watchFile } from "./watch.js";
import { writeCurrentContext } from "./write.js";

export type { KubeconfigState };

/**
 * Reachability of the active context's API server. "unknown" means no probe
 * result exists yet for that context, either because none has completed or
 * because there is no active context to probe.
 */
export type HealthStatus = "ok" | "down" | "unknown";

export type KubeconfigService = {
	getState(): KubeconfigState;
	setCurrent(name: string): Promise<void>;
	onChange(listener: (state: KubeconfigState) => void): () => void;
	refresh(): Promise<KubeconfigState>;
	dispose(): void;
	/** Reachability of the currently active context, cached per context name. */
	getHealth(): HealthStatus;
	/**
	 * Registers one visible key as an interested party in health probing.
	 * Triggers an immediate probe of the active context and starts the
	 * polling interval on the first caller. Returns a disposer to call when
	 * the key disappears; the interval stops once every caller has released.
	 */
	keyVisible(): () => void;
};

export type ServiceOptions = {
	path?: string;
	debounceMs?: number;
	/**
	 * Called when the file watcher cannot start or dies later on. External
	 * change detection is silently lost when that happens, so the host wires
	 * this to its logger rather than letting the failure go unreported.
	 */
	onError?: (err: unknown) => void;
	/**
	 * Called at most once per context name and reason when a context's
	 * credentials cannot be resolved from the kubeconfig (an exec plugin, a
	 * bearer token, insecure-skip-tls-verify, missing certificate data, and
	 * so on). The context's health still reports "down" in this case; this
	 * callback exists purely so the reason is not silently discarded,
	 * without repeating it on every 30 second poll.
	 *
	 * Keying on the reason as well as the name matters when a context is
	 * reconfigured in place: a context that first failed on an exec plugin
	 * and later fails on a bearer token reports the second, now-current
	 * reason instead of leaving the operator with the stale first one.
	 */
	onCredentialsUnavailable?: (contextName: string, reason: string) => void;
	/** Overrides the 30 second health polling interval; for tests only. */
	healthIntervalMs?: number;
	/**
	 * Overrides the 5 second deadline applied to each health probe, both to
	 * reading credentials out of the kubeconfig and to the request itself;
	 * for tests only.
	 */
	healthTimeoutMs?: number;
};

const NOT_OK: KubeconfigState = { contexts: [], current: null, currentInvalid: false, ok: false };

/**
 * Resolves to `fallback` once `timeoutMs` has elapsed if `promise` has not
 * settled by then, and treats a rejection as `fallback` too.
 *
 * The underlying work is not cancellable, so it keeps running; the point is
 * only that the caller is never left awaiting it forever.
 */
function withDeadline<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
	return new Promise((resolve) => {
		const deadline = setTimeout(() => resolve(fallback), timeoutMs);
		const settle = (value: T): void => {
			clearTimeout(deadline);
			resolve(value);
		};
		void promise.then(settle, () => settle(fallback));
	});
}

function sameState(a: KubeconfigState, b: KubeconfigState): boolean {
	return (
		a.ok === b.ok &&
		a.current === b.current &&
		a.currentInvalid === b.currentInvalid &&
		a.contexts.length === b.contexts.length &&
		a.contexts.every((name, index) => name === b.contexts[index])
	);
}

export function createKubeconfigService(opts: ServiceOptions = {}): KubeconfigService {
	const path = opts.path ?? resolveKubeconfigPath(process.env, homedir());
	const healthIntervalMs = opts.healthIntervalMs ?? 30_000;
	const healthTimeoutMs = opts.healthTimeoutMs ?? 5_000;
	const listeners = new Set<(state: KubeconfigState) => void>();
	let state: KubeconfigState = NOT_OK;
	let watcher: FSWatcher | null = null;
	// The backup must capture the file as it was before this process's first
	// actual write, not the state produced by an earlier write from this same
	// service. Only a call that actually rewrites the file flips this to
	// true; a no-op setCurrent (already the active context) must not.
	let backedUp = false;
	// Serializes setCurrent calls so overlapping key presses do not race on
	// write.ts's shared sibling temp file. Each caller awaits its own result
	// via `run`; `queue` only tracks completion (success or failure) so a
	// rejected call does not poison later calls in the chain.
	let queue: Promise<void> = Promise.resolve();

	// Cached per context name so switching back to a previously-probed
	// context shows its last known status immediately instead of flickering
	// to "unknown" while a fresh probe is in flight.
	const healthByContext = new Map<string, HealthStatus>();
	// Dedupes concurrent probes of the same context: a key appearing, an
	// interval tick and a context change can all ask for a probe around the
	// same time, and only one in-flight request per context is useful.
	const probesInFlight = new Set<string>();
	// Reported once per context name and reason, ever, so an unsupported auth
	// method or insecure-skip-tls-verify is logged once instead of every poll,
	// while a context that later starts failing for a different reason still
	// gets that new reason reported.
	const reportedCredentialFailures = new Set<string>();
	let visibleKeyCount = 0;
	let pollHandle: ReturnType<typeof setInterval> | null = null;

	function notify(): void {
		for (const listener of listeners) {
			listener(state);
		}
	}

	/**
	 * Kicks a probe of the active context, unless one for that same context
	 * is already running. Never awaited by a caller: probing must not block
	 * a key press or a refresh.
	 *
	 * Both halves of the cycle are bounded by healthTimeoutMs: probe() has
	 * its own wall-clock deadline, and resolving credentials is wrapped in
	 * one here. Without that, a kubeconfig read that never settles (a stale
	 * network mount, a file lock) would leave the context in probesInFlight
	 * forever, and the dedupe guard would then silently drop every later
	 * probe of it, freezing its health until the plugin restarts.
	 */
	function probeActive(): void {
		if (!state.ok || state.current === null) {
			return;
		}
		const name = state.current;
		if (probesInFlight.has(name)) {
			return;
		}
		probesInFlight.add(name);
		void (async () => {
			try {
				const credentials = await withDeadline<CredentialsResult>(
					resolveCredentials(path, name),
					healthTimeoutMs,
					{ ok: false, reason: `reading credentials for ${name} timed out after ${healthTimeoutMs}ms` },
				);
				let result: HealthStatus;
				if (credentials.ok) {
					result = await probe(credentials.value, healthTimeoutMs);
				} else {
					result = "down";
					const failureKey = `${name}\n${credentials.reason}`;
					if (!reportedCredentialFailures.has(failureKey)) {
						reportedCredentialFailures.add(failureKey);
						opts.onCredentialsUnavailable?.(name, credentials.reason);
					}
				}
				if (healthByContext.get(name) !== result) {
					healthByContext.set(name, result);
					if (state.current === name) {
						notify();
					}
				}
			} finally {
				probesInFlight.delete(name);
			}
		})();
	}

	async function read(): Promise<KubeconfigState> {
		try {
			return parseKubeconfig(await readFile(path, "utf8")).state;
		} catch {
			return NOT_OK;
		}
	}

	async function refresh(): Promise<KubeconfigState> {
		const previousCurrent = state.current;
		const next = await read();
		const changed = !sameState(state, next);
		state = next;
		if (changed) {
			notify();
		}
		if (state.ok && state.current !== null && state.current !== previousCurrent) {
			probeActive();
		}
		return state;
	}

	watcher = watchFile(
		path,
		opts.debounceMs ?? 150,
		() => {
			void refresh();
		},
		(err) => opts.onError?.(err),
	);

	return {
		getState: () => state,
		refresh,
		setCurrent(name: string): Promise<void> {
			const run = queue.then(async () => {
				if (state.ok && state.current === name) {
					return;
				}
				await writeCurrentContext(path, name, { backup: !backedUp });
				backedUp = true;
				await refresh();
			});
			queue = run.then(
				() => undefined,
				() => undefined,
			);
			return run;
		},
		onChange(listener): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getHealth(): HealthStatus {
			if (!state.ok || state.current === null) {
				return "unknown";
			}
			return healthByContext.get(state.current) ?? "unknown";
		},
		keyVisible(): () => void {
			visibleKeyCount += 1;
			probeActive();
			if (visibleKeyCount === 1) {
				pollHandle = setInterval(() => probeActive(), healthIntervalMs);
			}
			let released = false;
			return () => {
				if (released) {
					return;
				}
				released = true;
				visibleKeyCount -= 1;
				if (visibleKeyCount === 0 && pollHandle !== null) {
					clearInterval(pollHandle);
					pollHandle = null;
				}
			};
		},
		dispose(): void {
			watcher?.close();
			watcher = null;
			listeners.clear();
			if (pollHandle !== null) {
				clearInterval(pollHandle);
				pollHandle = null;
			}
		},
	};
}
