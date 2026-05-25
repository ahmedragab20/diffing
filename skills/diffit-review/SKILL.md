---
name: diffit-review
description: >
  Perform a GitHub-style code review of local git changes using diffit.
  Fetches the diff and inline comments from the running diffit server,
  analyses every changed file, posts inline review comments via the API,
  replies to existing human comments, applies requested code changes, and
  marks comments resolved — all without touching the browser.
  Use when the user asks you to review their local changes, address review
  comments, or work through a diffit review session.
user_invocable: true
---

# diffit Review — Full Agent Workflow

diffit exposes a local HTTP server that mirrors a GitHub PR review experience
for uncommitted git changes. This skill covers the complete lifecycle:

1. **Discover** the running server and fetch the diff + comments
2. **Review** every changed file and post inline comments
3. **Address** open human comments (apply changes / answer questions)
4. **Reply** to any comment via the API so replies appear in the UI
5. **Resolve** comments once handled

---

## 0. Prerequisites

The diffit server must already be running. If it is not, start it first:

```bash
diffit                        # all working-tree changes (staged + unstaged + untracked)
diffit -- --staged            # staged only
diffit -- HEAD~3              # last 3 commits
diffit -- main..HEAD          # branch vs main
diffit -p 8080               # custom port
```

Run it in the background so it stays alive during the review. The server
prints the URL on startup, e.g. `diffit server running at http://127.0.0.1:5173`.
Note the port — every API call below uses it.

> Replace `<port>` with the actual port in all commands that follow.

---

## 1. Fetch the diff

```bash
curl -s "http://localhost:<port>/api/diff" | jq '{branch, repoName, binaryFiles: .binaryFiles}'
```

The full unified diff is in the `patch` field. Parse it to understand every
changed file and line. Key fields:

| Field | Description |
|---|---|
| `patch` | Full unified diff (git diff output) |
| `repoName` | Repository name |
| `branch` | Current branch |
| `binaryFiles` | Array of `{path, type}` for binary/image changes |
| `tabSizeMap` | `{filePath: tabSize}` per-file indent size |

---

## 2. Fetch existing comments

```bash
curl -s "http://localhost:<port>/api/comments"
```

Returns a JSON array of `ReviewComment` objects:

```json
[
  {
    "id": "uuid",
    "filePath": "src/utils/parser.ts",
    "side": "additions",
    "lineNumber": 42,
    "startLineNumber": 38,
    "lineContent": "const x = tokenize(input)\n...",
    "body": "Rename x to parsedToken for clarity",
    "status": "open",
    "createdAt": 1234567890000,
    "replies": [
      {
        "id": "reply-uuid",
        "body": "Good catch, will fix.",
        "createdAt": 1234567891000,
        "role": "user",
        "model": null
      }
    ]
  }
]
```

**Field reference:**

| Field | Values | Meaning |
|---|---|---|
| `side` | `"additions"` / `"deletions"` | Added/modified line vs deleted/old line |
| `status` | `"open"` / `"resolved"` | Only act on `"open"` comments |
| `lineNumber` | integer | End line of the commented range |
| `startLineNumber` | integer | Start line (may equal `lineNumber` for single-line) |
| `lineContent` | string | Raw code text at those lines (may be multi-line) |
| `replies[].role` | `"user"` / `"agent"` | Who wrote the reply |
| `replies[].model` | string / null | Model name for agent replies |

---

## 3. Post your own inline review comments

After reading the diff, post comments on any lines that need attention.
This is equivalent to GitHub's "Add a comment" on a specific diff line.

```bash
curl -s -X POST "http://localhost:<port>/api/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "src/utils/parser.ts",
    "side": "additions",
    "lineNumber": 42,
    "startLineNumber": 38,
    "lineContent": "const x = tokenize(input)",
    "body": "Consider renaming `x` to `parsedToken` to better express intent."
  }'
```

**Required fields:**

| Field | Description |
|---|---|
| `filePath` | Relative path from repo root (e.g. `src/foo/bar.ts`) |
| `side` | `"additions"` for added/changed lines, `"deletions"` for removed lines |
| `lineNumber` | The line number in the diff where the comment anchors |
| `startLineNumber` | First line of a multi-line selection (omit for single-line) |
| `lineContent` | The actual code text at that line (copy from the diff) |
| `body` | Your comment text. Supports Markdown. See special formats below. |

### Special comment body formats

#### Suggestion block (auto-applicable fix)

Wrap your suggested replacement in a fenced `suggestion` block. The user
can apply it with one click in the UI:

````markdown
Here's a cleaner approach:

```suggestion
const parsedToken = tokenize(input)
```
````

#### Markdown

