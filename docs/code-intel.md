# Code intel

The review page can act like a small editor: hover a token for its type and
docs, jump to its declaration, see compiler diagnostics while editing in
place, and apply a rename, format, or quick fix — without leaving the diff.

Code intel is **enabled by default**. Installed language servers on `PATH`
are detected automatically, including TypeScript/JavaScript, Python, Rust,
Go, C/C++, JSON, CSS, HTML, YAML, and Lua. Servers start only when requested.
Turn Code intel off under Settings → Editing to disable hover and navigation.
Edit diagnostics and AI edit prediction remain off by default.

## Configure a language server

Override detection or add another server per file extension in the settings file
(`diffing config` or `~/.config/diffing/settings.json`):

```jsonc
{
  "aiLanguageServers": {
    "ts": { "command": "typescript-language-server", "args": ["--stdio"] },
    "tsx": { "command": "typescript-language-server", "args": ["--stdio"] }
  }
}
```

`languageServers` is accepted as an alias for `aiLanguageServers`. The command
is resolved on `PATH` and never run through a shell. A missing binary reports
the feature unavailable rather than pretending there were no results.

Hover, declaration lookup, and references support **both sides** of local,
staged, revision-range, individual-commit, and GitHub PR diffs. Each card carries
its source identity. Historical and index sources are materialized in isolated
analysis workspaces; the user's checkout is not changed. PR source archives use
the existing `gh` authentication and the displayed commit SHA.

Installed third-party dependencies are reused when the captured package and
lock files match the checkout. Otherwise local symbol information still works,
but types from missing dependencies may be incomplete. Servers are never
installed automatically. Missing servers or unavailable sources are explained
in the hover rather than silently producing an empty result.

## What you get

| Setting | What it does |
| --- | --- |
| **Code intel** | Hover a token for type and docs. Modifier-click (⌘/Ctrl) opens the declaration — in the diff when that file is already there, otherwise in a peek panel. While editing: F2 rename, Shift+Alt+F format, **Fix…** on a selection for quick fixes. |
| **Edit diagnostics** | Built-in whitespace checks while editing. Combined with Code intel, also shows the language server's diagnostics, merged and capped. |
| **Edit prediction (Alt)** | Ghost-text suggestions from the configured AI model, only for files already in the diff. Hold Alt to show one. Off by default. |

A rename or quick fix that would also change other files is **reported, not
applied**: "12 edits across 4 files — not applied, this file only". Code
actions that only run a language-server command are listed as unavailable.

## Limits

- Servers are reused per command and source workspace, with bounded idle lifetime.
- Source workspaces are bounded to 8 cached roots, 30,000 files, and 256 MiB per
  source. Archive symlinks and submodules are omitted. Expired source snapshots
  report unavailable; refresh the diff to capture them again.
- The language server never writes files or runs commands. Edits go through
  the local editor's undo stack.
- Hover markdown is sanitized like every other repository-derived body.
