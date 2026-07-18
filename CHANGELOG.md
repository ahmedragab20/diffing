# Changelog

## Unreleased

## 0.7.0

### Minor Changes

- Plan + diff review UX: multiline comments, zen/outline/comments shortcuts, severity handoff, and TUI mouse-first work.

  **Plan review**
  - Quieter reading-first chrome; centered Source / Read / Split control; icon actions with tooltips.
  - Resizable split panes (persisted); full-width Read mode; immersive zen reading.
  - **Read mode always shows inline comments** under the matching section (React-owned segments — survives mode switches).
  - Multiline plan comments with range steppers in source composers and floating Read drafts.
  - Collapsible comment threads; collapsible in-card source preview; delete resolved comments and replies.
  - Float-composer highlights remeasure after layout shifts (e.g. deleting a comment).
  - Keyboard: `m` cycle views, **`z` zen**, **`o` outline**, **`c` comments map**, Esc exits zen; shortcuts modal and tooltips updated.
  - Tooltips stack above sticky plan/diff chrome.

  **Diff review**
  - Compact toolbar summary chips; icon-forward file headers; cleaner file-tree chrome.
  - Improved send-review CTA; quieter comment canvases; expanded keyboard shortcuts help.
  - Diff style (Unified / Split) lives in Settings (and `m`).
  - Submit-review popovers: shared resize (width + height + corner), size presets; no dismiss when releasing a drag past max size.
  - Commit walk bar polish.

  **Inline comments (diff + plan)**
  - Fix form anchoring to the correct side and line (same-side selections no longer default to additions and land at EOF).
  - Multiline ranges: normalize reverse drags; inclusive `startLineNumber`–`lineNumber`; pierre gutter via `onGutterUtilityClick` only (no dual-API crash).
  - Bidirectional range steppers in the composer; stable draft keys while adjusting.
  - Severity dropdown (design-system Select) with icons/hints: `blocking` | `nit` | `question` | `praise`.
  - Severity persisted and emitted on agent handoff XML for **diff** and **plan**; MCP `create_comment` accepts optional severity.
  - Collapsible open/resolved threads on diff and plan cards.

  **Agent skills**
  - `skills/` and `.agents/skills/` updated for severity, multi-line ranges, plan UI shortcuts, and finish-review priority rules (byte-identical contract).

  **Roadmap (rolled up)**
  - GitHub PR repair, multi-round review history, suggestions + severity + saved replies.
  - MCP/CLI lifecycle tools (`edit`/`unresolve`/`delete`/`apply_suggestion`/`progress`/`doctor`/completions).
  - Navigation: whitespace toggles, filter chips, deep permalinks, commit-walk bar, hybrid minimap.
  - Agent progress toast, multi-agent waiters, markdown export.

  **Docs / branding**
  - Remove remaining fork attribution from README and landing.

  **Native TUI**
  - Scalable mouse-first review interface (opt-in `--tui`).

## 0.6.2

### Patch Changes

- Brand mark + README polish.

  - New `<BrandMark>` component in `src/ui/components/BrandMark.tsx` renders the existing favicon SVG at any size, replacing five copies of inline `<img src="/favicon.svg" />` scattered through the app.
  - The mark now anchors every identity surface: the diff toolbar, the plan-review toolbar, the PR-review header, the Theme picker header, the Shortcuts modal header, and the boot loader — so the user sees the same friendly face everywhere instead of just one spot.
  - README mirrors this: the npm page now shows the brand icon directly under the title, giving the package the same identity inside the README as it has inside the running app.

## 0.6.1

### Patch Changes

