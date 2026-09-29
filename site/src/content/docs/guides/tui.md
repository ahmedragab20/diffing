---
title: Terminal UI (TUI)
description: Experimental native Rust review UI and read-only viewer.
summary: diffing view is the read-only browser; --tui is full review. Experimental — web remains the supported production path.
order: 6
section: guides
---

> **Experimental.** Interface, keymap, and on-disk `mode: "tui"` details may change in a minor release. The **web UI** is the supported path for production workflows.

## Two surfaces

| Command | Role |
|---------|------|
| `diffing view` / `--view` | Focused **read-only** native diff browser (ergonomic `git diff`) |
| `diffing --tui` | Full review: comments, handoff, agent loop in-terminal |
| `diffing mode tui` | Make full TUI the interactive default |

Native binaries ship via optional platform packages on npm install. Fallbacks: source build under `crates/diffing-tui`, or a `diffing-tui` on `$PATH`.

```bash
diffing view
diffing --tui
diffing mode tui
diffing mode web     # restore web default
```

## Behavior notes

- Shares sparse diff index ideas with headless inspect tools
- Publishes a capability-scoped loopback API through the session registry
- Web and TUI can run **concurrently** for the same repo
- Read-only viewer does **not** register a full review session
- Mouse capture configurable (`tuiMouseEnabled` in settings)

## Build from source

```bash
pnpm build:tui
# or
cargo build --release --manifest-path crates/diffing-tui/Cargo.toml
```

## Design

TUI chrome follows [Gridline](/docs/design/gridline/) — same semantic roles as the web adapter.

The workspace keeps file names in a quiet side rail, change totals in the
active-file header, and contextual shortcuts in the bottom strip. On narrow
terminals, Tab switches between full-width panes. Comments show their location
and body on separate rows when the review rail is narrow. The top bar tracks
viewed files, and `v` or the file header's **Mark viewed** action updates progress.

Press `zf` for focused reading. Press it again to restore your panels, or Tab to
restore them and move focus. This temporary layout does not change your saved
preferences. Settings groups diff display, workspace, language tools, and appearance.

## Find an action

Press `Ctrl-P` or `:` and type a task such as `line wrap`, `find a file`, or
`send review`. Use the arrow keys and Enter to run it, or Escape to close.
The read-only viewer shows only its available actions. Existing colon commands
still work, and `:42` jumps to line 42 when that line is present in the diff.

`/` searches changes, `f` finds files, `gs` finds symbols, `?` opens the full
keymap, and `,` opens settings. Home/End move to the start/end of the diff.
Truecolor and ANSI-256 palettes preserve readable text contrast; `NO_COLOR`
provides a monochrome rendering path.

## Working with an agent

Press **S** for **Send to agent**. Choose Approve, Request edits, Reject, or
Comment only; review your comments and add an optional note. Comment only tells
the agent to reply without editing files. **Tab** moves between fields,
**Ctrl+S** sends, and **Esc** keeps your draft while you inspect the diff.
**Ctrl+Y** copies the handoff when you want to paste it into a chat.

The dialog tells you whether an agent is waiting. You can send before the agent
connects: `diffing await-review` collects the latest handoff. For subsequent
rounds, agents pass `--since <last-round>`. Live progress stays in the header;
reply notifications open the relevant thread. You can also find **Open latest
agent reply** in Actions.

The shared “require all files viewed” preference controls the extra send
confirmation. Failed saves keep the draft open. Sending leaves your clipboard
alone. Review delivery and history stay available while the TUI session runs;
the XML export remains on disk afterward.

## Related

- [Keyboard](/docs/reference/keyboard/) (web-first; TUI has its own keymap in CLI deep-dive)
- [Getting started](/docs/getting-started/)
