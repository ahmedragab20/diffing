import { expect, test, type Page } from "@playwright/test";
import { getPlan, openFloatComposer, openPlan, resetPlans, seedPlan } from "./fixtures";

test.beforeEach(async ({ request }) => {
  await resetPlans(request);
});

function submitDialog(page: Page) {
  return page.getByRole("dialog", { name: "Submit review" });
}

async function openSubmit(page: Page) {
  await page.locator(".send-review-btn").click();
  await expect(submitDialog(page)).toBeVisible();
  return submitDialog(page);
}

const VERDICTS = [
  { label: "Approve", decision: "approved" },
  { label: "Request changes", decision: "changes-requested" },
  { label: "Reject", decision: "rejected" },
  { label: "Comment only", decision: "comment-only" },
] as const;

test("the submit panel stays open while picking verdicts and opens focused on them", async ({ page, request }) => {
  const plan = await seedPlan(request);
  await openPlan(page, plan.id, "rendered");
  const dialog = await openSubmit(page);
  await expect(dialog.getByRole("radio", { name: /Approve/ })).toBeFocused();

  for (const { label } of VERDICTS) {
    await dialog.getByRole("radio", { name: new RegExp(label) }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: new RegExp(label) })).toHaveAttribute("aria-checked", "true");
  }
  await dialog.getByRole("textbox").fill("overall");
  await dialog.getByRole("radio", { name: /Approve/ }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveValue("overall");
});

test("Escape closes the submit panel but keeps an open composer", async ({ page, request }) => {
  const plan = await seedPlan(request);
  await openPlan(page, plan.id, "rendered");
  const panel = await openFloatComposer(page, "Usage is metered");
  await panel.getByRole("textbox", { name: "Comment body" }).fill("draft");
  const dialog = await openSubmit(page);
  await dialog.getByRole("radio", { name: /Reject/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole("textbox", { name: "Comment body" })).toHaveValue("draft");
});

for (const { label, decision } of VERDICTS) {
  test(`${label} with an overall comment is saved and reaches a waiting agent`, async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    const { round } = (await (await request.get("/api/plan-review/status")).json()) as { round: number };
    const agent = request.get(`/api/plan-review/await?sinceRound=${round}&timeoutMs=30000`, { timeout: 40_000 });
    await expect(page.locator(".send-review-btn .agent-waiting-dot")).toBeVisible();

    const dialog = await openSubmit(page);
    await dialog.getByRole("radio", { name: new RegExp(label) }).click();
    await dialog.getByRole("textbox").fill(`Overall: ${label}`);
    await dialog.getByRole("button", { name: "Submit review" }).click();
    await expect(dialog).toBeHidden();

    const released = (await (await agent).json()) as {
      status: string;
      payload: { decision: string; decisionComment?: string; mode: string };
    };
    expect(released.status).toBe("released");
    expect(released.payload).toMatchObject({
      decision,
      decisionComment: `Overall: ${label}`,
      mode: decision === "comment-only" ? "comment-only" : "standard",
    });
    expect(await getPlan(request, plan.id)).toMatchObject({ decision, decisionComment: `Overall: ${label}` });
    await expect(page.locator(".plan-decision-banner")).toContainText(`Overall: ${label}`);
  });
}

test("an already-decided plan can be re-decided", async ({ page, request }) => {
  const plan = await seedPlan(request);
  await openPlan(page, plan.id, "rendered");
  let dialog = await openSubmit(page);
  await dialog.getByRole("radio", { name: /Request changes/ }).click();
  await dialog.getByRole("button", { name: "Submit review" }).click();
  await expect(page.locator(".send-review-btn")).toContainText("Update review");

  dialog = await openSubmit(page);
  await expect(dialog).toContainText("Update plan review");
  await dialog.getByRole("radio", { name: /Approve/ }).click();
  await dialog.getByRole("button", { name: "Submit review" }).click();
  await expect(dialog).toBeHidden();
  expect((await getPlan(request, plan.id)).decision).toBe("approved");
});

test("submitting without a verdict is not possible", async ({ page, request }) => {
  const plan = await seedPlan(request);
  await openPlan(page, plan.id, "rendered");
  const dialog = await openSubmit(page);
  await expect(dialog.getByRole("button", { name: "Submit review" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await getPlan(request, plan.id)).decision).toBe("pending");
});
