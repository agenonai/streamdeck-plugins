import { createServer as createHttpsServer, type Server } from "node:https";
import { createServer as createNetServer } from "node:net";
import forge from "node-forge";
import { generate } from "selfsigned";
import { afterEach, describe, expect, it } from "vitest";
import type { Credentials } from "./credentials.js";
import { probe } from "./health.js";

/**
 * A self-signed root identity: doubles as both a server's own certificate
 * and the trust anchor (`ca`) both sides verify against. selfsigned's own
 * `algorithm` option controls this cert's signature digest (sha256 here).
 */
type Root = { certPem: string; keyPem: string };

/** A leaf certificate signed by a Root, for presenting as a client certificate. */
type Leaf = { certPem: string; keyPem: string };

type SubjectAltName = { type: 2 | 7; value?: string; ip?: string };

function makeRoot(
	commonName: string,
	altNames: SubjectAltName[] = [
		{ type: 7, ip: "127.0.0.1" },
		{ type: 2, value: "localhost" },
	],
): Root {
	const pems = generate([{ name: "commonName", value: commonName }], {
		algorithm: "sha256",
		extensions: [
			{ name: "basicConstraints", cA: true, critical: true },
			{ name: "keyUsage", digitalSignature: true, keyCertSign: true, keyEncipherment: true, critical: true },
			{ name: "extKeyUsage", serverAuth: true, clientAuth: true },
			{ name: "subjectAltName", altNames },
		],
	});
	return { certPem: pems.cert, keyPem: pems.private };
}

/**
 * Signs a client leaf certificate with `root`'s key, using sha256.
 *
 * `selfsigned`'s own `clientCertificate: true` shortcut signs the leaf it
 * mints with a hardcoded digest that ignores the `algorithm` option
 * entirely (confirmed against selfsigned@2.4.1: the leaf comes back signed
 * with a digest modern OpenSSL refuses outright, "ca md too weak", failing
 * before a single byte reaches the network). node-forge is already
 * selfsigned's own runtime dependency; signing the leaf directly here, the
 * same way selfsigned mints its root cert, is a few lines instead of a new
 * dependency.
 */
function signClientCert(root: Root, commonName: string): Leaf {
	const rootCert = forge.pki.certificateFromPem(root.certPem);
	const rootKey = forge.pki.privateKeyFromPem(root.keyPem);
	const keys = forge.pki.rsa.generateKeyPair(2048);

	const cert = forge.pki.createCertificate();
	cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(9));
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
	cert.setSubject([{ name: "commonName", value: commonName }]);
	cert.setIssuer(rootCert.subject.attributes);
	cert.publicKey = keys.publicKey;
	cert.setExtensions([
		{ name: "basicConstraints", cA: false, critical: true },
		{ name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
		{ name: "extKeyUsage", clientAuth: true },
	]);
	cert.sign(rootKey, forge.md.sha256.create());

	return {
		certPem: forge.pki.certificateToPem(cert),
		keyPem: forge.pki.privateKeyToPem(keys.privateKey),
	};
}

type ServerHandle = { server: Server; port: number };
type Handler = Parameters<typeof createHttpsServer>[1] extends undefined
	? never
	: NonNullable<Parameters<typeof createHttpsServer>[1]>;

/** Starts an https server requiring a client certificate signed by `root`. */
function startServer(root: Root, handler: Handler, host = "127.0.0.1"): Promise<ServerHandle> {
	return new Promise((resolve, reject) => {
		const server = createHttpsServer(
			{ cert: root.certPem, key: root.keyPem, ca: root.certPem, requestCert: true, rejectUnauthorized: true },
			handler,
		);
		server.on("error", reject);
		server.listen(0, host, () => {
			const address = server.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			resolve({ server, port });
		});
	});
}

function startRespondingServer(root: Root, status: number, host = "127.0.0.1"): Promise<ServerHandle> {
	return startServer(
		root,
		(_req, res) => {
			res.writeHead(status);
			res.end();
		},
		host,
	);
}

