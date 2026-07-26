//! Million-line production-renderer performance contract.
//!
//! Quick run:
//!   cargo bench -p diffing-tui --bench render_diff
//! Release-scale run:
//!   DIFFING_RENDER_BENCH_LINES=1000000 cargo bench -p diffing-tui --bench render_diff

use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::io::{Cursor, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use diffing_core::comments::{CommentSeverity, CommentSide, CommentStatus, ReviewComment};
use diffing_core::index::{build_index_from_reader, DiffIndex};
use diffing_tui::lsp::LspDiagnostic;
use diffing_tui::themes::{Palette, ThemeName};
use diffing_tui::ui::file_diff_card::{render_card, DiffRenderCache};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

struct CountingAllocator;

static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);
static ALLOCATED_BYTES: AtomicU64 = AtomicU64::new(0);

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        ALLOCATED_BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
        System.alloc(layout)
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        ALLOCATED_BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
        System.alloc_zeroed(layout)
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        ALLOCATED_BYTES.fetch_add(new_size as u64, Ordering::Relaxed);
        System.realloc(ptr, layout, new_size)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
    }
}

#[global_allocator]
static GLOBAL_ALLOCATOR: CountingAllocator = CountingAllocator;

#[derive(Debug)]
struct Sample {
    p50: Duration,
    p95: Duration,
    allocations_per_frame: u64,
    bytes_per_frame: u64,
}

fn main() {
    let lines = env_usize("DIFFING_RENDER_BENCH_LINES", 100_000);
    let iterations = env_usize("DIFFING_RENDER_BENCH_ITERS", 500).max(50);
    let patch = generated_patch(lines);
    let directory = tempfile::tempdir().expect("create render benchmark directory");
    let spool = directory.path().join("render.patch");
    let index = build_index_from_reader(Cursor::new(&patch), &spool, 1, |_| {})
        .expect("index generated render patch");
    let area = Rect::new(0, 0, 240, 80);
    let theme = ThemeName::default();
    let palette = Palette::for_theme(theme);
    let mut cache = DiffRenderCache::default();
    let mut buffer = Buffer::empty(area);
    let comments = dense_comments();
    let diagnostics = dense_diagnostics();

    let first = Instant::now();
    paint(
        &index,
        &mut cache,
        &mut buffer,
        area,
        0,
        0,
        0,
        false,
        false,
        &[],
        &[],
        &palette,
    );
    let cold = first.elapsed();

    let warm = measure(iterations, || {
        buffer.reset();
        paint(
            &index,
            &mut cache,
            &mut buffer,
            area,
            0,
            0,
            0,
            false,
            false,
            &[],
            &[],
            &palette,
        );
        black_box(&buffer);
    });

    let mut cursor = 1u64;
    let cursor_move = measure(iterations, || {
        buffer.reset();
        cursor = if cursor == 1 { 2 } else { 1 };
        paint(
            &index,
            &mut cache,
            &mut buffer,
            area,
            0,
            0,
            cursor,
            false,
            false,
            &[],
            &[],
            &palette,
        );
        black_box(&buffer);
    });

    let mut cursor_before = Buffer::empty(area);
    let mut cursor_after = Buffer::empty(area);
    paint(
        &index,
        &mut cache,
        &mut cursor_before,
        area,
        0,
        0,
        1,
        false,
        false,
        &[],
        &[],
        &palette,
    );
    paint(
        &index,
        &mut cache,
        &mut cursor_after,
        area,
        0,
        0,
        2,
        false,
        false,
        &[],
        &[],
        &palette,
    );
    let cursor_changed_cells = cursor_before.diff(&cursor_after).len();

    let mut adjacent = 0u64;
    let adjacent_scroll = measure(iterations, || {
        buffer.reset();
        adjacent = (adjacent + 1) % 2_000;
        paint(
            &index,
            &mut cache,
            &mut buffer,
            area,
            0,
            adjacent,
            adjacent,
            false,
            false,
            &[],
            &[],
            &palette,
        );
        black_box(&buffer);
    });

    let mut jump = 0usize;
    let random_jump = measure(iterations, || {
        buffer.reset();
        jump = jump.wrapping_add(7_919);
        let file_index = jump % index.files.len().max(1);
        let rows = index.files[file_index].row_count.max(1);
        let scroll = (jump as u64 * 97) % rows;
        paint(
            &index,
            &mut cache,
            &mut buffer,
            area,
            file_index,
            scroll,
            scroll,
            false,
            false,
            &[],
            &[],
            &palette,
        );
        black_box(&buffer);
    });

    let annotated = measure(iterations, || {
        buffer.reset();
        paint(
            &index,
            &mut cache,
            &mut buffer,
            area,
            0,
            0,
            1,
            false,
            false,
            &comments,
            &diagnostics,
            &palette,
        );
        black_box(&buffer);
    });

    let split = measure(iterations, || {
        buffer.reset();
        paint(
            &index,
            &mut cache,
            &mut buffer,
            area,
            0,
            0,
            1,
            true,
            false,
            &[],
            &[],
            &palette,
        );
        black_box(&buffer);
    });

    let wrapped = measure(iterations, || {
        buffer.reset();
        paint(
            &index,
            &mut cache,
            &mut buffer,
            area,
            0,
            0,
            1,
            false,
            true,
            &[],
            &[],
            &palette,
        );
        black_box(&buffer);
    });

    let long_patch = generated_long_line_patch(2 * 1024 * 1024);
    let long_spool = directory.path().join("long-line.patch");
    let long_index = build_index_from_reader(Cursor::new(&long_patch), &long_spool, 2, |_| {})
        .expect("index long-line patch");
    let mut long_cache = DiffRenderCache::default();
    ALLOCATIONS.store(0, Ordering::Relaxed);
    ALLOCATED_BYTES.store(0, Ordering::Relaxed);
    let long_cold_started = Instant::now();
    buffer.reset();
    paint(
        &long_index,
        &mut long_cache,
        &mut buffer,
        area,
        0,
        0,
        1,
        false,
        true,
        &[],
        &[],
        &palette,
    );
    let long_cold = long_cold_started.elapsed();
    let long_cold_allocations = ALLOCATIONS.load(Ordering::Relaxed);
    let long_cold_bytes = ALLOCATED_BYTES.load(Ordering::Relaxed);
    let long_line = measure(50, || {
        buffer.reset();
        paint(
            &long_index,
            &mut long_cache,
            &mut buffer,
            area,
            0,
            0,
            1,
            false,
            true,
            &[],
            &[],
            &palette,
        );
        black_box(&buffer);
    });

    println!(
        "lines={lines} patch_mib={:.1} cold_ms={:.3}",
        patch.len() as f64 / (1024.0 * 1024.0),
        cold.as_secs_f64() * 1_000.0
    );
    print_sample("warm", &warm);
    print_sample("cursor", &cursor_move);
    println!("cursor_changed_cells={cursor_changed_cells}");
    print_sample("adjacent_scroll", &adjacent_scroll);
    print_sample("random_jump", &random_jump);
    print_sample("annotated", &annotated);
    print_sample("split", &split);
    print_sample("wrapped", &wrapped);
    println!(
        "long_line_cold_ms={:.3} long_line_cold_allocs={} long_line_cold_bytes={}",
        long_cold.as_secs_f64() * 1_000.0,
        long_cold_allocations,
        long_cold_bytes,
    );
    print_sample("long_line_wrapped", &long_line);

    assert_render_contract(
        &[
            ("warm", &warm),
            ("cursor", &cursor_move),
            ("annotated", &annotated),
            ("split", &split),
            ("wrapped", &wrapped),
            ("long_line_wrapped", &long_line),
        ],
        &adjacent_scroll,
        &random_jump,
        cursor_changed_cells,
        area,
        long_cold,
        long_cold_bytes,
    );
}

