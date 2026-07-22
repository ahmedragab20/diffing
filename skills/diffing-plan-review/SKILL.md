---
name: diffing-plan-review
description: Submit an implementation plan to diffing for human approval and obey the verdict before writing code. Use for plan sign-off, architecture review, risky work, or any request to let the human comment on a plan before implementation.
---

# Review an implementation plan with diffing

Use diffing as a real implementation gate: submit clean markdown, wait for the human decision, and do not begin implementation until the plan is approved.

## Start and submit

Prefer MCP when available:

1. `review_session_status`, then `start_review_session` only for `mode: none`. Reuse `mode: web`. Plan tools do not run against the native TUI or GitHub PR API, and MCP will not replace those user-owned sessions; ask the human to end the incompatible session before retrying.
2. `submit_plan` with complete markdown body, title, and model/source when known.
3. **Async handoff (default):** share the plan URL from `submit_plan`, tell the human to review, and **end your turn**. Call `await_plan_review` only when they are reviewing now or explicitly asked you to wait.
4. On `await_plan_review` timeout (`disposition=park`): park again — do **not** silent-loop. At most one extra await if they asked you to keep waiting. When they say a verdict is ready, call `await_plan_review` once (or `get_plan` / `list_plans`).

CLI fallback:

```bash
diffing --web --no-open
diffing plan submit [<plan.md>|-] [--title T] [--source S] [--model M] [--id ID] [--save-source]
# default: prints URL and parks — do not add --wait unless sync
diffing plan submit [<plan.md>|-] --wait [--timeout N]   # sync only
diffing plan await [--timeout N]                         # sync / resume
# or: cat PLAN.md | diffing plan submit --model "..."
```

Keep temporary plan files in **`~/.diffing/<repo>/plan-sources/`** — never in the consumer project tree. Use `--save-source` / `-S` to copy the submitted body there. Prefer stdin for zero working-tree footprint. Always resubmit revisions with the original plan **`--id`** so history stays one conversation.

Useful reads:

```bash
diffing plan list [--json]
diffing plan show [<id>] [--json] [--version n]  # omit id for latest
diffing plan versions <id> [--json]
```

Minimize duplicate reads: `await_plan_review` already returns the reviewed plan and relevant comments. Use `get_plan` / `plan show` only to refresh the current plan, `get_plan_versions` / `plan versions` for lightweight history metadata, and `get_plan_version` / `plan show --version` only for a specific historical body. Do not fetch every historical body by default.

Use plan CLI/MCP/API operations instead of editing `plans.json`; the file-backed store, version snapshots, comment anchors, and `plan-sources/<id>.md` mirror are implementation-owned state under per-repository `~/.diffing/` storage.

MCP intentionally exposes reply and resolve for plan comments, but not edit/delete/reply-edit operations. When correcting a mis-posted plan thread and no native command exists, use the documented loopback `/api/plans/:id/comments*` endpoints; deletion is destructive and requires clear intent.

## Obey the verdict

| Decision | Action |
|----------|--------|
| `approved` | Implement the reviewed version; account for open inline comments. |
| `changes-requested` | Do **not** implement. Reply to open threads, revise plan, resolve addressed threads, `submit` same `planId`, `await` again. |
| `rejected` | Stop. Do not implement or extend the rejected approach. |
| `comment-only` | Do **not** edit files or implement. Only answer questions / discuss. |
| `pending` | Park (async) or sync-await once if asked; do not silent-loop on timeout. |

MCP: `reply_to_plan_comment`, `resolve_plan_comment`, `get_plan`, `get_plan_versions`, `get_plan_version`.

CLI:

```bash
diffing plan reply <comment-id> --body "..." --model "<model-name>"
diffing plan resolve <comment-id>
diffing plan submit <revised-plan.md> --id <plan-id> --model "<model-name>"
```

Only address comments with `status="open"`. Questions stay open after reply; resolve a change request only when the revised plan incorporates it.

## Plan comments, ranges, and severity

Human comments on the plan appear in `<plan-review>` XML with:

- `line="N"` or inclusive `line="A-B"` (multi-line selection)
- optional `severity="blocking|nit|question|praise"` (same triage as code review)
- optional section title and source/quote context

Treat **blocking** as must-fix before resubmit; **nit** as optional; **question** as needing a reply (usually leave open); **praise** as no change required. Missing severity = untriaged normal request.

## Human UI notes (so agents set expectations)

The human reviews at `/plan` or `/plan/<id>`:

| Feature | Behavior |
|---------|----------|
| Source / Read / Split | `m` cycles modes; toolbar switches the same modes |
| Zen Read | `z` toggles full-width focus (switches to Read if needed); Esc exits zen when not editing |
| Live edit | `e` / pencil: edit current version markdown + title; autosave `PUT` (no version bump); Save as new version = `POST` same id; Esc opens Discard |
| Discard | Recent = this session; original = first enter for this version (survives exit/re-enter). Dual choice only when both apply |
| Comments map (right rail) | `c` toggles; lists open threads with `L` / `Lstart–Lend` labels |
| Inline comments | Source: gutter + / line selection; Read: text highlight → Add comment; multi-line ranges with optional severity (paused while live-editing) |
| Read mode threads | Comments render inline under the matching section (React-owned; survives mode switches) |
| Comment cards | Collapsible thread; collapsible source preview inside the card |
| Submit review | Verdict that unblocks `plan await` |

Plans may be versioned; comments are version-anchored when the human browses history. Human in-page edits use `PUT` (same version) unless they explicitly Save as new version.
