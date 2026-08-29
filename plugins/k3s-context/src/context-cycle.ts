/**
 * The context a press should switch to, or null when there is nothing to do.
 * A single-entry list that is already active returns null so the press is a no-op.
 */
export function nextContext(cycle: string[], current: string | null): string | null {
	if (cycle.length === 0) {
		return null;
	}
	const index = current === null ? -1 : cycle.indexOf(current);
	if (index === -1) {
		return cycle[0] ?? null;
	}
	const next = cycle[(index + 1) % cycle.length];
	return next === current ? null : (next ?? null);
}
