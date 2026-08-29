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

	it("removes stale 0644 temp file and keeps kubeconfig at 0600", async () => {
		const tmp = `${path}.streamdeck-tmp`;
		await writeFile(tmp, "stale content", { mode: 0o644 });
		await chmod(tmp, 0o644);
		await writeCurrentContext(path, "dev");
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(await readFile(path, "utf8")).toBe(ORIGINAL.replace("current-context: agenon-vn-2", "current-context: dev"));
	});

	it("preserves backup file mode from original kubeconfig", async () => {
		await writeCurrentContext(path, "dev");
		expect((await stat(`${path}.streamdeck-bak`)).mode & 0o777).toBe(0o600);
	});

	it("pins the indented list style (already covered above, kept explicit)", async () => {
		await writeCurrentContext(path, "dev");
		expect(await readFile(path, "utf8")).toBe(ORIGINAL.replace("current-context: agenon-vn-2", "current-context: dev"));
	});
});

// kubectl writes list items flush against the parent key, not indented under
// it. The yaml library's default stringify output indents them instead, so a
// naive doc.toString() write reflows nearly every line of a real kubeconfig.
// These fixtures pin the splice-based write against that regression.
const FLUSH_CA_DATA_1 =
	"LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUR" +
	"CVENDQWUyZ0F3SUJBZ0lVUFB6dWZ4M0xLdXpFVFdXY3B" +
	"1TnFrTG5nZmt3RFFZSktvWklodmNOQVFFTEJRQXcKRXp" +
	"FUk1BOEdBMVVFQXd3SWEzVmlaWEp1WlhJd0hoY05NalV" +
	"3TXpBek1EQXdNREF3V2hjTk16VXdNekF4TURBdwpNREF" +
	"3V2pBVE1SRXdEd1lEVlFRRERBaHJkV0psY201bGNqQ0N" +
	"BU0l3RFFZSktvWklodmNOQVFFQkJRQURnZ0VQCkFEQ0N" +
	"BUW9DZ2dFQkFOWVlPRHNVWk1EOHl4UXFKMHlHY1FXeCt" +
	"TZVE4d1JOWWY5b1EK";
const FLUSH_CA_DATA_2 =
	"LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUR" +
	"BVENDQWVtZ0F3SUJBZ0lVZDVYZmt2M0xLdXpFVFdXY3B" +
	"1TnFrTG5nZmt3RFFZSktvWklodmNOQVFFTEJRQXcKRXp" +
	"FUk1BOEdBMVVFQXd3SWEzVmlaWEp1WlhJd0hoY05NalV" +
	"3TXpBek1EQXdNREF3V2hjTk16VXdNekF4TURBdwpNREF" +
	"3V2pBVE1SRXdEd1lEVlFRRERBaHJkV0psY201bGNqQ0N" +
	"BU0l3RFFZSktvWklodmNOQVFFQkJRQURnZ0VQCkFEQ0N" +
	"BUW9DZ2dFQkFPZDR4dEZXUHc5eVJxSjB5R2NRV3grU2V" +
	"ROHdSTllmOW9RCg==";

const FLUSH_ORIGINAL = `apiVersion: v1
kind: Config
# managed by kubectl, do not hand-edit list indentation
preferences: {}
current-context: prod-east
clusters:
- name: prod-east
  cluster:
    certificate-authority-data: ${FLUSH_CA_DATA_1}
    server: https://prod-east.example.com:6443
- name: prod-west
  cluster:
    certificate-authority-data: ${FLUSH_CA_DATA_2}
    server: https://prod-west.example.com:6443
- name: staging
  cluster:
    certificate-authority-data: ${FLUSH_CA_DATA_1}
    server: https://staging.example.com:6443
contexts:
- name: prod-east
  context:
    cluster: prod-east
    user: prod-east
- name: prod-west
  context:
    cluster: prod-west
    user: prod-west
- name: staging
  context:
    cluster: staging
    user: staging
    namespace: default
users:
- name: prod-east
  user:
    token: prod-east-token
- name: prod-west
  user:
    token: prod-west-token
- name: staging
  user:
    token: staging-token
`;

