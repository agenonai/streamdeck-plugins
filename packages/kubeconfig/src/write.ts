import { chmod, copyFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { Document, Node, Scalar } from "yaml";
import { parseKubeconfig } from "./parse.js";

export type WriteOptions = {
	/** Copy the file to <path>.streamdeck-bak before the first write. Defaults to true. */
	backup?: boolean;
};

/**
 * Sets current-context to name without re-serialising the file.
 *
 * The parsed document is only used to locate the current-context value's
 * exact character range in the ORIGINAL source text; the replacement is a
 * plain string splice of that range. Every other byte of the file, including
 * comment placement, key order, quoting style, list indentation, and the
 * presence or absence of a trailing newline, is left untouched by
 * construction. This is what makes it safe to run against a hand-edited or
 * version-controlled kubeconfig: a diff of the write will show exactly one
 * changed value.
 *
 * If the file has no current-context key at all, one is appended as a new
 * top-level line at the end of the file (adding a leading newline first if
 * the file did not already end with one). No other line is touched in that
 * case either.
 *
 * The new content is written to a sibling temp file and renamed over the
 * original, so an interrupted write cannot truncate the kubeconfig.
 * If the context is already active, this is a no-op.
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

	const next = spliceCurrentContext(text, doc, name);

	const mode = (await stat(path)).mode & 0o777;
	const tmp = `${path}.streamdeck-tmp`;
	try {
		await unlink(tmp);
	} catch {
		// temp file does not exist, that's fine
	}
	await writeFile(tmp, next);
	await chmod(tmp, mode);
	await rename(tmp, path);
}

/**
 * Replaces just the current-context value in the original source text,
 * using the parsed node's character range so no other byte moves. When the
 * original value was quoted, the replacement keeps the same quote style so
 * only the characters inside the quotes change.
 */
function spliceCurrentContext(text: string, doc: Document.Parsed, name: string): string {
	const node = doc.get("current-context", true) as Node | undefined;

	if (node !== undefined && Array.isArray(node.range)) {
		const [start, valueEnd] = node.range;
		return text.slice(0, start) + formatReplacement(node, name) + text.slice(valueEnd);
	}

	// No current-context key exists yet: append one as a new top-level line
	// instead of touching the rest of the document.
	const needsLeadingNewline = text.length > 0 && !text.endsWith("\n");
	return `${text}${needsLeadingNewline ? "\n" : ""}current-context: ${name}\n`;
}

/** Renders the replacement value using the same quote style as the node it replaces. */
function formatReplacement(node: Node, name: string): string {
	const type = (node as Scalar).type;

	if (type === "QUOTE_DOUBLE") {
		return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	if (type === "QUOTE_SINGLE") {
		return `'${name.replace(/'/g, "''")}'`;
	}
	return name;
}