fn assert_render_contract(
    allocation_free: &[(&str, &Sample)],
    adjacent_scroll: &Sample,
    random_jump: &Sample,
    cursor_changed_cells: usize,
    area: Rect,
    long_cold: Duration,
    long_cold_bytes: u64,
) {
    let frame_budget = Duration::from_micros(16_667);
    for (label, sample) in allocation_free {
        assert!(
            sample.p95 < frame_budget,
            "{label} p95 {:?} exceeded one 60 Hz frame",
            sample.p95
        );
        assert_eq!(
            sample.allocations_per_frame, 0,
            "{label} warm path allocated"
        );
    }
    assert!(
        adjacent_scroll.p95 < frame_budget,
        "adjacent scroll p95 {:?} exceeded one 60 Hz frame",
        adjacent_scroll.p95
    );
    // Crossing an overscan-chunk boundary constructs one new retained surface;
    // the amortized churn must remain small over sustained scrolling.
    assert!(
        adjacent_scroll.allocations_per_frame < 1_024
            && adjacent_scroll.bytes_per_frame < 256 * 1024,
        "adjacent scroll churn regressed to {} allocations / {} bytes per frame",
        adjacent_scroll.allocations_per_frame,
        adjacent_scroll.bytes_per_frame
    );
    assert!(
        random_jump.p95 < frame_budget,
        "random jump p95 {:?} exceeded one 60 Hz frame",
        random_jump.p95
    );
    assert!(
        cursor_changed_cells <= area.width as usize * 2,
        "cursor motion changed {cursor_changed_cells} cells instead of at most two rows"
    );
    assert!(
        long_cold < Duration::from_millis(100),
        "cold pathological line took {long_cold:?}"
    );
    assert!(
        long_cold_bytes < 4 * 1024 * 1024,
        "cold pathological line allocated {long_cold_bytes} bytes"
    );
}

