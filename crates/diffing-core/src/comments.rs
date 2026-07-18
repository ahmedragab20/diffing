//! Comment store mirroring the Node CLI's `FileCommentStore`.
//!
//! Persists `ReviewComment[]` to `~/.diffing/<repo>/comments.json` (UTF-8
//! JSON, 2-space indent — same as the Node side) and never writes inside
//! the reviewed consumer repo. Both sides read and write the same files,
//! so the TUI can edit a comment while the web UI is open, or vice versa.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommentSeverity {
    Blocking,
    Nit,
    Question,
    Praise,
    None,
}

impl CommentSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blocking => "blocking",
            Self::Nit => "nit",
            Self::Question => "question",
            Self::Praise => "praise",
            Self::None => "none",
        }
    }
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
    #[serde(
        rename = "startLineNumber",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub start_line_number: Option<u32>,
    #[serde(rename = "lineContent")]
    pub line_content: String,
    pub body: String,
    pub status: CommentStatus,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    pub replies: Vec<CommentReply>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub severity: Option<CommentSeverity>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewComment<'a> {
    Inline {
        file_path: &'a str,
        side: CommentSide,
        start_line_number: Option<u32>,
        line_number: u32,
        line_content: &'a str,
        body: &'a str,
        severity: Option<CommentSeverity>,
    },
    FileLevel {
        file_path: &'a str,
        body: &'a str,
        severity: Option<CommentSeverity>,
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
        self.load_unlocked()
    }

    fn load_unlocked(&self) -> Result<Vec<ReviewComment>> {
        match std::fs::read_to_string(&self.path) {
            Ok(s) => Ok(serde_json::from_str(&s).context("parsing comments.json")?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(anyhow::anyhow!("reading {}: {}", self.path.display(), e)),
        }
    }

    pub fn save(&self, comments: &[ReviewComment]) -> Result<()> {
        self.with_lock(|| self.save_unlocked(comments))
    }

    fn save_unlocked(&self, comments: &[ReviewComment]) -> Result<()> {
        ensure_dir(&self.path)
            .with_context(|| format!("preparing parent of {}", self.path.display()))?;
        let json = serde_json::to_string_pretty(comments).context("serializing comments.json")?;
        let temp_path =
            self.path
                .with_extension(format!("json.{}.{}.tmp", std::process::id(), now_nanos()));
        let mut temp = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .with_context(|| format!("creating {}", temp_path.display()))?;
        temp.write_all(json.as_bytes())?;
        temp.sync_all()?;
        drop(temp);
        if let Err(error) = std::fs::rename(&temp_path, &self.path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(error).with_context(|| format!("writing {}", self.path.display()));
        }
        // Mirror the Node side: also drop a sibling `repo_path.txt` so a
        // stray storage dir from a different repo can be detected.
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::write(parent.join("repo_path.txt"), &self.repo_root);
        }
        Ok(())
    }

    pub fn add(&self, comment: NewComment<'_>, now_ms: u64) -> Result<ReviewComment> {
        self.with_lock(|| {
            let mut comments = self.load_unlocked()?;
            let id = new_uuid();
            let (file_path, side, start_line_number, line_number, line_content, body, severity) =
                match comment {
                    NewComment::Inline {
                        file_path,
                        side,
                        start_line_number,
                        line_number,
                        line_content,
                        body,
                        severity,
                    } => {
                        if line_number == 0 {
                            anyhow::bail!("inline comments require a positive line number");
                        }
                        let (start_line_number, line_number) =
                            normalize_comment_range(start_line_number, line_number);
                        (
                            file_path.to_string(),
                            side,
                            start_line_number,
                            line_number,
                            line_content.to_string(),
                            body.to_string(),
                            severity.filter(|value| *value != CommentSeverity::None),
                        )
                    }
                    NewComment::FileLevel {
                        file_path,
                        body,
                        severity,
                    } => (
                        file_path.to_string(),
                        CommentSide::Additions,
                        None,
                        0,
                        String::new(),
                        body.to_string(),
                        severity.filter(|value| *value != CommentSeverity::None),
                    ),
                };
            let new = ReviewComment {
                id,
                file_path,
                side,
                line_number,
                start_line_number,
                line_content,
                body,
                status: CommentStatus::Open,
                created_at: now_ms,
                replies: Vec::new(),
                severity,
            };
            comments.push(new.clone());
            self.save_unlocked(&comments)?;
            Ok(new)
        })
    }

    pub fn update(
        &self,
        id: &str,
        body: Option<&str>,
        status: Option<CommentStatus>,
    ) -> Result<Option<ReviewComment>> {
        self.with_lock(|| {
            let mut comments = self.load_unlocked()?;
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
            self.save_unlocked(&comments)?;
            Ok(Some(updated))
        })
    }

    pub fn remove(&self, id: &str) -> Result<bool> {
        self.with_lock(|| {
            let mut comments = self.load_unlocked()?;
            let before = comments.len();
            comments.retain(|c| c.id != id);
            let removed = comments.len() != before;
            if removed {
                self.save_unlocked(&comments)?;
            }
            Ok(removed)
        })
    }

    pub fn resolve_all(&self) -> Result<usize> {
        self.with_lock(|| {
            let mut comments = self.load_unlocked()?;
            let mut resolved = 0;
            for comment in &mut comments {
                if comment.status == CommentStatus::Open {
                    comment.status = CommentStatus::Resolved;
                    resolved += 1;
                }
            }
            if resolved > 0 {
                self.save_unlocked(&comments)?;
            }
            Ok(resolved)
        })
    }

    pub fn add_reply(
        &self,
        comment_id: &str,
        body: &str,
        role: Option<&str>,
        model: Option<&str>,
        now_ms: u64,
    ) -> Result<Option<ReviewComment>> {
        self.with_lock(|| {
            let mut comments = self.load_unlocked()?;
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
            self.save_unlocked(&comments)?;
            Ok(Some(updated))
        })
    }

    fn with_lock<T>(&self, operation: impl FnOnce() -> Result<T>) -> Result<T> {
        ensure_dir(&self.path)
            .with_context(|| format!("preparing parent of {}", self.path.display()))?;
        let lock_path = self.path.with_extension("json.lock");
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    let _ = writeln!(file, "{}", std::process::id());
                    let _guard = CommentLock { path: lock_path };
                    return operation();
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    remove_stale_lock(&lock_path);
                    if Instant::now() >= deadline {
                        anyhow::bail!("timed out acquiring {}", lock_path.display());
                    }
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => return Err(error).context("acquiring comment store lock"),
            }
        }
    }
}

