# Review core: initial contracts and storage decision gate

Status: web/PR files, hunks, slices and searches retain snapshot-bound
continuations. An isolated review-journal driver has local ownership/recovery
tests and an isolated review state machine. A bundled SQLite replacement was
approved on 2026-09-17 and is under qualification. Migration and application
integration remain pending. P0–P2 are in progress, with no phase-completion claim.
The original journal's directory flush fails the Windows gate described below.

## Identities and source ownership

Repository, workspace, running session, logical review, captured snapshot and
execution run are separate identities. The existing checkout-path storage
namespace remains isolated per worktree. Captures hash canonical common Git
directory and worktree Git directory paths into distinct repository/workspace
identities. Moving a checkout changes this identity rather than guessing continuity.
Durable review identity still needs application integration before migration.
Branch names, file indexes and process-local generations are not durable IDs.

For the current web/PR file-inventory API, `snapshotId` is an opaque UUID for an
in-memory parsed patch capture. Its runtime-validated manifest records scope,
options, HEAD/resolved revisions, index digest, ordered comparison layers,
source digests, completeness and PR provenance where applicable. It does not
identify a durable review or a Git-atomic capture. The server owns both the
capture and the continuation key; another server/session cannot use its tokens.
The cache replaces indexes instead of mutating them, preserving retained bytes.

`nextContinuation` binds protocol version 1, server incarnation, snapshot,
filtered-list position, path filter and page size. Its payload is authenticated
with a per-server random HMAC key. Clients treat it as opaque and pass it alone.
Repeated reads return the same page while retained. Starting without a token
collects the current patch; continuing a token never calls Git or rebuilds the
index. Summary returns a snapshot ID which files/hunks/slice/search can reuse.
Captures report `freshness: "not-checked"`: retained content is not proof
that the workspace or PR head is still current. `complete` and `omittedPaths`
describe source coverage independently of pagination.

Retention is session-local: five minutes from capture, at most eight captures,
and 64 MiB measured as serialized index bytes, evicting oldest captures first.
This bounds retained representation size, not total process RSS. Expired entries
are pruned on access. Capacity eviction can expire a token before `expiresAt`;
restart also expires all tokens. A single capture over capacity is rejected.
Hunks, slices and searches accept the file page's `snapshotId`. Their signed
continuations additionally bind operation, selectors/search query and response
budgets. A token cannot switch operations. Numeric continuation without a
snapshot still needs generation and rejects changes to the live index.

Successful web/PR page responses fit the requested serialized UTF-8 budget,
including tokens and metadata. The default is 256 KiB and supported bounds are
512 bytes to 4 MiB. An oversized row is explicitly omitted with a continuation
past that row; metadata that cannot fit returns `response_too_large`. Source
completeness is independent of response truncation/omission.

Capture compares two collections with source-identity probes before, between
and after them. A changed source retries at most three times, then returns
`inconsistent_capture`. Git failures return `source_unavailable`. Unsupported
combined/submodule-log/word-diff/output-only forms return `unsupported_capture`.
This is optimistic validation, not a lock on editors or a filesystem snapshot.

File metadata preserves modes, available Git blob IDs, submodules and raw patch
digests. Synthesized untracked patches use `diffing-content-sha256` for actual
byte identity, never a fabricated Git blob ID. Their file modes are explicitly
unknown because the native read boundary currently returns bytes only. Non-UTF-8
untracked content is represented as binary. CRLF bytes and missing-final-newline
markers are retained; terminating newlines do not create extra added rows.

Comments can supply `snapshotId` and `fileIndex` to persist a validated source
anchor. The server checks the file path and captured line range, and preserves
the original anchor across refreshes. Reading anchored comments compares a fresh
capture and reports `sourceFreshness` and `outdated`. When source capture fails,
stored feedback remains readable with `unverified` / `source_unavailable`.
Layer/revision, mode, rename,
content and workspace changes invalidate matching claims conservatively. Legacy
comments lack this proof. Viewed state, review items and decisions still require
the durable review-core integration; these comments do not close SNAP-10.

