import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKubeconfigService, type KubeconfigService, type KubeconfigState } from "./service.js";

// Health probing depends on credentials.ts (file access) and health.ts
// (network access). Neither is exercised here: this file tests the service's
// wiring of health status and polling lifecycle, not the probe itself, which
// has its own dedicated tests in health.test.ts and credentials.test.ts.
const probeMock = vi.hoisted(() => vi.fn<() => Promise<"ok" | "down">>(async () => "ok"));
vi.mock("./health.js", () => ({ probe: probeMock }));

type CredentialsResultForTest =
	| { ok: true; value: { server: string; ca: Buffer; cert: Buffer; key: Buffer } }
	| { ok: false; reason: string };

const credentialsMock = vi.hoisted(() =>
	vi.fn<() => Promise<CredentialsResultForTest>>(async () => ({
		ok: true,
		value: { server: "https://example.invalid", ca: Buffer.alloc(0), cert: Buffer.alloc(0), key: Buffer.alloc(0) },
	})),
);
vi.mock("./credentials.js", () => ({ resolveCredentials: credentialsMock }));

const CONFIG = `apiVersion: v1
kind: Config
current-context: agenon-vn-2
contexts:
  - name: agenon-vn-2
  - name: dev
clusters: []
users: []
`;

let path: string;
let service: KubeconfigService;

