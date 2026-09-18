# Review core: initial contracts and storage decision gate

Status: web/PR and native files, hunks, slices and searches retain snapshot-bound
continuations. Native captures validate the retained source against repeated Git
reads and return a scope manifest for supported unified-patch scopes.
A bundled SQLite replacement was approved on 2026-09-17;
the qualification checkpoint passed its platform matrix. Explicit legacy archive
import/recovery is tested in the review core. An explicit headless CLI launch now
coordinates migration and separate human/agent credentials. Classic adapters
remain pending. P0–P2 are in progress, with no phase-completion claim.
The original journal's directory flush fails the Windows gate described below.

## Identities and source ownership

Repository, workspace, running session, logical review, captured snapshot and
execution run are separate identities. The existing checkout-path storage
namespace remains isolated per worktree. Captures hash canonical common Git
directory and worktree Git directory paths into distinct repository/workspace
identities. Moving a checkout changes this identity rather than guessing continuity.
`ReviewCore.openWorkspace` acquires the selected store's ownership before
recovering its persisted review identity. Reopening the same review directory
preserves that identity; a different workspace is rejected without rewriting
the database. An empty explicitly selected directory starts a new review.
The explicit headless launcher adopts the existing worktree storage directory;
ordinary browser/TUI launches do not migrate it automatically.
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

Successful inspect page responses fit the requested serialized UTF-8 budget,
including tokens and metadata. The default is 256 KiB and supported bounds are
512 bytes to 4 MiB. An oversized row is explicitly omitted with a continuation
past that row; metadata that cannot fit returns `response_too_large`. Source
completeness is independent of response truncation/omission.

Capture compares two collections with source-identity probes before, between
and after them. A changed source retries at most three times, then returns
`inconsistent_capture`. Git failures return `source_unavailable`. Unsupported
combined/submodule-log/word-diff/output-only forms return `unsupported_capture`.
This is optimistic validation, not a lock on editors or a filesystem snapshot.

Web/PR file metadata preserves modes, available Git blob IDs, submodules and raw patch
digests. Validated native file pages also expose raw-section digests and source
anchors, alongside modes, available blob IDs and submodule markers. Native
parsing preserves source CRLF and literal path whitespace; lines
inside a hunk cannot be reinterpreted as file headers. Untracked enumeration
failures propagate instead of producing a complete empty inventory. Synthesized untracked patches use `diffing-content-sha256` for actual
byte identity, never a fabricated Git blob ID. Their file modes are explicitly
unknown because the native read boundary currently returns bytes only. Non-UTF-8
untracked content is represented as binary. CRLF bytes and missing-final-newline
markers are retained; terminating newlines do not create extra added rows.

Web and native API comments can supply `snapshotId` and `fileIndex` together to
persist a validated source anchor. Both check the file path and captured line
range, and preserve the original anchor across refreshes. Native anchors use
the actual native scope and its composite comparison layer; they do not assert
equivalence with web scopes or implement native commit-series capture. Reading
anchored comments in the web API compares a fresh capture and reports
`sourceFreshness` and `outdated`. Native comment reads retain the historical
anchor without asserting current-source freshness. When web source capture fails,
stored feedback remains readable with `unverified` / `source_unavailable`.
Layer/revision, mode, rename,
content and workspace changes invalidate matching claims conservatively. Legacy
comments lack this proof. Viewed state, review items and decisions still require
the durable review-core integration; these comments do not close SNAP-10.

Native edits preserve unknown comment/reply fields, including source anchors
and descriptive actor metadata. Reply timestamps are written as `createdAt`;
both clients accept the older native `created_at` field. The web importer refuses
conflicting timestamps and retains byte-identical recovery archives. These
legacy actor labels do not grant review-core authority.

## File operation outcomes and compatibility

