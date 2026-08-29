import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * Watches the directory holding path and fires onChange when that one file
 * changes. Watching the directory rather than the file means editor-style
 * atomic replacements are still seen.
 */
export function watchFile(path: string, debounceMs: number, onChange: () => void): FSWatcher | null {
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
		watcher.on("error", () => {});
		return watcher;
	} catch {
		return null;
	}
}
