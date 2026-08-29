import { createKubeconfigService } from "@agenon/kubeconfig";
import streamDeck from "@elgato/streamdeck";
import { CycleContextAction } from "./actions/cycle-context.js";
import { PinContextAction } from "./actions/pin-context.js";

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

await service.refresh();
await streamDeck.connect();