File errors carry `code`, `error` and `recovery: "restart_files"`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_continuation` | Malformed/tampered token, incompatible parameters or invalid numeric input |
| 400 | `continuation_required` | Nonzero legacy cursor without generation |
| 409 | `stale_generation` | Legacy navigation refers to a different current index |
| 409 | `inconsistent_capture` | Source changed during capture or no longer matches the displayed native index; refresh and retry |
| 410 | `snapshot_expired` | Retention ended, server restarted or token belongs to another session |
| 413 | `snapshot_too_large` | Capture exceeds retained representation capacity; narrow the review scope |
| 413 | `response_too_large` | Metadata cannot fit the requested response budget |
| 422 | `unsupported_capture` | Source options or representation cannot be validated as a unified patch |
| 503 | `source_unavailable` | Git, source bytes or identity could not be read within the capture deadline |
| 503 | `capture_busy` | Another native capture is active; retry or continue an existing snapshot |

The first page and numeric `nextCursor` remain available. Subsequent numeric
requests must carry `generation`; older clients omitting it get an explicit
upgrade/restart message. Numeric generations remain process-local and do not
bind filters. They are a compatibility path, not the new snapshot guarantee.
Clients should use `nextContinuation`. Native captures retain a private temporary
copy of the indexed spool prefix, so later live-spool cleanup cannot change their
pages. Retention is five minutes, eight captures and 64 MiB of combined serialized
index metadata and source bytes. Expiration/eviction and normal shutdown delete
the retained spool; abrupt process termination can leave an OS temporary file.
Tokens bind the native server incarnation, snapshot, operation and query with
HMAC-SHA256. Native generations use monotonic epoch microseconds to round-trip
through JSON safely.

Native capture validation runs when starting a snapshot, outside the TUI render
path. It compares the retained spool digest with two Git collections bracketed
by three identity probes, with at most three attempts and a shared 30-second Git
deadline. Source failures and unsupported options never become a complete empty
capture. Partial indexes remain explicitly incomplete and carry no validated
manifest. One capture can run at a time without blocking historical pages.
Each Git subprocess has a 64 MiB output bound, and concatenated patch bytes share
that bound; these temporary buffers are additional to retained cache capacity.

The native manifest records canonical repository/workspace identities, HEAD,
index digest, resolved revisions, exact effective `nativeGitDiffArgs`, fixed
patch prefixes, untracked inclusion and source digest. It describes one composite
layer (`mixed` for the native default working-plus-untracked stream, otherwise
`working`, `staged` or `revision`). It does not invent separate staged/working
layers or claim commit-series/show equivalence. Supported modifier/path scopes
follow the actual native `git diff` arguments; unsafe or non-unified forms are
rejected before replay. A shared runtime operation/result catalog and full
cross-transport scope/anchor parity remain P1/P3 work.

## Legacy storage inventory

| Authority today | Format and boundary | Migration concern |
| --- | --- | --- |
| `FileCommentStore` | `comments.json`, validated array, flushed temporary-file replacement, shared classic-writer lease | Read/save errors propagate; Node and native writers serialize; no directory-flush recovery contract |
| `FilePlanStore` | `plans.json`, validated array, flushed temporary-file replacement, shared lease including read-time backfills | Mutations propagate authoritative save errors; source mirrors remain best-effort; no directory-flush recovery contract |
| `FileViewedStore` | `viewed.json`, validated object, shared lease and atomic replacement | Reads refresh saved progress; failed writes never advance the cache; malformed/unreadable stores are preserved; no flush recovery contract |
| `ReviewSession` | In-memory payload, round, baseline and last 20 summaries | No durable restart replay |
| `AiStorage` | `ai-turns.jsonl`, version-1 `{v,key,checksum,record}` lines | Per-instance queue; append completion has no explicit fsync acknowledgement |
| `AiStorage.compact` | Temporary journal, prior `.bak`, rename to journal | No flushed compaction transaction; replaces original deduplication keys |
| `FileAiConversationStore` | Atomic JSON-array replacement in `ai-conversations.json` | Separate authority; import already preserves original bytes |
| Server registry/startup lease | Session JSON files and exclusive startup directory | Startup ownership does not serialize later review writes |

Normal launches do not activate migration or a new authoritative writer.

Classic Node stores and the native comment store coordinate through an immutable
`legacy-write-lease/owner.json` record and exclusive IPv4 loopback listener.
Closing the listener or process death releases ownership; a slow process is never
replaced based on a timestamp. Contention waits up to five seconds, then returns
`legacy_store_busy`. This local-host lease is separate from data durability and
does not acknowledge a review transaction. It does not require directory fsync;
after power loss no prior process retains its listener.

`openMigratedWorkspaceReview` is an explicit trusted-bootstrap entry point. It
holds the shared lease while validating original files, opening SQLite in the
same storage directory and committing the checked legacy archive. Its callback
supplies an independently authorized credential; the function does not mint one.
The SQLite database, initialization marker or recovery sidecars fence classic
reads/writes, including after an interrupted migration or server shutdown.
Retry resumes the same archive; completed migrations reopen from authoritative
records even if somebody later changes the old files. Unknown alternate authority
markers require recovery and never enable fallback. Original source files are
preserved, with exact archive bytes retained in the core.

These guarantees coordinate updated clients. Stop older binaries before adopting
the new authority; they do not implement the shared lease or marker checks.
Cross-language and real-process qualification lives in
`scripts/legacy-lease-qualification.test.ts`; the Node 20 macOS/Linux/Windows
workflow runs it alongside SQLite qualification. Current uncommitted platform
results are recorded separately in the delivery ledger.

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
boundary. SQLite was approved as the replacement. Its macOS/Linux/Windows
qualification passed at the prior published checkpoint; application migration
and qualification of subsequent changes are separate gates.

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

`node --import tsx --test scripts/review-source-qualification.test.ts` exercises
real Git scope captures, equal-timestamp commit ordering, external edits/staging/
commits/rebase, rename and mode metadata, unavailable untracked content, and a
corrupt Git index. Its PR artifact fixture uses an in-memory provider boundary
and disables filesystem event subscriptions; parsing and retained reads remain
real. `node --test scripts/postinstall.test.mjs` verifies repeated installation
lifecycle runs preserve fixture files and attempt no subprocess or network
activity, including when an attempted effect's exception is caught.

`ReviewCore.open` defaults to the bundled SQLite driver. An explicit `openStore`
factory keeps journal fault-injection tests independent of native builds; it is
never an automatic fallback. Missing helper binaries or incompatible existing
stores fail explicitly. Classic persistence remains unchanged unless the workspace
is explicitly adopted through the coordinated migration entry point.
An initialization marker is written and file-flushed after the database has
been validated, before startup acknowledgement. A marked review with a missing
or empty database returns `missing_store`; malformed marker bytes are preserved
and refused. Recovery may explicitly restore the database from its SQLite backup.
These are process-crash/recovery guarantees, not physical power-loss simulation.

`readLegacyArchive` reads only comments/plans/viewed JSON, validates their shapes
and preserves their exact bytes, unknown fields, IDs and existing version history.
Each source is bounded at 8 MiB. Missing files are explicitly absent; corrupt or
unreadable files fail. No old plan history or actor identity is synthesized.
`ReviewCore.importLegacy` requires trusted human decision authority and imports
into a new review using checksummed, bounded chunks followed by a commit event.
Interrupted imports remain pending, block ordinary core mutations, and resume
idempotently from the same archive after reopening. Until commit, no legacy
records appear in the import summary or recovery export. Original files remain
untouched; `exportLegacy` supplies the exact archived bytes for recovery.

The import is labeled `legacy-unverified`. In-memory legacy handoff history is
explicitly unavailable, and an imported plan's approval does not create a new
trusted human decision. Imported comments become usable core records with their
stable IDs and unverified provenance; subsequent replies are durable without
changing the immutable recovery archive. This is archive import/recovery, not activation: classic
comment/plan/PR/viewed writers still need adapters and a single-authority switch.
No independently writable compatibility mirror or automatic migration is enabled.

### Isolated review state machine

`ReviewCore` projects versioned, schema-validated events from the owned store.
It records snapshots and fingerprints, anchored comments and viewed state,
numbered handoffs with instructions, worker claims, results and human decisions.
Each operation binds the review/workspace/repository, expected version, request
key and snapshot. Duplicate requests return the recorded acknowledgement.
Results are runtime-validated too. A snapshot ID cannot be reused for changed
source content.

Viewed marks are specific to an actor and a file occurrence in a scope/layer.
An explicit mark or unmark after recapture replaces that actor's earlier mark;
the original snapshot anchor remains in event history. Other actors' marks are
preserved. Decision freshness becomes unverified when its matching source
capture expires; the historical decision itself remains readable.

`ReviewAuthority` issues bounded, revocable grants through a trusted in-process
issuer. Client requests contain no actor or role fields. Human-only grants permit
decisions, resolution and reopening; an agent result leaves the concern open.
Comment/reply edits and deletions preserve their event history. Agents can edit
their own text, but cannot alter another author's contribution or delete a thread
containing somebody else's reply. Changing another author's text requires a
trusted human decision grant. This is an
internal authority contract, not yet browser/CLI/MCP authentication integration.

Claims have an increasing epoch and an unpredictable claim ID. Reclaiming work
invalidates old claims. Claim operations also require an agent principal; a human
or system grant with the same actor ID cannot impersonate the claimed worker.
Cancellation requested during work remains distinct from
worker-confirmed cancellation, failure, expiration and unknown outcome. New work
and decisions compare a fresh capture against the recorded source identity.
The state read is explicitly `freshness: "not-checked"`; it does not claim to
have rechecked external editors.

`createApp` and `startServer` can explicitly receive an already owned `ReviewCore`
or an asynchronous factory. The factory receives the server's capture/get source
adapter, so core operations and files/hunks/slice/search share retained snapshot
IDs, source bytes and expiration. Changed source cannot approve the old capture;
historical pages remain available until retention ends. The factory does not
capture Git implicitly or mint credentials. `startServer` awaits readiness before
listening and closes factory-created cores on shutdown or startup failure.
Supplied core instances remain caller-owned. Embedded `createApp` callers await
`reviewCoreReady` and retain responsibility for closing their core.
That enables `/api/review-core/state`, `/events`, `/handoffs/:id`, and POST `/operations`.
No store or grant is created without that explicit opt-in;
normal launches return `review_core_disabled` for this API. Every request requires
`X-Diffing-Review-Credential`, independently of ordinary server authentication.
Client role/model fields cannot supply authority, and there is no grant-minting
HTTP operation. The explicit headless CLI bootstrap described below issues separate
connection credentials; automatic browser/MCP connection remains pending.

When an owned core is supplied, classic comment/plan/viewed/handoff and registration
routes return `review_core_required` instead of reading or mutating a parallel
legacy store. Classic evidence discussion also refuses to read a different set
of comments. An edit-save request carrying legacy anchor updates is rejected
before any file write. This HTTP guard alone is limited to this server instance;
the explicit migration entry point supplies cross-process classic-store fencing.
It is not a completed classic-client adapter.
Normal launches keep their existing routes.

Operation bodies use the strict core request schema and a 256 KiB limit. Success
returns the committed sequence and typed result. Unknown write outcomes return
503 with `retry_same_request`; conflicts return 409. Event reads require the full
review identity and a safe sequence cursor, reject repeated/unknown parameters,
and fit the 512 KiB replay ceiling. Handoff reads return the latest handoff status
alongside the exact sent discussion, snapshot manifest and fingerprints projected
at the original transaction sequence. Later comment edits/deletions, compaction
and restart do not change that historical payload or require Git recapture.
A larger state or handoff projection returns 413 with
`read_events` instead of an unbounded response. Responses disable caching.

`ReviewClient` uses the same runtime schemas from browser-safe contract modules.
It accepts an independently issued credential and optional ordinary session
headers, pins the review identity, refuses redirects, and bounds streamed
responses to 512 KiB. Reconnect pages must contain consecutive sequences and a
continuation that makes progress. Requests are checked against the 256 KiB UTF-8
byte limit before transport.

`prepareReviewRequest` captures the expected version, request key and source
snapshot. Callers retain that exact envelope until the outcome is known; the
client never retries or rebases automatically. A disconnected response,
malformed or mismatched acknowledgement, or generic internal error after a
write returns `outcome_unknown` with `retry_same_request`. Resending the original
request reconciles with the durable acknowledgement, including after reopening
the store. Authorization and version conflicts remain explicit errors. This
transport primitive does not issue grants or activate classic UI/CLI adapters.

`GET /api/review-core/legacy/sources/:name` recovers committed original bytes for
`comments.json`, `plans.json` or `viewed.json`. It requires read authority, accepts
`offset` and a positive `limit` up to 49,152 bytes, and returns source name/length/
SHA-256, base64 bytes and the next offset. Every page carries the review identity
and `legacy-unverified` provenance. Missing sources return 404; duplicate, unknown
or out-of-range parameters return 400. Original plan versions, unknown fields and
whitespace are preserved; absent history is not synthesized. `ReviewClient` checks
page progress and identity; `exportLegacySource` bounds allocation to the source
limit and verifies the assembled SHA-256 before returning bytes. Legacy approvals
remain archived text and do not become decisions in the new review.

### Explicit headless launch

`diffing review-core serve --adopt` is an experimental local bootstrap. It refuses
existing registered classic owners, holds the workspace startup lease for its
lifetime, migrates under the shared legacy writer lease and starts the durable
core on IPv4 loopback. Stop older binaries before adoption: they do not implement
the new writer fences. Later `diffing review-core serve` reopens the same review;
first adoption without `--adopt` fails before creating a database.

The command emits only the origin, identity and two private connection-file paths.
The files contain `origin`, `identity`, `actor`, `credential`, session `headers` and
`expiresAt`. Supply a selected file's contents to `ReviewClient`. The human file
grants read/capture/comment/handoff/decide; the agent file grants read/capture/
comment/work for recipient `external-agent`. Never give an integration the human
file. Files are exclusively created in a fresh private directory (0700 directory,
0600 files on POSIX); Windows relies on the user's storage ACL. Credentials are
not written to the session registry, URLs or CLI output. Independent access to the
user's shell/filesystem remains outside this capability boundary.

This launch exposes core operations and bounded diff summary/files/hunks/slice/
search reads. It serves no browser UI or classic mutation routes. The ordinary
session token alone cannot read the core or acquire decision authority. No
provider, browser launch, commit or external write is initiated. Credentials last
at most 24 hours; restart rotates them while preserving actor and review identity.
SIGINT/SIGTERM closes the server/core and removes connection files; a crash may
leave private files whose old credentials cannot authorize the next incarnation.
Failed startup closes owned resources and releases the launch lease. A committed
migration remains authoritative even if subsequent binding fails.

Automatic classic cleanup skips durable authority markers and busy writers. It
rechecks eligibility under the shared legacy lease and removes only named classic
data, preserving the immutable coordination record, directory and unknown backups.
Old JSON timestamps or a missing checkout cannot delete an adopted review.

The headless command intentionally does not publish a classic session registry
entry. Classic `url`, browser, TUI and MCP aliases still need the P3 adapters.
Use the emitted connection files while this foundation API is under qualification.
Real CLI/helper qualification lives in `scripts/review-launch-qualification.test.ts`.

Classic clients and `ReviewSession` still require durable operation adapters.
Legacy archives can be imported explicitly under coordinated writer exclusion;
no application state is migrated automatically. Browser activation and rollback,
application adapters, and the remaining transport authority tests
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

Remaining P1 work includes native scope parity and source anchors
for viewed state, review items and decisions. The
delivery ledger outside the source tree tracks full AC proofs separately; a
passing file-page regression does not close a phase or a broader AC.
