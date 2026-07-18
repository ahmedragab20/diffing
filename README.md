# diffing

<p align="center">
  <img src="public/favicon.svg" alt="diffing brand icon" width="72" height="72" />
</p>

A local-first code review tool and double-sided bridge designed for the modern AI coding agent workflow. Review AI-generated changes in a high-fidelity, GitHub-like web UI, leave inline comments, and hand them back to your coding agent to fix in real time — and review the agent's **plan** the same way *before* it writes any code, approving, rejecting, or requesting changes on specific lines and sections.

<img width="1624" height="1061" alt="image" src="https://github.com/user-attachments/assets/c1e12c28-610e-4d68-abb1-3c8dde58560e" />
<img width="1624" height="1061" alt="image" src="https://github.com/user-attachments/assets/95a51403-3bce-453c-a831-43a2834c5ed7" />

---

## Quick Start

### 1. Install
Install `diffing` globally via npm:
```bash
npm install -g diffing
```

### 2. Run
Launch it within any active git repository:
```bash
diffing
```
This instantly spins up a local server, establishes an active repository watcher, and opens your default browser to an interactive code review dashboard.

Prefer the terminal? Add `--tui` for a native-Rust terminal UI — same review flow, no browser:
```bash
diffing --tui
```
> [!WARNING]
> The TUI is **experimental**. The interface, keymap, and `server.json`
> (`mode: "tui"`) on-disk format may change in a minor release. The web UI is
> the supported path for production workflows. See
> [Native Terminal UI (TUI)](#native-terminal-ui-tui) for the full feature set,
> keymap, and stability notes.

### 3. Update
Check if a new version is available on npm and upgrade instantly via the CLI:
```bash
diffing update
```

---

## Web UI Review Dashboard

A local Hono-powered review server delivers a full-featured GitHub-like code review interface directly in your browser.

- **Split / Unified View** — Side-by-side (`split`) or inline (`unified`) layouts. Set under **Settings → Diff style**, or press `m` to cycle. Diff style is not a toolbar toggle.
- **Compact toolbar** — Repo + branch, quiet summary chips (files, `+X/−Y`, open comments), Search (`⌘K`), Plans badge, Resolve all, Settings, and **Send review**.
- **Syntax Highlighting** — Powered by Shiki via `@pierre/diffs`, with high-fidelity highlighting for 200+ languages.
- **Interactive File Tree** — Hierarchical navigation with collapsible folders, viewed/unviewed tracking, change-type indicators, smart filter chips (**All / Unviewed / Comments / Since last**), multi-select extension filters, and path search.
- **Icon file-header actions** — Expand context, open in editor, file-level comment, and Viewed — with tooltips; less chrome noise per card.
- **Status Dashboard (Comment Tracker)** — Bottom panel tracking open, replied, and resolved comments with severity filters and click-to-navigate.
- **Multi-round review** — Round history popover, “changed since last send” chips, and outdated-comment detection.
- **Server-Side State & Drafts Persistence** — No browser storage is used. Settings, panel sizes, session state, and comment drafts live under `~/.diffing/` (global settings in `~/.config/diffing/settings.json`).
- **Dynamic Font Customization** — Google Fonts or local system fonts for UI + mono (see [custom fonts](#a-note-on-custom-fonts)).
- **Resizable Panels** — Drag-to-resize sidebar (240px–640px) and comment tracker (100px–600px); sizes persisted server-side.
- **Skeleton Loading Screen** — Full shimmer placeholder UI during initial load.
- **Image Diff Previews** — Side-by-side comparison for common image formats.

---

## Themes

42+ built-in themes powered by Shiki, with instant switching and live preview.

| Category | Themes |
|----------|--------|
| GitHub Family | GitHub Dark, GitHub Light, GitHub Dark Dimmed, GitHub Dark High Contrast |
| Popular Dark | Dracula, One Dark Pro, Monokai, Synthwave '84, Material Theme (Ocean/Palenight/Darker) |
| Tokyo Night | Tokyo Night, Tokyo Night Storm, Tokyo Night Light |
| Catppuccin | Mocha, Frappe, Macchiato, Latte |
| Nord Family | Nord |
| Nightfox Family | Nightfox, Nordfox, Duskfox, Terafox, Carbonfox, Dayfox, Dawnfox |
| Rose Pine | Rose Pine, Rose Pine Dawn, Rose Pine Moon |
| Solarized | Solarized Dark, Solarized Light |
| VS Code | Dark+, Light+, Dark Modern, Light Modern |
| Others | Andromeeda, Aurora X, Houston, Laserwave, Min Dark/Light, Night Owl, One Light, Plastic, Poimandres, Slack (Dark/Ochre), Vesper, Vitesse Dark/Light, Ayu Dark/Light |

- **Searchable Theme Modal** — Press `g` `t` or use the toolbar to open a categorized, searchable theme picker with color swatches and live preview.
- **Dark/Light Dual Mode** — Each theme maps to corresponding dark and light Shiki themes for accurate syntax highlighting in both modes.
- **Instant Switching** — CSS transitions suppressed during theme changes for a snappy, lag-free experience.
- **Persistent Setting** — Theme choice saved to `~/.config/diffing/settings.json` and restored on next launch.


<img width="1624" height="1061" alt="image" src="https://github.com/user-attachments/assets/eaa0675c-21d6-4754-8fbd-97ee63a743dc" />



---

## Rust-Powered Code Search (powered by fff)

Blazing-fast, native fuzzy code search integrated directly into the sidebar search palette via `@ff-labs/fff-node`:

- **Fuzzy File Search** (`Files` scope) — Error-tolerant fuzzy matching on workspace paths using a native Rust engine.
- **Codebase Grep** (`Text` scope) — Instant case-insensitive text search with full **Regular Expression** support.
- **Syntactic Symbol Search** (`Symbols` scope) — Finds function declarations, class headers, type definitions, and variable assignments across JavaScript, TypeScript, Go, Rust, and Python (17+ language patterns).
- **Unified "All" Search** — Concurrent search across files, text, and symbols with automatic deduplication.
- **Frecency Ranking** — SQLite-backed history database remembers which files you open for specific queries, floating high-value results to the top.
- **"Changed Only" Filter** — Restricts search scope exclusively to files changed in the active git diff.
- **Git Status Chips** — Search results display git status indicators (modified, untracked, added, deleted, renamed).
- **Graceful Degradation** — If the native Rust binary is unavailable, search reports as unavailable without crashing the server.
- **Auto-Indexing** — The Rust engine maintains its own file system watcher for real-time index updates as the working tree changes.

<img width="1624" height="1061" alt="image" src="https://github.com/user-attachments/assets/2b2bc001-2d3a-4744-b9d5-a23642f1afba" />

---

## Vim-Style Keyboard Navigation

Full keyboard-driven navigation with vim-like motions and a modal status bar:

### Scrolling & Diffs
| Key | Action |
|-----|--------|
| `j` / `k` | Scroll down/up by 100px |
| `Ctrl+d` / `Ctrl+u` | Scroll half-page down/up |
| `g` `g` | Jump to top of diff |
| `G` | Jump to bottom of diff |
| `m` | Toggle split/unified view (also Settings → Diff style) |
| `t` | Cycle tab size (2 → 4 → 8) |
| `w` | Toggle line wrap |
| `n` | Toggle line numbers |
| `i` | Cycle diff indicators |
| `I` | Cycle inline diff type |
| `Cmd+Shift+P` | Toggle preview mode in comments |

### File Navigation & UI
| Key | Action |
|-----|--------|
| `J` / `K` | Jump to next/previous file |
| `v` | Toggle file viewed/unviewed |
| `b` | Toggle sidebar visibility |
| `/` | Open text search |
| `s` | Open symbol search |
| `g` `v` | Open file browser |
| `g` `t` | Open theme picker |
| `Cmd/Ctrl+K` | Open global command palette |
| `Cmd/Ctrl+,` | Toggle settings panel |
| `?` / `⌘?` | Show shortcuts help modal |

### Plan page extras (when reviewing a plan at `/plan`)
| Key | Action |
|-----|--------|
| `m` | Cycle Source → Read → Split |
| `z` | Toggle zen reading (switches to Read if needed); Esc also exits zen |
| `e` | Toggle **live plan edit** (current version; prefers Split + source editor) |
| `⌘/Ctrl+S` | While editing: flush autosave now |
| `o` | Toggle Outline (left TOC) |
| `c` | Toggle Comments map (right rail) |
| `J` / `K` | Next / previous plan |
| Esc | Edit mode: open Discard (or exit edit if nothing to discard); else exit zen / dismiss Add-comment chip / close draft |

A vim-style status bar at the bottom displays the current mode (NORMAL/INSERT), file path, and a help button. Multi-key sequences use an 800ms key buffer.

<img width="1624" height="1061" alt="image" src="https://github.com/user-attachments/assets/f0971704-65a2-4512-978f-6b6e656b5dda" />


---

## Native Terminal UI (TUI) — *Experimental*

> [!WARNING]
> The TUI is **experimental**. The interface, keymap, and on-disk format of
> `server.json` (`mode: "tui"`) may change in a minor release before
> stabilisation. The web UI is the supported path for production workflows;
> please open an issue before depending on the TUI for CI / agent automation.
> The web review flow, plan review, and PR review are unaffected.

`diffing --tui` opens an **opt-in native-Rust terminal interface** that mirrors the local code-review workflow — no browser or Electron. The renderer and headless tools share one sparse diff index. A random-port loopback API is published through `server.json` with `mode: "tui"` and a per-session capability, so local agents can inspect a large diff without receiving the whole patch.

The default `diffing` behaviour is **byte-identical** with and without `--tui` — the TUI is strictly opt-in. If the env cannot support a TUI (piped stdin, CI, no raw mode) or the binary is missing, you get a one-line stderr note and the normal `git diff` output. The web mode is also unaffected by the TUI build; the same `diffing` install serves either.

```bash
diffing --tui                       # Open the current working tree in the TUI
diffing --tui --staged              # Review staged changes in the TUI
diffing --tui HEAD~3                # Review working tree vs. 3 commits ago
diffing --tui main..feature         # Compare two branches in the TUI
diffing --tui -- -- src/            # Limit a TUI review to a directory
```

**Stack** — Rust 1.78+ workspace (`crates/diffing-core/` shared lib + `crates/diffing-tui/` binary), `ratatui` + `crossterm` for rendering, `syntect` for syntax highlighting, `notify-debouncer-full` for live updates.

**Features**

- **Disk-backed streaming index** — Git output is parsed as bytes into sparse file/hunk/checkpoint metadata. The first partial generation is usable during ingestion; neither the TUI nor an agent needs to retain the full patch in memory.
- **Viewport-only rendering** — only visible rows are sought, decoded, syntax-highlighted, and converted to terminal cells. Unified and split layouts, horizontal scrolling, wrapping, binary markers, untracked files, and live working-tree refresh are supported.
- **Vim-style file tree & keymap** — numeric counts plus `j/k`, `gg/G`, `Ctrl-d/u`, `J/K`, `]h/[h`, `]c/[c`, `zz`, `h/l`, `/`, `n/N`, `:`, `Tab`, `v`, `w`, `m`, `t`, and `?`. `Esc` cancels a mode; `q` or `Ctrl-C` quits.
- **Full comment CRUD** — mirrors `src/lib/comments.ts` byte-for-byte; the comment tracker at the bottom lists open / replied / resolved threads with click-to-jump navigation.
- **Multi-line `tui-textarea` form** with markdown rendering in the preview pane.
- **Live updates** via `notify` watcher on `comments.json` and the repo working tree — write a comment in another window and it appears immediately.
- **Send review & agent handoff** — verdict radios + general-comment popover with a live XML preview. `Ctrl-S` persists the review, copies it to the clipboard when available, and immediately wakes every `diffing await-review` waiter. The status bar reports real waiter state.
- **Headless, token-bounded inspection** — `diffing inspect summary|files|hunks|slice|search` and the equivalent MCP tools page the same index with strict row/byte limits, generation checks, and compact JSON. Every request is loopback-only and requires the session capability.
- **Cross-platform** — macOS, Linux, and Windows are all first-class. The TUI liveness probe uses `kill(pid, 0)` on Unix and `tasklist /NH /FO CSV` on Windows. Clipboard works on Wayland (`wl-copy`), X11 (`xclip` / `xsel`), macOS (`pbcopy`), and Windows (`clip.exe` / PowerShell `Set-Clipboard`).

The synthetic one-million-line benchmark (50.8 MiB patch) currently reaches a usable partial snapshot in under 1 ms, completes indexing in 47–152 ms, serves viewport reads at 30 µs p95, and peaks at about 54 MiB RSS on the development machine. Run it with `DIFFING_BENCH_LINES=1000000 cargo bench -p diffing-core --bench diff_index`; results vary by machine and filesystem cache.

Headless examples:

```bash
diffing inspect summary
diffing inspect files --limit 100
diffing inspect slice --file 0 --start 0 --max-lines 120 --max-bytes 262144
diffing inspect search "unsafe" --limit 25
```

**Building the binary locally**

```bash
pnpm build:tui               # debug build → target/debug/diffing-tui
pnpm build:tui --release     # release build → target/release/diffing-tui
```

The CLI auto-discovers the binary in the following search order: sibling of `dist/cli.mjs`, `bin/`, `target/release/`, `target/debug/`, then `$PATH`. A `cargo build` (debug) workflow is supported out of the box; you don't need `--release` just to use the TUI.

---

## Console Startup Animations & Quotes

Every time you launch `diffing` in the terminal, it serves a highly polished, interactive greeting before the browser opens:
- **256-Color Monochromatic Palettes** — Beautifully rendered box outlines across 6 monochromatic themes (Cyan, Green, Magenta, Yellow, Blue, Orange) with custom faint, base, glow, and text hues.
- **Dynamic Startup Animations** — Instantly runs one of 6 terminal-based micro-animations (Typewriter, Wave Reveal, Slide-In, Pulse Border, Glitch Noise, Matrix Rain) underneath the local server URL.
- **Motivational Developer Quotes** — Settles to display one of 30 curated, funny, philosophical, or motivational developer quotes to kick off your review session.

---

## Performance & Speed

Built from the ground up for a fast, fluid experience—even in large repositories:

- **Rust-Powered Search** — Native engine handles indexing and querying outside the JS event loop.
- **Async Diff Execution** — Server fetches unstaged, staged, and untracked diffs concurrently via `Promise.all`.
- **Web Worker Rendering** — `@pierre/diffs` uses a worker pool for syntax highlighting and diff computation off the main thread.
- **React.memo + useMemo** — Extensive component memoization prevents unnecessary re-renders when files haven't changed.
- **useTransition** — Settings changes (theme, diff style, font size) wrapped in `startTransition` for non-blocking UI updates.
- **Compositor-Only Resize** — Sidebar and comment panel resize use GPU-composited transform guides; width/height committed only on mouseup for 60fps feel.
- **Shiki Pre-Warming** — Highlighter engines preloaded on theme change for instant first paint.
- **Large Buffer Support** — Git operations use 50–100MB max buffer to handle large diffs.
- **Object Reference Stability** — Diff metadata reuses previous object references when file contents haven't changed (JSON comparison of hunks).
- **Stale Project Cleanup** — Project storage directories older than 14 days or with missing repo paths are automatically purged.

---

## Real-Time Communication

Bidirectional, event-driven sync between the browser UI and connected AI agents via Server-Sent Events (SSE):

```text
┌──────────────┐     SSE (change/comments/agent-status)     ┌──────────────┐
│              │◄───────────────────────────────────────────►│              │
│   Browser    │                                             │   AI Agent   │
│     UI       │     ┌─────────────────────────────┐        │   (CLI/MCP)  │
│              │     │       comments.json          │        │              │
│              │     │  (FileCommentStore on disk)  │        │              │
└──────┬───────┘     └──────────┬──────────────────┘        └──────┬───────┘
       │  user writes comment    │                                  │
       │ ──────────────────────► │    fs.watch detects change       │
       │                         │ ───────────────────────────────► │
       │                         │    agent posts reply             │
       │  SSE broadcasts toast   │ ◄────────────────────────────── │
       │ ◄───────────────────────│                                  │
```

- **Single SSE Endpoint** (`/api/live`) — Multiplexed event stream with named events: `change` (working tree), `comments` (store updated), `agent-status` (agent connect/disconnect/send), `heartbeat` (15s keep-alive).
- **File System Watcher** — `fs.watch` on repo root (recursive, 200ms debounce) triggers live diff refresh on working tree changes. Skips `.git`, `node_modules`, `dist`, and `.changeset`.
- **Comment Store Watcher** — `fs.watch` on `comments.json` (120ms debounce) broadcasts updates when agents or humans write comments externally.
- **Agent Activity Toasts** — Real-time toast notifications when an agent posts a reply, showing model name, file path, and body preview. Clickable to jump to the file; auto-dismisses after 8 seconds.
- **Agent Status Indicator** — Green dot on the "Send to agent" button when an agent process is connected and waiting (via SSE `agent-status` events).
- **Bidirectional Sync** — User adds comments in UI → saved to `comments.json` → watcher → SSE broadcast → agent picks up. Agent posts reply → written to `comments.json` → watcher → SSE → UI toast.

---

## AI Agent Collaboration (Handoff Protocol)

`diffing` solves the friction of copy-pasting code review notes into LLM chat boxes. It establishes an **"agent waits, human releases"** pipeline using a robust, port-agnostic lockfile mechanism.

```text
1. The agent runs a blocking command/tool and enters sleep mode.
2. You review code in your browser, leave inline comments, and click "Send to agent".
3. The agent wakes up instantly, receives comments as structured XML, applies edits, and posts replies.
```

### A. CLI Integration (For any terminal-based agent)
The `diffing` binary acts as a port-agnostic CLI client. It automatically discovers the running server by reading a local repository lockfile:

```bash
# Code-review handoff
diffing await-review                 # Block until "Send to agent"; print comments as XML
diffing comments [--open] [--format xml|json|md]
diffing reply <id> --body "..."      # Post an agent response
diffing resolve <id>                 # Mark resolved (UI updates live)
diffing unresolve <id>               # Re-open a resolved thread
diffing comment edit <id> --body "..."
diffing comment delete <id>
diffing progress --message "…" [--pct 40] [--model M]   # Live progress toast
diffing url                          # Active server base URL

# Plan review (before any code is written)
diffing plan submit <file> [--title T] [--model M] [--id <id>] [--wait] [--save-source]
diffing plan await [--timeout N]
diffing plan list [--json]
diffing plan show [<id>] [--json] [--version N]
diffing plan versions <id> [--json]
diffing plan reply <commentId> --body "..."
diffing plan resolve <commentId>

# DX
diffing doctor                       # Environment / install self-check
diffing completion <bash|zsh|fish>
diffing inspect summary|files|hunks|slice|search   # Bounded reads from a TUI session
```

Full contracts (flags, exit codes, XML, HTTP): **[docs/cli.md](docs/cli.md)**.

### B. Model Context Protocol (MCP) Server
If your agent supports MCP, configure `diffing` as a stdio server. The MCP is
self-describing and can start or reuse the loopback review server, so an
MCP-only agent does not need to know a port or fall back to raw HTTP:

```json
{
  "mcpServers": {
    "diffing": {
      "command": "diffing",
      "args": ["mcp"]
    }
  }
}
```

Global/desktop clients that do not launch MCP from the workspace should bind it
to one repository explicitly:

```json
{
  "mcpServers": {
    "diffing": {
      "command": "diffing",
      "args": ["mcp", "--repo", "/absolute/path/to/repository"]
    }
  }
}
```

Run `diffing mcp --help` for setup details. The server initialization
instructions tell an unfamiliar model what to do next, and every tool returns
both readable text and structured content.

| Area | Tools |
|------|-------|
| Session | `review_session_status`, `start_review_session` |
| Diff inspection | `get_diff`, `diff_summary`, `diff_files`, `diff_hunks`, `diff_slice`, `diff_search` |
| Comments | `create_comment`, `list_comments`, `reply_to_comment`, `resolve_comment`, `unresolve_comment`, `edit_comment`, `delete_comment`, `edit_reply`, `delete_reply`, `apply_suggestion`, `resolve_all_comments` |
| Loop | `await_review`, `report_progress`, `get_review_history` |
| Plan | `submit_plan`, `await_plan_review`, `list_plans`, `get_plan`, `get_plan_versions`, `get_plan_version`, `reply_to_plan_comment`, `resolve_plan_comment` |

Clients that expose MCP prompts can use `review_local_changes` and
`submit_plan_for_review`; clients that expose resources can read
`diffing://agent-guide`. Essential guidance is also present in initialization
instructions and tool descriptions because prompt/resource support varies.

### C. Agent Skills
You can install diffing skills directly into your AI coding assistant:
```bash
npx skills add ahmedragab20/diffing
```
Installs five portable, natural-language-triggered workflows:

1. **`diffing`** — Detects MCP/CLI/offline capabilities and routes the request.
2. **`diffing-start-review`** — Starts or reuses the review session and returns its URL.
3. **`diffing-finish-review`** — Waits for human feedback, applies clear requests, and synchronizes replies/resolutions live.
4. **`diffing-review`** — Inspects the full local diff and posts actionable inline findings.
5. **`diffing-plan-review`** — Gates implementation on a reviewed plan and deterministic verdict handling.

The skills prefer native MCP tools, fall back to the port-agnostic CLI, and can
still interpret pasted self-describing XML. The installable `skills/` copies and
repo-local `.agents/skills/` copies are contract-tested to remain identical.

### Send Review Popover
A GitHub-style **Submit review** / **Send to agent** popover: pick a verdict
(Approve / Request edits / Reject / **Comment only**), optionally add an overall
note, preview every inline comment (editable/removable), and release every
waiting agent. Agent waiting state shows as a green dot on the button.
**Copy comments** serializes the thread set to the agent XML spec.

### Port-Agnostic Discovery
A per-repo lockfile (`server.json`) in `~/.diffing/<repo-hash>/` enables all subcommands and MCP tools to discover the server's port with zero configuration. Stale or crashed server locks are automatically detected and treated as dead via `process.kill(pid, 0)`.

### Monotonic Round Sequencing
A `ReviewSession` class with a monotonic `round` counter and race-guard logic ensures that if a "Send to agent" lands between polling intervals, the cached payload is delivered immediately. Multiple agents can block on the same review session simultaneously—all are released together on send.

---

## Plan Review

Review **any agent plan** — not just code. When an AI agent produces a plan
(an implementation outline, a design proposal, a migration strategy), `diffing`
renders the markdown line-by-line so you can comment on specific lines or
sections and **approve**, **request changes**, **reject**, or **comment only**
— then hands the structured verdict back to the waiting agent. It's the
"agent waits, human releases" handoff, applied *before* any code is written.

```text
1. The agent submits a markdown plan and blocks (diffing plan submit … --wait).
2. You open Plans (/plan), read Source / Read / Split, and comment on lines/sections.
3. You Submit review: Approve / Request changes / Reject / Comment only.
4. The agent wakes, receives <plan-review> XML, and proceeds, revises, or stops.
```

- **Source / Read / Split** — always-visible view modes in the plan toolbar (`m` cycles). Read uses full main-column width; **Zen** (`z`) immersive full-width focus (Esc exits).
- **Live plan edit** — `e` / pencil edits markdown + title on the current version with a Source editor and live Read preview. **Autosave** (`PUT /api/plans/:id`, no version bump); **⌘S** to flush; **Save as new version** (`POST` same id, version bump + decision pending). **Discard** (Esc) restores this session and/or rolls back to the pre-edit original across exit/re-enter. New comments are paused while editing.
- **Resizable split** — drag the Source|Read divider; double-click resets 50/50. Edit mode uses independent pane scroll so the caret stays put.
- **Renders any markdown plan** — Source via `@pierre/diffs` when viewing (commentable lines); Read as polished markdown with outline (`o`) and comments map (`c`).
- **Line, range & section comments** — gutter `+` or select lines (Source); highlight text → Add comment in Read (multiple floating drafts, range steppers, minimize tray, Esc). **Read mode always shows submitted threads inline** under the matching section.
- **Severity** — optional blocking / nit / question / praise on plan comments (same labels as code review; included in `<plan-review>` handoff XML).
- **Collapsible threads** — collapse open or resolved cards; collapse the in-card source preview; delete resolved comments and replies.
- **General comments** — notes scoped to the whole plan.
- **Four-way verdict** — Approve / Request changes / Reject / Comment only (no file edits). Resubmit with the same id bumps version and re-opens review.
- **Browse plan versions** — version dropdown, historical banner, comments filtered to the viewed version. CLI / MCP / HTTP as below.
- **Live "Plans" badge** — toolbar badge for plans awaiting review; green dot when an agent is waiting.
- **Same channels everywhere** — CLI (`diffing plan …`), MCP (`submit_plan`, `await_plan_review`, …), HTTP (`POST /api/plans`, `PUT /api/plans/:id` for in-page edit, `POST /api/plans/:id/decision`, `GET /api/plan-review/await`).
- **Scratch outside the tree** — plan sources under `~/.diffing/<repo>/plan-sources/` (`--save-source`); never commit agent plans into the consumer project.

### Plan Review XML Specification

When a plan verdict is handed to a waiting agent, it is serialized into a
self-documenting `<plan-review>` envelope:

```xml
<plan-review>
  <instructions>…how to act on the verdict; how to reply/resolve/resubmit…</instructions>
  <plan id="…" title="…" version="2" decision="changes-requested" decided-at="2026-05-29T18:52:56.053Z">
    <decision-summary><![CDATA[The reviewer REQUESTED CHANGES. Revise the plan…]]></decision-summary>
    <decision-comment><![CDATA[Tighten the Phase 2 scope.]]></decision-comment>
    <plan-body><![CDATA[# My Plan
## Phase 1
…full markdown of the plan being reviewed…]]></plan-body>
    <comments>
      <comment id="c1" line="4" section="Phase 1" status="open" severity="blocking" created-at="2026-05-29T18:52:29.557Z">
        <context><![CDATA[Do the first thing]]></context>
        <body><![CDATA[Clarify what "the first thing" is.]]></body>
        <replies>
          <reply id="r1" created-at="…" role="agent" model="claude-opus-4-8"><![CDATA[Will do — splitting into 1a/1b.]]></reply>
        </replies>
      </comment>
    </comments>
  </plan>
</plan-review>
```

---

## Reviewing a GitHub PR

`diffing` can open a GitHub PR in the same diff UI you use for the working
tree, and push your review back to GitHub when you're done. The "Send to
agent" handoff is **structurally absent** in PR mode — there's no way to
accidentally route a PR review to a coding agent.

```text
# All of these open PR #1234 in the current repo:
diffing "gh pr 1234"
diffing --gh-pr 1234

# Full URL form:
diffing "gh pr https://github.com/ahmedragab20/diffing/pull/1234"
diffing --gh-pr https://github.com/ahmedragab20/diffing/pull/1234

# owner/repo#N shorthand (skips the cwd-repo check):
diffing "gh pr ahmedragab20/diffing#1234"
```

The PR diff loads in the existing `<DiffViewer>` / `<FileTree>` machinery.
Existing review comments on the PR are fetched and shown as a read-only
summary strip below each file so you can see what was already said before
adding your own. Comments you write are kept visually distinct.

When you click **Submit to GitHub**, `diffing` builds a `POST
/repos/{owner}/{repo}/pulls/{pull_number}/reviews` payload and POSTs it
to GitHub. Multi-line comments are expanded to N single-line comments
with a `[part N/M]` prefix. Existing comments are **never re-POSTed** —
only the new ones you wrote in this session.

### Headless subcommands

For CI / agent use, the same flow is exposed as a `gh` subcommand with no
UI:

```text
# Submit the current in-progress review to GitHub.
diffing gh pr-review 1234 --decision request-changes --body "Please address the range"

# Dump PR metadata (title, owner, head SHA, existing comments) as JSON.
diffing gh pr-fetch 1234

# List the PR-mode comments in this diffing session (mirrors `diffing comments`).
diffing gh pr-list-comments

# Show the active PR session (ref, owner/repo#n, comment count, submitted status).
diffing gh status
```

### Authentication

The submit path uses the same precedence as the rest of the GitHub
ecosystem:

1. **`gh` CLI** — preferred; uses your existing `gh auth login` session.
2. **Token env var** — `$GH_TOKEN`, then `$GITHUB_TOKEN`, then
   `$GITHUB_API_TOKEN` (any of the three).
3. If neither is available, the submit fails with a clear one-line
   message telling you to run `gh auth login` or set `$GITHUB_TOKEN`.

The `gh` binary is **only** used for the submit and refresh steps; the
diff itself is rendered locally, so PR review works offline once the
session is open.

### Storage

PR-mode state lives in `pr-session.json` (in the per-repo
`~/.diffing/<repo>-<hash>/` directory) — a separate file from
`comments.json` and `plans.json`, so a local review and a PR review can
coexist without colliding.

---

## Inline Comment System

Rich, real-time comment threads directly on diff lines:

- **Inline Threads** — Hover the gutter `+` or select lines to open a composer **on that line/side** (additions and deletions). Markdown (GFM + breaks) with syntax-highlighted fences. Threads are collapsible.
- **Multi-Line Comments** — Drag a line range; the form anchors under the bottom line, with a clear `L12–L15 · new|old` label and **range steppers**. Reverse selection is normalized; range is **inclusive** on the agent handoff (`line="12-15"`).
- **Severity** — Optional triage labels (design-system dropdown): blocking / nit / question / praise. Stored and emitted on agent handoff XML; MCP `create_comment` accepts `severity`.
- **File-Level Comments** — Notes scoped to the entire file.
- **Comment Drafts** — Server-side drafts with TTL under `~/.diffing/` (no browser storage).
- **Agent Attribution** — Replies carry `role` (`user`/`agent`) and `model`.
- **Suggestion Application** — `` ```suggestion `` blocks (including multi-line) via **Apply suggestion** / `POST /api/comments/:id/apply-suggestion`.
- **Bulk resolve** — Toolbar **Resolve all** → `POST /api/comments/resolve-all`.
- **Agent progress** — Agents can `diffing progress` / `report_progress` for a live toast while working.
- **Full CRUD** — Create, edit, delete (including resolved plan threads), reply, unresolve — CLI, MCP, and HTTP.

---

## Inline Diff Viewer Settings

Fine-grained control over how diffs are rendered:

| Setting | Options | Description |
|---------|---------|-------------|
| **Inline Diff Type** | `word` (default), `word-alt`, `char`, `none` | Pinpoint exactly what changed inside a modified line |
| **Diff Indicators** | `classic` (+/−), `bars`, `none` | Gutter markers for added and deleted lines |
| **Line Numbers** | on / off | Toggle gutter line numbers |
| **Line Wrap** | on / off | Soft-wrap long lines instead of horizontal scrolling |
| **Hunk Separators** | `simple`, `metadata`, `line-info`, `line-info-basic` | Style of the separator bar between diff hunks |
| **Line Hover Highlight** | `both`, `line`, `number`, `disabled` | Which element highlights on hover |
| **Font Size** | 11px – 16px | Configure globally |
| **UI Font** | Any system or Google font (default Geist Mono) | Customize typography for the Web UI layout |
| **Mono Font** | Any system or Google font (default JetBrains Mono) | Customize typography for code/diff block displays |
| **Tab Size** | 2 / 4 / 8 | Default tab width (overridden per-file by EditorConfig) |
| **Expandable Context** | `expandContextByDefault`, `collapsedContextThreshold` (default 10 lines), `expansionLineCount` (default 20) | Control how collapsed context regions behave |
| **Haptic & Sound Feedback** | on / off | Tactile feedback via `web-haptics` and synthesized audio cues (click, toggle, navigate, open, close, resolve, send, error) |

All settings persist to `~/.config/diffing/settings.json` and the UI updates are wrapped in `useTransition` for non-blocking responsiveness.

#### A note on custom fonts

Google-hosted families (e.g. `Fira Code`, `Source Code Pro`, `IBM Plex Mono`, `Roboto Mono`) are fetched automatically as web fonts and render in any browser. A **locally-installed** font — a Nerd Font, or a commercial font like `Dank Mono` — is applied by name and renders only if it is installed on your machine **and** your browser allows pages to use local fonts.

Privacy-hardened browsers block this: **Brave**, with Shields / "Block fingerprinting" enabled (the default), refuses to render uncommon local fonts as an anti-fingerprinting measure, so the selection silently falls back to the default monospace even though it is installed. To use a local-only font there, either pick a Google-hosted equivalent, or open **Shields** for the diffing site, set fingerprinting to *Allow all*, and reload.

---

## Merge Conflict Resolution

When your repository is in a merge state (`.git/MERGE_HEAD` detected):

- **Conflict Banner** — A prominent warning banner appears in the toolbar indicating the repo is in a merge conflict state.
- **`UnresolvedFile` Rendering** — Conflicted files are rendered using `@pierre/diffs`'s `UnresolvedFile` component with color-coded conflict markers.
- **Custom Action Buttons** — For each conflict region, choose **Accept Current**, **Accept Incoming**, or **Accept Both**.
- **Save & Stage** — After resolving all conflicts in a file, click **Save & Stage** to write the resolved content and `git add` it in one step.
- **Merge Status API** — `GET /api/merge-status` returns conflict state and lists conflicted files via `git diff --name-only --diff-filter=U`.

---

## Hunk Revert & History

- **Revert Individual Hunks** — Undo a single hunk from the working tree via `POST /api/revert-hunk` using `git apply --reverse`.
- **Blame & History** — View `git blame` for deleted lines and recent commit history for any file via `GET /api/hunk-history`, showing who authored deleted code and when.

---

## Advanced Git Operations

- **File Open in IDE** — Open any repo file in VS Code, Zed, Vim, Neovim, or the system default editor via `POST /api/open-file`. Configurable in settings.
- **File Save & Stage** — Write file contents to disk and optionally `git add` in one call via `POST /api/save-file`.
- **Repository File Lister** — `GET /api/repo-files` lists all known files (tracked + untracked, respecting `.gitignore`).
- **File Content Retrieval** — `GET /api/file-content` and `GET /api/file-text` return old (HEAD) or new (working tree) file versions as binary buffers or JSON text.
- **EditorConfig Integration** — Respects your local `.editorconfig` rules (`tab_width`, `indent_size`) for accurate, per-file tab sizing that overrides the default setting.

---

## Git Diff Drop-in Compatibility

`diffing` is designed as a **seamless, full drop-in replacement for `git diff`**. It features a comprehensive option parser that understands standard git revisions, options, and pathspecs, forwarding them directly to your local git engine.

Whether you are comparing branches, reviewing staged changes, or filtering specific directories, simply swap `git diff` for `diffing` to instantly elevate your review into a premium, interactive browser interface:

```bash
diffing                          # Review working tree changes in the browser UI
diffing --staged                 # Review staged changes (drop-in for git diff --staged)
diffing HEAD~3                   # Review working tree changes against 3 commits ago
diffing main..feature            # Compare two branches (drop-in for git diff main..feature)
diffing -- --cached -- src/      # Staged changes specifically in the src/ directory
```

### Intelligent Output Modes (TTY Auto-Detection)
To integrate flawlessly with your existing developer shell workflows, build pipelines, and command scripts, `diffing` automatically resolves the optimal output mode based on how stdout is directed:
- **Web Mode (Default for interactive TTY)**: When executed in an interactive terminal session, it boots the local Hono review server, registers the repository lockfile, and opens your default browser.
- **Terminal Mode (Default for pipes, redirects, or non-TTY)**: When output is piped (e.g. `diffing | grep "const"`) or redirected to a file, it falls back to behave **exactly like `git diff`**, streaming clean, standard unified diff patch text directly to standard output and exiting.

> [!TIP]
> Any standard output control or format-related flags (such as `--raw`, `--numstat`, `--stat`, `--exit-code`, `--quiet`, or `-o`) will automatically force Terminal Mode fallback.

> [!TIP]
> For a full list of all git option categories (algorithms, whitespace ignoring, context lines, word-level diffs, moved/copied detection, and path filtering) supported by `diffing`, see the [CLI Reference Manual](docs/cli.md).

### `diffing show` — Review a Commit's Changes (Drop-in for `git show`)

`diffing <sha>` runs `git diff <sha>`, which means "diff between `<sha>` and the working tree" — not the changes that commit introduced. If the working tree matches `<sha>`, the patch is empty and the file list renders blank.

To review the changes **of** a commit, use the new `show` subcommand. It mirrors `git show` and surfaces each commit's metadata (subject, author, date, message body) above the diff in the web UI:

```bash
diffing show HEAD              # Review the tip commit's metadata + diff
diffing show HEAD~3..HEAD      # Review the last 3 commits as a series
diffing show v1.0              # The commit a tag points to
diffing show abc123 def456     # Two specific commits, oldest-first
diffing show HEAD -- src/      # Limit a commit review to a directory
diffing show HEAD~2..HEAD --terminal   # Stream `git show` to your terminal
```

`show` accepts every form `git show` understands (single commit, range, tag, branch tip, multiple SHAs) and is strictly opt-in — `diffing <sha>` keeps its current `git diff <sha>` semantics so existing muscle memory and scripts are unaffected.

---

## Integration & Configuration

- **Persistent User Settings** — Settings saved to `~/.config/diffing/settings.json`, loaded on startup, synced to server via `PUT /api/settings`.
- **Custom Host/Port** — `--host 0.0.0.0` exposes the review dashboard to the local network; `--port <port>` overrides random port selection.
- **`--no-open` Flag** — Prevents auto-browser opening on server start.
- **Git Config Alias** — Register `diffing` as `git review` via `~/.gitconfig`.
- **Shell Aliases** — `.zshrc`/`.bashrc` examples: `gd="diffing"`, `gds="diffing --staged"`, `gda="diffing & diffing await-review"`.
- **Configurable Browser & IDE** — Choose which browser to auto-open (Chrome, Firefox, Edge, Brave, or system default) and which IDE to use for file opening (VS Code, Zed, Vim, Neovim, or system default).
- **Graceful Shutdown** — `SIGINT`/`SIGTERM` handlers remove the server lockfile on exit.

---

## Comment XML Specification

When review comments are exported or streamed to a waiting agent, they are serialized into an optimized, self-documenting XML structure equipped with CDATA blocks:

```xml
<code-review-comments>
  <instructions>
    You are an AI coding assistant receiving a structured list of code review comments to address.
    For each file, review the inline comments and apply the changes requested.
    - Target lines are specified by the "line" attribute (e.g. line="42" for single lines, line="42-45" for multi-line blocks, or line="file" for file-level notes).
    - When line="A-B", the range is INCLUSIVE on that side.
    - "side" indicates whether the comment is on "additions" (new code) or "deletions" (old code).
    - "status" indicates whether the comment is "open" or "resolved". Only address "open" comments.
    - Optional severity="blocking|nit|question|praise": blocking = must fix; nit = optional polish; question = needs an answer; praise = positive (no change required). Omit (or none) = untriaged.
    - The <code> block contains the code context at the reviewed lines.
    - The <body> tag contains the review feedback or request.
    
    HOW TO REPLY OR MARK AS RESOLVED:
    - Prefer using the diffing CLI or MCP server tools (reply_to_comment / resolve_comment).
    - CLI: `diffing reply <id> --body "..."`
    - CLI: `diffing resolve <id>`
  </instructions>

  <!-- [Optional] High-Level General Review Comment -->
  <general-comment>
    <![CDATA[Please refactor the parsing module to improve reliability.]]>
  </general-comment>

  <file path="src/utils/parser.ts">
    <!-- [Example A] Multi-Line Selection Addition Comment -->
    <comment id="c1" line="42-45" side="additions" status="open" severity="blocking" created-at="2026-05-24T22:00:00.000Z">
      <code><![CDATA[
+ const parsedToken = tokenize(input);
+ if (parsedToken.type === 'EOF') {
+   return null;
+ }
]]></code>
      <body><![CDATA[Refactor this tokenization block to check for undefined inputs as well.]]></body>
      <replies>
        <reply id="r1" created-at="2026-05-24T22:05:00.000Z" role="agent" model="claude-3-5-sonnet">
          <![CDATA[I agree, I will add a guard clause for undefined.]]>
        </reply>
      </replies>
    </comment>

    <!-- [Example B] Whole-File General Comment -->
    <comment id="c2" line="file" side="additions" status="open" severity="nit" created-at="2026-05-24T22:08:00.000Z">
      <body><![CDATA[This parser module needs additional unit tests to cover negative bounds.]]></body>
    </comment>
  </file>
</code-review-comments>
```

---

## Security

- **Path Traversal Prevention** — All file operations validate paths against the repository root, rejecting `..`, null bytes, absolute paths, and URL-encoded bypass attempts.
- **403 Forbidden Responses** — File operations (`open-file`, `save-file`, `revert-hunk`, `hunk-history`) reject paths outside the repo root.
- **Attachment Isolation** — Uploaded attachments are restricted to `~/.diffing/<repo>/attachments/`.
- **Client Directory Isolation** — Static file serving resolves against the client directory and rejects paths outside it.
- **XSS Prevention** — HTML is escaped before markdown rendering; `marked` is used for safe HTML generation.
- **Repo Path Verification** — `repo_path.txt` is written to storage directories for cross-checking.

---

## Deep-Dive Documentation

For advanced features, internal API endpoints, sequence specifications, and configuration parameters, explore the complete guide:

> [!IMPORTANT]
> Read the [CLI & Protocol Reference Manual](docs/cli.md) for detailed descriptions of:
> - TTY auto-detection and output modes (web / terminal / TUI).
> - Port-agnostic discovery lockfile (`server.json`) and modes (`web` | `tui` | `gh-pr`).
> - Full agent CLI surface: `await-review`, `comments`, `reply` / `resolve` / `unresolve`, `comment edit|delete`, `progress`, `plan …`, `gh …`, `inspect`, `doctor`, `completion`, `mcp`.
> - Complete MCP tool table (session, bounded diff, comment lifecycle, progress, plan).
> - Monotonic `round` handoff, plan-review XML, and comment XML schemas.
> - Web API endpoints (`/api/review/await`, `/api/comments`, `/api/plans`, `/api/agent/progress`, …).
> - Agent guidance: root [`Agents.md`](Agents.md) and installable skills under `skills/`.

Changelog for the latest release: [`CHANGELOG.md`](CHANGELOG.md) (current package version **0.8.0**).


---

## License

MIT
