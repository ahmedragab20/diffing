// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearch } from "../useSearch";

const liveHandlers = new Map<string, (data: string) => void>();
vi.mock("../../live", () => ({
  subscribeLive: vi.fn((event: string, handler: (data: string) => void) => {
    liveHandlers.set(event, handler);
    return () => liveHandlers.delete(event);
  }),
}));

const result = (query: string, indexing = false) => ({
  scope: "text" as const,
  total: 1,
  indexing,
  items: [
    {
      path: `src/${query}.ts`,
      fileName: `${query}.ts`,
      line: 1,
      col: 1,
      content: query,
      matchRanges: [[0, query.length] as [number, number]],
      gitStatus: "",
    },
  ],
});

const clients: QueryClient[] = [];
function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const value = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    clients.push(value);
    return value;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("useSearch", () => {
  beforeEach(() => {
    liveHandlers.clear();
  });
  afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not expose settled alpha data while beta is pending, and clears disabled input", async () => {
    let releaseBeta!: (value: Response) => void;
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)).query;
      return query === "beta"
        ? new Promise<Response>((resolve) => {
            releaseBeta = resolve;
          })
        : Promise.resolve(response(result(query)));
    });
    vi.stubGlobal("fetch", fetchMock);
    let args = {
      scope: "text" as const,
      query: "alpha",
      regex: false,
      changedOnly: false,
      changedPaths: [],
      open: true,
    };
    const { result: hook, rerender } = renderHook(() => useSearch(args), {
      wrapper,
    });
    await waitFor(() => {
      const data = hook.current.data;
      expect(data?.scope === "text" && data.items[0]?.path).toBe(
        "src/alpha.ts",
      );
    });
    args = { ...args, query: "beta" };
    rerender();
    expect(hook.current.data).toBeUndefined();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(hook.current.data).toBeUndefined();
    expect(hook.current.isFetching).toBe(true);
    args = { ...args, query: "" };
    rerender();
    await waitFor(() => expect(hook.current.enabled).toBe(false));
    expect(hook.current.data).toBeUndefined();
    await act(async () => releaseBeta(response(result("beta"))));
  });

  it("refetches the same query on live change and pr-session events", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response(result("alpha"))));
    vi.stubGlobal("fetch", fetchMock);
    const { result: hook } = renderHook(
      () =>
        useSearch({
          scope: "text",
          query: "alpha",
          regex: false,
          changedOnly: false,
          changedPaths: [],
          open: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(hook.current.data).toBeDefined());
    expect(liveHandlers.has("change")).toBe(true);
    expect(liveHandlers.has("pr-session")).toBe(true);
    act(() => {
      liveHandlers.get("change")?.("");
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(hook.current.data).toBeDefined();
    });
    act(() => {
      liveHandlers.get("pr-session")?.("");
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(hook.current.data).toBeDefined();
    });
  });

  it("exposes HTTP500 as an error rather than data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response({ error: "broken" }, 500))),
    );
    const { result: hook } = renderHook(
      () =>
        useSearch({
          scope: "text",
          query: "alpha",
          regex: false,
          changedOnly: false,
          changedPaths: [],
          open: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(hook.current.isError).toBe(true));
    expect(hook.current.data).toBeUndefined();
  });

  it("polls while the search response says indexing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(result("alpha", true)))
      .mockImplementation(() =>
        Promise.resolve(response(result("alpha", false))),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result: hook } = renderHook(
      () =>
        useSearch({
          scope: "text",
          query: "alpha",
          regex: false,
          changedOnly: false,
          changedPaths: [],
          open: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(hook.current.data?.indexing).toBe(true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
      timeout: 2500,
    });
  });
});
