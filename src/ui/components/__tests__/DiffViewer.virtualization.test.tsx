// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// The pierre Virtualizer needs platform observers jsdom doesn't ship. Stub
// them so `setup(document)` can run and we can assert it actually wired the
// window-scrolled virtualizer against the document element.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
}
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(
    _cb: IntersectionObserverCallback,
    _options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
}

// Mock the card so the test can observe whether a virtualizer is actually
// flowing through VirtualizerContext (diffs.com best practice: one shared,
// window-scrolled virtualizer drives per-line rendering for every card).
vi.mock("../FileDiffCard", async () => {
  const { useVirtualizer } = await import("@pierre/diffs/react");
  return {
    FileDiffCard: ({ filePath }: { filePath: string }) => {
      const virtualizer = useVirtualizer();
      return (
        <div
          data-testid="card"
          data-file={filePath}
          data-virtualized={String(virtualizer != null)}
        />
      );
    },
  };
});
vi.mock("../BinaryFileDiff", () => ({ BinaryFileDiff: () => null }));

import { DiffViewer } from "../DiffViewer";

const file = {
  name: "src/example.ts",
  type: "change",
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: true,
  deletionLines: [],
  additionLines: [],
} as any;

function renderViewer() {
  return render(
    <DiffViewer
      files={[file]}
      diffStyle="unified"
      tabSizeMap={{}}
      defaultTabSize={4}
      viewedFiles={new Set()}
      binaryFiles={new Map()}
      theme="rose-pine"
      lineDiffType="word"
      lineWrap={false}
      diffIndicators="classic"
      showLineNumbers
      hunkSeparators="line-info"
      lineHoverHighlight="both"
      fontSize={13}
      monoFontFamily="monospace"
      expandContextByDefault={false}
      collapsedContextThreshold={10}
      expansionLineCount={20}
      autoCollapseLineThreshold={400}
      onViewedChange={vi.fn()}
      fileAnnotationsMap={new Map()}
      onAddComment={vi.fn()}
      onDeleteComment={vi.fn()}
    />,
  );
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  FakeIntersectionObserver.instances = [];
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (globalThis as { IntersectionObserver?: unknown })
    .IntersectionObserver;
  document.body.innerHTML = "";
});

describe("DiffViewer virtualization", () => {
  it("provides a shared virtualizer to every card when the platform supports it", () => {
    renderViewer();
    expect(screen.getByTestId("card").dataset.virtualized).toBe("true");
  });

  it("sets the virtualizer up against the document (window-scrolled surface)", () => {
    renderViewer();
    const resizeObserver = FakeResizeObserver.instances[0];
    expect(resizeObserver).toBeDefined();
    expect(resizeObserver.observe).toHaveBeenCalledWith(
      document.documentElement,
    );
  });

  it("keeps a single virtualizer instance across re-renders", () => {
    const { rerender } = renderViewer();
    const first = FakeResizeObserver.instances.length;
    rerender(
      <DiffViewer
        files={[file]}
        diffStyle="split"
        tabSizeMap={{}}
        defaultTabSize={4}
        viewedFiles={new Set()}
        binaryFiles={new Map()}
        theme="rose-pine"
        lineDiffType="word"
        lineWrap={false}
        diffIndicators="classic"
        showLineNumbers
        hunkSeparators="line-info"
        lineHoverHighlight="both"
        fontSize={13}
        monoFontFamily="monospace"
        expandContextByDefault={false}
        collapsedContextThreshold={10}
        expansionLineCount={20}
        autoCollapseLineThreshold={400}
        onViewedChange={vi.fn()}
        fileAnnotationsMap={new Map()}
        onAddComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );
    // The lazy `useState` initializer runs once — a re-render (even with new
    // props) must not allocate another virtualizer / observer.
    expect(FakeResizeObserver.instances.length).toBe(first);
  });

  it("falls back to non-virtualized rendering when observers are unavailable", () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    delete (globalThis as { IntersectionObserver?: unknown })
      .IntersectionObserver;
    renderViewer();
    expect(screen.getByTestId("card").dataset.virtualized).toBe("false");
  });
});
