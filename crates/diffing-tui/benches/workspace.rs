//! Whole-workspace baseline for the production TUI startup, indexing, and frame path.
//!
//! Run with:
//!   cargo bench -p diffing-tui --bench workspace

use std::fs;
use std::hint::black_box;
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use diffing_tui::app::{App, Experience};
use diffing_tui::diff_context::DiffContext;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

const DIRECTORY_COUNT: usize = 250;
const FILES_PER_DIRECTORY: usize = 20;
const INDEX_TIMEOUT: Duration = Duration::from_secs(30);

fn main() {
    let repo = tempfile::tempdir().expect("create workspace benchmark repository");
    let storage = tempfile::tempdir().expect("create isolated diffing storage");
    std::env::set_var("DIFFING_STORAGE_ROOT", storage.path());
    std::env::set_var("DIFFING_CONFIG_DIR", storage.path().join("config"));
    populate_repository(repo.path());

    let constructor_start = Instant::now();
    let mut app = App::new(
        repo.path().to_path_buf(),
        Vec::new(),
        Experience::Viewer,
        DiffContext::from_env_or_args(&[]),
        None,
    )
    .expect("construct viewer app");
    let constructor = constructor_start.elapsed();

    let indexing_start = Instant::now();
    while !app.index.complete {
        app.tick_index();
        if indexing_start.elapsed() >= INDEX_TIMEOUT {
            panic!("index did not complete within {INDEX_TIMEOUT:?}");
        }
        thread::sleep(Duration::from_millis(1));
    }
    let indexing = indexing_start.elapsed();

    let area = Rect::new(0, 0, 160, 48);
    let mut buffer = Buffer::empty(area);
    let first_render_start = Instant::now();
    app.render(area, &mut buffer);
    black_box(&buffer);
    let first_render = first_render_start.elapsed();

    let mut samples = Vec::with_capacity(100);
    for index in 0..100 {
        buffer.reset();
        let key = if index % 2 == 0 { 'j' } else { 'k' };
        let start = Instant::now();
        app.handle_key(KeyEvent::new(KeyCode::Char(key), KeyModifiers::NONE));
        app.render(area, &mut buffer);
        black_box(&buffer);
        samples.push(start.elapsed());
    }
    samples.sort_unstable();

    println!(
        "files={} directories={} files_per_directory={}",
        DIRECTORY_COUNT * FILES_PER_DIRECTORY,
        DIRECTORY_COUNT,
        FILES_PER_DIRECTORY
    );
    println!("constructor_ms={:.3}", millis(constructor));
    println!("index_complete_ms={:.3}", millis(indexing));
    println!("first_render_ms={:.3}", millis(first_render));
    println!(
        "cursor_frames=100 cursor_p50_ms={:.3} cursor_p95_ms={:.3}",
        millis(samples[49]),
        millis(samples[94])
    );
}

fn populate_repository(root: &Path) {
    run_git(root, &["init", "-q"]);
    run_git(root, &["config", "user.email", "benchmark@example.invalid"]);
    run_git(root, &["config", "user.name", "diffing benchmark"]);

    for directory in 0..DIRECTORY_COUNT {
        let directory_path = root.join(format!("dir-{directory:03}"));
        fs::create_dir_all(&directory_path).expect("create benchmark directory");
        for file in 0..FILES_PER_DIRECTORY {
            let path = directory_path.join(format!("file-{file:02}.rs"));
            fs::write(
                &path,
                format!("pub fn value() -> &'static str {{ \"old-{directory}-{file}\" }}\n"),
            )
            .expect("write base benchmark file");
        }
    }
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-qm", "baseline"]);

    for directory in 0..DIRECTORY_COUNT {
        for file in 0..FILES_PER_DIRECTORY {
            let path = root
                .join(format!("dir-{directory:03}"))
                .join(format!("file-{file:02}.rs"));
            fs::write(
                &path,
                format!("pub fn value() -> &'static str {{ \"new-{directory}-{file}\" }}\n"),
            )
            .expect("write modified benchmark file");
        }
    }
}

fn run_git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .expect("run git fixture command");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}
