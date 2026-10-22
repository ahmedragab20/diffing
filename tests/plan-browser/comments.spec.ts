import { expect, test } from "@playwright/test";
import {
  composerLayout,
  getPlan,
  lineOf,
  openFloatComposer,
  openPlan,
  openSourceComposer,
  resetPlans,
  seedComment,
  seedPlan,
} from "./fixtures";

test.beforeEach(async ({ request }) => {
  await resetPlans(request);
});

test.describe("Read mode line comments", () => {
  test("selection maps to the right source line and submits with severity", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");

    // Inline code in the selection used to map to a wide wrong range.
    const panel = await openFloatComposer(page, "created at startup by migrateSync");
    const line = lineOf("created at startup by `migrateSync`");
    await expect(panel.locator(".plan-selection-comment-meta")).toContainText(`Commenting on L${line}`);
    await expect(panel.locator(".plan-selection-comment-meta")).not.toContainText("–");

    await panel.getByRole("combobox", { name: "Comment severity" }).click();
    await page.getByRole("option", { name: /Blocking/ }).click();
    await panel.getByRole("textbox", { name: "Comment body" }).fill("Which runs first?");
    await panel.getByRole("button", { name: "Comment", exact: true }).click();

    await expect(page.locator(".plan-selection-comment-floating")).toHaveCount(0);
    await expect(page.locator(".plan-rendered .plan-read-comment-host")).toContainText("Which runs first?");
    const saved = (await getPlan(request, plan.id)).comments;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ lineNumber: line, severity: "blocking", body: "Which runs first?" });
    expect(saved[0].startLineNumber).toBeUndefined();
    expect(saved[0].selectedQuote).toContain("migrateSync");
  });

  test("typing never scrolls or shifts the composer", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    const panel = await openFloatComposer(page, "Filler requirement number 3 that");
    const textarea = panel.getByRole("textbox", { name: "Comment body" });
    await textarea.click();

    const start = await composerLayout(panel);
    expect(start).toMatchObject({ rootScrollTop: 0, rootScrollLeft: 0, headerTop: 0, textareaInside: true, inViewport: true });
    expect(start.coversStatusBar).toBe(false);

    for (let i = 0; i < 5; i++) {
      await textarea.pressSequentially(`line ${i} `, { delay: 5 });
      expect(await composerLayout(panel)).toEqual(start);
    }
    await textarea.press("Enter");
    await textarea.pressSequentially("second paragraph");
    await textarea.fill("");
    expect(await composerLayout(panel)).toEqual(start);
  });

  test("a long selection keeps the textarea in view and collapses the source", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    await page.locator(".plan-rendered").evaluate((root) => {
      const items = [...root.querySelectorAll("li")].filter((li) => li.textContent?.includes("Filler requirement number"));
      const range = document.createRange();
      range.setStart(items[0].firstChild!, 0);
      range.setEnd(items[20].firstChild!, 10);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator(".plan-selection-popup").click();
    const panel = page.locator(".plan-selection-comment-floating");
    await expect(panel.locator(".plan-comment-source-details")).toBeVisible();
    await expect(panel.locator(".plan-comment-source-details")).not.toHaveAttribute("open", "");
    const layout = await composerLayout(panel);
    expect(layout).toMatchObject({ rootScrollTop: 0, bodyScrollTop: 0, textareaInside: true });
  });

  test("cancel asks before discarding a draft, and a discarded draft stays gone", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    const panel = await openFloatComposer(page, "Usage is metered");
    await panel.getByRole("textbox", { name: "Comment body" }).fill("half a thought");

    await panel.getByRole("button", { name: "Close comment form" }).click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: /Discard comment draft/ }));
    await expect(confirm).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(panel.getByRole("textbox", { name: "Comment body" })).toHaveValue("half a thought");

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.locator(".plan-selection-comment-floating")).toHaveCount(0);

    // An empty composer closes without asking.
    const again = await openFloatComposer(page, "Usage is metered");
    await expect(again.getByRole("textbox", { name: "Comment body" })).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(page.locator(".plan-selection-comment-floating")).toHaveCount(0);
    expect((await getPlan(request, plan.id)).comments).toHaveLength(0);
  });

  test("Escape in the severity menu closes the menu, not the composer", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    const panel = await openFloatComposer(page, "Usage is metered");
    await panel.getByRole("textbox", { name: "Comment body" }).fill("keep me");
    await panel.getByRole("combobox", { name: "Comment severity" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep editing" })).toHaveCount(0);
  });

  test("minimize, restore and submit several composers", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    const first = await openFloatComposer(page, "Usage is metered");
    await first.getByRole("textbox", { name: "Comment body" }).fill("first");
    await first.getByRole("button", { name: "Minimize" }).click();
    await expect(page.locator(".plan-float-tray-chip")).toHaveCount(1);

    const second = await openFloatComposer(page, "Ship behind a flag");
    await second.getByRole("textbox", { name: "Comment body" }).fill("second");
    await second.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.locator(".plan-selection-comment-floating")).toHaveCount(0);

    await page.locator(".plan-float-tray-chip").click();
    const restored = page.locator(".plan-selection-comment-floating");
    await expect(restored.getByRole("textbox", { name: "Comment body" })).toHaveValue("first");
    await restored.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.locator(".plan-float-tray-chip")).toHaveCount(0);

    const bodies = (await getPlan(request, plan.id)).comments.map((c) => [c.body, c.lineNumber]);
    expect(bodies).toEqual(
      expect.arrayContaining([
        ["first", lineOf("Usage is metered")],
        ["second", lineOf("Ship behind a flag")],
      ]),
    );
  });

  test("a failed save keeps the composer open with the text", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    await page.route(`**/api/plans/${plan.id}/comments`, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"disk full"}' })
        : route.continue(),
    );
    const panel = await openFloatComposer(page, "Usage is metered");
    await panel.getByRole("textbox", { name: "Comment body" }).fill("do not lose me");
    await panel.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(panel.getByRole("alert").or(panel.locator(".comment-form-error"))).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Comment body" })).toHaveValue("do not lose me");

    await page.unroute(`**/api/plans/${plan.id}/comments`);
    await panel.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.locator(".plan-selection-comment-floating")).toHaveCount(0);
    expect((await getPlan(request, plan.id)).comments.map((c) => c.body)).toEqual(["do not lose me"]);
  });

  test("selecting text does not change heading ids", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    const ids = () => page.locator(".plan-rendered h2").evaluateAll((hs) => hs.map((h) => h.id));
    const before = await ids();
    expect(before).toEqual(["today", "design", "rollout"]);
    for (const text of ["Usage is metered", "Ship behind a flag", "Filler requirement number 9"]) {
      const panel = await openFloatComposer(page, text);
      await panel.getByRole("button", { name: "Close comment form" }).click();
    }
    expect(await ids()).toEqual(before);
    // `# not a heading` inside the code fence is not in the outline.
    await expect(page.getByRole("navigation", { name: "Plan outline" })).not.toContainText("not a heading");
  });
});