/** Waits until predicate is true or the timeout elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

beforeEach(async () => {
	const dir = await mkdtemp(join(tmpdir(), "kubeconfig-svc-"));
	path = join(dir, "config");
	await writeFile(path, CONFIG, { mode: 0o600 });
	service = createKubeconfigService({ path, debounceMs: 20 });
	await service.refresh();
});

afterEach(() => service.dispose());

describe("createKubeconfigService", () => {
	it("exposes the parsed state", () => {
		expect(service.getState()).toEqual({
			contexts: ["agenon-vn-2", "dev"],
			current: "agenon-vn-2",
			currentInvalid: false,
			ok: true,
		});
	});

	it("setCurrent writes the file and updates the state", async () => {
		await service.setCurrent("dev");
		expect(service.getState().current).toBe("dev");
		expect(await readFile(path, "utf8")).toContain("current-context: dev");
	});

	it("notifies listeners on an external change", async () => {
		const seen: KubeconfigState[] = [];
		service.onChange((state) => seen.push(state));
		await writeFile(path, CONFIG.replace("agenon-vn-2\ncontexts", "dev\ncontexts"));
		await waitFor(() => seen.length > 0);
		expect(seen.at(-1)?.current).toBe("dev");
	});

	it("does not notify when the rewritten content is equivalent", async () => {
		const seen: KubeconfigState[] = [];
		service.onChange((state) => seen.push(state));
		await writeFile(path, CONFIG);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(seen).toEqual([]);
	});

	it("onChange returns an unsubscribe function", async () => {
		const seen: KubeconfigState[] = [];
		const off = service.onChange((state) => seen.push(state));
		off();
		await writeFile(path, CONFIG.replace("agenon-vn-2\ncontexts", "dev\ncontexts"));
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(seen).toEqual([]);
	});

	it("reports a not-ok state for a missing file without throwing", async () => {
		const missing = createKubeconfigService({ path: join(tmpdir(), "definitely-not-here", "config") });
		expect(await missing.refresh()).toEqual({ contexts: [], current: null, currentInvalid: false, ok: false });
		missing.dispose();
	});

	it("refuses setCurrent while the state is not ok", async () => {
		await writeFile(path, "contexts: [\n  - name: broken");
		await service.refresh();
		await expect(service.setCurrent("dev")).rejects.toThrow();
	});

	it("only backs up the state before the first write, not on later writes", async () => {
		await service.setCurrent("dev");
		await service.setCurrent("agenon-vn-2");
		expect(await readFile(`${path}.streamdeck-bak`, "utf8")).toBe(CONFIG);
	});

	it("a no-op setCurrent does not consume the backup before the first real write", async () => {
		await service.setCurrent("agenon-vn-2");
		await service.setCurrent("dev");
		expect(await readFile(`${path}.streamdeck-bak`, "utf8")).toBe(CONFIG);
	});

	it("serializes concurrent setCurrent calls instead of racing on the temp file", async () => {
		const threeContexts = CONFIG.replace("  - name: dev\n", "  - name: dev\n  - name: staging\n");
		await writeFile(path, threeContexts);
		await service.refresh();

		const results = await Promise.allSettled([
			service.setCurrent("dev"),
			service.setCurrent("staging"),
			service.setCurrent("agenon-vn-2"),
		]);

		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		expect(service.getState().current).toBe("agenon-vn-2");
		expect(await readFile(path, "utf8")).toContain("current-context: agenon-vn-2");
	});

	// The file watcher is the only signal for changes made outside the plugin,
	// so a watcher that never starts has to be reported, not swallowed.
	it("surfaces a watcher that cannot start through onError", () => {
		const errors: unknown[] = [];
		const broken = createKubeconfigService({
			path: join(tmpdir(), "kubeconfig-no-such-directory-4b21", "config"),
			onError: (err) => errors.push(err),
		});

		expect(errors).toHaveLength(1);
		broken.dispose();
	});

	it("a rejected call in the middle of the chain does not block a later valid call", async () => {
		const results = await Promise.allSettled([
			service.setCurrent("dev"),
			service.setCurrent("no-such-context"),
			service.setCurrent("agenon-vn-2"),
		]);

		expect(results[0]?.status).toBe("fulfilled");
		expect(results[1]?.status).toBe("rejected");
		expect(results[2]?.status).toBe("fulfilled");
		expect(service.getState().current).toBe("agenon-vn-2");
	});
});

describe("health status", () => {
	let healthPath: string;

	beforeEach(async () => {
		probeMock.mockClear();
		credentialsMock.mockClear();
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-health-"));
		healthPath = join(dir, "config");
		await writeFile(healthPath, CONFIG, { mode: 0o600 });
	});

	it("reports unknown for a context that has no probe result yet", async () => {
		probeMock.mockImplementationOnce(() => new Promise(() => {}));
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();

		expect(svc.getHealth()).toBe("unknown");
		svc.dispose();
	});

	it("reports unknown when there is no kubeconfig or no active context", () => {
		const svc = createKubeconfigService({ path: join(tmpdir(), "kubeconfig-health-missing", "config") });
		expect(svc.getHealth()).toBe("unknown");
		svc.dispose();
	});

	it("probes the active context on plugin start and reports ok once it resolves", async () => {
		probeMock.mockResolvedValueOnce("ok");
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();

		await waitFor(() => svc.getHealth() === "ok");
		expect(credentialsMock).toHaveBeenCalledWith(healthPath, "agenon-vn-2");
		svc.dispose();
	});

	it("reports down when the probe resolves down", async () => {
		probeMock.mockResolvedValueOnce("down");
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();

		await waitFor(() => svc.getHealth() === "down");
		svc.dispose();
	});

	it("probes again on every context change, including an external one", async () => {
		probeMock.mockResolvedValueOnce("ok");
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();
		await waitFor(() => svc.getHealth() === "ok");

		probeMock.mockResolvedValueOnce("down");
		await writeFile(healthPath, CONFIG.replace("agenon-vn-2\ncontexts", "dev\ncontexts"));
		await waitFor(() => svc.getState().current === "dev");
		await waitFor(() => svc.getHealth() === "down");

		expect(credentialsMock).toHaveBeenCalledWith(healthPath, "dev");
		svc.dispose();
	});

	it("notifies onChange listeners through the existing change path when health resolves", async () => {
		let resolveProbe: (value: "ok" | "down") => void = () => {};
		probeMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveProbe = resolve;
				}),
		);
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();

		const seen: KubeconfigState[] = [];
		svc.onChange((state) => seen.push(state));
		resolveProbe("ok");

		await waitFor(() => seen.length > 0);
		expect(svc.getHealth()).toBe("ok");
		svc.dispose();
	});

	it("keeps the previous health while a new probe for the same context is in flight", async () => {
		probeMock.mockResolvedValueOnce("ok");
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();
		await waitFor(() => svc.getHealth() === "ok");

		probeMock.mockImplementationOnce(() => new Promise(() => {}));
		svc.keyVisible();

		expect(svc.getHealth()).toBe("ok");
		svc.dispose();
	});

	// Regression note: measuring probeMock.mock.calls.length synchronously
	// right after svc.refresh() is a trap. probeActive() adds to
	// probesInFlight synchronously, but the mocked resolveCredentials()
	// still needs a microtask to resolve before probe() itself is ever
	// called, so a synchronous assertion here passes (0 === 0) whether or
	// not the dedupe guard exists: neither path has reached probe() yet.
	// Waiting for the first call to actually land is what makes this test
	// capable of failing: without the guard, releasing keyVisible() while
	// the first probe is genuinely in flight calls probe() a second time.
	it("does not start a second probe for a context while one is already in flight", async () => {
		probeMock.mockImplementationOnce(() => new Promise(() => {}));
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();
		await waitFor(() => probeMock.mock.calls.length >= 1);
		const callsSoFar = probeMock.mock.calls.length;

		svc.keyVisible();
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(probeMock.mock.calls.length).toBe(callsSoFar);
		svc.dispose();
	});

	// Regression note: healthByContext must be keyed per context name, not a
	// single shared slot. A then B then back to A is what actually exercises
	// that: with a shared slot, B's resolved result would still be showing
	// once the service is back on A, because a shared write would overwrite
	// the one place A's own result was recorded.
	it("keeps a distinct cached health per context: A, then B, then back to A shows A's own result", async () => {
		probeMock.mockResolvedValueOnce("down"); // probe #1: agenon-vn-2 (initial current)
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();
		await waitFor(() => svc.getHealth() === "down");

		probeMock.mockResolvedValueOnce("ok"); // probe #2: dev
		await writeFile(healthPath, CONFIG.replace('agenon-vn-2\ncontexts', 'dev\ncontexts'));
		await waitFor(() => svc.getState().current === "dev");
		await waitFor(() => svc.getHealth() === "ok");

		// probe #3, for the return to agenon-vn-2, is left pending so the
		// assertion below observes the cache, not a fresh resolution.
		probeMock.mockImplementationOnce(() => new Promise(() => {}));
		await writeFile(healthPath, CONFIG);
		await waitFor(() => svc.getState().current === "agenon-vn-2");

		expect(svc.getHealth()).toBe("down");
		svc.dispose();
	});

	it("starts the polling interval when a key appears and stops it once the last key disappears", async () => {
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20, healthIntervalMs: 20 });
		await svc.refresh();
		await waitFor(() => probeMock.mock.calls.length >= 1);

		const release = svc.keyVisible();
		await waitFor(() => probeMock.mock.calls.length >= 2);
		const whileVisible = probeMock.mock.calls.length;

		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(probeMock.mock.calls.length).toBeGreaterThan(whileVisible);

		release();
		const afterRelease = probeMock.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(probeMock.mock.calls.length).toBe(afterRelease);

		svc.dispose();
	});

	it("does not probe when the kubeconfig has no active context", async () => {
		await writeFile(healthPath, "apiVersion: v1\nkind: Config\ncontexts:\n  - name: dev\nclusters: []\nusers: []\n");
		const svc = createKubeconfigService({ path: healthPath, debounceMs: 20 });
		await svc.refresh();

		expect(probeMock).not.toHaveBeenCalled();
		expect(svc.getHealth()).toBe("unknown");
		svc.dispose();
	});

	it("reports down and surfaces the reason once when credentials cannot be resolved", async () => {
		credentialsMock.mockResolvedValueOnce({ ok: false, reason: "user prod-user uses an exec plugin, which is not supported" });
		const reasons: Array<[string, string]> = [];
		const svc = createKubeconfigService({
			path: healthPath,
			debounceMs: 20,
			healthIntervalMs: 20,
			onCredentialsUnavailable: (contextName, reason) => reasons.push([contextName, reason]),
		});
		await svc.refresh();
		await waitFor(() => svc.getHealth() === "down");
		expect(probeMock).not.toHaveBeenCalled();
		expect(reasons).toEqual([["agenon-vn-2", "user prod-user uses an exec plugin, which is not supported"]]);

		// The next poll fails the same way; the callback must not fire again.
		credentialsMock.mockResolvedValueOnce({ ok: false, reason: "user prod-user uses an exec plugin, which is not supported" });
		svc.keyVisible();
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(reasons).toEqual([["agenon-vn-2", "user prod-user uses an exec plugin, which is not supported"]]);
		svc.dispose();
	});
});
