import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { content, targetPath } from "./data";

const fixture = "/tests/search-browser/fixture.html";
const target = (page: Page) => page.locator('[id="file-src/target.ts"]');
const row = (page: Page, line: number) => target(page).locator(`[data-line="${line}"][data-line-type="change-addition"]`);

async function openSearch(page: Page, query = "needle") {
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page.getByRole("combobox", { name: "Search working tree" }).fill(query);
  await expect(page.getByRole("option", { name: /target.ts:900/ })).toBeVisible();
}
async function jump(page: Page, line = 900) {
  await openSearch(page);
  await page.getByRole("option", { name: new RegExp(`target.ts:${line} `) }).click();
  await expect(page.getByRole("status")).toHaveText(`Jumped to ${targetPath}:${line}`);
  await expect(row(page, line)).toBeInViewport({ ratio: 1 });
}

// A render-frame boundary, not an arbitrary sleep: specifically exercises the
// former 40-frame expiry while the full-context API is deliberately held back.
async function renderFrames(page: Page, frames: number) {
  await page.evaluate(count => new Promise<void>(resolve => {
    const tick = () => --count <= 0 ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  }), frames);
}

function delayedContents(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  const installed = page.route("**/api/file-text?*", async route => {
    requests++;
    const url = new URL(route.request().url());
    await gate;
    await route.fulfill({ json: { content: content(url.searchParams.get("path")!, url.searchParams.get("version") === "old") } });
  });
  return { installed, release: () => release(), count: () => requests };
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => { throw error; });
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const geometry = await target(page).evaluate(card => {
    const rows: unknown[] = [];
    const collect = (root: Element | ShadowRoot) => {
      for (const el of root.querySelectorAll('[data-line="100"], [data-line="900"]')) {
        rows.push({ line: el.getAttribute("data-line"), type: el.getAttribute("data-line-type"), rect: el.getBoundingClientRect().toJSON() });
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) collect(el.shadowRoot);
    };
    collect(card);
    return { scrollY, viewport: innerHeight, height: document.documentElement.scrollHeight, card: card.getBoundingClientRect().toJSON(), rows, bodyStyle: document.body.getAttribute("style"), dialogs: document.querySelectorAll('[role="dialog"]').length };
  });
  const path = info.outputPath("navigation-geometry.json");
  await writeFile(path, JSON.stringify(geometry, null, 2));
  await info.attach("navigation-geometry", { path, contentType: "application/json" });
});

for (const layout of ["unified", "split"]) {
  for (const state of ["cold", "viewed"]) {
    test(`${layout}: ${state} distant target and warm repeat reach the exact line`, async ({ page }) => {
      await page.goto(`${fixture}?layout=${layout}${state === "viewed" ? "&viewed" : ""}`);
      // Offscreen cards must not eagerly materialize the target before search.
      await expect(target(page).locator("diffs-container")).toHaveCount(0);
      await jump(page);
      if (state === "viewed") await expect(target(page).getByRole("checkbox", { name: "Mark as unviewed" })).toBeChecked();
      await page.getByRole("button", { name: "Top", exact: true }).click();
      await jump(page);
      await expect(page.getByRole("button", { name: "Open search", exact: true })).toBeFocused();
    });
  }
}

test("find-in-file Enter starts at the first hit and mouse Next reaches the following hit", async ({ page }) => {
  await page.goto(`${fixture}?collapsed`);
  await page.getByRole("button", { name: "Find in target" }).click();
  const input = page.getByRole("textbox", { name: "Find in file" });
  await input.fill("needle");
  await expect(page.getByRole("search")).toContainText("0/4");
  await input.press("Enter");
  await expect(page.getByRole("status")).toHaveText(`Jumped to ${targetPath}:100`);
  await expect(row(page, 100)).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(`Jumped to ${targetPath}:900`);
  await expect(row(page, 900)).toBeInViewport({ ratio: 1 });
});

