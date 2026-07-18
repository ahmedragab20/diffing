---
name: diffing-finish-review
description: Receive a human's diffing review handoff, apply requested edits, answer questions, and keep comment threads synchronized. Use when the user says their review is ready, asks to process diffing comments, or wants the agent to wait for and address review feedback.
user_invocable: true
---

# Finish a diffing review

Wait for the human handoff, act only on open comments, and synchronize every response back to diffing.

## Receive the handoff

Prefer **`await_review`** when MCP is available. Otherwise run:

```bash
diffing await-review [--timeout <sec>]
```

A timeout is normal: call it again while the user still wants you to wait. If blocking tools are unavailable, use `list_comments` or:

```bash
diffing comments --open
diffing comments --format md    # optional markdown export
```

after the human confirms the review is ready. Pasted `<code-review-comments>` XML is the offline fallback.

Read the root **`decision`** and **`mode`** before touching files:

| Decision / mode | Behavior |
|-----------------|----------|
| `comment-only` | Do not edit any file. Reply to questions and discuss the general comment. |
| `changes-requested` | Address every clear open change request. |
| `approved` | Address remaining open comments, then continue normally. |
| `rejected` | Do not keep building on the rejected approach; answer or clarify first. |

## Process each open comment

- **Clear change request**: inspect the anchored code, make the scoped change, verify, reply with what changed, then **resolve**.
- **Question**: reply with the answer; **leave open**.
- **Ambiguous**: ask a precise clarification; **leave open**.
- **Resolved**: do nothing unless the human reopens it (`unresolve_comment` / `diffing unresolve`).
- **```suggestion` fence**: apply via `apply_suggestion` MCP or `POST /api/comments/<id>/apply-suggestion` when appropriate.

MCP:

```
reply_to_comment · resolve_comment · unresolve_comment
edit_comment · delete_comment · edit_reply · delete_reply
apply_suggestion · resolve_all_comments · report_progress
```

CLI:

```bash
diffing reply <comment-id> --body "..." --model "<model-name>"
diffing resolve <comment-id>
diffing unresolve <comment-id>
diffing comment edit <comment-id> --body "..."
diffing progress --message "Addressing L42…" [--pct 40] [--model M]
```

Resolve only after a requested change is actually applied. Replies and resolutions update the UI live — send them as each thread completes.

## Continue the realtime loop

Summarize applied changes and unanswered questions. If the user continues the review, await the next round (`await_review` / `await-review`). Never treat an unchanged timeout as completion.

Optional: `get_review_history` for multi-round context.
