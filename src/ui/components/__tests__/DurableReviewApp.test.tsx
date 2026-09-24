// @vitest-environment jsdom
import { cleanup as rtlCleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: undefined as any,
  prepare: vi.fn((state: any, command: any, options: any = {}) => ({ ...state.identity, version: 1, requestId: crypto.randomUUID(), expectedVersion: state.version, snapshotId: command.op === "capture" ? null : options.snapshotId ?? state.currentSnapshotId, command })),
}));

vi.mock("../../../lib/review-client", () => ({
  ReviewClient: vi.fn(function () { return mocks.client; }),
  ReviewClientError: class ReviewClientError extends Error { constructor(readonly code: string, readonly recovery?: string) { super(code); } },
  prepareReviewRequest: mocks.prepare,
}));

import { DurableReviewApp } from "../DurableReviewApp";

const identity = { reviewId: "11111111-1111-4111-8111-111111111111", repositoryId: "a".repeat(64), workspaceId: "b".repeat(64) };
const snapshot1 = "22222222-2222-4222-8222-222222222222";
const snapshot2 = "33333333-3333-4333-8333-333333333333";
const token = "a".repeat(43);

const capabilities = (kind: "human" | "agent") => ({ protocolVersion: 1, identity, actor: { id: kind, kind }, permissions: kind === "human" ? ["read", "capture", "comment", "handoff", "decide"] : ["read", "capture", "comment", "work"], operations: ["capture", "comment.add", "comment.reply", ...(kind === "human" ? ["decision.record"] : [])].map((name) => ({ name, permission: name === "capture" ? "capture" : name === "decision.record" ? "decide" : "comment", snapshot: name !== "capture", idempotency: "request-id-and-payload" })), batch: { mode: "per-item", limit: 25, order: "sequential", onError: "continue" } });

const stateFor = (snapshotId: string | null = null) => ({ identity, version: snapshotId ? 2 : 1, currentSnapshotId: snapshotId, snapshots: [], comments: [], commentFreshness: [], viewed: [], decisions: [], decisionFreshness: [], handoffs: [], migrationPending: false });
const filesFor = (snapshotId: string) => ({ identity, snapshotId, fileIndex: null, offset: 0, next: null, total: 1, complete: true, freshness: "not-checked", entries: [{ index: 0, file: { index: 0, path: "src/a.ts", oldPath: "src/a.ts", newPath: "src/a.ts", kind: "modified", binary: false, rows: 3, additions: 1, deletions: 1 } }] });
const rowsFor = (snapshotId: string) => ({ identity, snapshotId, fileIndex: 0, offset: 0, next: null, total: 3, complete: true, freshness: "not-checked", entries: [{ index: 0, row: { type: "fileHeader", fileIndex: 0, path: "src/a.ts", kind: "modified", binary: false } }, { index: 1, row: { type: "hunkHeader", hunkIndex: 0, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, heading: "" } }, { index: 2, row: { type: "line", hunkIndex: 0, kind: "add", oldLineno: null, newLineno: 1, content: "new" } }] });

function connectionFile(kind: "human" | "agent") {
  return new File([JSON.stringify({ version: 1, origin: window.location.origin + "/", identity, actor: { id: kind, kind }, credential: token, headers: { "x-diffing-token": "c".repeat(64) }, expiresAt: Date.now() + 60_000 })], "connection.json", { type: "application/json" });
}

function setup(kind: "human" | "agent" = "human") {
  const current = { value: stateFor(snapshot1) as any };
  const client = { capabilities: vi.fn().mockResolvedValue(capabilities(kind)), state: vi.fn().mockImplementation(() => Promise.resolve(current.value)), source: vi.fn().mockImplementation(({ fileIndex, snapshotId }: any) => Promise.resolve(fileIndex === undefined ? filesFor(snapshotId) : rowsFor(snapshotId))), execute: vi.fn().mockResolvedValue({ version: 1, sequence: 3, result: { identity, snapshotId: snapshot1, actor: { id: kind, kind }, operation: "comment.add", id: "comment-1", sequence: 3 } }) };
  mocks.client = client;
  const view = render(<DurableReviewApp />);
  return { ...client, current, view };
}

