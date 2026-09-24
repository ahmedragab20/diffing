import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReviewCoreMcpServer } from "../src/mcp-review-core.js";
import { runReviewCoreCommand, reviewCommandFailure } from "../src/cli-review-core.js";
import { connectReview } from "../src/lib/review-connection.js";
import { createReviewCoreApi } from "../src/lib/review-core-api.js";
import { ReviewAuthority } from "../src/lib/review-authority.js";
import { ReviewCore } from "../src/lib/review-core.js";
import { captureInspection } from "../src/lib/inspect-capture.js";
import { AgentDiffIndexCache } from "../src/lib/agent-diff-index.js";
import { DEFAULTS } from "../src/lib/diff-options.js";
import { reviewOperations } from "../src/lib/review-operations.js";
import type { ReviewAcknowledgement, ReviewCommand, ReviewRequest } from "../src/lib/review-core-contract.js";

const execFileAsync = promisify(execFile);
const binary = process.env.DIFFING_SQLITE_TEST_BINARY ?? join(process.cwd(), "target/debug", process.platform === "win32" ? "diffing-tui.exe" : "diffing-tui");

async function runNative(connection: string, read: string) {
  return execFileAsync(binary, ["--review-connection", connection, "--review-read", read], { timeout: 120_000, maxBuffer: 512 * 1024 });
}

async function runCli(connection: string, operation: string, args: string[] = []) {
  const output: string[] = [];
  const original = console.log;
  console.log = (value: unknown) => { output.push(String(value)); };
  try {
    await runReviewCoreCommand([operation, "--connection", connection, ...args]);
    assert.equal(output.length, 1);
    return JSON.parse(output[0]);
  } finally { console.log = original; }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "diffing-native-qualification-"));
  const identity = { reviewId: randomUUID(), repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const authority = new ReviewAuthority();
  const human = authority.issue(identity, { id: "human", kind: "human" }, ["read", "capture", "comment", "handoff", "decide"]);
  const agent = authority.issue(identity, { id: "agent", kind: "agent" }, ["read", "capture", "comment", "work"]);
  const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
  const captured = await captureInspection({ ...DEFAULTS }, async () => ({ patch, complete: true }), async () => ({ repositoryId: identity.repositoryId, workspaceId: identity.workspaceId, head: null, indexDigest: "c".repeat(64), resolvedRevisions: [] }));
  const index = new AgentDiffIndexCache().getOrBuild(patch, true, undefined, captured.manifest);
  let captures = 0;
  const core = await ReviewCore.open(directory, identity, authority, { capture: async () => { captures++; return index; }, get: (id: string) => id === index.manifest!.snapshotId ? index : undefined }, { store: { binary } });
  const app = new Hono().route("/api/review-core", createReviewCoreApi(core));
  let server: ReturnType<typeof serve> | undefined;
  const port = await new Promise<number>((resolve) => { server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => resolve(info.port)); });
  const writeConnection = async (value: Record<string, unknown> = {}) => {
    const file = join(directory, `connection-${randomUUID()}.json`);
    const connection = { version: 1, origin: `http://127.0.0.1:${port}/`, identity, actor: { id: "agent", kind: "agent" }, credential: agent, headers: { "x-diffing-token": "d".repeat(64) }, expiresAt: Date.now() + 60_000, ...value };
    await writeFile(file, JSON.stringify(connection), { mode: 0o600 }); await chmod(file, 0o600); return file;
  };
  const close = async () => { if (server && "closeAllConnections" in server) server.closeAllConnections(); await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve())); await core.close(); await rm(directory, { recursive: true, force: true }); };
  return { directory, identity, human, agent, core, writeConnection, close, captures, get captureCount() { return captures; }, snapshotId: index.manifest!.snapshotId };
}