fn normalize_comment_range(start: Option<u32>, end: u32) -> (Option<u32>, u32) {
    match start.filter(|line| *line > 0) {
        Some(start) if start != end => (Some(start.min(end)), start.max(end)),
        _ => (None, end),
    }
}

struct CommentLock {
    path: PathBuf,
}

impl Drop for CommentLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn remove_stale_lock(path: &Path) {
    let stale = std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age > Duration::from_secs(30));
    if stale {
        let _ = std::fs::remove_file(path);
    }
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
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
            start_line_number: None,
            line_number: 42,
            line_content: "let x = 1;",
            body,
            severity: None,
        }
    }

    fn sample_file_level<'a>(body: &'a str) -> NewComment<'a> {
        NewComment::FileLevel {
            file_path: "src/a.rs",
            body,
            severity: None,
        }
    }

    fn tempdir() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("diffing-comments-test-{}-{n}", std::process::id()));
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
        assert_eq!(
            std::fs::read_to_string(&sibling).unwrap(),
            dir.to_str().unwrap()
        );
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

    #[test]
    fn concurrent_writers_do_not_lose_comments() {
        let dir = tempdir();
        let repo = dir.to_string_lossy().into_owned();
        let mut workers = Vec::new();
        for worker in 0..4 {
            let repo = repo.clone();
            workers.push(std::thread::spawn(move || {
                let store = FileCommentStore::new(&repo);
                for index in 0..25 {
                    store
                        .add(
                            NewComment::FileLevel {
                                file_path: "src/concurrent.rs",
                                body: &format!("worker {worker} comment {index}"),
                                severity: None,
                            },
                            index,
                        )
                        .unwrap();
                }
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
        let comments = FileCommentStore::new(&repo).load().unwrap();
        assert_eq!(comments.len(), 100);
    }

    #[test]
    fn severity_survives_mutation_round_trip() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let created = store
            .add(
                NewComment::Inline {
                    file_path: "src/a.rs",
                    side: CommentSide::Additions,
                    start_line_number: Some(40),
                    line_number: 42,
                    line_content: "line 40\nline 41\nline 42",
                    body: "must fix",
                    severity: Some(CommentSeverity::Blocking),
                },
                1000,
            )
            .unwrap();
        store
            .update(&created.id, None, Some(CommentStatus::Resolved))
            .unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded[0].severity, Some(CommentSeverity::Blocking));
        assert_eq!(loaded[0].start_line_number, Some(40));
        assert_eq!(loaded[0].line_content, "line 40\nline 41\nline 42");
    }

    #[test]
    fn inline_ranges_are_normalized_and_multiline_bodies_round_trip() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let created = store
            .add(
                NewComment::Inline {
                    file_path: "src/a.rs",
                    side: CommentSide::Deletions,
                    start_line_number: Some(12),
                    line_number: 10,
                    line_content: "ten\neleven\ntwelve",
                    body: "first paragraph\n\nsecond paragraph",
                    severity: None,
                },
                1000,
            )
            .unwrap();
        assert_eq!(created.start_line_number, Some(10));
        assert_eq!(created.line_number, 12);
        let loaded = store.load().unwrap();
        assert_eq!(loaded[0].body, "first paragraph\n\nsecond paragraph");
        assert_eq!(loaded[0].line_content, "ten\neleven\ntwelve");
    }

    #[test]
    fn inline_comments_reject_file_level_line_zero() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let result = store.add(
            NewComment::Inline {
                file_path: "src/a.rs",
                side: CommentSide::Additions,
                start_line_number: None,
                line_number: 0,
                line_content: "",
                body: "invalid",
                severity: None,
            },
            1000,
        );
        assert!(result.is_err());
    }

    #[test]
    fn resolve_all_updates_only_open_threads() {
        let dir = tempdir();
        let store = FileCommentStore::new(dir.to_str().unwrap());
        let first = store.add(sample_inline("first"), 1000).unwrap();
        store.add(sample_inline("second"), 1001).unwrap();
        store
            .update(&first.id, None, Some(CommentStatus::Resolved))
            .unwrap();
        assert_eq!(store.resolve_all().unwrap(), 1);
        assert!(store
            .load()
            .unwrap()
            .iter()
            .all(|comment| comment.status == CommentStatus::Resolved));
    }
}
