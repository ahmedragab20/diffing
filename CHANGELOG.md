# Changelog

## 0.2.0

### Minor Changes

- **Plan review** — agents can now submit implementation plans (`diffing plan submit`) for human review before writing code. Plans appear in a dedicated `/plan/:id` UI with source/rendered views, inline line comments, range selection, general comments, and an approve / request-changes / reject verdict that the agent polls for.
- New `diffing plan` CLI subcommands: `submit`, `get`, `list`, `update`, `comment`, `reply`, `resolve`, `unresolve`, `decision`.
- MCP tool surface extended with `plan_submit`, `plan_get`, `plan_list`, `plan_update`, `plan_comment`, `plan_reply`, `plan_resolve`, `plan_unresolve`, `plan_decision`.
- Agent activity toast shows real-time agent replies and plan comment notifications in the browser UI.
- `diffing-plan-review` skill for Claude Code / Gemini CLI / Copilot — submit a plan, block until verdict, act on inline comments.

## 0.1.1

### Patch Changes

- Bug fixes and minor improvements since initial release.

## 0.1.0

- Initial release
