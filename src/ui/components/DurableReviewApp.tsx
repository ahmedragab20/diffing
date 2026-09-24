import { useEffect, useRef, useState, type FormEvent } from "react";
import { ReviewClient, ReviewClientError, prepareReviewRequest } from "../../lib/review-client";
import { parseReviewConnection } from "../../lib/review-connection-contract";
import type { ReviewCommand, ReviewRequest, ReviewState } from "../../lib/review-core-contract";
import type { ReviewCapabilities } from "../../lib/review-operations";
import { reviewSourcePageSchema } from "../../lib/review-source-contract";
import type { z } from "zod";
import { BrandMark } from "./BrandMark";
import "../styles/durable-review.css";

type SourcePage = z.infer<typeof reviewSourcePageSchema>;
function NoteForm({ label, disabled, submit }: { label: string; disabled: boolean; submit: (body: string) => Promise<void>; }) {
  const [body, setBody] = useState("");
  const send = async (event: FormEvent) => { event.preventDefault(); await submit(body); setBody(""); };
  return <form onSubmit={(event) => { void send(event).catch(() => { }); }} className="durable-note">
    <label>{label}<textarea required maxLength={65536} value={body} onChange={(event) => setBody(event.target.value)} disabled={disabled} />
    </label>
    <button disabled={disabled || !body.trim()}>{label}</button>
  </form>;
}

