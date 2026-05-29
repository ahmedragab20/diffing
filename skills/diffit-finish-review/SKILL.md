---
name: diffit-finish-review
description: "Finish a code review session by waiting for the human to send their comments from the running diffit server, applying requested changes, and marking comments as resolved. Use when the user invokes /diffit-finish-review."
user_invocable: true
---

# Finish diffit Review

Wait for the human to hand off their review comments, apply the requested changes, and mark each comment as resolved. This uses the port-agnostic `diffit` subcommands — you never need to know the server's port.

## What to do

### 1. Wait for the human to send the review

Run the blocking handoff command. It sleeps until the human clicks **"Send to agent"** in the diffit UI, then prints the review comments to stdout as `<code-review-comments>` XML:

```bash
diffit await-review
```

Exit codes:
- **0** — a review was sent; the comment XML is on stdout. Proceed.
- **2** — timed out waiting (`DIFFIT_AWAIT_TIMEOUT` on stderr). The human hasn't sent yet — just run `diffit await-review` again to keep waiting.
- **3** — no diffit server is running for this repo. Ask the user to start one with `diffit`.

The XML lists each comment with its `id`, `line`, `side`, `status`, the `<code>` context, the `<body>` request, and any prior `<replies>`. Only act on comments with `status="open"`.

> If you prefer a one-shot snapshot without blocking, `diffit comments --open` dumps the current open comments at any time.

### 2. Process each open comment

For each open comment, first determine the intent — is it a **change request** or a **question**?

#### Change requests (e.g., "Rename x to parsedToken", "Extract this into a helper")

1. Read the file at the comment's `path`
2. Find the relevant code using the `<code>` context
3. Apply the change described in `<body>`
4. Reply explaining what you did, then mark it resolved:

```bash
diffit reply <comment-id> --body "Done. Renamed x to parsedToken." --model "<your-model-name>"
diffit resolve <comment-id>
```

#### Questions (e.g., "Why not use a Map here?", "Is this thread-safe?")

Just reply with an answer. Do **not** modify code or resolve the comment — leave it open for the human to read and follow up.

```bash
diffit reply <comment-id> --body "A Map would work too, but we use a plain object here because..." --model "<your-model-name>"
```

Each reply and resolve shows up in the diffit UI in real time (the human sees a toast), so the human can watch your progress live.

### 3. Handle edge cases

- If a comment is ambiguous, reply to ask for clarification rather than guessing (leave it open).
- If multiple comments interact (e.g., a rename that affects several places), handle them together.
- If there are no open comments, tell the user there's nothing to process.

### 4. Summary, then wait for the next round

After processing all comments, give a brief summary: how many changes you applied, how many questions you answered.

The handoff supports multiple rounds. If the human may review your changes and send again, loop back to step 1 (`diffit await-review`) to pick up the next batch.

## MCP alternative

If you're configured with the diffit MCP server instead of a shell, the equivalent tools are `await_review`, `list_comments`, `reply_to_comment`, and `resolve_comment`.
