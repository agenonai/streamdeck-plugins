import { chmod, copyFile, readFile, readlink, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { parseDocument, type Document, type Node, type Scalar } from "yaml";
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
 * Nothing here trusts the splice blindly. The spliced text is re-parsed
 * before any byte reaches the disk, and the write is refused unless the
 * result parses as a kubeconfig whose current-context is exactly name. A bad
 * node range, or a name that YAML would read back as something else, fails
 * loudly instead of leaving an unusable file behind.
 *
 * Symlinks are followed: the temp file, the backup and the rename target are
 * all derived from the resolved real path, so a ~/.kube/config symlinked into
 * a dotfiles repository keeps its link and the real file is the one updated.
 *
 * The new content is written to a sibling temp file and renamed over the
 * original, so an interrupted write cannot truncate the kubeconfig. The file
 * is re-read immediately before that rename and the write is abandoned if it
 * changed in the meantime, so a concurrent `kubectl config` edit is never
 * silently clobbered.
 *
 * If the context is already active, this is a no-op.
 */
export async function writeCurrentContext(path: string, name: string, opts: WriteOptions = {}): Promise<void> {
	const target = await resolveWriteTarget(path);
	const text = await readFile(target, "utf8");
	const { state, doc } = parseKubeconfig(text);

	if (!state.ok || doc === null) {
		throw new Error(`kubeconfig at ${target} could not be parsed, refusing to write`);
	}
	if (!state.contexts.includes(name)) {
		throw new Error(`unknown context: ${name}`);
	}
	if (state.current === name) {
		return;
	}

	const next = spliceCurrentContext(text, doc, name);
	assertNamesContext(next, name, target);

	const before = await stat(target);

	if (opts.backup !== false) {
		await copyFile(target, `${target}.streamdeck-bak`);
	}

	const tmp = `${target}.streamdeck-tmp`;
	try {
		await unlink(tmp);
	} catch {
		// temp file does not exist, that's fine
	}
	await writeFile(tmp, next);
	await chmod(tmp, before.mode & 0o777);
	await assertUnchangedSince(target, text, before, tmp);
	await rename(tmp, target);
}

/**
 * Resolves path through any symlinks so the write lands on the real file.
 *
 * Without this, renaming a temp file over a symlinked ~/.kube/config replaces
 * the link itself with a regular file and leaves the linked-to file stale,
 * and the .streamdeck-bak backup is written next to the link rather than next
 * to the file it protects.
 */
async function resolveWriteTarget(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (err) {
		// A dangling symlink resolves to nothing. Say so, rather than letting a
		// bare ENOENT suggest the kubeconfig is simply missing.
		const link = await readlink(path).catch(() => null);
		if (link !== null) {
			throw new Error(`kubeconfig at ${path} is a symlink to ${link}, which does not exist, refusing to write`);
		}
		throw err;
	}
}

/**
 * Refuses the write unless the spliced text really is a kubeconfig naming
 * name as its current context.
 *
 * This is the backstop for every way a character-range splice can go wrong:
 * a node range that ran past the end of the value, a key present with no
 * value at all, or a context name that YAML reads back as a boolean or a
 * number instead of the string that was asked for.
 */
function assertNamesContext(next: string, name: string, target: string): void {
	const { state } = parseKubeconfig(next);
	if (!state.ok) {
		throw new Error(`refusing to write ${target}: the rewritten kubeconfig does not parse`);
	}
	if (state.current !== name) {
		const reads = state.currentInvalid ? "a value that is not a context name" : (state.current ?? "no context");
		throw new Error(
			`refusing to write ${target}: the rewritten kubeconfig reads back current-context as ${reads}, not ${name}`,
		);
	}
}

/**
 * Refuses the rename when the file changed after it was read.
 *
 * The whole file is written back, so anything that landed between the read
 * and the rename (a `kubectl config set-context`, a hand edit, another tool)
 * would be overwritten by stale text and lost. The content is compared
 * directly rather than by mtime alone, which is too coarse to catch a change
 * made inside the same clock tick, and the inode is checked as well so an
 * atomic replacement by another writer is caught too.
 */
async function assertUnchangedSince(target: string, expected: string, before: Stats, tmp: string): Promise<void> {
	let unchanged = false;
	try {
		const now = await stat(target);
		unchanged = now.ino === before.ino && (await readFile(target, "utf8")) === expected;
	} catch {
		unchanged = false;
	}
	if (unchanged) {
		return;
	}
	try {
		await unlink(tmp);
	} catch {
		// nothing to clean up
	}
	throw new Error(`kubeconfig at ${target} changed while the write was being prepared, refusing to overwrite it`);
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
		const [rangeStart, rangeEnd] = node.range;
		let start = rangeStart;
		let end = rangeEnd;
		let replacement = formatReplacement(node, name);

		// A block scalar's value range runs past the last character of the
		// value to take in the newline that ends the block, so splicing the
		// raw range out would glue the replacement onto the following line.
		// Trimming trailing whitespace off the range is a no-op for every
		// other scalar style.
		while (end > start && isSpace(text.charAt(end - 1))) {
			end -= 1;
		}

		if (start >= end) {
			// The key is present with no value at all (`current-context:`).
			// Its range is empty and sits right after the colon, so the
			// replacement has to bring the separating space with it. Spaces
			// already sitting between the colon and the line break are
			// absorbed so the result is never `key:  value`.
			end = start;
			while (start > 0 && isBlank(text.charAt(start - 1))) {
				start -= 1;
			}
			if (start > 0 && text.charAt(start - 1) === ":") {
				replacement = ` ${replacement}`;
			}
		}

		return text.slice(0, start) + replacement + text.slice(end);
	}

	// No current-context key exists yet: append one as a new top-level line
	// instead of touching the rest of the document.
	const needsLeadingNewline = text.length > 0 && !text.endsWith("\n");
	return `${text}${needsLeadingNewline ? "\n" : ""}current-context: ${formatReplacement(undefined, name)}\n`;
}

