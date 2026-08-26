---
title: Mockup review
description: Submit HTML mockups for human visual review before implementation.
summary: Agents submit HTML screens, humans pin comments and verdict approved/changes-requested/rejected, then agents act — with version+screen+viewport scoped comments and bounded inspect/revise flows.
order: 9
section: guides
---

Mockup review gates **visual implementation** on human sign-off. Use it for UI work — layouts, components, or whole screens — before writing the real code.

## Flow

```text
1. Keep HTML in memory or under ~/.diffing/ only — never write mockup files into the consumer repo
2. submit → share mockup URL → park (async default)
3. Human reviews at /mockup/<id> at desktop/tablet/mobile, pins comments, Submit review
4. Agent inspects open comments → patches one screen → batch replies/resolves
```

## Comment scope

Every comment is scoped to **version + screen + viewport** (`desktop` | `tablet` | `mobile` — the layout width at click time; legacy comments anchor on `desktop`). Handoff XML, inspect filters, and the UI all use the same scope, so a comment is only addressed in the exact view where it was written.

## CLI

```bash
diffing mockup submit - [--title T] [--id ID] [--model M] [--screen id=path]... [--wait]
diffing mockup await [--timeout 570]          # sync / resume
diffing mockup list|show|versions
diffing mockup inspect <summary|comments|comment|screen> [<id>] [--status open] [--screen S] [--viewport V] [--version N] [--context none|anchor|source]
diffing mockup screen <upsert|remove|patch|replace-region> <id> <screen-id> [--file P|--text T --region R --replacement R] [--expected-version N]
diffing mockup threads <reply|edit|delete|resolve|unresolve> <comment-id> [<reply-id>] [--body "…"] [--model M]
```

- `inspect` — compact, paginated reads; `context=anchor` (default) adds locator fields, `source` adds `contextHtml`/full screen html. Filter `comments` by status/screen/viewport/version; bodies truncate at 400 chars.
- `screen` — one-screen upsert / remove / exact-text patch. Each success bumps the version; `--expected-version N` aborts with 409 on conflict (nothing applied).
- `threads` — **atomic** batch: all ops validated before any applies, all-or-nothing, never bumps the version. Prefer for multi-op replies.

### Efficient agent recipe

```bash
diffing mockup inspect comments <id> --status open              # 1. open threads
diffing mockup inspect screen <id> --screen main --context source  # 2. exact source of one screen
diffing mockup screen patch <id> main --text '<h1>Old</h1>' --replacement '<h1>New</h1>' --expected-version 3  # 3. patch one screen
diffing mockup threads reply <c1> --body "fixed" --model "…"    # 4. batch reply/resolve
diffing mockup threads resolve <c1>
```

Resubmit full revisions with the **same** `--id` so history stays one conversation.

## MCP

`submit_mockup`, `await_mockup_review`, `list_mockups`, `get_mockup`, `get_mockup_versions`, `get_mockup_version` — plus the redesign's preferred tools:

| Tool | Purpose |
|------|---------|
| `inspect_mockup` | Bounded reads (`view=summary/comments/comment/screen/preview`, filters by `status`/`screenId`/`viewport`/`version`, `context=none|anchor|source`) |
| `revise_mockup` | One-screen `op=upsert/remove/patch/replace-region` with `expectedVersion` guard |
| `update_mockup_threads` | Atomic thread batch (reply/edit/delete/resolve/unresolve) |
| `get_mockup_handoff` | Compact implementation packet after `approved` |
| `get_design_system` | Read tokens/guidelines before authoring |

## Verdicts

| Decision | Agent action |
| ---------- | -------------- |
| `approved` | Implement the reviewed mockup; account for open comments |
| `changes-requested` | **Do not implement.** Revise the HTML, batch-reply + resolve addressed threads, resubmit same mockupId |
| `rejected` | **Stop.** Do not implement |
| `comment-only` | Reply only; do not edit product files |
| `pending` | Park (async) or one sync await if asked |

## Handoff XML

The default `<mockup-review>` is **compact and open-only**: open comments on the current version only, terse attrs, no instruction block, no markup payload. Each `<comment>` carries `kind="section|block|point"`, `screen="<id>"`, `mockup-version="<n>"`, `viewport="…"`, and its anchor fields. `x=`/`y=`/`rect` are viewport-relative and **not stable across screens or viewport sizes** — pull the markup via `inspect_mockup` (`context=source`) or `mockup inspect screen … --context source` instead.

## Comment anchors

`section` (a `[data-diffing]` region via `target=`), `block` (a computed `selector=` + section-relative `fingerprint=` that survives edits elsewhere), or `point` (x/y percent). Severity is the same triage as code review: `blocking` | `nit` | `question` | `praise`.

## Mockup UI (human)

| Feature | Behavior |
| --------- | ---------- |
| Scope | Viewport toggle (desktop/tablet/mobile) + screen tabs with per-screen open counts; comments pinned only for the exact version+screen+viewport in view |
| Rails | Left list and right comments rail drag-resize (widths persisted); rail collapses to a bottom sheet on narrow windows |
| History | Header version switcher; read-only historical versions (comments disabled); rail shows an explicit prior-version unresolved group that jumps to that version |
| Threads | Collapsible cards, replies, edit/delete, resolve |
| Submit review | Approve / Request changes / Reject / Comment only; popover reports scoped vs total open counts; releases `mockup await` |

## Keep the tree clean

Never write mockup HTML or `.diffing/` directories into the consumer project. Screens are mirrored to `~/.diffing/<repo>/mockup-sources/<id>/`; or submit from stdin:

```bash
cat mockup.html | diffing mockup submit --model "your-model"
```
