import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scrollToLine } from "../utils";
import type { DiffLineEntry } from "./useDiffSearch";

/**
 * File-scoped search ("find in file") over the searchable lines of a single
 * diff file — changed lines plus unchanged context lines. The current global
 * search palette (⌘K) searches the whole repo or the whole diff; this session
 * scopes hits to one file so the user can review a specific file's changes
 * line by line.
 *
 * Hits come from `buildFileSearchCorpus` entries (additions + deletions +
 * context), so every hit maps to a rendered diff line and navigation reuses
 * the same `scrollToLine` flash used by palette jumps.
 */
export interface FileSearchSession {
  /** The file currently being searched, or null when the bar is closed. */
  filePath: string | null;
  query: string;
  hits: DiffLineEntry[];
  /** Selected hit; -1 before activation, 0 when there are no hits. */
  index: number;
  /**
   * Bumped on every `open()` call, even when re-opening the same file. The
   * find bar watches it to re-focus (and select) its input — e.g. after the
   * user blurred the field and presses ⌘F again.
   */
  focusNonce: number;
  open: (filePath: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  next: () => void;
  prev: () => void;
  /** A mounted full-context renderer can replace the patch-only corpus. */
  setExpandedEntries?: (path: string, entries: DiffLineEntry[] | null) => void;
}

export function useFileSearch(diffEntries: DiffLineEntry[]) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(-1);
  const cancelJump = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelJump.current?.(), [diffEntries]);
  const [focusNonce, setFocusNonce] = useState(0);
  const [expanded, setExpanded] = useState<{
    path: string;
    entries: DiffLineEntry[];
  } | null>(null);
  const setExpandedEntries = useCallback(
    (path: string, entries: DiffLineEntry[] | null) => {
      setExpanded((current) => {
        if (!entries) return current?.path === path ? null : current;
        if (current?.path === path && current.entries === entries)
          return current;
        return { path, entries };
      });
    },
    [],
  );
  const filePathRef = useRef<string | null>(null);
  filePathRef.current = filePath;

  const hits = useMemo(() => {
    if (!filePath) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const entries =
      expanded?.path === filePath ? expanded.entries : diffEntries;
    return entries.filter(
      (entry) =>
        entry.filePath === filePath && entry.content.toLowerCase().includes(q),
    );
  }, [diffEntries, expanded, filePath, query]);

  // Keep the cursor valid as the query narrows (hits shrink mid-cycle).
  const clampedIndex = hits.length === 0 ? 0 : Math.min(index, hits.length - 1);

  const jumpTo = useCallback(
    (i: number) => {
      const hit = hits[i];
      if (!hit) return;
      cancelJump.current = scrollToLine(hit.filePath, hit.lineNumber, hit.side, query.trim());
    },
    [hits, query],
  );

  const cycle = useCallback(
    (delta: number) => {
      if (hits.length === 0) return;
      const next = clampedIndex < 0
        ? (delta > 0 ? 0 : hits.length - 1)
        : (clampedIndex + delta + hits.length) % hits.length;
      setIndex(next);
      jumpTo(next);
    },
    [hits.length, clampedIndex, jumpTo],
  );

  const next = useCallback(() => cycle(1), [cycle]);
  const prev = useCallback(() => cycle(-1), [cycle]);

  const open = useCallback((path: string) => {
    // Always bump the nonce so an already-open bar re-focuses its input
    // (⌘F after blur). Re-opening the SAME file keeps the query so the user
    // can edit it; switching files starts a fresh session.
    setFocusNonce((n) => n + 1);
    if (filePathRef.current !== path) {
      cancelJump.current?.();
      setFilePath(path);
      setExpanded(null);
      setQuery("");
      setIndex(-1);
    }
  }, []);

  const close = useCallback(() => {
    cancelJump.current?.();
    setFilePath(null);
    setExpanded(null);
    setQuery("");
    setIndex(-1);
  }, []);

  const changeQuery = useCallback((q: string) => {
    cancelJump.current?.();
    setQuery(q);
    setIndex(-1);
  }, []);

  // Stable identity so memoized diff surfaces don't re-render on every
  // parent render (every member above is already state or a stable callback).
  return useMemo(
    () => ({
      filePath,
      query,
      hits,
      index: clampedIndex,
      focusNonce,
      open,
      close,
      setQuery: changeQuery,
      next,
      prev,
      setExpandedEntries,
    }),
    [
      filePath,
      query,
      hits,
      clampedIndex,
      focusNonce,
      open,
      close,
      changeQuery,
      next,
      prev,
      setExpandedEntries,
    ],
  );
}
