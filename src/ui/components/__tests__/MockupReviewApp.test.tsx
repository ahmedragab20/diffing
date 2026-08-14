// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mockup, MockupSummary } from "../../../lib/mockup-types";
import { MockupReviewApp } from "../MockupReviewApp";

const { submitPopoverProps, mockNavigate } = vi.hoisted(() => ({
  submitPopoverProps: { current: null as Record<string, unknown> | null },
  mockNavigate: vi.fn(),
}));

vi.mock("lucide-react", () => {
  const icons: Record<string, any> = {};
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
  ]) {
    icons[name] = () => <svg data-testid={`lucide-${name}`} />;
  }
  return icons;
});

vi.mock("../../router", () => ({
  useRoutePath: () => "/mockup/m1",
  navigate: (...args: any[]) => mockNavigate(...args),
}));

vi.mock("../../utils", () => ({ timeAgo: () => "2h ago" }));

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
});
