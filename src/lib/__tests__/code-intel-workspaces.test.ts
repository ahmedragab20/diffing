// @vitest-environment node
import { execFile as realExecFile, spawn as realSpawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("../ai/child-process.js", () => ({ spawn: mocks.spawn }));

import { CodeIntelWorkspaces, materializeCodeIntelArchive } from "../code-intel-workspaces.js";
import type { CodeIntelRequest } from "../code-intel.js";
import type { CodeIntelSource } from "../code-intel-source.js";
import type { DiffOptions } from "../diff-options.js";
import type { PrSession } from "../pr-session.js";

const execFile = promisify(realExecFile);
const ROOT = await mkdtemp(join(tmpdir(), "code-intel-workspaces-repo-"));
const STORAGE = await mkdtemp(join(tmpdir(), "code-intel-workspaces-storage-"));

let rootCommit = "";
let sideCommit = "";
let headCommit = "";
let renamedCommit = "";
let deletedCommit = "";

const git = async (...args: string[]) => {

  const result = await execFile("git", args, { cwd: ROOT, encoding: "utf8" });
  return String(result.stdout).trim();
};

const write = async (path: string, contents: string) => {

  const absolute = join(ROOT, path);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, contents);
};

const options = (overrides: Partial<DiffOptions> = {}) => ({
  revisions: [], staged: false, merge: false, pathspecs: [],
  indentHeuristic: true, noIndentHeuristic: false, functionContext: false,
  ignoreSpaceChange: false, ignoreAllSpace: false, ignoreBlankLines: false,
  ignoreCrAtEol: false, findCopiesHarder: false, noRenames: false,
  base: false, ours: false, theirs: false, patchWithRaw: false,
  patchWithStat: false, compactSummary: false, cumulative: false,
  pickaxeAll: false, exitCode: false, quiet: false, suppressPatch: false,
  binary: false, fullIndex: false, text: false, textconv: false,
  noExtDiff: false, itaVisible: false, check: false, outputMode: "web",
  host: "127.0.0.1", noOpen: true, insecureNoAuth: false,
  ...overrides,
} as DiffOptions);

const request = (overrides: Partial<CodeIntelRequest> = {}): CodeIntelRequest => ({
  op: "hover", path: "src/a.ts", side: "additions", line: 1, character: 0,
  ...overrides,
});

const lookup = async (
  opts: Partial<DiffOptions> = {},
  req: Partial<CodeIntelRequest> = {},
  source?: CodeIntelSource,
) => {

  const workspaces = new CodeIntelWorkspaces(
    ROOT,
    STORAGE,
    { ts: { command: "synthetic-lsp", args: [] } },
  );
  try {
    return await workspaces.lookup(options(opts), request(req), source);
  } finally {
    await workspaces.close();
  }
};

const archiveEntry = (path: string, body: string, type = "0") => {

  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  header.write("0000644", 100, 8, "ascii");
  header.write("0000000", 108, 8, "ascii");
  header.write("0000000", 116, 8, "ascii");
  header.write(body.length.toString(8).padStart(11, "0") + " ", 124, 12, "ascii");
  header.write("00000000000 ", 136, 12, "ascii");
  header.write("        ", 148, 8, "ascii");
  header.write(type, 156, 1, "ascii");
  header.write("ustar", 257, 5, "ascii");
  for (let index = 0; index < 8; index++) header[148 + index] = 32;
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  const data = Buffer.from(body);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
};

const syntheticServer = `
let buffer = Buffer.alloc(0);
let opened = '';
const send = (message) => {
  const body = JSON.stringify(message);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
};
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const split = buffer.indexOf('\\r\\n\\r\\n');
    if (split === -1) return;
    const match = /content-length:\\s*(\\d+)/i.exec(buffer.slice(0, split).toString());
    if (!match) return;
    const length = Number(match[1]);
    const start = split + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(buffer.slice(start, start + length).toString());
    buffer = buffer.slice(start + length);
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } });
    } else if (message.method === 'textDocument/didOpen') {
      opened = message.params.textDocument.text;
    } else if (message.method === 'textDocument/hover') {
      send({ jsonrpc: '2.0', id: message.id, result: { contents: { kind: 'markdown', value: opened } } });
    }
  }
});
`;

