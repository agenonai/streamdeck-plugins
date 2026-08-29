import type { KubeconfigService, KubeconfigState } from "@agenon/kubeconfig";
import { describe, expect, it } from "vitest";
import { buildDataSourceReply } from "./data-source.js";

function service(state: KubeconfigState): KubeconfigService {
	return {
		getState: () => state,
		refresh: async () => state,
		setCurrent: async () => {},
		onChange: () => () => {},
		dispose: () => {},
	};
}

const OK: KubeconfigState = { contexts: ["dev", "eu"], current: "dev", currentInvalid: false, ok: true };

describe("buildDataSourceReply", () => {
	it("returns every context as a label and value pair", () => {
		expect(buildDataSourceReply("getContexts", service(OK))).toEqual({
			event: "getContexts",
			items: [
				{ label: "dev", value: "dev" },
				{ label: "eu", value: "eu" },
			],
		});
	});

	it("returns an empty item list when the kubeconfig is unreadable", () => {
		expect(buildDataSourceReply("getContexts", service({ contexts: [], current: null, currentInvalid: false, ok: false }))).toEqual({
			event: "getContexts",
			items: [],
		});
	});

	it("ignores unknown events", () => {
		expect(buildDataSourceReply("somethingElse", service(OK))).toBeNull();
	});
});
