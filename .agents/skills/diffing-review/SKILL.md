---
name: diffing-review
description: >
  Perform a GitHub-style code review of local git changes using diffing.
  Fetches the diff and inline comments from the running diffing server,
  analyses every changed file, posts inline review comments, replies to
  existing human comments, applies requested code changes, and marks comments
  resolved — all without touching the browser. Port-agnostic: uses the diffing
  CLI subcommands and `diffing url` for discovery, so no port is ever hard-coded.
  Use when the user asks you to review their local changes, address review
  comments, or work through a diffing review session.
user_invocable: true
---

# diffing Code Review — Detailed Reference

> See AGENTS.md for the workflow overview. This file contains the complete CLI
> reference, HTTP API, suggestion blocks, and MCP tools.

---

## Prerequisites & Discovery

The diffing server must already be running. If not, start it:

```bash
diffing                        # all working-tree changes (staged + unstaged + untracked)
diffing -- --staged            # staged only
diffing -- HEAD~3              # last 3 commits
diffing -- main..HEAD          # branch vs main
```

You never need the port. Subcommands discover the running server automatically.
For raw HTTP calls, capture the base URL once:

```bash
DIFFING=$(diffing url)          # e.g. http://127.0.0.1:5173 — fails (exit 3) if no server
```

> Every `curl` below uses `$DIFFING`. If `diffing url` errors, start server first.

---

## 1. Fetch the Diff

```bash
curl -s "$DIFFING/api/diff" | jq '{branch, repoName, binaryFiles: .binaryFiles}'
```

Key fields in response:
- `patch` — full unified diff
- `repoName`, `branch`
- `binaryFiles` — `{path, type}` for binary assets
- `tabSizeMap` — `{filePath: tabSize}` for correct rendering

---

## 2. Fetch Existing Comments

Use the subcommand (prints `<code-review-comments>` XML or JSON with `--json`):

```bash
diffing comments              # all comments as XML
diffing comments --open       # only open comments
diffing comments --json       # raw JSON array
```

Each comment has:
- `id`, `filePath`, `side` (`additions`/`deletions`)
- `lineNumber`/`startLineNumber`, `lineContent`
- `body` (markdown), `status` (`open`/`resolved`)
- `replies` array

**Only act on `status === "open"` comments.**

---

## 3. Post Inline Review Comments

After reading the diff, post comments on lines needing attention. No subcommand —
use the API:

```bash
curl -s -X POST "$DIFFING/api/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "src/utils/parser.ts",
    "side": "additions",
    "lineNumber": 42,
    "startLineNumber": 38,
    "lineContent": "const x = tokenize(input)",
    "body": "Consider renaming \`x\` to \`parsedToken\` to better express intent."
  }'
```

Required: `filePath` (repo-relative), `side`, `lineNumber`, `lineContent` (from diff).
Optional: `startLineNumber` (multi-line range).
`body` supports Markdown.

### Special Comment Body Formats

**Suggestion block** (one-click applicable fix):

````markdown
```suggestion
const parsedToken = tokenize(input)
```
````

**Markdown**: `**bold**`, `_italic_`, `` `code` ``, fences, lists, links.

---

## 4. Address Existing Human Comments

For each comment where `status === "open"`:

### 4a. Change Request → Apply + Reply + Resolve

1. Read file at `filePath`
2. Locate code using `lineContent` as context (around `lineNumber`)
3. Apply the change described in `body`
4. Reply, then resolve:

```bash
diffing reply <comment-id> --body "Done. Renamed \`x\` to \`parsedToken\` on line 42." --model "<your-model-name>"
diffing resolve <comment-id>
```

### 4b. Question → Reply Only, Leave Open

```bash
diffing reply <comment-id> --body "A Map would work too, but a plain object is used because keys are always strings." --model "<your-model-name>"
```

### 4c. Ambiguous → Ask for Clarification, Leave Open

```bash
diffing reply <comment-id> --body "Should I rename just this variable, or also the type alias and all call sites?" --model "<your-model-name>"
```

`diffing reply` always attributes to `role: agent`; pass `--model` for UI model chip.
Pipe long body via stdin with `--body -`. Each reply/resolve appears in UI in real time.

---

## 5. Edit, Delete, Apply Suggestion (HTTP API)

No subcommand — use `$DIFFING`:

```bash
# Edit a comment body
curl -s -X PUT "$DIFFING/api/comments/<id>" -H "Content-Type: application/json" -d '{"body": "Updated text."}'

# Delete a comment
curl -s -X DELETE "$DIFFING/api/comments/<id>"

# Apply a ```suggestion block (writes file, resolves comment). additions only.
curl -s -X POST "$DIFFING/api/comments/<id>/apply-suggestion"
```

---

## 6. Waiting for Human (Handoff)

Block on handoff instead of polling. `diffing await-review` sleeps until human
clicks **"Send to agent"**, then prints open comments as XML:

```bash
diffing await-review          # exit 0 + XML on send; exit 2 (timeout) → run again
```

Supports multiple rounds — loop back to `await-review` after a round to pick up
the next batch.

---

## 7. MCP Alternative

If configured with diffing MCP server (`diffing mcp`):

```json
{ "mcpServers": { "diffing": { "command": "diffing", "args": ["mcp"] } } }
```

Tools: `await_review`, `list_comments`, `reply_to_comment`, `resolve_comment`.

---

## 8. Offline Fallback — Copy Comments XML

When human copies comments from UI ("Copy comments" button), they get structured
XML you can act on if pasted into chat. The embedded `<instructions>` describes
three paths: **(A)** `diffing` CLI / MCP (preferred), **(B)** local HTTP API,
**(C)** offline `<comment-replies>` block emitted at end of response:

```xml
<comment-replies>
  <reply to="<comment-id>" model="<your-model-name>"><![CDATA[Your reply]]></reply>
</comment-replies>
```

Prefer (A) whenever you can run `diffing`.

---

## 9. Tips for High-Quality Review

- **Read full diff first** before posting any comments
- **Be specific and actionable** — `"Extract lines 42–55 into parseToken()"` beats `"too long"`
- **Use suggestion blocks** for small mechanical fixes
- **Respect the diff side** — `deletions` = removed code, `additions` = new/modified
- **Check `startLineNumber`** and use full `lineContent` for multi-line context
- **Don't resolve questions** — only resolve once requested change is applied
- **Always pass `--model`** on replies so UI shows your Agent badge and model