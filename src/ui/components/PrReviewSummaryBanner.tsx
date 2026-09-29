import { FileText, GitPullRequest, Info } from "lucide-react";
import type { PrSession } from "../../lib/pr-session";
import { PrChecksPopover } from "./PrChecksPopover";
import { Markdown } from "./Markdown";
import { PrAuthorActions } from "./PrAuthorActions";
import { PrReviewSection } from "./PrReviewSection";

interface PrReviewSummaryBannerProps {
  session: PrSession;
  draftCount: number;
  onAuthorChanged?: () => void;
}

/** GitHub-specific context, kept out of the action toolbar. */
export function PrReviewSummaryBanner({
  session,
  draftCount,
  onAuthorChanged,
}: PrReviewSummaryBannerProps) {
  return (
    <section
      className="pr-overview-banner"
      aria-label={`Pull request #${session.pullNumber}: ${session.title}`}
    >
      <header className="pr-overview-heading">
        <span className="pr-overview-eyebrow">
          Pull request #{session.pullNumber}
        </span>
        <div className="diff-overview-banner-line">
          <GitPullRequest
            size={20}
            className="pr-overview-icon"
            aria-hidden="true"
          />
          <h2 className="diff-overview-banner-headline">{session.title}</h2>
        </div>
      </header>
      <PrReviewSection
        title="Overview"
        icon={<Info size={14} />}
        storageKey="diffing-pr-overview-open"
        defaultOpen
        summary={`${session.changedFiles} files · +${session.additions} −${session.deletions}`}
      >
        <div className="pr-overview-meta">
          <span className="pr-overview-identity">
            {session.author?.login ? (
              <>
                Opened by <strong>@{session.author.login}</strong>
              </>
            ) : null}
          </span>
          {session.headRefName && session.baseRefName && (
            <span
              className="pr-overview-branches"
              title={`Comparing ${session.headRefName} into ${session.baseRefName}`}
            >
              <code className="pr-overview-branch-head">
                {session.headRefName}
              </code>
              <span className="pr-overview-branch-arrow" aria-hidden="true">
                →
              </span>
              <code className="pr-overview-branch-base">
                {session.baseRefName}
              </code>
            </span>
          )}
          <span>
            {session.changedFiles} file{session.changedFiles === 1 ? "" : "s"}
          </span>
          <span
            className="toolbar-chip-diff"
            aria-label={`${session.additions} additions and ${session.deletions} deletions`}
          >
            <span className="stat-additions">+{session.additions}</span>
            <span className="stat-deletions">−{session.deletions}</span>
          </span>
          {draftCount > 0 && (
            <span className="toolbar-chip toolbar-chip-comments">
              {draftCount} draft{draftCount === 1 ? "" : "s"}
            </span>
          )}
          {session.diffCompleteness &&
            session.diffCompleteness.omittedPatches > 0 && (
              <span
                className="toolbar-chip"
                title="Some files have no patch (binary or over GitHub's per-file cap)"
              >
                {session.diffCompleteness.omittedPatches} of{" "}
                {session.diffCompleteness.listedFiles} files lack patches
              </span>
            )}
          {session.state && (
            <span className="toolbar-chip" data-state={session.state}>
              {session.isDraft ? "draft" : session.state}
            </span>
          )}
          <PrChecksPopover headSha={session.headSha} />
        </div>
        <PrAuthorActions session={session} onChanged={onAuthorChanged} />
      </PrReviewSection>
      {session.body?.trim() ? (
        <PrReviewSection
          title="Description"
          icon={<FileText size={14} />}
          storageKey="diffing-pr-description-open"
        >
          <Markdown
            content={session.body}
            className="pr-overview-description markdown-body"
          />
        </PrReviewSection>
      ) : null}
    </section>
  );
}
