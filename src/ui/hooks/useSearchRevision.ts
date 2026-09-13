import { useSyncExternalStore } from "react";
import { subscribeLive } from "../live";

// Search results, previews and saved navigation must share a repository epoch.
// A new key also prevents a response started before a change from becoming current.
let revision = 0;
const listeners = new Set<() => void>();
let disconnect: (() => void) | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!disconnect) {
    const changed = () => {
      revision++;
      for (const notify of listeners) notify();
    };
    const offChange = subscribeLive("change", changed);
    const offPr = subscribeLive("pr-session", changed);
    disconnect = () => {
      offChange();
      offPr();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      disconnect?.();
      disconnect = undefined;
      // Changes while no search consumer is mounted must not reuse old caches.
      revision++;
    }
  };
}

export function useSearchRevision() {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0,
  );
}
