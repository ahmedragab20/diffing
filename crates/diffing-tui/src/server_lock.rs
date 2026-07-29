use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use diffing_core::storage::{ensure_dir, lock_path, sessions_dir};

/// Mirrors `src/lib/server-lock.ts#ServerLock` in the Node CLI.
///
/// Optional fields preserve compatibility with older singleton `server.json`
/// records. New TUI launches write both a registry record and the active
/// pointer with `mode = Some("tui")`.
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
    /// Random bearer capability required by the TUI's loopback API.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub capability: Option<String>,
    /// Public identifier for selecting this session. It is not a capability.
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none", default)]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scope: Option<String>,
    #[serde(rename = "diffArgs", skip_serializing_if = "Option::is_none", default)]
    pub diff_args: Option<Vec<String>>,
    #[serde(rename = "prRef", skip_serializing_if = "Option::is_none", default)]
    pub pr_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub owner: Option<String>,
    #[serde(rename = "ownerId", skip_serializing_if = "Option::is_none", default)]
    pub owner_id: Option<String>,
}

fn session_id(lock: &ServerLock) -> String {
    lock.session_id.clone().unwrap_or_else(|| {
        lock.owner_id.clone().unwrap_or_else(|| {
            format!(
                "{}-{}-{}",
                lock.mode.as_deref().unwrap_or("web"),
                lock.pid,
                lock.started_at
            )
        })
    })
}

fn normalized_lock(lock: &ServerLock) -> ServerLock {
    let mut normalized = lock.clone();
    if normalized.session_id.is_none() {
        normalized.session_id = Some(session_id(lock));
    }
    normalized
}

fn same_session(left: &ServerLock, right: &ServerLock) -> bool {
    match (&left.session_id, &right.session_id) {
        (Some(left), Some(right)) => left == right,
        _ => {
            left.pid == right.pid && left.started_at == right.started_at && left.port == right.port
        }
    }
}

fn session_record_path(repo_root: &str, lock: &ServerLock) -> PathBuf {
    // New identifiers are hex/UUID values. Sanitising also keeps legacy or
    // hand-authored records from escaping the registry directory.
    let safe_id: String = session_id(lock)
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    sessions_dir(repo_root).join(format!("{safe_id}.json"))
}

fn write_json_atomically(path: &Path, lock: &ServerLock) -> Result<()> {
    ensure_dir(path).with_context(|| format!("preparing parent of {}", path.display()))?;
    let json = serde_json::to_string_pretty(lock).context("serializing session lock")?;
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&temporary, json).with_context(|| format!("writing {}", temporary.display()))?;
    std::fs::rename(&temporary, path).with_context(|| format!("publishing {}", path.display()))?;
    Ok(())
}

fn write_session_record(repo_root: &str, lock: &ServerLock) -> Result<ServerLock> {
    let normalized = normalized_lock(lock);
    write_json_atomically(&session_record_path(repo_root, &normalized), &normalized)?;
    Ok(normalized)
}

pub fn write_server_lock(repo_root: &str, lock: &ServerLock) -> Result<PathBuf> {
    let path = lock_path(repo_root);
    if let Some(current) = read_server_lock(repo_root) {
        if is_lock_alive(&current) && !same_session(&current, lock) {
            write_session_record(repo_root, &current)?;
        }
    }
    let normalized = write_session_record(repo_root, lock)?;
    if let Err(error) = write_json_atomically(&path, &normalized) {
        // Do not advertise an unreachable session if publishing the active
        // pointer failed after its registry record was written.
        let _ = std::fs::remove_file(session_record_path(repo_root, &normalized));
        return Err(error);
    }
    Ok(path)
}

