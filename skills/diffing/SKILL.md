---
name: diffing
description: Use diffing for a native human-AI review loop over local code changes or implementation plans. Routes requests to start a review UI, review changes, submit a plan for approval, wait for human feedback, and address inline comments across MCP, CLI, or pasted XML.
---

# diffing workflow router

diffing is a local-first review bridge: an agent exposes a diff or plan, a human reviews it in a browser UI, and both sides exchange structured comments and verdicts in real time.

## Detect capabilities first

Use the strongest available integration without asking the user to choose plumbing:

1. Native diffing MCP tools: call `review_session_status` first and `start_review_session` when needed.
2. Shell CLI: run `diffing` commands from the target repository; commands discover the active port automatically.
3. Offline handoff: act on pasted `<code-review-comments>` or `<plan-review>` XML and return structured replies when live tools are unavailable.

Never guess the repository or hard-code a port. For global MCP clients, bind the server explicitly with `diffing mcp --repo <absolute-path>`.

## Route by intent

- Open the UI or send changes to the human: follow `diffing-start-review`.
- Review the user's local changes and create findings: follow `diffing-review`.
- Wait for human code-review feedback and address it: follow `diffing-finish-review`.
- Get a plan approved before implementation: follow `diffing-plan-review`.

If the harness does not expose named skills, apply those workflows directly from this routing summary and the MCP tool descriptions.

## Behavioral contract

- Timeouts from await tools are expected; retry while waiting is still requested.
- Only act on open comments.
- Apply and resolve clear change requests; reply without resolving questions or ambiguous requests.
- `comment-only` forbids file edits.
- A plan may be implemented only after `approved`; revise the same plan ID on `changes-requested`, and stop on `rejected`.
- Send replies/resolutions as work completes so the human UI stays live, then await another round only when the user wants the loop to continue.
