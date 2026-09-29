import { expect, test } from "@playwright/test";
import { firstSha, secondSha } from "./data";

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/test/reset");
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/gh/pr");
  await expect(
    page.getByRole("heading", {
      name: "A calmer, more focused pull request review",
    })
  ).toBeVisible();
});

test("collapses context and walks real commit diffs with separate review progress", async ({
  page,
}, info) => {
  const description = page.getByRole("button", {
    name: "Description",
    exact: true,
  });
  await description.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: /What changed/ })
  ).toBeVisible();
  await description.click();
  await expect(
    page.getByRole("heading", { name: /What changed/ })
  ).not.toBeVisible();
  const comments = page.getByRole("button", { name: /^Comments & activity/ });
  await comments.click();
  await expect(
    page.getByText("Draft preservation is covered by the final commit.")
  ).toBeVisible();
  await comments.click();
  await expect(
    page.getByText("Draft preservation is covered by the final commit.")
  ).not.toBeVisible();
  await page.getByRole("button", { name: /^Overview/ }).click();
  await expect(page.getByText("Opened by")).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath("pr-overview.png"),
    fullPage: true,
  });

  await page
    .getByRole("combobox", { name: "Select commit to review" })
    .selectOption(firstSha);
  const firstCard = page.locator('[id="file-src/lib/review-session.ts"]');
  await expect(firstCard).toBeVisible();
  await expect(firstCard.locator("diffs-container")).toContainText(
    "session.refresh()"
  );
  await expect(
    page.getByRole("button", { name: "Add file comment" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Expand context", exact: true })
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await firstCard
    .getByRole("checkbox", { name: "Mark as viewed", exact: true })
    .check();
  await page.getByRole("button", { name: "Next commit", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Select commit to review" })
  ).toHaveValue(secondSha);
  await expect(
    page.locator('[id="file-src/ui/ReviewToolbar.tsx"]')
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Mark as viewed", exact: true })
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Previous commit", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    firstCard.getByRole("checkbox", { name: "Mark as unviewed", exact: true })
  ).toBeChecked();
  await firstCard
    .getByRole("checkbox", { name: "Mark as unviewed", exact: true })
    .uncheck();
  await page.screenshot({
    path: info.outputPath("pr-commit.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "All changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add file comment" })
  ).toHaveCount(2);
  await expect(
    firstCard.getByRole("checkbox", { name: "Mark as viewed", exact: true })
  ).not.toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test("shows a failed commit load without retaining the previous commit's diff", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Select commit to review" })
    .selectOption(firstSha);
  await expect(
    page.locator('[id="file-src/lib/review-session.ts"]')
  ).toBeVisible();
  await page.route(`**/api/gh/commits/${secondSha}/diff?*`, (route) =>
    route.fulfill({ status: 502, json: { error: "GitHub is unavailable" } })
  );
  await page.getByRole("button", { name: "Next commit", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("GitHub is unavailable");
  await expect(page.locator(".pr-diff-surface")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark reviewed", exact: true })
  ).toBeDisabled();
  await page.unroute(`**/api/gh/commits/${secondSha}/diff?*`);
  await page.getByRole("button", { name: "Retry diff", exact: true }).click();
  await expect(
    page.locator('[id="file-src/ui/ReviewToolbar.tsx"]')
  ).toBeVisible();
});
