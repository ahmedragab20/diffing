// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { highlightLineInElement, scrollToLine } from "../utils";
import { cancelDiffNavigation, registerDiffTarget } from "../lib/diffNavigation";

const disposers: Array<() => void> = [];
let scrollY = 0;

function row(root: Element | ShadowRoot, line: number, type = "context") {
  const element = document.createElement("div");
  element.dataset.line = String(line);
  element.dataset.lineType = type;
  element.textContent = `needle ${line}`;
  root.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => ({
    top: 1000 - scrollY, bottom: 1022 - scrollY, height: 22,
    left: 0, right: 500, width: 500, x: 0, y: 1000 - scrollY,
    toJSON() {},
  }));
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  scrollY = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
  vi.spyOn(window, "scrollTo").mockImplementation((options) => {
    scrollY = (options as ScrollToOptions).top ?? scrollY;
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cancelDiffNavigation();
  disposers.splice(0).forEach(dispose => dispose());
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("search line navigation", () => {
  it.each(["change-addition", "change-deletion", "context-expanded"])(
    "flashes a real renderer %s row after reaching it", type => {
      const card = document.createElement("div");
      card.id = "file-src/a.ts";
      document.body.append(card);
      const host = document.createElement("div");
      card.append(host);
      const target = row(host.attachShadow({ mode: "open" }), 90, type);
      const side = type === "change-deletion" ? "deletions" : "additions";
      disposers.push(registerDiffTarget("src/a.ts", { reveal() {}, position: () => 1000 }));
      scrollToLine("src/a.ts", 90, side, "needle");
      vi.advanceTimersByTime(400);
      expect(target.style.getPropertyValue("background-color")).not.toBe("");
      expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
      expect(target.getBoundingClientRect().bottom).toBeLessThan(window.innerHeight);
    },
  );

  it("does not flash old-side context when navigating new-side context at the same number", () => {
    const card = document.createElement("div");
    card.id = "file-src/a.ts";
    document.body.append(card);
    const oldColumn = document.createElement("div");
    oldColumn.dataset.deletions = "";
    const newColumn = document.createElement("div");
    newColumn.dataset.additions = "";
    card.append(oldColumn, newColumn);
    const oldRow = row(oldColumn, 90);
    const newRow = row(newColumn, 90);
    disposers.push(registerDiffTarget("src/a.ts", { reveal() {}, position: () => 1000 }));
    scrollToLine("src/a.ts", 90, "additions");
    vi.advanceTimersByTime(400);
    expect(newRow.style.getPropertyValue("background-color")).not.toBe("");
    expect(oldRow.style.getPropertyValue("background-color")).toBe("");
  });
});

describe("preview navigation", () => {
  it("latest selection wins even if an older target appears later", () => {
    const container = document.createElement("div");
    document.body.append(container);
    highlightLineInElement(container, 100);
    const current = row(container, 900);
    highlightLineInElement(container, 900);
    vi.advanceTimersByTime(200);
    expect(current.scrollIntoView).toHaveBeenCalled();
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    row(container, 100);
    vi.advanceTimersByTime(400);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(["wheel", "keydown", "pointerdown", "touchstart"])("user %s stops a pending preview jump", type => {
    const container = document.createElement("div");
    document.body.append(container);
    highlightLineInElement(container, 100);
    container.dispatchEvent(new Event(type, { bubbles: true }));
    row(container, 100);
    vi.advanceTimersByTime(400);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll a disconnected preview", () => {
    const container = document.createElement("div");
    document.body.append(container);
    highlightLineInElement(container, 100);
    container.remove();
    row(container, 100);
    vi.advanceTimersByTime(400);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
