import type { KubeconfigService, KubeconfigState } from "@agenon/kubeconfig";
import { describe, expect, it, vi } from "vitest";
import { CycleContextAction, type CycleSettings } from "./cycle-context.js";

type FakeKey = {
	setTitle: ReturnType<typeof vi.fn>;
	showAlert: ReturnType<typeof vi.fn>;
	getSettings: ReturnType<typeof vi.fn>;
};

function fakeKey(settings: CycleSettings): FakeKey {
	return {
		setTitle: vi.fn(async () => {}),
		showAlert: vi.fn(async () => {}),
		getSettings: vi.fn(async () => settings),
	};
}

function fakeService(state: KubeconfigState): KubeconfigService & { setCurrent: ReturnType<typeof vi.fn> } {
	return {
		getState: () => state,
		refresh: async () => state,
		setCurrent: vi.fn(async () => {}),
		onChange: () => () => {},
		dispose: () => {},
	} as unknown as KubeconfigService & { setCurrent: ReturnType<typeof vi.fn> };
}

const STATE: KubeconfigState = { contexts: ["dev", "eu", "vn"], current: "dev", ok: true };

describe("CycleContextAction", () => {
	it("titles the key with the active context on appear", async () => {
		const key = fakeKey({ contexts: ["dev", "eu"] });
		const action = new CycleContextAction(fakeService(STATE));
		await action.onWillAppear({ action: key } as never);
		expect(key.setTitle).toHaveBeenCalledWith("dev");
	});

	it("switches to the next context in the list on press", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ contexts: ["dev", "eu"] });
		const action = new CycleContextAction(service);
		await action.onKeyDown({ action: key, payload: { settings: { contexts: ["dev", "eu"] } } } as never);
		expect(service.setCurrent).toHaveBeenCalledWith("eu");
	});

	it("does nothing when no contexts are selected", async () => {
		const service = fakeService(STATE);
		const key = fakeKey({ contexts: [] });
		const action = new CycleContextAction(service);
		await action.onKeyDown({ action: key, payload: { settings: { contexts: [] } } } as never);
		expect(service.setCurrent).not.toHaveBeenCalled();
		expect(key.setTitle).toHaveBeenCalledWith("no contexts");
	});

	it("alerts when the write fails", async () => {
		const service = fakeService(STATE);
		service.setCurrent.mockRejectedValueOnce(new Error("boom"));
		const key = fakeKey({ contexts: ["dev", "eu"] });
		const action = new CycleContextAction(service);
		await action.onKeyDown({ action: key, payload: { settings: { contexts: ["dev", "eu"] } } } as never);
		expect(key.showAlert).toHaveBeenCalled();
	});

	it("shows a dash when the kubeconfig is unreadable", async () => {
		const key = fakeKey({ contexts: ["dev"] });
		const action = new CycleContextAction(fakeService({ contexts: [], current: null, ok: false }));
		await action.onWillAppear({ action: key } as never);
		expect(key.setTitle).toHaveBeenCalledWith("no kubeconfig");
	});
});
