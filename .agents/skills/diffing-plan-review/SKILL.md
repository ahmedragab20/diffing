---
name: diffing-plan-review
description: >
  Submit an implementation plan to diffing for human review and act on the
  verdict. Use BEFORE writing code when you have produced a plan: submit the
  markdown plan, block until the human approves / rejects / requests changes /
  chooses comment-only, then proceed, revise-and-resubmit, or stop accordingly.
  Also covers replying to and resolving the human's inline comments on specific
  plan lines/sections. Port-agnostic: uses the diffing CLI subcommands (or MCP
  tools), so no port is ever hard-coded. Use when the user asks you to get a
  plan reviewed/approved, or when you want sign-off on an approach before
  implementing.
user_invocable: true
---

# diffing Plan Review — Detailed Reference

> See AGENTS.md for the workflow overview. This file contains the complete CLI
> reference, flags, and MCP tools.

---

## Prerequisites

The diffing server must be running for this repo. If not:

```bash
diffing --web --no-open   # headless; omit --no-open to also open browser
```

You never need the port — `diffing plan` subcommands discover the running
server via the per-repo lockfile. For raw HTTP:

```bash
DIFFING=$(diffing url)   # fails (exit 3) if no server for this repo
```

---

## 1. Submit a Plan

Write your plan to a markdown file (or pipe via stdin) and submit:

```bash
diffing plan submit PLAN.md --title "Refactor the parser" --model "<your-model-name>"
# or from stdin:
cat PLAN.md | diffing plan submit --model "<your-model-name>"
```

**Flags:**
- `--title` — defaults to first heading/line
- `--source` — optional source identifier
- `--model` — **required** for attribution in UI
- `--id <existing>` — resubmit a revised version (bumps version, keeps history)
- `--wait` — submit then block for verdict in one step

Prints plan ID on stdout, review URL on stderr.

---

## 2. Wait for Verdict (Handoff)

Block until human approves, rejects, requests changes, or chooses comment-only.
On release, verdict + inline comments printed as `<plan-review>` XML:

```bash
diffing plan await        # exit 0 + XML on decision; exit 2 (timeout) → run again
# or combine submit + wait:
diffing plan submit PLAN.md --wait --model "<model>"
```

XML fields:
- `<plan decision="approved|changes-requested|rejected|comment-only|pending">`
- `mode="standard|comment-only"` — **controls agent behavior**
- `<decision-summary>` — plain English next step
- `<decision-comment>` — reviewer's overall note (optional)
- Each `<comment>` targets `line=N`, range `line=N-M`, or `line=plan`
  - `section` — nearest heading
  - `<context>` — anchored plan text
  - `status="open|resolved"` — **only address `open`**

stderr carries: `DIFFING_PLAN_DECISION=<verdict>`, `DIFFING_PLAN_ROUND=<n>`

---

## 3. Act on Decision

| Decision | Mode | Action |
|----------|------|--------|
| `approved` | standard | Proceed with implementation |
| `changes-requested` | standard | Revise plan, address every `status="open"` comment, resubmit with `--id <plan-id>`, `await` again |
| `rejected` | standard | Stop; do not implement |
| `comment-only` | comment-only | **Do NOT edit files or implement.** Only reply to comments. The decision comment (if present) is your chat prompt. |

Resubmit revised version (keeps history on one plan):

```bash
diffing plan submit PLAN.md --id <plan-id>
diffing plan await
```

---

## 4. Reply to and Resolve Inline Comments

```bash
diffing plan reply <comment-id> --body "Good catch — I'll split Phase 2." --model "<your-model-name>"
diffing plan resolve <comment-id>     # mark addressed
```

Comment ID is enough — diffing finds which plan it belongs to. Replies/resolutions
appear in human's UI in real time.

---

## 5. Inspect Plans

```bash
diffing plan list            # id, decision, version, open-comment count, title
diffing plan list --json     # raw JSON
diffing plan show <id>       # <plan-review> XML for plan (latest if omitted)
diffing plan show <id> --json
diffing plan versions <id>   # version history
diffing plan versions <id> --json
```

---

## 6. MCP Alternative

If configured with diffing MCP server (`diffing mcp`):

```json
{ "mcpServers": { "diffing": { "command": "diffing", "args": ["mcp"] } } }
```

Tools: `submit_plan`, `await_plan_review`, `list_plans`, `get_plan`,
`reply_to_plan_comment`, `resolve_plan_comment`.

---

## 7. Tips

- **Submit before non-trivial work** — human steers approach cheaply
- **Clean markdown with ATX headings (`##`)** — each heading = commentable section, stable line anchors
- **Resubmit with `--id`** — not new plan, keeps history/version count
- **Never implement on `changes-requested` or `rejected`** — only `approved` is green light
- **`comment-only` means reply only** — the human wants discussion, not edits. The overall note is your prompt.
- **Always pass `--model` on replies** — UI attributes to your agent