// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Hono } from "hono";
import type { CommentStore } from "../lib/comments.js";
import { InMemoryPrSessionStore, type PrSession } from "../lib/pr-session.js";
import type { PlanStore } from "../lib/plans.js";

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
    async create() {
        throw new Error("not used");
    }
    async update() {
        return null;
    }
    async decide() {
        return null;
    }
    async reply() {
        return null;
    }
    async resolveReply() {
        return null;
    }
    async delete() {
        return false;
    }
    async resolveAllReplies() {}
    async clearAll() {}
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
    );
}

describe("gh-pr endpoints (integration)", () => {
    let app: Hono;
    let prStore: InMemoryPrSessionStore;

    beforeEach(async () => {
        vi.clearAllMocks();
        prStore = new InMemoryPrSessionStore();
        app = await makeApp(prStore);
    });

    it("GET /api/gh/session returns 404 when no session", async () => {
        const res = await app.fetch(
            new Request("http://localhost/api/gh/session"),
        );
        expect(res.status).toBe(404);
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
    });

    it("all /api/gh/* routes 404 when no PR session (local flow is byte-identical)", async () => {
        const checks: Array<{ path: string; method: string }> = [
            { path: "/api/gh/session", method: "GET" },
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
});
