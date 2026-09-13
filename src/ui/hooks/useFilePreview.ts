import { useQuery } from "@tanstack/react-query";
import { useSearchRevision } from "./useSearchRevision";

export interface FilePreviewState {
  content: string | null;
  /** The file has no working-tree version (e.g. deleted). */
  missing: boolean;
  /** The file is binary and cannot be previewed as text. */
  binary: boolean;
}

/**
 * Lazily fetch the working-tree text of a file for the palette's preview pane.
 * Reuses the existing `/api/file-text` endpoint (path-traversal guarded server
 * side). Cache entries are scoped to the working tree and repository revision.
 */
export function useFilePreview(path: string | null) {
  const revision = useSearchRevision();
  return useQuery<FilePreviewState>({
    queryKey: ["file-text", "working-tree", revision, path],
    enabled: !!path,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<FilePreviewState> => {
      const res = await fetch(
        `/api/file-text?path=${encodeURIComponent(path!)}&version=working`,
        { signal },
      );
      // The endpoint replies 415 for binary files.
      if (res.status === 415)
        return { content: null, missing: false, binary: true };
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
      const json = (await res.json()) as {
        content?: string;
        missing?: boolean;
        error?: string;
      };
      if (json.error) {
        if (/binary/i.test(json.error))
          return { content: null, missing: false, binary: true };
        throw new Error(json.error);
      }
      if (json.missing) return { content: null, missing: true, binary: false };
      return { content: json.content ?? "", missing: false, binary: false };
    },
  });
}
