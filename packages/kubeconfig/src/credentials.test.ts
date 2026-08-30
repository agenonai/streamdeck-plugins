import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCredentials } from "./credentials.js";

const CA_DATA = Buffer.from("fake-ca-bytes").toString("base64");
const CERT_DATA = Buffer.from("fake-cert-bytes").toString("base64");
const KEY_DATA = Buffer.from("fake-key-bytes").toString("base64");

const NORMAL = `apiVersion: v1
kind: Config
current-context: prod
contexts:
  - name: prod
    context:
      cluster: prod-cluster
      user: prod-user
clusters:
  - name: prod-cluster
    cluster:
      server: https://10.0.0.1:6443
      certificate-authority-data: ${CA_DATA}
users:
  - name: prod-user
    user:
      client-certificate-data: ${CERT_DATA}
      client-key-data: ${KEY_DATA}
`;

const MISSING_CLIENT_CERT = `apiVersion: v1
kind: Config
current-context: prod
contexts:
  - name: prod
    context:
      cluster: prod-cluster
      user: prod-user
clusters:
  - name: prod-cluster
    cluster:
      server: https://10.0.0.1:6443
      certificate-authority-data: ${CA_DATA}
users:
  - name: prod-user
    user:
      client-key-data: ${KEY_DATA}
`;

const MISSING_CA = `apiVersion: v1
kind: Config
current-context: prod
contexts:
  - name: prod
    context:
      cluster: prod-cluster
      user: prod-user
clusters:
  - name: prod-cluster
    cluster:
      server: https://10.0.0.1:6443
users:
  - name: prod-user
    user:
      client-certificate-data: ${CERT_DATA}
      client-key-data: ${KEY_DATA}
`;

const INSECURE_SKIP_TLS_VERIFY = `apiVersion: v1
kind: Config
current-context: prod
contexts:
  - name: prod
    context:
      cluster: prod-cluster
      user: prod-user
clusters:
  - name: prod-cluster
    cluster:
      server: https://10.0.0.1:6443
      insecure-skip-tls-verify: true
users:
  - name: prod-user
    user:
      client-certificate-data: ${CERT_DATA}
      client-key-data: ${KEY_DATA}
`;

const EXEC_PLUGIN = `apiVersion: v1
kind: Config
current-context: prod
contexts:
  - name: prod
    context:
      cluster: prod-cluster
      user: prod-user
clusters:
  - name: prod-cluster
    cluster:
      server: https://10.0.0.1:6443
      certificate-authority-data: ${CA_DATA}
users:
  - name: prod-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: some-credential-plugin
`;

let dir: string;

async function writeFixture(text: string): Promise<string> {
	const path = join(dir, "config");
	await writeFile(path, text, { mode: 0o600 });
	return path;
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "kubeconfig-creds-"));
});

afterEach(() => {
	// Nothing to dispose: resolveCredentials only reads the file, it never keeps a handle open.
});

describe("resolveCredentials", () => {
	it("resolves server, ca, cert and key for a normal context", async () => {
		const path = await writeFixture(NORMAL);
		const result = await resolveCredentials(path, "prod");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.value.server).toBe("https://10.0.0.1:6443");
		expect(result.value.ca.toString()).toBe("fake-ca-bytes");
		expect(result.value.cert.toString()).toBe("fake-cert-bytes");
		expect(result.value.key.toString()).toBe("fake-key-bytes");
	});

	it("fails cleanly for an unknown context", async () => {
		const path = await writeFixture(NORMAL);
		const result = await resolveCredentials(path, "does-not-exist");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure result");
		expect(result.reason).toMatch(/unknown context/i);
	});

	it("fails cleanly when the user has no client-certificate-data", async () => {
		const path = await writeFixture(MISSING_CLIENT_CERT);
		const result = await resolveCredentials(path, "prod");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure result");
		expect(result.reason).toMatch(/client-certificate-data/i);
	});

	it("fails cleanly when the cluster has no certificate-authority-data", async () => {
		const path = await writeFixture(MISSING_CA);
		const result = await resolveCredentials(path, "prod");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure result");
		expect(result.reason).toMatch(/certificate-authority-data/i);
	});

	it("fails cleanly and does not silently succeed for insecure-skip-tls-verify", async () => {
		const path = await writeFixture(INSECURE_SKIP_TLS_VERIFY);
		const result = await resolveCredentials(path, "prod");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure result");
		expect(result.reason).toMatch(/insecure-skip-tls-verify/i);
	});

	it("fails cleanly and does not silently succeed for an exec plugin", async () => {
		const path = await writeFixture(EXEC_PLUGIN);
		const result = await resolveCredentials(path, "prod");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure result");
		expect(result.reason).toMatch(/exec/i);
	});

	it("fails cleanly when the kubeconfig cannot be read", async () => {
		const result = await resolveCredentials(join(dir, "missing-file"), "prod");

		expect(result.ok).toBe(false);
	});
});
