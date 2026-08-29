import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { writeCurrentContext } from "./write.js";

const ORIGINAL = `apiVersion: v1
kind: Config
# Agenon clusters
current-context: agenon-vn-2
contexts:
  - name: agenon-vn-2
    context:
      cluster: agenon-vn-2
      user: agenon-vn-2
  - name: dev
    context:
      cluster: dev
      user: default_dev
      namespace: default
clusters: []
users: []
`;

let path: string;

beforeEach(async () => {
	const dir = await mkdtemp(join(tmpdir(), "kubeconfig-"));
	path = join(dir, "config");
	await writeFile(path, ORIGINAL, { mode: 0o600 });
	await chmod(path, 0o600);
});

describe("writeCurrentContext", () => {
	it("changes only the current-context line", async () => {
		await writeCurrentContext(path, "dev");
		const after = await readFile(path, "utf8");
		expect(after).toBe(ORIGINAL.replace("current-context: agenon-vn-2", "current-context: dev"));
	});

	it("keeps comments intact", async () => {
		await writeCurrentContext(path, "dev");
		expect(await readFile(path, "utf8")).toContain("# Agenon clusters");
	});

	it("keeps file mode 0600", async () => {
		await writeCurrentContext(path, "dev");
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it("writes a backup next to the file", async () => {
		await writeCurrentContext(path, "dev");
		expect(await readFile(`${path}.streamdeck-bak`, "utf8")).toBe(ORIGINAL);
	});

	it("skips the backup when asked", async () => {
		await writeCurrentContext(path, "dev", { backup: false });
		expect(existsSync(`${path}.streamdeck-bak`)).toBe(false);
	});

	it("rejects an unknown context and leaves the file untouched", async () => {
		await expect(writeCurrentContext(path, "nope")).rejects.toThrow(/unknown context/i);
		expect(await readFile(path, "utf8")).toBe(ORIGINAL);
	});

	it("rejects a malformed file and leaves it untouched", async () => {
		const broken = "contexts: [\n  - name: broken";
		await writeFile(path, broken);
		await expect(writeCurrentContext(path, "dev")).rejects.toThrow(/could not be parsed/i);
		expect(await readFile(path, "utf8")).toBe(broken);
	});

	it("leaves no temp file behind", async () => {
		await writeCurrentContext(path, "dev");
		expect(existsSync(`${path}.streamdeck-tmp`)).toBe(false);
	});
});
