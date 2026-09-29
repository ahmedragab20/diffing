// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { usePrCommits } from "../../hooks/usePrCommits";
import { PrCommitNavigator } from "../PrCommitNavigator";

const commits = [
  {
    sha: "commit-a",
    subject: "Add parser",
    body: "",
    author: "Ada",
    authoredAt: "2026-01-01",
    parents: [],
  },
  {
    sha: "commit-b",
    subject: "Fix parser",
    body: "Details",
    author: "Grace",
    authoredAt: "2026-01-02",
    parents: ["commit-a"],
  },
];

function review(
  overrides: Partial<ReturnType<typeof usePrCommits>> = {}
): ReturnType<typeof usePrCommits> {
  return {
    commits,
    selectedSha: null,
    selectedCommit: null,
    select: vi.fn(),
    reviewedCommits: new Set(),
    setReviewed: vi.fn(),
    viewedFiles: new Set(),
    setViewed: vi.fn(),
    total: commits.length,
    complete: true,
    listLoading: false,
    listError: null,
    retryList: vi.fn(),
    patch: null,
    diffLoading: false,
    diffError: null,
    retryDiff: vi.fn(),
    ...overrides,
  } as ReturnType<typeof usePrCommits>;
}

describe("PrCommitNavigator", () => {
  it("renders all changes and selects a commit directly", () => {
    const onSelect = vi.fn();
    render(
      <PrCommitNavigator
        review={review()}
        onSelect={onSelect}
        fileCount={3}
        prUrl="https://github.test/pr/7"
      />
    );
    expect(screen.getByRole("button", { name: "All changes" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Select commit to review" }),
      { target: { value: "commit-b" } }
    );
    expect(onSelect).toHaveBeenCalledWith("commit-b");
  });

  it("navigates next and previous with disabled bounds", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <PrCommitNavigator
        review={review({ selectedSha: "commit-a", selectedCommit: commits[0] })}
        onSelect={onSelect}
        fileCount={1}
        prUrl="https://github.test/pr/7"
      />
    );
    expect(
      screen.getByRole("button", { name: "Previous commit" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next commit" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Next commit" }));
    expect(onSelect).toHaveBeenCalledWith("commit-b");
    onSelect.mockClear();
    rerender(
      <PrCommitNavigator
        review={review({ selectedSha: "commit-b", selectedCommit: commits[1] })}
        onSelect={onSelect}
        fileCount={1}
        prUrl="https://github.test/pr/7"
      />
    );
    expect(screen.getByRole("button", { name: "Next commit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous commit" }));
    expect(onSelect).toHaveBeenCalledWith("commit-a");
  });

  it("handles navigation bounds for zero and one commit", () => {
    const { unmount: unmountZero } = render(
      <PrCommitNavigator
        review={review({ commits: [], total: 0 })}
        onSelect={vi.fn()}
        fileCount={0}
        prUrl="https://github.test/pr/7"
      />
    );
    expect(
      screen.getByRole("button", { name: "Previous commit" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next commit" })).toBeDisabled();
    unmountZero();

    const onSelect = vi.fn();
    const { rerender, unmount } = render(
      <PrCommitNavigator
        review={review({ commits: [commits[0]], total: 1 })}
        onSelect={onSelect}
        fileCount={0}
        prUrl="https://github.test/pr/7"
      />
    );
    expect(
      screen.getByRole("button", { name: "Previous commit" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next commit" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Next commit" }));
    expect(onSelect).toHaveBeenCalledWith(commits[0].sha);
    rerender(
      <PrCommitNavigator
        review={review({
          commits: [commits[0]],
          total: 1,
          selectedSha: commits[0].sha,
          selectedCommit: commits[0],
        })}
        onSelect={onSelect}
        fileCount={0}
        prUrl="https://github.test/pr/7"
      />
    );
    expect(
      screen.getByRole("button", { name: "Previous commit" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next commit" })).toBeDisabled();
    unmount();
  });

  it("calls the reviewed toggle only when a patch is available", () => {
    const setReviewed = vi.fn();
    const onSelect = vi.fn();
    const current = review({
      selectedSha: "commit-a",
      selectedCommit: commits[0],
      patch: "diff",
      setReviewed,
    });
    render(
      <PrCommitNavigator
        review={current}
        onSelect={onSelect}
        fileCount={2}
        prUrl="https://github.test/pr/7"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(setReviewed).toHaveBeenCalledWith("commit-a", true);
  });

  it("shows list failures with a retry action", () => {
    const retryList = vi.fn();
    render(
      <PrCommitNavigator
        review={review({
          listError: new Error("GitHub unavailable"),
          retryList,
        })}
        onSelect={vi.fn()}
        fileCount={0}
        prUrl="https://github.test/pr/7"
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("GitHub unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry commits" }));
    expect(retryList).toHaveBeenCalledOnce();
  });

  it("links to the complete PR commit list when the response is incomplete", () => {
    render(
      <PrCommitNavigator
        review={review({ complete: false, total: 4 })}
        onSelect={vi.fn()}
        fileCount={0}
        prUrl="https://github.test/pr/7"
      />
    );
    const link = screen.getByRole("link", { name: "View all on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.test/pr/7/commits");
    expect(screen.getByText("Showing 2 of 4 commits.")).toBeInTheDocument();
  });
});
