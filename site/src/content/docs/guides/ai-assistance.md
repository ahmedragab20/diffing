---
title: AI assistance
description: Optional in-UI review assistant with BYOK, SSO runtimes, and user-triggered actions.
summary: Connect Codex, Claude, OpenCode, Cursor, or Grok; ask about diffs and plans; drafts stay local until you insert them.
order: 2
section: guides
---

The web review UI can run an optional **Ask AI** assistant beside a diff or plan. It is separate from agent handoff (MCP / `await-review`): this surface helps *you* while reviewing. Nothing runs until you click a labeled action.

## Connect providers

Open **Settings → AI connections** from a diff, plan, or mockup Settings panel. Connections and the selected model are **global** across those surfaces.

| Route | Examples |
|-------|----------|
| Account sign-in | Codex / ChatGPT, Claude Code |
| Runtime-managed BYOK | OpenCode and Cursor provider keys + model catalogs |
| Direct API key | Grok (xAI) |

Direct keys are stored in the OS credential vault when available. If the vault is unavailable, the key stays in **server memory for the current session only**. Runtime-managed keys remain owned by OpenCode or Cursor — diffing never reads or copies their credential files. Secrets are **never** written to `settings.json`.

The connections section is collapsed by default and remembers its expanded state. Choosing a model in the toolbar (or **Default model** in Settings) persists to `aiModel` and survives reload.

## Ask AI rail

In a local or PR diff, or on a plan, use the toolbar model picker and **Ask AI**.

Quick actions (surface-dependent):

| Diff / PR | Plan |
|-----------|------|
| Summarize | Summarize |
| Review risks | Find gaps |
| Review map (whole diff) or Explain context (file/selection) | Critique plan |

Composer extras:

- Type `@` to attach repository files (same FFF / frecency search as in-app search). Up to **8** text files / **64 KB** total; chips are removable; content loads only when you send.
- Paste, drag, or attach images (PNG, JPEG, WebP, GIF; up to **4** / **10 MB** each) when the selected model source supports images.
- Responses stream into the rail as GFM Markdown (tables, fenced code, Mermaid, copy).
- **Stop** cancels an in-flight run.

### Conversations

Chats persist under the per-repo store as `ai-conversations.json` (scoped by surface + repo/branch, or plan id). You can switch, rename, or delete threads. Retention is capped (about **40** conversations, **30** days, bounded message size).

### Context rules

- Only the context preview shown in the UI is sent.
- A **whole-diff** ask sends the review’s changed-file map and diff content within the context budget. The focused file is a **navigation hint only** — it does not narrow the scope.
- You can attach up to **8** explicit line ranges (**64 KB** total); those ranges are prioritized.
- Diff requests do not silently include plans; plan requests do not silently include diffs.
- Mockups share connection Settings but expose **no** AI actions.

## Comment and send helpers

On inline comment forms (when a model is connected):

- **Draft comment** / **Improve writing**
- **Shorter** / **More specific**
- **Generate suggestion** (GitHub-style suggestion fence when line content is available)

On **Send review**, you can draft a review summary from the open comments. Generated text stays a draft until you insert or submit it.

## Privacy and triggers

AI is **always user-triggered**. Loading a review, selecting lines, hovering, refreshing, switching plan versions, or changing Settings never starts inference. Endpoints require `trigger: "user"`.

## Related

- [Code review](/docs/guides/code-review/)
- [Plan review](/docs/guides/plan-review/)
- [Settings](/docs/reference/settings/)
- [HTTP API](/docs/reference/http-api/) — `/api/ai/*`
- [Storage](/docs/concepts/storage/)
