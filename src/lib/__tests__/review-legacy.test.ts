import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileCommentStore } from "../comments.js";
import {
  LegacyProjection,
  decodeLegacyArchive,
  encodeLegacyArchive,
  readLegacyArchive,
} from "../review-legacy.js";

const comment = {
  id: "comment-1",
  filePath: "src/example.ts",
  side: "additions" as const,
  lineNumber: 3,
  lineContent: "const value = café ☕",
  body: "Keep this comment — مُلاحظة",
  status: "open" as const,
  createdAt: 100,
  replies: [],
  unknownCommentField: { preserved: true },
};

const plans = [{
  id: "plan-1",
  title: "Legacy plan",
  body: "Plan body — خطة",
  createdAt: 100,
  decision: "pending" as const,
  comments: [],
  unknownPlanField: "preserved",
}];

const viewed = {
  "local": {
    headSha: "head-1",
    fingerprints: { "src/example.ts": "fingerprint-1" },
    files: { "src/example.ts": "fingerprint-1" },
    unknownViewedField: 7,
  },
};

async function fixtureDirectory(files: Record<string, string | Uint8Array>) {
  const directory = await mkdtemp(join(tmpdir(), "diffing-legacy-"));
  for (const [name, contents] of Object.entries(files)) await writeFile(join(directory, name), contents);
  return directory;
}

async function archiveFor(directory: string) {
  return encodeLegacyArchive(await readLegacyArchive(directory));
}

