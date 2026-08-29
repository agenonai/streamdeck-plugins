import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseKubeconfig } from "./parse.js";

const fixture = readFileSync(
	fileURLToPath(new URL("../test/fixtures/sample-config.yaml", import.meta.url)),
	"utf8",
);

describe("parseKubeconfig", () => {
	it("reads every context name in file order", () => {
		expect(parseKubeconfig(fixture).state.contexts).toEqual(["agenon-vn-2", "dev", "eu"]);
	});

	it("reads the current context", () => {
		expect(parseKubeconfig(fixture).state.current).toBe("agenon-vn-2");
	});

	it("reports ok for a valid document", () => {
		expect(parseKubeconfig(fixture).state.ok).toBe(true);
	});

	it("returns a not-ok empty state for malformed yaml", () => {
		const result = parseKubeconfig("contexts: [\n  - name: broken");
		expect(result.state).toEqual({ contexts: [], current: null, ok: false });
		expect(result.doc).toBeNull();
	});

	it("returns a not-ok empty state when contexts is missing", () => {
		expect(parseKubeconfig("apiVersion: v1\nkind: Config\n").state.ok).toBe(false);
	});

	it("returns null current when current-context is absent", () => {
		const text = "apiVersion: v1\nkind: Config\ncontexts:\n  - name: dev\n";
		const { state } = parseKubeconfig(text);
		expect(state).toEqual({ contexts: ["dev"], current: null, ok: true });
	});
});
