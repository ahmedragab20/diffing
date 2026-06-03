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
/// and `tasklist` on Windows. On unknown platforms we conservatively
/// assume alive — a stale lock will be overwritten on the next write.
pub fn is_lock_alive(lock: &ServerLock) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: kill(pid, 0) is documented as safe when signal is 0.
        let result = unsafe { libc::kill(lock.pid as i32, 0) };
        result == 0
    }
    #[cfg(windows)]
    {
        is_pid_alive_windows(lock.pid)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = lock;
        true
    }
}

/// Windows process-liveness probe via `tasklist`. We avoid pulling in a
/// `windows-sys` dependency for one syscall; `tasklist.exe` ships with every
/// supported Windows release. Returns `true` only when tasklist actually
/// lists a process row whose PID column matches.
#[cfg(windows)]
fn is_pid_alive_windows(pid: u32) -> bool {
    use std::process::Command;
    let output = Command::new("tasklist")
        .args([
            "/NH",
            "/FO",
            "CSV",
            "/FI",
            &format!("PID eq {}", pid),
        ])
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // tasklist prints `INFO: No tasks are running which match the
            // specified criteria.` to stdout when nothing matches; a hit is
            // a CSV row that quotes the PID as the second field.
            stdout.contains(&format!("\"{}\"", pid))
        }
        // tasklist is missing or errored — conservatively assume alive so we
        // don't blow away a legitimately running server's lock.
        _ => true,
    }
}

/// Hook so tests on non-Windows hosts can still exercise the parsing logic
/// the Windows probe relies on. Exposed only inside the crate.
#[cfg(test)]
pub(crate) fn pid_appears_in_tasklist_csv(stdout: &str, pid: u32) -> bool {
    stdout.contains(&format!("\"{}\"", pid))
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

    // ── Windows liveness probe ────────────────────────────────────────────
    // These exercise the CSV-parsing rules `is_pid_alive_windows` relies on.
    // We run them on every host because the parser is a plain string check
    // and we want regressions to surface even when CI is macOS / Linux.

    #[test]
    fn tasklist_csv_hit_is_recognised() {
        // Real `tasklist /NH /FO CSV /FI "PID eq 12345"` output for a live PID:
        let stdout = "\"node.exe\",\"12345\",\"Services\",\"0\",\"2,148 K\"\r\n";
        assert!(pid_appears_in_tasklist_csv(stdout, 12345));
    }

    #[test]
    fn tasklist_csv_miss_is_recognised() {
        // What tasklist prints when the PID is gone:
        let stdout = "INFO: No tasks are running which match the specified criteria.\r\n";
        assert!(!pid_appears_in_tasklist_csv(stdout, 12345));
    }

    #[test]
    fn tasklist_csv_does_not_match_substring_in_unrelated_column() {
        // The image name or memory column might contain the PID digits as a
        // substring — but never wrapped in double-quotes by themselves, which
        // is what CSV-with-`/NH` guarantees. Guard against a future
        // sloppier match.
        let stdout = "\"app12345.exe\",\"42\",\"Console\",\"1\",\"12,345 K\"\r\n";
        assert!(!pid_appears_in_tasklist_csv(stdout, 12345));
    }

    #[test]
    #[cfg(unix)]
    fn unix_dead_pid_reports_dead() {
        // PID 1 is always init/launchd → alive. PID 0 / extremely-high
        // values are reliably unused. We use the latter to assert "dead".
        let mut lock = sample_lock();
        lock.pid = 999_999_999;
        assert!(!is_lock_alive(&lock));
    }

    #[test]
    #[cfg(unix)]
    fn unix_self_pid_reports_alive() {
        let mut lock = sample_lock();
        lock.pid = std::process::id();
        assert!(is_lock_alive(&lock));
    }
}
