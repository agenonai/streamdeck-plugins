import { request } from "node:https";
import type { Credentials } from "./credentials.js";

/**
 * Probes one context's API server with GET /readyz over mutual TLS.
 *
 * This only ever touches the network, never the file: it takes credentials
 * already resolved by credentials.ts and issues a single HTTPS request.
 *
 * Never throws and never rejects. A 200 response resolves "ok"; a connection
 * refusal, a TLS failure (untrusted CA, missing or wrong client certificate),
 * any non-200 response, or the request not completing within timeoutMs all
 * resolve "down".
 *
 * The deadline is wall-clock, not socket-inactivity: `timeoutMs` is enforced
 * by a plain setTimeout that always destroys the request and settles the
 * promise, so a server that keeps the connection alive by trickling bytes
 * (rather than going idle) still gets cut off on schedule. Whichever settles
 * first, that outcome wins and the deadline timer is always cleared, so no
 * timer or socket is left behind either way.
 */
export async function probe(creds: Credentials, timeoutMs: number): Promise<"ok" | "down"> {
	return new Promise((resolve) => {
		let settled = false;
		let req: ReturnType<typeof request> | undefined;

		const deadline = setTimeout(() => {
			finish("down");
			req?.destroy(new Error("health probe timed out"));
		}, timeoutMs);

		function finish(result: "ok" | "down"): void {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(deadline);
			resolve(result);
		}

		let url: URL;
		try {
			url = new URL(creds.server);
		} catch {
			finish("down");
			return;
		}

		try {
			req = request(
				{
					hostname: bareHost(url.hostname),
					port: url.port === "" ? 443 : Number(url.port),
					path: joinReadyzPath(url.pathname),
					method: "GET",
					ca: creds.ca,
					cert: creds.cert,
					key: creds.key,
				},
				(res) => {
					res.on("data", () => {
						// Drain the body so the socket can close cleanly; the content is not used.
					});
					res.on("error", () => finish("down"));
					res.on("end", () => finish(res.statusCode === 200 ? "ok" : "down"));
				},
			);

			req.on("error", () => {
				finish("down");
			});
			req.end();
		} catch {
			finish("down");
		}
	});
}

/**
 * `new URL(...).hostname` keeps the surrounding brackets for an IPv6
 * literal (`"[::1]"`), which is correct for re-serializing a URL but wrong
 * as a `net.connect`/`tls.connect` hostname: passed through as-is, Node
 * treats it as a DNS name instead of a literal address, and the connection
 * never reaches the real host.
 */
function bareHost(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Joins the cluster server's own path (a reverse proxy prefix, for example)
 * with /readyz, instead of always probing bare /readyz and missing the
 * prefix entirely.
 */
function joinReadyzPath(pathname: string): string {
	const base = pathname.endsWith("/") ? pathname : `${pathname}/`;
	return `${base}readyz`;
}
