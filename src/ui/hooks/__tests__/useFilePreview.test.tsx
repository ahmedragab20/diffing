// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFilePreview } from "../useFilePreview";

const liveHandlers = new Map<string, () => void>();
vi.mock("../../live", () => ({
  subscribeLive: vi.fn((event: string, handler: () => void) => {
    liveHandlers.set(event, handler);
    return () => liveHandlers.delete(event);
  }),
}));

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

describe("useFilePreview", () => {
  afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    liveHandlers.clear();
  });

  it("requests the working-tree version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ content: "one" })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useFilePreview("src/a.ts"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.content).toBe("one"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/file-text?path=src%2Fa.ts&version=working",
      expect.anything(),
    );
  });

  it("reloads preview content after a live change", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "one" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "two" })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useFilePreview("src/a.ts"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.content).toBe("one"));
    expect(liveHandlers.has("change")).toBe(true);
    act(() => liveHandlers.get("change")?.());
    await waitFor(() => expect(result.current.data?.content).toBe("two"));
  });
});
