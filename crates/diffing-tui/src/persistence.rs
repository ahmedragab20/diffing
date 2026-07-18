//! Additive persistence shared with the web UI's JSON stores.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use diffing_core::project_storage_dir;
use serde_json::{json, Map, Value};

use crate::lsp::IntelligenceMode;
use crate::themes::ThemeName;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileDisplay {
    Single,
    Continuous,
}

impl FileDisplay {
    pub fn label(self) -> &'static str {
        match self {
            Self::Single => "Single file",
            Self::Continuous => "Continuous files",
        }
    }

    pub fn toggle(self) -> Self {
        match self {
            Self::Single => Self::Continuous,
            Self::Continuous => Self::Single,
        }
    }
}

pub struct PersistedTuiState {
    pub viewed_files: HashSet<PathBuf>,
    pub theme: ThemeName,
    pub wrap: bool,
    pub split: bool,
    pub file_display: FileDisplay,
    pub tab_size: u8,
    pub line_numbers: bool,
    pub intelligence_mode: IntelligenceMode,
    pub sidebar_width: u16,
    pub comment_height: u16,
    pub sidebar_visible: bool,
    pub comments_visible: bool,
}

pub fn load(repo_root: &str) -> PersistedTuiState {
    let settings = read_object(&settings_path());
    let ui_state = read_object(&project_storage_dir(repo_root).join("ui-state.json"));
    let theme = settings
        .get("theme")
        .and_then(Value::as_str)
        .and_then(ThemeName::from_label)
        .unwrap_or_default();
    let wrap = settings
        .get("lineWrap")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let split = settings
        .get("diffStyle")
        .and_then(Value::as_str)
        .map(|style| style == "split")
        .unwrap_or(false);
    let file_display = ui_state
        .get("tuiFileDisplay")
        .and_then(Value::as_str)
        .map(|value| match value {
            "continuous" => FileDisplay::Continuous,
            _ => FileDisplay::Single,
        })
        .unwrap_or(FileDisplay::Single);
    let tab_size = settings
        .get("defaultTabSize")
        .and_then(Value::as_u64)
        .unwrap_or(4)
        .clamp(2, 8) as u8;
    let line_numbers = settings
        .get("showLineNumbers")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let intelligence_mode = settings
        .get("tuiLanguageIntelligence")
        .and_then(Value::as_str)
        .map(|value| match value {
            "off" => IntelligenceMode::Off,
            _ => IntelligenceMode::Auto,
        })
        .unwrap_or(IntelligenceMode::Auto);
    let viewed_files = ui_state
        .get("tuiViewedFiles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(PathBuf::from)
        .collect();
    let sidebar_width = ui_state
        .get("tuiSidebarWidth")
        .and_then(Value::as_u64)
        .unwrap_or(34)
        .clamp(22, 72) as u16;
    let comment_height = ui_state
        .get("tuiCommentHeight")
        .and_then(Value::as_u64)
        .unwrap_or(8)
        .clamp(4, 20) as u16;
    let sidebar_visible = ui_state
        .get("tuiSidebarVisible")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let comments_visible = ui_state
        .get("tuiCommentsVisible")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    PersistedTuiState {
        viewed_files,
        theme,
        wrap,
        split,
        file_display,
        tab_size,
        line_numbers,
        intelligence_mode,
        sidebar_width,
        comment_height,
        sidebar_visible,
        comments_visible,
    }
}

pub fn save_layout(
    repo_root: &str,
    sidebar_width: u16,
    comment_height: u16,
    sidebar_visible: bool,
    comments_visible: bool,
    file_display: FileDisplay,
) {
    let path = project_storage_dir(repo_root).join("ui-state.json");
    let mut root = read_object(&path);
    root.insert("tuiSidebarWidth".to_string(), json!(sidebar_width));
    root.insert("tuiCommentHeight".to_string(), json!(comment_height));
    root.insert("tuiSidebarVisible".to_string(), json!(sidebar_visible));
    root.insert("tuiCommentsVisible".to_string(), json!(comments_visible));
    root.insert(
        "tuiFileDisplay".to_string(),
        json!(match file_display {
            FileDisplay::Single => "single",
            FileDisplay::Continuous => "continuous",
        }),
    );
    let _ = write_object(&path, root);
}

pub fn save_viewed(repo_root: &str, viewed: &HashSet<PathBuf>) {
    let path = project_storage_dir(repo_root).join("ui-state.json");
    let mut root = read_object(&path);
    let mut files: Vec<String> = viewed
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    files.sort();
    root.insert("tuiViewedFiles".to_string(), json!(files));
    let _ = write_object(&path, root);
}

pub fn save_settings(
    theme: ThemeName,
    wrap: bool,
    split: bool,
    tab_size: u8,
    line_numbers: bool,
    intelligence_mode: IntelligenceMode,
) {
    let path = settings_path();
    let mut root = read_object(&path);
    root.insert("theme".to_string(), json!(theme.label()));
    root.insert("lineWrap".to_string(), json!(wrap));
    root.insert(
        "diffStyle".to_string(),
        json!(if split { "split" } else { "unified" }),
    );
    root.insert("defaultTabSize".to_string(), json!(tab_size));
    root.insert("showLineNumbers".to_string(), json!(line_numbers));
    root.insert(
        "tuiLanguageIntelligence".to_string(),
        json!(match intelligence_mode {
            IntelligenceMode::Auto => "auto",
            IntelligenceMode::Off => "off",
        }),
    );
    let _ = write_object(&path, root);
}

fn settings_path() -> PathBuf {
    directories::UserDirs::new()
        .map(|dirs| dirs.home_dir().join(".config/diffing/settings.json"))
        .unwrap_or_else(|| PathBuf::from(".config/diffing/settings.json"))
}

fn read_object(path: &Path) -> Map<String, Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_object(path: &Path, value: Map<String, Value>) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let json = serde_json::to_vec_pretty(&Value::Object(value))
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    fs::write(&temp, json)?;
    fs::rename(temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_display_labels_and_toggles_are_stable() {
        assert_eq!(FileDisplay::Single.label(), "Single file");
        assert_eq!(FileDisplay::Single.toggle(), FileDisplay::Continuous);
        assert_eq!(FileDisplay::Continuous.toggle(), FileDisplay::Single);
    }
}
