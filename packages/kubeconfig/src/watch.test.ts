import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { watchFile } from "./watch.js";

describe("watchFile", () => {
	it("reports a watcher that cannot be started", () => {
		const errors: unknown[] = [];

		const watcher = watchFile(
			join(tmpdir(), "kubeconfig-no-such-directory-9f2c", "config"),
			10,
			() => {},
			(err) => errors.push(err),
		);

		expect(watcher).toBeNull();
		expect(errors).toHaveLength(1);
	});

	// A dead watcher stops all external-change detection and there is no other
	// signal for it, so the error has to reach the caller rather than being
	// dropped by an empty handler.
	it("reports a watcher that dies after it started, and closes it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-watch-"));
		const errors: unknown[] = [];
		const watcher = watchFile(
			join(dir, "config"),
			10,
			() => {},
			(err) => errors.push(err),
		);
		expect(watcher).not.toBeNull();

		watcher?.emit("error", new Error("watcher died"));

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("watcher died");
		watcher?.close();
	});

	it("still starts without an error handler", async () => {
		const dir = await mkdtemp(join(tmpdir(), "kubeconfig-watch-default-"));

		const watcher = watchFile(join(dir, "config"), 10, () => {});

		expect(watcher).not.toBeNull();
		watcher?.close();
	});
});
