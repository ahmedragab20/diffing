---
title: Settings
description: User preferences file and common keys.
summary: Global settings live in ~/.config/diffing/settings.json including defaultMode, theme, and diff presentation.
order: 6
section: reference
---

## Location

```text
~/.config/diffing/settings.json
```

Per-repo UI session state (panel sizes, drafts, etc.) lives under `~/.diffing/<repo>-<hash>/` — **not** browser localStorage.

## Common keys

Defaults may evolve; inspect your file or product source for the latest schema. Representative fields:

| Key | Role |
| ----- | ------ |
| `defaultMode` | `"web"` \| `"tui"` interactive default |
| `theme` | Theme id (default **`rose-pine`**) |
| `diffStyle` | `"split"` \| `"unified"` |
| `defaultTabSize` | Fallback tab width (editorconfig wins) |
| `editorIDE` | `default` \| `vscode` \| `zed` \| `vim` \| `neovim` \| `ghostty` |
| `lineDiffType` | `word` \| `word-alt` \| `char` \| `none` |
| `lineWrap` | boolean |
| `diffIndicators` | `classic` \| `bars` \| `none` |
| `showLineNumbers` | boolean |
| `tuiMouseEnabled` | boolean |
| `fontSize` | base code font size (px) |
| `haptics` | sounds / haptics in web UI |
| `setupCompletedAt` | first-run wizard marker |
| `staged` / `untracked` | default inclusion toggles |
| `aiModel` | persisted Ask AI model id (`source/credential/provider/model`) |
| `aiReasoningEffort` | optional model-specific reasoning effort |
| `aiServiceTier` | optional model-specific service tier |
| `aiRailWidth` | shared diff/plan Ask AI rail width (px) |
| `aiPrivacyAcknowledged` | context-sharing notice acknowledged |
| `aiSettingsExpanded` | AI connections section expanded/collapsed |

AI provider secrets are **never** stored in this file. Direct BYOK keys use the OS credential vault or session memory; OpenCode/Cursor-managed keys stay in those runtimes. See [AI assistance](/docs/guides/ai-assistance/).

## Theme

Change in UI with <kbd>g</kbd> <kbd>t</kbd> or settings. 52 themes — see [Themes](/docs/design/themes/).

## Mode

```bash
diffing mode web
diffing mode tui
```
