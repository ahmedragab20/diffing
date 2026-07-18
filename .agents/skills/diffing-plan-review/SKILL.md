---
name: diffing-plan-review
description: Submit an implementation plan to diffing for human approval and obey the verdict before writing code. Use for plan sign-off, architecture review, risky work, or any request to let the human comment on a plan before implementation.
user_invocable: true
---

# Review an implementation plan with diffing

Use diffing as a real implementation gate: submit clean markdown, wait for the human decision, and do not begin implementation until the plan is approved.

## Start and submit

Prefer MCP when available:

1. `review_session_status`, then `start_review_session` if needed.
2. `submit_plan` with complete markdown body, title, and model/source when known.
3. `await_plan_review`. Timeout is normal; retry while the user still wants you to wait.

CLI fallback:

```bash
diffing --web --no-open
diffing plan submit <plan.md> [--save-source] --title "..." --model "<model-name>"
diffing plan await
# or: cat PLAN.md | diffing plan submit --model "..."
```

Keep temporary plan files in **`~/.diffing/<repo>/plan-sources/`** — never in the consumer project tree. Use `--save-source` / `-S` to copy the submitted body there. Prefer stdin for zero working-tree footprint. Always resubmit revisions with the original plan **`--id`** so history stays one conversation.

Useful reads:

```bash
diffing plan list [--json]
diffing plan show <id> [--json] [--version n]
diffing plan versions <id> [--json]
```

## Obey the verdict

| Decision | Action |
|----------|--------|
| `approved` | Implement the reviewed version; account for open inline comments. |
| `changes-requested` | Do **not** implement. Reply to open threads, revise plan, resolve addressed threads, `submit` same `planId`, `await` again. |
| `rejected` | Stop. Do not implement or extend the rejected approach. |
| `comment-only` | Do **not** edit files or implement. Only answer questions / discuss. |
| `pending` | Keep waiting or report no decision yet. |

MCP: `reply_to_plan_comment`, `resolve_plan_comment`, `get_plan`, `get_plan_versions`, `get_plan_version`.

CLI:

```bash
diffing plan reply <comment-id> --body "..." --model "<model-name>"
diffing plan resolve <comment-id>
diffing plan submit <revised-plan.md> --id <plan-id> --model "<model-name>"
```

Only address comments with `status="open"`. Questions stay open after reply; resolve a change request only when the revised plan incorporates it.

## Human UI notes (so agents set expectations)

The human reviews at `/plan` or `/plan/<id>`: Source / Read / Split views, optional zen full-width Read, outline, comments rail, and **Submit review** for the verdict that unblocks `plan await`.