describe("writeCurrentContext with kubectl flush-list style", () => {
	let flushPath: string;

	beforeEach(async () => {
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-flush-"));
		flushPath = join(dir, "config");
		await writeFile(flushPath, FLUSH_ORIGINAL, { mode: 0o600 });
	});

	it("changes only the current-context value, byte for byte", async () => {
		await writeCurrentContext(flushPath, "staging");
		const after = await readFile(flushPath, "utf8");
		expect(after).toBe(FLUSH_ORIGINAL.replace("current-context: prod-east", "current-context: staging"));
	});

	it("keeps the flush list indentation untouched", async () => {
		await writeCurrentContext(flushPath, "staging");
		const written = await readFile(flushPath, "utf8");
		expect(written).toContain("\n- name: prod-west\n");
		expect(written).not.toContain("\n  - name: prod-west\n");
	});

	it("keeps the long base64 certificate-authority-data untouched", async () => {
		await writeCurrentContext(flushPath, "staging");
		const written = await readFile(flushPath, "utf8");
		expect(written).toContain(FLUSH_CA_DATA_1);
		expect(written).toContain(FLUSH_CA_DATA_2);
	});
});

describe("writeCurrentContext value forms", () => {
	it("replaces a quoted current-context value without corrupting the quotes", async () => {
		const original = `apiVersion: v1
current-context: "agenon-vn-2"
contexts:
  - name: agenon-vn-2
    context:
      cluster: agenon-vn-2
  - name: dev
    context:
      cluster: dev
clusters: []
users: []
`;
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-quoted-"));
		const quotedPath = join(dir, "config");
		await writeFile(quotedPath, original, { mode: 0o600 });

		await writeCurrentContext(quotedPath, "dev");
		const after = await readFile(quotedPath, "utf8");
		expect(after).toBe(original.replace('current-context: "agenon-vn-2"', 'current-context: "dev"'));
	});

	it("replaces a current-context value with a trailing comment without corrupting the comment", async () => {
		const original = `apiVersion: v1
current-context: agenon-vn-2 # active cluster, do not remove
contexts:
  - name: agenon-vn-2
    context:
      cluster: agenon-vn-2
  - name: dev
    context:
      cluster: dev
clusters: []
users: []
`;
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-comment-"));
		const commentPath = join(dir, "config");
		await writeFile(commentPath, original, { mode: 0o600 });

		await writeCurrentContext(commentPath, "dev");
		const after = await readFile(commentPath, "utf8");
		expect(after).toBe(
			original.replace(
				"current-context: agenon-vn-2 # active cluster, do not remove",
				"current-context: dev # active cluster, do not remove",
			),
		);
	});

	it("appends current-context when the key is missing, touching no other line", async () => {
		const original = `apiVersion: v1
kind: Config
contexts:
  - name: agenon-vn-2
    context:
      cluster: agenon-vn-2
  - name: dev
    context:
      cluster: dev
clusters: []
users: []
`;
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-missing-"));
		const missingPath = join(dir, "config");
		await writeFile(missingPath, original, { mode: 0o600 });

		await writeCurrentContext(missingPath, "dev");
		const after = await readFile(missingPath, "utf8");
		expect(after).toBe(`${original}current-context: dev\n`);
	});

	it("preserves a missing trailing newline, adding one only before the appended key", async () => {
		const original =
			"apiVersion: v1\nkind: Config\ncontexts:\n  - name: dev\n    context:\n      cluster: dev\nclusters: []\nusers: []";
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-no-newline-append-"));
		const noNewlinePath = join(dir, "config");
		await writeFile(noNewlinePath, original, { mode: 0o600 });

		await writeCurrentContext(noNewlinePath, "dev");
		const after = await readFile(noNewlinePath, "utf8");
		expect(after).toBe(`${original}\ncurrent-context: dev\n`);
	});

	it("keeps a file with no trailing newline unchanged apart from the current-context value", async () => {
		const original =
			"apiVersion: v1\ncurrent-context: agenon-vn-2\ncontexts:\n  - name: agenon-vn-2\n    context:\n      cluster: agenon-vn-2\n  - name: dev\n    context:\n      cluster: dev\nclusters: []\nusers: []";
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-no-newline-"));
		const noNewlinePath = join(dir, "config");
		await writeFile(noNewlinePath, original, { mode: 0o600 });

		await writeCurrentContext(noNewlinePath, "dev");
		const after = await readFile(noNewlinePath, "utf8");
		expect(after).toBe(original.replace("current-context: agenon-vn-2", "current-context: dev"));
		expect(after.endsWith("\n")).toBe(false);
	});
});
