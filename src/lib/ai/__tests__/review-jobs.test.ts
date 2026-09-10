import { describe, expect, it, vi } from "vitest";
import { MAX_AI_CONTEXT_BYTES } from "../context.js";
import { createReviewCapture } from "../review-capture.js";
import {
  ReviewJob,
  ReviewJobStore,
  REVIEW_JOB_LIMITS,
} from "../review-jobs.js";
import { AiService } from "../service.js";
import { AiRunError } from "../lifecycle.js";
import {
  AiSnapshotError,
  sourceHash,
  type SnapshotSourceInput,
} from "../snapshots.js";
import { parseAiRunEvent } from "../run-events.js";
import type { AiBackendAdapter, AiRunRequest } from "../types.js";

const identity = {
  kind: "local" as const,
  repositoryId: "repo",
  mode: "working" as const,
  baseSha: null,
  headSha: null,
  indexHash: null,
  patchHash: "",
};
const one = (path: string, n = 1) =>
  `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old${n}\n+new${n}\n`;
const request = (
  conversationId = "test",
  modelId = "openai/direct-key/openai/test",
): AiRunRequest => ({
  trigger: "user",
  conversationId,
  modelId,
  surface: "diff",
  action: "review-risks",
  context: { kind: "diff" },
});
const source = (
  path: string,
  side: "old" | "new",
  n: number,
): SnapshotSourceInput => ({
  key: `${side}:${path}`,
  path,
  side,
  revision: side === "old" ? "HEAD" : "worktree",
  content: `${side}${n}\n`,
  complete: true,
  provenance: "recorded",
  representation: "original",
});
function fixture(count = 4) {
  const patch = Array.from({ length: count }, (_, i) =>
    one(`src/${String.fromCharCode(97 + i)}.ts`, i + 1),
  ).join("");
  const originals = Array.from({ length: count }, (_, i) => [
    `src/${String.fromCharCode(97 + i)}.ts`,
    i + 1,
  ]).flatMap(([path, n]) => [
    source(path as string, "old", n as number),
    source(path as string, "new", n as number),
  ]);
  const fullCapture = {
    identity: { ...identity, patchHash: sourceHash(patch) },
    patch,
    omissions: [],
    originals,
  };
  const capture = createReviewCapture(
    fullCapture,
    async (paths) => ({
      ...fullCapture,
      originals: originals.filter((item) => paths.includes(item.path)),
    }),
    async () => {},
    "/repo",
  );
  return { patch, originals, fullCapture, capture };
}
async function run(
  job: ReviewJob,
  confirmed: boolean,
  call: (request: AiRunRequest) => Promise<string>,
  signal = new AbortController().signal,
) {
  const statuses: ReturnType<ReviewJob["status"]>[] = [];
  const result = await job.run(confirmed, signal, call, async (status) => {
    statuses.push(status);
  });
  return { result, statuses };
}
const empty = () => JSON.stringify({ findings: [], questions: [] });
function serviceAdapter(run: AiBackendAdapter["run"]): AiBackendAdapter {
  return {
    id: "openai",
    connection: async () => ({
      id: "openai",
      label: "OpenAI",
      status: "connected",
      runtimeAvailable: true,
      credentialRoutes: ["direct-key"],
      activeRoutes: ["direct-key"],
    }),
    models: async () => [
      {
        id: "openai/direct-key/openai/test",
        sourceId: "openai",
        credentialRoute: "direct-key",
        providerId: "openai",
        modelId: "test",
        displayName: "Test",
      },
    ],
    run,
  };
}

