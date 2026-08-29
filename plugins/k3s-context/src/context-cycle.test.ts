import { describe, expect, it } from "vitest";
import { nextContext } from "./context-cycle.js";

describe("nextContext", () => {
	it("advances to the following entry", () => {
		expect(nextContext(["a", "b", "c"], "b")).toBe("c");
	});

	it("wraps at the end", () => {
		expect(nextContext(["a", "b", "c"], "c")).toBe("a");
	});

	it("picks the first entry when the current context is outside the list", () => {
		expect(nextContext(["a", "b"], "zzz")).toBe("a");
	});

	it("picks the first entry when there is no current context", () => {
		expect(nextContext(["a", "b"], null)).toBe("a");
	});

	it("returns null for an empty list", () => {
		expect(nextContext([], "a")).toBeNull();
	});

	it("returns null for a single-entry list already active", () => {
		expect(nextContext(["a"], "a")).toBeNull();
	});
});
