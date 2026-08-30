import type { HealthStatus } from "@agenon/kubeconfig";

/**
 * The word shown on the second line of a key's title for the active
 * context's reachability. "unknown" (no probe result yet) reads as "...", so
 * a key never shows a status word it has not actually earned.
 */
export function statusWord(health: HealthStatus): string {
	switch (health) {
		case "ok":
			return "ok";
		case "down":
			return "down";
		default:
			return "...";
	}
}

/** Appends the status line to a context name, the two-line title shown for an active context. */
export function withStatus(name: string, health: HealthStatus): string {
	return `${name}\n${statusWord(health)}`;
}