beforeAll(async () => {
  await git("init", "-b", "main");
  await git("config", "user.email", "tests@example.invalid");
  await git("config", "user.name", "Code Intel Tests");
  await write("package.json", '{"name":"code-intel-fixture","version":"1.0.0"}\n');
  await write("src/a.ts", 'export const value = "root";\n');
  await git("add", ".");
  await git("commit", "-m", "root");
  rootCommit = await git("rev-parse", "HEAD");

  await git("checkout", "-b", "side");
  await write("src/a.ts", 'export const value = "side";\n');
  await git("add", ".");
  await git("commit", "-m", "side");
  sideCommit = await git("rev-parse", "HEAD");

  await git("checkout", "main");
  await write("src/a.ts", 'export const value = "head";\n');
  await git("add", ".");
  await git("commit", "-m", "head");
  headCommit = await git("rev-parse", "HEAD");
  await git("mv", "src/a.ts", "src/renamed.ts");
  await git("commit", "-am", "rename");
  renamedCommit = await git("rev-parse", "HEAD");
  await git("rm", "src/renamed.ts");
  await git("commit", "-m", "delete");
  deletedCommit = await git("rev-parse", "HEAD");

  await git("checkout", "--detach", headCommit);
  await write("src/a.ts", 'export const value = "index";\n');
  await git("add", "src/a.ts");
  await write("src/a.ts", 'export const value = "working";\n');
});

beforeEach(() => {
  mocks.spawn.mockImplementation(() => realSpawn(process.execPath, ["-e", syntheticServer], {
    stdio: ["pipe", "pipe", "pipe"],
  }));
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await rm(STORAGE, { recursive: true, force: true });
});

describe("CodeIntelWorkspaces", () => {
  it("uses the captured index after the live index changes", async () => {
    const workspaces = new CodeIntelWorkspaces(ROOT, STORAGE, { ts: { command: "synthetic-lsp", args: [] } });
    const captured = await workspaces.captureSource(options({ staged: true }), { kind: "staged" });
    await write("src/a.ts", 'export const value = "mutated-index";\n');
    await git("add", "src/a.ts");
    try {
      const result = await workspaces.lookup(
        options({ staged: true }),
        request({ side: "additions" }),
        captured,
      );
      expect(captured.indexRevision).toMatch(/^[a-f0-9]{64}$/);
      expect(result).toEqual({ available: true, op: "hover", hover: 'export const value = "index";' });
    } finally {
      await write("src/a.ts", 'export const value = "index";\n');
      await git("add", "src/a.ts");
      await write("src/a.ts", 'export const value = "working";\n');
      await workspaces.close();
    }
  });

  it("uses working additions and index deletions", async () => {
    const addition = await lookup({}, { side: "additions" });
    const deletion = await lookup({}, { side: "deletions" });
    expect(addition).toEqual({ available: true, op: "hover", hover: 'export const value = "working";' });
    expect(deletion).toEqual({ available: true, op: "hover", hover: 'export const value = "index";' });
  });

  it("uses staged additions and HEAD deletions", async () => {
    const addition = await lookup({ staged: true }, { side: "additions" });
    const deletion = await lookup({ staged: true }, { side: "deletions" });
    expect(addition).toEqual({ available: true, op: "hover", hover: 'export const value = "index";' });
    expect(deletion).toEqual({ available: true, op: "hover", hover: 'export const value = "head";' });
  });

  it("uses the current working tree for a single revision", async () => {
    const result = await lookup({ revisions: [rootCommit] });
    expect(result).toEqual({ available: true, op: "hover", hover: 'export const value = "working";' });
  });

  it("uses the two selected revisions", async () => {
    const old = await lookup({ revisions: [rootCommit, headCommit] }, { side: "deletions" });
    const current = await lookup({ revisions: [rootCommit, headCommit] }, { side: "additions" });
    expect(old).toEqual({ available: true, op: "hover", hover: 'export const value = "root";' });
    expect(current).toEqual({ available: true, op: "hover", hover: 'export const value = "head";' });
  });

  it("uses the merge base for a triple-dot revision", async () => {
    const old = await lookup({ revisions: [`${sideCommit}...${headCommit}`] }, { side: "deletions" });
    const current = await lookup({ revisions: [`${sideCommit}...${headCommit}`] }, { side: "additions" });
    expect(old).toEqual({ available: true, op: "hover", hover: 'export const value = "root";' });
    expect(current).toEqual({ available: true, op: "hover", hover: 'export const value = "head";' });
  });

  it("selects old and new sides of commits, including the root commit", async () => {
    const root = await lookup({}, { path: "src/a.ts" }, { kind: "commit", revision: rootCommit });
    const headOld = await lookup({}, { path: "src/a.ts", side: "deletions" }, { kind: "commit", revision: headCommit });
    expect(root).toEqual({ available: true, op: "hover", hover: 'export const value = "root";' });
    expect(headOld).toEqual({ available: true, op: "hover", hover: 'export const value = "root";' });
  });

  it("reads old renamed and deleted paths from their historical sources", async () => {
    const renamed = await lookup(
      { revisions: [headCommit, renamedCommit] },
      { path: "src/a.ts", side: "deletions" },
    );
    const deleted = await lookup(
      { revisions: [renamedCommit, deletedCommit] },
      { path: "src/renamed.ts", side: "deletions" },
    );
    expect(renamed).toEqual({ available: true, op: "hover", hover: 'export const value = "head";' });
    expect(deleted).toEqual({ available: true, op: "hover", hover: 'export const value = "head";' });
  });

  it("refuses mutating operations for historical and index sources", async () => {
    const historical = await lookup(
      { revisions: [rootCommit, headCommit] },
      { op: "rename", side: "additions" },
    );
    const index = await lookup({ staged: true }, { op: "format", side: "additions" });
    expect(historical).toEqual({ available: false, reason: "read-only" });
    expect(index).toEqual({ available: false, reason: "read-only" });
  });

  it("removes materialized source roots on close", async () => {
    const workspaces = new CodeIntelWorkspaces(ROOT, STORAGE, { ts: { command: "synthetic-lsp", args: [] } });
    const result = await workspaces.lookup(options({ revisions: [rootCommit] }), request({ side: "deletions" }));
    expect(result.available).toBe(true);
    expect((await readdir(STORAGE)).some((entry) => entry.startsWith("code-intel-"))).toBe(true);
    await workspaces.close();
    expect(await readdir(STORAGE)).toEqual([]);
  });

  it("uses injected PR archives for both sides and selected commit parents", async () => {
    const archives = new Map([
      ["base", Buffer.concat([archiveEntry("owner-repo-base/src/a.ts", 'export const value = "base";\n'), Buffer.alloc(1024)])],
      ["head", Buffer.concat([archiveEntry("owner-repo-head/src/a.ts", 'export const value = "head";\n'), Buffer.alloc(1024)])],
    ]);
    const loaded: string[] = [];
    const loader = async (_session: PrSession, revision: string) => {
      loaded.push(revision);
      const archive = archives.get(revision);
      if (!archive) throw new Error(`missing archive ${revision}`);
      return archive;
    };
    const pr = {
      ref: "owner/repo#1", owner: "owner", repo: "repo", pullNumber: 1,
      headSha: "head", baseSha: "base", mergeBaseSha: "base", title: "fixture",
      url: "https://github.com/owner/repo/pull/1", author: null, additions: 1,
      deletions: 1, changedFiles: 1, diff: "", comments: [], existingComments: [],
    } as PrSession;
    const workspaces = new CodeIntelWorkspaces(ROOT, STORAGE, { ts: { command: "synthetic-lsp", args: [] } }, loader);
    try {
      const additions = await workspaces.lookup(options(), request({ side: "additions" }), undefined, pr);
      const deletions = await workspaces.lookup(options(), request({ side: "deletions" }), undefined, pr);
      const readNew = await workspaces.readSource(options(), "src/a.ts", "additions", undefined, pr);
      const readOld = await workspaces.readSource(options(), "src/a.ts", "deletions", undefined, pr);
      const selected = { kind: "commit", revision: "head", parentRevision: "base" } as CodeIntelSource;
      const selectedOld = await workspaces.lookup(options(), request({ side: "deletions" }), selected, pr);
      const selectedNew = await workspaces.lookup(options(), request({ side: "additions" }), selected, pr);
      expect(additions).toEqual({ available: true, op: "hover", hover: 'export const value = "head";' });
      expect(deletions).toEqual({ available: true, op: "hover", hover: 'export const value = "base";' });
      expect(readNew?.toString()).toBe('export const value = "head";\n');
      expect(readOld?.toString()).toBe('export const value = "base";\n');
      expect(selectedOld).toEqual({ available: true, op: "hover", hover: 'export const value = "base";' });
      expect(selectedNew).toEqual({ available: true, op: "hover", hover: 'export const value = "head";' });
      expect(loaded).toEqual(["head", "base"]);
    } finally {
      await workspaces.close();
    }
  });
});

