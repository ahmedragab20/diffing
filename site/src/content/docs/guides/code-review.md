---
title: Code review
description: Human and agent workflow for reviewing local git changes in the web UI.
summary: Open a review, leave inline comments with severity, send to agent, and resolve threads as work lands.
order: 1
section: guides
---

## Human path

```bash
cd your-repo
diffing                 # or: diffing --staged, main..feature, …
```

In the UI:

1. Navigate files (sidebar filters: All / Unviewed / Comments / Since last)
2. Toggle split/unified with <kbd>m</kbd>
3. Select lines → add comment (optional severity: blocking · nit · question · praise)
4. Optional multi-line ranges and ```` ```suggestion ```` blocks
5. Click **Send review** / **Send to agent** with a verdict and optional note

Live updates: agent replies and resolves appear over SSE without refresh.

## Agent path

Prefer MCP when available. Portable CLI:

```bash
diffing url                          # share with human
# async: end turn until human says ready

diffing await-review                 # only when human is reviewing now
diffing comments --open              # snapshot open threads as XML
diffing reply <id> --body "…" --model "your-model"
diffing resolve <id>
diffing progress --message "Working…" --pct 40
```

### Per-comment policy

| Kind | Action |
|------|--------|
| Change request / blocking | Edit code → reply → resolve |
| Nit | Optional; fix or acknowledge |
| Question | Reply; leave open unless answered fully |
| Praise | No code change |
| Ambiguous | Reply asking for clarification; leave open |

## Suggestions

Comments may include:

````markdown
```suggestion
const fixed = true;
```
````

Human or agent can apply via UI / MCP `apply_suggestion` / API — applies the fence to the working tree and can auto-resolve.

## Multi-round

Each **Send to agent** increments a review round. History is available via UI and `get_review_history` / `GET /api/review/history`. Outdated comments are detected when lines move.

## Related

- [Agent handoff](/docs/guides/agent-handoff/)
- [Comments XML](/docs/reference/comments-xml/)
- [Keyboard](/docs/reference/keyboard/)
