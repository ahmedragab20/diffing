// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelDiffNavigation,
  getDiffNavigationState,
  navigateToDiffLine,
  registerDiffTarget,
  scheduleDiffNavigation,
} from "../diffNavigation";

let queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextId = 1;
let now = 0;
const cleanups: Array<() => void> = [];
function register(
  path: string,
  target: Parameters<typeof registerDiffTarget>[1],
) {
  const cleanup = registerDiffTarget(path, target);
  cleanups.push(cleanup);
  return cleanup;
}

beforeEach(() => {
  queue = [];
  nextId = 1;
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue = queue.filter((frame) => frame.id !== id);
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cancelDiffNavigation();
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frame() {
  now += 16;
  const next = queue.shift();
  next?.cb(performance.now());
}

describe("diff navigation", () => {
  it("latest scheduled navigation wins", () => {
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    scheduleDiffNavigation(first);
    scheduleDiffNavigation(second);
    frame();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it.each(["wheel", "keydown"] as const)("interrupts on %s", (type) => {
    const step = vi.fn(() => false);
    scheduleDiffNavigation(step);
    window.dispatchEvent(new Event(type));
    frame();
    expect(step).not.toHaveBeenCalled();
  });

  it("does not cancel navigation with the Enter event that started it", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const step = vi.fn(() => true);
    input.addEventListener("keydown", () => scheduleDiffNavigation(step));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    frame();
    expect(step).toHaveBeenCalledOnce();
  });

  it("waits for an unloaded target beyond 40 animation frames", () => {
    const card = document.createElement("div");
    card.id = "file-src/slow.ts";
    document.body.append(card);
    let ready = false;
    const reveal = vi.fn();
    register("src/slow.ts", { reveal, position: () => ready ? 2000 : undefined });
    navigateToDiffLine("src/slow.ts", 90, "additions");
    for (let i = 0; i < 50; i++) frame();
    expect(window.scrollTo).not.toHaveBeenCalled();
    ready = true;
    frame();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 1744, behavior: "auto" });
    expect(reveal).toHaveBeenCalledOnce();
    expect(card.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("corrects a changed line position without jumping back to the header", () => {
    const card = document.createElement("div");
    card.id = "file-src/moving.ts";
    document.body.append(card);
    let position = 1000;
    register("src/moving.ts", { reveal: vi.fn(), position: () => position });
    navigateToDiffLine("src/moving.ts", 90, "additions", () => false);
    frame();
    position = 3000;
    frame();
    frame();
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 2744, behavior: "auto" });
    expect(card.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("explicit cancellation stops queued frames", () => {
    const step = vi.fn(() => false);
    const cancel = scheduleDiffNavigation(step);
    cancel();
    frame();
    expect(step).not.toHaveBeenCalled();
  });

  it("navigates to a registered distant line without rows or checkbox clicks", () => {
    const card = document.createElement("div");
    card.id = "file-src/large.ts";
    document.body.append(card);
    const unregister = register("src/large.ts", {
      reveal: vi.fn(),
      position: (line) => (line === 9000 ? 12000 : undefined),
    });
    navigateToDiffLine("src/large.ts", 9000, "additions");
    frame();
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 11744,
      behavior: "auto",
    });
    unregister();
  });

  it("stops when the target card is disconnected", () => {
    const card = document.createElement("div");
    card.id = "file-src/file.ts";
    document.body.append(card);
    register("src/file.ts", { reveal: vi.fn(), position: () => 1000 });
    navigateToDiffLine("src/file.ts", 10, "additions");
    card.remove();
    frame();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("onArrive retries without re-scrolling", () => {
    const card = document.createElement("div");
    card.id = "file-src/file.ts";
    document.body.append(card);
    const row = document.createElement("div");
    row.dataset.line = "10";
    row.dataset.lineType = "change-addition";
    card.append(row);
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 256, bottom: 278, height: 22 } as DOMRect);
    const onArrive = vi.fn(() => true).mockReturnValueOnce(false);
    register("src/file.ts", { reveal: vi.fn(), position: () => 1000 });
    navigateToDiffLine("src/file.ts", 10, "additions", onArrive);
    for (let i = 0; i < 12; i++) frame();
    expect(window.scrollTo).toHaveBeenCalledOnce();
    expect(onArrive).toHaveBeenCalledTimes(2);
    expect(getDiffNavigationState()?.state).toBe("arrived");
  });

  it("retries a browser-clamped scroll when the expanded document becomes tall enough", () => {
    let y = 0;
    let maxScroll = 100;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockImplementation(() => maxScroll + window.innerHeight);
    vi.mocked(window.scrollTo).mockImplementation(options => { y = Math.min((options as ScrollToOptions).top ?? 0, maxScroll); });
    const card = document.createElement("div");
    card.id = "file-growing.ts";
    document.body.append(card);
    const row = document.createElement("div");
    row.dataset.line = "10";
    row.dataset.lineType = "change-addition";
    card.append(row);
    vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => ({ top: 1000 - y, bottom: 1022 - y, height: 22 } as DOMRect));
    register("growing.ts", { reveal: vi.fn(), position: () => 1000 });
    navigateToDiffLine("growing.ts", 10, "additions");
    frame();
    expect(y).toBe(100);
    maxScroll = 5000;
    for (let i = 0; i < 12; i++) frame();
    expect(y).toBe(744);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(getDiffNavigationState()?.state).toBe("arrived");
  });

  it("reports unavailable targets instead of claiming success", () => {
    navigateToDiffLine("missing.ts", 10, "additions");
    expect(getDiffNavigationState()).toEqual({ path: "missing.ts", line: 10, state: "unavailable" });
  });

  it("reports a timeout when no row ever becomes ready", () => {
    const card = document.createElement("div");
    card.id = "file-slow.ts";
    document.body.append(card);
    register("slow.ts", { reveal: vi.fn(), position: () => undefined });
    navigateToDiffLine("slow.ts", 10, "additions");
    now = 3000;
    frame();
    expect(getDiffNavigationState()?.state).toBe("timed-out");
    expect(queue).toHaveLength(0);
  });

  it("does not claim arrival for a mounted but offscreen row", () => {
    const card = document.createElement("div");
    card.id = "file-offscreen.ts";
    document.body.append(card);
    const row = document.createElement("div");
    row.dataset.line = "10";
    row.dataset.lineType = "change-addition";
    card.append(row);
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 3000, bottom: 3022, height: 22 } as DOMRect);
    register("offscreen.ts", { reveal: vi.fn(), position: () => 3000 });
    const onArrive = vi.fn(() => true);
    navigateToDiffLine("offscreen.ts", 10, "additions", onArrive);
    for (let i = 0; i < 20; i++) frame();
    expect(onArrive).not.toHaveBeenCalled();
    expect(getDiffNavigationState()?.state).toBe("loading");
    window.dispatchEvent(new Event("wheel"));
    expect(getDiffNavigationState()?.state).toBe("cancelled");
    expect(queue).toHaveLength(0);
  });
});
