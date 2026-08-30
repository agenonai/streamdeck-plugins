import { request } from "node:https";
import type { Credentials } from "./credentials.js";

/**
 * Probes one context's API server with GET /readyz over mutual TLS.
 *
 * This only ever touches the network, never the file: it takes credentials
 * already resolved by credentials.ts and issues a single HTTPS request.
 *
 * Never throws and never rejects. A 200 response resolves "ok"; a connection
 * refusal, a timeout, a TLS failure (untrusted CA, missing or wrong client
 * certificate) or any non-200 response resolves "down". On timeout the
 * underlying request is destroyed so no socket or timer is left behind.
 */
export async function probe(creds: Credentials, timeoutMs: number): Promise<"ok" | "down"> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: "ok" | "down"): void => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(result);
		};

		let url: URL;
		try {
			url = new URL(creds.server);
		} catch {
			finish("down");
			return;
		}

		try {
			const req = request(
				{
					hostname: url.hostname,
					port: url.port === "" ? 443 : Number(url.port),
					path: "/readyz",
					method: "GET",
					ca: creds.ca,
					cert: creds.cert,
					key: creds.key,
					timeout: timeoutMs,
				},
				(res) => {
					res.on("data", () => {
						// Drain the body so the socket can close cleanly; the content is not used.
					});
					res.on("error", () => finish("down"));
					res.on("end", () => finish(res.statusCode === 200 ? "ok" : "down"));
				},
			);

			req.on("timeout", () => {
				req.destroy(new Error("health probe timed out"));
			});
			req.on("error", () => {
				finish("down");
			});
			req.end();
		} catch {
			finish("down");
		}
	});
}
