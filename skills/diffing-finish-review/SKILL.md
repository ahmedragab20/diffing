---
name: diffing-finish-review
description: Receive a human's diffing review handoff, apply requested edits, answer questions, and keep comment threads synchronized. Use when the user says their review is ready, asks to process diffing comments, or wants the agent to wait for and address review feedback.
---

# Finish a diffing review

Wait for the human handoff, act only on open comments, and synchronize every response back to diffing.

## Receive the handoff

Call `review_session_status` first when MCP is available. `web` and `tui` support the local handoff/comment tools; `gh-pr` does not have **Send to agent**, so route that mode to `diffing-review`'s GitHub workflow.

In TUI mode, limit native operations to await, list/create/edit/delete comment, reply, and resolve/unresolve. TUI does not expose progress/history, bulk resolve, suggestion application, or reply edit/delete endpoints; use scoped working-tree edits and ordinary reply/resolve instead.

Prefer **`await_review`** for a local session. Otherwise run:

```bash
diffing await-review [--timeout <sec>] [--model <name>] [--label <text>] [--agent-id <stable-id>]
```

A timeout (MCP `status: timeout`; CLI exit `2`) is normal: call it again while the user still wants you to wait. CLI identity flags let the UI distinguish multiple waiting agents; reuse the same `--agent-id` for that agent. If blocking tools are unavailable, use `list_comments` or:

```bash
diffing comments --open
diffing comments --format md    # optional markdown export
```

after the human confirms the review is ready. Pasted `<code-review-comments>` XML is the offline fallback.

A released `await_review` result already includes the handoff XML and structured comments. Act on that payload directly; do not immediately fetch the same threads again. When a refresh is necessary, use `list_comments` with `openOnly: true` or `diffing comments --open`.

Read the root **`decision`** and **`mode`** before touching files:

| Decision / mode | Behavior |
|-----------------|----------|
| `comment-only` | Do not edit any file. Reply to questions and discuss the general comment. |
| `changes-requested` | Address every clear open change request. |
| `approved` | Address remaining open comments, then continue normally. |
| `rejected` | Do not keep building on the rejected approach; answer or clarify first. |

## Process each open comment

- **Clear change request**: inspect the anchored code and only the surrounding context needed, make the scoped change, verify, reply with what changed, then **resolve**. Do not refetch the full patch for every thread.
- **Question** (body is a question, or `severity="question"`): reply with the answer; **leave open**.
- **Ambiguous**: ask a precise clarification; **leave open**.
- **Nit** (`severity="nit"`): optional polish — apply when cheap; otherwise reply why not.
- **Blocking** (`severity="blocking"`): treat as must-fix before considering the review done.
- **Praise** (`severity="praise"`): no code change required; optional brief acknowledge.
- **Multi-line** (`line="A-B"`): the range is **inclusive** on that `side` — fix the whole span, not only the last line.
- **Resolved**: do nothing unless the human reopens it (`unresolve_comment` / `diffing unresolve`).
- **```suggestion` fence**: apply via `apply_suggestion` MCP or `POST /api/comments/<id>/apply-suggestion` when appropriate.

`apply_suggestion` edits the working tree on the additions side and resolves the thread. Do not use it in `comment-only` mode. Treat `delete_comment`, `delete_reply`, and `resolve_all_comments` as destructive/bulk actions: use them only when explicitly intended, and never bulk-resolve as a substitute for addressing threads.

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

After edits, run focused verification proportionate to the change. If verification fails, keep the thread open and reply with the concrete blocker rather than claiming completion.

## Continue the realtime loop

Summarize applied changes and unanswered questions. If the user continues the review, await the next round (`await_review` / `await-review`). Never treat an unchanged timeout as completion.

Optional: `get_review_history` for multi-round web-session context. History is in memory only, is empty after a server restart, and is not provided by the native TUI API.