- Review UX polish + handoff safety nets.

  - Brand mark: an adorable gradient favicon is now used both as the browser tab icon and as a small mark next to the repo name. Empty/error states render a centered icon, title, and hint card instead of plain muted text. The first-paint loader shows the brand mark over a theme-token background so themes apply even before React mounts. Global polish adds themed `::selection`, broader `prefers-reduced-motion` coverage (kills shimmer + infinite spin), and a dynamic `document.title` that reflects the repo and branch.
  - New "Comfort" settings: pick a `density` (Comfortable / Compact) which applies a `data-density="compact"` attribute on `<html>`, an `autoCollapseLineThreshold` that collapses very large file cards on mount, a `requireViewAllBeforeSend` toggle that surfaces a confirm prompt when some files in the diff are still unmarked, and a `showStatusBar` toggle that hides the vim-style status bar at the bottom of the review UI.
  - Bulk review actions: a "Resolve all" toolbar button calls `POST /api/comments/resolve-all` (added to both `InMemoryCommentStore` and `FileCommentStore`), and the latest handoff round + verdict shows up as a small "Round N · VERDICT" badge in the toolbar.
  - Multi-tab sync: the viewed-files endpoint now broadcasts a `viewed` SSE event, and `useViewed` subscribes so marking a file viewed in one browser tab reflects in the other.
  - Secret-leak guard: `sendToAgent` detects strongly-typed credentials (AWS, GitHub, Slack, JWT, private keys, generic `api_key=…`, and connection strings with passwords) and the server blocks the send with HTTP 400 + `secrets-detected` findings. The review popover renders a callout listing every match and lets the reviewer explicitly "Send anyway" with `force: true`.

## 0.6.0

### Minor Changes

- 23c6793: Make diffing self-discovering and fully usable from MCP-only agents, including repository-bound session startup, native diff/comment tools, structured tool contracts, and portable synchronized skills.
- 107fd0d: Enhance show command's commit range display: consolidate multiple CommitBanner alerts into a single overview banner with detailed commit rows (SHA, subject, author, date, expandable body). Overview subtitle now shows the range label, authors, and date range. Toolbar shows +/- diff stats in show mode after the commit count.

## 0.5.1

### Minor Changes

- Smooth scroll to next file when collapsing a file card or marking it as viewed.
  The page no longer "jumps" or lands two files ahead — it scrolls smoothly to the
  immediate next card using DOM sibling traversal for reliable positioning.
  (`useScrollToNextFile` hook)

- Add "What is this diff?" overview banner that summarizes the commit series
  when reviewing a range of commits or a PR branch. The banner shows the commit
  subjects, authors, and a natural-language summary generated from the diff
  metadata.

### Patch Changes

- Fix "Path collides" crash in FileTree when file paths share a common prefix
  (e.g., `src/a.ts` and `src/a/b.ts`). Paths are now sanitized before tree
  insertion to prevent false collision detection.

- Add `user_invocable` field to agent skill files for proper skill registration.

## 0.5.0

### Minor Changes

- Expandable submit panel with 2D size presets and left-edge horizontal resize.
  The "Send review to agent" and "Submit plan review" popovers now have
  S(420×340), M(480×440), L(560×560), and XL(640×760) presets that control
  both panel width and height. A left-edge drag handle lets users resize the
  panel width independently. The "Overall comment" textarea flex-grows to fill
  available vertical space.
- Fix verdict row alignment in the submit panel. Radio circles and icons now
  top-align consistently across rows regardless of description text wrapping.
- Fix Write/Preview tab layout in the "Overall comment" MarkdownField. Tabs are
  now laid out horizontally with content-width sizing.
- Status bar collapsed by default. The Vim-style status bar at the bottom of
  the app starts collapsed to maximize main content area. Expand with the toggle
  button or Cmd+B.
- Fix comments count chip text wrapping in the submit panel header at narrow
  preset widths.
- Fix inverted submit panel resize direction. Dragging the bottom handle down
  now correctly increases panel height.

## 0.4.1

### Patch Changes

- Remove the vim-style `Ctrl+O` / `Ctrl+I` scroll jump-list feature. The jumplist was causing unexpected page scrolls and stability issues, so all related state (`useJumpList`), keyboard handlers, and shortcut help entries have been removed.
- Fix stale PR session leaking into local review mode. `createApp` now receives an explicit `prMode` flag; `/api/diff` and all `/api/gh/*` routes are active only when the server was started with a PR ref. A leftover `pr-session.json` from a previous `diffing "gh pr N"` run no longer hijacks a plain `diffing` invocation.

## 0.4.0

### Minor Changes

