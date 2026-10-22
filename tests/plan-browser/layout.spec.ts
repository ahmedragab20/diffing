import { expect, test } from "@playwright/test";
import { getPlan, openPlan, resetPlans, seedPlan } from "./fixtures";

test.beforeEach(async ({ request }) => {
  await resetPlans(request);
});

for (const width of [1240, 1100, 1000]) {
  test(`toolbar fits on one row at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 });
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    const facts = await page.evaluate(() => {
      const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const toggle = rect(".plan-view-toggle");
      const right = rect(".plan-app-toolbar .toolbar-right");
      const submit = rect(".send-review-btn");
      return {
        toolbarHeight: rect(".plan-app-toolbar").height,
        toggleClearOfRight: toggle.right <= right.left,
        submitHeight: submit.height,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(facts.toolbarHeight).toBeLessThanOrEqual(48);
    expect(facts.toggleClearOfRight).toBe(true);
    expect(facts.submitHeight).toBeLessThanOrEqual(28);
    expect(facts.horizontalOverflow).toBe(0);
  });
}

test("below 1100px the outline is an inline card, not a sticky overlay", async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const plan = await seedPlan(request);
  await openPlan(page, plan.id, "rendered");
  const outline = page.getByRole("navigation", { name: "Plan outline" });
  await expect(outline).toBeVisible();
  expect(await outline.evaluate((el) => getComputedStyle(el).position)).toBe("relative");
});

test("edit mode autosaves in place and Save as new version bumps the version", async ({ page, request }) => {
  const plan = await seedPlan(request);
  await openPlan(page, plan.id, "source");
  await page.getByRole("button", { name: "Edit plan" }).click();
  const editor = page.locator(".plan-source-editor-textarea");
  await expect(editor).toBeVisible();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("\nAutosaved line.");
  await expect.poll(async () => (await getPlan(request, plan.id)).body).toContain("Autosaved line.");
  expect((await getPlan(request, plan.id)).version).toBe(1);

  await page.getByRole("button", { name: "Save as new version" }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save as new version" }).click();
  await expect.poll(async () => (await getPlan(request, plan.id)).version).toBe(2);
  expect((await getPlan(request, plan.id)).decision).toBe("pending");
});

test("browsing an older version is read-only and Current returns", async ({ page, request }) => {
  const plan = await seedPlan(request);
  await request.post("/api/plans", {
    data: { id: plan.id, title: "M1: Tenancy foundation", body: "# M1\n\nVersion two body.\n", model: "e2e-model" },
  });
  await expect.poll(async () => (await getPlan(request, plan.id)).version).toBe(2);
  await openPlan(page, plan.id, "rendered");
  await expect(page.locator(".plan-rendered")).toContainText("Version two body.");

  await page.getByRole("combobox", { name: "Plan version" }).click();
  await page.getByRole("option", { name: /v1/ }).click();
  await expect(page.locator(".plan-rendered")).toContainText("Usage is metered");
  await expect(page.getByRole("button", { name: "Edit plan" })).toHaveCount(0);

  await page.getByRole("button", { name: /Current/ }).click();
  await expect(page.locator(".plan-rendered")).toContainText("Version two body.");
});
