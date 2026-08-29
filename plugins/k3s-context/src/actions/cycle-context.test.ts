import type { KubeconfigService, KubeconfigState } from "@agenon/kubeconfig";
import type { KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";
import { describe, expect, it, vi } from "vitest";
import { CycleContextAction, type CycleSettings } from "./cycle-context.js";

type FakeKey = {
	setTitle: ReturnType<typeof vi.fn>;
	showAlert: ReturnType<typeof vi.fn>;
	getSettings: ReturnType<typeof vi.fn>;
};

type FakeService = KubeconfigService & { setCurrent: ReturnType<typeof vi.fn> };

function fakeKey(settings: CycleSettings): FakeKey {
	return {
		setTitle: vi.fn(async () => {}),
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
function willAppear(key: FakeKey): WillAppearEvent<CycleSettings> {
	return { action: key } as unknown as WillAppearEvent<CycleSettings>;
}

function keyDown(key: FakeKey, settings: CycleSettings): KeyDownEvent<CycleSettings> {
	return { action: key, payload: { settings } } as unknown as KeyDownEvent<CycleSettings>;
}

const STATE: KubeconfigState = { contexts: ["dev", "eu", "vn"], current: "dev", currentInvalid: false, ok: true };

describe("CycleContextAction", () => {
	it("titles the key with the active context on appear", async () => {
		const key = fakeKey({ contexts: ["dev", "eu"] });
		const action = new CycleContextAction(fakeService(STATE));
		await action.onWillAppear(willAppear(key));
		expect(key.setTitle).toHaveBeenCalledWith("dev");
	});

	it("switches to the next context in the list on press", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ contexts: ["dev", "eu"] });
		const action = new CycleContextAction(service);
		await action.onKeyDown(keyDown(key, { contexts: ["dev", "eu"] }));
		expect(service.setCurrent).toHaveBeenCalledWith("eu");
	});

	// Without the repaint after the switch the key keeps advertising the
	// context that was active before the press.
	it("repaints the key with the new context after a successful switch", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ contexts: ["dev", "eu"] });
		const action = new CycleContextAction(service);

		await action.onKeyDown(keyDown(key, { contexts: ["dev", "eu"] }));

		expect(service.getState().current).toBe("eu");
		expect(key.setTitle).toHaveBeenLastCalledWith("eu");
	});

	it("repaints again on a second press so the title tracks the cycle", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ contexts: ["dev", "eu", "vn"] });
		const action = new CycleContextAction(service);

		await action.onKeyDown(keyDown(key, { contexts: ["dev", "eu", "vn"] }));
		expect(key.setTitle).toHaveBeenLastCalledWith("eu");

		await action.onKeyDown(keyDown(key, { contexts: ["dev", "eu", "vn"] }));
		expect(service.getState().current).toBe("vn");
		expect(key.setTitle).toHaveBeenLastCalledWith("vn");
	});

	it("does nothing when no contexts are selected", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ contexts: [] });
		const action = new CycleContextAction(service);
		await action.onKeyDown(keyDown(key, { contexts: [] }));
		expect(service.setCurrent).not.toHaveBeenCalled();
		expect(key.setTitle).toHaveBeenCalledWith("no contexts");
	});

	it("alerts when the write fails", async () => {
		const service = fakeService(STATE);
		service.setCurrent.mockRejectedValueOnce(new Error("boom"));
		const key = fakeKey({ contexts: ["dev", "eu"] });
		const action = new CycleContextAction(service);
		await action.onKeyDown(keyDown(key, { contexts: ["dev", "eu"] }));
		expect(key.showAlert).toHaveBeenCalled();
	});

	it("leaves the title on the old context when the write fails", async () => {
		const service = fakeService(STATE);
		service.setCurrent.mockRejectedValueOnce(new Error("boom"));
		const key = fakeKey({ contexts: ["dev", "eu"] });
		const action = new CycleContextAction(service);

		await action.onKeyDown(keyDown(key, { contexts: ["dev", "eu"] }));

		expect(service.getState().current).toBe("dev");
		expect(key.setTitle).not.toHaveBeenCalledWith("eu");
	});

	it("shows a dash when the kubeconfig is unreadable", async () => {
		const key = fakeKey({ contexts: ["dev"] });
		const action = new CycleContextAction(
			fakeService({ contexts: [], current: null, currentInvalid: false, ok: false }),
		);
		await action.onWillAppear(willAppear(key));
		expect(key.setTitle).toHaveBeenCalledWith("no kubeconfig");
	});
});
