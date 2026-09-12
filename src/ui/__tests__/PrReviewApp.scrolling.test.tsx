// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { PrExistingComment } from "../../lib/pr-session";
import type { ReviewComment } from "../../lib/types";

type CardProps = ComponentProps<
  typeof import("../components/FileDiffCard").FileDiffCard
>;
type TreeProps = ComponentProps<typeof import("../components/FileTree").FileTree>;

type Frame = FrameRequestCallback;
const addComment = vi.fn();
const removeComment = vi.fn();
const addReply = vi.fn();
const resolveComment = vi.fn();
const unresolveComment = vi.fn();
const editComment = vi.fn();
const setViewed = vi.fn();
const cardProps = new Map<string, CardProps>();
const renderCounts = new Map<string, number>();
const tracking: { onChange?: (path: string) => void } = {};
const virtualizers: unknown[] = [];
const scrollIntoView = vi.fn();
const queryClient = {
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
};
const fileSearchSession = {
  filePath: null as string | null,
  query: "",
  hits: [] as unknown[],
  index: 0,
  focusNonce: 0,
  open: vi.fn(),
  close: vi.fn(),
  setQuery: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
};
const workerPool = {
  setRenderOptions: vi.fn().mockResolvedValue(undefined),
};
const viewedFiles = new Set<string>();
let frameId = 0;
let frames = new Map<number, Frame>();
const originalScrollDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

