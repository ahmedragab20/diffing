//! Small, local `.editorconfig` reader for diff rendering.
//!
//! We only need indentation width, so this deliberately avoids loading a
//! general editor configuration engine on the TUI startup path.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct EditorConfigCache {
    widths: HashMap<PathBuf, u8>,
}

impl EditorConfigCache {
    pub fn tab_size_for(&mut self, repo: &Path, relative: &Path, fallback: u8) -> u8 {
        if let Some(width) = self.widths.get(relative) {
            return *width;
        }
        let width = resolve_tab_size(repo, relative, fallback).clamp(1, 16);
        self.widths.insert(relative.to_path_buf(), width);
        width
    }

    pub fn clear(&mut self) {
        self.widths.clear();
    }
}

fn resolve_tab_size(repo: &Path, relative: &Path, fallback: u8) -> u8 {
    let absolute = repo.join(relative);
    let mut directory = absolute.parent();
    let mut configs = Vec::new();
    while let Some(current) = directory {
        if !current.starts_with(repo) {
            break;
        }
        let config = current.join(".editorconfig");
        if let Ok(contents) = std::fs::read_to_string(&config) {
            let root = contents.lines().any(|line| {
                line.split_once('=').is_some_and(|(key, value)| {
                    key.trim().eq_ignore_ascii_case("root")
                        && value.trim().eq_ignore_ascii_case("true")
                })
            });
            configs.push((current.to_path_buf(), contents));
            if root {
                break;
            }
        }
        directory = current.parent();
    }

    let mut width = fallback;
    for (directory, contents) in configs.into_iter().rev() {
        let target = relative_path(&directory, &absolute);
        let mut matches = false;
        for raw_line in contents.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with(['#', ';']) || line.starts_with("root") {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                let pattern = &line[1..line.len() - 1];
                let candidate = if pattern.contains('/') {
                    target.as_str()
                } else {
                    target.rsplit('/').next().unwrap_or(target.as_str())
                };
                matches = pattern_alternatives(pattern)
                    .iter()
                    .any(|pattern| glob_matches(pattern, candidate));
                continue;
            }
            if !matches {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim();
            if key == "tab_width" || key == "indent_size" {
                if let Ok(parsed) = value.parse::<u8>() {
                    width = parsed;
                }
            }
        }
    }
    width
}

fn relative_path(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn pattern_alternatives(pattern: &str) -> Vec<String> {
    let Some(open) = pattern.find('{') else {
        return vec![pattern.to_string()];
    };
    let Some(close_offset) = pattern[open + 1..].find('}') else {
        return vec![pattern.to_string()];
    };
    let close = open + 1 + close_offset;
    pattern[open + 1..close]
        .split(',')
        .map(|choice| format!("{}{}{}", &pattern[..open], choice, &pattern[close + 1..]))
        .collect()
}

fn glob_matches(pattern: &str, value: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let value: Vec<char> = value.chars().collect();
    let mut table = vec![vec![false; value.len() + 1]; pattern.len() + 1];
    table[0][0] = true;
    for p in 0..pattern.len() {
        match pattern[p] {
            '*' => {
                for v in 0..=value.len() {
                    table[p + 1][v] |= table[p][v];
                    if v < value.len() {
                        table[p + 1][v + 1] |= table[p + 1][v];
                    }
                }
            }
            '?' => {
                for v in 0..value.len() {
                    table[p + 1][v + 1] |= table[p][v];
                }
            }
            literal => {
                for v in 0..value.len() {
                    if literal == value[v] {
                        table[p + 1][v + 1] |= table[p][v];
                    }
                }
            }
        }
    }
    table[pattern.len()][value.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_supports_common_editorconfig_sections() {
        assert!(glob_matches("*.{ts,tsx}", "view.tsx") == false);
        assert!(pattern_alternatives("*.{ts,tsx}")
            .iter()
            .any(|pattern| glob_matches(pattern, "view.tsx")));
        assert!(glob_matches("src/*.rs", "src/main.rs"));
    }

    #[test]
    fn nested_editorconfig_overrides_root_width() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(temp.path().join("web")).unwrap();
        std::fs::write(
            temp.path().join(".editorconfig"),
            "root=true\n[*]\nindent_size=4\n",
        )
        .unwrap();
        std::fs::write(
            temp.path().join("web/.editorconfig"),
            "[*.ts]\nindent_size=2\n",
        )
        .unwrap();
        assert_eq!(resolve_tab_size(temp.path(), Path::new("web/app.ts"), 8), 2);
        assert_eq!(resolve_tab_size(temp.path(), Path::new("main.rs"), 8), 4);
    }
}
