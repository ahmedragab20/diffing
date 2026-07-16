---
name: diffing-finish-review
description: Receive a human's diffing review handoff, apply requested edits, answer questions, and keep comment threads synchronized. Use when the user says their review is ready, asks to process diffing comments, or wants the agent to wait for and address review feedback.
user_invocable: true
---

# Finish a diffing review

Wait for the human handoff, act only on open comments, and synchronize every response back to diffing.

## Receive the handoff

Prefer `await_review` when diffing MCP tools are available. Otherwise run `diffing await-review` from the repository. A timeout is normal: call it again while the user still wants you to wait. If blocking tools are unavailable, use `list_comments` or `diffing comments --open` after the human confirms the review is ready. Pasted `<code-review-comments>` XML is the offline fallback.

Read the root `decision` and `mode` before touching files:

- `comment-only`: do not edit any file. Reply to questions and discuss the general comment.
- `changes-requested`: address every clear open change request.
- `approved`: address any remaining open comments, then continue normally.
- `rejected`: do not keep building on the rejected approach; answer or clarify before replacing it.

## Process each open comment

- Clear change request: inspect the anchored code, make the scoped change, verify it, reply with what changed, then resolve the thread.
- Question: reply with the answer and leave the thread open for the human.
- Ambiguous request: ask a precise clarification question and leave the thread open.
- Resolved comment: do nothing unless the human explicitly reopens it.

Use `reply_to_comment` and `resolve_comment` over MCP. CLI equivalents are:

```bash
diffing reply <comment-id> --body "..." --model "<model-name>"
diffing resolve <comment-id>
```

Resolve only after a requested change is actually applied. Replies and resolutions update the UI live, so send them as each thread is completed instead of batching them at the end.

## Continue the realtime loop

Summarize applied changes and unanswered questions. If the user is continuing the review, await the next round. Never interpret an unchanged timeout as completion or as a blocker.