test("palette controls and shortcut hints fit the viewport", async ({ page }) => {
  await page.goto(fixture);
  await openSearch(page);
  for (const tab of await page.getByRole("tab").all()) {
    await expect(tab).toBeInViewport({ ratio: 1 });
  }
  for (const name of [".*", "Changed"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  for (const hint of ["Alt+1–4 scope", "n/N after close", "esc close"]) {
    await expect(page.getByText(hint, { exact: true })).toBeInViewport({ ratio: 1 });
  }
});

test("palette keyboard controls retain native activation and normal focus traversal", async ({ page }) => {
  await page.goto(fixture);
  await openSearch(page);
  const input = page.getByRole("combobox");
  await input.press("Tab");
  await expect(page.getByRole("button", { name: "Clear search" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tab", { name: "Text", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const regex = page.getByRole("button", { name: ".*", exact: true });
  await expect(regex).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(regex).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Alt+1");
  await expect(page.getByRole("tab", { name: "All", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(input).toBeFocused();
  await page.getByRole("tab", { name: "All", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Files", exact: true })).toBeFocused();
});

for (const mode of ["staged", "custom"]) {
  test(`${mode} hits preview the working tree instead of guessing diff coordinates`, async ({ page }) => {
    await page.goto(`${fixture}?${mode}`);
    await openSearch(page);
    await page.getByRole("option", { name: /target.ts:900/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "View File in Diff" })).toBeVisible();
    await expect(page.locator(".searchpalette-preview-body").locator('[data-line="900"]')).toBeInViewport();
    // Replacing the preview must leave the most recent line in view.
    await page.getByRole("option", { name: /target.ts:100/ }).click();
    await expect(page.locator(".searchpalette-preview-body").locator('[data-line="100"]')).toBeInViewport();
    await expect(page.getByRole("status")).not.toContainText("Jumped to");
  });
}

test("whole-repository hits outside the diff stay in preview", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page.getByRole("button", { name: "Changed", exact: true }).click();
  await page.getByRole("combobox").fill("outside");
  await page.getByRole("option", { name: /outside.ts:1/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".searchpalette-preview-body").locator('[data-line="1"]')).toContainText("outside");
  await expect(page.getByRole("button", { name: "View File in Diff" })).toHaveCount(0);
  await expect(page.getByRole("status")).not.toContainText("Jumped to");
});

test("waits past 40 frames for full-context readiness without changing Viewed", async ({ page }) => {
  const deferred = delayedContents(page);
  await deferred.installed;
  try {
    await page.goto(`${fixture}?expanded&viewed`);
    await openSearch(page);
    await page.getByRole("option", { name: /target.ts:900/ }).click();
    await expect.poll(deferred.count).toBe(2);
    await renderFrames(page, 55);
    await expect(page.getByRole("status")).toHaveText(`Opening ${targetPath}:900…`);
    deferred.release();
    await expect(page.getByRole("status")).toHaveText(`Jumped to ${targetPath}:900`);
    await expect(row(page, 900)).toBeInViewport({ ratio: 1 });
    await expect(target(page).getByRole("checkbox", { name: "Mark as unviewed" })).toBeChecked();
  } finally { deferred.release(); }
});

test("user scrolling cancels delayed navigation and late content cannot steal the viewport", async ({ page }) => {
  const deferred = delayedContents(page);
  await deferred.installed;
  try {
    await page.goto(`${fixture}?expanded&viewed`);
    await openSearch(page);
    await page.getByRole("option", { name: /target.ts:900/ }).click();
    await expect.poll(deferred.count).toBe(2);
    await page.mouse.wheel(0, -2000);
    await expect(page.getByRole("status")).toHaveText("Jump cancelled");
    deferred.release();
    await renderFrames(page, 55);
    await expect(page.getByRole("status")).toHaveText("Jump cancelled");
    await expect(row(page, 900)).not.toBeInViewport();
  } finally { deferred.release(); }
});

test("successive saved-result activations keep the newest target", async ({ page }) => {
  await page.goto(fixture);
  await jump(page);
  const next = page.getByRole("button", { name: "Next saved result" });
  await next.click();
  await next.click();
  await expect(page.getByRole("status")).toHaveText(`Jumped to ${targetPath}:900`);
  await expect(row(page, 900)).toBeInViewport({ ratio: 1 });
});
