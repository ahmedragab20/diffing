---
'diffing': minor
---

Browse plan versions. Every body the agent ever submitted is now kept on disk, so reviewers can switch between past versions of the same plan in the UI, the CLI, and the MCP server.

- **Storage**: `Plan.versions: PlanVersion[]` is appended on every `diffing plan submit --id <id>` and seeded with one entry on first submit. `PlanComment.createdAtPlanVersion` is stamped at write time so comments stay anchored to the version they were written on. Legacy `plans.json` files are backfilled transparently.
- **Server**: two new endpoints — `GET /api/plans/:id/versions` (list, oldest-first) and `GET /api/plans/:id/versions/:n` (single historical snapshot with `{ version, plan: { id, title, decision, currentVersion } }`).
- **CLI**: `diffing plan versions <id>` lists every version (current marked with `*`); `diffing plan show <id> --version N` reads any past version as `<plan-review>` XML, with the plan's `<plan>` element tagged `viewing-version` and comments filtered to those anchored to that version.
- **MCP**: `get_plan_versions` lists versions; `get_plan_version` reads one. The `await_plan_review` handoff XML is version-aware: when an agent is reading a historical version it only receives the comments anchored to that version.
- **UI**: a `<History>`-iconed version dropdown sits in the plan meta row next to the `v{n}` chip. Picking an older version swaps the body, swaps the title, surfaces a "Viewing v{N} of v{M}" amber banner, and filters the comment list to those anchored to the viewed version. A "Back to current" button restores the latest body. When the server pushes a new version via SSE, the viewer auto-follows only if the user was on the previous current — never auto-bumps someone who's reading history.
- **Tests**: 10 new `InMemoryPlanStore` version-history tests (`src/__tests__/plans-versions.test.ts`), 6 new endpoint tests (`src/__tests__/plan-endpoints.test.ts`), 2 new `formatPlanReview` version-rendering tests (`src/__tests__/plan-format.test.ts`), 2 new hook tests (`src/ui/hooks/__tests__/usePlans.test.tsx`), 3 new component tests (`src/ui/__tests__/PlanReview.test.tsx`).
