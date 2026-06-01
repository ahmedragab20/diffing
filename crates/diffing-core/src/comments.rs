//! Comment store mirroring the Node CLI's `FileCommentStore`.
//!
//! Persists `ReviewComment[]` to `~/.diffing/<repo>/comments.json` (UTF-8
//! JSON, 2-space indent — same as the Node side) and never writes inside
//! the reviewed consumer repo. Both sides read and write the same files,
//! so the TUI can edit a comment while the web UI is open, or vice versa.

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::storage::ensure_dir;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommentSide {
    Deletions,
    Additions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommentStatus {
    Open,
    Resolved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommentReply {
    pub id: String,
    pub body: String,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewComment {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub side: CommentSide,
    #[serde(rename = "lineNumber")]
    pub line_number: u32,
    #[serde(rename = "startLineNumber", skip_serializing_if = "Option::is_none", default)]
    pub start_line_number: Option<u32>,
    #[serde(rename = "lineContent")]
    pub line_content: String,
    pub body: String,
    pub status: CommentStatus,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    pub replies: Vec<CommentReply>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewComment<'a> {
    Inline {
        file_path: &'a str,
        side: CommentSide,
        line_number: u32,
        line_content: &'a str,
        body: &'a str,
    },
    FileLevel {
        file_path: &'a str,
        body: &'a str,
    },
}

pub fn comments_path(repo_root: &str) -> PathBuf {
    crate::project_storage_dir(repo_root).join("comments.json")
}

/// Persistent, on-disk comment store. Mirrors the Node `FileCommentStore`
/// exactly: read = `JSON.parse`; write = `mkdir -p` + `JSON.stringify(…, 2)`.
pub struct FileCommentStore {
    pub repo_root: String,
    pub path: PathBuf,
}

impl FileCommentStore {
    pub fn new(repo_root: &str) -> Self {
        let path = comments_path(repo_root);
        Self {
            repo_root: repo_root.to_string(),
            path,
        }
    }

    pub fn load(&self) -> Result<Vec<ReviewComment>> {
        match std::fs::read_to_string(&self.path) {
            Ok(s) => Ok(serde_json::from_str(&s).context("parsing comments.json")?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(anyhow::anyhow!("reading {}: {}", self.path.display(), e)),
        }
    }

    pub fn save(&self, comments: &[ReviewComment]) -> Result<()> {
        ensure_dir(&self.path).with_context(|| format!("preparing parent of {}", self.path.display()))?;
        let json = serde_json::to_string_pretty(comments).context("serializing comments.json")?;
        std::fs::write(&self.path, json).with_context(|| format!("writing {}", self.path.display()))?;
        // Mirror the Node side: also drop a sibling `repo_path.txt` so a
        // stray storage dir from a different repo can be detected.
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::write(parent.join("repo_path.txt"), &self.repo_root);
        }
        Ok(())
    }

    pub fn add(&self, comment: NewComment<'_>, now_ms: u64) -> Result<ReviewComment> {
        let mut comments = self.load()?;
        let id = new_uuid();
        let (file_path, side, line_number, line_content, body) = match comment {
            NewComment::Inline { file_path, side, line_number, line_content, body } => {
                (file_path.to_string(), side, line_number, line_content.to_string(), body.to_string())
            }
            NewComment::FileLevel { file_path, body } => {
                (file_path.to_string(), CommentSide::Additions, 0, String::new(), body.to_string())
            }
        };
        let new = ReviewComment {
            id,
            file_path,
            side,
            line_number,
            start_line_number: None,
            line_content,
            body,
            status: CommentStatus::Open,
            created_at: now_ms,
            replies: Vec::new(),
        };
        comments.push(new.clone());
        self.save(&comments)?;
        Ok(new)
    }

    pub fn update(&self, id: &str, body: Option<&str>, status: Option<CommentStatus>) -> Result<Option<ReviewComment>> {
        let mut comments = self.load()?;
        let Some(c) = comments.iter_mut().find(|c| c.id == id) else {
            return Ok(None);
        };
        if let Some(b) = body {
            c.body = b.to_string();
        }
        if let Some(s) = status {
            c.status = s;
        }
        let updated = c.clone();
        self.save(&comments)?;
        Ok(Some(updated))
    }

    pub fn remove(&self, id: &str) -> Result<bool> {
        let mut comments = self.load()?;
        let before = comments.len();
        comments.retain(|c| c.id != id);
        let removed = comments.len() != before;
        if removed {
            self.save(&comments)?;
        }
        Ok(removed)
    }

    pub fn add_reply(&self, comment_id: &str, body: &str, role: Option<&str>, model: Option<&str>, now_ms: u64) -> Result<Option<ReviewComment>> {
        let mut comments = self.load()?;
        let Some(c) = comments.iter_mut().find(|c| c.id == comment_id) else {
            return Ok(None);
        };
        c.replies.push(CommentReply {
            id: new_uuid(),
            body: body.to_string(),
            created_at: now_ms,
            role: role.map(String::from),
            model: model.map(String::from),
        });
        let updated = c.clone();
        self.save(&comments)?;
        Ok(Some(updated))
    }
}

/// Generate a UUID v4 string. Uses `/dev/urandom` on Unix platforms; on
/// other platforms (e.g. Windows), mixes the system time with a process-wide
/// counter to produce a unique-enough identifier for a comment id.
fn new_uuid() -> String {
    let mut bytes = [0u8; 16];
    fill_random(&mut bytes);
    // RFC 4122 v4 layout.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let mut s = String::with_capacity(36);
    for (i, b) in bytes.iter().enumerate() {
        if i == 4 || i == 6 || i == 8 || i == 10 {
            s.push('-');
        }
        use std::fmt::Write as _;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

#[cfg(unix)]
fn fill_random(buf: &mut [u8]) {
    use std::fs::File;
    use std::io::Read;
    if let Ok(mut f) = File::open("/dev/urandom") {
        let _ = f.read_exact(buf);
    }
}

#[cfg(not(unix))]
fn fill_random(buf: &mut [u8]) {
    // Fallback: mix monotonic time + a process counter. Not cryptographically
    // random, but unique enough for a comment id within one TUI session.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    for (i, b) in buf.iter_mut().enumerate() {
        *b = (t ^ n ^ (i as u64).wrapping_mul(0x9E3779B97F4A7C15)) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_inline<'a>(body: &'a str) -> NewComment<'a> {
        NewComment::Inline {
            file_path: "src/a.rs",
            side: CommentSide::Additions,
            line_number: 42,
            line_content: "let x = 1;",
            body,
        }
    }

    fn sample_file_level<'a>(body: &'a str) -> NewComment<'a> {
        NewComment::FileLevel {
            file_path: "src/a.rs",
            body,
        }
    }

    fn tempdir() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "diffing-comments-test-{}-{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn uuid_is_well_formed_and_unique() {
        let a = new_uuid();
        let b = new_uuid();
        assert_eq!(a.len(), 36);
        assert_eq!(a.chars().filter(|c| *c == '-').count(), 4);
        assert_ne!(a, b);
    }

    #[test]
    fn add_then_load_round_trips() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let new = store.add(sample_inline("fix this"), 1000).unwrap();
        assert_eq!(new.line_number, 42);
        assert_eq!(new.body, "fix this");
        assert_eq!(new.status, CommentStatus::Open);
        let loaded = store.load().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, new.id);
    }

    #[test]
    fn add_writes_repo_path_txt_sibling() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        store.add(sample_inline("hi"), 1).unwrap();
        // `project_storage_dir` adds a hash subdir; `repo_path.txt` lives
        // next to `comments.json` inside that subdir.
        let sibling = store.path.parent().unwrap().join("repo_path.txt");
        assert!(sibling.exists(), "expected {sibling:?} to exist");
        assert_eq!(std::fs::read_to_string(&sibling).unwrap(), dir.to_str().unwrap());
    }

    #[test]
    fn update_body_and_status() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let new = store.add(sample_inline("first"), 1).unwrap();
        let updated = store
            .update(&new.id, Some("second"), Some(CommentStatus::Resolved))
            .unwrap()
            .unwrap();
        assert_eq!(updated.body, "second");
        assert_eq!(updated.status, CommentStatus::Resolved);
    }

    #[test]
    fn remove_drops_by_id() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let a = store.add(sample_inline("a"), 1).unwrap();
        let b = store.add(sample_inline("b"), 2).unwrap();
        assert!(store.remove(&a.id).unwrap());
        let loaded = store.load().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, b.id);
    }

    #[test]
    fn add_reply_appends_and_persists() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let new = store.add(sample_inline("hi"), 1).unwrap();
        let updated = store
            .add_reply(&new.id, "agent reply", Some("agent"), Some("gpt-4o"), 5)
            .unwrap()
            .unwrap();
        assert_eq!(updated.replies.len(), 1);
        assert_eq!(updated.replies[0].body, "agent reply");
        assert_eq!(updated.replies[0].role.as_deref(), Some("agent"));
        assert_eq!(updated.replies[0].model.as_deref(), Some("gpt-4o"));
        // Reload to verify persistence.
        let reloaded = store.load().unwrap();
        assert_eq!(reloaded[0].replies[0].body, "agent reply");
    }

    #[test]
    fn file_level_comment_uses_zero_line_number() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let new = store.add(sample_file_level("general note"), 1).unwrap();
        assert_eq!(new.line_number, 0);
        assert!(new.start_line_number.is_none());
    }

    #[test]
    fn missing_file_returns_empty_vec() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        // Don't add anything. load() should yield an empty vec (not an error).
        let loaded = store.load().unwrap();
        assert!(loaded.is_empty());
    }

    #[test]
    fn json_shape_matches_node_field_names() {
        // Round-trip through JSON to verify the on-disk shape is what the
        // Node CLI expects. Field names like `filePath`, `lineNumber`, etc.
        // must stay camelCase.
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        store.add(sample_inline("hi"), 1).unwrap();
        let raw = std::fs::read_to_string(store.path.clone()).unwrap();
        assert!(raw.contains("\"filePath\""), "got: {raw}");
        assert!(raw.contains("\"lineNumber\""), "got: {raw}");
        assert!(raw.contains("\"createdAt\""), "got: {raw}");
        assert!(raw.contains("\"side\": \"additions\""), "got: {raw}");
        assert!(raw.contains("\"status\": \"open\""), "got: {raw}");
    }
}
