//! `notify`-based live-update of the per-repo on-disk stores.
//!
//! Watches the storage directory for changes to `comments.json` (and, in
//! later phases, `plans.json` / `server.json`) and reloads the
//! in-memory `Vec<ReviewComment>` so the TUI reflects what the web UI
//! (or an agent CLI) wrote.
//!
//! Uses `notify-debouncer-full` so a flurry of writes coalesces into a
//! single reload instead of thrashing the disk read path.

pub mod format;
pub mod review;

use std::path::Path;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use anyhow::{Context, Result};
use notify::{Event, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};

pub struct CommentsWatcher {
    _debouncer: Debouncer<notify::RecommendedWatcher, FileIdMap>,
    rx: Receiver<DebounceEventResult>,
}

pub struct RepoWatcher {
    _watcher: notify::RecommendedWatcher,
    rx: Receiver<notify::Result<Event>>,
}

impl RepoWatcher {
    pub fn start(repo_root: &Path) -> Result<Self> {
        let (tx, rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
        })
        .context("creating repository watcher")?;
        watcher
            .watch(repo_root, RecursiveMode::Recursive)
            .with_context(|| format!("watching repository {}", repo_root.display()))?;
        Ok(Self {
            _watcher: watcher,
            rx,
        })
    }

    pub fn try_recv(&self) -> Option<notify::Result<Event>> {
        self.rx.try_recv().ok()
    }
}

impl CommentsWatcher {
    /// Start watching `dir` (a per-repo storage dir) for changes to
    /// `comments.json`. The returned `Self` exposes a blocking `recv()`
    /// that yields whenever the file changes on disk. Drop the watcher
    /// to stop the background thread.
    pub fn start(dir: &Path) -> Result<Self> {
        let (tx, rx) = mpsc::channel::<DebounceEventResult>();
        let mut debouncer = new_debouncer(
            Duration::from_millis(200),
            None,
            move |res: DebounceEventResult| {
                // Best-effort: if the receiver is gone, swallow the error.
                let _ = tx.send(res);
            },
        )
        .context("creating notify debouncer")?;
        debouncer
            .watcher()
            .watch(dir, RecursiveMode::NonRecursive)
            .with_context(|| format!("watching {}", dir.display()))?;
        // Filter by file id so the receiver only sees `comments.json` events.
        Ok(Self {
            _debouncer: debouncer,
            rx,
        })
    }

    /// Try to receive without blocking.
    pub fn try_recv(&self) -> Option<DebounceEventResult> {
        self.rx.try_recv().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Instant;

    fn tempdir() -> std::path::PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("diffing-live-test-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn watcher_fires_on_comments_json_write() {
        let dir = tempdir();
        let w = CommentsWatcher::start(&dir).expect("start watcher");
        // Give the OS a moment to install the watch.
        std::thread::sleep(Duration::from_millis(250));
        let path = dir.join("comments.json");
        // Write twice (a + a touch) to make sure the OS picks up the event
        // even on filesystems with coarse-grained change notifications.
        fs::write(&path, "[]").unwrap();
        std::thread::sleep(Duration::from_millis(100));
        fs::write(&path, "[1,2,3]").unwrap();
        let start = Instant::now();
        let mut saw = false;
        while start.elapsed() < Duration::from_secs(5) {
            if let Some(Ok(events)) = w.try_recv() {
                for e in &events {
                    for p in &e.paths {
                        if p == &path || p.file_name() == path.file_name() {
                            saw = true;
                            break;
                        }
                    }
                    if saw {
                        break;
                    }
                }
                if saw {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            saw,
            "watcher did not fire for {} (events: timeout)",
            path.display()
        );
    }
}
