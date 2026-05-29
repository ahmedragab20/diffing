# diffing

A local-first code review tool and double-sided bridge designed for the modern AI coding agent workflow. Review AI-generated changes in a high-fidelity, GitHub-like web UI, leave inline comments, and hand them back to your coding agent to fix in real time.

![screenshot](https://raw.githubusercontent.com/ahmedragab20/diffing/main/screenshot.png)

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

---

## Web UI Review Dashboard

A local Hono-powered review server delivers a full-featured GitHub-like code review interface directly in your browser.

- **Split / Unified View** — Toggle between side-by-side (`split`) and inline (`unified`) diff layouts via toolbar or keyboard shortcut `m`.
- **Syntax Highlighting** — Powered by Shiki via `@pierre/diffs`, with high-fidelity highlighting for 200+ languages.
- **Interactive File Tree** — Hierarchical file navigation sidebar with collapsible folders, viewed/unviewed tracking, and change-type indicators (added, modified, deleted).
- **Status Dashboard (Comment Tracker)** — Bottom panel tracking open, replied, and resolved comments with filter tabs and click-to-navigate references to the relevant file and line.
- **Git Diff Stats** — Toolbar displays repo name, branch, file count, and additions/deletions (`+X/-Y`) computed from the patch.
- **Resizable Panels** — Drag-to-resize sidebar (240px–640px) and comment tracker panel (100px–600px). Widths and heights persist in localStorage.
- **Skeleton Loading Screen** — Full shimmer placeholder UI for toolbar, sidebar, search, tree nodes, and file diffs during initial load.
- **Image Diff Previews** — Visual side-by-side comparison for added, changed, and deleted image files (PNG, JPEG, GIF, WebP, SVG, BMP, ICO, AVIF).

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
| `m` | Toggle split/unified view |
| `t` | Cycle tab size (2 → 4 → 8) |
| `w` | Toggle line wrap |
| `n` | Toggle line numbers |
| `i` | Cycle diff indicators |
| `I` | Cycle inline diff type |

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
| `?` | Show shortcuts help modal |

A vim-style status bar at the bottom displays the current mode (NORMAL/INSERT), file path, and a help button. Multi-key sequences use an 800ms key buffer.

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
diffing await-review                 # Block process until you click "Send to agent"; outputs comments as XML
diffing comments [--open] [--json]   # One-shot query of the comments database
diffing reply <id> --body "..."     # Post an agent response or explanation
diffing resolve <id>                 # Mark a comment resolved, updating the UI live
diffing url                          # Retrieve the active server base URL
```

### B. Model Context Protocol (MCP) Server
If your agent supports MCP (such as Cursor, Claude Desktop, or Gemini), configure `diffing` as a stdio-based MCP server. No ports need to be configured:

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
Exposes four powerful tools directly to your agent: `await_review`, `list_comments`, `reply_to_comment`, and `resolve_comment`.

### C. Agent Skills
You can install diffing skills directly into your AI coding assistant:
```bash
npx skills add ahmedragab20/diffing
```
Provides three primary commands to coordinate reviews:
1. **`/diffing-start-review`** — Launches the review server.
2. **`/diffing-finish-review`** — Blocks the agent using `await-review` until comments are sent, then applies requested edits.
3. **`/diffing-review`** — Combined launch-and-wait flow.

### Send Review Popover
A GitHub-style "finish your review" popover with inline editing of each comment, an optional general/overall comment, and a visual indicator when an agent is waiting. The **"Copy comments"** toolbar button serializes all comments to the XML spec and copies them to the clipboard.

### Port-Agnostic Discovery
A per-repo lockfile (`server.json`) in `~/.diffing/<repo-hash>/` enables all subcommands and MCP tools to discover the server's port with zero configuration. Stale or crashed server locks are automatically detected and treated as dead via `process.kill(pid, 0)`.

### Monotonic Round Sequencing
A `ReviewSession` class with a monotonic `round` counter and race-guard logic ensures that if a "Send to agent" lands between polling intervals, the cached payload is delivered immediately. Multiple agents can block on the same review session simultaneously—all are released together on send.

---

## Inline Comment System

Rich, real-time comment threads directly on diff lines:

- **Inline Threads** — Hover and click the `+` button on any addition or deletion line to start a thread. Supports markdown (GFM + line breaks) with syntax-highlighted fenced code blocks.
- **Multi-Line Comments** — Select a line range to comment on an entire block of code.
- **File-Level Comments** — Add general comments scoped to the entire file without targeting a specific line.
- **Comment Drafts** — LocalStorage-based draft system (`diffing-draft-*` keys) with 7-day TTL, so drafts survive page refreshes.
- **Agent Attribution** — Replies carry `role` (`user`/`agent`) and the agent's `model` name for clear attribution.
- **Suggestion Application** — Parse `` ```suggestion `` code blocks from comment bodies and apply them to the file in one click via `POST /api/comments/:id/apply-suggestion`.
- **Full CRUD API** — REST endpoints for creating, reading, updating, and deleting comments and replies.

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
| **Tab Size** | 2 / 4 / 8 | Default tab width (overridden per-file by EditorConfig) |
| **Expandable Context** | `expandContextByDefault`, `collapsedContextThreshold` (default 10 lines), `expansionLineCount` (default 20) | Control how collapsed context regions behave |
| **Haptic & Sound Feedback** | on / off | Tactile feedback via `web-haptics` and synthesized audio cues (click, toggle, navigate, open, close, resolve, send, error) |

All settings persist to `~/.config/diffing/settings.json` and the UI updates are wrapped in `useTransition` for non-blocking responsiveness.

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
    - "side" indicates whether the comment is on "additions" (new code) or "deletions" (old code).
    - "status" indicates whether the comment is "open" or "resolved". Only address "open" comments.
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
    <comment id="c1" line="42-45" side="additions" status="open" created-at="2026-05-24T22:00:00.000Z">
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
    <comment id="c2" line="file" side="additions" status="open" created-at="2026-05-24T22:08:00.000Z">
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
> - TTY Auto-Detection and Output Mode resolution.
> - The port-agnostic discovery lockfile mechanics.
> - Monotonic sequence `round` synchronization for race-free polling.
> - Full Web API endpoints schema (`GET /api/review/await`, `POST /api/comments`, etc.).
> - Custom git config shell aliases.

---

## License

MIT
