/** Provenance of the patch a card displays, independent of toolbar defaults. */
export interface CodeIntelSource {
	kind: "working" | "staged" | "untracked" | "revision" | "commit" | "pr";
	revision?: string;
	parentRevision?: string;
	baseRevision?: string;
	indexRevision?: string;
}
