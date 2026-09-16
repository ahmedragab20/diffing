// @vitest-environment node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const locations = vi.hoisted(() => ({
	home: "",
	repo: "",
	root: "",
}));
const watchers = vi.hoisted(() => new Set<{ close: () => void }>());

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: () => locations.home };
});

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		watch: (...args: Parameters<typeof actual.watch>) => {
			const watcher = actual.watch(...args);
			watcher.on("error", () => {});
			watchers.add(watcher);
			return watcher;
		},
	};
});

vi.mock("../lib/git.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/git.js")>();
	return {
		...actual,
		getRepoRoot: () => locations.repo,
		getProjectStorageDir: (customRoot?: string) =>
			actual.getProjectStorageDir(customRoot ?? locations.repo),
	};
});

type Snapshot = Record<string, string>;

async function snapshotTree(root: string): Promise<Snapshot> {
	const snapshot: Snapshot = {};
	async function visit(dir: string): Promise<void> {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				snapshot[relative(root, path) + "/"] = "<directory>";
				await visit(path);
				continue;
			}
			const bytes = await readFile(path);
			snapshot[relative(root, path)] = createHash("sha256")
				.update(bytes)
				.digest("hex");
		}
	}
	await visit(root);
	return snapshot;
}

function gitStatus(repo: string): Buffer {
	return execFileSync("git", ["-C", repo, "status", "--porcelain=v1"], {
		encoding: "buffer",
	});
}

function trackedPaths(repo: string): string[] {
	return execFileSync("git", ["-C", repo, "ls-files", "-z"], {
		encoding: "utf8",
	})
		.split("\0")
		.filter(Boolean);
}

describe("classic first-open adoption", () => {
	afterEach(async () => {
		for (const watcher of watchers) watcher.close();
		watchers.clear();
		if (locations.root) await rm(locations.root, { recursive: true, force: true });
		locations.home = "";
		locations.repo = "";
		locations.root = "";
		vi.restoreAllMocks();
	});

	it("keeps the repository byte-clean while comments survive a reopen", async () => {
		const root = await mkdtemp(join(tmpdir(), "diffing-adoption-"));
		locations.root = root;
		const repo = join(root, "repo");
		const home = join(root, "home");
		await mkdir(repo, { recursive: true });
		await mkdir(home, { recursive: true });
		execFileSync("git", ["init", "-q", repo]);
		await writeFile(join(repo, "README.md"), "review fixture\n");
		await writeFile(join(repo, "config.json"), '{"review":true}\n');
		await writeFile(join(repo, "hooks.txt"), "tracked hook policy fixture\n");
		await writeFile(join(repo, "policies.md"), "tracked review policy fixture\n");
		await writeFile(join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
		execFileSync("git", ["-C", repo, "add", "README.md", "config.json", "hooks.txt", "policies.md"]);
		execFileSync("git", [
			"-C",
			repo,
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"user.name=Diffing Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"-qm",
			"fixture",
		]);

		locations.home = home;
		locations.repo = repo;

		const before = await snapshotTree(repo);
		const statusBefore = gitStatus(repo);
		const { createApp } = await import("../server.js");
		const { InMemoryPlanStore } = await import("../lib/plans.js");
		const clientDir = resolve(process.cwd());
		const app = createApp(clientDir, undefined, undefined, new InMemoryPlanStore());

		const settings = await app.fetch(new Request("http://localhost/api/settings"));
		expect(settings.status).toBe(200);
		expect((await settings.json()).defaultMode).toBe("web");

		const commentsBefore = await app.fetch(
			new Request("http://localhost/api/comments"),
		);
		expect(commentsBefore.status).toBe(200);
		expect(await commentsBefore.json()).toEqual([]);

		const index = await app.fetch(new Request("http://localhost/"));
		expect(index.status).toBe(200);
		expect(await index.text()).toBe(await readFile(join(clientDir, "index.html"), "utf8"));

		const created = await app.fetch(
			new Request("http://localhost/api/comments", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filePath: "README.md",
					side: "additions",
					lineNumber: 1,
					lineContent: "review fixture",
					body: "kept after reopen",
				}),
			}),
		);
		expect(created.status).toBe(201);
		const comment = await created.json();

		const reopened = createApp(
			clientDir,
			undefined,
			undefined,
			new InMemoryPlanStore(),
		);
		const retained = await reopened.fetch(
			new Request("http://localhost/api/comments"),
		);
		expect(retained.status).toBe(200);
		expect(await retained.json()).toEqual([comment]);

		const after = await snapshotTree(repo);
		expect(after).toEqual(before);
		expect(gitStatus(repo)).toEqual(statusBefore);
		expect(trackedPaths(repo)).toEqual([
			"README.md",
			"config.json",
			"hooks.txt",
			"policies.md",
		]);
	});
});
