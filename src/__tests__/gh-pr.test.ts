// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Hono } from "hono";
import type { CommentStore } from "../lib/comments.js";
import { InMemoryPrSessionStore, type PrSession } from "../lib/pr-session.js";
import type { PlanStore } from "../lib/plans.js";

const githubMocks = vi.hoisted(() => ({
    submitReview: vi.fn(),
    fetchExistingComments: vi.fn(),
    fetchExistingReviews: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    setThreadResolved: vi.fn(),
}));

vi.mock("../lib/github.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../lib/github.js")>();
    return {
        ...actual,
        submitReview: githubMocks.submitReview,
        fetchExistingCommentsViaGh: githubMocks.fetchExistingComments,
        fetchExistingReviewsViaGh: githubMocks.fetchExistingReviews,
        updatePrReviewComment: githubMocks.updateComment,
        deletePrReviewComment: githubMocks.deleteComment,
        setPrReviewThreadResolved: githubMocks.setThreadResolved,
    };
});

vi.mock("../lib/git.js", () => ({
    getGitDiff: vi.fn(() => ""),
    getCustomGitDiff: vi.fn(() => ""),
    getRepoName: vi.fn(() => "test-repo"),
    getBranchName: vi.fn(() => "main"),
    getFileContent: vi.fn(() => ""),
    getTabSizeForFiles: vi.fn(() => ({})),
    getUntrackedFilePaths: vi.fn(() => []),
    getGitDiffAsync: vi.fn(async () => ""),
    getCustomGitDiffAsync: vi.fn(async () => ""),
    getRepoRootAsync: vi.fn(async () => "/tmp/test-repo"),
    getBranchNameAsync: vi.fn(async () => "main"),
    getUntrackedFilePathsAsync: vi.fn(async () => []),
    getRepoRoot: vi.fn(() => "/tmp/test-repo"),
    getProjectStorageDir: vi.fn(() => "/tmp/test-project-storage"),
    getShowDiff: vi.fn(() => ""),
}));

vi.mock("../lib/settings.js", () => ({
    loadSettings: vi.fn(() => ({})),
    saveSettings: vi.fn((s: any) => s),
}));

vi.mock("../lib/path.js", () => ({ isSafePath: vi.fn(() => true) }));

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

