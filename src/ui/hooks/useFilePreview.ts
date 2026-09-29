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
export function useFilePreview(path: string | null, codeIntel?: Pick<import('../lib/definitionPeek').DefinitionPeekRequest, 'source' | 'side' | 'staged'>) {
  const revision = useSearchRevision();
  return useQuery<FilePreviewState>({
    queryKey: ["file-text", codeIntel ?? "working-tree", revision, path],
    enabled: !!path,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<FilePreviewState> => {
      const res = await fetch(
        codeIntel ? '/api/code-intel/file' : `/api/file-text?path=${encodeURIComponent(path!)}&version=working`,
        codeIntel ? { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, ...codeIntel }) } : { signal },
      );
      // The endpoint replies 415 for binary files.
      if (res.status === 415)
        return { content: null, missing: false, binary: true };
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
      const json = (await res.json()) as {
        content?: string;
        missing?: boolean;
        error?: string;
        binary?: boolean;
      };
      if (json.error) {
        if (/binary/i.test(json.error))
          return { content: null, missing: false, binary: true };
        throw new Error(json.error);
      }
      if (json.missing) return { content: null, missing: true, binary: false };
      if (json.binary) return { content: null, missing: false, binary: true };
      return { content: json.content ?? "", missing: false, binary: false };
    },
  });
}
