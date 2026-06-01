//! `ReviewDecision` enum mirroring `src/lib/types.ts#ReviewDecision`.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewDecision {
    Approved,
    ChangesRequested,
    Rejected,
}

impl ReviewDecision {
    pub const ALL: &'static [ReviewDecision] = &[
        ReviewDecision::Approved,
        ReviewDecision::ChangesRequested,
        ReviewDecision::Rejected,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ReviewDecision::Approved => "approved",
            ReviewDecision::ChangesRequested => "changes-requested",
            ReviewDecision::Rejected => "rejected",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ReviewDecision::Approved => "Approved",
            ReviewDecision::ChangesRequested => "Request changes",
            ReviewDecision::Rejected => "Rejected",
        }
    }

    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Option<ReviewDecision> {
        match s {
            "approved" => Some(ReviewDecision::Approved),
            "changes-requested" => Some(ReviewDecision::ChangesRequested),
            "rejected" => Some(ReviewDecision::Rejected),
            _ => None,
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
            assert_eq!(ReviewDecision::from_str(d.as_str()), Some(*d));
        }
    }
}
