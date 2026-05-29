---
name: diffit-review
description: >
  Perform a GitHub-style code review of local git changes using diffit.
  Fetches the diff and inline comments from the running diffit server,
  analyses every changed file, posts inline review comments, replies to
  existing human comments, applies requested code changes, and marks comments
  resolved — all without touching the browser. Port-agnostic: uses the diffit
  CLI subcommands and `diffit url` for discovery, so no port is ever hard-coded.
  Use when the user asks you to review their local changes, address review
  comments, or work through a diffit review session.
user_invocable: true
---

# diffit Review — Full Agent Workflow

diffit exposes a local HTTP server that mirrors a GitHub PR review experience
for uncommitted git changes. This skill covers the complete lifecycle:

1. **Discover** the running server (port-agnostic) and fetch the diff + comments
2. **Review** every changed file and post inline comments
3. **Address** open human comments (apply changes / answer questions)
4. **Reply** and **resolve** so the human sees progress live in the UI

The common loop — read comments, reply, resolve, wait for handoff — has
dedicated `diffit` subcommands. The richer operations (fetch the diff, post a
new inline comment, apply a suggestion) use the HTTP API against the
auto-discovered base URL.

---

## 0. Prerequisites & discovery

The diffit server must already be running. If not, start it in the background:

```bash
diffit                        # all working-tree changes (staged + unstaged + untracked)
diffit -- --staged            # staged only
diffit -- HEAD~3              # last 3 commits
diffit -- main..HEAD          # branch vs main
```

You never need to know the port. The subcommands (`diffit comments`,
`diffit reply`, `diffit resolve`, `diffit await-review`) discover the running
server automatically. For raw HTTP calls, capture the base URL once:

```bash
DIFFIT=$(diffit url)          # e.g. http://127.0.0.1:5173 — fails (exit 3) if no server
```

> Every raw `curl` below uses `$DIFFIT`. If `diffit url` errors, the server
> isn't running for this repo — start it first.

---

## 1. Fetch the diff

```bash
curl -s "$DIFFIT/api/diff" | jq '{branch, repoName, binaryFiles: .binaryFiles}'
```

The full unified diff is in the `patch` field. Parse it to understand every
changed file and line. Key fields: `patch` (unified diff), `repoName`,
`branch`, `binaryFiles` (`{path, type}`), `tabSizeMap` (`{filePath: tabSize}`).

---

## 2. Fetch existing comments

Use the subcommand — it prints the same `<code-review-comments>` XML the human
would copy, or raw JSON with `--json`:

```bash
diffit comments              # all comments as XML
diffit comments --open       # only open comments
diffit comments --json       # raw JSON array
```

Each comment carries `id`, `filePath`, `side` (`additions`/`deletions`),
`lineNumber`/`startLineNumber`, `lineContent`, `body`, `status`
(`open`/`resolved`), and a `replies` array. **Only act on `open` comments.**

---

## 3. Post your own inline review comments

After reading the diff, post comments on lines that need attention (equivalent
to GitHub's "Add a comment" on a diff line). There's no subcommand for creating
comments, so use the API:

```bash
curl -s -X POST "$DIFFIT/api/comments" \
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

Required: `filePath` (relative to repo root), `side`, `lineNumber`,
`lineContent` (copy from the diff). Optional: `startLineNumber` (multi-line).
`body` supports Markdown.

### Special comment body formats

**Suggestion block** (one-click applicable fix):

````markdown
```suggestion
const parsedToken = tokenize(input)
```
````

**Markdown**: `**bold**`, `_italic_`, `` `code` ``, fences, lists, links.

---

## 4. Address existing human comments

For each comment where `status === "open"`:

### 4a. Change request → apply + reply + resolve

1. Read the file at `filePath`
2. Locate the code using `lineContent` as context (around `lineNumber`)
3. Apply the change described in `body`
4. Reply, then resolve:

```bash
diffit reply <comment-id> --body "Done. Renamed \`x\` to \`parsedToken\` on line 42." --model "<your-model-name>"
diffit resolve <comment-id>
```

### 4b. Question → reply only, leave open

```bash
diffit reply <comment-id> --body "A Map would work too, but a plain object is used because the keys are always strings." --model "<your-model-name>"
```

### 4c. Ambiguous → ask for clarification, leave open

```bash
diffit reply <comment-id> --body "Should I rename just this variable, or also the type alias and all call sites?" --model "<your-model-name>"
```

`diffit reply` always attributes the reply to `role: agent`; pass `--model` so
the UI shows your model chip. You can also pipe a long body via stdin with
`--body -`. Each reply/resolve appears in the UI in real time (the human sees a
toast).

---

## 5. Edit, delete, apply-suggestion (HTTP API)

These have no subcommand — use `$DIFFIT`:

```bash
# Edit a comment body
curl -s -X PUT "$DIFFIT/api/comments/<id>" -H "Content-Type: application/json" -d '{"body": "Updated text."}'

# Delete a comment
curl -s -X DELETE "$DIFFIT/api/comments/<id>"

# Apply a ```suggestion block (writes the file, resolves the comment). additions only.
curl -s -X POST "$DIFFIT/api/comments/<id>/apply-suggestion"
```

---

## 6. Waiting for the human (handoff)

If you want to act exactly when the human finishes reviewing, block on the
handoff instead of polling. `diffit await-review` sleeps until the human clicks
**"Send to agent"**, then prints the open comments as XML:

```bash
diffit await-review          # exit 0 + XML on send; exit 2 (DIFFIT_AWAIT_TIMEOUT) → run again
```

Supports multiple rounds — loop back to `await-review` after a round to pick up
the human's next batch.

---

## 7. MCP alternative

If you're configured with the diffit MCP server (`diffit mcp`) rather than a
shell, the equivalent tools are `await_review`, `list_comments`,
`reply_to_comment`, and `resolve_comment`. Client config:

```json
{ "mcpServers": { "diffit": { "command": "diffit", "args": ["mcp"] } } }
```

---

## 8. Offline fallback — the copy-comments XML format

When the human copies all comments from the UI ("Copy comments" button), they
get a structured XML payload you can act on if pasted into a chat. The embedded
`<instructions>` block describes three reply paths: **(A)** the `diffit` CLI /
MCP (preferred, port-agnostic), **(B)** the local HTTP API, and **(C)** an
offline `<comment-replies>` block you emit at the end of your response when you
have no machine access:

```xml
<comment-replies>
  <reply to="<comment-id>" model="<your-model-name>"><![CDATA[Your reply]]></reply>
</comment-replies>
```

Prefer (A) whenever you can run `diffit`.

---

## 9. Tips for a high-quality review

- **Read the full diff first** before posting any comments.
- **Be specific and actionable** — `"Extract lines 42–55 into parseToken()"` beats `"too long"`.
- **Use suggestion blocks** for small mechanical fixes.
- **Respect the diff side** — `deletions` = removed code, `additions` = new/modified.
- **Check `startLineNumber`** and use the full `lineContent` for multi-line context.
- **Don't resolve questions** — only resolve once the requested change is applied.
- **Always pass `--model`** on replies so the UI shows your Agent badge and model.
