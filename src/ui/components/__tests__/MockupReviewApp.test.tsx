// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mockup, MockupSummary } from "../../../lib/mockup-types";
import {
  MockupReviewApp,
  extractMockupHtml,
  isBlankMockupHtml,
} from "../MockupReviewApp";

const { submitPopoverProps, mockNavigate } = vi.hoisted(() => ({
  submitPopoverProps: { current: null as Record<string, unknown> | null },
  mockNavigate: vi.fn(),
}));

vi.mock("lucide-react", () => {
  const icons: Record<string, () => ReactElement> = {};
  for (const name of [
    "ArrowLeft",
    "Bot",
    "Eye",
    "History",
    "LayoutTemplate",
    "Maximize2",
    "Menu",
    "Minimize2",
    "Monitor",
    "MousePointer2",
    "Palette",
    "Settings",
    "Smartphone",
    "SquareDashed",
    "Tablet",
    "Check",
    "Clock",
    "MessageSquare",
    "MessageSquareWarning",
    "Minus",
    "X",
    "PanelLeftClose",
    "PanelLeftOpen",
    "Search",
    "Trash2",
    "GripVertical",
    "AlertTriangle",
    "CheckCircle2",
    "ChevronDown",
    "ChevronRight",
    "Pencil",
    "Reply",
    "User",
    "MessagesSquare",
    "PanelRightClose",
    "Plus",
    "Sun",
    "Moon",
    "Terminal",
    "HelpCircle",
    "ChevronLeft",
    "Navigation",
    "Keyboard",
    "MousePointer2",
    "GitCommit",
    "PencilLine",
    "Loader2",
    "Sparkles",
    "Bot",
    "ChevronDown",
    "Search",
  ]) {
    icons[name] = () => <svg data-testid={`lucide-${name}`} />;
  }
  return icons;
});

vi.mock("../../router", () => ({
  useRoutePath: () => "/mockup/m1",
  navigate: (...args: any[]) => mockNavigate(...args),
}));

vi.mock("../../utils", () => ({
  timeAgo: () => "2h ago",
  isTypingInFocus: () => false,
}));

vi.mock("../../utils/uiState", () => ({
  getUiStateItem: () => null,
  setUiStateItem: () => {},
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      uiFont: null,
      monoFont: null,
      haptics: true,
      sounds: true,
      theme: "rose-pine",
    },
    loaded: true,
    updateSettings: vi.fn(),
  }),
  resolveMonoFont: () => "monospace",
}));

vi.mock("../../hooks/useApplyFonts", () => ({ useApplyFonts: () => {} }));

vi.mock("../../hooks/usePlanLayoutMedia", () => ({
  usePlanCommentsSheet: () => true,
}));

vi.mock("../../hooks/useHaptics", () => ({
  HapticsProvider: ({ children }: any) => <>{children}</>,
  useFeedback: () => ({ haptic: vi.fn(), sound: vi.fn() }),
}));

vi.mock("../../primitives/Tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock("../../primitives/Popover", () => ({
  Popover: ({ trigger, children }: any) => (
    <div>
      {trigger}
      {children}
    </div>
  ),
}));