async function connect(kind: "human" | "agent" = "human") {
  const f = setup(kind);
  const input = screen.getByLabelText("Connection file");
  await userEvent.setup().upload(input, connectionFile(kind));
  await screen.findByText(new RegExp(`Connected as ${kind}`));
  return f;
}

afterEach(() => { rtlCleanup(); vi.restoreAllMocks(); mocks.client = undefined; });

describe("DurableReviewApp", () => {
  it("shows decisions only for a human connection", async () => {
    await connect("human");
    expect(screen.getByText("Your decision")).toBeInTheDocument();
    screen.getByRole("button", { name: "Disconnect" }).click();
    rtlCleanup();
    await connect("agent");
    expect(screen.queryByText("Your decision")).not.toBeInTheDocument();
  });

  it("binds a selected source line comment to the displayed snapshot", async () => {
    const f = await connect();
    await userEvent.setup().click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Comment on new line 1" }));
    await userEvent.setup().type(screen.getByLabelText("Comment on line 1"), "review this");
    await userEvent.setup().click(screen.getByRole("button", { name: "Comment on line 1" }));
    await waitFor(() => expect(f.execute).toHaveBeenCalled());
    expect(f.execute.mock.calls[0][0]).toMatchObject({ snapshotId: snapshot1, command: { op: "comment.add", fileIndex: 0, side: "additions", lineNumber: 1, body: "review this" } });
  });

  it("keeps the exact request for a lost response and retries without a new id", async () => {
    const f = await connect();
    await userEvent.setup().click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Comment on new line 1" }));
    await userEvent.setup().type(screen.getByLabelText("Comment on line 1"), "retry me");
    const lost = new (await import("../../../lib/review-client")).ReviewClientError("outcome_unknown", "retry_same_request");
    f.execute.mockRejectedValueOnce(lost).mockResolvedValueOnce({});
    await userEvent.setup().click(screen.getByRole("button", { name: "Comment on line 1" }));
    expect(await screen.findByText(/response was lost/)).toBeInTheDocument();
    const first = f.execute.mock.calls[0][0];
    await userEvent.setup().click(screen.getByRole("button", { name: "Reconnect" }));
    await userEvent.setup().upload(screen.getByLabelText("Connection file"), connectionFile("human"));
    await screen.findByText(/Connected as human/);
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry saved request" }));
    await waitFor(() => expect(f.execute).toHaveBeenCalledTimes(2));
    expect(f.execute.mock.calls[1][0]).toEqual(first);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry saved request" })).not.toBeInTheDocument());
  });

  it("clears submitted form and reports recorded when acknowledgement succeeds but reload fails", async () => {
    const f = await connect();
    f.state.mockRejectedValueOnce(new Error("reload failed"));
    await userEvent.setup().click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Comment on new line 1" }));
    const textarea = screen.getByLabelText("Comment on line 1");
    await userEvent.setup().type(textarea, "recorded");
    await userEvent.setup().click(screen.getByRole("button", { name: "Comment on line 1" }));
    expect(await screen.findByText(/Your action was recorded, but the review could not reload/)).toBeInTheDocument();
    expect(textarea).toHaveValue("");
  });

  it("invalidates selected rows when reload observes a new snapshot", async () => {
    const f = await connect();
    await userEvent.setup().click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    expect(await screen.findByText("Captured changes")).toBeInTheDocument();
    f.current.value = stateFor(snapshot2);
    f.source.mockImplementation(({ fileIndex, snapshotId }: any) => Promise.resolve(fileIndex === undefined ? filesFor(snapshotId) : rowsFor(snapshotId)));
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload review" }));
    await waitFor(() => expect(screen.queryByText("Captured changes")).not.toBeInTheDocument());
    expect(screen.getByText("Select a file to review its captured changes.")).toBeInTheDocument();
  });
});
