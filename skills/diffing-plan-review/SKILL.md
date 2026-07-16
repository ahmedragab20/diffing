---
name: diffing-plan-review
description: Submit an implementation plan to diffing for human approval and obey the verdict before writing code. Use for plan sign-off, architecture review, risky work, or any request to let the human comment on a plan before implementation.
user_invocable: true
---

# Review an implementation plan with diffing

Use diffing as a real implementation gate: submit clean markdown, wait for the human decision, and do not begin implementation until the plan is approved.

## Start and submit

Prefer diffing MCP tools when available:

1. Call `review_session_status`, then `start_review_session` if needed.
2. Call `submit_plan` with the complete markdown body, a useful title, and model/source attribution when known.
3. Call `await_plan_review`. A timeout is normal; retry while the user still wants you to wait.

CLI fallback:

```bash
diffing --web --no-open
diffing plan submit <plan.md> [--save-source] --title "..." --model "<model-name>"
diffing plan await
```

Keep temporary plan files in `~/.diffing/<repo>/plan-sources/` rather than anywhere in the consumer project's working tree. Use `--save-source` / `-S` on `diffing plan submit` to automatically save a copy there. Piping the body on stdin is also supported (this is the preferred path — zero filesystem footprint). Always resubmit revisions with the original plan ID so history remains one conversation.

## Obey the verdict

- `approved`: implement the reviewed version, taking open inline comments into account.
- `changes-requested`: do not implement. Reply to each open thread, revise the plan, resolve addressed threads, resubmit the same `planId`, and await another verdict.
- `rejected`: stop. Do not implement or keep extending the rejected approach.
- `comment-only`: do not edit files or implement. Only answer questions and discuss the decision comment.
- `pending`: keep waiting or report that no decision has been made.

Use `reply_to_plan_comment` and `resolve_plan_comment` over MCP. CLI equivalents are:

```bash
diffing plan reply <comment-id> --body "..." --model "<model-name>"
diffing plan resolve <comment-id>
diffing plan submit <revised-plan.md> --id <plan-id> --model "<model-name>"
```

Only address comments with `status="open"`. Questions and ambiguous requests should receive a reply and remain open; resolve a change request only when the revised plan actually incorporates it.