vi.mock("../../primitives/Select", () => ({
  Select: ({ value, options, onValueChange }: any) => (
    <select
      data-testid="version-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("../BrandMark", () => ({ BrandMark: () => <span>brand</span> }));

vi.mock("../ThemeModal", () => ({ ThemeModal: () => null }));

vi.mock("../CommentForm", () => ({
  CommentForm: ({ initialBody = "", onSubmit }: any) => (
    <div data-testid="mockup-comment-form">
      <textarea aria-label="Comment body" defaultValue={initialBody} />
      <button onClick={() => onSubmit("posted")}>Submit</button>
    </div>
  ),
}));

vi.mock("../SubmitPlanReviewPopover", () => ({
  SubmitPlanReviewPopover: (props: any) => {
    submitPopoverProps.current = props;
    return <div data-testid="submit-mockup-popover" />;
  },
}));

const { aiState } = vi.hoisted(() => ({
  aiState: { current: null as null | Record<string, unknown> },
}));

vi.mock("../../ai/AiContext", () => ({
  useOptionalAi: () => aiState.current,
}));

vi.mock("../../ai/AiConnectionsPanel", () => ({
  AiConnectionsPanel: () => null,
}));

vi.mock("../../ai/AiModelPicker", () => ({
  AiModelPicker: ({ onOpenAssistant }: { onOpenAssistant?: () => void }) =>
    onOpenAssistant ? (
      <button type="button" onClick={onOpenAssistant}>
        Ask AI
      </button>
    ) : null,
}));

vi.mock("../../ai/AiAssistantRail", () => ({
  AiAssistantRail: ({
    open,
    title,
    surface,
  }: {
    open: boolean;
    title?: string;
    surface?: string;
  }) =>
    open ? (
      <aside aria-label={title || "Ask AI"} data-surface={surface}>
        AI rail
      </aside>
    ) : null,
}));

const summaries: MockupSummary[] = [
  {
    id: "m1",
    title: "Landing hero",
    screens: [{ id: "main", label: "Main" }],
    createdAt: 0,
    updatedAt: 0,
    version: 2,
    decision: "pending",
    versionCount: 2,
    commentCounts: { total: 4, open: 4, resolved: 0 },
  },
];

const detail: Mockup = {
  id: "m1",
  title: "Landing hero",
  screens: [
    { id: "main", label: "Main", html: "<h1>Hi</h1>" },
    { id: "checkout", label: "Checkout", html: "<p>pay</p>" },
  ],
  createdAt: 0,
  updatedAt: 0,
  version: 2,
  decision: "pending",
  versions: [
    {
      version: 1,
      title: "Landing hero",
      screens: [{ id: "main", label: "Main", html: "<h1>Hi</h1>" }],
      createdAt: 0,
    },
    {
      version: 2,
      title: "Landing hero",
      screens: [
        { id: "main", label: "Main", html: "<h1>Hi</h1>" },
        { id: "checkout", label: "Checkout", html: "<p>pay</p>" },
      ],
      createdAt: 0,
    },
  ],
  comments: [
    {
      id: "c1",
      screenId: "main",
      kind: "block",
      selector: "button.pay",
      body: "too wide",
      status: "open",
      createdAt: 0,
      createdAtMockupVersion: 2,
      viewport: "desktop",
      replies: [],
    },
    {
      id: "cOld",
      screenId: "main",
      kind: "section",
      target: "hero",
      body: "older note",
      status: "open",
      createdAt: 0,
      createdAtMockupVersion: 1,
      viewport: "desktop",
      replies: [],
    },
    {
      id: "cMobile",
      screenId: "main",
      kind: "point",
      x: 10,
      y: 10,
      body: "mobile note",
      status: "open",
      createdAt: 0,
      createdAtMockupVersion: 2,
      viewport: "mobile",
      replies: [],
    },
    {
      id: "cCheckout",
      screenId: "checkout",
      kind: "block",
      selector: ".pay-now",
      body: "checkout note",
      status: "open",
      createdAt: 0,
      createdAtMockupVersion: 2,
      viewport: "desktop",
      replies: [],
    },
  ],
};

let fetchCalls: Array<{ url: string; init?: RequestInit }>;

function stubFetch(nonce = "nonce-1") {
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      fetchCalls.push({ url, init });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url.endsWith("/api/mockups")) return json(summaries);
      if (url.includes("/api/mockups/m1/screens/main/document")) {
        return new Response("<html><body><h1>Hi</h1></body></html>", {
          headers: {
            "X-Diffing-Mockup-Nonce": nonce,
            "X-Diffing-Mockup-Viewport": "desktop",
          },
        });
      }
      if (url.endsWith("/api/mockups/m1")) return json(detail);
      if (url.endsWith("/api/mockup-review/status")) {
        return json({ round: 0, waiters: 0, lastDecidedAt: null });
      }
      return json({ error: "not found" }, 404);
    }),
  );
}

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MockupReviewApp />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  submitPopoverProps.current = null;
  aiState.current = null;
  mockNavigate.mockReset();
  const rect = {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(rect);
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function postProbeEvent(
  event: string,
  nonce: string,
  extra: Record<string, unknown> = {},
) {
  const iframe = document.querySelector("iframe") as HTMLIFrameElement;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "diffing-mockup",
        event,
        nonce,
        viewport: "desktop",
        kind: "block",
        selector: "button.pay",
        x: 50,
        y: 50,
        ...extra,
      },
      source: iframe?.contentWindow ?? window,
    }),
  );
}

