import { open } from "node:fs/promises";
import { ReviewClient, ReviewClientError } from "./review-client.js";
import { parseReviewConnection } from "./review-connection-contract.js";

/** Explicit local connection only. No scanning homes or guessing another
 * session's authority when the selected connection is unavailable. */
export async function connectReview(file: string, options: { agentOnly?: boolean; fetch?: typeof fetch } = {}) {
  const handle = await open(file, "r");
  let data: unknown;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16 * 1024) throw new ReviewClientError("invalid_connection", "reconnect");
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new ReviewClientError("insecure_connection", "reconnect");
    const buffer = Buffer.alloc(16 * 1024 + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > 16 * 1024) throw new ReviewClientError("invalid_connection", "reconnect");
    try { data = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")); } catch { throw new ReviewClientError("invalid_connection", "reconnect"); }
  } finally { await handle.close(); }
  const connection = parseReviewConnection(data);
  if (options.agentOnly && connection.actor.kind !== "agent") throw new ReviewClientError("forbidden", "request_permission");
  const client = new ReviewClient({ ...connection, fetch: options.fetch });
  // Server-issued identity is authoritative, not the actor field on disk.
  const capabilities = await client.capabilities();
  if (options.agentOnly && capabilities.actor.kind !== "agent") throw new ReviewClientError("forbidden", "request_permission");
  return { client, capabilities, connection };
}