describe("materializeCodeIntelArchive", () => {
  it("materializes regular files and skips symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-intel-archive-"));
    try {
      const archive = Buffer.concat([
        archiveEntry("safe/file.ts", "export const value = 1;\n"),
        archiveEntry("link.ts", "safe/file.ts", "2"),
        Buffer.alloc(1024),
      ]);
      await materializeCodeIntelArchive(archive, root);
      await expect(readFile(join(root, "safe/file.ts"), "utf8")).resolves.toBe("export const value = 1;\n");
      await expect(readFile(join(root, "link.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-intel-archive-"));
    try {
      const archive = Buffer.concat([archiveEntry("../outside.ts", "unsafe\n"), Buffer.alloc(1024)]);
      await expect(materializeCodeIntelArchive(archive, root)).rejects.toThrow("Unsafe source archive path");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["/owner-repo/src/a.ts", "../owner-repo/src/a.ts"])(
    "rejects an unsafe original archive path when stripping a root: %s",
    async (path) => {
      const root = await mkdtemp(join(tmpdir(), "code-intel-archive-"));
      try {
        const archive = Buffer.concat([archiveEntry(path, "unsafe\n"), Buffer.alloc(1024)]);
        await expect(materializeCodeIntelArchive(archive, root, true)).rejects.toThrow("Unsafe source archive path");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
