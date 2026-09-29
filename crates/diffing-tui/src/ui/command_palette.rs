//! Discoverable commands shared by keyboard and pointer navigation.

#[derive(Debug, Clone, Copy)]
pub struct PaletteCommand {
    pub command: &'static str,
    pub label: &'static str,
    pub key: &'static str,
    pub review_only: bool,
}

macro_rules! commands {
    ($(($command:literal, $label:literal, $key:literal, $review:literal)),* $(,)?) => {
        pub const COMMANDS: &[PaletteCommand] = &[$(PaletteCommand {
            command: $command, label: $label, key: $key, review_only: $review,
        }),*];
    };
}

commands![
    ("find", "Find a file", "f", false),
    ("search", "Search changes", "/", false),
    ("comment", "Add a line comment", "c", true),
    ("viewed", "Mark file viewed / unviewed", "v", true),
    ("send", "Send review to agent", "S", true),
    ("agent-reply", "Open latest agent reply", "", true),
    ("focus", "Toggle focused reading", "zf", false),
    ("settings", "Open settings", ",", false),
    ("help", "Keyboard reference", "?", false),
    ("symbols", "Find a symbol", "gs", false),
    ("next", "Next file", "J", false),
    ("previous", "Previous file", "K", false),
    ("next-hunk", "Next hunk", "]h", false),
    ("previous-hunk", "Previous hunk", "[h", false),
    ("file-comment", "Add a file comment", "C", true),
    ("comments", "Show / hide comments", "", true),
    ("sidebar", "Show / hide files", "b", false),
    ("split", "Side-by-side diff", "m", false),
    ("unified", "Unified diff", "m", false),
    ("wrap", "Toggle line wrapping", "w", false),
    ("numbers", "Show / hide line numbers", "#", false),
    ("single", "Read one file at a time", "", false),
    ("continuous", "Read all files continuously", "", false),
    ("image", "Open image fullscreen", "i", false),
    ("refresh", "Refresh changes", "", false),
    ("theme", "Choose a theme", "t", false),
    ("top", "Go to first row", "Home", false),
    ("bottom", "Go to last row", "End", false),
    ("quit", "Quit diffing", "q", false),
];

impl PaletteCommand {
    pub fn description(&self) -> &'static str {
        match self.command {
            "find" => "Navigate · Search file names and preview before opening",
            "search" => "Navigate · Find text across your changes",
            "comment" => "Review · Attach feedback to the selected source line",
            "viewed" => "Review · Keep track of files you have checked",
            "send" => "Review · Choose a verdict and hand feedback to your agent",
            "agent-reply" => "Review · Read the latest incoming agent response in its thread",
            "focus" => "Workspace · Hide panels temporarily; zf restores your layout",
            "settings" => "Preferences · Diff display, workspace, language tools and theme",
            "help" => "Reference · Browse all keyboard shortcuts",
            "symbols" => "Navigate · Find definitions in the current changes",
            "file-comment" => "Review · Add feedback about the whole file",
            "comments" => "Workspace · Toggle the review thread panel",
            "sidebar" => "Workspace · Toggle the changed-files panel",
            "split" => "Display · Compare the old and new code side by side",
            "unified" => "Display · Read changes in one column",
            "wrap" => "Display · Keep long source lines within the viewport",
            "theme" => "Appearance · Preview a theme; Esc restores the original",
            "refresh" => "Workspace · Reload changes from git",
            "quit" => "Exit · Saved comments and preferences are kept",
            _ => "Enter runs this action · Esc returns to your diff",
        }
    }
}

pub fn matching_commands(query: &str, review: bool) -> Vec<&'static PaletteCommand> {
    let query = query.trim().to_ascii_lowercase();
    COMMANDS
        .iter()
        .filter(|entry| review || !entry.review_only)
        .filter(|entry| {
            let label = entry.label.to_ascii_lowercase();
            query
                .split_whitespace()
                .all(|word| entry.command.contains(word) || label.contains(word))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_can_be_found_by_intent_and_viewer_excludes_review_writes() {
        assert_eq!(matching_commands("line wrap", false)[0].command, "wrap");
        assert_eq!(matching_commands("side-by", false)[0].command, "split");
        assert!(matching_commands("comment", false).is_empty());
        assert_eq!(matching_commands("send", true)[0].command, "send");
        assert!(matching_commands("no such action", true).is_empty());
    }
}
