/**
 * Shared agent↔human handoff contract for code review and plan review.
 *
 * Two modes:
 * - **Sync**: short blocking `await_*` while the human is at the keyboard.
 * - **Async (default after submit)**: share the URL, end the turn, resume
 *   when the human says the review/verdict is ready.
 *
 * Timeout is a budget signal, not a failure. Agents must not silent-loop.
 */

/** Default await budget (seconds). Stays under typical ~10 min tool ceilings. */
export const DEFAULT_AWAIT_TIMEOUT_SECONDS = 570

export const PLAN_SUBMIT_NEXT_ACTION =
  'Share the plan review URL with the human and end your turn (async handoff). ' +
  'Call await_plan_review only when the human is reviewing now or explicitly asked you to wait.'

export const AWAIT_REVIEW_TIMEOUT_NEXT_ACTION =
  'Wait budget elapsed — expected, not a failure. Park: tell the human the review UI is waiting and end your turn. ' +
  'Call await_review again only if they asked you to keep waiting (at most once more unless they repeat that ask). ' +
  'Do not retry in a silent loop. When they say the review is ready, call await_review once ' +
  '(or list_comments with openOnly) to resume; a prior Send-to-agent handoff is replayed.'

export const AWAIT_PLAN_TIMEOUT_NEXT_ACTION =
  'Wait budget elapsed — expected, not a failure. Park: tell the human the plan URL is waiting for Submit review and end your turn. ' +
  'Call await_plan_review again only if they asked you to keep waiting (at most once more unless they repeat that ask). ' +
  'Do not retry in a silent loop. When they say a verdict is ready, call await_plan_review once ' +
  '(or get_plan / list_plans) to resume; a prior verdict is replayed.'

export const CLI_AWAIT_REVIEW_TIMEOUT_HINT =
  'Wait budget elapsed (expected). Prefer parking until the human is ready; ' +
  're-run `diffing await-review` only if they asked you to keep waiting.'

export const CLI_AWAIT_PLAN_TIMEOUT_HINT =
  'Wait budget elapsed (expected). Prefer parking until the human is ready; ' +
  're-run `diffing plan await` only if they asked you to keep waiting.'

export const CLI_PLAN_SUBMIT_PARK_HINT =
  'Async handoff: share the URL above. Use --wait / `diffing plan await` only when the human is reviewing now or asked you to block.'

/** Compact MCP / skill preamble for wait tools. */
export const AWAIT_TOOL_DESCRIPTION_SUFFIX =
  'Timeout means the wait budget elapsed (expected). Park and end the turn unless the human asked you to keep waiting; ' +
  'never silent-loop. Progress notifications are sent between long polls.'
