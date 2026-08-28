// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MockupComposer } from "../MockupComposer";
import type { ProbeHit } from "../MockupCanvas";

vi.mock("lucide-react", () => {
  const Stub = () => null;
  const proxy: Record<string, unknown> = {};
  const keys = [
    "GripVertical",
    "X",
    "Minus",
    "MessageSquare",
    "MessageSquarePlus",
    "Maximize2",
    "AlertOctagon",
    "CircleDot",
    "HelpCircle",
    "Sparkles",
    "Check",
    "ChevronsUpDown",
    "Clock",
    "CheckCircle2",
    "ChevronDown",
    "ChevronRight",
    "AlertTriangle",
    "Bot",
    "Pencil",
    "Reply",
    "Trash2",
    "User",
    "MessageSquareWarning",
    "PencilLine",
  ];
  for (const k of keys) proxy[k] = Stub;
  return proxy;
});

vi.mock("../../hooks/useHaptics", () => ({
  useFeedback: () => ({ haptic: vi.fn(), sound: vi.fn() }),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { savedReplies: [] },
    updateSettings: vi.fn(),
  }),
}));

vi.mock("../../drafts", () => ({
  getDraft: () => null,
  setDraft: vi.fn(),
  clearDraft: vi.fn(),
}));

vi.mock("../Markdown", () => ({
  Markdown: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

beforeEach(() => {
  mockRun.mockReset();
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
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  queryClient.clear();
});

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));
vi.mock("../../ai/AiContext", () => ({
  useOptionalAi: () => ({ run: mockRun, selectedModel: "codex/test" }),
}));

const pending: ProbeHit = {
  kind: "block",
  selector: "button.pay",
  x: 50,
  y: 50,
};

describe("MockupComposer — focus on open", () => {
  it("focuses the comment field as soon as the popup opens", async () => {
    const frameRef = createRef<HTMLDivElement>();
    render(
      <QueryClientProvider client={queryClient}>
        <div ref={frameRef}>
          <MockupComposer
            pending={pending}
            frameRef={frameRef}
            draftKey="mockup:m1:main:desktop:block:button.pay"
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
          />
        </div>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        "Comment body",
      );
    });
  });

  it("shows AI chips only when context is passed and does not run until click", async () => {
    const frameRef = createRef<HTMLDivElement>();
    render(
      <QueryClientProvider client={queryClient}>
        <div ref={frameRef}>
          <MockupComposer
            pending={{ ...pending, target: "hero", html: "<h1>Hi</h1>" }}
            frameRef={frameRef}
            draftKey="mockup:m1:main:desktop:section:hero"
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            aiContext={{
              kind: "mockup",
              mockupId: "m1",
              title: "Landing",
              version: 2,
              screenId: "main",
              html: "<h1>Hi</h1>",
            }}
            onRewriteRegion={vi.fn()}
          />
        </div>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /Draft comment/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rewrite region" }),
    ).toBeInTheDocument();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("hides AI chips when no mockup context is provided", async () => {
    const frameRef = createRef<HTMLDivElement>();
    render(
      <QueryClientProvider client={queryClient}>
        <div ref={frameRef}>
          <MockupComposer
            pending={pending}
            frameRef={frameRef}
            draftKey="mockup:m1:main:desktop:block:button.pay"
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
          />
        </div>
      </QueryClientProvider>,
    );
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: /Draft comment/i }),
    ).not.toBeInTheDocument();
    expect(mockRun).not.toHaveBeenCalled();
  });
});
