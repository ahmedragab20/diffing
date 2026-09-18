import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../server.js";
import { DEFAULTS } from "./diff-options.js";
import { getProjectStorageDir, getRepoRoot } from "./git.js";
import { readInspectionIdentity } from "./inspect-capture.js";
import { hasReviewAuthority } from "./legacy-write-lease.js";
import { ReviewAuthority, type ReviewIdentity } from "./review-authority.js";
import { openMigratedWorkspaceReview } from "./review-migration.js";
import { acquireServerStartupLease, isLockProcessAlive, listRegisteredServerLocks } from "./server-lock.js";
import { generateSessionToken, SESSION_TOKEN_HEADER } from "./server-auth.js";

const credentialLifetime = 24 * 60 * 60_000;

/** Explicit local trusted bootstrap. Connection files are separate capabilities:
 * give integrations only agent.json. No HTTP operation can mint a human grant.
 * This does not restrict a process with independent access to the user's shell.
 */
export async function startDurableReview(options: { adopt?: boolean; port?: number } = {}) {
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw new Error("Port must be between 1 and 65535.");
  const repoRoot = getRepoRoot();
  const directory = getProjectStorageDir(repoRoot);
  if (!options.adopt && !await hasReviewAuthority(directory)) throw new Error("First adoption requires --adopt. Stop older diffing processes before adopting this workspace.");
  // Keep the launcher lease for this headless session's lifetime. Classic
  // launchers cannot publish another session while the core is authoritative.
  const lease = acquireServerStartupLease(repoRoot, randomUUID());
  if (!lease) throw new Error("Another diffing session is starting or owns this workspace.");
  const authority = new ReviewAuthority();
  const credentials: string[] = [];
  let connectionDirectory: string | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    for (const credential of credentials) authority.revoke(credential);
    try { await server?.close?.(); }
    finally {
      try { if (connectionDirectory) await rm(connectionDirectory, { recursive: true, force: true }); }
      finally { lease.release(); }
    }
  })();
  try {
    if (listRegisteredServerLocks(repoRoot).some(isLockProcessAlive)) throw new Error("Stop existing diffing sessions before opening the durable review.");
    const diffOpts = { ...DEFAULTS };
    const { repositoryId, workspaceId } = await readInspectionIdentity(repoRoot, diffOpts);
    const workspace = { repositoryId, workspaceId };
    const sessionToken = generateSessionToken();
    let identity: ReviewIdentity | undefined;
    let human = "";
    const expiresAt = Date.now() + credentialLifetime;
    server = await startServer({
      port: options.port ?? 0, host: "127.0.0.1", clientDir: "", diffOpts,
      headlessReview: true,
      security: { bindHost: "127.0.0.1", authToken: sessionToken },
      reviewCore: (sources) => openMigratedWorkspaceReview(directory, workspace, authority, sources, (opened) => {
        identity = opened;
        human = authority.issue(opened, { id: "local-human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"], credentialLifetime);
        credentials.push(human);
        return human;
      }),
    });
    if (!identity) throw new Error("Review initialization did not provide an identity.");
    const agent = authority.issue(identity, { id: "external-agent", kind: "agent" }, ["read", "capture", "comment", "work"], credentialLifetime);
    credentials.push(agent);
    const origin = `http://127.0.0.1:${server.port}`;
    connectionDirectory = await mkdtemp(join(directory, "review-connection-"));
    await chmod(connectionDirectory, 0o700);
    const humanConnectionFile = join(connectionDirectory, "human.json");
    const agentConnectionFile = join(connectionDirectory, "agent.json");
    const connection = (credential: string, actor: { id: string; kind: "human" | "agent" }) => JSON.stringify({ version: 1, origin, identity, actor, credential, headers: { [SESSION_TOKEN_HEADER]: sessionToken }, expiresAt }) + "\n";
    // Exclusive creation inside a newly created private directory. Never put
    // credentials in registry entries, URLs, log output or repository files.
    await writeFile(humanConnectionFile, connection(human, { id: "local-human", kind: "human" }), { flag: "wx", mode: 0o600 });
    await writeFile(agentConnectionFile, connection(agent, { id: "external-agent", kind: "agent" }), { flag: "wx", mode: 0o600 });
    return { origin, identity, humanConnectionFile, agentConnectionFile, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Review launch and cleanup failed."); }
    throw error;
  }
}
