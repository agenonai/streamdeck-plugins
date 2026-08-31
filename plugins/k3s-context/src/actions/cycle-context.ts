import type { KubeconfigService } from "@agenon/kubeconfig";
import streamDeck, {
	action,
	SingletonAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { nextContext } from "../context-cycle.js";
import { withStatus } from "../status-line.js";

export type CycleSettings = {
	/** Context names to cycle through, in kubeconfig order. */
	contexts?: string[];
};

@action({ UUID: "ai.agenon.k3s-context.cycle" })
export class CycleContextAction extends SingletonAction<CycleSettings> {
	// Tracks the health-polling disposer per key instance id, so a key that
	// disappears releases exactly the visibility it registered on appear.
	private readonly visibility = new Map<string, () => void>();

	constructor(private readonly service: KubeconfigService) {
		super();
	}

	/** Re-titles every visible key of this action. Called on kubeconfig changes. */
	async render(): Promise<void> {
		for (const instance of this.actions) {
			const settings = await instance.getSettings<CycleSettings>();
			await instance.setTitle(this.title(settings.contexts ?? []));
		}
	}

	override async onWillAppear(ev: WillAppearEvent<CycleSettings>): Promise<void> {
		// Stream Deck resends onWillAppear for the same action id on device
		// reconnect and profile switch, without an intervening onWillDisappear.
		// Releasing any existing hold first keeps one hold per key, not one per
		// appear, so a single later onWillDisappear does not leak the rest.
		this.visibility.get(ev.action.id)?.();
		this.visibility.set(ev.action.id, this.service.keyVisible());
		const settings = await ev.action.getSettings<CycleSettings>();
		await ev.action.setTitle(this.title(settings.contexts ?? []));
	}

	override async onWillDisappear(ev: WillDisappearEvent<CycleSettings>): Promise<void> {
		this.visibility.get(ev.action.id)?.();
		this.visibility.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<CycleSettings>): Promise<void> {
		const cycle = ev.payload.settings.contexts ?? [];
		const state = this.service.getState();
		const target = nextContext(cycle, state.current);

		if (target === null) {
			await ev.action.setTitle(this.title(cycle));
			return;
		}

		try {
			await this.service.setCurrent(target);
			await ev.action.setTitle(this.title(cycle));
		} catch (err) {
			streamDeck.logger.error("failed to switch context", err);
			await ev.action.showAlert();
		}
	}

	private title(cycle: string[]): string {
		const state = this.service.getState();
		if (!state.ok) {
			return "no kubeconfig";
		}
		if (cycle.length === 0) {
			return "no contexts";
		}
		if (state.current === null) {
			return "none";
		}
		return withStatus(state.current, this.service.getHealth());
	}
}
