import type { AnnotationSide } from "@pierre/diffs";
import { findDiffLine, isLineVisible } from "./diffRows";
import { runNavigationJob, type NavigationOutcome } from "./navigationJob";

interface FileTarget {
  reveal: () => void;
  position: (line: number, side: AnnotationSide) => number | undefined;
  /** False while a requested full-context renderer is still loading. */
  isReady?: () => boolean;
}
export interface DiffNavigationState {
  path: string;
  line: number;
  state: "loading" | NavigationOutcome;
}
const targets = new Map<string, FileTarget>();
let cancelCurrent: (() => void) | undefined;
let currentTarget: string | undefined;
let navigationState: DiffNavigationState | null = null;
const listeners = new Set<() => void>();
export const getDiffNavigationState = () => navigationState;
export function subscribeDiffNavigation(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function report(state: DiffNavigationState) {
  navigationState = state;
  for (const listener of listeners) listener();
}

export function cancelDiffNavigation() {
  cancelCurrent?.();
}

/** End the previous review surface's jobs and announcements. */
export function resetDiffNavigation() {
  cancelDiffNavigation();
  navigationState = null;
  for (const listener of listeners) listener();
}

export function registerDiffTarget(path: string, target: FileTarget) {
  targets.set(path, target);
  return () => {
    if (targets.get(path) !== target) return;
    targets.delete(path);
    if (currentTarget === path) cancelDiffNavigation();
  };
}

/** One bounded job at a time. Subsequent user input always wins over a delayed jump. */
export function scheduleDiffNavigation(
  step: () => boolean | "unavailable",
  timeoutMs = 3000,
  targetPath?: string,
  onFinish?: (outcome: NavigationOutcome) => void,
) {
  cancelDiffNavigation();
  const cancel = runNavigationJob(step, outcome => {
    if (cancelCurrent === cancel) {
      cancelCurrent = undefined;
      currentTarget = undefined;
    }
    onFinish?.(outcome);
  }, timeoutMs);
  cancelCurrent = cancel;
  currentTarget = targetPath;
  return cancel;
}

export function navigateToFile(path: string) {
  cancelDiffNavigation();
  document.getElementById(`file-${path}`)?.scrollIntoView({ block: "start", behavior: "auto" });
}

export function navigateToDiffLine(
  path: string,
  line: number,
  side: AnnotationSide,
  onArrive?: () => boolean,
  onFinish?: (outcome: NavigationOutcome) => void,
) {
  cancelDiffNavigation();
  const finish = (state: NavigationOutcome) => {
    report({ path, line, state });
    onFinish?.(state);
  };
  const card = document.getElementById(`file-${path}`);
  if (!card) {
    finish("unavailable");
    return () => {};
  }
  report({ path, line, state: "loading" });
  let revealed: FileTarget | undefined;
  const reveal = () => {
    const target = targets.get(path);
    if (target && target !== revealed) {
      revealed = target;
      target.reveal();
    }
    return target;
  };
  reveal();
  // Mount an off-screen target once. Never return to its header during retries.
  card.scrollIntoView({ block: "nearest", behavior: "auto" });
  let lastPosition: number | undefined;
  let stableSince = performance.now();
  return scheduleDiffNavigation(() => {
    if (!card.isConnected) return "unavailable";
    const target = reveal();
    const position = target?.position(line, side);
    if (position == null || !Number.isFinite(position)) {
      lastPosition = undefined;
      return false;
    }
    const row = findDiffLine(card, line, side);
    const visible = !!row && isLineVisible(row);
    const top = Math.max(0, position - Math.max(100, window.innerHeight / 3));
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    // Expanding a card can grow the scroll range AFTER the first scroll was
    // clamped to the old document bottom, without changing the line estimate.
    const clampedScrollMissed = !visible && Math.abs(window.scrollY - Math.min(top, maxScroll)) > 1;
    if (lastPosition == null || Math.abs(position - lastPosition) > 1 || clampedScrollMissed) {
      window.scrollTo({ top, behavior: "auto" });
      lastPosition = position;
      stableSince = performance.now();
      return false;
    }
    // Render callbacks refresh the target's position and readiness. Give measured
    // layout a short settling window rather than treating the first estimate as final.
    if (target?.isReady?.() === false) {
      stableSince = performance.now();
      return false;
    }
    if (performance.now() - stableSince < 100) return false;
    if (!visible) return false;
    return onArrive?.() ?? true;
  }, 3000, path, finish);
}