test("web client, CLI, MCP and native share read-only populated projections", { timeout: 150_000 }, async () => {
  const f = await fixture();
  try {
    // Exercise the shipped storage path on every OS; the journal prototype
    // requires directory fsync, which is not supported by Node on Windows.
    assert.equal((await readFile(join(f.directory, "review.sqlite"))).subarray(0, 16).toString(), "SQLite format 3\0");
    const connection = await f.writeConnection();
    const empty = JSON.parse((await runNative(connection, "state")).stdout);
    assert.equal(empty.version, 1);
    assert.equal(f.captureCount, 0);
    const captured = await f.core.execute(f.human, { ...f.identity, version: 1, requestId: "capture", expectedVersion: 1, snapshotId: null, command: { op: "capture" } });
    const comment = await f.core.execute(f.human, { ...f.identity, version: 1, requestId: "comment", expectedVersion: captured.sequence, snapshotId: captured.result.snapshotId, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "native" } });
    await f.core.execute(f.human, { ...f.identity, version: 1, requestId: "handoff", expectedVersion: comment.sequence, snapshotId: captured.result.snapshotId, command: { op: "handoff.create", recipient: "agent", instructions: "inspect", commentIds: [comment.result.id] } });
    const captureCount = f.captureCount;
    const nativeState = JSON.parse((await runNative(connection, "state")).stdout);
    const jsState = f.core.state(f.human);
    assert.deepEqual({ identity: nativeState.identity, version: nativeState.version, comments: nativeState.comments, handoffs: nativeState.handoffs }, { identity: jsState.identity, version: jsState.version, comments: jsState.comments, handoffs: jsState.handoffs });
    assert.equal(f.captureCount, captureCount);
    assert.deepEqual(nativeState, JSON.parse(JSON.stringify(jsState)));
    const { client: webClient } = await connectReview(connection);
    const mcpServer = createReviewCoreMcpServer({ connectionFile: connection, version: "qualification" });
    const mcpClient = new McpClient({ name: "shared-client-qualification", version: "1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await mcpServer.connect(serverTransport);
      await mcpClient.connect(clientTransport);
      const projections = [
        { cli: "state", mcp: "review_state", web: () => webClient.state(), expected: nativeState },
        { cli: "capabilities", mcp: "review_capabilities", web: () => webClient.capabilities(), expected: f.core.capabilities(f.agent) },
        { cli: "next-actions", mcp: "review_next_actions", web: () => webClient.nextActions(), expected: f.core.nextActions(f.agent) },
      ];
      for (const projection of projections) {
        const expected = JSON.parse(JSON.stringify(projection.expected));
        assert.deepEqual(JSON.parse((await runNative(connection, projection.cli)).stdout), expected, `native ${projection.cli}`);
        assert.deepEqual(await projection.web(), expected, `web client ${projection.cli}`);
        assert.deepEqual(await runCli(connection, projection.cli), expected, `CLI ${projection.cli}`);
        const result = await mcpClient.callTool({ name: projection.mcp, arguments: {} });
        assert.notEqual(result.isError, true, `MCP ${projection.cli}`);
        assert.deepEqual(result.structuredContent, { result: expected }, `MCP ${projection.cli}`);
      }
      assert.equal(f.captureCount, captureCount, "projection reads must not recollect source");
      assert.deepEqual(f.core.state(f.human), jsState, "projection reads must not mutate durable state");
    } finally {
      await mcpClient.close();
      await mcpServer.close();
    }
  } finally { await f.close(); }
});

test("native rejects secret-bearing credential changes and invalid connection modes", { timeout: 150_000 }, async () => {
  const f = await fixture();
  try {
    const connection = await f.writeConnection();
    const value = { credential: "z".repeat(43) };
    const altered = await f.writeConnection(value);
    await assert.rejects(runNative(altered, "state"), (error: any) => /unauthenticated/.test(error.stderr) && !error.stderr.includes(value.credential) && !error.stderr.includes("d".repeat(64)));
    const nonloopback = await f.writeConnection({ origin: "http://192.0.2.1:1234/" });
    await assert.rejects(runNative(nonloopback, "state"), (error: any) => /loopback|invalid_connection/.test(error.stderr));
    const insecure = await f.writeConnection({}); await chmod(insecure, 0o644);
    if (process.platform !== "win32") await assert.rejects(runNative(insecure, "state"), (error: any) => /insecure_connection/.test(error.stderr));
    else assert.equal(JSON.parse((await runNative(insecure, "state")).stdout).version, 1);
    const wrongReview = await f.writeConnection({ identity: { ...f.identity, reviewId: randomUUID() } });
    await assert.rejects(runNative(wrongReview, "state"), (error: any) => /wrong_review/.test(error.stderr));
    const expired = await f.writeConnection({ expiresAt: 1 });
    await assert.rejects(runNative(expired, "state"), (error: any) => /credential_expired/.test(error.stderr));
    const future = await f.writeConnection({ version: 2 });
    await assert.rejects(runNative(future, "state"), (error: any) => /unsupported_version/.test(error.stderr));
    assert.ok(connection);
  } finally { await f.close(); }
});

