import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AiSourceId } from "./types.js";

const execFileAsync = promisify(execFile);
const SERVICE_PREFIX = "diffing.ai";

export interface SecretStore {
	get(source: AiSourceId): Promise<string | null>;
	set(source: AiSourceId, value: string, remember: boolean): Promise<"vault" | "session">;
	delete(source: AiSourceId): Promise<void>;
}

export class SystemSecretStore implements SecretStore {
	private readonly session = new Map<AiSourceId, string>();

	async get(source: AiSourceId): Promise<string | null> {
		const session = this.session.get(source);
		if (session) return session;
		try {
			if (process.platform === "darwin") {
				const { stdout } = await execFileAsync("security", [
					"find-generic-password",
					"-a",
					source,
					"-s",
					`${SERVICE_PREFIX}.${source}`,
					"-w",
				]);
				return stdout.trim() || null;
			}
			if (process.platform === "linux") {
				const { stdout } = await execFileAsync("secret-tool", [
					"lookup",
					"service",
					SERVICE_PREFIX,
					"source",
					source,
				]);
				return stdout.trim() || null;
			}
		} catch {
			// Missing/locked vault is an intentional session-only fallback.
		}
		return null;
	}

	async set(source: AiSourceId, value: string, remember: boolean): Promise<"vault" | "session"> {
		this.session.set(source, value);
		if (!remember) return "session";
		try {
			if (process.platform === "darwin") {
				await execFileAsync("security", [
					"add-generic-password",
					"-a",
					source,
					"-s",
					`${SERVICE_PREFIX}.${source}`,
					"-w",
					value,
					"-U",
				]);
				return "vault";
			}
			if (process.platform === "linux") {
				await new Promise<void>((resolve, reject) => {
					const child = execFile(
						"secret-tool",
						["store", "--label", `diffing ${source} API key`, "service", SERVICE_PREFIX, "source", source],
						(error) => (error ? reject(error) : resolve()),
					);
					child.stdin?.end(value);
				});
				return "vault";
			}
		} catch {
			// Keep the value in memory and disclose the session route via connection status.
		}
		return "session";
	}

	async delete(source: AiSourceId): Promise<void> {
		this.session.delete(source);
		try {
			if (process.platform === "darwin") {
				await execFileAsync("security", ["delete-generic-password", "-a", source, "-s", `${SERVICE_PREFIX}.${source}`]);
			} else if (process.platform === "linux") {
				await execFileAsync("secret-tool", ["clear", "service", SERVICE_PREFIX, "source", source]);
			}
		} catch {
			// Already absent or no supported vault.
		}
	}
}