## File operation outcomes and compatibility

File errors carry `code`, `error` and `recovery: "restart_files"`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_continuation` | Malformed/tampered token, incompatible parameters or invalid numeric input |
| 400 | `continuation_required` | Nonzero legacy cursor without generation |
| 409 | `stale_generation` | Legacy navigation refers to a different current index |
| 410 | `snapshot_expired` | Retention ended, server restarted or token belongs to another session |
| 413 | `snapshot_too_large` | Capture exceeds retained representation capacity; narrow the review scope |
| 413 | `response_too_large` | Metadata cannot fit the requested response budget |
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
| `FileCommentStore` | `comments.json`, validated array, flushed temporary-file replacement, per-instance queue | Read/save errors now propagate; still no multi-process serialization or directory-flush recovery contract |
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

### Current driver experiment

`ReviewOwner` publishes an immutable, versioned loopback port record with an
exclusive hard link. The owner holds that port for the full writer lifetime.
Other processes fail with `owner_busy`; closing or killing the owner releases
the kernel resource. There is no timeout-based takeover of a paused process and
no stale-lock deletion race. Independent review directories allocate separate
ports. An unrelated service occupying a saved port is an availability failure,
never permission to replace the ownership record. The socket drops connections
and exposes no review API. This ownership mechanism assumes one host and local
storage; it is not a distributed-filesystem lock.

`ReviewStore` is currently an isolated driver, not the application's comment or
handoff authority. Each versioned transaction binds an idempotency key to its
normalized request, expected version, sequence and previous checksum. Append
and file flush complete before acknowledgement. Initialization and replacement
also flush the directory. A write/flush ambiguity fences the instance until it
is closed and reopened; reopening flushes validated complete records before
replaying their results. An initialized but missing journal is an error.

An unterminated tail requires explicit recovery. Recovery saves and flushes the
original bytes before truncation; interior corruption and recognizable newer
versions are refused without rewriting. Compaction currently rewrites verified
records and preserves every event and idempotency record, retaining a backup
of the previous journal. Event pruning and retention-gap handling are pending.

Local tests cover two processes, paused owners, owner death at append/flush
boundaries, restart deduplication, stale versions, normalized payload conflicts,
injected permission/disk/flush failures, torn tails, corruption and backup
preservation. These are process-crash tests on macOS, not power-loss simulation
or Windows/Linux qualification. A focused ownership, journal, capture and anchor
suite also passed under an official Node 20.19.0 Darwin arm64 binary; this is
limited runtime evidence, not whole-product Node 20 qualification. P2 integration
remains gated on the remaining storage/migration and platform evidence.

### Windows storage blocker

`syncDirectory` currently opens a directory with `r` and calls `FileHandle.sync`.
Node 20.19.0 uses libuv 1.46.0: its Windows implementation opens read-only handles
with `FILE_GENERIC_READ` and implements fsync with `FlushFileBuffers`.
[libuv Windows filesystem implementation](https://github.com/libuv/libuv/blob/v1.46.0/src/win/fs.c)
and [the Windows flush contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
show the mismatch: flushing requires write access. This is a source-backed
compatibility finding, not an executed Windows test.

Do not activate or migrate to this driver on the strength of macOS tests.
Ignoring directory-flush errors would weaken the documented acknowledgement
boundary. SQLite was approved as the replacement; Linux and Windows
process/crash qualification remain outstanding before application migration.

### Approved SQLite qualification driver

`SqliteReviewStore` implements the transaction, expected-version, deduplication,
bounded replay and compaction contract through a separate `--review-store-rpc`
mode in the bundled Rust binary. `rusqlite` builds SQLite into that binary; no
database service, system SQLite installation or Node-version change is required.
Binary discovery is restricted to the verified diffing installation, never PATH.

The helper is bound to one directory at launch. Requests can read transaction
pages, append a transaction, or compact with a generated backup filename. They
cannot execute arbitrary SQL or select filesystem paths. Transactions keep the
event list and original result together with their sequence, request key/hash,
and checksum. TS validates the canonical checksum chain on replay; SQLite stores
an additional digest of the exact persisted JSON. Startup refuses newer formats,
corrupt data and legacy journals rather than silently converting them.

SQLite uses rollback journaling, `synchronous=EXTRA` and `fullfsync=ON` (the latter
is meaningful on macOS). An exclusive connection lock persists between commits,
including while the TS producer computes its next effect. Another helper returns
`owner_busy`; it cannot steal a paused owner's authority. Process death releases
the OS lock. Independent review databases remain independent. A lost response
fences the client; reopen and retry with the original request key to reconcile.
Compaction first uses SQLite's backup API, then VACUUM, preserving all events and
deduplication keys. Retention/pruning remains separate work.

Run `pnpm test:review-store` for actual TS/helper/Core integration and
`cargo test -p diffing-tui review_store::tests` plus
`cargo test -p diffing-tui --test review_store_rpc` for native crash/ownership
qualification. The native workflow includes macOS/Linux/Windows and Node 20.
Configuring CI is not evidence that those remote jobs passed. Local process-kill
tests do not simulate physical power loss.

`ReviewCore.open` accepts an `openStore` factory so the same state machine can be
qualified with SQLite. Its original isolated journal default and the application's
classic persistence are unchanged until qualification/migration is complete.
Migration must also distinguish a new review from a previously initialized review
whose database is missing, preserve legacy backups, and prove rollback. Neither
driver activation nor automatic migration is part of this qualification step.

### Isolated review state machine

`ReviewCore` projects versioned, schema-validated events from the owned journal.
It records snapshots and fingerprints, anchored comments and viewed state,
numbered handoffs with instructions, worker claims, results and human decisions.
Each operation binds the review/workspace/repository, expected version, request
key and snapshot. Duplicate requests return the recorded acknowledgement.
Results are runtime-validated too. A snapshot ID cannot be reused for changed
source content.

`ReviewAuthority` issues bounded, revocable grants through a trusted in-process
issuer. Client requests contain no actor or role fields. Human-only grants permit
decisions and resolution; an agent result leaves the concern open. This is an
internal authority contract, not yet browser/CLI/MCP authentication integration.

Claims have an increasing epoch and an unpredictable claim ID. Reclaiming work
invalidates old claims. Cancellation requested during work remains distinct from
worker-confirmed cancellation, failure, expiration and unknown outcome. New work
and decisions compare a fresh capture against the recorded source identity.
The state read is explicitly `freshness: "not-checked"`; it does not claim to
have rechecked external editors.

These modules remain disconnected from classic comments and `ReviewSession`.
No legacy data is migrated and no independently writable compatibility mirror
exists. Application adapters, migration/rollback and transport authority tests
are still required for FLOW acceptance.

## Remaining P0/P1 proof

The full adoption-switch invariant matrix and storage qualification remain
pending. `review-adoption.test.ts` covers classic opening/commenting/reopening
with byte-identical repository contents, including Git config/hooks. The
index benchmark harness is `scripts/review-inspect-baseline.ts`; it uses
deterministic 20/500/5,000-file
fixtures with 2,000/50,000/500,000 changed lines plus long-line, binary, rename
and path-stress cases. Record machine/OS, Node/Rust/build, warm/cold state and run
count; compare capture time, page latency, memory and retained bytes separately.
The new invocation-count regression proves zero Git collections for retained
file continuation only; it is not a performance-budget qualification.

Remaining P1 work includes native retained-snapshot parity and source anchors
for viewed state, review items and decisions. The
delivery ledger outside the source tree tracks full AC proofs separately; a
passing file-page regression does not close a phase or a broader AC.
