import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const PLAN_BODY = [
  "# M1: Tenancy foundation",
  "",
  "Every machine, loyalty and release flow keeps working inside a tenant. Usage is metered per tenant from day one.",
  "",
  "## Today",
  "",
  "- **Database:** one database. Its schema is created at startup by `migrateSync` and `migrateSales`.",
  "- **Machines:** authenticate with their own P-256 key, looked up by machine id.",
  "- **Operator routes:** `/ops/v1` uses one shared `FLEET_OPERATOR_TOKEN`.",
  "",
  "## Design",
  "",
  "1. **Versioned migrations**",
  "   - `src/migrations/platform/` and `src/migrations/tenant/` hold numbered, additive steps.",
  "   - Each database has a `schema_migrations` table and an advisory lock.",
  "2. **Platform database**",
  "   - `tenants`: UUIDv7 id, slug, status, database name",
  "   - `machine_directory`: machine id to tenant",
  ...Array.from({ length: 40 }, (_, i) => `   - Filler requirement number ${i + 1} that keeps the document long enough to scroll.`),
  "",
  "## Rollout",
  "",
  "```bash",
  "# not a heading",
  "pnpm migrate --tenant all",
  "```",
  "",
  "Ship behind a flag, then migrate tenants one at a time.",
  "",
].join("\n");

/** 1-based source line of the first line containing `needle`. */
export function lineOf(needle: string, body = PLAN_BODY) {
  const index = body.split("\n").findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`not in plan: ${needle}`);
  return index + 1;
}

export interface PlanJson {
  id: string;
  version: number;
  decision: string;
  decisionComment?: string;
  body: string;
  comments: {
    id: string;
    body: string;
    status: string;
    lineNumber: number;
    startLineNumber?: number;
    severity?: string;
    selectedQuote?: string;
    replies: { id: string; body: string; role?: string }[];
  }[];
}

export async function resetPlans(request: APIRequestContext) {
  const plans = (await (await request.get("/api/plans")).json()) as { id: string }[];
  for (const plan of plans) await request.delete(`/api/plans/${plan.id}`);
}

export async function seedPlan(request: APIRequestContext, title = "M1: Tenancy foundation", body = PLAN_BODY) {
  const res = await request.post("/api/plans", { data: { title, body, model: "e2e-model" } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; version: number };
}

export async function seedComment(
  request: APIRequestContext,
  planId: string,
  data: { lineNumber: number; body: string; lineContent?: string },
) {
  const res = await request.post(`/api/plans/${planId}/comments`, { data: { lineContent: "", ...data } });
  expect(res.ok()).toBeTruthy();
}

export async function getPlan(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/plans/${id}`)).json()) as PlanJson;
}

/**
 * Select text inside the rendered plan with a real mouse drag. The text may
 * span several nodes (e.g. prose plus inline `code`).
 */
export async function selectRenderedText(page: Page, text: string) {
  const box = await page.locator(".plan-rendered").evaluate((root, needle) => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    const full = nodes.map((n) => n.data).join("");
    const at = full.indexOf(needle);
    if (at < 0) throw new Error(`text not found: ${needle}`);
    // A start offset on a node boundary belongs to the next node; an end
    // offset to the previous one (never an empty whitespace node).
    const locate = (offset: number, isEnd: boolean) => {
      for (const node of nodes) {
        if (isEnd ? offset <= node.data.length : offset < node.data.length) return { node, offset };
        offset -= node.data.length;
      }
      throw new Error("offset out of range");
    };
    const start = locate(at, false);
    const end = locate(at + needle.length, true);
    start.node.parentElement!.scrollIntoView({ block: "center", behavior: "instant" });
    const first = document.createRange();
    first.setStart(start.node, start.offset);
    first.setEnd(start.node, Math.min(start.offset + 1, start.node.data.length));
    const last = document.createRange();
    last.setStart(end.node, Math.max(0, end.offset - 1));
    last.setEnd(end.node, end.offset);
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
  }, text);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 8 });
  await page.mouse.up();
}

export async function openPlan(page: Page, id: string, mode: "source" | "rendered" | "split" = "rendered") {
  await page.goto(`/plan/${id}`);
  const label = mode === "source" ? /^Source/ : mode === "rendered" ? /^Read/ : /^Split/;
  const toggle = page.getByRole("group", { name: "Plan view mode" }).getByRole("button", { name: label });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

/** Select rendered text and open a floating composer from the chip. */
export async function openFloatComposer(page: Page, text: string) {
  const before = await page.locator(".plan-selection-comment-floating").count();
  await selectRenderedText(page, text);
  await page.locator(".plan-selection-popup").click();
  const panel = page.locator(".plan-selection-comment-floating").nth(before);
  await expect(panel).toBeVisible();
  return panel;
}

/** Click a source line number to open the inline source composer. */
export async function openSourceComposer(page: Page, line: number) {
  await page.locator(`.plan-file [data-column-number="${line}"]`).click();
  const form = page.locator(".plan-file").getByRole("textbox", { name: "Comment body" });
  await expect(form).toBeVisible();
  return form;
}

/** Layout facts for a floating composer: nothing inside should be scrolled or clipped. */
export async function composerLayout(panel: Locator) {
  return panel.evaluate((el) => {
    const body = el.querySelector(".plan-selection-comment-body") as HTMLElement;
    const textarea = el.querySelector("textarea") as HTMLElement;
    const header = el.querySelector(".plan-selection-comment-drag") as HTMLElement;
    const panelRect = el.getBoundingClientRect();
    const taRect = textarea.getBoundingClientRect();
    const bar = document.querySelector(".vim-status-bar")?.getBoundingClientRect();
    return {
      rootScrollTop: el.scrollTop,
      rootScrollLeft: el.scrollLeft,
      bodyScrollTop: body.scrollTop,
      headerTop: Math.round(header.getBoundingClientRect().top - panelRect.top - el.clientTop),
      textareaInside: taRect.top >= panelRect.top && taRect.bottom <= panelRect.bottom + 0.5,
      inViewport: panelRect.top >= 0 && panelRect.bottom <= window.innerHeight,
      coversStatusBar:
        !!bar &&
        bar.height > 0 &&
        panelRect.left < bar.right &&
        panelRect.right > bar.left &&
        panelRect.bottom > bar.top &&
        panelRect.top < bar.bottom,
    };
  });
}
