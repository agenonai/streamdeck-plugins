import type { KubeconfigService } from "@agenon/kubeconfig";
import streamDeck, {
	action,
	SingletonAction,
	type KeyAction,
	type KeyDownEvent,
	type WillAppearEvent,
} from "@elgato/streamdeck";

export type PinSettings = {
	/** The single context this key switches to. */
	context?: string;
};

@action({ UUID: "ai.agenon.k3s-context.pin" })
export class PinContextAction extends SingletonAction<PinSettings> {
	constructor(private readonly service: KubeconfigService) {
		super();
	}

	/** Re-renders every visible key of this action. Called on kubeconfig changes. */
	async render(): Promise<void> {
		for (const instance of this.actions) {
			const settings = await instance.getSettings<PinSettings>();
			await this.paint(instance as KeyAction<PinSettings>, settings.context);
		}
	}

	override async onWillAppear(ev: WillAppearEvent<PinSettings>): Promise<void> {
		const settings = await ev.action.getSettings<PinSettings>();
		await this.paint(ev.action as KeyAction<PinSettings>, settings.context);
	}

	override async onKeyDown(ev: KeyDownEvent<PinSettings>): Promise<void> {
		const pinned = ev.payload.settings.context;
		const state = this.service.getState();

		if (pinned === undefined || !state.ok || !state.contexts.includes(pinned)) {
			await ev.action.showAlert();
			return;
		}
		if (state.current === pinned) {
			return;
		}

		try {
			await this.service.setCurrent(pinned);
			await this.paint(ev.action as KeyAction<PinSettings>, pinned);
		} catch (err) {
			streamDeck.logger.error("failed to switch context", err);
			await ev.action.showAlert();
		}
	}

	private async paint(target: KeyAction<PinSettings>, pinned: string | undefined): Promise<void> {
		const state = this.service.getState();
		if (pinned === undefined) {
			await target.setTitle("pick context");
			await target.setState(0);
			return;
		}
		await target.setTitle(pinned);
		await target.setState(state.ok && state.current === pinned ? 1 : 0);
	}
}