/** Any whitespace, including line breaks. */
function isSpace(char: string): boolean {
	return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/** Horizontal whitespace only. */
function isBlank(char: string): boolean {
	return char === " " || char === "\t";
}

/**
 * Renders the replacement value, keeping the quote style of the node it
 * replaces and quoting anything that would not survive as a plain scalar.
 *
 * A context is allowed to be called `true`, `0755` or `a: b #c`. Written
 * bare, the first two read back as a boolean and an integer and the third
 * does not parse at all, so the key would never converge on the requested
 * name and every key press would rewrite the file.
 */
function formatReplacement(node: Node | undefined, name: string): string {
	const type = node === undefined ? undefined : (node as Scalar).type;

	if (type === "QUOTE_DOUBLE") {
		return doubleQuote(name);
	}
	if (type === "QUOTE_SINGLE" && isSingleQuotable(name)) {
		return `'${name.replace(/'/g, "''")}'`;
	}
	return roundTripsAsPlain(name) ? name : doubleQuote(name);
}

/**
 * True when writing name bare after `current-context: ` parses back as
 * exactly that string. The YAML parser itself is the oracle here, so this
 * stays correct for every resolution rule the schema applies.
 */
function roundTripsAsPlain(name: string): boolean {
	if (name.length === 0) {
		return false;
	}
	const probe = parseDocument(`current-context: ${name}\n`);
	return probe.errors.length === 0 && probe.get("current-context") === name;
}

/** Single quotes can hold anything except line breaks and other control characters. */
function isSingleQuotable(name: string): boolean {
	return !/[\u0000-\u001f\u007f]/.test(name);
}

/**
 * YAML's double-quoted style is a superset of the JSON string grammar, so
 * JSON escaping is always a valid and unambiguous rendering.
 */
function doubleQuote(name: string): string {
	return JSON.stringify(name);
}
