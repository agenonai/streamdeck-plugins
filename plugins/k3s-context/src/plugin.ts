import { createKubeconfigService } from "@agenon/kubeconfig";
import streamDeck, { LogLevel } from "@elgato/streamdeck";

streamDeck.logger.setLevel(LogLevel.INFO);

const service = createKubeconfigService();

await service.refresh();
await streamDeck.connect();
