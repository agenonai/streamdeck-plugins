import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Text to drop into a file from inside the temp-file write, which is the
 * window between write.ts reading the kubeconfig and renaming the new
 * content over it. This is how a `kubectl config set-context` landing in
 * that window is reproduced deterministically.
 */
const injected = vi.hoisted(() => ({ path: null as string | null, text: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		writeFile: async (...args: Parameters<typeof actual.writeFile>): Promise<void> => {
			await actual.writeFile(...args);
			if (injected.path !== null) {
				const path = injected.path;
				injected.path = null;
				await actual.writeFile(path, injected.text);
			}
		},
	};
});

const { writeCurrentContext } = await import("./write.js");

const ORIGINAL = `apiVersion: v1
kind: Config
current-context: agenon-vn-2
contexts:
  - name: agenon-vn-2
  - name: dev
clusters: []
users: []
`;

let path: string;

beforeEach(async () => {
	injected.path = null;
	injected.text = "";
	const dir = await mkdtemp(join(tmpdir(), "kubeconfig-race-"));
	path = join(dir, "config");
	await writeFile(path, ORIGINAL, { mode: 0o600 });
});

describe("writeCurrentContext against a concurrent writer", () => {
	it("refuses to overwrite a file that changed after it was read", async () => {
		const external = ORIGINAL.replace("  - name: dev\n", "  - name: dev\n  - name: prod-eu\n");
		injected.path = path;
		injected.text = external;

		await expect(writeCurrentContext(path, "dev", { backup: false })).rejects.toThrow(
			/changed while the write was being prepared/i,
		);

		// The whole file is written back, so without this guard the stale text
		// would have replaced the external edit and lost the prod-eu cluster.
		expect(await readFile(path, "utf8")).toBe(external);
	});

	it("cleans up its temp file when it refuses the write", async () => {
		injected.path = path;
		injected.text = ORIGINAL.replace("users: []", "users: []\n# touched by another writer");

		await expect(writeCurrentContext(path, "dev", { backup: false })).rejects.toThrow(/changed while the write/i);

		expect(existsSync(`${path}.streamdeck-tmp`)).toBe(false);
	});

	it("still writes normally when nothing else touches the file", async () => {
		await writeCurrentContext(path, "dev", { backup: false });

		expect(await readFile(path, "utf8")).toBe(ORIGINAL.replace("current-context: agenon-vn-2", "current-context: dev"));
	});
});
