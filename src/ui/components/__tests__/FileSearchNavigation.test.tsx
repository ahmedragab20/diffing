// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSearchBar } from "../FileSearchBar";
import { DiffNavigationStatus } from "../DiffNavigationStatus";
import { useFileSearch } from "../../hooks/useFileSearch";
import { cancelDiffNavigation, getDiffNavigationState, registerDiffTarget } from "../../lib/diffNavigation";

const entries = [100, 900].map(lineNumber => ({
  filePath: "src/large.ts", lineNumber, side: "additions" as const, content: "needle",
}));
function Harness() {
  const session = useFileSearch(entries);
  useEffect(() => session.open("src/large.ts"), [session.open]);
  return <>
    {session.filePath && <FileSearchBar {...session} filePath={session.filePath}
      onQueryChange={session.setQuery} onNext={session.next} onPrev={session.prev} onClose={session.close} />}
    <DiffNavigationStatus />
  </>;
}
let dispose: () => void;
let y = 0;
let ready = true;

beforeEach(() => {
  vi.useFakeTimers();
  y = 0;
  ready = true;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
  vi.spyOn(window, "scrollTo").mockImplementation(options => { y = (options as ScrollToOptions).top ?? y; });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const card = document.createElement("div");
  card.id = "file-src/large.ts";
  document.body.append(card);
  for (const line of [100, 900]) {
    const row = document.createElement("div");
    row.dataset.line = String(line);
    row.dataset.lineType = "change-addition";
    row.textContent = "needle";
    card.append(row);
    vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => ({
      top: line * 10 - y, bottom: line * 10 - y + 22, height: 22,
    } as DOMRect));
  }
  dispose = registerDiffTarget("src/large.ts", { reveal() {}, position: line => ready ? line * 10 : undefined });
});
afterEach(() => {
  cleanup();
  cancelDiffNavigation();
  dispose();
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("find-in-file with real navigation", () => {
  it("Enter reaches the first hit, then the second, and announces actual arrival", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Find in file" });
    fireEvent.change(input, { target: { value: "needle" } });
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(window.scrollTo).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("Opening src/large.ts:100");
    act(() => vi.advanceTimersByTime(400));
    expect(y).toBe(744);
    expect(screen.getByRole("status")).toHaveTextContent("Jumped to src/large.ts:100");
    expect(document.querySelector<HTMLElement>('[data-line="100"]')!.style.backgroundColor).not.toBe("");
    fireEvent.keyDown(input, { key: "Enter" });
    act(() => vi.advanceTimersByTime(400));
    expect(y).toBe(8744);
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Jumped to src/large.ts:900");
  });

  it("closing search cancels a pending jump before its target loads", () => {
    ready = false;
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "needle" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    ready = true;
    act(() => vi.advanceTimersByTime(400));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Jump cancelled");
  });

  it("announces a failed jump instead of claiming arrival", () => {
    ready = false;
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "needle" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("status")).toHaveTextContent("Could not reach src/large.ts:100");
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("leaving the surface clears its navigation status and pending work", () => {
    ready = false;
    const view = render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "needle" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(getDiffNavigationState()?.state).toBe("loading");
    view.unmount();
    expect(getDiffNavigationState()).toBeNull();
    ready = true;
    act(() => vi.advanceTimersByTime(400));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("IME confirmation does not start a jump", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "needle" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true, keyCode: 229 });
    act(() => vi.advanceTimersByTime(400));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
