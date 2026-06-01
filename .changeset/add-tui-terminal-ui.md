---
"diffing": minor
---

Add an opt-in `diffing --tui` mode that opens a native-Rust terminal UI mirroring the web review dashboard. The Node CLI is the single source of truth for arg parsing, lockfile discovery, and agent handoff; the new binary at `crates/diffing-tui/` is a leaf renderer that reads `~/.diffing/<repo>/*` on disk and writes a `server.json` lockfile with `mode: "tui"`.

**Stack**: Rust 1.78+ workspace (`crates/diffing-core/` shared lib + `crates/diffing-tui/` binary), `ratatui` + `crossterm` for rendering, `syntect` for syntax highlighting, `fff-search` later for search, `notify-debouncer-full` for live updates.

**Phases shipped (approved plan 30376cf5 v3):**
- **A — skeleton**: CLI plumbing, TTY/binary gates, fallback to `git diff` when no TTY or no binary, server.json lockfile with `mode: "tui"`, opt-in only (default `diffing` behavior is byte-identical).
- **B — diff render + file tree**: unified-diff parser, syntect highlighter, 8 color themes, vim-style keymap (`j/k/gg/G/J/K/Tab/w/t/m/?//`), file tree with status markers, virtualised diff card.
- **C — comments + tracker**: full `ReviewComment` CRUD mirroring `src/lib/comments.ts`, multi-line `tui-textarea` form, comment thread, bottom tracker, `c/e/r/x/d/]/[` keys, live updates via `notify` watcher on `comments.json`.
- **D — send review + agent handoff**: `format_comments` Rust port of `src/lib/comment-format.ts` (byte-identical `<code-review-comments>` envelope), verdict radios + general comment popover, live XML preview, copies to clipboard (`pbcopy`/`xclip`/`wl-copy`), persists `pending-review.xml`, refreshes `server.json` with `mode: "tui"`, agent-status indicator in the status bar, dismissable toasts for fresh replies.

**Verification**: `cargo fmt` + `cargo clippy --all-targets -- -D warnings` + 84 cargo tests + 281 vitest tests all green; pty smoke covers the full add-comment → send-review → `pending-review.xml` cycle end-to-end.

**Caveat (filed as a follow-up, not in this commit)**: the TUI's "Send to agent" writes the review to disk + clipboard but does not actively unblock a long-polling `diffing await-review` — that requires a Node-side change. The web UI's send button remains the supported native handoff path.

Next: **Phase E (search palette)** — see `diffing plan show 30376cf5` for the approved scope.
