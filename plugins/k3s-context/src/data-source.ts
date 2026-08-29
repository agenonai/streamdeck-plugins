import type { KubeconfigService } from "@agenon/kubeconfig";

export const CONTEXTS_EVENT = "getContexts";

export type DataSourceReply = {
	event: string;
	items: { label: string; value: string }[];
};

/** Builds the sdpi-components datasource reply, or null for an event we do not serve. */
export function buildDataSourceReply(event: string, service: KubeconfigService): DataSourceReply | null {
	if (event !== CONTEXTS_EVENT) {
		return null;
	}
	return {
		event: CONTEXTS_EVENT,
		items: service.getState().contexts.map((name) => ({ label: name, value: name })),
	};
}
