import type { KubeconfigService, KubeconfigState } from "@agenon/kubeconfig";
import { describe, expect, it, vi } from "vitest";
import { PinContextAction, type PinSettings } from "./pin-context.js";

function fakeKey(settings: PinSettings) {
	return {
		setTitle: vi.fn(async () => {}),
		setState: vi.fn(async () => {}),
		showAlert: vi.fn(async () => {}),
		getSettings: vi.fn(async () => settings),
	};
}

function fakeService(state: KubeconfigState) {
	return {
		getState: () => state,
		refresh: async () => state,
		setCurrent: vi.fn(async () => {}),
		onChange: () => () => {},
		dispose: () => {},
	} as unknown as KubeconfigService & { setCurrent: ReturnType<typeof vi.fn> };
}

const STATE: KubeconfigState = { contexts: ["dev", "eu"], current: "dev", ok: true };

describe("PinContextAction", () => {
	it("shows state 1 and the name when the pinned context is active", async () => {
		const key = fakeKey({ context: "dev" });
		const action = new PinContextAction(fakeService(STATE));
		await action.onWillAppear({ action: key } as never);
		expect(key.setState).toHaveBeenCalledWith(1);
		expect(key.setTitle).toHaveBeenCalledWith("dev");
	});

	it("shows state 0 when the pinned context is not active", async () => {
		const key = fakeKey({ context: "eu" });
		const action = new PinContextAction(fakeService(STATE));
		await action.onWillAppear({ action: key } as never);
		expect(key.setState).toHaveBeenCalledWith(0);
	});

	it("switches on press", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ context: "eu" });
		const action = new PinContextAction(service);
		await action.onKeyDown({ action: key, payload: { settings: { context: "eu" } } } as never);
		expect(service.setCurrent).toHaveBeenCalledWith("eu");
	});

	it("is a no-op when the pinned context is already active", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ context: "dev" });
		const action = new PinContextAction(service);
		await action.onKeyDown({ action: key, payload: { settings: { context: "dev" } } } as never);
		expect(service.setCurrent).not.toHaveBeenCalled();
	});

	it("alerts when the pinned context no longer exists", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ context: "deleted" });
		const action = new PinContextAction(service);
		await action.onKeyDown({ action: key, payload: { settings: { context: "deleted" } } } as never);
		expect(key.showAlert).toHaveBeenCalled();
		expect(service.setCurrent).not.toHaveBeenCalled();
	});

	it("prompts for configuration when nothing is pinned", async () => {
		const key = fakeKey({});
		const action = new PinContextAction(fakeService(STATE));
		await action.onWillAppear({ action: key } as never);
		expect(key.setTitle).toHaveBeenCalledWith("pick context");
		expect(key.setState).toHaveBeenCalledWith(0);
	});
});
