// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSearchSession } from "../useSearchSession";

const liveHandlers = new Map<string, () => void>();
vi.mock("../../live", () => ({
  subscribeLive: vi.fn((event: string, handler: () => void) => {
    liveHandlers.set(event, handler);
    return () => liveHandlers.delete(event);
  }),
}));
vi.mock("../../utils", () => ({
  scrollToLine: vi.fn(),
}));

describe("useSearchSession", () => {
  const navContext = {
    diffFileSet: new Set(["src/a.ts"]),
    changedKeys: new Set(["src/a.ts:10"]),
    customMode: false,
    staged: false,
  };

  it("flashes status when cycling with no active session", () => {
    const onNavigateFile = vi.fn();
    const { result } = renderHook(() =>
      useSearchSession(navContext, onNavigateFile),
    );

    act(() => {
      result.current.nextHit();
    });

    expect(result.current.statusMessage).toBe("no active search results");
    expect(onNavigateFile).not.toHaveBeenCalled();
  });

  it("clears a session when live change or pr-session invalidates navigation context", () => {
    const onNavigateFile = vi.fn();
    const { result } = renderHook(() =>
      useSearchSession(navContext, onNavigateFile),
    );
    act(() =>
      result.current.setSnapshot({
        hits: [{ kind: "file", path: "src/a.ts" }],
        index: 0,
        query: "a",
      }),
    );
    expect(result.current.session).not.toBeNull();
    act(() => liveHandlers.get("change")?.());
    expect(result.current.session).toBeNull();
    act(() =>
      result.current.setSnapshot({
        hits: [{ kind: "file", path: "src/a.ts" }],
        index: 0,
        query: "a",
      }),
    );
    act(() => liveHandlers.get("pr-session")?.());
    expect(result.current.session).toBeNull();
  });

  it("clears the session when navigation context changes", () => {
    const onNavigateFile = vi.fn();
    const { result, rerender } = renderHook(
      ({ context }) => useSearchSession(context, onNavigateFile),
      { initialProps: { context: navContext } },
    );
    act(() =>
      result.current.setSnapshot({
        hits: [{ kind: "file", path: "src/a.ts" }],
        index: 0,
        query: "a",
      }),
    );
    rerender({
      context: { ...navContext, changedKeys: new Set(["src/a.ts:11"]) },
    });
    expect(result.current.session).toBeNull();
  });

  it("clears an existing session when given an empty snapshot", () => {
    const onNavigateFile = vi.fn();
    const { result } = renderHook(() =>
      useSearchSession(navContext, onNavigateFile),
    );
    act(() =>
      result.current.setSnapshot({
        hits: [{ kind: "file", path: "src/a.ts" }],
        index: 0,
        query: "a",
      }),
    );
    act(() => result.current.setSnapshot({ hits: [], index: 0, query: "" }));
    expect(result.current.session).toBeNull();
  });

  it("cycles hits after a snapshot is set", () => {
    const onNavigateFile = vi.fn();
    const { result } = renderHook(() =>
      useSearchSession(navContext, onNavigateFile),
    );

    act(() => {
      result.current.setSnapshot({
        hits: [{ kind: "file", path: "src/a.ts" }],
        index: 0,
        query: "a",
      });
    });

    act(() => {
      result.current.nextHit();
    });

    expect(onNavigateFile).toHaveBeenCalledWith("src/a.ts");
    expect(result.current.session?.index).toBe(0);
  });
});
