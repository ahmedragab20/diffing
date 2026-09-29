import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PrCommitDiff, PrCommitList } from "../../lib/pr-commits";
import { getUiStateItem, setUiStateItem } from "../utils/uiState";

const EMPTY_COMMITS: PrCommitList["commits"] = [];
const EMPTY_FILES: string[] = [];
type Progress = { reviewed: string[]; files: Record<string, string[]> };

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function readProgress(key: string): Progress {
  try {
    const saved = JSON.parse(getUiStateItem(key) ?? "null");
    if (
      Array.isArray(saved?.reviewed) &&
      saved.reviewed.every((sha: unknown) => typeof sha === "string") &&
      saved.files &&
      typeof saved.files === "object" &&
      Object.values(saved.files).every(
        (paths) =>
          Array.isArray(paths) &&
          paths.every((path) => typeof path === "string")
      )
    )
      return saved;
  } catch {
    /* Ignore older or invalid UI state. */
  }
  return { reviewed: [], files: {} };
}

export function usePrCommits(
  session: { url: string; headSha: string } | null | undefined
) {
  const identity = session?.url ?? "";
  const headSha = session?.headSha ?? "";
  const scope = `${identity}:${headSha}`;
  const [selection, setSelection] = useState<{
    scope: string;
    sha: string;
  } | null>(null);
  const selectedSha = selection?.scope === scope ? selection.sha : null;
  const query = `headSha=${encodeURIComponent(headSha)}`;
  const list = useQuery({
    queryKey: ["pr-commits", identity, headSha],
    queryFn: ({ signal }) =>
      read<PrCommitList>(`/api/gh/commits?${query}`, signal),
    enabled: !!session,
    staleTime: Infinity,
    retry: false,
  });
  const diff = useQuery({
    queryKey: ["pr-commit-diff", identity, headSha, selectedSha],
    queryFn: ({ signal }) =>
      read<PrCommitDiff>(
        `/api/gh/commits/${selectedSha}/diff?${query}`,
        signal
      ),
    enabled: !!session && !!selectedSha,
    staleTime: Infinity,
    retry: false,
  });
  const progressKey = `diffing-pr-commit-progress:${identity}`;
  const [progressState, setProgressState] = useState(() => ({
    key: progressKey,
    value: readProgress(progressKey),
  }));
  const progress = useMemo(
    () =>
      progressState.key === progressKey
        ? progressState.value
        : readProgress(progressKey),
    [progressKey, progressState]
  );
  const updateProgress = useCallback(
    (change: (value: Progress) => Progress) => {
      setProgressState((current) => {
        const next = change(
          current.key === progressKey
            ? current.value
            : readProgress(progressKey)
        );
        setUiStateItem(progressKey, JSON.stringify(next));
        return { key: progressKey, value: next };
      });
    },
    [progressKey]
  );
  const commits = list.data?.commits ?? EMPTY_COMMITS;
  const selectedCommit =
    commits.find((commit) => commit.sha === selectedSha) ?? null;
  const reviewedCommits = useMemo(
    () => new Set(progress.reviewed),
    [progress.reviewed]
  );
  const paths = (selectedSha && progress.files[selectedSha]) || EMPTY_FILES;
  const viewedFiles = useMemo(() => new Set(paths), [paths]);
  const setViewed = useCallback(
    (path: string, viewed: boolean) => {
      if (!selectedSha) return;
      updateProgress((current) => {
        const paths = new Set(current.files[selectedSha] ?? []);
        if (viewed) paths.add(path);
        else paths.delete(path);
        return {
          ...current,
          files: { ...current.files, [selectedSha]: [...paths] },
        };
      });
    },
    [selectedSha, updateProgress]
  );
  const setReviewed = useCallback(
    (sha: string, reviewed: boolean) => {
      updateProgress((current) => ({
        ...current,
        reviewed: reviewed
          ? [...new Set([...current.reviewed, sha])]
          : current.reviewed.filter((item) => item !== sha),
      }));
    },
    [updateProgress]
  );
  const select = useCallback(
    (sha: string | null) => setSelection(sha ? { scope, sha } : null),
    [scope]
  );

  return {
    commits,
    selectedSha,
    selectedCommit,
    select,
    reviewedCommits,
    setReviewed,
    viewedFiles,
    setViewed,
    total: list.data?.total ?? 0,
    complete: list.data?.complete ?? true,
    listLoading: list.isLoading,
    listError: list.error,
    retryList: list.refetch,
    patch:
      diff.data?.sha === selectedSha && diff.data.headSha === headSha
        ? diff.data.patch
        : null,
    diffLoading: !!selectedSha && diff.isLoading,
    diffError: selectedSha ? diff.error : null,
    retryDiff: diff.refetch,
  };
}
