// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs";

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
  } = {};
  const StubFileDiff = (props: { metrics?: unknown }) => {
    lastProps.metrics = props.metrics as typeof lastProps.metrics;
    return <div data-testid="filediff" />;
  };
  const StubMultiFileDiff = (props: { metrics?: unknown }) => {
    lastProps.metrics = props.metrics as typeof lastProps.metrics;
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
}

function renderCard({
  fontSize = 13,
  expandContextByDefault = false,
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
      onViewedChange={vi.fn()}
      onAddComment={vi.fn()}
      onDeleteComment={vi.fn()}
    />,
  );
}

beforeEach(() => {
  lastProps.metrics = undefined;
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
});