export function DurableReviewApp() {
  const [client, setClient] = useState<ReviewClient>();
  const [capabilities, setCapabilities] = useState<ReviewCapabilities>();
  const [state, setState] = useState<ReviewState>();
  const [files, setFiles] = useState<SourcePage>();
  const [rows, setRows] = useState<SourcePage>();
  const [selected, setSelected] = useState<number>();
  const [line, setLine] = useState<{ side: "additions" | "deletions"; lineNumber: number; }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReviewRequest>();
  const sourceRead = useRef(0);
  const stateRead = useRef(0);
  const currentSnapshot = useRef<string | null>(null);
  const currentState = useRef<ReviewState | undefined>(undefined);
  const writing = useRef(false);
  const pendingActor = useRef<ReviewCapabilities["actor"] | undefined>(undefined);
  const pendingForm = useRef<{ resolve: () => void; reject: (error: unknown) => void } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sourceRead.current++; stateRead.current++; pendingForm.current?.reject(new Error("Review closed")); }; }, []);
  const allowed = new Set(capabilities?.operations.map((operation) => operation.name));
  const blocked = busy || !!pending;
  const report = (failure: unknown) => {
    const code = failure instanceof ReviewClientError ? failure.code : "connection_failed";
    const messages: Record<string, string> = {
      wrong_review: "Reconnect to the same review and actor to reconcile the saved request.",
      forbidden: "This connection does not have permission for that action.",
      version_conflict: "The review changed. Reload it before trying again.",
      stale_snapshot: "The source changed. Capture the latest changes before continuing.",
      snapshot_expired: "This source preview expired. Capture the latest changes to continue.",
      incomplete_capture: "Some source material is unavailable. This review cannot be approved yet.",
      outcome_unknown: "The response was lost. Retry the saved request to discover whether it was recorded.",
      credential_expired: "Your connection expired. Reconnect using the new connection file.",
      unauthenticated: "This connection is no longer active. Reconnect using the current connection file.",
    };
    setError(messages[code] ?? "The action could not be completed. Reload the review or reconnect.");
  };
  const readFiles = async (connected: ReviewClient, snapshotId: string, offset = 0) => {
    const page = await connected.source({ snapshotId, offset, limit: 100 });
    if (mounted.current && currentSnapshot.current === snapshotId) setFiles(page);
  };
  const reload = async (connected = client) => {
    if (!connected) return;
    const read = ++stateRead.current;
    const current = await connected.state();
    if (!mounted.current || read !== stateRead.current) return;
    if (currentSnapshot.current !== current.currentSnapshotId) {
      sourceRead.current++;
      setRows(undefined); setSelected(undefined); setLine(undefined); setFiles(undefined);
    }
    currentSnapshot.current = current.currentSnapshotId;
    currentState.current = current;
    setState(current);
    if (current.currentSnapshotId) await readFiles(connected, current.currentSnapshotId);
  };
  const execute = async (command: ReviewCommand, retry?: ReviewRequest) => {
    if (!client || !state || writing.current || (pending && !retry)) throw new Error("Review is busy");
    const handoff = "handoffId" in command && command.op !== "decision.record"
      ? state.handoffs.find((item) => item.id === command.handoffId) : undefined;
    const request = retry ?? prepareReviewRequest(state, command,
      command.op === "comment.add" || command.op === "view.mark"
        ? { snapshotId: rows?.snapshotId ?? null }
        : handoff ? { snapshotId: handoff.snapshotId } : {});
    if (!retry) pendingActor.current = capabilities?.actor;
    writing.current = true;
    stateRead.current++;
    setBusy(true); setError(""); setPending(request);
    try {
      await client.execute(request);
      setPending(undefined);
      pendingForm.current?.resolve();
      pendingForm.current = undefined;
      pendingActor.current = undefined;
    } catch (failure) {
      const uncertain = failure instanceof ReviewClientError && (failure.code === "outcome_unknown" || (!!retry && ["unauthenticated", "credential_expired", "unsupported_version"].includes(failure.code)));
      if (!uncertain) { setPending(undefined); pendingActor.current = undefined; }
      report(failure);
      if (failure instanceof ReviewClientError && failure.code === "outcome_unknown" && !retry) {
        // Keep the originating form attached to the saved request. Its draft
        // clears only when the exact retry is acknowledged, preventing a new ID.
        return new Promise<void>((resolve, reject) => { pendingForm.current = { resolve, reject }; });
      }
      if (!uncertain) {
        pendingForm.current?.reject(failure); pendingForm.current = undefined;
      }
      throw failure;
    } finally { writing.current = false; setBusy(false); }
    // An acknowledged write succeeded even when a subsequent refresh fails.
    // Do not retain a submitted form or invite a new mutation in that case.
    try { await reload(); }
    catch { setError("Your action was recorded, but the review could not reload. Reload before continuing."); }
  };
  useEffect(() => {
    if (!client || blocked) return;
    let cancelled = false;
    let refreshing = false;
    const refresh = () => {
      if (!cancelled && !refreshing && !document.hidden && !writing.current && currentState.current) {
        refreshing = true;
        const prior = currentState.current;
        void client.events({ ...prior.identity, after: prior.version }, 100).then((page) => {
          if (!cancelled && !writing.current && page.latest > prior.version) return reload(client);
        }).catch((failure) => { if (!cancelled) report(failure); }).finally(() => { refreshing = false; });
      }
    };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [client, blocked]);
  const disconnect = () => {
    sourceRead.current++; stateRead.current++; currentSnapshot.current = null; currentState.current = undefined;
    setClient(undefined); setCapabilities(undefined); setState(undefined);
    setFiles(undefined); setRows(undefined); setSelected(undefined); setLine(undefined); setError("");
  };
  const connect = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      if (file.size > 16 * 1024) throw new Error("Invalid connection");
      const connection = parseReviewConnection(JSON.parse(await file.text()));
      if (new URL(connection.origin).origin !== window.location.origin) throw new Error("Wrong review origin");
      const connected = new ReviewClient(connection);
      const granted = await connected.capabilities();
      if (pending && (granted.identity.reviewId !== pending.reviewId || granted.identity.repositoryId !== pending.repositoryId || granted.identity.workspaceId !== pending.workspaceId || granted.actor.id !== pendingActor.current?.id || granted.actor.kind !== pendingActor.current?.kind)) throw new ReviewClientError("wrong_review", "reconnect");
      setClient(connected); setCapabilities(granted); await reload(connected);
    } catch (failure) { report(failure); }
    finally { setBusy(false); }
  };
  const select = async (index: number, offset = 0) => {
    if (!client || !state?.currentSnapshotId) return;
    const read = ++sourceRead.current;
    setSelected(index); setRows(undefined); setLine(undefined);
    try {
      const page = await client.source({ snapshotId: state.currentSnapshotId, fileIndex: index, offset, limit: 150 });
      if (read === sourceRead.current && mounted.current) setRows(page);
    } catch (failure) { if (read === sourceRead.current) report(failure); }
  };
  const fire = (command: ReviewCommand) => { void execute(command).catch(() => { }); };
  const selectedEntry = files?.entries.find((entry) => entry.index === selected);
  const selectedAnchor = selectedEntry && "file" in selectedEntry ? selectedEntry.file.anchor : undefined;
  const viewed = selectedAnchor && state?.viewed.some((entry) => entry.actor.id === capabilities?.actor.id && entry.anchor.snapshotId === selectedAnchor.snapshotId && entry.anchor.layer.id === selectedAnchor.layer.id && entry.anchor.file.occurrence === selectedAnchor.file.occurrence && entry.anchor.file.oldPath === selectedAnchor.file.oldPath && entry.anchor.file.newPath === selectedAnchor.file.newPath);

  return <main className="durable-review">
    <header className="durable-toolbar">
      <BrandMark size={24} />
      <h1>Review workspace</h1>{state && <span>Revision {state.version}</span>}
      <div className="durable-toolbar-actions">{client && <button disabled={busy} onClick={disconnect}>{pending ? "Reconnect" : "Disconnect"}</button>}
        {client && <button disabled={busy} onClick={() => { void reload().catch(report); }}>Reload review</button>}
        {allowed.has("capture") && <button disabled={blocked} onClick={() => fire({ op: "capture" })}>Capture changes</button>}</div>
    </header>
    {new URLSearchParams(window.location.search).has("legacy") && <p className="durable-message">This workspace uses durable review. Earlier plans and mockups are archived with unverified provenance; their approvals do not grant authority here.</p>}
    {(error || pending) && <div className="durable-message" role="alert">{error || (busy ? "Waiting for confirmation…" : "A saved request is ready to reconcile.")}
      {pending && <button disabled={busy || !client || !state} onClick={() => { void execute(pending.command, pending).catch(() => { }); }}>Retry saved request</button>}</div>}
    {!client ? <section className="durable-connect">
      <h2>Connect to your review</h2>
      <p>Choose the connection file created when you opened this workspace. Its permissions control the actions available here.</p>
      <label className="durable-file-picker">Connection file<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void connect(event.target.files?.[0]); }} />
      </label>
      <p>Connection details stay in this tab and are never included in review exports.</p>
    </section> : <>
      <div className="durable-status" role="status">Connected as {capabilities?.actor.id} · {capabilities?.actor.kind}
        {state?.currentSnapshotId ? " · Captured source; freshness is checked when required" : " · Capture changes to begin"}</div>
      <div className="durable-workspace">
        <nav className="durable-files" aria-label="Changed files">
          <h2>Changes</h2>{files?.entries.map((entry) => "file" in entry ? <button key={entry.index} aria-current={selected === entry.index ? "true" : undefined} onClick={() => { void select(entry.index); }}>
            <span>{entry.file.path}</span>
            <small>+{entry.file.additions} −{entry.file.deletions}
              {entry.file.binary ? " · binary" : ""}</small>
          </button> : <p key={entry.index}>File {entry.index + 1}: name too large to display</p>)}
          {files && files.total === 0 && <p>No changes in this capture.</p>}
          {files?.next != null && state?.currentSnapshotId && <button onClick={() => { void readFiles(client, state.currentSnapshotId!, files.next!).catch(report); }}>Next files</button>}
          {files && files.offset > 0 && state?.currentSnapshotId && <button onClick={() => { void readFiles(client, state.currentSnapshotId!, Math.max(0, files.offset - 100)).catch(report); }}>Previous files</button>}</nav>
        <section className="durable-source" aria-label="Captured source">{rows ? <>
          <div className="durable-source-heading">
            <h2>Captured changes</h2>{allowed.has("view.mark") && selected !== undefined && selectedAnchor && <button disabled={blocked} onClick={() => fire({ op: "view.mark", fileIndex: selected, viewed: !viewed })}>{viewed ? "Mark unviewed" : "Mark viewed"}</button>}</div>{!rows.complete && <p className="durable-message">This capture is incomplete. Some source material is unavailable.</p>}<div className="durable-code">{rows.entries.map((entry) => {
              if (!("row" in entry)) return <div key={entry.index} className="durable-omission">Row too large to display.</div>;
              const row = entry.row;
              if (row.type === "line") return <button key={entry.index} className={`durable-code-row durable-line-${row.kind}`} aria-label={`Comment on ${row.kind === "del" ? "old" : "new"} line ${row.kind === "del" ? row.oldLineno : row.newLineno}`} onClick={() => setLine({ side: row.kind === "del" ? "deletions" : "additions", lineNumber: (row.kind === "del" ? row.oldLineno : row.newLineno)! })}>
                <span>{row.oldLineno ?? ""}</span>
                <span>{row.newLineno ?? ""}</span>
                <code>{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
                  {row.content}</code>
              </button>;
              return <div key={entry.index} className="durable-code-heading">{row.type === "fileHeader" ? row.path : row.type === "hunkHeader" ? `@@ −${row.oldStart},${row.oldLines} +${row.newStart},${row.newLines} @@ ${row.heading}` : "No newline at end of file"}</div>;
            })}</div>
          <div className="durable-page-actions">{rows.offset > 0 && <button onClick={() => { void select(selected!, Math.max(0, rows.offset - 150)); }}>Previous lines</button>}
            {rows.next !== null && <button onClick={() => { void select(selected!, rows.next!); }}>Next lines</button>}</div>{line && selected !== undefined && allowed.has("comment.add") && <NoteForm key={`${selected}:${line.side}:${line.lineNumber}`} label={`Comment on line ${line.lineNumber}`} disabled={blocked} submit={(body) => execute({ op: "comment.add", fileIndex: selected, ...line, body })} />}</> : <p className="durable-empty">{state?.currentSnapshotId ? "Select a file to review its captured changes." : "Capture the current changes to start reviewing."}</p>}</section>
        <aside className="durable-discussion" aria-label="Review discussion">
          <h2>Discussion</h2>{state?.comments.map((comment) => <article key={comment.id}>
            <div className="durable-comment-heading">
              <strong>{comment.filePath}:{comment.lineNumber}</strong>
              <span>{comment.status}</span>
            </div>
            <p>{comment.body}</p>
            <small>{comment.actor.id} · {state.commentFreshness.find((item) => item.id === comment.id)?.status}</small>{comment.replies.map((reply) => <blockquote key={reply.id}>{reply.body}<small>{reply.role}</small>
            </blockquote>)}
            {allowed.has("comment.edit") && (comment.actor.id === capabilities?.actor.id || capabilities?.permissions.includes("decide")) && <details>
              <summary>Edit comment</summary>
              <NoteForm label="Save comment" disabled={blocked} submit={(body) => execute({ op: "comment.edit", commentId: comment.id, body })} />
              <button disabled={blocked} onClick={() => fire({ op: "comment.delete", commentId: comment.id })}>Delete comment</button>
            </details>}
            {allowed.has("comment.reply") && <NoteForm label="Reply" disabled={blocked} submit={(body) => execute({ op: "comment.reply", commentId: comment.id, body })} />}
            {allowed.has(comment.status === "open" ? "comment.resolve" : "comment.reopen") && <NoteForm label={comment.status === "open" ? "Resolve with reason" : "Reopen with reason"} disabled={blocked} submit={(reason) => execute({ op: comment.status === "open" ? "comment.resolve" : "comment.reopen", commentId: comment.id, reason })} />}</article>)}
          {!state?.comments.length && <p>No comments yet. Select a source line to add one.</p>}
          {state?.currentSnapshotId && allowed.has("handoff.create") && <NoteForm label="Send instructions to agent" disabled={blocked} submit={(instructions) => execute({ op: "handoff.create", recipient: "external-agent", instructions, commentIds: state.comments.filter((comment) => comment.status === "open").map((comment) => comment.id) })} />}
          {state?.legacy && <section>
            <h2>Earlier review records</h2>
            <p>Imported records have unverified provenance. Original files remain available for recovery.</p>{state.legacy.sources.map((source) => <button key={source.name} disabled={busy} onClick={() => {
              void client.exportLegacySource(source.name).then((archive) => {
                const url = URL.createObjectURL(new Blob([archive.bytes as BlobPart], { type: "application/json" }));
                const link = document.createElement("a"); link.href = url; link.download = source.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              }).catch(report);
            }}>Download original {source.name}</button>)}</section>}
          {state?.handoffs.map((handoff) => <article key={handoff.id}>
            <h3>Round {handoff.round} · {handoff.status}</h3>
            <p>{handoff.instructions}</p>{handoff.result && <p>{handoff.result.body}</p>}
            {handoff.reason && <p>{handoff.reason}</p>}
            {handoff.status === "awaiting-human" && allowed.has("decision.record") && <>
              <NoteForm label={`Approve round ${handoff.round}`} disabled={blocked || handoff.result?.snapshotId !== state.currentSnapshotId} submit={(rationale) => execute({ op: "decision.record", handoffId: handoff.id, decision: "approved", rationale })} />
              <NoteForm label={`Request changes for round ${handoff.round}`} disabled={blocked || handoff.result?.snapshotId !== state.currentSnapshotId} submit={(rationale) => execute({ op: "decision.record", handoffId: handoff.id, decision: "changes-requested", rationale })} />
            </>}
          </article>)}
          {state?.currentSnapshotId && allowed.has("decision.record") && <>
            <h2>Your decision</h2>
            <NoteForm label="Approve with rationale" disabled={blocked} submit={(rationale) => execute({ op: "decision.record", decision: "approved", rationale })} />
            <NoteForm label="Request changes" disabled={blocked} submit={(rationale) => execute({ op: "decision.record", decision: "changes-requested", rationale })} />
          </>}
          {state?.decisions.map((decision) => <article key={decision.id}>
            <strong>{decision.decision}</strong>
            <p>{decision.rationale}</p>
            <small>{decision.actor.id} · {state.decisionFreshness.find((item) => item.id === decision.id)?.status}</small>
          </article>)}
        </aside>
      </div>
    </>}
  </main>;
}
