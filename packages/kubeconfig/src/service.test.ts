import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createKubeconfigService, type KubeconfigService, type KubeconfigState } from "./service.js";

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
		expect(service.getState()).toEqual({ contexts: ["agenon-vn-2", "dev"], current: "agenon-vn-2", ok: true });
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
		expect(await missing.refresh()).toEqual({ contexts: [], current: null, ok: false });
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
