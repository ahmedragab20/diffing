// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MockupComment } from "../../../lib/mockup-types";
import { MockupCommentsRail } from "../MockupCommentsRail";

// Mirrors the module-level key (not exported).
const RAIL_WIDTH_KEY = "diffing-mockup-comments-rail-width";

const { mockUiStateGet, mockUiStateSet } = vi.hoisted(() => ({
  mockUiStateGet: vi.fn(),
  mockUiStateSet: vi.fn(),
}));

vi.mock("lucide-react", () => ({
  History: () => <svg data-testid="lucide-history" />,
  MessagesSquare: () => <svg data-testid="lucide-messages" />,
  Monitor: () => <svg data-testid="lucide-monitor" />,
  PanelRightClose: () => <svg data-testid="lucide-panel-close" />,
  X: () => <svg data-testid="lucide-x" />,
  Check: () => <svg data-testid="lucide-check" />,
  Clock: () => <svg data-testid="lucide-clock" />,
  MessageSquare: () => <svg data-testid="lucide-msg" />,
  MessageSquareWarning: () => <svg data-testid="lucide-msg-warn" />,
}));

vi.mock("../../utils/uiState", () => ({
  getUiStateItem: (...args: any[]) => mockUiStateGet(...args),
  setUiStateItem: (...args: any[]) => mockUiStateSet(...args),
}));

function comment(overrides: Partial<MockupComment> = {}): MockupComment {
  return {
    id: "c1",
    screenId: "main",
    kind: "block",
    selector: "button.pay",
    body: "The hero button is too wide",
    status: "open",
    createdAt: 0,
    createdAtMockupVersion: 2,
    viewport: "desktop",
    replies: [],
    ...overrides,
  };
}

function renderRail(
  overrides: Partial<React.ComponentProps<typeof MockupCommentsRail>> = {},
) {
  return render(
    <MockupCommentsRail
      comments={[comment({ id: "c1" })]}
      priorVersionOpen={[]}
      otherViewportOpen={[]}
      scopedOpenCount={1}
      totalOpenCount={1}
      selectedId={null}
      onSelect={vi.fn()}
      onJumpToComment={vi.fn()}
      onJumpToViewport={vi.fn()}
      onClose={vi.fn()}
      sheet={false}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mockUiStateGet.mockReset();
  mockUiStateSet.mockReset();
  mockUiStateGet.mockReturnValue(null);
  document.body.innerHTML = "";
});

describe("MockupCommentsRail", () => {
  it("reports scoped vs total open counts", () => {
    renderRail({ scopedOpenCount: 2, totalOpenCount: 5 });
    expect(screen.getByText("2 in view · 5 total")).toBeInTheDocument();
  });

  it("omits the total when everything open is in view", () => {
    renderRail({ scopedOpenCount: 2, totalOpenCount: 2 });
    expect(screen.getByText("2 in view")).toBeInTheDocument();
    expect(screen.queryByText(/· 2 total/)).not.toBeInTheDocument();
  });

  it("lists scoped threads with numbering, status, and reply counts", () => {
    renderRail({
      comments: [
        comment({ id: "c1", body: "first note", status: "open" }),
        comment({
          id: "c2",
          body: "second note",
          status: "resolved",
          replies: [{ id: "r1", body: "ok", createdAt: 0, role: "agent" }],
        }),
      ],
    });
    expect(screen.getByText("#1 block · button.pay")).toBeInTheDocument();
    expect(screen.getByText("#2 block · button.pay")).toBeInTheDocument();
    expect(screen.getByText("first note")).toBeInTheDocument();
    expect(screen.getByText("second note")).toBeInTheDocument();
    expect(screen.getByText("resolved · 1 reply")).toBeInTheDocument();
  });

  it("shows a prior-version unresolved history group that jumps the version switcher", () => {
    const onJumpToComment = vi.fn();
    const older = comment({
      id: "old1",
      body: "v1 note",
      createdAtMockupVersion: 1,
    });
    renderRail({
      priorVersionOpen: [older],
      comments: [],
      scopedOpenCount: 0,
      onJumpToComment,
    });
    expect(screen.getByText("Prior versions · unresolved")).toBeInTheDocument();
    fireEvent.click(screen.getByText("v1 note"));
    expect(onJumpToComment).toHaveBeenCalledWith(older);
  });

  it("lists other-viewport comments that jump the canvas viewport", () => {
    const onJumpToViewport = vi.fn();
    const mobile = comment({
      id: "m1",
      body: "mobile note",
      kind: "point",
      viewport: "mobile",
    });
    renderRail({
      otherViewportOpen: [mobile],
      comments: [],
      scopedOpenCount: 0,
      onJumpToViewport,
    });
    expect(screen.getByText("Other viewports · open")).toBeInTheDocument();
    // the row carries a viewport prefix so the destination is obvious
    expect(
      document.querySelector(".mockup-rail-viewport-prefix"),
    ).toHaveTextContent("mobile");
    fireEvent.click(screen.getByText("mobile note"));
    expect(onJumpToViewport).toHaveBeenCalledWith(mobile);
  });

  it("closes via the map close button", () => {
    const onClose = vi.fn();
    renderRail({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close comments map" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("selects a scoped thread", () => {
    const onSelect = vi.fn();
    renderRail({ onSelect });
    fireEvent.click(screen.getByText("The hero button is too wide"));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("persists a resized rail width", () => {
    renderRail();
    const handle = screen.getByRole("separator", {
      name: "Resize comments rail",
    });
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 250 });
    fireEvent.mouseUp(document);
    expect(mockUiStateSet).toHaveBeenCalledWith(RAIL_WIDTH_KEY, "330");
  });

  it("clamps the persisted width to the rail bounds", () => {
    mockUiStateGet.mockReturnValue("9999");
    renderRail();
    // mount effect persists the clamped value
    expect(mockUiStateSet).toHaveBeenCalledWith(RAIL_WIDTH_KEY, "420");
  });

  it("renders as a modal sheet on narrow layouts without a resize handle", () => {
    renderRail({ sheet: true });
    const aside = screen.getByRole("dialog");
    expect(aside).toHaveAttribute("aria-modal", "true");
    expect(
      screen.queryByRole("separator", { name: "Resize comments rail" }),
    ).not.toBeInTheDocument();
  });
});
