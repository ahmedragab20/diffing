//! `diffing-tui` — opt-in terminal UI for `diffing`.
//!
//! Invoked by the Node CLI when the user passes `--tui`. The Node CLI is the
//! single source of truth for arg parsing, lockfile discovery, and agent
//! handoff; this binary is a leaf renderer that reads `~/.diffing/<repo>/*`
//! on disk and writes a `server.json` lockfile that the agent subcommands
//! (`diffing await-review`, `diffing plan await`, `diffing mcp`) can
//! discover.
//!
//! The renderer consumes a disk-backed sparse diff index, while a
//! capability-scoped loopback API exposes the same bounded views to headless
//! agents and CLI/MCP clients.

use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::{Context, Result};
use clap::Parser;
use tracing_subscriber::EnvFilter;

mod agent_api;
mod app;
mod diff;
mod handoff;
mod keys;
mod persistence;
mod server_lock;
mod themes;
mod tui;
mod ui;

#[derive(Parser, Debug)]
#[command(
    name = "diffing-tui",
    about = "Terminal User Interface for diffing.",
    long_about = None,
    version,
)]
struct Args {
    /// Path to the git repository whose diff is being reviewed. Must match
    /// the value the Node CLI computed via `git rev-parse --show-toplevel`.
    #[arg(long, env = "DIFFING_REPO")]
    repo: String,

    /// All other arguments are forwarded verbatim to `git diff` (e.g.
    /// `--staged`, `-- <pathspec>`, `--diff-algorithm=patience`).
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    git_diff_args: Vec<String>,
}

fn main() -> ExitCode {
    init_tracing();
    match real_main() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("diffing-tui: {err:#}");
            ExitCode::FAILURE
        }
    }
}

fn real_main() -> Result<()> {
    let args = Args::parse();
    let repo_root = std::fs::canonicalize(&args.repo)
        .with_context(|| format!("resolving --repo {}", args.repo))?;
    let repo_root_str = repo_root
        .to_str()
        .context("--repo path is not valid UTF-8")?
        .to_string();

    if let Some(existing) = server_lock::read_server_lock(&repo_root_str) {
        if server_lock::is_lock_alive(&existing) && existing.pid != std::process::id() {
            anyhow::bail!(
                "another diffing {} session is already running for this repo (pid {})",
                existing.mode.as_deref().unwrap_or("web"),
                existing.pid
            );
        }
        server_lock::remove_server_lock(&repo_root_str)?;
    }

    // Indexing happens on a worker and publishes usable partial generations,
    // so even a million-line diff does not delay terminal startup.
    let mut app = app::App::new(PathBuf::from(&repo_root_str), args.git_diff_args)
        .with_context(|| format!("initialising diffing-tui for {}", repo_root_str))?;

    let lock = server_lock::ServerLock {
        port: app.agent_api.port,
        host: "127.0.0.1".to_string(),
        pid: std::process::id(),
        repo_root: repo_root_str.clone(),
        started_at: now_ms(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        mode: Some("tui".to_string()),
        capability: Some(app.agent_api.capability.clone()),
    };
    let lock_path = server_lock::write_server_lock(&repo_root_str, &lock)
        .with_context(|| format!("writing server.json for {}", repo_root_str))?;
    tracing::info!(path = %lock_path.display(), port = lock.port, "wrote server.json (mode=tui)");

    let tui_result = tui::run(&repo_root_str, &mut app);

    if let Err(ref e) = tui_result {
        tracing::warn!(error = %e, "TUI loop exited with error");
    }
    if let Err(e) = server_lock::remove_server_lock_if_owned(&repo_root_str, &lock) {
        tracing::warn!(error = %e, "failed to remove server.json on exit");
    } else {
        tracing::info!("removed server.json");
    }

    tui_result
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn init_tracing() {
    let filter =
        EnvFilter::try_from_env("DIFFING_TUI_LOG").unwrap_or_else(|_| EnvFilter::new("warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(std::io::stderr)
        .try_init();
}
