//! Additive persistence shared with the web UI's JSON stores.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use diffing_core::project_storage_dir;
use serde_json::{json, Map, Value};

use crate::lsp::IntelligenceMode;
use crate::themes::ThemeName;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_temp_path(path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("json.{id}.{stamp}.tmp"))
}

fn sweep_stale_temp_files(directory: &Path, keep: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.ends_with(".tmp") {
            let _ = fs::remove_file(path);
        }
    }
}

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
    pub mouse_enabled: bool,
    pub intelligence_mode: IntelligenceMode,
    pub trust_repo_local_bin: bool,
    pub sidebar_width: u16,
    pub comment_height: u16,
    pub sidebar_visible: bool,
    pub comments_visible: bool,
}

pub fn load(repo_root: &str) -> PersistedTuiState {
    let settings_path = settings_path();
    if let Some(path) = settings_path.as_ref() {
        if let Some(parent) = path.parent() {
            sweep_stale_temp_files(parent, path);
        }
    }
    let ui_state_path = project_storage_dir(repo_root).join("ui-state.json");
    if let Some(parent) = ui_state_path.parent() {
        sweep_stale_temp_files(parent, &ui_state_path);
    }
    let settings = settings_path
        .as_ref()
        .map(|path| read_object(path))
        .unwrap_or_default();
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
    let mouse_enabled = load_mouse_enabled(&settings);
    let intelligence_mode = settings
        .get("tuiLanguageIntelligence")
        .and_then(Value::as_str)
        .map(|value| match value {
            "auto" => IntelligenceMode::Auto,
            _ => IntelligenceMode::Off,
        })
        .unwrap_or(IntelligenceMode::Off);
    let trust_repo_local_bin = ui_state
        .get("tuiTrustRepoLocalBin")
        .and_then(Value::as_bool)
        .unwrap_or(false);
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
        mouse_enabled,
        intelligence_mode,
        trust_repo_local_bin,
        sidebar_width,
        comment_height,
        sidebar_visible,
        comments_visible,
    }
}

fn load_mouse_enabled(settings: &Map<String, Value>) -> bool {
    settings
        .get("tuiMouseEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

pub fn save_trust_repo_local_bin(repo_root: &str, trusted: bool) -> std::io::Result<()> {
    let path = project_storage_dir(repo_root).join("ui-state.json");
    with_lock(&path, |root| {
        root.insert("tuiTrustRepoLocalBin".to_string(), json!(trusted));
        Ok(())
    })
}

pub fn save_layout(
    repo_root: &str,
    sidebar_width: u16,
    comment_height: u16,
    sidebar_visible: bool,
    comments_visible: bool,
    file_display: FileDisplay,
) -> std::io::Result<()> {
    let path = project_storage_dir(repo_root).join("ui-state.json");
    with_lock(&path, |root| {
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
        Ok(())
    })
}

pub fn save_viewed(repo_root: &str, viewed: &HashSet<PathBuf>) -> std::io::Result<()> {
    let path = project_storage_dir(repo_root).join("ui-state.json");
    with_lock(&path, |root| {
        let mut files: Vec<String> = viewed
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        files.sort();
        root.insert("tuiViewedFiles".to_string(), json!(files));
        Ok(())
    })
}

pub fn save_settings(
    theme: ThemeName,
    wrap: bool,
    split: bool,
    tab_size: u8,
    line_numbers: bool,
    mouse_enabled: bool,
    intelligence_mode: IntelligenceMode,
) -> std::io::Result<()> {
    let Some(path) = settings_path() else {
        return Ok(());
    };
    with_lock(&path, |root| {
        root.insert("theme".to_string(), json!(theme.label()));
        root.insert("lineWrap".to_string(), json!(wrap));
        root.insert(
            "diffStyle".to_string(),
            json!(if split { "split" } else { "unified" }),
        );
        root.insert("defaultTabSize".to_string(), json!(tab_size));
        root.insert("showLineNumbers".to_string(), json!(line_numbers));
        root.insert("tuiMouseEnabled".to_string(), json!(mouse_enabled));
        root.insert(
            "tuiLanguageIntelligence".to_string(),
            json!(match intelligence_mode {
                IntelligenceMode::Auto => "auto",
                IntelligenceMode::Off => "off",
            }),
        );
        Ok(())
    })
}

fn settings_path() -> Option<PathBuf> {
    directories::UserDirs::new().map(|dirs| dirs.home_dir().join(".config/diffing/settings.json"))
}

fn read_object(path: &Path) -> Map<String, Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn read_object_for_update(path: &Path) -> std::io::Result<Map<String, Value>> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(error),
    };
    serde_json::from_str::<Value>(&raw)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?
        .as_object()
        .cloned()
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "diffing settings must contain a JSON object",
            )
        })
}

fn with_lock<T>(
    path: &Path,
    mut operation: impl FnMut(&mut Map<String, Value>) -> std::io::Result<T>,
) -> std::io::Result<T> {
    let mut root = read_object_for_update(path)?;
    let result = operation(&mut root)?;
    write_object(path, root)?;
    Ok(result)
}

fn write_object(path: &Path, value: Map<String, Value>) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        sweep_stale_temp_files(parent, path);
    }
    let temp = unique_temp_path(path);
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

    #[test]
    fn mouse_input_defaults_on_and_respects_an_explicit_disable() {
        let mut settings = Map::new();
        assert!(load_mouse_enabled(&settings));
        settings.insert("tuiMouseEnabled".to_string(), Value::Bool(false));
        assert!(!load_mouse_enabled(&settings));
    }

    #[test]
    fn malformed_state_is_not_silently_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        fs::write(&path, "not json").unwrap();
        assert_eq!(
            read_object_for_update(&path).unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "not json");
    }
}