- e209e06: Browse plan versions. Every body the agent ever submitted is now kept on disk, so reviewers can switch between past versions of the same plan in the UI, the CLI, and the MCP server.

  - **Storage**: `Plan.versions: PlanVersion[]` is appended on every `diffing plan submit --id <id>` and seeded with one entry on first submit. `PlanComment.createdAtPlanVersion` is stamped at write time so comments stay anchored to the version they were written on. Legacy `plans.json` files are backfilled transparently.
  - **Server**: two new endpoints — `GET /api/plans/:id/versions` (list, oldest-first) and `GET /api/plans/:id/versions/:n` (single historical snapshot with `{ version, plan: { id, title, decision, currentVersion } }`).
  - **CLI**: `diffing plan versions <id>` lists every version (current marked with `*`); `diffing plan show <id> --version N` reads any past version as `<plan-review>` XML, with the plan's `<plan>` element tagged `viewing-version` and comments filtered to those anchored to that version.
  - **MCP**: `get_plan_versions` lists versions; `get_plan_version` reads one. The `await_plan_review` handoff XML is version-aware: when an agent is reading a historical version it only receives the comments anchored to that version.
  - **UI**: a `<History>`-iconed version dropdown sits in the plan meta row next to the `v{n}` chip. Picking an older version swaps the body, swaps the title, surfaces a "Viewing v{N} of v{M}" amber banner, and filters the comment list to those anchored to the viewed version. A "Back to current" button restores the latest body. When the server pushes a new version via SSE, the viewer auto-follows only if the user was on the previous current — never auto-bumps someone who's reading history.
  - **Tests**: 10 new `InMemoryPlanStore` version-history tests (`src/__tests__/plans-versions.test.ts`), 6 new endpoint tests (`src/__tests__/plan-endpoints.test.ts`), 2 new `formatPlanReview` version-rendering tests (`src/__tests__/plan-format.test.ts`), 2 new hook tests (`src/ui/hooks/__tests__/usePlans.test.tsx`), 3 new component tests (`src/ui/__tests__/PlanReview.test.tsx`).

- cc9826b: Add 'Comment only' mode to Send to agent and Submit plan review.

  - New `comment-only` verdict option in both `SendReviewPopover` and `SubmitPlanReviewPopover`.
  - `ReviewMode` / `PlanMode` types (`'standard' | 'comment-only'`) passed through hooks (`useComments`, `usePlans`) to the server.
  - `/api/review/send` and `/api/plans/:id/decision` accept the mode; included in `ReviewPayload` and `PlanReviewPayload`.
  - `formatComments` and `formatPlanReview` emit the mode in the XML handoff with special instructions for comment-only reviews.
  - CSS styles for comment-only badges and verdict options.
  - Updated skill docs for `diffing-plan-review`, `diffing-review`, `diffing-finish-review`, `diffing-start-review`.

- 264e9d6: Add `@` file mentions in comments and replies.

  - Type `@` in any comment or reply to trigger an fff-powered fuzzy file finder.
  - Arrow keys navigate, Enter/Tab select, Escape dismiss.
  - Files render shortened in preview (filename only, dotted underline, hover shows full path).
  - Dropdown positioned under cursor line with theme-aware highlight.
  - `Cmd+Shift+P` shortcut to toggle preview mode in comments.
  - New `useFileMention` hook and `FileMentionDropdown` component.
  - Updated shortcuts help modal and README documentation.

### Patch Changes

- bd35d8f: Fix legacy plan version backfill. Plans at `version: N > 1` when the version-switcher shipped previously appeared to have a single version — no dropdown, no "Viewing v{N} of v{M}" banner. `backfillPlan` now synthesizes one entry per recorded version (1..N); `FilePlanStore.getAll` writes the backfilled plans back to disk once so legacy plans no longer pay the re-synthesis cost on every restart.

- b522e9b: Add collapsible VimStatusBar with `Cmd+B` toggle and improved keyboard support. Rewrite all four skill files (`diffing-plan-review`, `diffing-review`, `diffing-start-review`, `diffing-finish-review`) with detailed CLI references, MCP alternatives, and cleaner formatting. Overhaul `AGENTS.md` with complete workflows, skill registry, and development conventions.

- 43d03fa: Add a "Keep the project clean" section to `AGENTS.md` (working files under `.diffing/`, not at the project root). Refresh the marketing landing page interactions and copy. Normalize quote style and semicolons in `startup-display.ts` animation primitives (no behaviour change).

- 70ef359: Extract jumplist state into a `useJumpList` hook, fixing a stale-closure bug where multiple `addToJumpList` calls batched in the same React tick broke truncation and the max-size cap. Add 18 `useJumpList` tests and 12 `ShortcutsHelpModal` tests (including `Ctrl+O` / `Ctrl+I` jump-list entries). Fix `PlanReview.test.tsx` mock to include the new `MessageSquare` icon from the comment-only feature.

