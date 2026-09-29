import {
  Check,
  ChevronLeft,
  ChevronRight,
  GitCommitHorizontal,
  Layers,
} from "lucide-react";
import type { usePrCommits } from "../hooks/usePrCommits";

export function PrCommitNavigator({
  review,
  onSelect,
  fileCount,
  prUrl,
}: {
  review: ReturnType<typeof usePrCommits>;
  onSelect: (sha: string | null) => void;
  fileCount: number;
  prUrl: string;
}) {
  const { commits, selectedSha, selectedCommit, reviewedCommits } = review;
  const index = commits.findIndex((commit) => commit.sha === selectedSha);
  const reviewed = commits.filter((commit) =>
    reviewedCommits.has(commit.sha)
  ).length;
  return (
    <section className="pr-commit-navigator" aria-label="Review commits">
      <div className="pr-commit-controls">
        <button
          type="button"
          className={`btn btn-sm pr-all-changes ${
            selectedSha ? "" : "is-active"
          }`}
          aria-pressed={!selectedSha}
          onClick={() => onSelect(null)}
        >
          <Layers size={14} /> All changes
        </button>
        <div className="pr-commit-select-wrap">
          <GitCommitHorizontal size={15} aria-hidden="true" />
          <select
            aria-label="Select commit to review"
            value={selectedSha ?? ""}
            disabled={commits.length === 0}
            onChange={(event) => onSelect(event.target.value || null)}
          >
            <option value="">
              {review.listLoading
                ? "Loading commits…"
                : `${review.total} commit${review.total === 1 ? "" : "s"}`}
            </option>
            {commits.map((commit, i) => (
              <option key={commit.sha} value={commit.sha}>
                {reviewedCommits.has(commit.sha) ? "✓ " : ""}
                {i + 1}. {commit.sha.slice(0, 7)} · {commit.subject}
              </option>
            ))}
          </select>
        </div>
        <nav className="pr-commit-step" aria-label="Navigate commits">
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Previous commit"
            disabled={index <= 0}
            onClick={() => onSelect(commits[index - 1].sha)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>{index < 0 ? "All" : `${index + 1} / ${commits.length}`}</span>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Next commit"
            disabled={commits.length === 0 || index === commits.length - 1}
            onClick={() => onSelect(commits[index + 1].sha)}
          >
            <ChevronRight size={15} />
          </button>
        </nav>
        <span className="pr-commit-progress">
          {reviewed} / {review.total} reviewed
        </span>
      </div>
      {review.listError && (
        <div className="pr-commit-notice" role="alert">
          {review.listError.message}{" "}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void review.retryList()}
          >
            Retry commits
          </button>
        </div>
      )}
      {!review.complete && (
        <div className="pr-commit-notice">
          Showing {commits.length} of {review.total} commits.{" "}
          <a href={`${prUrl}/commits`} target="_blank" rel="noreferrer">
            View all on GitHub
          </a>
        </div>
      )}
      {selectedCommit && (
        <div className="pr-commit-detail">
          <div className="pr-commit-identity">
            <code>{selectedCommit.sha.slice(0, 7)}</code>
            <strong>{selectedCommit.subject}</strong>
            <span>by {selectedCommit.author}</span>
            <span>
              {review.diffLoading
                ? "Loading…"
                : review.diffError
                ? "Diff unavailable"
                : `${fileCount} file${fileCount === 1 ? "" : "s"}`}
            </span>
          </div>
          {selectedCommit.body && (
            <details className="pr-commit-message">
              <summary>Commit message</summary>
              <p>{selectedCommit.body}</p>
            </details>
          )}
          <div className="pr-commit-review-row">
            <p>
              Review this commit’s changes.{" "}
              <button type="button" onClick={() => onSelect(null)}>
                Go to all changes to comment.
              </button>
            </p>
            <button
              type="button"
              className={`btn btn-sm ${
                reviewedCommits.has(selectedSha!) ? "is-reviewed" : ""
              }`}
              aria-pressed={reviewedCommits.has(selectedSha!)}
              disabled={review.patch === null || !!review.diffError}
              onClick={() =>
                review.setReviewed(
                  selectedSha!,
                  !reviewedCommits.has(selectedSha!)
                )
              }
            >
              <Check size={14} />
              {reviewedCommits.has(selectedSha!) ? "Reviewed" : "Mark reviewed"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
