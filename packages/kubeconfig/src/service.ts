import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { FSWatcher } from "node:fs";
import { parseKubeconfig, type KubeconfigState } from "./parse.js";
import { resolveKubeconfigPath } from "./paths.js";
import { watchFile } from "./watch.js";
import { writeCurrentContext } from "./write.js";

export type { KubeconfigState };

export type KubeconfigService = {
	getState(): KubeconfigState;
	setCurrent(name: string): Promise<void>;
	onChange(listener: (state: KubeconfigState) => void): () => void;
	refresh(): Promise<KubeconfigState>;
	dispose(): void;
};

export type ServiceOptions = {
	path?: string;
	debounceMs?: number;
};

const NOT_OK: KubeconfigState = { contexts: [], current: null, ok: false };

function sameState(a: KubeconfigState, b: KubeconfigState): boolean {
	return (
		a.ok === b.ok &&
		a.current === b.current &&
		a.contexts.length === b.contexts.length &&
		a.contexts.every((name, index) => name === b.contexts[index])
	);
}

export function createKubeconfigService(opts: ServiceOptions = {}): KubeconfigService {
	const path = opts.path ?? resolveKubeconfigPath(process.env, homedir());
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

	async function read(): Promise<KubeconfigState> {
		try {
			return parseKubeconfig(await readFile(path, "utf8")).state;
		} catch {
			return NOT_OK;
		}
	}

	async function refresh(): Promise<KubeconfigState> {
		const next = await read();
		const changed = !sameState(state, next);
		state = next;
		if (changed) {
			for (const listener of listeners) {
				listener(state);
			}
		}
		return state;
	}

	watcher = watchFile(path, opts.debounceMs ?? 150, () => {
		void refresh();
	});

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
		dispose(): void {
			watcher?.close();
			watcher = null;
			listeners.clear();
		},
	};
}
