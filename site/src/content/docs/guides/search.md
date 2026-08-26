---
title: Search
description: Rust-powered fuzzy file, text, symbol, and unified search in the review UI.
summary: Four scopes via fff — files, text, symbols, all — with frecency ranking and graceful degradation.
order: 7
section: guides
---

Search is powered by `@ff-labs/fff-node` (native Rust). If the binary is unavailable for your platform, search reports unavailable — the server does not crash.

## Scopes

| Scope | Behavior |
|-------|----------|
| **Files** | Fuzzy path matching |
| **Text** | Grep; optional regex |
| **Symbols** | 27 patterns across JS/TS, Go, Rust, Python, PHP |
| **All** | Concurrent unified results |

Symbol kinds: functions, classes, interfaces, types, enums, variables, structs, impls, traits, methods.

## UI

- <kbd>/</kbd> — all-scope search (often changed-only)
- <kbd>s</kbd> — symbol search
- <kbd>g</kbd> <kbd>v</kbd> — file browser
- **Changed only** filter restricts to active diff paths

## Limits

- Default limit **60**, max **200**
- Frecency/history DBs under `~/.diffing/<repo>-<hash>/fff/`

## HTTP

`POST /api/search` with `{ scope, query, limit, regex, changedPaths? }`.

Selections can update frecency via `POST /api/search/track`.

## Related

- [HTTP API](/docs/reference/http-api/)
- [Keyboard](/docs/reference/keyboard/)
