---
title: Plan review
description: Submit markdown plans for human approval before implementation.
summary: Agents submit plans, humans verdict approved/changes-requested/rejected, then agents obey the decision.
order: 2
section: guides
---

Plan review gates **implementation** on human sign-off. Use it for non-trivial design, risky changes, or any request to comment on a plan before code.

## Flow

```text
1. Write plan markdown (prefer ~/.diffing/<repo>/plan-sources/ — not the working tree)
2. submit → share plan URL → park (async default)
3. Human reviews at /plan, comments, Submit review
4. Agent reads verdict and acts
```

### CLI

```bash
diffing plan submit PLAN.md --model "your-model" [--title T] [--save-source]
# prints URL; do not --wait unless sync

diffing plan await [--timeout 570]     # sync / resume
diffing plan list
diffing plan show [<id>] [--version n]
diffing plan versions <id>
diffing plan reply <comment-id> --body "…" --model "your-model"
diffing plan resolve <comment-id>
```

Resubmit revisions with the **same** `--id` so history stays one conversation.

### MCP

`submit_plan`, `await_plan_review`, `list_plans`, `get_plan`, `get_plan_versions`, `get_plan_version`, `reply_to_plan_comment`, `resolve_plan_comment`.

## Verdicts

| Decision | Agent action |
|----------|--------------|
| `approved` | Implement the reviewed version; account for open comments |
| `changes-requested` | **Do not implement.** Revise plan, resolve addressed threads, resubmit same planId |
| `rejected` | **Stop.** Do not implement |
| `comment-only` | Reply only; do not edit product files |
| `pending` | Park (async) or one sync await if asked |

## Severity on plan comments

Same triage as code review: `blocking` | `nit` | `question` | `praise`. Treat blocking as must-fix before resubmit.

## Plan UI (human)

| Feature | Behavior |
|---------|----------|
| Source / Read / Split | <kbd>m</kbd> |
| Zen Read | <kbd>z</kbd> |
| Live edit | <kbd>e</kbd> — autosave PUT; Save as new version POST |
| Outline / comments map | <kbd>o</kbd> / <kbd>c</kbd> |
| Inline comments | Source gutter or Read highlight; multi-line + severity |
| Submit review | Verdict that unblocks `plan await` |

## Keep the tree clean

Never write plans, notes, or `.diffing/` directories into the consumer project. Use `~/.diffing/<repo>/plan-sources/` or stdin:

```bash
cat PLAN.md | diffing plan submit --model "your-model"
```
