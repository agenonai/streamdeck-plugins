import { describe, expect, it } from "vitest";
import { resolveKubeconfigPath } from "./paths.js";

describe("resolveKubeconfigPath", () => {
	it("defaults to ~/.kube/config", () => {
		expect(resolveKubeconfigPath({}, "/Users/kevin")).toBe("/Users/kevin/.kube/config");
	});

	it("prefers KUBECONFIG when set", () => {
		expect(resolveKubeconfigPath({ KUBECONFIG: "/tmp/a.yaml" }, "/Users/kevin")).toBe("/tmp/a.yaml");
	});

	it("uses the first entry of a colon separated KUBECONFIG", () => {
		expect(resolveKubeconfigPath({ KUBECONFIG: "/tmp/a.yaml:/tmp/b.yaml" }, "/Users/kevin")).toBe(
			"/tmp/a.yaml",
		);
	});

	it("ignores an empty KUBECONFIG", () => {
		expect(resolveKubeconfigPath({ KUBECONFIG: "" }, "/Users/kevin")).toBe("/Users/kevin/.kube/config");
	});
});
