// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initUiState } from "../../utils/uiState";
import { usePrCommits } from "../usePrCommits";

const session = {
  url: "https://github.test/acme/widget/pull/7",
  headSha: "head-123",
};
const commitA = {
  sha: "commit-a",
  subject: "Add parser",
  body: "",
  author: "Ada",
  authoredAt: "2026-01-01",
  parents: [],
};
const commitB = {
  sha: "commit-b",
  subject: "Fix parser",
  body: "",
  author: "Grace",
  authoredAt: "2026-01-02",
  parents: ["commit-a"],
};
const commitList = {
  headSha: session.headSha,
  commits: [commitA, commitB],
  total: 2,
  complete: true,
};

function json(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

async function seedUiState(value: unknown = {}) {
  const response = vi.fn().mockResolvedValue(json(value));
  vi.stubGlobal("fetch", response);
  await initUiState();
}

describe("usePrCommits", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the commit list by head identity and requests the selected commit diff", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/ui-state") return json({});
      if (url === `/api/gh/commits?headSha=${session.headSha}`)
        return json(commitList);
      if (
        url === `/api/gh/commits/${commitA.sha}/diff?headSha=${session.headSha}`
      )
        return json({
          headSha: session.headSha,
          sha: commitA.sha,
          patch: "patch A",
        });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await initUiState();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result } = renderHook(() => usePrCommits(session), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.commits).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/gh/commits?headSha=${session.headSha}`,
      expect.anything()
    );
    act(() => result.current.select(commitA.sha));
    await waitFor(() => expect(result.current.patch).toBe("patch A"));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/gh/commits/${commitA.sha}/diff?headSha=${session.headSha}`,
      expect.anything()
    );
  });

  it("does not show an older diff after rapid A/B selection", async () => {
    let resolveA!: (response: Response) => void;
    let resolveB!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/ui-state") return Promise.resolve(json({}));
      if (url === `/api/gh/commits?headSha=${session.headSha}`)
        return Promise.resolve(json(commitList));
      if (url.includes(`/commits/${commitA.sha}/diff`))
        return new Promise<Response>((resolve) => {
          resolveA = resolve;
        });
      if (url.includes(`/commits/${commitB.sha}/diff`))
        return new Promise<Response>((resolve) => {
          resolveB = resolve;
        });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result } = renderHook(() => usePrCommits(session), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.commits).toHaveLength(2));

    act(() => result.current.select(commitA.sha));
    await waitFor(() => expect(resolveA).toBeTypeOf("function"));
    act(() => result.current.select(commitB.sha));
    await waitFor(() => expect(resolveB).toBeTypeOf("function"));
    await act(async () => {
      resolveB(
        json({ headSha: session.headSha, sha: commitB.sha, patch: "patch B" })
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.patch).toBe("patch B"));
    await act(async () => {
      resolveA(
        json({ headSha: session.headSha, sha: commitA.sha, patch: "patch A" })
      );
      await Promise.resolve();
    });
    expect(result.current.selectedSha).toBe(commitB.sha);
    expect(result.current.patch).toBe("patch B");
  });

  it("clears selection and patch when the head or PR identity changes", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/ui-state") return json({});
      if (url.includes("/diff")) {
        const sha = url.includes(commitA.sha) ? commitA.sha : commitB.sha;
        return json({
          headSha: url.includes("new-head") ? "new-head" : session.headSha,
          sha,
          patch: `patch ${sha}`,
        });
      }
      if (url.includes("new-head"))
        return json({
          headSha: "new-head",
          commits: [commitB],
          total: 1,
          complete: true,
        });
      return json(commitList);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result, rerender } = renderHook(
      ({ value }) => usePrCommits(value),
      { initialProps: { value: session }, wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(result.current.commits).toHaveLength(2));
    act(() => result.current.select(commitA.sha));
    await waitFor(() => expect(result.current.patch).toBe("patch commit-a"));
    rerender({ value: { ...session, headSha: "new-head" } });
    await waitFor(() => expect(result.current.selectedSha).toBeNull());
    expect(result.current.patch).toBeNull();
    rerender({
      value: {
        ...session,
        url: "https://github.test/acme/other/pull/8",
        headSha: "new-head",
      },
    });
    await waitFor(() => expect(result.current.selectedSha).toBeNull());
    expect(result.current.patch).toBeNull();
  });

  it("preserves a null patch on errors and recovers through retry", async () => {
    let diffAttempts = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/ui-state") return json({});
      if (url.includes("/diff")) {
        diffAttempts += 1;
        return diffAttempts === 1
          ? json({ error: "diff unavailable" }, { status: 502 })
          : json({
              headSha: session.headSha,
              sha: commitA.sha,
              patch: "recovered",
            });
      }
      return json(commitList);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result } = renderHook(() => usePrCommits(session), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.commits).toHaveLength(2));
    act(() => result.current.select(commitA.sha));
    await waitFor(() => expect(result.current.diffError).toBeInstanceOf(Error));
    expect(result.current.patch).toBeNull();
    await act(async () => {
      await result.current.retryDiff();
    });
    await waitFor(() => expect(result.current.patch).toBe("recovered"));
  });

  it("keeps viewed files separate per commit and restores persisted progress", async () => {
    await seedUiState({
      [`diffing-pr-commit-progress:${session.url}`]: JSON.stringify({
        reviewed: [commitA.sha],
        files: { [commitA.sha]: ["src/a.ts"] },
      }),
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/gh/commits?headSha=${session.headSha}`)
        return json(commitList);
      if (url.includes("/diff"))
        return json({
          headSha: session.headSha,
          sha: url.includes(commitA.sha) ? commitA.sha : commitB.sha,
          patch: "patch",
        });
      if (url === "/api/ui-state") return json({});
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { result } = renderHook(() => usePrCommits(session), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.commits).toHaveLength(2));
    expect(result.current.reviewedCommits.has(commitA.sha)).toBe(true);
    act(() => result.current.select(commitA.sha));
    await waitFor(() =>
      expect(result.current.viewedFiles.has("src/a.ts")).toBe(true)
    );
    act(() => result.current.setViewed("src/b.ts", true));
    expect(result.current.viewedFiles.has("src/b.ts")).toBe(true);
    act(() => result.current.select(commitB.sha));
    expect(result.current.viewedFiles.has("src/a.ts")).toBe(false);
    act(() => result.current.setViewed("src/b.ts", true));
    act(() => result.current.select(commitA.sha));
    expect(result.current.viewedFiles.has("src/a.ts")).toBe(true);
    expect(result.current.viewedFiles.has("src/b.ts")).toBe(true);
  });
});