/** Starts an https server whose request handler never responds at all: no headers, nothing. */
function startHangingServer(root: Root): Promise<ServerHandle> {
	return startServer(root, () => {
		// Never respond.
	});
}

/**
 * Starts an https server that sends a 200 header and then keeps the
 * connection alive by writing a byte every `chunkIntervalMs`, without ever
 * calling res.end(). A socket-inactivity timeout (Node's `timeout` request
 * option) never fires against this server because data keeps arriving; only
 * a wall-clock deadline that ignores socket activity cuts it off.
 */
function startTricklingServer(root: Root, chunkIntervalMs = 40): Promise<ServerHandle> {
	return startServer(root, (_req, res) => {
		res.writeHead(200);
		const interval = setInterval(() => {
			res.write(".");
		}, chunkIntervalMs);
		res.on("close", () => clearInterval(interval));
	});
}

/** Starts an https server that only answers 200 at exactly `expectedPath`, 404 otherwise. */
function startPrefixedServer(root: Root, expectedPath: string): Promise<ServerHandle> {
	return startServer(root, (req, res) => {
		res.writeHead(req.url === expectedPath ? 200 : 404);
		res.end();
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

/** Brackets an IPv6 literal for use in a URL; leaves a hostname or IPv4 literal alone. */
function urlHost(host: string): string {
	return host.includes(":") ? `[${host}]` : host;
}

function credsFor(host: string, port: number, ca: Root, client: Leaf, path = ""): Credentials {
	return {
		server: `https://${urlHost(host)}:${port}${path}`,
		ca: Buffer.from(ca.certPem),
		cert: Buffer.from(client.certPem),
		key: Buffer.from(client.keyPem),
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
		const root = makeRoot("127.0.0.1");
		const client = signClientCert(root, "test-client");
		const { server, port } = await startRespondingServer(root, 200);
		servers.push(server);

		await expect(probe(credsFor("127.0.0.1", port, root, client), 2000)).resolves.toBe("ok");
	});

	it("resolves down for a non-200 response", async () => {
		const root = makeRoot("127.0.0.1");
		const client = signClientCert(root, "test-client");
		const { server, port } = await startRespondingServer(root, 500);
		servers.push(server);

		await expect(probe(credsFor("127.0.0.1", port, root, client), 2000)).resolves.toBe("down");
	});

	it("resolves down within roughly the timeout when the server never responds", async () => {
		const root = makeRoot("127.0.0.1");
		const client = signClientCert(root, "test-client");
		const { server, port } = await startHangingServer(root);
		servers.push(server);

		const timeoutMs = 300;
		const start = Date.now();
		const result = await probe(credsFor("127.0.0.1", port, root, client), timeoutMs);
		const elapsed = Date.now() - start;

		expect(result).toBe("down");
		expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
		expect(elapsed).toBeLessThan(timeoutMs + 1500);
	});

	// Regression test for a socket-inactivity timeout (the `timeout` option
	// on an https request) instead of a wall-clock deadline: this server
	// never goes idle, so an inactivity-based timeout never fires. Also
	// proves the in-flight probe does not leave anything broken behind: a
	// later probe against a normal server still completes.
	it("resolves down close to the timeout when the server trickles bytes without ending, and a later probe still runs", async () => {
		const root = makeRoot("127.0.0.1");
		const client = signClientCert(root, "test-client");
		const { server, port } = await startTricklingServer(root, 40);
		servers.push(server);

		const timeoutMs = 300;
		const start = Date.now();
		const result = await probe(credsFor("127.0.0.1", port, root, client), timeoutMs);
		const elapsed = Date.now() - start;

		expect(result).toBe("down");
		expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
		expect(elapsed).toBeLessThan(timeoutMs + 1500);

		const { server: okServer, port: okPort } = await startRespondingServer(root, 200);
		servers.push(okServer);
		await expect(probe(credsFor("127.0.0.1", okPort, root, client), 2000)).resolves.toBe("ok");
	});

	it("resolves down for a refused connection", async () => {
		const root = makeRoot("127.0.0.1");
		const client = signClientCert(root, "test-client");
		const port = await freePort();

		await expect(probe(credsFor("127.0.0.1", port, root, client), 2000)).resolves.toBe("down");
	});

	it("resolves down when the client does not trust the server's CA", async () => {
		const root = makeRoot("127.0.0.1");
		const wrongCa = makeRoot("wrong-ca");
		const client = signClientCert(root, "test-client");
		const { server, port } = await startRespondingServer(root, 200);
		servers.push(server);

		await expect(probe(credsFor("127.0.0.1", port, wrongCa, client), 2000)).resolves.toBe("down");
	});

	it("resolves down when the client certificate is missing", async () => {
		const root = makeRoot("127.0.0.1");
		const { server, port } = await startRespondingServer(root, 200);
		servers.push(server);

		const creds: Credentials = {
			server: `https://127.0.0.1:${port}`,
			ca: Buffer.from(root.certPem),
			cert: Buffer.alloc(0),
			key: Buffer.alloc(0),
		};

		await expect(probe(creds, 2000)).resolves.toBe("down");
	});

	it("resolves down when the client certificate is signed by the wrong CA", async () => {
		const root = makeRoot("127.0.0.1");
		const otherRoot = makeRoot("other");
		const wrongClient = signClientCert(otherRoot, "test-client");
		const { server, port } = await startRespondingServer(root, 200);
		servers.push(server);

		await expect(probe(credsFor("127.0.0.1", port, root, wrongClient), 2000)).resolves.toBe("down");
	});

	// Regression test: new URL("https://[::1]:port").hostname keeps the
	// brackets ("[::1]"), and passing that straight through as the
	// connection hostname sends the literal string to DNS instead of
	// connecting to the address, so every IPv6 cluster server reported down
	// even when healthy.
	it("resolves ok end to end against an IPv6 literal server address", async () => {
		const root = makeRoot("ipv6-target", [{ type: 7, ip: "::1" }]);
		const client = signClientCert(root, "test-client");
		const { server, port } = await startRespondingServer(root, 200, "::1");
		servers.push(server);

		await expect(probe(credsFor("::1", port, root, client), 2000)).resolves.toBe("ok");
	});

	// Regression test: the probe used to hardcode "/readyz", dropping any
	// path prefix the cluster server itself has behind a reverse proxy.
	it("probes the joined path when the cluster server has a path prefix", async () => {
		const root = makeRoot("127.0.0.1");
		const client = signClientCert(root, "test-client");
		const { server, port } = await startPrefixedServer(root, "/prefix/readyz");
		servers.push(server);

		await expect(probe(credsFor("127.0.0.1", port, root, client, "/prefix"), 2000)).resolves.toBe("ok");
	});

	// Control for the test above: confirms the server genuinely enforces the
	// path (so "probes the joined path" is not passing because the server
	// always answers 200 regardless of what it was asked).
	it("resolves down when the cluster server has a path prefix but the probe omits it", async () => {
		const root = makeRoot("127.0.0.1");
		const client = signClientCert(root, "test-client");
		const { server, port } = await startPrefixedServer(root, "/prefix/readyz");
		servers.push(server);

		await expect(probe(credsFor("127.0.0.1", port, root, client), 2000)).resolves.toBe("down");
	});

	it("resolves down without throwing when the server URL is malformed", async () => {
		const creds: Credentials = {
			server: "not a url",
			ca: Buffer.alloc(0),
			cert: Buffer.alloc(0),
			key: Buffer.alloc(0),
		};

		await expect(probe(creds, 100)).resolves.toBe("down");
	});

	it("leaves no active handles behind after a timeout", async () => {
		const root = makeRoot("127.0.0.1");
		const client = signClientCert(root, "test-client");
		const { server, port } = await startHangingServer(root);
		servers.push(server);

		const activeHandles = (): unknown[] =>
			(process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();
		const before = new Set(activeHandles());

		await probe(credsFor("127.0.0.1", port, root, client), 200);
		// Give sockets torn down by req.destroy() a tick to actually close.
		await new Promise((resolve) => setTimeout(resolve, 100));

		const leaked = activeHandles().filter((handle) => !before.has(handle));
		expect(leaked).toEqual([]);
	});
});
