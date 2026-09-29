// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../PrChecksPopover", () => ({
  PrChecksPopover: () => <button type="button">2/2 passed</button>,
}));
vi.mock("../../utils/uiState", () => ({ getUiStateItem: () => null, setUiStateItem: vi.fn() }));

import { PrReviewSummaryBanner } from "../PrReviewSummaryBanner";

const session = {
  pullNumber: 42,
  title: "Unify the review experience",
  author: { login: "octocat" },
  changedFiles: 3,
  additions: 21,
  deletions: 8,
  headSha: "abcdef123456",
  headRefName: "feature/widget",
  baseRefName: "main",
} as any;

describe("PrReviewSummaryBanner", () => {
  it("groups PR context outside the action toolbar", () => {
    render(<PrReviewSummaryBanner session={session} draftCount={1} />);

    expect(
      screen.getByRole("region", { name: /pull request #42/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Unify the review experience" }),
    ).toBeInTheDocument();
    expect(screen.getByText("@octocat")).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
    expect(
      screen.getByLabelText("21 additions and 8 deletions"),
    ).toHaveTextContent("+21−8");
    expect(screen.getByText("1 draft")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "2/2 passed" }),
    ).toBeInTheDocument();
  });

  it("omits an empty draft badge", () => {
    render(<PrReviewSummaryBanner session={session} draftCount={0} />);
    expect(screen.queryByText(/1 draft/)).not.toBeInTheDocument();
  });

  it("shows the head and base branch names in the banner", () => {
    render(<PrReviewSummaryBanner session={session} draftCount={0} />);

    expect(screen.getByText("feature/widget")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(
      screen.getByTitle("Comparing feature/widget into main"),
    ).toBeInTheDocument();
  });

  it("omits the branch info when branch names are missing", () => {
    const sessionWithoutBranches = { ...session };
    delete sessionWithoutBranches.headRefName;
    delete sessionWithoutBranches.baseRefName;
    render(
      <PrReviewSummaryBanner session={sessionWithoutBranches} draftCount={0} />,
    );

    expect(screen.queryByText("feature/widget")).not.toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Comparing/)).not.toBeInTheDocument();
  });

  it("lets the reviewer expand the PR description", () => {
    render(
      <PrReviewSummaryBanner
        session={{ ...session, body: "Fixes the race in the handler." }}
        draftCount={0}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Description" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/Fixes the race/)).not.toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByText(/Fixes the race in the handler/)).toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByText(/Fixes the race/)).not.toBeVisible();
  });

  it("collapses the overview while retaining the title and change totals", () => {
    render(<PrReviewSummaryBanner session={session} draftCount={0} />);
    const toggle = screen.getByRole("button", { name: /Overview/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("3 files · +21 −8");
    expect(screen.getByRole("heading", { name: session.title })).toBeVisible();
    expect(screen.getByText("@octocat")).not.toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByText("@octocat")).toBeVisible();
  });

  it("shows omitted-patch completeness when files lack patches", () => {
    render(
      <PrReviewSummaryBanner
        session={{
          ...session,
          diffCompleteness: { listedFiles: 12, omittedPatches: 3 },
        }}
        draftCount={0}
      />,
    );
    expect(screen.getByText("3 of 12 files lack patches")).toBeInTheDocument();
  });
});
