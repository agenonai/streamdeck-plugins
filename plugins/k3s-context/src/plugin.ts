import { createKubeconfigService } from "@agenon/kubeconfig";
import streamDeck from "@elgato/streamdeck";

streamDeck.logger.setLevel("info");

const service = createKubeconfigService();

await service.refresh();
await streamDeck.connect();
