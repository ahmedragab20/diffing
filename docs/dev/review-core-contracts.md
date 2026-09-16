# Review core: initial contracts and storage decision gate

Status: file-inventory continuation contract implemented; durable review driver
still proposed and unqualified. This is the first P0/P1 change set of the
opt-in guided review delivery. It does not complete either phase.

## Identities and source ownership

Repository, workspace, running session, logical review, captured snapshot and
execution run are separate identities. The existing checkout-path storage
namespace remains isolated per worktree. Canonical repository identity and
durable review identity still need an executable schema before migration.
Branch names, file indexes and process-local generations are not durable IDs.

For the current web/PR file-inventory API, `snapshotId` is an opaque UUID for an
in-memory parsed patch capture. It does not yet identify a durable review, a
Git-atomic capture, or a complete source manifest. The server owns both the
capture and the continuation key; another server/session cannot use its tokens.
The cache replaces indexes instead of mutating them, preserving retained bytes.

`nextContinuation` binds protocol version 1, server incarnation, snapshot,
filtered-list position, path filter and page size. Its payload is authenticated
with a per-server random HMAC key. Clients treat it as opaque and pass it alone.
Repeated reads return the same page while retained. Starting without a token
collects the current patch; continuing a token never calls Git or rebuilds the
index. Captures report `freshness: "not-checked"`: retained content is not proof
that the workspace or PR head is still current. `complete` and `omittedPaths`
describe source coverage independently of pagination.

Retention is session-local: five minutes from capture, at most eight captures,
and 64 MiB measured as serialized index bytes, evicting oldest captures first.
This bounds retained representation size, not total process RSS. Expired entries
are pruned on access. Capacity eviction can expire a token before `expiresAt`;
restart also expires all tokens. A single capture over capacity is rejected.
Hunks, slices and searches still use the existing live generation contract;
they cannot yet navigate a retained file snapshot. Carry the file page's
generation into those operations and restart on a conflict.

## File operation outcomes and compatibility

File errors carry `code`, `error` and `recovery: "restart_files"`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_continuation` | Malformed/tampered token, incompatible parameters or invalid numeric input |
| 400 | `continuation_required` | Nonzero legacy cursor without generation |
| 409 | `stale_generation` | Legacy navigation refers to a different current index |
| 410 | `snapshot_expired` | Retention ended, server restarted or token belongs to another session |
| 413 | `snapshot_too_large` | Capture exceeds retained representation capacity; narrow the review scope |
| 422 | `unsupported_continuation` | Native TUI does not implement retained file snapshots yet |

The first page and numeric `nextCursor` remain available. Subsequent numeric
requests must carry `generation`; older clients omitting it get an explicit
upgrade/restart message. Numeric generations remain process-local and do not
bind filters. They are a compatibility path, not the new snapshot guarantee.
Web/PR clients should use `nextContinuation`. Native retained snapshots and a
shared runtime operation/result catalog remain P1/P3 work.

## Legacy storage inventory

| Authority today | Format and boundary | Migration concern |
| --- | --- | --- |
| `FileCommentStore` | `comments.json`, full comment array, per-instance queue | Read errors appear empty; save errors are logged; no multi-process serialization |
| `ReviewSession` | In-memory payload, round, baseline and last 20 summaries | No durable restart replay |
| `AiStorage` | `ai-turns.jsonl`, version-1 `{v,key,checksum,record}` lines | Per-instance queue; append completion has no explicit fsync acknowledgement |
| `AiStorage.compact` | Temporary journal, prior `.bak`, rename to journal | No flushed compaction transaction; replaces original deduplication keys |
| `FileAiConversationStore` | Atomic JSON-array replacement in `ai-conversations.json` | Separate authority; import already preserves original bytes |
| Server registry/startup lease | Session JSON files and exclusive startup directory | Startup ownership does not serialize later review writes |

No migration or new authoritative writer is enabled by this change set.

## Proposed durable driver ADR: gate before P2

Use a versioned append-only review journal plus recoverable snapshots if the
ownership/durability spike proves the required guarantees on supported systems.
Retain Node 20 and existing packaging; do not add a database service or native
dependency without a revised decision. The public store boundary should accept
one transaction with expected version, request key and normalized payload digest,
and return a committed sequence/version and replayable result. Reusing a key with
different input must conflict. Compaction must retain unexpired deduplication
records and pending handoffs.

The proposed acknowledgement boundary is successful complete transaction append
and file flush, plus required directory flush for newly created/replaced journal
files. A flush failure is not success; after an ambiguous write, reconcile by
request key before retrying. Filesystem/platform limitations must be measured and
documented, not inferred from successful `writeFile` or `rename` calls.

One process must hold ownership of a logical review for the full writer lifetime.
Other sessions must route mutations to that owner or remain read-only. The spike
must select and prove the ownership mechanism, including dead-owner recovery and
prevention of a former owner resuming writes. The existing startup lease alone
does not establish that property. Do not implement P2 atop an unproven lock.

Required deterministic spike scenarios: two real writer processes, owner death
at controlled transaction/flush boundaries, lost response after commit, replay
of complete records versus torn tails, interior corruption, unsupported versions,
compaction interruption, same-key/different-payload conflicts, permission/disk/flush
failures, and linked-worktree isolation. Preserve corruption and migration sources;
never reinterpret unreadable existing state as an empty review.

If this fails within the runtime/platform constraints, revise the driver decision
before migration. No successful spike or power-loss guarantee is claimed here.

## Remaining P0/P1 proof

The full adoption-switch invariant matrix, benchmark baseline and storage spike
remain pending. Performance qualification uses deterministic 20/500/5,000-file
fixtures with 2,000/50,000/500,000 changed lines plus long-line, binary, rename
and path-stress cases. Record machine/OS, Node/Rust/build, warm/cold state and run
count; compare capture time, page latency, memory and retained bytes separately.
The new invocation-count regression proves zero Git collections for retained
file continuation only; it is not a performance-budget qualification.

Remaining P1 work includes immutable manifests with resolved Git/layer identities,
optimistic working-tree capture validation, snapshot-bound hunk/slice/search,
native parity, serialized output limits, persistent anchors and staleness. The
delivery ledger outside the source tree tracks full AC proofs separately; a
passing file-page regression does not close a phase or a broader AC.
