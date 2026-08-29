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
		expect(result.state).toEqual({ contexts: [], current: null, currentInvalid: false, ok: false });
		expect(result.doc).toBeNull();
	});

	it("returns a not-ok empty state when contexts is missing", () => {
		expect(parseKubeconfig("apiVersion: v1\nkind: Config\n").state.ok).toBe(false);
	});

	it("returns null current when current-context is absent", () => {
		const text = "apiVersion: v1\nkind: Config\ncontexts:\n  - name: dev\n";
		const { state } = parseKubeconfig(text);
		expect(state).toEqual({ contexts: ["dev"], current: null, currentInvalid: false, ok: true });
	});

	it("does not flag an empty current-context key as invalid", () => {
		const text = "apiVersion: v1\ncurrent-context:\ncontexts:\n  - name: dev\n";
		expect(parseKubeconfig(text).state).toEqual({
			contexts: ["dev"],
			current: null,
			currentInvalid: false,
			ok: true,
		});
	});

	// A bare `true` or `0755` is read by YAML as a boolean or an integer, not
	// as the context name it looks like. Reporting that as "no current context"
	// makes it indistinguishable from a file that names none, which hides a
	// write that can never converge on the requested name.
	it("flags a boolean current-context instead of reporting it as absent", () => {
		const text = "apiVersion: v1\ncurrent-context: true\ncontexts:\n  - name: \"true\"\n";
		expect(parseKubeconfig(text).state).toEqual({
			contexts: ["true"],
			current: null,
			currentInvalid: true,
			ok: true,
		});
	});

	it("flags a numeric current-context instead of reporting it as absent", () => {
		const text = "apiVersion: v1\ncurrent-context: 0755\ncontexts:\n  - name: \"0755\"\n";
		expect(parseKubeconfig(text).state.currentInvalid).toBe(true);
		expect(parseKubeconfig(text).state.current).toBeNull();
	});

	it("reads a quoted context name that looks like a boolean back as a string", () => {
		const text = "apiVersion: v1\ncurrent-context: \"true\"\ncontexts:\n  - name: \"true\"\n";
		expect(parseKubeconfig(text).state).toEqual({
			contexts: ["true"],
			current: "true",
			currentInvalid: false,
			ok: true,
		});
	});
});
