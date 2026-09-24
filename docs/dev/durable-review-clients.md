# Durable review clients (protocol 1)

Durable review is explicitly selected. Classic review remains the default.
Start from the consumer worktree with `diffing review-core serve --adopt --ui`.
After adoption, restart with `diffing review-core serve --ui`. Adoption preserves
original legacy files and fences their writers; it is not a temporary UI toggle.
The output contains the origin and paths to separate private human and agent
connection files. Credentials expire after 24 hours or server shutdown. A restart
keeps the review identity and durable records but issues new credentials.

Open `/review-core` and choose the human connection file to review, comment,
mark viewed, send instructions and record decisions. Connection secrets stay in
tab memory. The agent file has no decision authority. The ordinary browser
session token is insufficient for durable operations. Stale source and lost
responses are explicit; a saved uncertain request can be retried unchanged.
The browser refreshes after writes and checks for updates while visible.

## CLI and MCP

Set `DIFFING_REVIEW_CONNECTION` to the selected private connection file. CLI
commands also accept `--connection <file>`:

```sh
diffing review-core capabilities
diffing review-core state
diffing review-core next-actions
diffing review-core source --file source-query.json
diffing review-core events --after 0 --limit 100
diffing review-core handoff HANDOFF_ID
diffing review-core execute --file request.json
diffing review-core batch --file batch.json
```

Keep request files outside the consumer source tree, under `~/.diffing/`.
`--file -` reads bounded JSON from stdin. No command implicitly captures source.
Read state, then construct an envelope with its identity, current version and
snapshot. For example, an explicit capture uses:

```json
{
  "version": 1,
  "reviewId": "REVIEW_UUID",
  "repositoryId": "64_HEX_CHARACTERS",
  "workspaceId": "64_HEX_CHARACTERS",
  "requestId": "YOUR_UNIQUE_REQUEST_ID",
  "expectedVersion": 1,
  "snapshotId": null,
  "command": { "op": "capture" }
}
```

These placeholders must be replaced with actual state. A mutation of captured
source uses that snapshot's ID; file indexes come from `source` for the same
snapshot. A handoff transition uses the handoff's original snapshot; submitting
its result separately identifies the result snapshot and requires its claim ID
and epoch. Stale versions conflict instead of silently applying elsewhere.

MCP selected with the same environment variable exposes `review_capabilities`,
`review_state`, `review_next_actions`, `review_source`, `review_events`,
`review_handoff`, `review_execute` and `review_batch`. It accepts only an agent
connection, verified against the server. Human decision operations are excluded
from its executable input schema and independently denied by the owner.
`review_session_status` and `list_comments` remain read aliases.

The catalog uses runtime Zod schemas for request and result validation; there
are no role/model fields that can grant permission. Optional next actions are
hints, not authorization. The owner rechecks version, snapshot, permission,
claim ownership and operation-specific preconditions before committing.

## Retries, batches and bounds

After `outcome_unknown`, retain and retry the **same complete envelope**, including
request ID, expected version, snapshot and command. An acknowledged result is
returned after durable commit. An exact retry returns the stored result; changing
a reused request conflicts. Do not generate a fresh ID to retry an uncertain
write. A successful write followed by a failed read remains a successful write.

Batches contain `version: 1`, `mode: "per-item"` and 1–25 complete requests.
Execution is sequential and continues after a failed item. Successful items
remain committed. Expected versions must reflect preceding successful items;
a failed item consumes no version. Retrying the identical batch deduplicates
successful requests and reports each item's outcome. It is not an atomic batch.

Requests are at most 256 KiB; responses are at most 512 KiB. Source pages have
at most 200 entries and a 128 KiB budget, with stable offset/next positions.
An oversized row is explicitly omitted and its position still advances. Reading
retained source never refreshes Git. Eviction yields `snapshot_expired`; partial
capture stays explicit and cannot support approval. Events replay bounded pages
from an identity-bound sequence cursor. Large state returns `response_too_large`
with `read_events` recovery rather than a truncated successful state.

Protocol negotiation uses `X-Diffing-Review-Protocol: 1`. An explicit incompatible
version fails. Versioned failures include stable `code` and `recovery` fields,
with a sequence when available. Clients preserve uncertainty after an invalid
mutation response. Unversioned legacy HTTP consumers retain their earlier error
shapes; the TypeScript client normalizes missing recovery fields.

## Native subset and compatibility

With `DIFFING_REVIEW_CONNECTION` set, `diffing --tui` opens the connected native
read-only workspace. It supports discussion/history, file and row pages, and
explicit refresh. It does not capture, comment, change viewed state, send
handoffs or decide; it identifies this subset on screen and directs mutations
to the web workspace or CLI. It never opens legacy stores or falls back to Git.
A missing binary, non-TTY or incompatible configuration fails explicitly.

The native binary also supports:

```sh
diffing-tui --review-connection CONNECTION_FILE --review-read state
diffing-tui --review-connection CONNECTION_FILE --review-read capabilities
diffing-tui --review-connection CONNECTION_FILE --review-read next-actions
```

The native file argument is explicit; internal native storage/file RPC modes do
not consume the connection environment variable. Classic TUI remains unchanged.

When a durable connection is selected, `diffing comments --format json` and
`diffing url` are read aliases. Classic write commands, MCP write aliases and
old review APIs return `review_core_required` or `headless_review` with
`use_review_core_operations`, because their inputs lack a durable envelope.
Old plan/mockup/PR web links redirect to the durable workspace with a migration
notice. Archived legacy text, IDs and original bytes remain available with
`legacy-unverified` provenance; an old approval never becomes a new decision.
Plans and mockups are not editable through this protocol.

## Contract and drift checks

`GET /api/review-core/contract` (authenticated) returns the operation catalog,
limits, native subset and generated JSON Schemas. The checked-in reference is
[review-core-contract.json](../review-core-contract.json). Regenerate it with
`node --import tsx scripts/generate-review-contract.ts`. Tests compare it with
the same runtime schemas used by HTTP, CLI and MCP and check the skill reference.
JSON Schema documents structural constraints; the owner additionally checks
source freshness, authority, state transitions and other runtime invariants.
Neither Markdown guidance nor source content grants authority.
