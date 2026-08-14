// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Hono } from "hono";
import type { CommentStore } from "../lib/comments.js";
import { InMemoryMockupStore } from "../lib/mockups.js";
import { InMemoryPlanStore } from "../lib/plans.js";

// The server module imports git helpers at load time; stub them like server.test.ts.
vi.mock("../lib/git.js", () => ({
  getGitDiff: vi.fn(),
  getCustomGitDiff: vi.fn(),
  getRepoName: vi.fn(() => "test-repo"),
  getBranchName: vi.fn(() => "main"),
  getFileContent: vi.fn(),
  getTabSizeForFiles: vi.fn(() => ({})),
  getUntrackedFilePaths: vi.fn(() => []),
  getGitDiffAsync: vi.fn(async () => ""),
  getCustomGitDiffAsync: vi.fn(async () => ""),
  getRepoRootAsync: vi.fn(async () => "/tmp/test-repo"),
  getBranchNameAsync: vi.fn(async () => "main"),
  getUntrackedFilePathsAsync: vi.fn(async () => []),
  getRepoRoot: vi.fn(() => "/tmp/test-repo"),
  getProjectStorageDir: vi.fn(() => "/tmp/test-project-storage"),
}));

vi.mock("../lib/settings.js", () => ({
  loadSettings: vi.fn(() => ({})),
  saveSettings: vi.fn((s: any) => s),
}));

vi.mock("../lib/path.js", () => ({ isSafePath: vi.fn(() => true) }));

// A no-op comment store so createApp skips the filesystem watcher.
class MockCommentStore implements CommentStore {
  async getAll() {
    return [];
  }
  async add(c: any) {
    return c;
  }
  async update() {
    return null;
  }
  async resolveAllOpen() {
    return 0;
  }
  async remove() {
    return false;
  }
  async addReply() {
    return null;
  }
  async removeReply() {
    return null;
  }
  async updateReply() {
    return null;
  }
}

const clientDir = "/tmp/test-client";

async function makeApp(store: InMemoryMockupStore): Promise<Hono> {
  const { createApp } = await import("../server.js");
  const { DEFAULTS } = await import("../lib/diff-options.js");
  return createApp(
    clientDir,
    DEFAULTS,
    new MockCommentStore(),
    new InMemoryPlanStore(),
    undefined,
    false,
    undefined,
    store,
  );
}

