import { expect, test } from "@playwright/test";
import { firstSha, headSha, session } from "./data";

test.beforeEach(async ({ request }) => { await request.post("/api/test/reset"); });

for (const side of ["additions", "deletions"] as const) {
  test(`PR hover is enabled by default on ${side} and follows selected commits`, async ({ page }, info) => {
    await page.goto("/gh/pr");
    const card = page.locator('[id="file-src/lib/review-session.ts"]');
    const token = card.locator(`diffs-container [data-line-type="change-${side === 'additions' ? 'addition' : 'deletion'}"] [data-char]`).filter({ hasText: "session" }).first();
    await expect(token).toBeVisible();
    const requests: Record<string, any>[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/code-intel') && request.postDataJSON()?.op === 'hover') requests.push(request.postDataJSON());
    });
    await expect(async () => {
      await page.mouse.move(0, 0);
      await token.hover();
      await expect(page.getByRole('tooltip')).toContainText(`Type information (pr / ${side})`);
    }).toPass({timeout:10000});
    const body = requests.at(-1)!;
    expect(body.source.kind).toBe('pr');
    expect(body.source.revision).toBe(headSha);
    expect(body.source.parentRevision).toBe(session.baseSha);
    expect(body.side).toBe(side);
    await page.screenshot({path:info.outputPath(`pr-hover-${side}.png`)});
    await page.getByRole('combobox',{name:'Select commit to review'}).selectOption(firstSha);
    await expect(card.locator('diffs-container')).toContainText('session.refresh()');
    await page.mouse.move(0, 0);
    const selected = page.waitForRequest((request) => request.url().endsWith('/api/code-intel') && request.postDataJSON()?.op === 'hover');
    await token.hover();
    expect((await selected).postDataJSON().source.revision).toBe(firstSha);
    const previewRequest = page.waitForRequest((request) => request.url().endsWith('/api/code-intel/file'));
    await token.click({modifiers:[process.platform === 'darwin' ? 'Meta' : 'Control']});
    const preview = (await previewRequest).postDataJSON();
    expect(preview.source.revision).toBe(firstSha);
    expect(preview.side).toBe(side);
    await expect(page.getByRole('dialog', {name:/Definition of/})).toContainText('export function review');
  });
}

for (const side of ['additions', 'deletions'] as const) {
  test(`local hover is enabled by default on ${side}`, async ({page, request: api}) => {
    await api.post('/api/test/reset', {data:{local:true}});
    await page.goto('/');
    const card = page.locator('[id="file-src/lib/review-session.ts"]');
    const token = card.locator(`diffs-container [data-line-type="change-${side === 'additions' ? 'addition' : 'deletion'}"] [data-char]`).filter({hasText:'session'}).first();
    await expect(token).toBeVisible();
    const requests: Record<string, any>[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/code-intel') && request.postDataJSON()?.op === 'hover') requests.push(request.postDataJSON());
    });
    await expect(async () => {
      await page.mouse.move(0, 0);
      await token.hover();
      await expect(page.getByRole('tooltip')).toContainText(`Type information (working / ${side})`);
    }).toPass({timeout:10000});
    const body = requests.at(-1)!;
    expect(body.source.kind).toBe('working');
    expect(body.side).toBe(side);
  });
}
