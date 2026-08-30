import { createServer as createHttpsServer, type Server } from "node:https";
import { createServer as createNetServer } from "node:net";
import { generate, type GenerateResult } from "selfsigned";
import { afterEach, describe, expect, it } from "vitest";
import type { Credentials } from "./credentials.js";
import { probe } from "./health.js";

type Ca = { key: string; cert: string };

async function makeCa(): Promise<Ca> {
	const pems = await generate([{ name: "commonName", value: "test-ca" }], {
		algorithm: "sha256",
		extensions: [
			{ name: "basicConstraints", cA: true, critical: true },
			{ name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
		],
	});
	return { key: pems.private, cert: pems.cert };
}

async function makeServerCert(ca: Ca): Promise<GenerateResult> {
	return generate([{ name: "commonName", value: "127.0.0.1" }], {
		algorithm: "sha256",
		ca,
		extensions: [
			{ name: "basicConstraints", cA: false, critical: true },
			{ name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
			{ name: "extKeyUsage", serverAuth: true },
			{
				name: "subjectAltName",
				altNames: [
					{ type: 7, ip: "127.0.0.1" },
					{ type: 2, value: "localhost" },
				],
			},
		],
	});
}

async function makeClientCert(ca: Ca): Promise<GenerateResult> {
	return generate([{ name: "commonName", value: "test-client" }], {
		algorithm: "sha256",
		ca,
		clientCertificate: true,
		extensions: [{ name: "extKeyUsage", clientAuth: true }],
	});
}

type ServerHandle = { server: Server; port: number };

/** Starts an https server that requires a client certificate signed by `ca`. */
function startServer(
	serverCert: GenerateResult,
	ca: Ca,
	handler: (status: number, respond: (status: number) => void) => void,
): Promise<ServerHandle> {
	return new Promise((resolve, reject) => {
		const server = createHttpsServer(
			{
				cert: serverCert.cert,
				key: serverCert.private,
				ca: ca.cert,
				requestCert: true,
				rejectUnauthorized: true,
			},
			(req, res) => {
				handler(200, (status) => {
					res.writeHead(status);
					res.end();
				});
			},
		);
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			resolve({ server, port });
		});
	});
}

/** Starts an https server whose request handler never responds. */
function startHangingServer(serverCert: GenerateResult, ca: Ca): Promise<ServerHandle> {
	return new Promise((resolve, reject) => {
		const server = createHttpsServer(
			{ cert: serverCert.cert, key: serverCert.private, ca: ca.cert, requestCert: true, rejectUnauthorized: true },
			() => {
				// Never respond, and never end the response.
			},
		);
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			resolve({ server, port });
		});
	});
}

/** Finds a TCP port with nothing listening on it, by binding then immediately releasing it. */
async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probeServer = createNetServer();
		probeServer.on("error", reject);
		probeServer.listen(0, "127.0.0.1", () => {
			const address = probeServer.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			probeServer.close(() => resolve(port));
		});
	});
}

function credsFor(port: number, ca: Ca, client: GenerateResult): Credentials {
	return {
		server: `https://127.0.0.1:${port}`,
		ca: Buffer.from(ca.cert),
		cert: Buffer.from(client.cert),
		key: Buffer.from(client.private),
	};
}

let servers: Server[] = [];

afterEach(async () => {
	await Promise.all(
		servers.map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections?.();
				}),
		),
	);
	servers = [];
});

describe("probe", () => {
	it("resolves ok for a 200 response", async () => {
		const ca = await makeCa();
		const serverCert = await makeServerCert(ca);
		const client = await makeClientCert(ca);
		const { server, port } = await startServer(serverCert, ca, (_status, respond) => respond(200));
		servers.push(server);

		await expect(probe(credsFor(port, ca, client), 2000)).resolves.toBe("ok");
	});

	it("resolves down for a non-200 response", async () => {
		const ca = await makeCa();
		const serverCert = await makeServerCert(ca);
		const client = await makeClientCert(ca);
		const { server, port } = await startServer(serverCert, ca, (_status, respond) => respond(500));
		servers.push(server);

		await expect(probe(credsFor(port, ca, client), 2000)).resolves.toBe("down");
	});

	it("resolves down within roughly the timeout when the server never responds", async () => {
		const ca = await makeCa();
		const serverCert = await makeServerCert(ca);
		const client = await makeClientCert(ca);
		const { server, port } = await startHangingServer(serverCert, ca);
		servers.push(server);

		const timeoutMs = 300;
		const start = Date.now();
		const result = await probe(credsFor(port, ca, client), timeoutMs);
		const elapsed = Date.now() - start;

		expect(result).toBe("down");
		expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
		expect(elapsed).toBeLessThan(timeoutMs + 1500);
	});

	it("resolves down for a refused connection", async () => {
		const ca = await makeCa();
		const client = await makeClientCert(ca);
		const port = await freePort();

		await expect(probe(credsFor(port, ca, client), 2000)).resolves.toBe("down");
	});

	it("resolves down when the client does not trust the server's CA", async () => {
		const ca = await makeCa();
		const wrongCa = await makeCa();
		const serverCert = await makeServerCert(ca);
		const client = await makeClientCert(ca);
		const { server, port } = await startServer(serverCert, ca, (_status, respond) => respond(200));
		servers.push(server);

		await expect(probe(credsFor(port, wrongCa, client), 2000)).resolves.toBe("down");
	});

	it("resolves down when the client certificate is missing", async () => {
		const ca = await makeCa();
		const serverCert = await makeServerCert(ca);
		const { server, port } = await startServer(serverCert, ca, (_status, respond) => respond(200));
		servers.push(server);

		const creds: Credentials = {
			server: `https://127.0.0.1:${port}`,
			ca: Buffer.from(ca.cert),
			cert: Buffer.alloc(0),
			key: Buffer.alloc(0),
		};

		await expect(probe(creds, 2000)).resolves.toBe("down");
	});

	it("resolves down when the client certificate is signed by the wrong CA", async () => {
		const ca = await makeCa();
		const otherCa = await makeCa();
		const serverCert = await makeServerCert(ca);
		const wrongClient = await makeClientCert(otherCa);
		const { server, port } = await startServer(serverCert, ca, (_status, respond) => respond(200));
		servers.push(server);

		await expect(probe(credsFor(port, ca, wrongClient), 2000)).resolves.toBe("down");
	});

	it("never throws or rejects", async () => {
		const creds: Credentials = {
			server: "not a url",
			ca: Buffer.alloc(0),
			cert: Buffer.alloc(0),
			key: Buffer.alloc(0),
		};

		await expect(probe(creds, 100)).resolves.toBe("down");
	});

	it("leaves no active handles behind after a timeout", async () => {
		const ca = await makeCa();
		const serverCert = await makeServerCert(ca);
		const client = await makeClientCert(ca);
		const { server, port } = await startHangingServer(serverCert, ca);
		servers.push(server);

		const activeHandles = (): unknown[] => (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();
		const before = new Set(activeHandles());

		await probe(credsFor(port, ca, client), 200);
		// Give sockets torn down by req.destroy() a tick to actually close.
		await new Promise((resolve) => setTimeout(resolve, 100));

		const leaked = activeHandles().filter((handle) => !before.has(handle));
		expect(leaked).toEqual([]);
	});
});
