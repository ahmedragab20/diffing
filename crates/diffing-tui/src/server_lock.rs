use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use diffing_core::storage::{ensure_dir, lock_path};

/// Mirrors `src/lib/server-lock.ts#ServerLock` in the Node CLI.
///
/// `mode` is optional so the web server's existing writes (no `mode` key) keep
/// parsing unchanged. The TUI always writes `mode = Some("tui")` so consumers
/// can tell the two surfaces apart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerLock {
    pub port: u16,
    pub host: String,
    pub pid: u32,
    #[serde(rename = "repoRoot")]
    pub repo_root: String,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
    pub version: String,
    /// `"web"` for the Hono server, `"tui"` for the Rust binary.
    /// Absent on legacy writes (treated as `"web"`).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mode: Option<String>,
}

pub fn read_server_lock(repo_root: &str) -> Option<ServerLock> {
    let path = lock_path(repo_root);
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write_server_lock(repo_root: &str, lock: &ServerLock) -> Result<PathBuf> {
    let path = lock_path(repo_root);
    ensure_dir(&path).with_context(|| format!("preparing parent of {}", path.display()))?;
    let json = serde_json::to_string_pretty(lock).context("serializing server.json")?;
    std::fs::write(&path, json).with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

pub fn remove_server_lock(repo_root: &str) -> Result<()> {
    let path = lock_path(repo_root);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(anyhow::anyhow!("removing {}: {}", path.display(), e)),
    }
}

/// True if the process named by the lock is still alive. Uses
/// `kill(pid, 0)` on Unix (a no-op that returns 0 if the process exists)
/// and a permissive fallback on other platforms.
pub fn is_lock_alive(lock: &ServerLock) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: kill(pid, 0) is documented as safe when signal is 0.
        let result = unsafe { libc::kill(lock.pid as i32, 0) };
        if result != 0 {
            return false;
        }
    }
    // On non-Unix we conservatively assume alive (a stale lock will be
    // overwritten on the next write).
    let _ = lock;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_lock() -> ServerLock {
        ServerLock {
            port: 0,
            host: "127.0.0.1".to_string(),
            pid: 12345,
            repo_root: "/tmp/example".to_string(),
            started_at: 1_700_000_000_000,
            version: "0.1.0".to_string(),
            mode: Some("tui".to_string()),
        }
    }

    #[test]
    fn serializes_tui_mode_with_camel_case_fields() {
        // We use the same `to_string_pretty` the real writer uses, so the
        // on-disk format is what consumers (Node CLI, agent subcommands) see.
        let json = serde_json::to_string_pretty(&sample_lock()).unwrap();
        assert!(json.contains("\"mode\": \"tui\""), "got: {json}");
        assert!(json.contains("\"repoRoot\""), "got: {json}");
        assert!(json.contains("\"startedAt\""), "got: {json}");
        assert!(json.contains("\"port\": 0"), "got: {json}");
        // Sanity: TUI mode is the only mode set.
        assert!(!json.contains("\"mode\": \"web\""), "got: {json}");
    }

    #[test]
    fn omits_mode_when_none() {
        let mut lock = sample_lock();
        lock.mode = None;
        let json = serde_json::to_string(&lock).unwrap();
        assert!(!json.contains("mode"), "got: {}", json);
    }

    #[test]
    fn round_trips_via_disk() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_str().unwrap();
        let lock = sample_lock();
        let path = write_server_lock(repo, &lock).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: ServerLock = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.port, lock.port);
        assert_eq!(parsed.repo_root, lock.repo_root);
        assert_eq!(parsed.mode.as_deref(), Some("tui"));
        // repo_path.txt is written by the comments/plans stores; the lock
        // store does not, matching the Node implementation.
        assert!(!dir.path().join("repo_path.txt").exists());
    }

    #[test]
    fn remove_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_str().unwrap();
        write_server_lock(repo, &sample_lock()).unwrap();
        remove_server_lock(repo).unwrap();
        remove_server_lock(repo).unwrap();
    }
}