Full Markdown is supported: `**bold**`, `_italic_`, `` `code` ``,
code fences (` ```ts `), lists, headings, links.

---

## 4. Address existing human comments

For each comment where `status === "open"`:

### 4a. Change request → apply the change + reply + resolve

1. Read the file at `filePath`
2. Locate the relevant code using `lineContent` as context (around `lineNumber`)
3. Apply the change described in `body`
4. Post a reply explaining what you did:

```bash
curl -s -X POST "http://localhost:<port>/api/comments/<id>/replies" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Done. Renamed `x` to `parsedToken` on line 42.",
    "role": "agent",
    "model": "<your-model-name>"
  }'
```

5. Mark as resolved:

```bash
curl -s -X PUT "http://localhost:<port>/api/comments/<id>" \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}'
```

### 4b. Question → reply only, leave open

If the comment is a question or discussion rather than a change request,
reply with your answer but **do not resolve** — leave it open for the user
to follow up:

```bash
curl -s -X POST "http://localhost:<port>/api/comments/<id>/replies" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "A Map would work here too, but a plain object is used because the keys are always strings and iteration order doesn'\''t matter.",
    "role": "agent",
    "model": "<your-model-name>"
  }'
```

### 4c. Ambiguous comment → ask for clarification

If you are unsure what is being asked, reply with a clarifying question
and leave the comment open:

```bash
curl -s -X POST "http://localhost:<port>/api/comments/<id>/replies" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Could you clarify — should I rename just this variable, or also update the type alias and all call sites?",
    "role": "agent",
    "model": "<your-model-name>"
  }'
```

---

## 5. Reply payload reference

| Field | Type | Required | Description |
|---|---|---|---|
| `body` | string | ✅ | Reply text. Markdown supported. |
| `role` | `"agent"` \| `"user"` | ✅ | Always use `"agent"` for AI-generated replies |
| `model` | string | recommended | Your model name, e.g. `"claude-opus-4"`, `"gemini-2.5-flash"`, `"gpt-4o"`. Shown as a chip in the UI next to the Agent badge. |

---

## 6. Edit or delete a comment

**Edit** (update body or status):

```bash
curl -s -X PUT "http://localhost:<port>/api/comments/<id>" \
  -H "Content-Type: application/json" \
  -d '{"body": "Updated comment text."}'
```

**Delete:**

```bash
curl -s -X DELETE "http://localhost:<port>/api/comments/<id>"
```

---

## 7. Apply a suggestion block

If a comment body contains a ` ```suggestion ` block, apply it with:

```bash
curl -s -X POST "http://localhost:<port>/api/comments/<id>/apply-suggestion"
```

This writes the suggested code to the file and marks the comment resolved
automatically. Only works for `side: "additions"` comments.

---

## 8. The copy-comments XML format

When the user copies all comments from the UI ("Copy comments" button),
they receive a structured XML payload. If you receive this XML in a prompt,
parse and act on it using the embedded `<instructions>` block.

The schema looks like this:

```xml
<code-review-comments>
  <instructions>
    You are an AI coding assistant. You are receiving a structured list of
    code review comments to address in the repository.
    ...
    HOW TO REPLY OR ASK FOR CLARIFICATION:
    Option A: Via API (Preferred if the diffit server is running locally)
      POST http://localhost:<port>/api/comments/<comment-id>/replies
      Payload: { "body": "...", "role": "agent", "model": "<your-model-name>" }
    Option B: Via Text Response (Offline / Chat Copy-Paste)
      <comment-replies>
        <reply to="<comment-id>" model="<your-model-name>"><![CDATA[reply]]></reply>
      </comment-replies>
  </instructions>

  <file path="src/utils/parser.ts">
    <comment id="uuid" line="38-42" side="additions" status="open" created-at="2026-05-25T00:00:00.000Z">
      <code><![CDATA[
+       const x = tokenize(input)
      ]]></code>
      <body><![CDATA[Rename x to parsedToken]]></body>
      <replies>
        <reply id="reply-uuid" created-at="2026-05-25T00:01:00.000Z" role="user">
          <![CDATA[Good catch]]>
        </reply>
      </replies>
    </comment>
  </file>
</code-review-comments>
```

When you act on this XML and have API access, use Option A (POST replies via
curl). When you don't, use Option B (output a `<comment-replies>` block at the
end of your response for the user to paste back).

---

## 9. Tips for a high-quality review

- **Read the full diff first** before posting any comments. Understand the
  overall change intent before commenting on individual lines.
- **Be specific and actionable.** Prefer `"Extract lines 42–55 into a helper
  called parseToken()"` over `"this is too long"`.
- **Use suggestion blocks** for small, mechanical fixes so the user can
  apply them with one click.
- **Respect the diff side.** Comments on `"deletions"` refer to code that
  was removed; comments on `"additions"` refer to new or modified code.
- **Check `startLineNumber`** — it defines the start of a multi-line
  selection. Use `lineContent` (not just the last line) to understand context.
- **Don't resolve questions** — only resolve comments once the requested
  code change has been applied.
- **Always set `role: "agent"` and `model`** on replies so the UI can display
  your Agent badge and model name correctly.
