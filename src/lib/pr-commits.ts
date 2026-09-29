/** Browser-safe contracts for browsing an immutable PR commit snapshot. */
export interface PrCommit {
  sha: string;
  subject: string;
  body: string;
  author: string;
  authoredAt: string;
  parents: string[];
}

export interface PrCommitList {
  headSha: string;
  commits: PrCommit[];
  total: number;
  complete: boolean;
}

export interface PrCommitDiff {
  headSha: string;
  sha: string;
  patch: string;
}
