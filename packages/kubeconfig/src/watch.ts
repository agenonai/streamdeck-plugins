import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * Watches the directory holding path and fires onChange when that one file
 * changes. Watching the directory rather than the file means editor-style
 * atomic replacements are still seen.
 *
 * A watcher that dies (the directory is removed, the platform runs out of
 * file descriptors) stops reporting external changes, and nothing else in
 * the plugin notices that: the file watcher is the only signal there is.
 * Both the failure to start and a later watcher error are therefore reported
 * to onError so the caller can log them, rather than being swallowed.
 */
export function watchFile(
	path: string,
	debounceMs: number,
	onChange: () => void,
	onError: (err: unknown) => void = () => {},
): FSWatcher | null {
	const dir = dirname(path);
	const file = basename(path);
	let timer: NodeJS.Timeout | undefined;

	try {
		const watcher = watch(dir, (_event, filename) => {
			if (filename !== null && basename(filename) !== file) {
				return;
			}
			clearTimeout(timer);
			timer = setTimeout(onChange, debounceMs);
		});
		watcher.on("error", (err) => {
			// The watcher is dead once it errors; close it so it cannot leak,
			// and tell the caller that external-change detection is gone.
			watcher.close();
			clearTimeout(timer);
			onError(err);
		});
		return watcher;
	} catch (err) {
		onError(err);
		return null;
	}
}
