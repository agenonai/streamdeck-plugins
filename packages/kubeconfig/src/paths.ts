import { join } from "node:path";

/** Resolves the kubeconfig file the service should read and write. */
export function resolveKubeconfigPath(env: NodeJS.ProcessEnv, homedir: string): string {
	const fromEnv = env.KUBECONFIG?.split(":").filter(Boolean)[0];
	return fromEnv ?? join(homedir, ".kube", "config");
}