#[allow(clippy::too_many_arguments)]
fn paint(
    index: &DiffIndex,
    cache: &mut DiffRenderCache,
    buffer: &mut Buffer,
    area: Rect,
    file_index: usize,
    scroll: u64,
    cursor: u64,
    split: bool,
    wrap: bool,
    comments: &[ReviewComment],
    diagnostics: &[LspDiagnostic],
    palette: &Palette,
) {
    render_card(
        index,
        cache,
        file_index,
        area,
        scroll,
        cursor,
        None,
        None,
        0,
        wrap,
        split,
        true,
        4,
        ThemeName::default(),
        comments,
        diagnostics,
        0,
        palette,
        buffer,
    );
}

fn measure(mut iterations: usize, mut frame: impl FnMut()) -> Sample {
    for _ in 0..10 {
        frame();
    }
    iterations = iterations.max(1);
    let mut durations = Vec::with_capacity(iterations);
    ALLOCATIONS.store(0, Ordering::Relaxed);
    ALLOCATED_BYTES.store(0, Ordering::Relaxed);
    for _ in 0..iterations {
        let started = Instant::now();
        frame();
        durations.push(started.elapsed());
    }
    let allocations = ALLOCATIONS.load(Ordering::Relaxed);
    let allocated_bytes = ALLOCATED_BYTES.load(Ordering::Relaxed);
    durations.sort_unstable();
    Sample {
        p50: durations[durations.len() / 2],
        p95: durations[durations.len() * 95 / 100],
        allocations_per_frame: allocations / iterations as u64,
        bytes_per_frame: allocated_bytes / iterations as u64,
    }
}

fn print_sample(label: &str, sample: &Sample) {
    println!(
        "{label}_p50_ms={:.3} {label}_p95_ms={:.3} {label}_allocs={} {label}_bytes={}",
        sample.p50.as_secs_f64() * 1_000.0,
        sample.p95.as_secs_f64() * 1_000.0,
        sample.allocations_per_frame,
        sample.bytes_per_frame,
    );
}

fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn generated_patch(lines: usize) -> Vec<u8> {
    const LINES_PER_FILE: usize = 10_000;
    let file_count = lines.div_ceil(LINES_PER_FILE);
    let mut patch = Vec::with_capacity(lines.saturating_mul(80));
    for file in 0..file_count {
        let count = (lines - file * LINES_PER_FILE).min(LINES_PER_FILE);
        writeln!(
            patch,
            "diff --git a/src/generated-{file}.rs b/src/generated-{file}.rs"
        )
        .unwrap();
        writeln!(patch, "--- a/src/generated-{file}.rs").unwrap();
        writeln!(patch, "+++ b/src/generated-{file}.rs").unwrap();
        writeln!(patch, "@@ -1,{count} +1,{count} @@ generated").unwrap();
        for line in 0..count {
            match line % 5 {
                0 => writeln!(patch, "-let generated_{line} = old_value + {file};").unwrap(),
                1 => writeln!(patch, "+let generated_{line} = new_value + {file};").unwrap(),
                _ => writeln!(patch, " let generated_{line} = context + {file};").unwrap(),
            }
        }
    }
    patch
}

fn generated_long_line_patch(bytes: usize) -> Vec<u8> {
    let mut patch = b"diff --git a/src/long.rs b/src/long.rs\n--- a/src/long.rs\n+++ b/src/long.rs\n@@ -1,1 +1,1 @@\n+".to_vec();
    patch.extend(std::iter::repeat(b'x').take(bytes));
    patch.push(b'\n');
    patch
}

fn dense_comments() -> Vec<ReviewComment> {
    (1..=2_000)
        .map(|line| ReviewComment {
            id: format!("comment-{line}"),
            file_path: "src/generated-0.rs".to_string(),
            side: if line % 5 == 1 {
                CommentSide::Additions
            } else {
                CommentSide::Deletions
            },
            line_number: line,
            start_line_number: None,
            line_content: String::new(),
            body: "benchmark".to_string(),
            status: CommentStatus::Open,
            created_at: line as u64,
            replies: Vec::new(),
            severity: Some(CommentSeverity::Blocking),
        })
        .collect()
}

fn dense_diagnostics() -> Vec<LspDiagnostic> {
    (0..2_000)
        .map(|line| LspDiagnostic {
            line,
            start_character: 0,
            end_character: 1,
            severity: 2,
            message: "benchmark".to_string(),
            source: Some("bench".to_string()),
        })
        .collect()
}
