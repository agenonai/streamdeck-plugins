import { type Document, parseDocument } from "yaml";

export type KubeconfigState = {
	/** Context names, in the order they appear in the file. */
	contexts: string[];
	/** Active context, or null when the file does not name one. */
	current: string | null;
	/** False when the file could not be parsed as a kubeconfig. Writes are refused in that case. */
	ok: boolean;
};

export type ParseResult = {
	state: KubeconfigState;
	/** The parsed document, kept so a write can mutate one node and preserve everything else. */
	doc: Document.Parsed | null;
};

const EMPTY: KubeconfigState = { contexts: [], current: null, ok: false };

export function parseKubeconfig(text: string): ParseResult {
	let doc: Document.Parsed;
	try {
		doc = parseDocument(text);
	} catch {
		return { state: EMPTY, doc: null };
	}

	if (doc.errors.length > 0) {
		return { state: EMPTY, doc: null };
	}

	const rawContexts = doc.get("contexts");
	const contexts = doc.toJS()?.contexts;
	if (rawContexts === undefined || !Array.isArray(contexts)) {
		return { state: EMPTY, doc: null };
	}

	const names = contexts
		.map((entry: unknown) =>
			typeof entry === "object" && entry !== null && typeof (entry as { name?: unknown }).name === "string"
				? (entry as { name: string }).name
				: null,
		)
		.filter((name: string | null): name is string => name !== null);

	const current = doc.get("current-context");
	return {
		state: {
			contexts: names,
			current: typeof current === "string" && current.length > 0 ? current : null,
			ok: true,
		},
		doc,
	};
}
