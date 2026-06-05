---
name: diffing-finish-review
description: "Finish a code review session by waiting for the human to send their comments from the running diffing server, applying requested changes, and marking comments as resolved. Use when the user invokes /diffing-finish-review."
user_invocable: true
---

# Finish diffing Review — Detailed Reference

> See AGENTS.md for the workflow overview. This file contains the complete CLI
> reference for processing review handoffs.

---

## 1. Wait for Human to Send Review

Run the blocking handoff command. It sleeps until the human clicks **"Send to
agent"** in the diffing UI, then prints the review comments to stdout as
`<code-review-comments>` XML:

```bash
diffing await-review
```

Exit codes:
- **0** — a review was sent; the comment XML is on stdout. Proceed.
- **2** — timed out waiting (`DIFFING_AWAIT_TIMEOUT` on stderr). The human
  hasn't sent yet — just run `diffing await-review` again to keep waiting.
- **3** — no diffing server is running for this repo. Ask the user to start
  one with `diffing`.

The XML lists each comment with its `id`, `line`, `side`, `status`, the
`<code>` context, the `<body>` request, and any prior `<replies>`. **Only act
on comments with `status="open"`.**

> If you prefer a one-shot snapshot without blocking, `diffing comments --open`
> dumps the current open comments at any time.

---

## 2. Process Each Open Comment

For each open comment, first determine the intent — is it a **change request**
or a **question**?

### Change Requests (e.g., "Rename x to parsedToken", "Extract this into a helper")

1. Read the file at the comment's `path`
2. Find the relevant code using the `<code>` context
3. Apply the change described in `<body>`
4. Reply explaining what you did, then mark it resolved:

```bash
diffing reply <comment-id> --body "Done. Renamed x to parsedToken." --model "<your-model-name>"
diffing resolve <comment-id>
```

### Questions (e.g., "Why not use a Map here?", "Is this thread-safe?")

Just reply with an answer. **Do not** modify code or resolve the comment —
leave it open for the human to read and follow up.

```bash
diffing reply <comment-id> --body "A Map would work too, but we use a plain object here because..." --model "<your-model-name>"
```

Each reply and resolve shows up in the diffing UI in real time (the human sees
a toast), so the human can watch your progress live.

---

## 3. Handle Edge Cases

- If a comment is ambiguous, reply to ask for clarification rather than guessing
  (leave it open).
- If multiple comments interact (e.g., a rename that affects several places),
  handle them together.
- If there are no open comments, tell the user there's nothing to process.

---

## 4. Summary, Then Wait for Next Round

After processing all comments, give a brief summary: how many changes you
applied, how many questions you answered.

The handoff supports multiple rounds. If the human may review your changes and
send again, loop back to step 1 (`diffing await-review`) to pick up the next
batch.

---

## MCP Alternative

If you're configured with the diffing MCP server instead of a shell, the
equivalent tools are `await_review`, `list_comments`, `reply_to_comment`, and
`resolve_comment`.

---

## Summary

| Command | Purpose |
|---------|---------|
| `diffing await-review` | Block until human sends review |
| `diffing comments --open` | Snapshot of open comments (non-blocking) |
| `diffing reply <id> --body "..." --model "..."` | Reply to a comment |
| `diffing resolve <id>` | Mark comment resolved |