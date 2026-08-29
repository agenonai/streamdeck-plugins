import { createKubeconfigService } from "@agenon/kubeconfig";
import streamDeck from "@elgato/streamdeck";
import { CycleContextAction } from "./actions/cycle-context.js";
import { PinContextAction } from "./actions/pin-context.js";
import { buildDataSourceReply } from "./data-source.js";

streamDeck.logger.setLevel("info");

const service = createKubeconfigService();
const cycle = new CycleContextAction(service);
const pin = new PinContextAction(service);

streamDeck.actions.registerAction(cycle);
streamDeck.actions.registerAction(pin);

// Re-renders every registered action whenever the kubeconfig changes on disk
// or a key press updates the current context. Later actions register here too.
service.onChange(() => {
	void cycle.render();
	void pin.render();
});

// Answers sdpi-components datasource requests from either property inspector with the
// current list of contexts, refreshing the kubeconfig first so the reply is up to date.
streamDeck.ui.onSendToPlugin(async (ev) => {
	const payload = ev.payload as { event?: string } | undefined;
	if (payload?.event === undefined) {
		return;
	}
	await service.refresh();
	const reply = buildDataSourceReply(payload.event, service);
	if (reply !== null) {
		await streamDeck.ui.sendToPropertyInspector(reply);
	}
});

await service.refresh();
await streamDeck.connect();