## 0.3.0

### Minor Changes

- cfa206d: Add a GitHub PR review mode to `diffing`. Review a pull request in the same diff UI you already use for the working tree, then push the review to the actual PR — no copy-paste of inline comments.

  **Usage**:

  - `diffing "gh pr 1234"` (or `--gh-pr 1234`) — open PR #1234 in the current repo.
  - `diffing "gh pr https://github.com/foo/bar/pull/42"` — full URL form.
  - `diffing "gh pr foo/bar#42"` — `owner/repo#N` shorthand.
  - `diffing gh pr-review <ref> --decision <approve|comment|request-changes> [--body <text>]` — headless submit (CI / agent use).
  - `diffing gh pr-fetch <ref>` — dump PR metadata as JSON.
  - `diffing gh pr-list-comments` — list in-progress PR-mode comments (mirrors `diffing comments`).
  - `diffing gh status` — show the active PR session (ref, owner/repo#n, comment count, submitted status).

  **Behaviour**:

  - Renders the PR's unified diff in the existing `<DiffViewer>` / `<FileTree>` machinery — no new renderer, no parallel UI. Existing PR review comments are fetched and shown as a read-only summary strip below each file so you can see what was already said before adding your own.
  - "Submit to GitHub" builds a `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` payload (the standard GitHub REST shape) and POSTs it. Multi-line comments are expanded to N single-line comments with a `[part N/M]` prefix. Existing comments are **never re-POSTed** — only the new ones.
  - Auth: prefers the `gh` CLI (uses your existing `gh auth`). Falls back to `$GH_TOKEN` / `$GITHUB_TOKEN` / `$GITHUB_API_TOKEN` env vars when `gh` is missing or not authenticated.
  - Verdict mapping: `approve → APPROVE`, `request-changes → REQUEST_CHANGES`, `comment → COMMENT`. The popover also offers `rejected` (an internal option) which maps to `REQUEST_CHANGES` because GitHub has no REJECT event.
  - Storage: new `pr-session.json` sidecar in `~/.diffing/<repo>-<hash>/` — never collides with `comments.json` or `plans.json`. The local review flow and the plan review flow are byte-identical to before; all `/api/gh/*` routes 404 when no `pr-session.json` exists.
  - The local "Send to agent" popover is **structurally absent** in PR mode — there's no way to invoke the agent handoff while reviewing a PR. A "Back to local review" button is provided.
  - Web only for v1; TUI is unaffected.

  **Plan**: `0ace193e-6f45-4750-838f-534bba8acad2` v3 (approved).

  **Tests**: 10 PrSession store tests (`src/lib/__tests__/pr-session.test.ts`), 19 payload / mapping / parsePrRef tests (`src/lib/__tests__/pr-payload.test.ts`), 8 server route tests (`src/__tests__/gh-pr.test.ts`), 4 PrReviewApp empty-state tests (`src/ui/__tests__/PrReviewApp.test.tsx`).

- 6d34a91: Add an opt-in `diffing --tui` mode that opens a native-Rust terminal UI mirroring the web review dashboard. The Node CLI is the single source of truth for arg parsing, lockfile discovery, and agent handoff; the new binary at `crates/diffing-tui/` is a leaf renderer that reads `~/.diffing/<repo>/*` on disk and writes a `server.json` lockfile with `mode: "tui"`.

  **Stack**: Rust 1.78+ workspace (`crates/diffing-core/` shared lib + `crates/diffing-tui/` binary), `ratatui` + `crossterm` for rendering, `syntect` for syntax highlighting, `fff-search` later for search, `notify-debouncer-full` for live updates.

  **Phases shipped (approved plan 30376cf5 v3):**

  - **A — skeleton**: CLI plumbing, TTY/binary gates, fallback to `git diff` when no TTY or no binary, server.json lockfile with `mode: "tui"`, opt-in only (default `diffing` behavior is byte-identical).
  - **B — diff render + file tree**: unified-diff parser, syntect highlighter, 8 color themes, vim-style keymap (`j/k/gg/G/J/K/Tab/w/t/m/?//`), file tree with status markers, virtualised diff card.
  - **C — comments + tracker**: full `ReviewComment` CRUD mirroring `src/lib/comments.ts`, multi-line `tui-textarea` form, comment thread, bottom tracker, `c/e/r/x/d/]/[` keys, live updates via `notify` watcher on `comments.json`.
  - **D — send review + agent handoff**: `format_comments` Rust port of `src/lib/comment-format.ts` (byte-identical `<code-review-comments>` envelope), verdict radios + general comment popover, live XML preview, copies to clipboard (`pbcopy`/`xclip`/`wl-copy`), persists `pending-review.xml`, refreshes `server.json` with `mode: "tui"`, agent-status indicator in the status bar, dismissable toasts for fresh replies.

  **Verification**: `cargo fmt` + `cargo clippy --all-targets -- -D warnings` + 84 cargo tests + 281 vitest tests all green; pty smoke covers the full add-comment → send-review → `pending-review.xml` cycle end-to-end.

  **Caveat (filed as a follow-up, not in this commit)**: the TUI's "Send to agent" writes the review to disk + clipboard but does not actively unblock a long-polling `diffing await-review` — that requires a Node-side change. The web UI's send button remains the supported native handoff path.

  Next: **Phase E (search palette)** — see `diffing plan show 30376cf5` for the approved scope.

- 476d668: Add a `diffing show <revspec>...` subcommand that is a drop-in for `git show` and surfaces commit metadata (subject, author, date, message body) in a `CommitBanner` above the diff in the web UI. Resolves the "viewing a commit's diffs" empty-file-list confusion: `diffing <sha>` runs `git diff <sha>` (working tree vs `<sha>`), so when the working tree matches `<sha>` the patch is empty; `diffing show <sha>` always renders the commit's changes.

  **Behaviour**:

  - Accepts every form `git show` understands — single commit, range (`a..b`, `a...b`), tag, branch tip, multiple SHAs.
  - Pathspecs work via `--`: `diffing show HEAD -- src/`.
  - Terminal mode streams `git show --no-color --no-ext-diff` byte-for-byte (verified by 7 e2e tests in `src/__tests__/cli-show.test.ts`).
  - Web UI stacks a `CommitBanner` per commit (short SHA, author, relative date, committer-different badge, collapsible body, copyable SHA). Soft cap of 100 commits per invocation (`MAX_SHOW_COMMITS`) with the over-limit count surfaced in a `+N more commits not shown` badge.
  - Strictly opt-in: `diffing <sha>` keeps its current `git diff <sha>` semantics; no auto-detection.

  **Plan**: `0bd578e8-5b9c-4565-8e99-58599e397314` v2 (approved).

  **Tests**: 11 parser fixtures in `git-show-parse.test.ts`, 4 server-side `showMode` cases in `server.test.ts`, 7 CLI e2e cases in `cli-show.test.ts`, 9 component tests in `CommitBanner.test.tsx`. All 312 vitest tests pass.

- 59d1059: Add a copy icon to the file path in each file diff card header. Clicking it writes the full path to the clipboard and shows a brief "Copied path" flash (matching the existing line-permalink copy UX). No keyboard shortcut — the icon itself is the affordance.
- Make the web UI responsive on phones, tablets, and narrow windows. Previously the diff review and plan review surfaces assumed a desktop layout — the sidebar was a fixed-width column, the toolbar had verbose text labels, and popovers were sized for a wide viewport. On a phone you couldn't get to the file tree without horizontal scroll and the toolbar overflowed.

  **Changes**:

  - New CSS media-query breakpoints at `≤768px` (mobile) and `≤1024px` (tablet) in `src/ui/styles/global.css`.
  - The file-tree sidebar becomes a slide-in overlay drawer on mobile, with a backdrop that dismisses on click or Escape.
  - The sidebar auto-collapses on first load on a narrow viewport when no stored preference exists (the user's previous explicit toggle is still remembered).
  - Toolbar buttons drop their text labels on mobile and show a hamburger toggle to open the drawer.
  - Main / plan content padding and popover `max-width` shrink at each breakpoint so a phone-width window has usable margins and the send-review popover doesn't overflow.
  - Touch targets on file rows, plan list items, and the main toolbar buttons are bumped to a comfortable tap size on small screens.

  Applied to both the diff review (`App.tsx`) and plan review (`PlanReviewApp.tsx`) surfaces. Desktop layout is unchanged above `1024px` — no visual regression for the existing user base.

### Patch Changes

- Cross-platform parity fixes for Windows and Linux. `diffing` was developed and tested primarily on macOS, which left six real-world correctness bugs in the Node and Rust code paths that only surfaced when running on Windows or a non-macOS Unix host. All six are fixed here, each backed by a regression test.

  **Node (`src/`)**:

  - `src/lib/path.ts#toSafeRelativePath` was hard-coded to compare against `'/'` after `resolve()`. On Windows `resolve()` returns backslashes, so every legitimate path failed the safety check and the static file server and git endpoints returned 403 for every request. Now uses platform `sep`.
  - `src/lib/git.ts` synthesised a unified diff for untracked files using `content.split('\n')`, which left a trailing `\r` on every added line for files committed on Windows (or anywhere with `core.autocrlf=true`). Extracted `splitLines(content)` matching `/\r\n|\n|\r/` — same rule the git-log parser already used — and applied it at all three call sites (`getUntrackedFilesDiff`, `getUntrackedFilesDiffAsync`, `getFilePatch`).
  - `src/server.ts#POST /api/open-file` was a stack of `exec()` branches that hard-coded `osascript` (macOS) and `code` (macOS/Linux only) and had no Windows path at all. Replaced with `src/lib/editor-launcher.ts#resolveEditorCommand(editor, absolutePath)` that returns structured `{ cmd, args }` for `execFile` (no shell, deterministic quoting for paths with spaces), with explicit `.cmd` / PowerShell handling on Windows, `code.cmd` / `zed.cmd` resolution via PATHEXT, and a Linux terminal-editor launcher that respects `$TERMINAL` before falling back to `x-terminal-emulator`.
  - `src/lib/github.ts#detectGhCli` read only `stdout` from `gh auth status`, but that line lands on `stderr` on older `gh` releases and on Windows builds. Now concatenates both streams and matches both the modern `"account <user>"` phrasing (gh 2.40+) and the legacy `"as <user>"` form.
  - `src/lib/find-tui-binary.ts` (newly extracted from `src/cli.ts`) now also checks `target/debug/diffing-tui[.exe]` so `cargo build` workflows can spawn the TUI without a `cargo build --release` first. The previous top-level-`process.exit(1)` `cli.ts` made this code untestable, so it lives in its own module now.

  **Rust (`crates/diffing-tui/`)**:

  - `is_lock_alive` was a Unix-only `kill(pid, 0)` check with a permissive fallback, so a stale `server.json` lock was never detected on Windows and the CLI would refuse to start. Now branches on `cfg(windows)` and probes with `tasklist /NH /FO CSV /FI "PID eq N"` (no new dependency — `tasklist.exe` ships with every supported Windows release). The CSV-parsing rule is a plain string check and is unit-tested on every host so a regression surfaces on macOS/Linux CI too.
  - `copy_to_clipboard` only knew about `pbcopy` / `xclip` / `wl-copy`, in that order. On Linux, `xclip` was preferred over `wl-copy`, which means a Wayland-only session would silently try an X11 tool. Reordered to `wl-copy` → `xclip` → `xsel`, and added `clip.exe` + PowerShell `Set-Clipboard` candidates for Windows. The `clip.exe` path converts `\n` → `\r\n` in the payload (matches the pasting UX of typical Windows apps).

  **Tests added**: 2 in `path.test.ts` (Windows-style path safety), 4 in `git.test.ts` (CRLF / LF / bare-CR / mixed line endings), 17 in `editor-launcher.test.ts` (per-platform resolution for vscode, zed, vim, neovim, default), 8 in `github-auth.test.ts` (stdout / stderr / account-vs-as phrasings), 10 in `find-tui-binary.test.ts` (sibling / `bin/` / `target/release/` / `target/debug/` / `$PATH` lookup including CRLF `where` output), 5 in `server_lock.rs` (`tasklist` CSV hit / miss / no-substring-false-positive, plus Unix self / dead-pid), 3 in `app.rs` (per-platform clipboard candidate ordering + `clip.exe` CRLF).

  All 404 vitest tests and 64 cargo tests pass after the change. `cargo clippy --all-targets -- -D warnings` is clean on both crates.

- Fix three related bugs in the GitHub PR review startup path that made `diffing "gh pr 1"` and similar quoted forms open the web UI with an empty diff.

  1. **Race in `startServer`**: the PR session was built in an unawaited IIFE, so the port-bound callback resolved with `prMode=false`. The lockfile was written as `mode: "web"` and the UI's first `/api/diff` call fell through to an (empty) local diff before the session landed in the store. Now `await prReady` before `serve()` binds the port.

  2. **Quoted-form never matched**: the original PR-mode guard required `args.length >= 3` and `args[0] === 'gh'`, which only fires for the unquoted shell shape. With quotes the shell passes a single `"gh pr 1"` arg, the string was forwarded to `git diff` as a revision (silently swallowed by `getCustomGitDiffAsync` → empty patch), and the UI rendered an empty diff. The parser now detects the leading `gh pr ` / `gh pr-review ` / `gh pr-fetch ` prefix in the raw arg, so both quoted and unquoted forms work.

  3. **`parsePrRef` tight-constraint**: the parser required a digit-only ref segment and an optional `owner/repo#n` form, but GitHub URLs like `https://github.com/foo/bar/pull/42.atom` and `gh pr foo/bar` (no `#N`) were rejected. The new parser accepts numeric refs, `owner/repo#N`, and full GitHub PR URLs with arbitrary trailing path segments; the previous tests still pass.

  **Tests added**: 7 new `parsePrRef` cases (URL variants, `owner/repo#N`, `gh pr foo/bar` without `#N`, quoted-form detection in argv) and 1 new `startServer` race regression that asserts the lockfile is `mode: "tui"` or `mode: "web"` only after the PR session is in the store.

- f4d998f: Load user-selected fonts as web fonts so custom font picks actually render

  Previously only the two built-in defaults (Geist Mono / JetBrains Mono) were fetched from Google Fonts, and only when they were _not_ overridden. Selecting any other font therefore named it in CSS but never loaded a matching font face, so it silently fell back to system monospace — most visibly in code diffs. The font picker now always requests the chosen UI and mono families from Google Fonts (the request degrades gracefully: families Google does not host are dropped server-side without breaking the valid ones).

  Note: a locally-installed font that isn't hosted on Google Fonts (e.g. a Nerd Font, or a commercial font like Dank Mono) is applied by name and renders only if the browser lets pages use local fonts. Privacy browsers such as Brave block uncommon local fonts via fingerprinting protection, in which case the font falls back regardless — pick a Google-hosted family, or allow fingerprinting for the site in Brave's Shields.

## 0.2.1

### Patch Changes

- **Server-Side State Persistence**: Migrated browser/client-side storage (settings, session state, drafts, uiState) to the backend-persisted global directory (`.diffing`), eliminating browser-dependent storage issues.
- **Font Customization support**: Added dynamic selection and preview of custom UI and code font families via a new `FontPickerModal` with clean injection logic.
- **Animated Console Startup Display**: Introduced dynamic terminal-based animations (Typewriter, Wave Reveal, Glitch Noise, Matrix Rain, etc.) in monochromatic 256-color schemes featuring 30 motivational/funny developer quotes.
- **Polished Comment & Reply UI/UX**: Unified layout styles injected into the shadow DOM to fix text overflow/wrapping and resolve sticky header overlap on the Plan page.
- **Update Disclaimer and CLI Command**: Added an automated npm update checker on server start and a dedicated `diffing update` CLI subcommand to seamlessly upgrade the CLI.

## 0.2.0

### Minor Changes

- **Plan review** — agents can now submit implementation plans (`diffing plan submit`) for human review before writing code. Plans appear in a dedicated `/plan/:id` UI with source/rendered views, inline line comments, range selection, general comments, and an approve / request-changes / reject verdict that the agent polls for.
- New `diffing plan` CLI subcommands: `submit`, `get`, `list`, `update`, `comment`, `reply`, `resolve`, `unresolve`, `decision`.
- MCP tool surface extended with `plan_submit`, `plan_get`, `plan_list`, `plan_update`, `plan_comment`, `plan_reply`, `plan_resolve`, `plan_unresolve`, `plan_decision`.
- Agent activity toast shows real-time agent replies and plan comment notifications in the browser UI.
- `diffing-plan-review` skill for Claude Code / Gemini CLI / Copilot — submit a plan, block until verdict, act on inline comments.

## 0.1.1

### Patch Changes

- Bug fixes and minor improvements since initial release.

## 0.1.0

- Initial release