test.describe("Source and Split line comments", () => {
  test("source composer adjusts its range and submits", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "source");
    const line = lineOf("**Machines:**");
    const textarea = await openSourceComposer(page, line);
    await page.getByRole("button", { name: "Expand range downward" }).click();
    await expect(page.getByRole("button", { name: `End line ${line + 1}` }).or(page.getByLabel(`End line ${line + 1}`))).toBeVisible();
    await textarea.fill("Both lines need a tenant id");
    await page.locator(".plan-file").getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.locator(".plan-file").getByRole("textbox", { name: "Comment body" })).toHaveCount(0);

    const [comment] = (await getPlan(request, plan.id)).comments;
    expect(comment).toMatchObject({ startLineNumber: line, lineNumber: line + 1, body: "Both lines need a tenant id" });
  });

  test("split mode: rendered selection opens a composer and the comment shows in both panes", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "split");
    const panel = await openFloatComposer(page, "Ship behind a flag");
    await panel.getByRole("textbox", { name: "Comment body" }).fill("Which flag?");
    await panel.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.locator(".plan-rendered .plan-read-comment-host")).toContainText("Which flag?");
    await expect(page.locator(".plan-file")).toContainText("Which flag?");
  });
});

test.describe("Threads", () => {
  test("reply, edit, resolve, unresolve and delete a comment", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await seedComment(request, plan.id, { lineNumber: lineOf("Usage is metered"), body: "Original note" });
    await openPlan(page, plan.id, "rendered");
    const thread = page.locator(".plan-rendered .plan-read-comment-host").first();
    await expect(thread).toContainText("Original note");

    await thread.getByRole("button", { name: /Reply/ }).click();
    await thread.getByRole("textbox", { name: "Comment body" }).fill("A reply");
    await thread.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(thread.getByRole("list", { name: "Replies" })).toContainText("A reply");

    await thread.getByRole("button", { name: "Edit comment" }).click();
    await thread.getByRole("textbox", { name: "Comment body" }).fill("Edited note");
    await thread.getByRole("button", { name: "Save", exact: true }).click();
    await expect(thread).toContainText("Edited note");

    await thread.getByRole("button", { name: "Resolve", exact: true }).click();
    // Resolved threads collapse to a one-line summary.
    await expect(thread).toContainText("Resolved");
    expect((await getPlan(request, plan.id)).comments[0].status).toBe("resolved");
    await thread.getByRole("button", { name: "Expand comment thread" }).click();
    await thread.getByRole("button", { name: "Unresolve" }).click();
    await expect(thread.getByRole("button", { name: "Resolve", exact: true })).toBeVisible();

    const saved = (await getPlan(request, plan.id)).comments[0];
    expect(saved).toMatchObject({ body: "Edited note", status: "open" });
    expect(saved.replies.map((r) => r.body)).toEqual(["A reply"]);

    await thread.getByRole("button", { name: "Delete comment" }).first().click();
    await page.getByRole("button", { name: "Confirm delete comment" }).click();
    await expect(page.locator(".plan-rendered .plan-read-comment-host")).toHaveCount(0);
    expect((await getPlan(request, plan.id)).comments).toHaveLength(0);
  });

  test("agent general comments render and accept replies", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await seedComment(request, plan.id, { lineNumber: 0, body: "General agent question" });
    await openPlan(page, plan.id, "rendered");
    const section = page.getByRole("region", { name: "General comments" });
    await expect(section).toContainText("General agent question");
    await section.getByRole("button", { name: /Reply/ }).click();
    await section.getByRole("textbox", { name: "Comment body" }).fill("Answer");
    await section.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(section.getByRole("list", { name: "Replies" })).toContainText("Answer");
  });

  test("comments posted by an agent appear live", async ({ page, request }) => {
    const plan = await seedPlan(request);
    await openPlan(page, plan.id, "rendered");
    await seedComment(request, plan.id, { lineNumber: lineOf("Ship behind a flag"), body: "Live from agent" });
    await expect(page.locator(".plan-rendered .plan-read-comment-host")).toContainText("Live from agent");
  });
});
