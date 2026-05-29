---
name: diffing-plan-review
description: >
  Submit an implementation plan to diffing for human review and act on the
  verdict. Use BEFORE writing code when you have produced a plan: submit the
  markdown plan, block until the human approves / rejects / requests changes,
  then proceed, revise-and-resubmit, or stop accordingly. Also covers replying
  to and resolving the human's inline comments on specific plan lines/sections.
  Port-agnostic: uses the diffing CLI subcommands (or MCP tools), so no port is
  ever hard-coded. Use when the user asks you to get a plan reviewed/approved, or
  when you want sign-off on an approach before implementing.
user_invocable: true
---

# diffing Plan Review — Agent Workflow

diffing can review **any markdown plan** an agent produces the same way it
reviews a diff: the human reads it in a GitHub-like UI, comments on specific
lines or sections, and approves / requests changes / rejects. The agent blocks
on a handoff and receives the structured verdict, then proceeds or revises.

This is the plan-side twin of `diffing-review`. The loop is:

1. **Submit** your plan (markdown) → it opens for review in the diffing UI.
2. **Await** the human's verdict (blocking handoff).
3. **Act**: proceed if approved, revise-and-resubmit if changes requested, stop
   if rejected — replying to and resolving inline comments along the way.

---

## 0. Prerequisites & discovery

The diffing server must be running for this repo. If not, start it (web mode):

```bash
diffing                 # interactive terminal → launches the review server + UI
diffing --web --no-open # force web mode without opening a browser (e.g. headless)
```

You never need the port. The `diffing plan` subcommands discover the running
server via the per-repo lockfile. For raw HTTP, capture the base URL once:

```bash
DIFFING=$(diffing url)   # fails (exit 3) if no server is running for this repo
```

---

## 1. Submit a plan

Write your plan to a markdown file (or pipe it via stdin) and submit it:

```bash
diffing plan submit PLAN.md --title "Refactor the parser" --model "<your-model-name>"
# or from stdin:
cat PLAN.md | diffing plan submit --model "<your-model-name>"
```

`plan submit` prints the new plan id on stdout and the review URL on stderr.
Flags: `--title` (defaults to the first heading/line), `--source`, `--model`,
`--id <existing>` (resubmit a revised version), `--wait` (submit then block for
the verdict in one step).

---

## 2. Wait for the verdict (handoff)

Block until the human approves, rejects, or requests changes. On release, the
verdict + inline comments are printed as `<plan-review>` XML:

```bash
diffing plan await        # exit 0 + XML on decision; exit 2 (timeout) → run again
# or combine submit + wait:
diffing plan submit PLAN.md --wait
```

The XML's `<plan>` element has a `decision` attribute and a `<decision-summary>`
telling you what to do. stderr also carries `DIFFING_PLAN_DECISION=<verdict>`.

---

## 3. Act on the decision

- **approved** → proceed with implementation as planned.
- **changes-requested** → revise the plan to address every open comment, then
  resubmit the *same* plan id for another review round:
  ```bash
  diffing plan submit PLAN.md --id <plan-id>   # bumps the version, re-opens review
  diffing plan await                            # wait for the new verdict
  ```
- **rejected** → stop and rethink the approach; do not implement.

Each `<comment>` targets `line=N`, a range `line=N-M`, or the whole plan
`line=plan`, with a `section` attribute naming the nearest heading and a
`<context>` block quoting the anchored plan text. **Only address `status="open"`
comments.**

---

## 4. Reply to and resolve inline comments

Answer questions or confirm changes on individual plan comments. The comment id
is enough — diffing finds which plan it belongs to:

```bash
diffing plan reply <comment-id> --body "Good catch — I'll split Phase 2 in two." --model "<your-model-name>"
diffing plan resolve <comment-id>     # mark a comment addressed
```

Replies and resolutions appear in the human's UI in real time.

---

## 5. Inspect plans

```bash
diffing plan list            # id, decision, version, open-comment count, title
diffing plan list --json     # raw JSON
diffing plan show <id>       # the <plan-review> XML for one plan (latest if omitted)
diffing plan show <id> --json
```

---

## 6. MCP alternative

If you're configured with the diffing MCP server (`diffing mcp`) instead of a
shell, the equivalent tools are `submit_plan`, `await_plan_review`,
`list_plans`, `get_plan`, `reply_to_plan_comment`, and `resolve_plan_comment`.

```json
{ "mcpServers": { "diffing": { "command": "diffing", "args": ["mcp"] } } }
```

---

## 7. Tips

- **Submit a plan before non-trivial work** so the human can steer the approach
  cheaply, before any code is written.
- **Keep plans in clean markdown** with headings — each heading becomes a
  commentable "section", and line numbers stay stable for anchoring.
- **Resubmit with `--id`** rather than creating a new plan, so the review history
  and version count stay on one plan.
- **Don't start implementing on `changes-requested` or `rejected`** — revise or
  stop. Only `approved` is a green light.
- **Always pass `--model`** on replies so the UI attributes them to your agent.
