import { copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import { parseKubeconfig } from "./parse.js";

export type WriteOptions = {
	/** Copy the file to <path>.streamdeck-bak before the first write. Defaults to true. */
	backup?: boolean;
};

/**
 * Sets current-context to name, preserving every other byte of the file.
 * The new content is written to a sibling temp file and renamed over the
 * original, so an interrupted write cannot truncate the kubeconfig.
 */
export async function writeCurrentContext(path: string, name: string, opts: WriteOptions = {}): Promise<void> {
	const text = await readFile(path, "utf8");
	const { state, doc } = parseKubeconfig(text);

	if (!state.ok || doc === null) {
		throw new Error(`kubeconfig at ${path} could not be parsed, refusing to write`);
	}
	if (!state.contexts.includes(name)) {
		throw new Error(`unknown context: ${name}`);
	}
	if (state.current === name) {
		return;
	}

	if (opts.backup !== false) {
		await copyFile(path, `${path}.streamdeck-bak`);
	}

	doc.set("current-context", name);

	const mode = (await stat(path)).mode & 0o777;
	const tmp = `${path}.streamdeck-tmp`;
	await writeFile(tmp, doc.toString({ lineWidth: 0 }), { mode });
	await rename(tmp, path);
}
