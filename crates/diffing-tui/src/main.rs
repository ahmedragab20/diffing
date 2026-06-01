//! `diffing-tui` — opt-in terminal UI for `diffing`.
//!
//! Invoked by the Node CLI when the user passes `--tui`. The Node CLI is the
//! single source of truth for arg parsing, lockfile discovery, and agent
//! handoff; this binary is a leaf renderer that reads `~/.diffing/<repo>/*`
//! on disk and writes a `server.json` lockfile that the agent subcommands
//! (`diffing await-review`, `diffing plan await`, `diffing mcp`) can
//! discover.
//!
//! Today this binary handles clap arg parsing, lockfile write/cleanup,
//! raw-mode TUI boot/shutdown, and a placeholder "diffing TUI" screen with
//! a spinner. Diff rendering, comments, search, plans, settings, and the
//! optional GPU render backend are added in subsequent commits.

use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::{Context, Result};
use clap::Parser;
use diffing_core::diff::{parse_patch, run_git_diff};
use tracing_subscriber::EnvFilter;

mod app;
mod diff;
mod handoff;
mod keys;
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

    let lock = server_lock::ServerLock {
        port: 0,
        host: "127.0.0.1".to_string(),
        pid: std::process::id(),
        repo_root: repo_root_str.clone(),
        started_at: now_ms(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        mode: Some("tui".to_string()),
    };
    let lock_path = server_lock::write_server_lock(&repo_root_str, &lock)
        .with_context(|| format!("writing server.json for {}", repo_root_str))?;
    tracing::info!(path = %lock_path.display(), "wrote server.json (mode=tui)");

    // Run git diff and parse the patch text.
    let patch_text = run_git_diff(&repo_root_str, &args.git_diff_args)
        .with_context(|| format!("running git diff in {}", repo_root_str))?;
    let files = parse_patch(&patch_text).context("parsing git diff output")?;
    tracing::info!(file_count = files.len(), "parsed diff");

    let mut app = app::App::new(PathBuf::from(&repo_root_str), files)
        .with_context(|| format!("initialising diffing-tui for {}", repo_root_str))?;

    let tui_result = tui::run(&repo_root_str, &mut app);

    if let Err(ref e) = tui_result {
        tracing::warn!(error = %e, "TUI loop exited with error");
    }
    if let Err(e) = server_lock::remove_server_lock(&repo_root_str) {
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
