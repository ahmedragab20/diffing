//! `ReviewDecision` enum mirroring `src/lib/types.ts#ReviewDecision`.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewDecision {
    Approved,
    ChangesRequested,
    Rejected,
    CommentOnly,
}

impl ReviewDecision {
    pub const ALL: &'static [ReviewDecision] = &[
        ReviewDecision::Approved,
        ReviewDecision::ChangesRequested,
        ReviewDecision::Rejected,
        ReviewDecision::CommentOnly,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ReviewDecision::Approved => "approved",
            ReviewDecision::ChangesRequested => "changes-requested",
            ReviewDecision::Rejected => "rejected",
            ReviewDecision::CommentOnly => "comment-only",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ReviewDecision::Approved => "Approve",
            ReviewDecision::ChangesRequested => "Request edits",
            ReviewDecision::Rejected => "Reject",
            ReviewDecision::CommentOnly => "Comment only",
        }
    }

    #[allow(dead_code)]
    pub fn from_slug(s: &str) -> Option<ReviewDecision> {
        match s {
            "approved" => Some(ReviewDecision::Approved),
            "changes-requested" => Some(ReviewDecision::ChangesRequested),
            "rejected" => Some(ReviewDecision::Rejected),
            "comment-only" => Some(ReviewDecision::CommentOnly),
            _ => None,
        }
    }

    pub fn mode(self) -> &'static str {
        if self == Self::CommentOnly {
            "comment-only"
        } else {
            "standard"
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Approved => "The changes look good. The agent can proceed.",
            Self::ChangesRequested => "Ask the agent to address your comments and make edits.",
            Self::Rejected => "Ask the agent to rethink this approach before continuing.",
            Self::CommentOnly => "Discuss and answer questions. The agent must not edit files.",
        }
    }
}

impl fmt::Display for ReviewDecision {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_round_trip() {
        for d in ReviewDecision::ALL {
            assert_eq!(ReviewDecision::from_slug(d.as_str()), Some(*d));
        }
    }
}