describe("bounded review jobs", () => {
  it("waits for confirmation, then completes four hunks in two batches plus cross-file synthesis", async () => {
    const { capture } = fixture();
    const requests: AiRunRequest[] = [];
    const job = new ReviewJob(request(), capture);
    const waiting = await run(job, false, async (r) => {
      requests.push(r);
      return empty();
    });
    expect(waiting.statuses.at(-1)?.state).toBe("awaiting-confirmation");
    expect(requests).toHaveLength(0);
    const done = await run(job, true, async (r) => {
      requests.push(r);
      return empty();
    });
    expect(requests).toHaveLength(3);
    expect(done.statuses.at(-1)?.state).toBe("complete");
    expect(done.statuses.at(-1)?.pendingGroups).toBe(0);
    expect(requests[2].reviewInstruction).toContain("cross-file interactions");
    expect(requests[2].evidence?.length).toBeGreaterThan(0);
    expect(
      requests.every(
        (r) => Buffer.byteLength(r.prompt ?? "") <= MAX_AI_CONTEXT_BYTES,
      ),
    ).toBe(true);
    expect(
      requests.every(
        (r) => !r.history && !(r.prompt ?? "").includes("previous transcript"),
      ),
    ).toBe(true);
    expect(done.result).toContain("not model attention or correctness");
  });

  it("retains validated anchors through synthesis and supplies notes/current evidence", async () => {
    const { capture } = fixture();
    const requests: AiRunRequest[] = [];
    let firstId = "";
    const job = new ReviewJob(request(), capture);
    await run(job, true, async (r) => {
      requests.push(r);
      if (!firstId) {
        firstId = r.evidence?.[0].id ?? "";
        return JSON.stringify({
          findings: [
            { title: "Risk", body: "Concrete risk", evidenceIds: [firstId] },
          ],
          questions: [],
        });
      }
      if (requests.length < 3) return empty();
      const current =
        r.evidence?.find((e) => e.id === firstId)?.id ?? r.evidence?.[0].id;
      expect(r.reviewNotes).toContain("Concrete risk");
      expect(r.snapshotReader).toBeDefined();
      expect(r.evidence?.map((e) => e.id)).toContain(current);
      return JSON.stringify({
        findings: [
          { title: "Risk", body: "Concrete risk", evidenceIds: [current] },
        ],
        questions: [],
      });
    });
    expect(requests).toHaveLength(3);
    expect(requests.at(-1)?.reviewNotes).toContain("Concrete risk");
    expect(requests.at(-1)?.prompt?.length).toBeLessThanOrEqual(
      MAX_AI_CONTEXT_BYTES,
    );
  });

  it("rejects unknown evidence, marks failed, and only retries on explicit continuation", async () => {
    const { capture } = fixture();
    const calls: AiRunRequest[] = [];
    const job = new ReviewJob(request(), capture);
    const bad = JSON.stringify({
      findings: [
        {
          title: "bad",
          body: "bad",
          evidenceIds: ["00000000-0000-4000-8000-000000000000"],
        },
      ],
      questions: [],
    });
    await expect(
      run(job, true, async (r) => {
        calls.push(r);
        return bad;
      }),
    ).rejects.toBeInstanceOf(AiSnapshotError);
    expect(job.status().processedHunks).toBe(0);
    expect(job.status().state).toBe("failed");
    await expect(
      run(job, true, async (r) => {
        calls.push(r);
        return bad;
      }),
    ).rejects.toBeInstanceOf(AiSnapshotError);
    expect(calls).toHaveLength(2);
  });

  it("caps six groups at four calls and completes the remainder on explicit continuation", async () => {
    const { capture } = fixture(12);
    const calls: AiRunRequest[] = [];
    const job = new ReviewJob(request(), capture);
    const first = await run(job, true, async (r) => {
      calls.push(r);
      return empty();
    });
    expect(calls).toHaveLength(4);
    expect(first.statuses.at(-1)?.state).toBe("partial");
    expect(first.statuses.at(-1)?.canContinue).toBe(true);
    const firstEvidence = new Set(
      calls.flatMap((r) => r.evidence?.map((e) => e.id) ?? []),
    );
    await run(job, true, async (r) => {
      calls.push(r);
      return empty();
    });
    expect(calls).toHaveLength(7);
    expect(job.status().state).toBe("complete");
    expect(
      calls
        .slice(4, 6)
        .flatMap((r) => r.evidence?.map((e) => e.id) ?? [])
        .some((id) => firstEvidence.has(id)),
    ).toBe(false);
  });

  it("stops on stale capture and cancellation before any provider call", async () => {
    const f = fixture();
    let checks = 0;
    const stale = createReviewCapture(
      f.fullCapture,
      async (paths) => ({
        ...f.fullCapture,
        originals: f.originals.filter((s) => paths.includes(s.path)),
      }),
      async () => {
        if (++checks > 5) throw new AiSnapshotError("stale");
      },
      "/repo",
    );
    const staleJob = new ReviewJob(request(), stale);
    let calls = 0;
    await expect(
      staleJob.run(
        true,
        new AbortController().signal,
        async () => {
          calls++;
          return empty();
        },
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "stale" });
    expect(staleJob.status().state).toBe("stale");
    expect(calls).toBe(1);
    const controller = new AbortController();
    controller.abort();
    const aborted = new ReviewJob(request("aborted"), fixture().capture);
    await expect(
      aborted.run(
        true,
        controller.signal,
        async () => {
          calls++;
          return empty();
        },
        async () => {},
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("enforces store identity/TTL and the 32-call total limit", async () => {
    vi.useFakeTimers();
    try {
      const store = new ReviewJobStore();
      const f = fixture();
      const job = store.create(request(), f.capture);
      expect(() => store.get(job.id, request("other"))).toThrowError(
        AiSnapshotError,
      );
      expect(() =>
        store.get(job.id, request("test", "other/model")),
      ).toThrowError(AiSnapshotError);
      vi.advanceTimersByTime(REVIEW_JOB_LIMITS.ttlMs + 1);
      expect(() => store.get(job.id, request())).toThrowError(AiSnapshotError);
    } finally {
      vi.useRealTimers();
    }
    const job = new ReviewJob(request("limit"), fixture().capture);
    let calls = 0;
    for (let i = 0; i < REVIEW_JOB_LIMITS.totalCalls; i++)
      await expect(
        job.run(
          true,
          new AbortController().signal,
          async () => {
            calls++;
            throw new Error("provider");
          },
          async () => {},
        ),
      ).rejects.toThrow("provider");
    await expect(
      job.run(
        true,
        new AbortController().signal,
        async () => {
          calls++;
          throw new Error("unexpected");
        },
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "limit" });
    expect(calls).toBe(REVIEW_JOB_LIMITS.totalCalls);
    expect(job.status().state).toBe("exhausted");
  });

  it("integrates bounded review through AiService without exposing provider JSON", async () => {
    const f = fixture(2);
    const inputs: AiRunRequest[] = [];
    const adapter = serviceAdapter(async (input, _signal, emit) => {
      inputs.push(input);
      await emit({ type: "text-delta", text: empty() });
      return empty();
    });
    const service = new AiService([adapter]);
    const events: string[] = [];
    const text = await service.run(
      {
        ...request("service", "openai/direct-key/openai/test"),
        reviewCapture: f.capture,
        reviewConfirmed: true,
      },
      (event) => {
        events.push(event.type);
      },
    );
    expect(inputs).toHaveLength(1);
    expect(events.filter((e) => e === "start")).toHaveLength(1);
    expect(events.filter((e) => e === "review-status")).toContain(
      "review-status",
    );
    expect(events.filter((e) => e === "complete")).toHaveLength(1);
    expect(events).not.toContain("text-delta");
    expect(text).toContain("2/2");
    for (const input of inputs)
      for (const key of [
        "snapshotReader",
        "reviewCapture",
        "reviewInstruction",
        "reviewNotes",
        "evidenceRanges",
        "promptBudget",
        "reviewJobId",
      ] as const)
        expect(input[key]).toBeUndefined();
  });

  it("continues an unconfirmed service review with the retained job", async () => {
    const f = fixture(4);
    let calls = 0;
    const adapter = serviceAdapter(async () => {
      calls++;
      return empty();
    });
    const service = new AiService([adapter]);
    const firstEvents: Array<{
      type: string;
      review?: { jobId: string; state: string };
    }> = [];
    const first = await service.run(
      {
        ...request("continuation", "openai/direct-key/openai/test"),
        reviewCapture: f.capture,
      },
      (event) => {
        firstEvents.push(event as (typeof firstEvents)[number]);
      },
    );
    const status = firstEvents.find(
      (event) =>
        event.type === "review-status" &&
        event.review?.state === "awaiting-confirmation",
    );
    expect(calls).toBe(0);
    expect(status?.review?.jobId).toBeTruthy();
    expect(firstEvents.filter((e) => e.type === "review-status")).toHaveLength(
      1,
    );
    const secondEvents: string[] = [];
    const second = await service.run(
      {
        ...request("continuation", "openai/direct-key/openai/test"),
        reviewJobId: status!.review!.jobId,
        reviewConfirmed: true,
      },
      (event) => {
        secondEvents.push(event.type);
      },
    );
    expect(calls).toBe(3);
    expect(second).toContain("4/4");
    expect(secondEvents.filter((e) => e === "complete")).toHaveLength(1);
  });

  it("cancels before adapter invocation and releases service capacity", async () => {
    let service!: AiService;
    let calls = 0;
    let runId = "";
    const adapter = serviceAdapter(async (_input, signal) => {
      calls++;
      if (signal.aborted) throw new AiRunError("cancelled");
      return empty();
    });
    service = new AiService([adapter]);
    const events: string[] = [];
    await expect(
      service.run(
        {
          ...request("cancel", "openai/direct-key/openai/test"),
          reviewCapture: fixture(1).capture,
          reviewConfirmed: true,
        },
        (event) => {
          events.push(event.type);
          if (event.type === "start") {
            runId = event.runId;
            service.cancel(runId);
          }
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
    expect(events).not.toContain("complete");
    await expect(
      service.run(
        {
          ...request("fresh", "openai/direct-key/openai/test"),
          reviewCapture: fixture(1).capture,
          reviewConfirmed: true,
        },
        () => {},
      ),
    ).resolves.toContain("1/1");
  });

  it("validates review status counters", () => {
    const review = {
      jobId: "00000000-0000-4000-8000-000000000000",
      state: "partial",
      estimatedBatches: 1,
      completedBatches: 1,
      totalHunks: 2,
      suppliedHunks: 2,
      processedHunks: 1,
      pendingGroups: 0,
      calls: 1,
      canContinue: true,
      gapCount: 0,
    };
    expect(
      parseAiRunEvent(JSON.stringify({ type: "review-status", review })),
    ).toMatchObject({ type: "review-status" });
    expect(() =>
      parseAiRunEvent(
        JSON.stringify({
          type: "review-status",
          review: { ...review, calls: -1 },
        }),
      ),
    ).toThrow();
    const { calls: _calls, ...missing } = review;
    expect(() =>
      parseAiRunEvent(
        JSON.stringify({ type: "review-status", review: missing }),
      ),
    ).toThrow();
  });
});
