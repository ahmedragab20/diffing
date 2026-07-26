use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffContext {
    pub kind: DiffContextKind,
    pub headline: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiffContextKind {
    WorkingTree,
    StagedOnly,
    Range,
    Commit,
}

impl DiffContext {
    pub fn from_env_or_args(git_diff_args: &[String]) -> Self {
        std::env::var("DIFFING_TUI_DIFF_CONTEXT")
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| Self::fallback(git_diff_args))
    }

    fn fallback(git_diff_args: &[String]) -> Self {
        let staged = git_diff_args
            .iter()
            .any(|arg| matches!(arg.as_str(), "--staged" | "--cached"));
        let revisions: Vec<&str> = git_diff_args
            .iter()
            .take_while(|arg| arg.as_str() != "--")
            .filter(|arg| !arg.starts_with('-'))
            .map(String::as_str)
            .collect();

        if !revisions.is_empty() {
            return Self {
                kind: DiffContextKind::Range,
                headline: format!("Comparing {}", revisions.join(" ")),
                detail: None,
            };
        }
        if staged {
            return Self {
                kind: DiffContextKind::StagedOnly,
                headline: "Staged changes".to_string(),
                detail: None,
            };
        }
        Self {
            kind: DiffContextKind::WorkingTree,
            headline: "Working-tree changes".to_string(),
            detail: None,
        }
    }

    pub fn marker(&self) -> &'static str {
        match self.kind {
            DiffContextKind::WorkingTree => "●",
            DiffContextKind::StagedOnly => "◆",
            DiffContextKind::Range => "⇄",
            DiffContextKind::Commit => "◇",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_json_matches_the_node_cli_shape() {
        let context: DiffContext = serde_json::from_str(
            r#"{"kind":"range","headline":"Comparing main..feature","detail":"Path: src"}"#,
        )
        .unwrap();
        assert_eq!(context.kind, DiffContextKind::Range);
        assert_eq!(context.headline, "Comparing main..feature");
        assert_eq!(context.detail.as_deref(), Some("Path: src"));
    }

    #[test]
    fn fallback_distinguishes_staged_and_revision_diffs() {
        let staged = DiffContext::fallback(&["--staged".to_string()]);
        assert_eq!(staged.kind, DiffContextKind::StagedOnly);

        let range = DiffContext::fallback(&["main..feature".to_string()]);
        assert_eq!(range.kind, DiffContextKind::Range);
        assert_eq!(range.headline, "Comparing main..feature");
    }
}
