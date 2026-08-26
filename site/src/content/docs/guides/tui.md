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

## Related

- [Keyboard](/docs/reference/keyboard/) (web-first; TUI has its own keymap in CLI deep-dive)
- [Getting started](/docs/getting-started/)