const patch = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old a
+new a
diff --git a/b.ts b/b.ts
index 3333333..4444444 100644
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-old b
+new b
`;

const settings = {
  defaultMode: "web",
  staged: false,
  untracked: false,
  diffStyle: "unified" as const,
  defaultTabSize: 4,
  theme: "rose-pine",
  lineDiffType: "word" as const,
  lineWrap: false,
  diffIndicators: "classic" as const,
  showLineNumbers: true,
  hunkSeparators: "line-info" as const,
  lineHoverHighlight: "both" as const,
  fontSize: 14,
  expandContextByDefault: false,
  collapsedContextThreshold: 10,
  expansionLineCount: 20,
  haptics: false,
  sounds: false,
  density: "comfortable" as const,
  autoCollapseLineThreshold: 400,
  requireViewAllBeforeSend: false,
  showStatusBar: false,
  savedReplies: [],
  ignoreSpaceChange: false,
  ignoreAllSpace: false,
  editDiagnostics: false,
};

function draft(filePath: string): ReviewComment {
  return {
    id: `draft-${filePath}`,
    filePath,
    side: "additions",
    lineNumber: 1,
    lineContent: "new",
    body: `draft ${filePath}`,
    status: "open",
    createdAt: 1,
    replies: [],
    severity: "none",
  };
}

function existing(path: string, id: number): PrExistingComment {
  return {
    id,
    author: { login: "reviewer" },
    body: `existing ${path}`,
    path,
    line: 1,
    side: "RIGHT",
    startSide: null,
    createdAt: "2020-01-01",
    updatedAt: "2020-01-01",
    state: "COMMENTED",
    replies: [],
    isOutdated: false,
  };
}

const session = {
  ref: "123",
  owner: "o",
  repo: "r",
  pullNumber: 123,
  headSha: "head",
  baseSha: "base",
  title: "PR",
  url: "https://github.com/o/r/pull/123",
  author: { login: "author" },
  additions: 2,
  deletions: 2,
  changedFiles: 2,
  diff: patch,
  comments: [draft("a.ts"), draft("b.ts")],
  existingComments: [existing("a.ts", 1), existing("b.ts", 2)],
};
// Mutable so a test can swap in new session/comment data between renders.
const live: { session: typeof session; comments: ReviewComment[] } = {
  session,
  comments: session.comments,
};

vi.mock("../hooks/usePrSession", () => ({
  usePrSession: () => ({ session: live.session, loaded: true, error: null }),
  usePrCommentSync: () => undefined,
  usePrComments: () => ({
    comments: live.comments,
    addComment,
    removeComment,
    updateComment: vi.fn(),
    addReply,
    resolveComment,
    unresolveComment,
    editComment,
    editReply: vi.fn(),
    removeReply: vi.fn(),
  }),
  useSubmitPrReview: () => ({ mutateAsync: vi.fn() }),
  useRefreshPrSession: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ settings, loaded: true, updateSettings: vi.fn() }),
  resolveMonoFont: () => "monospace",
}));
vi.mock("../hooks/useViewed", () => ({
  useViewed: () => ({ viewedFiles, setViewed }),
}));
vi.mock("../hooks/useDiff", () => ({
  useDiff: () => ({ patch, loading: false, error: null }),
}));
vi.mock("../hooks/useApplyFonts", () => ({ useApplyFonts: () => undefined }));
vi.mock("../hooks/useDiffReviewKeymaps", () => ({
  useDiffReviewKeymaps: () => undefined,
}));
vi.mock("../hooks/useViewportActiveFile", () => ({
  useViewportActiveFileTracking: (
    _files: unknown,
    _active: unknown,
    onChange: (path: string) => void,
  ) => {
    tracking.onChange = onChange;
  },
}));
vi.mock("../hooks/useDiffSearch", () => ({
  useDiffSearch: () => [],
  buildFileSearchCorpus: () => "",
}));
vi.mock("../hooks/useFileSearch", () => ({
  useFileSearch: () => fileSearchSession,
}));
vi.mock("../hooks/useSearchSession", () => ({ useSearchSession: () => ({}) }));
vi.mock("../router", () => ({ useRoutePath: () => "/gh/pr", navigate: vi.fn() }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => queryClient,
}));
vi.mock("@pierre/diffs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pierre/diffs/react")>()),
  useWorkerPool: () => workerPool,
}));

vi.mock("../components/FileDiffCard", async () => {
  const { useVirtualizer } = await import("@pierre/diffs/react");
  const { memo } = await import("react");
  // memo'd like the real card so the render-count assertion below exercises
  // the same prop-identity boundary production relies on.
  function MockFileDiffCard(props: CardProps) {
    renderCounts.set(props.filePath, (renderCounts.get(props.filePath) ?? 0) + 1);
    const virtualizer = useVirtualizer();
    virtualizers.push(virtualizer);
    cardProps.set(props.filePath, props);
    return (
      <div id={props.id} data-testid={`card-${props.filePath}`}>
        {props.filePath}
        <button
          onClick={() => props.onViewedChange(props.filePath, true)}
        >
          view {props.filePath}
        </button>
        <button
          onClick={() =>
            props.onAddComment(
              props.filePath,
              "additions",
              1,
              "line",
              "new comment",
            )
          }
        >
          add {props.filePath}
        </button>
        <button
          onClick={() => props.onCardToggleCollapse?.(props.filePath, true)}
        >
          collapse {props.filePath}
        </button>
      </div>
    );
  }
  return { FileDiffCard: memo(MockFileDiffCard) };
});
vi.mock("../components/FileTree", () => ({
  FileTree: (props: TreeProps) => (
    <div>
      {props.files.map((file) => (
        <button
          key={file.name}
          onClick={() => props.onFileClick(file.name)}
        >
          {`select ${file.name}`}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../components/PrReviewToolbar", () => ({
  PrReviewToolbar: () => null,
}));
vi.mock("../components/PrReviewActivity", () => ({
  PrReviewActivity: () => null,
}));
vi.mock("../components/PrConversationTimeline", () => ({
  PrConversationTimeline: () => null,
}));
vi.mock("../components/PrConversationInbox", () => ({
  PrConversationInbox: () => null,
}));
vi.mock("../components/PrReviewSummaryBanner", () => ({
  PrReviewSummaryBanner: () => null,
}));
vi.mock("../components/CommentTracker", () => ({
  CommentTracker: () => null,
}));
vi.mock("../components/FontPickerModal", () => ({
  FontPickerModal: () => null,
}));
vi.mock("../components/SearchPalette", () => ({
  SearchPalette: () => null,
}));
vi.mock("../components/ShortcutsHelpModal", () => ({
  ShortcutsHelpModal: () => null,
}));
vi.mock("../components/ThemeModal", () => ({
  ThemeModal: () => null,
}));
vi.mock("../components/VimStatusBar", () => ({
  VimStatusBar: () => null,
}));
vi.mock("../components/PrSubmittedToast", () => ({
  PrSubmittedToast: () => null,
}));
vi.mock("../ai/AiAssistantRail", () => ({
  AiAssistantRail: () => null,
}));
vi.mock("../components/BinaryFileDiff", () => ({
  BinaryFileDiff: () => null,
}));

import { PrReviewApp } from "../components/PrReviewApp";

class ResizeStub {
  static instances: ResizeStub[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_: ResizeObserverCallback) {
    ResizeStub.instances.push(this);
  }
}
class IntersectionStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_: IntersectionObserverCallback) {}
}

async function flush(count = 20) {
  await act(async () => {
    for (let i = 0; i < count && frames.size; i += 1) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(performance.now()));
    }
  });
}

function clearSetupFrames() {
  frames.clear();
}

function renderApp() {
  return render(<PrReviewApp />);
}

beforeEach(() => {
  cardProps.clear();
  renderCounts.clear();
  tracking.onChange = undefined;
  live.session = session;
  live.comments = session.comments;
  virtualizers.length = 0;
  addComment.mockClear();
  setViewed.mockClear();
  scrollIntoView.mockClear();
  frames = new Map();
  frameId = 0;
  ResizeStub.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeStub);
  vi.stubGlobal("IntersectionObserver", IntersectionStub);
  vi.stubGlobal("requestAnimationFrame", (callback: Frame) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  if (originalScrollDescriptor) {
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(
      scrollIntoView,
    );
  } else {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  }
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalScrollDescriptor) {
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollDescriptor,
    );
  } else {
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

describe("PR review scrolling regression", () => {
  it("shares one virtualizer and observes document once", () => {
    renderApp();
    expect(screen.getByTestId("card-a.ts")).toBeInTheDocument();
    expect(screen.getByTestId("card-b.ts")).toBeInTheDocument();
    expect(virtualizers[0]).toBeTruthy();
    expect(virtualizers[0]).toBe(virtualizers[1]);
    expect(ResizeStub.instances).toHaveLength(1);
    expect(ResizeStub.instances[0].observe).toHaveBeenCalledWith(
      document.documentElement,
    );
  });

  it("routes comments to their file and disables local actions", () => {
    renderApp();
    for (const filePath of ["a.ts", "b.ts"]) {
      const props = cardProps.get(filePath)!;
      expect(props.annotations).toHaveLength(1);
      expect(props.annotations[0].metadata.filePath).toBe(filePath);
      expect(props.existingComments).toHaveLength(1);
      expect(props.existingComments?.[0].path).toBe(filePath);
      expect(props.allowLocalActions).toBe(false);
    }
    fireEvent.click(screen.getByRole("button", { name: "add b.ts" }));
    expect(addComment).toHaveBeenCalledWith({
      filePath: "b.ts",
      side: "additions",
      lineNumber: 1,
      lineContent: "line",
      body: "new comment",
      startLineNumber: undefined,
    });
  });

  it("explicitly selects b.ts and advances from viewed a.ts", async () => {
    renderApp();
    clearSetupFrames();
    fireEvent.click(screen.getByRole("button", { name: "select b.ts" }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "auto",
    });
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId("card-b.ts"));
    scrollIntoView.mockClear();
    clearSetupFrames();
    fireEvent.click(screen.getByRole("button", { name: "view a.ts" }));
    await flush();
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "smooth",
    });
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId("card-b.ts"));
    expect(frames.size).toBe(0);
  });

  it("cancels viewed advance on wheel before its first frame", async () => {
    renderApp();
    clearSetupFrames();
    fireEvent.click(screen.getByRole("button", { name: "view a.ts" }));
    window.dispatchEvent(new WheelEvent("wheel"));
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("cancels viewed advance on wheel between frames", async () => {
    renderApp();
    clearSetupFrames();
    fireEvent.click(screen.getByRole("button", { name: "view a.ts" }));
    await flush(1);
    window.dispatchEvent(new WheelEvent("wheel"));
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("cancels viewed advance on unmount", async () => {
    const { unmount } = renderApp();
    clearSetupFrames();
    fireEvent.click(screen.getByRole("button", { name: "view a.ts" }));
    unmount();
    const target = document.createElement("div");
    target.id = "file-b.ts";
    document.body.append(target);
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("explicit selection supersedes pending viewed advance", async () => {
    renderApp();
    clearSetupFrames();
    fireEvent.click(screen.getByRole("button", { name: "view a.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "select a.ts" }));
    await flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId("card-a.ts"));
    expect(frames.size).toBe(0);
  });

  it("does not advance when a card is ordinarily collapsed", async () => {
    renderApp();
    clearSetupFrames();
    fireEvent.click(screen.getByRole("button", { name: "collapse a.ts" }));
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("does not re-render file cards when scroll tracking changes the active file", () => {
    renderApp();
    const before = new Map(renderCounts);
    const propsBefore = cardProps.get("b.ts")!;
    act(() => tracking.onChange!("b.ts"));
    act(() => tracking.onChange!("a.ts"));
    expect(renderCounts).toEqual(before);
    expect(cardProps.get("b.ts")).toBe(propsBefore);
  });

  it("keeps untouched files' comment arrays when another file gains comments", () => {
    renderApp();
    const aBefore = cardProps.get("a.ts")!;
    const aRenders = renderCounts.get("a.ts");
    const bRenders = renderCounts.get("b.ts");
    // New top-level arrays (as a refetch produces) but a.ts items are the same
    // objects (as TanStack structural sharing / setQueryData(map) produce).
    live.session = {
      ...session,
      existingComments: [session.existingComments[0], existing("b.ts", 3)],
    };
    live.comments = [...session.comments, { ...draft("b.ts"), id: "draft-b2" }];
    act(() => tracking.onChange!("b.ts"));
    const aAfter = cardProps.get("a.ts")!;
    expect(aAfter.existingComments).toBe(aBefore.existingComments);
    expect(aAfter.annotations).toBe(aBefore.annotations);
    expect(renderCounts.get("a.ts")).toBe(aRenders);
    expect(renderCounts.get("b.ts")).toBe((bRenders ?? 0) + 1);
    expect(cardProps.get("b.ts")!.existingComments).toHaveLength(1);
    expect(cardProps.get("b.ts")!.existingComments?.[0].id).toBe(3);
    expect(cardProps.get("b.ts")!.annotations).toHaveLength(2);
  });
});
