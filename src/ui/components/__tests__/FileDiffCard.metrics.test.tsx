// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { FileSearchSession } from "../../hooks/useFileSearch";

// Capture the `metrics` prop handed to the pierre renderers so we can assert
// the virtualizer's per-line height estimates stay aligned with the CSS.
const { lastProps, StubFileDiff, StubMultiFileDiff } = vi.hoisted(() => {
  const lastProps: {
    metrics?: {
      lineHeight?: number;
      diffHeaderHeight?: number;
      hunkLineCount?: number;
      spacing?: number;
    };
    options?: { expandUnchanged?: boolean };
  } = {};
  const StubFileDiff = (props: { metrics?: unknown; options?: unknown }) => {
    lastProps.metrics = props.metrics as typeof lastProps.metrics;
    lastProps.options = props.options as typeof lastProps.options;
    return <div data-testid="filediff" />;
  };
  const StubMultiFileDiff = (props: { metrics?: unknown; options?: unknown }) => {
    lastProps.metrics = props.metrics as typeof lastProps.metrics;
    lastProps.options = props.options as typeof lastProps.options;
    return <div data-testid="multifilediff" />;
  };
  return { lastProps, StubFileDiff, StubMultiFileDiff };
});

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: StubFileDiff,
  MultiFileDiff: StubMultiFileDiff,
}));

import { FileDiffCard } from "../FileDiffCard";

const FILE_PATH = "src/example.ts";

const fileDiff = {
  name: FILE_PATH,
  type: "change",
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: true,
  deletionLines: [],
  additionLines: [],
} as unknown as FileDiffMetadata;

interface RenderArgs {
  fontSize?: number;
  expandContextByDefault?: boolean;
  fileSearch?: FileSearchSession;
}

function renderCard({
  fontSize = 13,
  expandContextByDefault = false,
  fileSearch,
}: RenderArgs = {}) {
  return render(
    <FileDiffCard
      fileDiff={fileDiff}
      filePath={FILE_PATH}
      annotations={[]}
      diffStyle="split"
      tabSize={4}
      viewed={false}
      theme="rose-pine"
      lineDiffType="word"
      lineWrap={false}
      diffIndicators="classic"
      showLineNumbers
      hunkSeparators="line-info"
      lineHoverHighlight="both"
      fontSize={fontSize}
      monoFontFamily="monospace"
      expandContextByDefault={expandContextByDefault}
      collapsedContextThreshold={10}
      expansionLineCount={20}
      autoCollapseLineThreshold={0}
      fileSearch={fileSearch}
      onViewedChange={vi.fn()}
      onAddComment={vi.fn()}
      onDeleteComment={vi.fn()}
    />,
  );
}

beforeEach(() => {
  lastProps.metrics = undefined;
  lastProps.options = undefined;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  global.fetch = vi.fn(async () => {
    return {
      ok: true,
      json: async () => ({ content: "content", missing: false }),
    } as unknown as Response;
  });
});

describe("FileDiffCard virtualization metrics", () => {
  it("passes line-height-aligned metrics to the partial FileDiff render", () => {
    renderCard({ fontSize: 13 });
    expect(lastProps.metrics?.lineHeight).toBe(Math.round(13 * 1.7));
  });

  it("tracks font-size changes in the metrics line-height", () => {
    renderCard({ fontSize: 16 });
    expect(lastProps.metrics?.lineHeight).toBe(Math.round(16 * 1.7));
  });

  it("reserves no pierce header height (the card renders its own header)", () => {
    renderCard();
    expect(lastProps.metrics?.diffHeaderHeight).toBe(0);
  });

  it("keeps the hunk chunk size and spacing at the library defaults", () => {
    renderCard();
    expect(lastProps.metrics?.hunkLineCount).toBe(50);
    expect(lastProps.metrics?.spacing).toBe(8);
  });

  it("passes the same metrics to the full-context MultiFileDiff render", async () => {
    const { findByTestId } = renderCard({
      fontSize: 13,
      expandContextByDefault: true,
    });
    await findByTestId("multifilediff");
    expect(lastProps.metrics?.lineHeight).toBe(Math.round(13 * 1.7));
  });

  it("expands context and registers the expanded search corpus for an active query", async () => {
    const setExpandedEntries = vi.fn();
    const fileSearch: FileSearchSession = {
      filePath: FILE_PATH,
      query: "content",
      hits: [],
      index: 0,
      focusNonce: 0,
      open: vi.fn(),
      close: vi.fn(),
      setQuery: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      setExpandedEntries,
    };
    const { findByTestId } = renderCard({
      expandContextByDefault: true,
      fileSearch,
    });

    await findByTestId("multifilediff");
    expect(lastProps.options?.expandUnchanged).toBe(true);
    expect(setExpandedEntries).toHaveBeenCalledWith(
      FILE_PATH,
      expect.arrayContaining([
        expect.objectContaining({
          filePath: FILE_PATH,
          lineNumber: 1,
          side: "additions",
          content: "content",
        }),
      ]),
    );
  });

  it("keeps unchanged context collapsed when the active search query is empty", async () => {
    const fileSearch: FileSearchSession = {
      filePath: FILE_PATH,
      query: "",
      hits: [],
      index: 0,
      focusNonce: 0,
      open: vi.fn(),
      close: vi.fn(),
      setQuery: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      setExpandedEntries: vi.fn(),
    };
    const { findByTestId } = renderCard({
      expandContextByDefault: true,
      fileSearch,
    });

    await findByTestId("multifilediff");
    expect(lastProps.options?.expandUnchanged).toBe(false);
  });
});