describe("mockup AI html helpers", () => {
  it("treats comment-only screens as blank", () => {
    expect(isBlankMockupHtml("<!-- empty -->")).toBe(true);
    expect(isBlankMockupHtml("<h1>Hi</h1>")).toBe(false);
  });

  it("unwraps fenced HTML from an AI draft", () => {
    expect(extractMockupHtml("```html\n<section>x</section>\n```")).toBe(
      "<section>x</section>",
    );
  });
});

describe("MockupReviewApp", () => {
  it("fetches compact summaries for the list and the full detail for the active mockup", async () => {
    stubFetch();
    renderApp();

    // list row comes from /api/mockups summaries
    expect(
      (await screen.findAllByText("Landing hero")).length,
    ).toBeGreaterThanOrEqual(2);
    // detail drives the review header
    await waitFor(() => {
      const meta = document.querySelector(".plan-review-meta-stat");
      expect(meta?.textContent).toContain("2 screens");
    });

    await waitFor(() => {
      expect(fetchCalls.some((c) => c.url.endsWith("/api/mockups"))).toBe(true);
      expect(fetchCalls.some((c) => c.url.endsWith("/api/mockups/m1"))).toBe(
        true,
      );
    });
  });

  it("scopes pins and counts to the exact version + screen + viewport", async () => {
    stubFetch();
    renderApp();

    // rail count: only the main+desktop+v2 open comment is in view
    expect(await screen.findByText("1 in view · 4 total")).toBeInTheDocument();
    // meta line reports scoped vs total
    expect(document.querySelector(".plan-review-meta-stat")).toHaveTextContent(
      "1 open in this view · 4 open total",
    );
    // only the scoped comment is pinned on the canvas
    await waitFor(() => {
      expect(document.querySelectorAll(".mockup-pin")).toHaveLength(1);
    });
    const pin = screen.getByRole("button", { name: /^Comment 1:/ });
    expect(pin).toHaveAccessibleName(expect.stringContaining("v2"));
    expect(pin).toHaveAccessibleName(expect.stringContaining("desktop"));
    // screen tabs show per-screen counts for the current view
    expect(screen.getAllByLabelText("1 open")).toHaveLength(2);
  });

  it("lists prior-version unresolved comments as history, never as pins", async () => {
    stubFetch();
    renderApp();

    expect(
      await screen.findByText("Prior versions · unresolved"),
    ).toBeInTheDocument();
    expect(screen.getByText("older note")).toBeInTheDocument();
    // the older comment is not pinned on the current canvas
    await waitFor(() => {
      expect(document.querySelectorAll(".mockup-pin")).toHaveLength(1);
    });
  });

  it("surfaces other-viewport comments and jumps the canvas viewport on click", async () => {
    stubFetch();
    renderApp();

    // the mobile comment (v2, same screen) is listed under other viewports
    expect(
      await screen.findByText("Other viewports · open"),
    ).toBeInTheDocument();
    expect(screen.getByText("mobile note")).toBeInTheDocument();

    fireEvent.click(screen.getByText("mobile note"));

    // clicking switches the canvas to the mobile viewport and pins the comment
    await waitFor(() => {
      expect(
        fetchCalls.some(
          (c) =>
            c.url.includes("/api/mockups/m1/screens/main/document") &&
            c.url.includes("viewport=mobile"),
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      const pin = screen.getByRole("button", { name: /^Comment 1:/ });
      expect(pin).toHaveAccessibleName(expect.stringContaining("mobile"));
    });
  });

  it("serves the screen document with version+viewport and validates the nonce on posted events", async () => {
    stubFetch("nonce-1");
    renderApp();

    // document request carries version + viewport (the comment scope)
    await waitFor(() => {
      const doc = fetchCalls.find((c) =>
        c.url.includes("/api/mockups/m1/screens/main/document"),
      );
      expect(doc).toBeTruthy();
      expect(doc!.url).toContain("version=2");
      expect(doc!.url).toContain("viewport=desktop");
    });

    // the served document is handed to the iframe
    await waitFor(() => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      expect(iframe.getAttribute("srcdoc")).toContain("<h1>Hi</h1>");
    });

    // a posted event with the served nonce opens the composer
    postProbeEvent("click", "nonce-1");
    expect(
      await screen.findByRole("dialog", {
        name: "Commenting on block · button.pay",
      }),
    ).toBeInTheDocument();
    // sandboxed srcdoc windows may not strictly equal contentWindow —
    // nonce identity is enough. The pending state is single, so this new
    // probe replaces the open button.pay composer.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "diffing-mockup",
          event: "click",
          nonce: "nonce-1",
          viewport: "desktop",
          kind: "block",
          selector: "h1.title",
          x: 20,
          y: 20,
        },
        source: window,
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Commenting on block · h1.title",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", {
        name: "Commenting on block · button.pay",
      }),
    ).not.toBeInTheDocument();

    // a stale/foreign nonce is ignored
    postProbeEvent("click", "nonce-stale", { selector: "button.other" });
    expect(
      screen.queryByRole("dialog", {
        name: "Commenting on block · button.other",
      }),
    ).not.toBeInTheDocument();
  });

  it("wires the mockup submit popover with scoped vs total open counts", async () => {
    stubFetch();
    renderApp();

    await screen.findByText("1 in view · 4 total");
    await waitFor(() => {
      expect(submitPopoverProps.current).toMatchObject({
        kind: "mockup",
        scopedOpenCount: 1,
        openCommentCount: 4,
      });
    });
  });

  it("view-only mode disables comments and serves the passive (interactive) document", async () => {
    stubFetch();
    renderApp();

    // the scoped comment is pinned in review mode
    await screen.findByText("1 in view · 4 total");
    await waitFor(() => {
      expect(document.querySelectorAll(".mockup-pin")).toHaveLength(1);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Enter view-only mode" }),
    );

    // pins are gone and the served document switches to the passive probe
    await waitFor(() => {
      expect(document.querySelectorAll(".mockup-pin")).toHaveLength(0);
    });
    await waitFor(() => {
      const docs = fetchCalls.filter((c) =>
        c.url.includes("/api/mockups/m1/screens/main/document"),
      );
      expect(docs.some((d) => d.url.includes("mode=view"))).toBe(true);
    });

    // rail comment items are disabled (read-only)
    const items = Array.from(
      document.querySelectorAll(".plan-comments-rail-item"),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toBeDisabled();
  });

  it("aligns screen tabs with the actions card and keeps edit/comment icon-only", async () => {
    stubFetch();
    renderApp();

    await waitFor(() => {
      expect(
        document.querySelector(".plan-review-meta-stat")?.textContent,
      ).toContain("2 screens");
    });

    // Tabs + actions share one header row.
    const row = document.querySelector(".plan-review-head-row");
    expect(row).not.toBeNull();
    expect(row!.querySelector(".mockup-screen-tabs")).not.toBeNull();
    expect(row!.querySelector(".plan-review-head-actions")).not.toBeNull();

    // A dot separates the viewport picker from the action buttons.
    expect(document.querySelector(".mockup-action-dot")).not.toBeNull();
    const actions = document.querySelector(".plan-review-head-actions")!;
    const viewportGroup = actions.querySelector(".mockup-viewport-picker");
    const dot = actions.querySelector(".mockup-action-dot");
    const editBtn = actions.querySelector('[aria-label="Edit screen HTML"]');
    const commentsBtn = actions.querySelector(
      '[aria-label="Toggle comments map"]',
    );
    expect(
      viewportGroup!.compareDocumentPosition(dot!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      dot!.compareDocumentPosition(editBtn!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      editBtn!.compareDocumentPosition(commentsBtn!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Icon-only buttons: no text labels inside.
    for (const btn of [editBtn, commentsBtn]) {
      expect(btn!.classList.contains("plan-icon-btn")).toBe(true);
      expect(btn!.querySelector(".btn-label")).toBeNull();
      expect(btn!.textContent).not.toContain("Edit");
      expect(btn!.textContent).not.toContain("Comments");
    }
  });

  it("shows version comparison side by side with a draggable split divider", async () => {
    stubFetch();
    renderApp();

    await waitFor(() => {
      expect(
        document.querySelector(".plan-review-meta-stat")?.textContent,
      ).toContain("2 screens");
    });

    // Compare off by default: single canvas, no split.
    expect(document.querySelector(".mockup-compare-split.is-split")).toBeNull();

    // The second select is the compare select (options start with Compare off).
    const selects = screen.getAllByTestId("version-select");
    expect(selects.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(selects[1], { target: { value: "1" } });

    await waitFor(() => {
      expect(
        document.querySelector(".mockup-compare-split.is-split"),
      ).not.toBeNull();
    });
    // Divider is keyboard-accessible and labeled.
    const separator = screen.getByRole("separator", {
      name: "Resize current and compared mockup panes",
    });
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "50");
    // Two frames side by side: the live canvas + the compare version.
    expect(document.querySelectorAll(".mockup-iframe")).toHaveLength(1);
    expect(document.querySelectorAll(".mockup-compare-frame")).toHaveLength(1);

    // Turning compare back off restores the single canvas.
    fireEvent.change(selects[1], { target: { value: "off" } });
    await waitFor(() => {
      expect(
        document.querySelector(".mockup-compare-split.is-split"),
      ).toBeNull();
    });
  });

  it("sizes the frame to the full document height reported by the probe", async () => {
    stubFetch("nonce-1");
    renderApp();

    // wait for the iframe to be handed the served doc
    await waitFor(() => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      expect(iframe.getAttribute("srcdoc")).toContain("<h1>Hi</h1>");
    });

    // probe reports the document height on ready — the frame must grow to it
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "diffing-mockup",
          event: "ready",
          nonce: "nonce-1",
          viewport: "desktop",
          sections: [],
          height: 640,
        },
        source: window,
      }),
    );
    await waitFor(() => {
      const frame = document.querySelector(".mockup-frame") as HTMLElement;
      expect(frame.style.height).toBe("640px");
    });

    // late load/resize height updates keep it in sync
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "diffing-mockup",
          event: "height",
          nonce: "nonce-1",
          viewport: "desktop",
          height: 812,
        },
        source: window,
      }),
    );
    await waitFor(() => {
      const frame = document.querySelector(".mockup-frame") as HTMLElement;
      expect(frame.style.height).toBe("812px");
    });
  });

  it("opens the shortcuts guide with cmd+? and toggles zen from the keymap", async () => {
    stubFetch();
    renderApp();

    await waitFor(() => {
      expect(
        document.querySelector(".plan-review-meta-stat")?.textContent,
      ).toContain("2 screens");
    });

    fireEvent.keyDown(window, { key: "?", metaKey: true });
    expect(
      await screen.findByRole("dialog", {
        name: "Keyboard shortcuts",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Mockup Review Shortcuts",
      }),
    ).toBeInTheDocument();

    // Esc closes the dialog (base-ui Dialog handles it).
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
      ).not.toBeInTheDocument();
    });

    // z toggles zen from the keymap.
    fireEvent.keyDown(window, { key: "z" });
    await waitFor(() => {
      expect(document.querySelector(".zen-mode")).not.toBeNull();
    });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(document.querySelector(".zen-mode")).toBeNull();
    });
  });

  it("keeps Ask AI closed on mount and never hits /api/ai/run", async () => {
    stubFetch();
    renderApp();
    expect(
      await screen.findByRole("button", { name: "Ask AI" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Ask about this mockup"),
    ).not.toBeInTheDocument();
    expect(fetchCalls.some((c) => c.url.includes("/api/ai/run"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(
      await screen.findByLabelText("Ask about this mockup"),
    ).toHaveAttribute("data-surface", "mockup");
    expect(fetchCalls.some((c) => c.url.includes("/api/ai/run"))).toBe(false);
  });

  it("offers Generate this screen on a blank canvas only after confirm", async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        text: "<section>draft</section>",
        runId: "r1",
        warnings: [],
      });
    aiState.current = {
      models: [{ id: "codex/test" }],
      loading: false,
      run,
      connections: [],
    };
    stubFetch();
    const original = detail.screens[0].html;
    detail.screens[0].html = "<!-- empty -->";
    try {
      renderApp();
      expect(
        await screen.findByRole("button", { name: "Generate this screen" }),
      ).toBeInTheDocument();
      expect(run).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Generate this screen" }),
      );
      expect(
        await screen.findByRole("alertdialog", {
          name: "Generate this screen?",
        }),
      ).toBeInTheDocument();
      expect(run).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      expect(run.mock.calls[0][0]).toMatchObject({
        surface: "mockup",
        action: "generate-screen",
      });
      expect(fetchCalls.some((c) => c.url.includes("/api/ai/run"))).toBe(false);
    } finally {
      detail.screens[0].html = original;
    }
  });

  it("disables HTML edit while viewing a historical version", async () => {
    stubFetch();
    renderApp();
    const editBtn = await screen.findByRole("button", {
      name: "Edit screen HTML",
    });
    expect(editBtn).not.toBeDisabled();
    const selects = screen.getAllByTestId("version-select");
    fireEvent.change(selects[0], { target: { value: "1" } });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Edit screen HTML" }),
      ).toBeDisabled();
    });
  });
});