pub fn read_server_lock(repo_root: &str) -> Option<ServerLock> {
    let raw = std::fs::read_to_string(lock_path(repo_root)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn remove_server_lock(repo_root: &str) -> Result<()> {
    let path = lock_path(repo_root);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(anyhow::anyhow!("removing {}: {}", path.display(), e)),
    }
}

/// Return all live sessions, newest first, pruning stale registry entries.
pub fn list_server_locks(repo_root: &str) -> Vec<ServerLock> {
    let mut sessions: HashMap<String, ServerLock> = HashMap::new();
    if let Some(active) = read_server_lock(repo_root) {
        if active.repo_root == repo_root && is_lock_alive(&active) {
            let normalized = normalized_lock(&active);
            sessions.insert(session_id(&normalized), normalized);
        }
    }

    if let Ok(entries) = std::fs::read_dir(sessions_dir(repo_root)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let candidate = std::fs::read_to_string(&path)
                .ok()
                .and_then(|raw| serde_json::from_str::<ServerLock>(&raw).ok());
            match candidate {
                Some(candidate)
                    if candidate.repo_root == repo_root && is_lock_alive(&candidate) =>
                {
                    let normalized = normalized_lock(&candidate);
                    sessions.insert(session_id(&normalized), normalized);
                }
                _ => {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }

    let mut sessions: Vec<_> = sessions.into_values().collect();
    sessions.sort_by_key(|lock| std::cmp::Reverse(lock.started_at));
    sessions
}

/// Remove the discovery record only if it still belongs to this TUI. This
/// avoids deleting a replacement session that started while shutdown was in
/// progress.
pub fn remove_server_lock_if_owned(repo_root: &str, owner: &ServerLock) -> Result<()> {
    let normalized = normalized_lock(owner);
    let record_path = session_record_path(repo_root, &normalized);
    if let Ok(raw) = std::fs::read_to_string(&record_path) {
        if serde_json::from_str::<ServerLock>(&raw)
            .is_ok_and(|stored| same_session(&stored, &normalized))
        {
            let _ = std::fs::remove_file(record_path);
        }
    }

    let Some(current) = read_server_lock(repo_root) else {
        return Ok(());
    };
    if !same_session(&current, &normalized)
        && (current.pid != owner.pid || current.capability != owner.capability)
    {
        return Ok(());
    }

    if let Some(fallback) = list_server_locks(repo_root)
        .into_iter()
        .find(|candidate| !same_session(candidate, &normalized))
    {
        write_json_atomically(&lock_path(repo_root), &fallback)
    } else {
        remove_server_lock(repo_root)
    }
}

pub fn new_session_id() -> Result<String> {
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| anyhow::anyhow!("generating session id: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
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
        .args(["/NH", "/FO", "CSV", "/FI", &format!("PID eq {}", pid)])
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
            capability: Some("test-capability".to_string()),
            session_id: Some("test-session".to_string()),
            scope: None,
            diff_args: None,
            pr_ref: None,
            owner: None,
            owner_id: None,
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
        assert!(
            json.contains("\"sessionId\": \"test-session\""),
            "got: {json}"
        );
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
        let mut lock = sample_lock();
        lock.repo_root = repo.to_string();
        lock.pid = std::process::id();
        let path = write_server_lock(repo, &lock).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: ServerLock = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.port, lock.port);
        assert_eq!(parsed.repo_root, lock.repo_root);
        assert_eq!(parsed.mode.as_deref(), Some("tui"));
        assert_eq!(list_server_locks(repo).len(), 1);
        // repo_path.txt is written by the comments/plans stores; the lock
        // store does not, matching the Node implementation.
        assert!(!dir.path().join("repo_path.txt").exists());
    }

    #[test]
    fn remove_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_str().unwrap();
        let mut lock = sample_lock();
        lock.repo_root = repo.to_string();
        write_server_lock(repo, &lock).unwrap();
        remove_server_lock(repo).unwrap();
        remove_server_lock(repo).unwrap();
    }

    #[test]
    fn owned_cleanup_preserves_a_replacement_lock() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_str().unwrap();
        let mut original = sample_lock();
        original.repo_root = repo.to_string();
        original.pid = std::process::id();
        write_server_lock(repo, &original).unwrap();
        let mut replacement = original.clone();
        replacement.capability = Some("replacement".to_string());
        replacement.session_id = Some("replacement".to_string());
        write_server_lock(repo, &replacement).unwrap();
        remove_server_lock_if_owned(repo, &original).unwrap();
        assert_eq!(
            read_server_lock(repo).unwrap().session_id.as_deref(),
            Some("replacement")
        );
        assert_eq!(list_server_locks(repo).len(), 1);
    }

    #[test]
    fn multiple_sessions_are_registered_and_active_cleanup_elects_a_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_str().unwrap();
        let mut first = sample_lock();
        first.pid = std::process::id();
        first.repo_root = repo.to_string();
        first.session_id = Some("first".to_string());
        let mut second = first.clone();
        second.session_id = Some("second".to_string());
        second.started_at += 1;
        write_server_lock(repo, &first).unwrap();
        write_server_lock(repo, &second).unwrap();
        assert_eq!(list_server_locks(repo).len(), 2);

        remove_server_lock_if_owned(repo, &second).unwrap();
        assert_eq!(
            read_server_lock(repo).unwrap().session_id.as_deref(),
            Some("first")
        );
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
