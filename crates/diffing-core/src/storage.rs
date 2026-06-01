//! On-disk JSON store helpers shared with the Node CLI.
//!
//! The Node side uses `mkdir -p` + `JSON.stringify(…, null, 2)` via
//! `writeFileSync` for every store (see `src/lib/comments.ts`,
//! `src/lib/plans.ts`, `src/lib/state.ts`, `src/lib/server-lock.ts`).
//! Currently exposes the path + mkdir primitives; per-store CRUD is added
//! as the TUI's storage needs grow.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::project_storage_dir;

/// Absolute path of `server.json` for a given repo root.
pub fn lock_path(repo_root: &str) -> PathBuf {
    project_storage_dir(repo_root).join("server.json")
}

/// Create the parent dir of `path` if it does not exist. Mirrors the
/// `mkdirSync(join(path, '..'), { recursive: true })` call in the Node CLI.
pub fn ensure_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating directory {}", parent.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_path_ends_in_server_json() {
        let p = lock_path("/Users/me/projects/diffing");
        assert_eq!(p.file_name().unwrap().to_str().unwrap(), "server.json");
    }

    #[test]
    fn ensure_dir_creates_missing_parent() {
        let tmp = std::env::temp_dir().join(format!(
            "diffing-core-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target = tmp.join("a/b/c.json");
        assert!(!tmp.exists());
        ensure_dir(&target).unwrap();
        assert!(tmp.is_dir());
        std::fs::remove_dir_all(&tmp).ok();
    }
}
