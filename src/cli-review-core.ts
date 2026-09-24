import { parseArgs } from "node:util";
import { startDurableReview } from "./lib/review-launch.js";
import { open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectReview } from "./lib/review-connection.js";
import { ReviewClientError } from "./lib/review-client.js";
import { reviewRequestSchema } from "./lib/review-core-contract.js";
import { reviewBatchRequestSchema, reviewRecovery } from "./lib/review-operations.js";
import { reviewSourceQuerySchema } from "./lib/review-source-contract.js";

export async function readReviewInput(file: string): Promise<unknown> {
  const limit = 256 * 1024;
  let text: string;
  if (file === "-") {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limit) throw new ReviewClientError("request_too_large", "fix_request");
      chunks.push(buffer);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(limit + 1);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > limit) throw new ReviewClientError("request_too_large", "fix_request");
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null);
        if (!chunk.bytesRead) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > limit) throw new ReviewClientError("request_too_large", "fix_request");
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally { await handle.close(); }
  }
  try { return JSON.parse(text); } catch { throw new ReviewClientError("invalid_request", "fix_request"); }
}

export async function runReviewCoreCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    adopt: { type: "boolean" }, port: { type: "string" }, help: { type: "boolean", short: "h" }, ui: { type: "boolean" },
    connection: { type: "string" }, file: { type: "string" }, after: { type: "string" }, limit: { type: "string" },
  } });
  if (values.help) {
    console.log(`Usage: diffing review-core serve [--adopt] [--port <number>] [--ui]
       diffing review-core <state|capabilities|next-actions> --connection <file>
       diffing review-core events --connection <file> [--after N] [--limit N]
       diffing review-core handoff <id> --connection <file>
       diffing review-core <execute|batch|source> --connection <file> --file <json|->

DIFFING_REVIEW_CONNECTION can select the connection file. execute and batch
accept full versioned request envelopes. Keep the envelope and retry it exactly
after outcome_unknown; never generate a new request ID for an uncertain write.

Start an experimental, loopback-only durable review API in this worktree.
First adoption requires --adopt and stopped classic/older diffing sessions.
Original comments, plans and viewed files are archived without rewriting them;
classic writers remain fenced after shutdown. --ui serves the review workspace;
open /review-core and select a connection file to use its granted permissions.

Outputs paths to separate private human and agent connection files. Give an
integration only the agent file. Credentials expire after 24 hours or shutdown;
restart reconnects to the same durable review with new credentials.
Ctrl-C stops the server and removes its connection files.`);
    return;
  }
  if (positionals[0] !== "serve") {
    const file = values.connection ?? process.env.DIFFING_REVIEW_CONNECTION;
    if (!file) throw new ReviewClientError("connection_required", "reconnect");
    const { client, capabilities } = await connectReview(file);
    const [operation, id, ...extra] = positionals;
    if (extra.length || (operation !== "handoff" && id)) throw new ReviewClientError("invalid_request", "fix_request");
    let result: unknown;
    switch (operation) {
      case "state": result = await client.state(); break;
      case "capabilities": result = capabilities; break;
      case "next-actions": result = await client.nextActions(); break;
      case "handoff":
        if (!id) throw new ReviewClientError("invalid_request", "fix_request");
        result = await client.handoff(id); break;
      case "events": {
        const after = values.after ?? "0", limit = values.limit ?? "100";
        if (!/^\d+$/.test(after) || !/^\d+$/.test(limit)) throw new ReviewClientError("invalid_request", "fix_request");
        result = await client.events({ ...capabilities.identity, after: Number(after) }, Number(limit)); break;
      }
      case "execute":
      case "source":
      case "batch": {
        if (!values.file) throw new ReviewClientError("invalid_request", "fix_request");
        const input = await readReviewInput(values.file);
        if (operation === "execute") {
          const parsed = reviewRequestSchema.safeParse(input);
          if (!parsed.success) throw new ReviewClientError("invalid_request", "fix_request");
          result = await client.execute(parsed.data);
        } else if (operation === "batch") {
          const parsed = reviewBatchRequestSchema.safeParse(input);
          if (!parsed.success) throw new ReviewClientError("invalid_request", "fix_request");
          result = await client.batch(parsed.data);
        } else {
          const parsed = reviewSourceQuerySchema.safeParse(input);
          if (!parsed.success) throw new ReviewClientError("invalid_request", "fix_request");
          result = await client.source(parsed.data);
        }
        break;
      }
      default: throw new ReviewClientError("unknown_operation", "upgrade_client");
    }
    console.log(JSON.stringify(result));
    return;
  }
  if (positionals.length !== 1 || positionals[0] !== "serve") throw new Error("Usage: diffing review-core serve [--adopt] [--port <number>]");
  if (values.port !== undefined && !/^\d+$/.test(values.port)) throw new Error("--port must be an integer between 1 and 65535.");
  const directory = dirname(fileURLToPath(import.meta.url));
  const clientDir = existsSync(resolve(directory, "client")) ? resolve(directory, "client") : resolve(directory, "../dist/client");
  const launched = await startDurableReview({ adopt: values.adopt, port: values.port === undefined ? undefined : Number(values.port), ...(values.ui ? { clientDir } : {}) });
  const { close, ...connectionPaths } = launched;
  await new Promise<void>((resolve, reject) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      close().then(resolve, reject);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    console.log(JSON.stringify(connectionPaths));
  });
}

export function reviewCommandFailure(error: unknown) {
  return error instanceof ReviewClientError
    ? { code: error.code, recovery: error.recovery ?? reviewRecovery(error.code), ...(error.sequence === undefined ? {} : { sequence: error.sequence }) }
    : { code: "connection_failed", recovery: "reconnect" };
}

/** Legacy writes cannot safely invent version, snapshot or idempotency fields. */
export async function runDurableAlias(name: string, args: string[], connectionFile: string): Promise<number> {
  try {
    const { client, connection } = await connectReview(connectionFile);
    if (name === "comments") {
      if (args.some((arg) => !["--open", "--format", "json"].includes(arg)) || (args.includes("--format") && args[args.indexOf("--format") + 1] !== "json")) {
        console.error(JSON.stringify({ code: "review_core_required", recovery: "use_review_core_operations", command: "diffing review-core state", message: "Durable comments use JSON with source anchors and actor provenance." }));
        return 1;
      }
      const comments = (await client.state()).comments.filter((comment) => !args.includes("--open") || comment.status === "open");
      console.log(JSON.stringify({ comments }));
      return 0;
    }
    if (name === "url" && !args.length) { console.log(new URL("/review-core", connection.origin).href); return 0; }
    console.error(JSON.stringify({ code: "review_core_required", recovery: "use_review_core_operations", command: "diffing review-core --help", message: "Use review-core state/source/events/handoff for reads, or execute with a full versioned request envelope. Classic plans and mockups are retained as unverified archives; this connection cannot edit them." }));
    return 1;
  } catch (error) { console.error(JSON.stringify(reviewCommandFailure(error))); return 1; }
}
