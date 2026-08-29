import { chmod, lstat, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseKubeconfig } from "./parse.js";
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

// ---------------------------------------------------------------------------
// Regression cover for the splice corruptions found in the final review.
// Each fixture below produced an unparseable or a never-converging kubeconfig
// before the write path started validating its own output.
// ---------------------------------------------------------------------------

/** Writes text to a fresh temp file and returns its path. */
async function tempConfig(text: string, prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	const file = join(dir, "config");
	await writeFile(file, text, { mode: 0o600 });
	return file;
}

/**
 * A minimal kubeconfig. currentContext is spliced in verbatim so a fixture
 * can pin an exact value form (block scalar, empty, quoted).
 */
function configWith(currentContext: string, names: string[]): string {
	const contexts = names.map((name) => `  - name: ${JSON.stringify(name)}\n`).join("");
	return `apiVersion: v1
kind: Config
${currentContext}
afterwards: keepme
contexts:
${contexts}clusters: []
users: []
`;
}

/** The lines that differ between two texts of the same line count. */
function changedLines(before: string, after: string): string[] {
	const previous = before.split("\n");
	return after.split("\n").filter((line, index) => line !== previous[index]);
}

describe("writeCurrentContext with a block scalar value", () => {
	it("does not swallow the newline that ends a folded block scalar", async () => {
		const original = configWith("current-context: >-\n  alpha", ["alpha", "beta"]);
		const path = await tempConfig(original, "kubeconfig-folded-");

		await writeCurrentContext(path, "beta", { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toBe(configWith("current-context: beta", ["alpha", "beta"]));
		expect(after).toContain("\nafterwards: keepme\n");
		expect(parseKubeconfig(after).state.current).toBe("beta");
	});

	it("does not swallow the newline that ends a literal block scalar", async () => {
		const original = configWith("current-context: |-\n  alpha", ["alpha", "beta"]);
		const path = await tempConfig(original, "kubeconfig-literal-");

		await writeCurrentContext(path, "beta", { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toBe(configWith("current-context: beta", ["alpha", "beta"]));
		expect(after).toContain("\nafterwards: keepme\n");
		expect(parseKubeconfig(after).state.current).toBe("beta");
	});

	it("keeps a value indented on the line below its key readable", async () => {
		const original = configWith("current-context:\n  alpha", ["alpha", "beta"]);
		const path = await tempConfig(original, "kubeconfig-indented-");

		await writeCurrentContext(path, "beta", { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toBe(configWith("current-context:\n  beta", ["alpha", "beta"]));
		expect(parseKubeconfig(after).state.current).toBe("beta");
	});
});

describe("writeCurrentContext with an empty value", () => {
	it("emits a separating space when the key has no value at all", async () => {
		const original = configWith("current-context:", ["alpha", "beta"]);
		const path = await tempConfig(original, "kubeconfig-empty-");

		await writeCurrentContext(path, "beta", { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toContain("current-context: beta\n");
		expect(after).not.toContain("current-context:beta");
		expect(after).toBe(configWith("current-context: beta", ["alpha", "beta"]));
		expect(parseKubeconfig(after).state.current).toBe("beta");
	});

	it("absorbs trailing spaces after an empty key instead of doubling them", async () => {
		const original = configWith("current-context:   ", ["alpha", "beta"]);
		const path = await tempConfig(original, "kubeconfig-empty-spaced-");

		await writeCurrentContext(path, "beta", { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toBe(configWith("current-context: beta", ["alpha", "beta"]));
		expect(parseKubeconfig(after).state.current).toBe("beta");
	});

	it("emits a separating space for an empty key at the very end of the file", async () => {
		const original = "apiVersion: v1\ncontexts:\n  - name: beta\nclusters: []\ncurrent-context:";
		const path = await tempConfig(original, "kubeconfig-empty-eof-");

		await writeCurrentContext(path, "beta", { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toBe("apiVersion: v1\ncontexts:\n  - name: beta\nclusters: []\ncurrent-context: beta");
		expect(parseKubeconfig(after).state.current).toBe("beta");
	});
});

// A context may legally be named `true`, `0755` or `a: b #c`. Written bare,
// YAML reads the first two back as a boolean and an integer and the third
// does not parse at all, so the key never converges on the requested name and
// every key press rewrites the file.
const ODD_NAMES = ["true", "false", "yes", "no", "null", "~", "0755", "0x1f", "a: b #c", "dev # prod", "2026-01-01", "1.0"];

describe("writeCurrentContext with a context name YAML would reinterpret", () => {
	for (const name of ODD_NAMES) {
		it(`writes ${JSON.stringify(name)} so it reads back as exactly that string`, async () => {
			const original = configWith("current-context: alpha", ["alpha", name]);
			const path = await tempConfig(original, "kubeconfig-odd-");

			await writeCurrentContext(path, name, { backup: false });

			const after = await readFile(path, "utf8");
			const parsed = parseKubeconfig(after).state;
			expect(parsed.ok).toBe(true);
			expect(parsed.current).toBe(name);
			expect(parsed.currentInvalid).toBe(false);
			expect(parsed.contexts).toEqual(["alpha", name]);
			expect(after.split("\n")).toHaveLength(original.split("\n").length);
			expect(changedLines(original, after)).toHaveLength(1);
		});

		it(`converges on ${JSON.stringify(name)}, so a second press rewrites nothing`, async () => {
			const original = configWith("current-context: alpha", ["alpha", name]);
			const path = await tempConfig(original, "kubeconfig-odd-converge-");

			await writeCurrentContext(path, name, { backup: false });
			const first = await readFile(path, "utf8");
			await writeCurrentContext(path, name, { backup: false });

			expect(await readFile(path, "utf8")).toBe(first);
		});
	}

	it("keeps single quotes and doubles an apostrophe inside the new name", async () => {
		const original = configWith("current-context: 'alpha'", ["alpha", "kev's-lab"]);
		const path = await tempConfig(original, "kubeconfig-single-");

		await writeCurrentContext(path, "kev's-lab", { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toContain("current-context: 'kev''s-lab'\n");
		expect(parseKubeconfig(after).state.current).toBe("kev's-lab");
	});

	it("keeps double quotes and escapes a quote inside the new name", async () => {
		const original = configWith('current-context: "alpha"', ["alpha", 'say "hi"']);
		const path = await tempConfig(original, "kubeconfig-double-");

		await writeCurrentContext(path, 'say "hi"', { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toContain('current-context: "say \\"hi\\""\n');
		expect(parseKubeconfig(after).state.current).toBe('say "hi"');
	});

	it("quotes an appended key when the name would not survive bare", async () => {
		const original = "apiVersion: v1\ncontexts:\n  - name: \"true\"\nclusters: []\n";
		const path = await tempConfig(original, "kubeconfig-append-odd-");

		await writeCurrentContext(path, "true", { backup: false });

		const after = await readFile(path, "utf8");
		expect(after).toBe(`${original}current-context: "true"\n`);
		expect(parseKubeconfig(after).state.current).toBe("true");
	});
});

describe("writeCurrentContext output validation", () => {
	// The splice here is byte-correct, but the value carries a !!binary tag, so
	// YAML reads the replacement back as a buffer rather than as the context
	// name. The write is refused instead of leaving a kubeconfig behind that
	// names no usable context.
	it("refuses a splice whose result would not read back as the requested name", async () => {
		const original = configWith("current-context: !!binary YWxwaGE=", ["alpha", "beta"]);
		const path = await tempConfig(original, "kubeconfig-backstop-");

		await expect(writeCurrentContext(path, "beta", { backup: false })).rejects.toThrow(/refusing to write/i);

		expect(await readFile(path, "utf8")).toBe(original);
		expect(existsSync(`${path}.streamdeck-tmp`)).toBe(false);
		expect(existsSync(`${path}.streamdeck-bak`)).toBe(false);
	});
});

describe("writeCurrentContext through a symlink", () => {
	async function linked(): Promise<{ real: string; link: string }> {
		const realDir = await mkdtemp(join(tmpdir(), "kubeconfig-real-"));
		const linkDir = await mkdtemp(join(tmpdir(), "kubeconfig-link-"));
		const real = join(realDir, "config");
		const link = join(linkDir, "config");
		await writeFile(real, ORIGINAL, { mode: 0o600 });
		await symlink(real, link);
		return { real, link };
	}

	const SWITCHED = ORIGINAL.replace("current-context: agenon-vn-2", "current-context: dev");

	it("keeps the path a symlink and updates the file it points at", async () => {
		const { real, link } = await linked();

		await writeCurrentContext(link, "dev");

		expect((await lstat(link)).isSymbolicLink()).toBe(true);
		expect(await readFile(real, "utf8")).toBe(SWITCHED);
		expect(await readFile(link, "utf8")).toBe(SWITCHED);
	});

	it("puts the backup next to the real file, not next to the link", async () => {
		const { real, link } = await linked();

		await writeCurrentContext(link, "dev");

		expect(await readFile(`${real}.streamdeck-bak`, "utf8")).toBe(ORIGINAL);
		expect(existsSync(`${link}.streamdeck-bak`)).toBe(false);
	});

	it("leaves no temp file beside the link or the target", async () => {
		const { real, link } = await linked();

		await writeCurrentContext(link, "dev");

		expect(existsSync(`${link}.streamdeck-tmp`)).toBe(false);
		expect(existsSync(`${real}.streamdeck-tmp`)).toBe(false);
	});

	it("refuses a broken symlink with a message that says so", async () => {
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-broken-link-"));
		const link = join(dir, "config");
		await symlink(join(dir, "gone"), link);

		await expect(writeCurrentContext(link, "dev")).rejects.toThrow(/symlink to .*which does not exist/i);
	});
});