test("native binary is present and executable for qualification", async () => {
  try { await execFileAsync(binary, ["--help"], { timeout: 120_000 }); }
  catch (error) { throw new Error(`Native qualification binary unavailable at ${binary}; build with cargo build --locked -p diffing-tui before running this script. ${String(error)}`); }
});

// Each adapter leads once, so equality cannot pass solely through deduplication
// of effects first produced by a different adapter.
for (const primary of ["web", "cli", "mcp"] as const) {
  test(`shared mutations and exact retries with ${primary} leading`, { timeout: 150_000 }, async () => {
    const f = await fixture();
    const mcpClients: Array<{ client: McpClient; server: ReturnType<typeof createReviewCoreMcpServer> }> = [];
    try {
      const agentFile = await f.writeConnection();
      const humanFile = await f.writeConnection({ actor: { id: "human", kind: "human" }, credential: f.human });
      const { client: agentWeb } = await connectReview(agentFile);
      const { client: humanWeb } = await connectReview(humanFile);
      const server = createReviewCoreMcpServer({ connectionFile: agentFile, version: "qualification" });
      const client = new McpClient({ name: "mutation-qualification", version: "1" }, { capabilities: {} });
      mcpClients.push({ client, server });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(b); await client.connect(a);
      const inputFile = join(f.directory, "request.json");
      const cliExecute = async (connection: string, request: ReviewRequest): Promise<ReviewAcknowledgement> => {
        await writeFile(inputFile, JSON.stringify(request));
        return runCli(connection, "execute", ["--file", inputFile]);
      };
      const mcpExecute = async (request: ReviewRequest): Promise<ReviewAcknowledgement> => {
        const result = await client.callTool({ name: "review_execute", arguments: request });
        assert.notEqual(result.isError, true, `MCP ${request.command.op}`);
        return (result.structuredContent as { result: ReviewAcknowledgement }).result;
      };
      const agentAdapters = { web: (request: ReviewRequest) => agentWeb.execute(request), cli: (request: ReviewRequest) => cliExecute(agentFile, request), mcp: mcpExecute };
      const agentOrder = [primary, ...(["web", "cli", "mcp"] as const).filter(name => name !== primary)];
      const humanAdapters = primary === "cli"
        ? [(request: ReviewRequest) => cliExecute(humanFile, request), (request: ReviewRequest) => humanWeb.execute(request)]
        : [(request: ReviewRequest) => humanWeb.execute(request), (request: ReviewRequest) => cliExecute(humanFile, request)];
      const covered = new Set<ReviewCommand["op"]>();
      let serial = 0;
      const envelope = (command: ReviewCommand): ReviewRequest => ({ ...f.identity, version: 1, requestId: `step-${++serial}`, expectedVersion: f.core.state(f.agent).version, snapshotId: command.op === "capture" ? null : f.snapshotId, command });
      const execute = async (actor: "agent" | "human", command: ReviewCommand) => {
        const request = envelope(command);
        const adapters = actor === "agent" ? agentOrder.map(name => agentAdapters[name]) : humanAdapters;
        const first = await adapters[0](request);
        assert.equal(first.sequence, request.expectedVersion + 1, command.op);
        assert.equal(first.result.operation, command.op);
        assert.deepEqual(first.result.actor, { id: actor, kind: actor });
        const state = f.core.state(f.agent);
        const captures = f.captureCount;
        for (const adapter of [...adapters.slice(1), adapters[0]]) {
          assert.deepEqual(await adapter(request), first, `${command.op} exact retry`);
          assert.deepEqual(f.core.state(f.agent), state, `${command.op} commits only once`);
          assert.equal(f.captureCount, captures, `${command.op} retry does not recollect source`);
        }
        covered.add(command.op);
        return first;
      };
      const rejectAgent = async (command: ReviewCommand, code: string) => {
        const request = envelope(command);
        const before = f.core.state(f.agent);
        let expected: ReturnType<typeof reviewCommandFailure> | undefined;
        for (const adapter of [agentAdapters.web, agentAdapters.cli]) {
          try { await adapter(request); assert.fail("operation unexpectedly succeeded"); }
          catch (error) {
            const failure = reviewCommandFailure(error);
            assert.equal(failure.code, code);
            if (expected) assert.deepEqual(failure, expected); else expected = failure;
          }
        }
        const result = await client.callTool({ name: "review_execute", arguments: request });
        assert.equal(result.isError, true);
        assert.deepEqual(result.structuredContent, { result: expected });
        assert.deepEqual(f.core.state(f.agent), before, "rejected operations leave state unchanged");
      };
      const handoff = (id: string) => {
        const value = f.core.state(f.agent).handoffs.find(value => value.id === id);
        assert.ok(value); return value;
      };
      const claim = (id: string) => {
        const value = handoff(id); assert.ok(value.claim);
        return { handoffId: id, claimId: value.claim.id, epoch: value.epoch };
      };
      const send = async (commentId: string) => (await execute("human", { op: "handoff.create", recipient: "agent", instructions: "Inspect the retained concern", commentIds: [commentId] })).result.id!;

      await execute("agent", { op: "capture" });
      const ownComment = (await execute("agent", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "agent observation" })).result.id!;
      await execute("agent", { op: "comment.reply", commentId: ownComment, body: "initial reply" });
      const ownReply = f.core.state(f.agent).comments.find(comment => comment.id === ownComment)!.replies[0].id;
      assert.equal(f.core.state(f.agent).comments[0].replies[0].body, "initial reply");
      await execute("agent", { op: "reply.edit", commentId: ownComment, replyId: ownReply, body: "revised reply" });
      assert.equal(f.core.state(f.agent).comments[0].replies[0].body, "revised reply");
      await execute("agent", { op: "reply.delete", commentId: ownComment, replyId: ownReply });
      assert.equal(f.core.state(f.agent).comments[0].replies.length, 0);
      await execute("agent", { op: "comment.edit", commentId: ownComment, body: "revised observation" });
      assert.equal(f.core.state(f.agent).comments[0].body, "revised observation");
      assert.equal(f.core.state(f.agent).comments[0].lineContent, "new");
      await execute("agent", { op: "view.mark", fileIndex: 0, viewed: true });
      assert.equal(f.core.state(f.agent).viewed.length, 1);
      assert.equal(f.core.state(f.agent).viewed[0].anchor.snapshotId, f.snapshotId);
      assert.deepEqual(f.core.state(f.agent).viewed[0].actor, { id: "agent", kind: "agent" });
      await execute("agent", { op: "view.mark", fileIndex: 0, viewed: false });
      await execute("human", { op: "comment.resolve", commentId: ownComment, reason: "human reviewed agent thread" });
      await rejectAgent({ op: "comment.delete", commentId: ownComment }, "forbidden");
      await execute("human", { op: "comment.reopen", commentId: ownComment, reason: "human requested more verification" });
      await rejectAgent({ op: "comment.delete", commentId: ownComment }, "forbidden");
      await execute("human", { op: "comment.delete", commentId: ownComment });
      const removable = (await execute("agent", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "own untouched thread" })).result.id!;
      await execute("agent", { op: "comment.delete", commentId: removable });
      assert.equal(f.core.state(f.agent).comments.length, 0);
      assert.equal(f.core.state(f.agent).viewed.length, 0);

      const concern = (await execute("human", { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "human concern" })).result.id!;
      await execute("human", { op: "comment.resolve", commentId: concern, reason: "checked" });
      assert.equal(f.core.state(f.agent).comments[0].status, "resolved");
      const resolution = f.core.state(f.agent).comments[0].resolution;
      assert.ok(resolution && typeof resolution === "object" && "reason" in resolution);
      assert.equal(resolution.reason, "checked");
      await execute("human", { op: "comment.reopen", commentId: concern, reason: "verify again" });
      assert.equal(f.core.state(f.agent).comments[0].status, "open");
      const reopened = f.core.state(f.agent).comments[0].reopened;
      assert.ok(reopened && typeof reopened === "object" && "reason" in reopened);
      assert.equal(reopened.reason, "verify again");
      await rejectAgent({ op: "comment.delete", commentId: concern }, "forbidden");
      const successful = await send(concern);
      await execute("agent", { op: "handoff.claim", handoffId: successful });
      await execute("agent", { op: "handoff.start", ...claim(successful) });
      await execute("agent", { op: "handoff.result", ...claim(successful), resultSnapshotId: f.snapshotId, body: "verified result" });
      assert.equal(handoff(successful).status, "awaiting-human");
      assert.equal(handoff(successful).result?.body, "verified result");
      assert.equal(f.core.state(f.agent).decisions.length, 0);
      await execute("human", { op: "decision.record", handoffId: successful, decision: "approved", rationale: "human verified" });
      assert.equal(handoff(successful).status, "reviewed");
      assert.deepEqual(f.core.state(f.agent).decisions[0].actor, { id: "human", kind: "human" });

      const cancelled = await send(concern);
      await execute("agent", { op: "handoff.claim", handoffId: cancelled });
      await execute("agent", { op: "handoff.start", ...claim(cancelled) });
      await execute("human", { op: "handoff.cancel", handoffId: cancelled, reason: "stop" });
      await rejectAgent({ op: "handoff.result", ...claim(cancelled), resultSnapshotId: f.snapshotId, body: "late result" }, "invalid_transition");
      await execute("agent", { op: "handoff.cancel-confirm", ...claim(cancelled) });
      assert.equal(handoff(cancelled).status, "cancelled");

      const retried = await send(concern);
      await execute("agent", { op: "handoff.claim", handoffId: retried });
      const staleClaim = claim(retried);
      await execute("agent", { op: "handoff.fail", ...staleClaim, outcome: "outcome-unknown", reason: "connection lost" });
      assert.equal(handoff(retried).status, "outcome-unknown");
      await execute("human", { op: "handoff.reclaim", handoffId: retried, recipient: "agent", reason: "explicit retry" });
      await rejectAgent({ op: "handoff.start", ...staleClaim }, "claim_conflict");
      await execute("agent", { op: "handoff.claim", handoffId: retried });
      await execute("agent", { op: "handoff.fail", ...claim(retried), outcome: "failed", reason: "check failed" });
      assert.equal(handoff(retried).status, "failed");
      await execute("human", { op: "handoff.reclaim", handoffId: retried, recipient: "agent", reason: "last retry" });
      await execute("human", { op: "handoff.expire", handoffId: retried, reason: "deadline reached" });
      assert.equal(handoff(retried).status, "expired");
      assert.deepEqual([...covered].sort(), Object.keys(reviewOperations).sort(), "every advertised command has shared-adapter proof");

      const readVersion = f.core.state(f.agent).version;
      const capturesBeforeReads = f.captureCount;
      const readMcp = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true, name);
        return (result.structuredContent as { result: unknown }).result;
      };
      const sent = await agentWeb.handoff(successful);
      assert.equal(sent.sent.handoff.status, "available");
      assert.equal(sent.handoff.status, "reviewed");
      assert.equal(sent.sent.comments[0].body, "human concern");
      assert.deepEqual(await runCli(agentFile, "handoff", [successful]), sent);
      assert.deepEqual(await readMcp("review_handoff", { id: successful }), sent);
      for (const fileIndex of [undefined, 0]) {
        const entries = [];
        for (let offset = 0;;) {
          const query = { snapshotId: f.snapshotId, ...(fileIndex === undefined ? {} : { fileIndex }), offset, limit: 1 };
          const page = await agentWeb.source(query);
          await writeFile(inputFile, JSON.stringify(query));
          assert.deepEqual(await runCli(agentFile, "source", ["--file", inputFile]), page);
          assert.deepEqual(await readMcp("review_source", query), page);
          entries.push(...page.entries);
          if (page.next === null) break;
          assert.ok(page.next > offset); offset = page.next;
        }
        assert.deepEqual(entries.map(entry => entry.index), fileIndex === undefined ? [0] : [0, 1, 2, 3]);
      }
      const sequences = [];
      for (let after = 0;;) {
        const cursor = { ...f.identity, after };
        const page = await agentWeb.events(cursor, 3);
        assert.deepEqual(await runCli(agentFile, "events", ["--after", String(after), "--limit", "3"]), page);
        assert.deepEqual(await readMcp("review_events", { ...cursor, limit: 3 }), page);
        sequences.push(...page.records.map(record => record.sequence));
        if (page.next === null) break;
        assert.ok(page.next > after); after = page.next;
      }
      assert.deepEqual(sequences, Array.from({ length: readVersion }, (_, i) => i + 1));
      assert.deepEqual(JSON.parse((await runNative(agentFile, "state")).stdout), await agentWeb.state());
      assert.equal(f.core.state(f.agent).version, readVersion);
      assert.equal(f.captureCount, capturesBeforeReads, "shared source and event reads do not recollect");
    } finally {
      for (const { client, server } of mcpClients) { await client.close(); await server.close(); }
      await f.close();
    }
  });
}
