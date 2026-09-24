import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getDiffNavigationState,
  resetDiffNavigation,
  subscribeDiffNavigation,
  type DiffNavigationState,
} from "../lib/diffNavigation";

/** Remains available in zen mode and when the optional status bar is hidden. */
export function DiffNavigationStatus() {
  const navigation = useSyncExternalStore(subscribeDiffNavigation, getDiffNavigationState, () => null);
  const [dismissed, setDismissed] = useState<DiffNavigationState | null>(null);
  useEffect(() => resetDiffNavigation, []);
  useEffect(() => {
    if (!navigation || navigation.state === "loading") return;
    const timer = setTimeout(() => setDismissed(navigation), 3500);
    return () => clearTimeout(timer);
  }, [navigation]);

  let message = "";
  if (navigation && navigation !== dismissed) {
    const target = `${navigation.path}:${navigation.line}`;
    switch (navigation.state) {
      case "loading": message = `Opening ${target}…`; break;
      case "arrived": message = `Jumped to ${target}`; break;
      case "cancelled": message = "Jump cancelled"; break;
      case "unavailable": message = `Cannot open ${target} — no longer in this view`; break;
      case "timed-out": message = `Could not reach ${target} — try the result again`; break;
    }
  }
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={message ? "diff-navigation-status" : undefined}>
      {message}
    </div>
  );
}
