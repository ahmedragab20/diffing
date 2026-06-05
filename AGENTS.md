# Agent Guidance

## Keep the project clean

Never add scratch files (plans, notes, drafts, temp scripts, etc.) to the project root or any tracked directory. All agent working files — **including implementation plans** — must live under `.diffing/`, which is untracked tooling state. If a file is not part of the shipped product, it does not belong in the user's source tree.

## Plan Review

Before starting any non-trivial implementation, submit your plan for human review using the `diffing plan` subcommands. The human reviews it in a live UI, comments on specific lines or sections, and approves / requests changes / rejects. You block on a handoff and receive a structured verdict, then proceed or revise.

**Plans must be written to `.diffing/plans/`** (e.g. `.diffing/plans/PLAN.md`). Never create plan files at the project root or anywhere outside `.diffing/`.

### Start the server (if not already running)

```bash
diffing --web --no-open   # headless; omit --no-open to also open the browser
```

You never need the port — `diffing plan` subcommands discover the running server automatically via a per-repo lockfile.

### Submit a plan

Write your plan as a markdown file **inside `.diffing/plans/`** and submit it:

```bash
diffing plan submit .diffing/plans/PLAN.md --title "Short description" --model "<your-model-name>"
# or from stdin:
cat .diffing/plans/PLAN.md | diffing plan submit --model "<your-model-name>"
```

The plan id is printed on stdout; the review URL on stderr.

### Wait for the verdict

```bash
diffing plan await        # exit 0 + <plan-review> XML when decided; exit 2 (timeout) → run again
# or submit and wait in one step:
diffing plan submit .diffing/plans/PLAN.md --wait --model "<your-model-name>"
```

The XML's `<plan decision="…">` attribute holds the verdict. `<decision-summary>` explains what to do next in plain English.

### Act on the decision

| Decision | What to do |
|---|---|
| `approved` | Proceed with implementation. |
| `changes-requested` | Revise the plan to address every `status="open"` comment, then resubmit with `--id <plan-id>` and await again. |
| `rejected` | Stop. Do not implement. Rethink the approach. |

To resubmit a revised version (keeps history and version count on one plan):

```bash
diffing plan submit .diffing/plans/PLAN.md --id <plan-id>
diffing plan await
```

### Reply to and resolve inline comments

```bash
diffing plan reply <comment-id> --body "Addressed — splitting Phase 2." --model "<your-model-name>"
diffing plan resolve <comment-id>
```

The comment id is enough — diffing finds which plan it belongs to.

### MCP alternative

If you have the diffing MCP server configured instead of shell access, use the equivalent tools: `submit_plan`, `await_plan_review`, `reply_to_plan_comment`, `resolve_plan_comment`.

```json
{ "mcpServers": { "diffing": { "command": "diffing", "args": ["mcp"] } } }
```

### Tips

- Keep plans in clean markdown with ATX headings (`##`) — each heading becomes a commentable section and stabilises line anchors.
- Only address `status="open"` comments; resolved ones are already handled.
- Always pass `--model` on replies so the UI attributes them to your agent.
- Never start implementing on `changes-requested` or `rejected` — only `approved` is a green light.
