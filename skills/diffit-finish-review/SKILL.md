---
name: diffit-finish-review
description: "Finish a code review session by fetching comments from the running diffit server, applying requested changes, and marking comments as resolved. Use when the user invokes /diffit-finish-review."
user_invocable: true
---

# Finish diffit Review

Fetch all review comments from the running diffit server, apply the requested changes, and mark each comment as resolved.

## What to do

### 1. Fetch comments from the API

The diffit server is running locally. Check the earlier conversation context for the port diffit reported on startup. Fetch all comments:

```bash
curl -s http://localhost:<port>/api/comments
```

Replace `<port>` with the port number diffit reported on startup (visible in the server log output).

The response is a JSON array of comment objects:

```json
[
  {
    "id": "uuid",
    "filePath": "src/utils/parser.ts",
    "side": "additions",
    "lineNumber": 42,
    "lineContent": "const x = tokenize(input)",
    "body": "Rename x to parsedToken for clarity",
    "status": "open",
    "createdAt": 1234567890,
    "replies": []
  }
]
```

### 2. Process each comment

For each comment with `"status": "open"`, first determine the intent — is it a **change request** or a **question**?

#### Change requests (e.g., "Rename x to parsedToken", "Extract this into a helper")

1. Read the file at `filePath`
2. Find the relevant code using `lineContent` as context
3. Apply the change described in `body`
4. Reply to the comment explaining what you did, then mark it as resolved:

```bash
# Reply to the comment
curl -s -X POST http://localhost:<port>/api/comments/<id>/replies \
  -H "Content-Type: application/json" \
  -d '{"body": "Done. Renamed x to parsedToken."}'

# Mark as resolved
curl -s -X PUT http://localhost:<port>/api/comments/<id> \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}'
```

#### Questions (e.g., "Why not use a Map here?", "Is this thread-safe?")

Just reply with an answer. Do **not** modify code or resolve the comment — leave it open for the user to read and follow up if needed.

```bash
curl -s -X POST http://localhost:<port>/api/comments/<id>/replies \
  -H "Content-Type: application/json" \
  -d '{"body": "A Map would work too, but we use a plain object here because..."}'
```

The `side` field tells you whether the comment is on an added line (`additions`) or a deleted line (`deletions`).

### 3. Handle edge cases

- If a comment is ambiguous, reply to ask for clarification rather than guessing.
- If multiple comments interact (e.g., a rename that affects several places), handle them together.
- If there are no open comments, tell the user there's nothing to process.

### 4. Summary

After processing all comments, give a brief summary of what you did: how many changes were applied, how many questions were answered.