async function postMockup(app: Hono, body: Record<string, unknown>) {
  return app.fetch(
    new Request("http://localhost/api/mockups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("mockup endpoints", () => {
  let app: Hono;
  let store: InMemoryMockupStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new InMemoryMockupStore();
    app = await makeApp(store);
  });

  it("GET /api/mockups starts empty", async () => {
    expect(
      await (
        await app.fetch(new Request("http://localhost/api/mockups"))
      ).json(),
    ).toEqual([]);
  });

  it("POST /api/mockups with html creates a mockup (201, single main screen, v1 pending)", async () => {
    const res = await postMockup(app, {
      title: "Hero",
      html: "<h1>Hello</h1>",
    });
    expect(res.status).toBe(201);
    const mockup = await res.json();
    expect(mockup.title).toBe("Hero");
    expect(mockup.version).toBe(1);
    expect(mockup.decision).toBe("pending");
    expect(mockup.id).toBeDefined();
    expect(mockup.screens).toHaveLength(1);
    expect(mockup.screens[0].id).toBe("main");
    expect(mockup.screens[0].html).toBe("<h1>Hello</h1>");
  });

  it("POST /api/mockups rejects html and screens together (400)", async () => {
    const res = await postMockup(app, {
      title: "Both",
      html: "<p>a</p>",
      screens: [{ id: "main", html: "<p>b</p>" }],
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/mockups with screens[] keeps all screens", async () => {
    const res = await postMockup(app, {
      title: "Multi",
      screens: [
        { id: "empty", html: "<p>e</p>" },
        { id: "filled", html: "<p>f</p>" },
      ],
    });
    expect(res.status).toBe(201);
    const mockup = await res.json();
    expect(mockup.screens).toHaveLength(2);
    expect(mockup.screens.map((s: any) => s.id)).toEqual(["empty", "filled"]);
  });

  it("POST /api/mockups returns in-page state hints when a screen has tabs/toggles", async () => {
    const res = await postMockup(app, {
      title: "Tabs",
      html: '<div role="tablist"><button role="tab">A</button></div>',
    });
    expect(res.status).toBe(201);
    const mockup = await res.json();
    expect(mockup.hints).toHaveLength(1);
    expect(mockup.hints[0].screenId).toBe("main");
    expect(mockup.hints[0].patterns).toContain("tabs");
  });

  it("POST /api/mockups omits hints when screens are clean", async () => {
    const res = await postMockup(app, { title: "Clean", html: "<p>ok</p>" });
    expect(res.status).toBe(201);
    expect((await res.json()).hints).toBeUndefined();
  });

  it("POST /api/mockups rejects oversized html (>1.5MB) (400)", async () => {
    const big = "<p>" + "x".repeat(1.5 * 1024 * 1024) + "</p>";
    const res = await postMockup(app, { title: "Big", html: big });
    expect(res.status).toBe(400);
  });

  it("GET /api/mockups/:id returns the mockup", async () => {
    const mockup = await (
      await postMockup(app, { title: "P", html: "<p>hi</p>" })
    ).json();
    const res = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}`),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(mockup.id);
    expect(
      (await app.fetch(new Request("http://localhost/api/mockups/nope")))
        .status,
    ).toBe(404);
  });

  it("GET /api/mockups/:id/screens/main/document contains data-diffing-probe", async () => {
    const mockup = await (
      await postMockup(app, { title: "P", html: "<p>hi</p>" })
    ).json();
    const res = await app.fetch(
      new Request(
        `http://localhost/api/mockups/${mockup.id}/screens/main/document`,
      ),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("data-diffing-probe");
  });

  it("POST comment kind=block screenId=main body=x → 201", async () => {
    const mockup = await (
      await postMockup(app, { title: "P", html: "<p>hi</p>" })
    ).json();
    const res = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "block",
          screenId: "main",
          body: "x",
          html: '<button class="pay">Pay $148</button>',
          contextHtml: '<section data-diffing="hero">…</section>',
          sectionX: 42,
          sectionY: 65,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const updated = await res.json();
    const comment = updated.comments[0];
    expect(comment.kind).toBe("block");
    expect(comment.screenId).toBe("main");
    expect(comment.body).toBe("x");
    expect(comment.status).toBe("open");
    expect(comment.html).toBe('<button class="pay">Pay $148</button>');
    expect(comment.contextHtml).toBe(
      '<section data-diffing="hero">…</section>',
    );
    expect(comment.sectionX).toBe(42);
    expect(comment.sectionY).toBe(65);

    // persisted: location metadata survives a fresh GET
    const fetched = await (
      await app.fetch(new Request(`http://localhost/api/mockups/${mockup.id}`))
    ).json();
    const stored = fetched.comments[0];
    expect(stored.html).toBe('<button class="pay">Pay $148</button>');
    expect(stored.contextHtml).toBe('<section data-diffing="hero">…</section>');
    expect(stored.sectionX).toBe(42);
    expect(stored.sectionY).toBe(65);
  });

  it("POST comment missing kind → 400", async () => {
    const mockup = await (
      await postMockup(app, { title: "P", html: "<p>hi</p>" })
    ).json();
    const res = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenId: "main", body: "x" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST decision approved → 200, await?sinceRound=0 returns released", async () => {
    const mockup = await (
      await postMockup(app, { title: "P", html: "<p>hi</p>" })
    ).json();
    const res = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      round: 1,
      decision: "approved",
    });

    const awaited = await (
      await app.fetch(
        new Request("http://localhost/api/mockup-review/await?sinceRound=0"),
      )
    ).json();
    expect(awaited.status).toBe("released");
    expect(awaited.payload.decision).toBe("approved");
    expect(awaited.payload.mockupId).toBe(mockup.id);
  });

  it("PUT /api/mockups/:id edits title in place (no version bump)", async () => {
    const mockup = await (
      await postMockup(app, { title: "P", html: "<p>hi</p>" })
    ).json();
    const res = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "P polished" }),
      }),
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.id).toBe(mockup.id);
    expect(updated.title).toBe("P polished");
    expect(updated.version).toBe(1);
  });

  it("DELETE /api/mockups/:id removes the mockup (200)", async () => {
    const mockup = await (
      await postMockup(app, { title: "P", html: "<p>hi</p>" })
    ).json();
    const res = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await store.getAll()).toHaveLength(0);
  });

  async function postComment(
    mockupId: string,
    body: Record<string, unknown> = {},
  ) {
    return app.fetch(
      new Request(`http://localhost/api/mockups/${mockupId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "block",
          screenId: "main",
          body: "x",
          ...body,
        }),
      }),
    );
  }

  async function createMockup(
    title = "P",
    screens?: Record<string, unknown>[],
  ) {
    const res = await postMockup(
      app,
      screens ? { title, screens } : { title, html: "<h1>Hi</h1>" },
    );
    expect(res.status).toBe(201);
    return (await res.json()) as any;
  }

  it("GET /api/mockups returns compact summaries without html/versions/comments", async () => {
    await createMockup("A");
    await createMockup("B");
    const list = (await (
      await app.fetch(new Request("http://localhost/api/mockups"))
    ).json()) as any[];
    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item.title).toBeDefined();
      expect(item.version).toBe(1);
      expect(item.decision).toBe("pending");
      expect(item.versionCount).toBe(1);
      expect(item.commentCounts).toEqual({ total: 0, open: 0, resolved: 0 });
      // screens are id/label metadata only — never the html body
      expect(item.screens).toEqual([{ id: "main", label: "Main" }]);
      expect(JSON.stringify(item)).not.toContain("<h1>Hi</h1>");
      expect(item.html).toBeUndefined();
      expect(item.versions).toBeUndefined();
      expect(item.comments).toBeUndefined();
    }
  });

  it("GET /api/mockups?include=comments keeps comment compatibility and counts", async () => {
    const mockup = await createMockup("A");
    expect(
      (
        await postComment(mockup.id, {
          body: "note",
          viewport: "mobile",
        })
      ).status,
    ).toBe(201);
    const list = (await (
      await app.fetch(
        new Request("http://localhost/api/mockups?include=comments"),
      )
    ).json()) as any[];
    expect(list[0].comments).toHaveLength(1);
    expect(list[0].comments[0].body).toBe("note");
    expect(list[0].comments[0].viewport).toBe("mobile");
    expect(list[0].commentCounts).toEqual({ total: 1, open: 1, resolved: 0 });
  });

  it("GET /api/mockups/:id/versions is metadata-only (no html) and versions/:n is full", async () => {
    const mockup = await createMockup("A");
    await postMockup(app, {
      id: mockup.id,
      title: "A v2",
      html: "<h1>v2</h1>",
    });
    const versions = (await (
      await app.fetch(
        new Request(`http://localhost/api/mockups/${mockup.id}/versions`),
      )
    ).json()) as any[];
    expect(versions).toHaveLength(2);
    expect(versions[1].version).toBe(2);
    expect(versions[1].title).toBe("A v2");
    expect(versions[1].screens).toEqual([{ id: "main", label: "Main" }]);
    expect(JSON.stringify(versions)).not.toContain("<h1>v2</h1>");

    const v1 = await (
      await app.fetch(
        new Request(`http://localhost/api/mockups/${mockup.id}/versions/1`),
      )
    ).json();
    expect((v1 as any).version.screens[0].html).toBe("<h1>Hi</h1>");
    expect((v1 as any).mockup.currentVersion).toBe(2);
    expect(
      (
        await app.fetch(
          new Request(`http://localhost/api/mockups/${mockup.id}/versions/0`),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.fetch(
          new Request(`http://localhost/api/mockups/${mockup.id}/versions/9`),
        )
      ).status,
    ).toBe(404);
  });

  it("comment nonce: stale or mismatched nonces are rejected, matching ones pass", async () => {
    const mockup = await createMockup();
    const stale = await postComment(mockup.id, { nonce: "bogus" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "invalid-nonce",
      error: expect.stringContaining("nonce"),
    });

    // a document served for THIS mockup+screen carries a valid nonce
    const doc = await app.fetch(
      new Request(
        `http://localhost/api/mockups/${mockup.id}/screens/main/document`,
      ),
    );
    const nonce = doc.headers.get("X-Diffing-Mockup-Nonce");
    expect(nonce).toBeTruthy();
    expect(doc.headers.get("X-Diffing-Mockup-Viewport")).toBe("desktop");
    expect((await postComment(mockup.id, { nonce })).status).toBe(201);

    // a nonce from another mockup never matches
    const other = await createMockup("Other");
    const wrong = await postComment(other.id, { nonce });
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toMatchObject({ code: "invalid-nonce" });
  });

  it("comments without a viewport anchor on desktop; explicit viewport is stored", async () => {
    const mockup = await createMockup();
    await postComment(mockup.id, { body: "legacy" });
    await postComment(mockup.id, { body: "mobile note", viewport: "mobile" });
    const fetched = await (
      await app.fetch(new Request(`http://localhost/api/mockups/${mockup.id}`))
    ).json();
    const byBody = Object.fromEntries(
      (fetched as any).comments.map((c: any) => [c.body, c]),
    );
    expect(byBody["legacy"].viewport).toBe("desktop");
    expect(byBody["mobile note"].viewport).toBe("mobile");
  });

  it("inspect view=summary reports version/screen/count metadata with byViewport", async () => {
    const mockup = await createMockup();
    await postComment(mockup.id, { body: "d" });
    await postComment(mockup.id, { body: "m", viewport: "mobile" });
    const data = (await (
      await app.fetch(
        new Request(`http://localhost/api/mockups/${mockup.id}/inspect`),
      )
    ).json()) as any;
    expect(data.view).toBe("summary");
    expect(data.id).toBe(mockup.id);
    expect(data.version).toBe(1);
    expect(data.screens).toEqual([{ id: "main", label: "Main" }]);
    expect(data.versions).toBe(1);
    expect(data.commentCounts).toEqual({
      total: 2,
      open: 2,
      resolved: 0,
      byViewport: { desktop: 1, tablet: 0, mobile: 1 },
    });
  });

  it("inspect view=screen: source html only for one explicit screen with context=source", async () => {
    const mockup = await createMockup("Multi", [
      { id: "main", html: "<p>main</p>" },
      { id: "checkout", html: "<p>checkout</p>" },
    ]);
    // list view: metadata only, no html
    const list = (await (
      await app.fetch(
        new Request(
          `http://localhost/api/mockups/${mockup.id}/inspect?view=screen`,
        ),
      )
    ).json()) as any;
    expect(list.screens).toHaveLength(2);
    expect(list.screens[0]).toEqual({
      id: "main",
      label: "Main",
      htmlBytes: expect.any(Number),
    });
    expect(list.screens[0].html).toBeUndefined();
    expect(list.nextCursor).toBeNull();

    // one explicit screen without context=source → no html
    const anchor = (await (
      await app.fetch(
        new Request(
          `http://localhost/api/mockups/${mockup.id}/inspect?view=screen&screen=main`,
        ),
      )
    ).json()) as any;
    expect(anchor.screen.html).toBeUndefined();

    // one explicit screen with context=source → full html
    const source = (await (
      await app.fetch(
        new Request(
          `http://localhost/api/mockups/${mockup.id}/inspect?view=screen&screen=main&context=source`,
        ),
      )
    ).json()) as any;
    expect(source.screen.html).toBe("<p>main</p>");

    // historical version selection serves that version's screen
    await postMockup(app, {
      id: mockup.id,
      title: "Multi v2",
      screens: [{ id: "main", html: "<p>v2 main</p>" }],
    });
    const history = (await (
      await app.fetch(
        new Request(
          `http://localhost/api/mockups/${mockup.id}/inspect?view=screen&screen=main&context=source&version=1`,
        ),
      )
    ).json()) as any;
    expect(history.version).toBe(1);
    expect(history.screen.html).toBe("<p>main</p>");
    expect(
      (
        await app.fetch(
          new Request(
            `http://localhost/api/mockups/${mockup.id}/inspect?view=screen&screen=main&context=source&version=9`,
          ),
        )
      ).status,
    ).toBe(404);
  });

  it("inspect view=comments filters by status/screen/viewport/version and context=none strips html", async () => {
    const mockup = await createMockup("Multi", [
      { id: "main", html: "<p>main</p>" },
      { id: "checkout", html: "<p>checkout</p>" },
    ]);
    await postComment(mockup.id, { body: "desktop-main", screenId: "main" });
    await postComment(mockup.id, {
      body: "mobile-main",
      screenId: "main",
      viewport: "mobile",
    });
    await postComment(mockup.id, {
      body: "desktop-checkout",
      screenId: "checkout",
      viewport: "desktop",
      html: "<button>x</button>",
      contextHtml: "<section>…</section>",
    });
    await postMockup(app, { id: mockup.id, title: "v2", html: "<p>v2</p>" });

    const filter = async (qs: string) =>
      (await (
        await app.fetch(
          new Request(
            `http://localhost/api/mockups/${mockup.id}/inspect?view=comments&${qs}`,
          ),
        )
      ).json()) as any;

    const all = await filter("");
    expect(all.comments).toHaveLength(3);

    const byScreen = await filter("screen=main");
    expect(byScreen.comments.map((c: any) => c.body)).toEqual([
      "desktop-main",
      "mobile-main",
    ]);

    const byViewport = await filter("screen=main&viewport=mobile");
    expect(byViewport.comments.map((c: any) => c.body)).toEqual([
      "mobile-main",
    ]);

    const byVersion = await filter("version=1");
    expect(byVersion.comments).toHaveLength(3);
    // comments created after v1 don't exist, so version=1 keeps them all here
    const none = await filter("version=99");
    expect(none.comments).toHaveLength(0);

    // context=none strips anchor html even when the comment carries it
    const stripped = await filter("screen=checkout&context=none");
    expect(stripped.comments[0].body).toBe("desktop-checkout");
    expect(stripped.comments[0].html).toBeUndefined();
    expect(stripped.comments[0].contextHtml).toBeUndefined();

    const withAnchor = await filter("screen=checkout&context=anchor");
    expect(withAnchor.comments[0].html).toBe("<button>x</button>");

    const byStatus = await filter("status=resolved");
    expect(byStatus.comments).toHaveLength(0);
  });

  it("inspect view=comment returns one thread and rejects bad filters", async () => {
    const mockup = await createMockup();
    const created = await (
      await postComment(mockup.id, { body: "the thread", html: "<b>hi</b>" })
    ).json();
    const commentId = created.comments[0].id;

    const one = (await (
      await app.fetch(
        new Request(
          `http://localhost/api/mockups/${mockup.id}/inspect?view=comment&id=${commentId}`,
        ),
      )
    ).json()) as any;
    expect(one.comment.body).toBe("the thread");
    expect(one.comment.html).toBe("<b>hi</b>");

    expect(
      (
        await app.fetch(
          new Request(
            `http://localhost/api/mockups/${mockup.id}/inspect?view=comment`,
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.fetch(
          new Request(
            `http://localhost/api/mockups/${mockup.id}/inspect?view=comment&id=ghost`,
          ),
        )
      ).status,
    ).toBe(404);

    for (const qs of [
      "view=bogus",
      "view=comments&viewport=bogus",
      "view=comments&status=bogus",
      "view=comments&version=abc",
      "view=comments&context=bogus",
    ]) {
      expect(
        (
          await app.fetch(
            new Request(
              `http://localhost/api/mockups/${mockup.id}/inspect?${qs}`,
            ),
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await app.fetch(
          new Request(
            `http://localhost/api/mockups/${mockup.id}/inspect?view=screen&screen=nope`,
          ),
        )
      ).status,
    ).toBe(404);
  });

  it("PUT/PATCH/DELETE one-screen ops: version bumps, expectedVersion 409s, no mutation on failure", async () => {
    const mockup = await createMockup("Multi", [
      { id: "main", html: "<p>main</p>" },
      { id: "checkout", html: "<p>checkout</p>" },
    ]);
    const base = `http://localhost/api/mockups/${mockup.id}/screens`;

    // upsert a new screen
    const up = await app.fetch(
      new Request(`${base}/cart`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: "<p>cart</p>", label: "Cart" }),
      }),
    );
    expect(up.status).toBe(200);
    const afterUp = await up.json();
    expect(afterUp.version).toBe(2);
    expect(afterUp.screens.map((s: any) => s.id)).toEqual([
      "main",
      "checkout",
      "cart",
    ]);

    // replace an existing screen in place
    const rep = await app.fetch(
      new Request(`${base}/main`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: "<p>main v3</p>" }),
      }),
    );
    expect(rep.status).toBe(200);
    expect((await rep.json()).version).toBe(3);

    // expectedVersion mismatch → 409, nothing applied
    const conflict = await app.fetch(
      new Request(`${base}/main`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: "<p>x</p>", expectedVersion: 1 }),
      }),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "version-mismatch",
      expectedVersion: 1,
      currentVersion: 3,
    });
    const afterConflict = (await (
      await app.fetch(new Request(`http://localhost/api/mockups/${mockup.id}`))
    ).json()) as any;
    expect(afterConflict.version).toBe(3);
    expect(afterConflict.screens.find((s: any) => s.id === "main").html).toBe(
      "<p>main v3</p>",
    );

    // invalid screen id
    expect(
      (
        await app.fetch(
          new Request(`${base}/BAD ID`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ html: "<p>x</p>" }),
          }),
        )
      ).status,
    ).toBe(400);

    // exact-text patch: first occurrence + occurrences count
    await app.fetch(
      new Request(`${base}/cart`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: "<p>Pay</p><p>Pay</p>" }),
      }),
    );
    const patch = await app.fetch(
      new Request(`${base}/cart`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedText: "Pay", replacement: "Buy" }),
      }),
    );
    expect(patch.status).toBe(200);
    const patched = await patch.json();
    expect(patched.occurrences).toBe(2);
    expect(patched.mockup.version).toBe(5);
    expect(patched.mockup.screens.find((s: any) => s.id === "cart").html).toBe(
      "<p>Buy</p><p>Pay</p>",
    );

    const noMatch = await app.fetch(
      new Request(`${base}/cart`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedText: "zzz", replacement: "x" }),
      }),
    );
    expect(noMatch.status).toBe(409);
    expect(await noMatch.json()).toMatchObject({
      code: "exact-text-not-found",
    });
    expect(
      (
        await app.fetch(
          new Request(`${base}/cart`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ replacement: "x" }),
          }),
        )
      ).status,
    ).toBe(400);

    // remove a screen (version bump); removing the last screen is rejected
    const del = await app.fetch(
      new Request(`${base}/cart`, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);
    expect((await del.json()).version).toBe(6);

    const delLast = await app.fetch(
      new Request(`${base}/main`, { method: "DELETE" }),
    );
    expect(delLast.status).toBe(200);
    const delOnly = await app.fetch(
      new Request(`${base}/checkout`, { method: "DELETE" }),
    );
    expect(delOnly.status).toBe(400);

    const delMissing = await app.fetch(
      new Request(`${base}/nope`, { method: "DELETE" }),
    );
    expect(delMissing.status).toBe(404);

    const delConflict = await app.fetch(
      new Request(`${base}/checkout?expectedVersion=1`, { method: "DELETE" }),
    );
    expect(delConflict.status).toBe(409);
    expect(await delConflict.json()).toMatchObject({
      code: "version-mismatch",
    });
  });

  it("POST /api/mockups/:id/threads/batch applies atomically and never bumps the version", async () => {
    const mockup = await createMockup();
    const created = await (
      await postComment(mockup.id, { body: "thread" })
    ).json();
    const commentId = created.comments[0].id;

    const batch = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}/threads/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operations: [
            {
              op: "reply",
              commentId,
              body: "fixed",
              role: "agent",
              model: "opus",
            },
            { op: "resolve", commentId },
          ],
        }),
      }),
    );
    expect(batch.status).toBe(200);
    const applied = await batch.json();
    expect(applied.ok).toBe(true);
    expect(applied.applied).toBe(2);
    expect(applied.results).toHaveLength(2);
    expect(applied.mockup.version).toBe(1); // thread ops never bump
    expect(applied.mockup.comments[0].status).toBe("resolved");

    // one invalid op aborts the whole batch
    const bad = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}/threads/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operations: [
            { op: "reply", commentId, body: "ok" },
            { op: "delete", commentId: "ghost" },
          ],
        }),
      }),
    );
    expect(bad.status).toBe(409);
    const badBody = await bad.json();
    expect(badBody.error).toContain("operations[1]");
    expect(badBody.results).toEqual([]);

    const missing = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}/threads/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(missing.status).toBe(400);

    expect(
      (
        await app.fetch(
          new Request("http://localhost/api/mockups/nope/threads/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operations: [{ op: "resolve", commentId }],
            }),
          }),
        )
      ).status,
    ).toBe(404);
  });

  it("decision hands off a compact open-only review scoped to the submitted screen+viewport", async () => {
    const mockup = await createMockup("Multi", [
      { id: "main", html: "<p>main</p>" },
      { id: "checkout", html: "<p>checkout</p>" },
    ]);
    const main = await (
      await postComment(mockup.id, {
        body: "main note",
        screenId: "main",
        viewport: "desktop",
      })
    ).json();
    const mainId = main.comments[0].id;
    await postComment(mockup.id, {
      body: "checkout note",
      screenId: "checkout",
      viewport: "desktop",
    });
    const created = await (
      await postComment(mockup.id, {
        body: "resolved note",
        screenId: "main",
        viewport: "desktop",
      })
    ).json();
    const resolvedId = created.comments.find(
      (c: any) => c.body === "resolved note",
    ).id;
    await app.fetch(
      new Request(
        `http://localhost/api/mockups/${mockup.id}/comments/${resolvedId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "resolved" }),
        },
      ),
    );

    const res = await app.fetch(
      new Request(`http://localhost/api/mockups/${mockup.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "changes-requested",
          screen: "main",
          viewport: "desktop",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const decision = await res.json();
    expect(decision.ok).toBe(true);
    expect(decision.openCommentCount).toBe(2);

    const awaited = await (
      await app.fetch(
        new Request("http://localhost/api/mockup-review/await?sinceRound=0"),
      )
    ).json();
    expect(awaited.status).toBe("released");
    const xml = awaited.payload.reviewXml as string;
    expect(xml).toContain('screen="main"');
    expect(xml).toContain('viewport="desktop"');
    // compact handoff: no instructions, no location context, open-only,
    // scoped to the submitted screen+viewport
    expect(xml).not.toContain("<instructions>");
    expect(xml).not.toContain("<location>");
    expect(xml).toContain("main note");
    expect(xml).not.toContain("checkout note");
    expect(xml).not.toContain("resolved note");
  });
});
