import type { KubeconfigService, KubeconfigState } from "@agenon/kubeconfig";
import type { KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";
import { describe, expect, it, vi } from "vitest";
import { PinContextAction, type PinSettings } from "./pin-context.js";

type FakeKey = {
	setTitle: ReturnType<typeof vi.fn>;
	setState: ReturnType<typeof vi.fn>;
	showAlert: ReturnType<typeof vi.fn>;
	getSettings: ReturnType<typeof vi.fn>;
};

type FakeService = KubeconfigService & { setCurrent: ReturnType<typeof vi.fn> };

function fakeKey(settings: PinSettings): FakeKey {
	return {
		setTitle: vi.fn(async () => {}),
		setState: vi.fn(async () => {}),
		showAlert: vi.fn(async () => {}),
		getSettings: vi.fn(async () => settings),
	};
}

/**
 * A service whose state actually moves when setCurrent succeeds, the way the
 * real one does. A frozen fake would let the action skip repainting the key
 * after a switch and still pass every assertion below.
 */
function fakeService(initial: KubeconfigState): FakeService {
	let state = initial;
	return {
		getState: () => state,
		refresh: async () => state,
		setCurrent: vi.fn(async (name: string) => {
			if (!state.contexts.includes(name)) {
				throw new Error(`unknown context: ${name}`);
			}
			state = { ...state, current: name };
		}),
		onChange: () => () => {},
		dispose: () => {},
	};
}

/** Narrow casts: the fakes carry only the members these handlers touch. */
function willAppear(key: FakeKey): WillAppearEvent<PinSettings> {
	return { action: key } as unknown as WillAppearEvent<PinSettings>;
}

function keyDown(key: FakeKey, settings: PinSettings): KeyDownEvent<PinSettings> {
	return { action: key, payload: { settings } } as unknown as KeyDownEvent<PinSettings>;
}

const STATE: KubeconfigState = { contexts: ["dev", "eu"], current: "dev", currentInvalid: false, ok: true };

describe("PinContextAction", () => {
	it("shows state 1 and the name when the pinned context is active", async () => {
		const key = fakeKey({ context: "dev" });
		const action = new PinContextAction(fakeService(STATE));
		await action.onWillAppear(willAppear(key));
		expect(key.setState).toHaveBeenCalledWith(1);
		expect(key.setTitle).toHaveBeenCalledWith("dev");
	});

	it("shows state 0 when the pinned context is not active", async () => {
		const key = fakeKey({ context: "eu" });
		const action = new PinContextAction(fakeService(STATE));
		await action.onWillAppear(willAppear(key));
		expect(key.setState).toHaveBeenCalledWith(0);
	});

	it("switches on press", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ context: "eu" });
		const action = new PinContextAction(service);
		await action.onKeyDown(keyDown(key, { context: "eu" }));
		expect(service.setCurrent).toHaveBeenCalledWith("eu");
	});

	// Without the repaint after the switch the key stays dim even though it is
	// now the active context, and only a later kubeconfig change event fixes it.
	it("repaints the key lit with its own name after a successful switch", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ context: "eu" });
		const action = new PinContextAction(service);

		await action.onKeyDown(keyDown(key, { context: "eu" }));

		expect(service.getState().current).toBe("eu");
		expect(key.setTitle).toHaveBeenLastCalledWith("eu");
		expect(key.setState).toHaveBeenLastCalledWith(1);
	});

	it("renders every other pinned key against the new context", async () => {
		const service = fakeService(STATE);
		const pressed = fakeKey({ context: "eu" });
		const action = new PinContextAction(service);

		await action.onKeyDown(keyDown(pressed, { context: "eu" }));

		// A key pinned to the context that just lost focus paints dim.
		const other = fakeKey({ context: "dev" });
		await action.onWillAppear(willAppear(other));
		expect(other.setState).toHaveBeenLastCalledWith(0);
	});

	it("is a no-op when the pinned context is already active", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ context: "dev" });
		const action = new PinContextAction(service);
		await action.onKeyDown(keyDown(key, { context: "dev" }));
		expect(service.setCurrent).not.toHaveBeenCalled();
	});

	it("alerts when the pinned context no longer exists", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ context: "deleted" });
		const action = new PinContextAction(service);
		await action.onKeyDown(keyDown(key, { context: "deleted" }));
		expect(key.showAlert).toHaveBeenCalled();
		expect(service.setCurrent).not.toHaveBeenCalled();
	});

	it("leaves the key dim and alerts when the write fails", async () => {
		const service = fakeService(STATE);
		service.setCurrent.mockRejectedValueOnce(new Error("boom"));
		const key = fakeKey({ context: "eu" });
		const action = new PinContextAction(service);

		await action.onKeyDown(keyDown(key, { context: "eu" }));

		expect(service.getState().current).toBe("dev");
		expect(key.setState).not.toHaveBeenCalledWith(1);
		expect(key.showAlert).toHaveBeenCalled();
	});

	it("prompts for configuration when nothing is pinned", async () => {
		const key = fakeKey({});
		const action = new PinContextAction(fakeService(STATE));
		await action.onWillAppear(willAppear(key));
		expect(key.setTitle).toHaveBeenCalledWith("pick context");
		expect(key.setState).toHaveBeenCalledWith(0);
	});
});