class MockPlanStore implements PlanStore {
    async getAll() {
        return [];
    }
    async get() {
        return null;
    }
    async upsert(input: { id?: string; title: string; body: string; source?: string; model?: string }) {
        return {
            id: input.id || "p1",
            title: input.title,
            body: input.body,
            source: input.source,
            model: input.model,
            createdAt: 0,
            updatedAt: 0,
            version: 1,
            decision: "pending" as const,
            comments: [],
            versions: [{ version: 1, body: input.body, title: input.title, createdAt: 0 }],
        };
    }
    async update() {
        return null;
    }
    async remove() {
        return false;
    }
    async setDecision() {
        return null;
    }
    async addComment() {
        return null;
    }
    async updateComment() {
        return null;
    }
    async removeComment() {
        return null;
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
    async getVersion() {
        return null;
    }
}

const baseSession: PrSession = {
    ref: "1234",
    owner: "acme",
    repo: "widget",
    pullNumber: 1234,
    headSha: "head",
    baseSha: "base",
    title: "A test PR",
    url: "https://github.com/ahmedragab20/diffing/pull/1234",
    author: { login: "octocat" },
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    diff: "diff --git a/x b/x\n",
    comments: [],
    existingComments: [
        {
            id: 999,
            author: { login: "reviewer" },
            body: "pre-existing feedback",
            path: "src/server.ts",
            line: 42,
            side: "RIGHT",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            state: "COMMENTED",
            replies: [],
            isOutdated: false,
        },
    ],
    authSource: "gh",
};

async function makeApp(prStore: InMemoryPrSessionStore): Promise<Hono> {
    const { createApp } = await import("../server.js");
    const { DEFAULTS } = await import("../lib/diff-options.js");
    return createApp(
        "/tmp/test-client",
        DEFAULTS,
        new MockCommentStore(),
        new MockPlanStore(),
        prStore,
        true,
    );
}

describe("gh-pr endpoints (integration)", () => {
    let app: Hono;
    let prStore: InMemoryPrSessionStore;

    beforeEach(async () => {
        vi.clearAllMocks();
        githubMocks.submitReview.mockResolvedValue({ ok: true, reviewId: 55, reviewUrl: "https://github.test/review/55", authSource: "gh" });
        githubMocks.fetchExistingComments.mockResolvedValue([]);
        githubMocks.fetchExistingReviews.mockResolvedValue([]);
        githubMocks.updateComment.mockResolvedValue({ ok: true });
        githubMocks.deleteComment.mockResolvedValue({ ok: true });
        githubMocks.setThreadResolved.mockResolvedValue({ ok: true });
        prStore = new InMemoryPrSessionStore();
        app = await makeApp(prStore);
    });

    it("GET /api/gh/session returns 200 prMode:false when no session", async () => {
        const res = await app.fetch(
            new Request("http://localhost/api/gh/session"),
        );
        // Soft probe for SPA Root redirect — not a hard 404.
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.prMode).toBe(false);
    });

    it("GET /api/gh/session returns the session when present", async () => {
        await prStore.set(baseSession);
        const res = await app.fetch(
            new Request("http://localhost/api/gh/session"),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.prMode).toBe(true);
        expect(body.owner).toBe("acme");
        expect(body.repo).toBe("widget");
        expect(body.pullNumber).toBe(1234);
        expect(body.title).toBe("A test PR");
        expect(body.existingComments).toHaveLength(1);
        expect(body.existingComments[0].body).toBe("pre-existing feedback");
        expect(body.existingReviews).toEqual([]);
    });

    it("GET /api/gh/pr-session/comments returns the in-progress comments", async () => {
        await prStore.set({
            ...baseSession,
            comments: [
                {
                    id: "c1",
                    filePath: "src/x.ts",
                    side: "additions",
                    lineNumber: 1,
                    lineContent: "+ x",
                    body: "first",
                    status: "open",
                    createdAt: 1000,
                    replies: [],
                },
            ],
        });
        const res = await app.fetch(
            new Request("http://localhost/api/gh/pr-session/comments"),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveLength(1);
        expect(body[0].body).toBe("first");
    });

    it("POST /api/gh/pr-session/comments adds a comment to the session", async () => {
        await prStore.set(baseSession);
        const res = await app.fetch(
            new Request("http://localhost/api/gh/pr-session/comments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filePath: "src/y.ts",
                    side: "additions",
                    lineNumber: 5,
                    lineContent: "+ y",
                    body: "second",
                }),
            }),
        );
        expect(res.status).toBe(201);
        const after = await prStore.get();
        expect(after?.comments).toHaveLength(1);
        expect(after?.comments[0].body).toBe("second");
    });

    it("PUT /api/gh/pr-session/comments/:id edits a comment", async () => {
        await prStore.set({
            ...baseSession,
            comments: [
                {
                    id: "c1",
                    filePath: "src/x.ts",
                    side: "additions",
                    lineNumber: 1,
                    lineContent: "",
                    body: "first",
                    status: "open",
                    createdAt: 1000,
                    replies: [],
                },
            ],
        });
        const res = await app.fetch(
            new Request("http://localhost/api/gh/pr-session/comments/c1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body: "edited" }),
            }),
        );
        expect(res.status).toBe(200);
        const after = await prStore.get();
        expect(after?.comments[0].body).toBe("edited");
    });

    it("DELETE /api/gh/pr-session/comments/:id removes a comment", async () => {
        await prStore.set({
            ...baseSession,
            comments: [
                {
                    id: "c1",
                    filePath: "src/x.ts",
                    side: "additions",
                    lineNumber: 1,
                    lineContent: "",
                    body: "first",
                    status: "open",
                    createdAt: 1000,
                    replies: [],
                },
            ],
        });
        const res = await app.fetch(
            new Request("http://localhost/api/gh/pr-session/comments/c1", {
                method: "DELETE",
            }),
        );
        expect(res.status).toBe(200);
        const after = await prStore.get();
        expect(after?.comments).toHaveLength(0);
    });

    it("POST /api/gh/pr-session/comments/:id/replies persists a visible reply", async () => {
        await prStore.set({
            ...baseSession,
            comments: [
                {
                    id: "c1",
                    filePath: "src/x.ts",
                    side: "additions",
                    lineNumber: 1,
                    lineContent: "+ x",
                    body: "first",
                    status: "open",
                    createdAt: 1000,
                    replies: [],
                },
            ],
        });
        const res = await app.fetch(
            new Request("http://localhost/api/gh/pr-session/comments/c1/replies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body: "  follow-up  ", role: "user" }),
            }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.replies).toHaveLength(1);
        expect(body.replies[0].body).toBe("follow-up");
        expect((await prStore.get())?.comments[0].replies[0].body).toBe("follow-up");
    });

    it("POST /api/gh/pr-session/comments/:id/replies reports a missing comment", async () => {
        await prStore.set(baseSession);
        const res = await app.fetch(
            new Request("http://localhost/api/gh/pr-session/comments/missing/replies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body: "follow-up" }),
            }),
        );
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe("Comment not found");
    });

    it("GET /api/diff short-circuits in PR mode and exposes PR metadata", async () => {
        await prStore.set({
            ...baseSession,
            diff: "diff --git a/zzz b/zzz\n+hello\n",
        });
        const res = await app.fetch(new Request("http://localhost/api/diff"));
        const body = await res.json();
        expect(body.prMode).toBe(true);
        expect(body.prRef).toBe("1234");
        expect(body.prOwner).toBe("acme");
        expect(body.prRepo).toBe("widget");
        expect(body.prPullNumber).toBe(1234);
        expect(body.prUrl).toBe(
            "https://github.com/ahmedragab20/diffing/pull/1234",
        );
        expect(body.patch).toBe("diff --git a/zzz b/zzz\n+hello\n");
        expect(body.branch).toBe("#1234");
        // Phase 1 PR overview banner: derived entirely from pr-session fields,
        // no extra git / gh calls.
        expect(body.overview).toBeDefined();
        expect(body.overview.kind).toBe("pr");
        expect(body.overview.headline).toBe("PR #1234: A test PR");
        expect(body.overview.subtitle).toBe("by octocat · +10 / -5");
        expect(body.overview.prNumber).toBe(1234);
        expect(body.overview.prTitle).toBe("A test PR");
        expect(body.overview.authors).toEqual(["octocat"]);
    });

    it("PR overview handles a session with no author and zero diffs", async () => {
        await prStore.set({
            ...baseSession,
            author: null,
            additions: 0,
            deletions: 0,
            diff: "diff --git a/empty b/empty\n",
        });
        const res = await app.fetch(new Request("http://localhost/api/diff"));
        const body = await res.json();
        expect(body.overview.kind).toBe("pr");
        expect(body.overview.headline).toBe("PR #1234: A test PR");
        // No author, no diff counts → no subtitle line.
        expect(body.overview.subtitle).toBeUndefined();
        expect(body.overview.authors).toEqual([]);
    });

    it("mutating /api/gh/* routes 404 when no PR session; session probe is soft 200", async () => {
        // Soft probe stays 200 + prMode:false even with empty store.
        const sessionRes = await app.fetch(
            new Request("http://localhost/api/gh/session"),
        );
        expect(sessionRes.status).toBe(200);
        expect((await sessionRes.json()).prMode).toBe(false);

        const checks: Array<{ path: string; method: string }> = [
            { path: "/api/gh/pr-session/comments", method: "GET" },
            // /api/gh/submit is POST-only; we only assert it 404s when no session exists.
            { path: "/api/gh/submit", method: "POST" },
        ];
        for (const { path, method } of checks) {
            const res = await app.fetch(
                new Request(`http://localhost${path}`, {
                    method,
                    headers:
                        method === "POST"
                            ? { "Content-Type": "application/json" }
                            : undefined,
                    body:
                        method === "POST"
                            ? JSON.stringify({ decision: "comment" })
                            : undefined,
                }),
            );
            expect(res.status).toBe(404);
        }
    });

    it("POST /api/gh/submit dryRun returns payload without marking submitted", async () => {
        await prStore.set({
            ...baseSession,
            comments: [
                {
                    id: "c1",
                    filePath: "src/x.ts",
                    side: "additions",
                    lineNumber: 1,
                    lineContent: "+ x",
                    body: "nit",
                    status: "open",
                    createdAt: 1000,
                    replies: [],
                },
            ],
        });
        const res = await app.fetch(
            new Request("http://localhost/api/gh/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    decision: "comment",
                    body: "overall",
                    dryRun: true,
                }),
            }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.dryRun).toBe(true);
        expect(body.payload).toBeDefined();
        expect(body.payload.event).toBe("COMMENT");
        expect(body.payload.comments).toHaveLength(1);
        // Must not stamp submittedAt on a dry run.
        const after = await prStore.get();
        expect(after?.submittedAt).toBeUndefined();
    });

    it("successful submission promotes local drafts into GitHub-backed conversations", async () => {
        const published = {
            ...baseSession.existingComments[0],
            id: 501,
            body: "published feedback",
            threadId: "PRRT_thread",
            isResolved: false,
        };
        const publishedReview = {
            id: 55,
            author: { login: "reviewer" },
            body: "Approved again buddy@",
            state: "APPROVED",
            submittedAt: "2026-07-18T20:00:00.000Z",
        };
        githubMocks.fetchExistingComments.mockResolvedValue([published]);
        githubMocks.fetchExistingReviews.mockResolvedValue([publishedReview]);
        await prStore.set({
            ...baseSession,
            comments: [{
                id: "c1",
                filePath: "src/x.ts",
                side: "additions",
                lineNumber: 1,
                lineContent: "+ x",
                body: "published feedback",
                status: "open",
                createdAt: 1000,
                replies: [],
            }],
        });

        const res = await app.fetch(new Request("http://localhost/api/gh/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: "comment", body: "" }),
        }));

        expect(res.status).toBe(200);
        const after = await prStore.get();
        expect(after?.comments).toEqual([]);
        expect(after?.existingComments).toEqual([published]);
        expect(after?.existingReviews).toEqual([publishedReview]);
        expect(after?.submittedAt).toEqual(expect.any(Number));
    });

    it("shows the overall review note immediately while GitHub review history is still catching up", async () => {
        githubMocks.fetchExistingReviews.mockResolvedValue([]);
        await prStore.set(baseSession);

        const res = await app.fetch(new Request("http://localhost/api/gh/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: "approve", body: "Approved again buddy@" }),
        }));

        expect(res.status).toBe(200);
        expect((await prStore.get())?.existingReviews?.[0]).toMatchObject({
            id: 55,
            body: "Approved again buddy@",
            state: "APPROVED",
            htmlUrl: "https://github.test/review/55",
        });
    });

    it("published comment actions update GitHub and refresh cached conversations", async () => {
        const synced = [{ ...baseSession.existingComments[0], body: "edited", isResolved: true }];
        githubMocks.fetchExistingComments.mockResolvedValue(synced);
        await prStore.set(baseSession);

        const edit = await app.fetch(new Request("http://localhost/api/gh/existing-comments/999", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: "edited" }),
        }));
        expect(edit.status).toBe(200);
        expect(githubMocks.updateComment).toHaveBeenCalledWith(expect.objectContaining({ commentId: 999, body: "edited" }));
        expect((await prStore.get())?.existingComments).toEqual(synced);

        const resolve = await app.fetch(new Request("http://localhost/api/gh/review-threads/PRRT_thread", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolved: true }),
        }));
        expect(resolve.status).toBe(200);
        expect(githubMocks.setThreadResolved).toHaveBeenCalledWith({ threadId: "PRRT_thread", resolved: true });

        const remove = await app.fetch(new Request("http://localhost/api/gh/existing-comments/999", { method: "DELETE" }));
        expect(remove.status).toBe(200);
        expect(githubMocks.deleteComment).toHaveBeenCalledWith(expect.objectContaining({ commentId: 999 }));
    });

    it("review sync hydrates overall reviews, removes published drafts, and preserves newer drafts", async () => {
        githubMocks.fetchExistingComments.mockResolvedValue(baseSession.existingComments);
        githubMocks.fetchExistingReviews.mockResolvedValue([{
            id: 77,
            author: { login: "reviewer" },
            body: "Overall approval note",
            state: "APPROVED",
            submittedAt: "2026-07-18T20:00:00.000Z",
        }]);
        await prStore.set({
            ...baseSession,
            submittedAt: 2000,
            comments: [
                {
                    id: "published-local",
                    filePath: "src/old.ts",
                    side: "additions",
                    lineNumber: 1,
                    lineContent: "+ old",
                    body: "already published",
                    status: "open",
                    createdAt: 1000,
                    replies: [],
                },
                {
                    id: "new-draft",
                    filePath: "src/new.ts",
                    side: "additions",
                    lineNumber: 2,
                    lineContent: "+ new",
                    body: "new review draft",
                    status: "open",
                    createdAt: 3000,
                    replies: [],
                },
            ],
        });

        const res = await app.fetch(new Request("http://localhost/api/gh/comments/sync", { method: "POST" }));
        expect(res.status).toBe(200);
        const synced = await prStore.get();
        expect(synced?.comments.map((comment) => comment.id)).toEqual(["new-draft"]);
        expect(synced?.existingReviews?.[0].body).toBe("Overall approval note");
    });

    it("PUT /api/gh/pr-session/comments/:id can resolve a draft comment locally", async () => {
        await prStore.set({
            ...baseSession,
            comments: [
                {
                    id: "c1",
                    filePath: "src/x.ts",
                    side: "additions",
                    lineNumber: 1,
                    lineContent: "",
                    body: "first",
                    status: "open",
                    createdAt: 1000,
                    replies: [],
                },
            ],
        });
        const res = await app.fetch(
            new Request("http://localhost/api/gh/pr-session/comments/c1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "resolved" }),
            }),
        );
        expect(res.status).toBe(200);
        const after = await prStore.get();
        expect(after?.comments[0].status).toBe("resolved");
    });
});