describe("legacy archive migration", () => {
  it("reads old native reply timestamps without changing the recovery archive", async () => {
    const reply = { id: "native-reply", body: "kept", created_at: 123, role: "agent", actor: { id: "descriptive", kind: "agent" } };
    const original = JSON.stringify([{ ...comment, replies: [reply] }], null, 2) + "\n";
    const directory = await fixtureDirectory({ "comments.json": original });
    try {
      const archive = await readLegacyArchive(directory);
      const decoded = decodeLegacyArchive(archive);
      expect(decoded.comments[0].replies).toEqual([{ id: reply.id, body: reply.body, createdAt: 123, role: reply.role, actor: reply.actor }]);
      expect(Buffer.from(archive.sources[0].base64, "base64").toString("utf8")).toBe(original);
      expect(await readFile(join(directory, "comments.json"), "utf8")).toBe(original);
      const store = new FileCommentStore(directory);
      expect((await store.getAll())[0].replies).toEqual(decoded.comments[0].replies);
      await store.update(comment.id, { body: "edited in web" });
      const saved = JSON.parse(await readFile(join(directory, "comments.json"), "utf8"));
      expect(saved[0].replies).toEqual(decoded.comments[0].replies);
      expect(Buffer.from(archive.sources[0].base64, "base64").toString("utf8")).toBe(original);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("refuses conflicting native and web reply timestamps without rewriting the source", async () => {
    const original = JSON.stringify([{ ...comment, replies: [{ id: "ambiguous", body: "kept", createdAt: 1, created_at: 2 }] }]);
    const directory = await fixtureDirectory({ "comments.json": original });
    try {
      await expect(readLegacyArchive(directory)).rejects.toThrow();
      await expect(new FileCommentStore(directory).getAll()).rejects.toThrow();
      expect(await readFile(join(directory, "comments.json"), "utf8")).toBe(original);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("preserves exact UTF-8 source bytes, unknown fields, stable IDs, and missing plan versions", async () => {
    const files = {
      "comments.json": JSON.stringify([comment], null, 2) + "\n",
      "plans.json": JSON.stringify(plans, null, 2) + "\n",
      "viewed.json": JSON.stringify(viewed, null, 1) + "\n",
    };
    const directory = await fixtureDirectory(files);
    try {
      const archive = await readLegacyArchive(directory);
      expect(archive.sources.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }))).toHaveLength(3);
      for (const [name, contents] of Object.entries(files)) {
        const source = archive.sources.find((candidate) => candidate.name === name);
        expect(source?.bytes).toBe(Buffer.byteLength(contents));
        expect(Buffer.from(source!.base64, "base64")).toEqual(Buffer.from(contents));
      }
      const decoded = decodeLegacyArchive(archive);
      expect(decoded.comments).toEqual([comment]);
      expect(decoded.plans).toEqual(plans);
      expect(decoded.plans[0]).not.toHaveProperty("versions");
      expect(decoded.viewed).toEqual(viewed);
      expect(encodeLegacyArchive(archive).id).toBe(encodeLegacyArchive(await readLegacyArchive(directory)).id);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("omits absent stores and rejects malformed, invalid, duplicate, and invalid UTF-8 stores without changing bytes", async () => {
    const cases: Array<[string, string | Uint8Array]> = [
      ["comments.json", "{"],
      ["comments.json", JSON.stringify([{ ...comment, body: 4 }])],
      ["plans.json", JSON.stringify([{ ...plans[0], id: "" }])],
      ["viewed.json", JSON.stringify({ local: { files: "bad" } })],
      ["comments.json", JSON.stringify([comment, { ...comment }])],
      ["comments.json", JSON.stringify([{ ...comment, replies: [
        { id: "same-reply", body: "first author", createdAt: 1 },
        { id: "same-reply", body: "second author", createdAt: 2 },
      ] }])],
      ["comments.json", new Uint8Array([0xc3, 0x28])],
    ];
    const absent = await fixtureDirectory({});
    try { expect((await readLegacyArchive(absent)).sources).toEqual([]); } finally { await rm(absent, { recursive: true, force: true }); }
    for (const [name, contents] of cases) {
      const directory = await fixtureDirectory({ [name]: contents });
      try {
        const before = await readFile(join(directory, name));
        await expect(readLegacyArchive(directory)).rejects.toThrow();
        await expect(readFile(join(directory, name))).resolves.toEqual(before);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("rejects same-length tampering by digest and noncanonical base64", async () => {
    const directory = await fixtureDirectory({ "comments.json": JSON.stringify([comment]) });
    try {
      const archive = await readLegacyArchive(directory);
      const source = archive.sources[0];
      const tampered = Buffer.from(source.base64, "base64");
      tampered[0] ^= 1;
      expect(() => decodeLegacyArchive({ ...archive, sources: [{ ...source, base64: tampered.toString("base64") }] })).toThrow();
      expect(() => decodeLegacyArchive({ ...archive, sources: [{ ...source, base64: `${source.base64}=` }] })).toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("keeps projection invisible until commit, then exposes complete decoded contents", async () => {
    const largeComment = { ...comment, body: "x".repeat(60 * 1024) };
    const directory = await fixtureDirectory({ "comments.json": JSON.stringify([largeComment]) });
    try {
      const input = await readLegacyArchive(directory);
      const encoded = encodeLegacyArchive(input);
      expect(encoded.chunks.length).toBeGreaterThan(1);
      const projection = new LegacyProjection();
      for (let index = 0; index < encoded.chunks.length; index++) {
        projection.apply({ type: "legacy.chunk", id: encoded.id, index, total: encoded.chunks.length, base64: encoded.chunks[index] });
        expect(projection.summary).toBeNull();
        expect(projection.archive).toBeNull();
      }
      projection.apply({ type: "legacy.committed", id: encoded.id });
      expect(projection.archive).toEqual(input);
      expect(projection.summary).toMatchObject({ id: encoded.id, comments: 1, plans: 0, viewedScopes: 0 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects missing or reordered chunks, wrong IDs, and duplicate commits", async () => {
    const directory = await fixtureDirectory({ "comments.json": JSON.stringify([{ ...comment, body: "x".repeat(60 * 1024) }]) });
    try {
      const { id, chunks } = await archiveFor(directory);
      expect(chunks.length).toBeGreaterThan(1);
      const effect = (index: number, chunkId = id) => ({ type: "legacy.chunk" as const, id: chunkId, index, total: chunks.length, base64: chunks[index] });
      const reordered = new LegacyProjection();
      expect(() => reordered.apply(effect(1))).toThrow();
      const wrongId = new LegacyProjection();
      wrongId.apply(effect(0));
      expect(() => wrongId.apply(effect(1, "0".repeat(64)))).toThrow();
      const missing = new LegacyProjection();
      missing.apply(effect(0));
      expect(() => missing.apply({ type: "legacy.committed", id })).toThrow();
      const complete = new LegacyProjection();
      chunks.forEach((base64, index) => complete.apply({ type: "legacy.chunk", id, index, total: chunks.length, base64 }));
      complete.apply({ type: "legacy.committed", id });
      expect(() => complete.apply({ type: "legacy.committed", id })).toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects a source larger than 8 MiB", async () => {
    const directory = await fixtureDirectory({ "comments.json": Buffer.alloc(8 * 1024 * 1024 + 1, 0x20) });
    try { await expect(readLegacyArchive(directory)).rejects.toThrow("store_limit"); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
