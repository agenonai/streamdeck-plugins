import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

/** TLS material a health probe needs to reach one context's API server. */
export type Credentials = {
	server: string;
	ca: Buffer;
	cert: Buffer;
	key: Buffer;
};

export type CredentialsResult = { ok: true; value: Credentials } | { ok: false; reason: string };

type UnknownRecord = Record<string, unknown>;

/**
 * Resolves the TLS material for one context by reading the kubeconfig file
 * directly and following context -> cluster and context -> user by name.
 *
 * This only ever touches the file, never the network; it does not attempt to
 * connect to the resolved server.
 *
 * Every user in a real kubeconfig here authenticates with
 * client-certificate-data plus client-key-data, and every cluster carries an
 * embedded certificate-authority-data, with no exec plugins, bearer tokens,
 * or insecure-skip-tls-verify. Anything outside that shape is reported back
 * as a clear failure rather than half handled.
 */
export async function resolveCredentials(path: string, contextName: string): Promise<CredentialsResult> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (err) {
		return { ok: false, reason: `could not read kubeconfig at ${path}: ${String(err)}` };
	}

	let raw: UnknownRecord;
	try {
		const parsed = parseDocument(text);
		if (parsed.errors.length > 0) {
			return { ok: false, reason: `kubeconfig at ${path} could not be parsed` };
		}
		raw = (parsed.toJS() ?? {}) as UnknownRecord;
	} catch {
		return { ok: false, reason: `kubeconfig at ${path} could not be parsed` };
	}

	const contextEntry = findByName(raw.contexts, contextName);
	if (contextEntry === undefined) {
		return { ok: false, reason: `unknown context: ${contextName}` };
	}

	const contextBody = contextEntry.context;
	if (!isRecord(contextBody) || typeof contextBody.cluster !== "string" || typeof contextBody.user !== "string") {
		return { ok: false, reason: `context ${contextName} has no cluster and user reference` };
	}
	const clusterName = contextBody.cluster;
	const userName = contextBody.user;

	const clusterEntry = findByName(raw.clusters, clusterName);
	if (clusterEntry === undefined) {
		return { ok: false, reason: `context ${contextName} references unknown cluster: ${clusterName}` };
	}
	const userEntry = findByName(raw.users, userName);
	if (userEntry === undefined) {
		return { ok: false, reason: `context ${contextName} references unknown user: ${userName}` };
	}

	const clusterBody = clusterEntry.cluster;
	if (!isRecord(clusterBody) || typeof clusterBody.server !== "string") {
		return { ok: false, reason: `cluster ${clusterName} has no server` };
	}
	if (clusterBody["insecure-skip-tls-verify"] === true) {
		return {
			ok: false,
			reason: `cluster ${clusterName} uses insecure-skip-tls-verify, which is not supported`,
		};
	}
	const caData = clusterBody["certificate-authority-data"];
	if (typeof caData !== "string") {
		return { ok: false, reason: `cluster ${clusterName} has no certificate-authority-data` };
	}

	const userBody = userEntry.user;
	if (!isRecord(userBody)) {
		return { ok: false, reason: `user ${userName} has no credentials` };
	}
	if (userBody.exec !== undefined) {
		return { ok: false, reason: `user ${userName} uses an exec plugin, which is not supported` };
	}
	if (userBody.token !== undefined || userBody.username !== undefined || userBody["auth-provider"] !== undefined) {
		return {
			ok: false,
			reason: `user ${userName} does not use client certificate authentication, which is required`,
		};
	}
	const certData = userBody["client-certificate-data"];
	const keyData = userBody["client-key-data"];
	if (typeof certData !== "string") {
		return { ok: false, reason: `user ${userName} has no client-certificate-data` };
	}
	if (typeof keyData !== "string") {
		return { ok: false, reason: `user ${userName} has no client-key-data` };
	}

	return {
		ok: true,
		value: {
			server: clusterBody.server,
			ca: Buffer.from(caData, "base64"),
			cert: Buffer.from(certData, "base64"),
			key: Buffer.from(keyData, "base64"),
		},
	};
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null;
}

/** Finds an entry with a matching `name` field in a kubeconfig list, tolerating a malformed or missing list. */
function findByName(list: unknown, name: string): UnknownRecord | undefined {
	if (!Array.isArray(list)) {
		return undefined;
	}
	return list.find((entry): entry is UnknownRecord => isRecord(entry) && entry.name === name);
}
