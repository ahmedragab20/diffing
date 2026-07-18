//! Generated large-diff performance contract.
//!
//! Run the quick 100k-line contract with:
//!   cargo bench -p diffing-core --bench diff_index
//! Run the release-scale million-line contract with:
//!   DIFFING_BENCH_LINES=1000000 cargo bench -p diffing-core --bench diff_index

use std::hint::black_box;
use std::io::{Cursor, Write};
use std::time::{Duration, Instant};

use diffing_core::index::build_index_from_reader;

fn main() {
    let lines = std::env::var("DIFFING_BENCH_LINES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(100_000);
    let patch = generated_patch(lines);
    let dir = tempfile::tempdir().expect("create benchmark directory");
    let spool = dir.path().join("large.patch");

    let start = Instant::now();
    let mut first_snapshot = None;
    let index = build_index_from_reader(Cursor::new(&patch), &spool, 1, |_| {
        first_snapshot.get_or_insert_with(|| start.elapsed());
    })
    .expect("index generated patch");
    let ingestion = start.elapsed();

    let mut samples = Vec::with_capacity(2_000);
    for iteration in 0..2_000usize {
        let file = iteration % index.files.len();
        let rows = index.files[file].row_count.max(1);
        let start_row = ((iteration as u64 * 7_919) % rows).saturating_sub(20);
        let started = Instant::now();
        let viewport = index
            .viewport(file, start_row, 80, 256 * 1024)
            .expect("read viewport");
        black_box(viewport);
        samples.push(started.elapsed());
    }
    samples.sort_unstable();
    let p95 = samples[samples.len() * 95 / 100];

    println!(
        "lines={lines} patch_mib={:.1} first_snapshot_ms={} ingestion_ms={} viewport_p95_us={}",
        patch.len() as f64 / (1024.0 * 1024.0),
        first_snapshot.unwrap_or(ingestion).as_millis(),
        ingestion.as_millis(),
        p95.as_micros(),
    );

    let first_frame_limit = if lines >= 1_000_000 {
        Duration::from_secs(1)
    } else {
        Duration::from_millis(300)
    };
    assert!(
        first_snapshot.unwrap_or(ingestion) <= first_frame_limit,
        "first usable snapshot exceeded {first_frame_limit:?}"
    );
    assert!(
        p95 <= Duration::from_millis(8),
        "viewport p95 exceeded 8ms: {p95:?}"
    );
}

fn generated_patch(lines: usize) -> Vec<u8> {
    const LINES_PER_FILE: usize = 10_000;
    let file_count = lines.div_ceil(LINES_PER_FILE);
    let mut patch = Vec::with_capacity(lines.saturating_mul(96));
    for file in 0..file_count {
        let count = (lines - file * LINES_PER_FILE).min(LINES_PER_FILE);
        writeln!(
            patch,
            "diff --git a/src/generated-{file}.rs b/src/generated-{file}.rs"
        )
        .unwrap();
        writeln!(patch, "index 1111111..2222222 100644").unwrap();
        writeln!(patch, "--- a/src/generated-{file}.rs").unwrap();
        writeln!(patch, "+++ b/src/generated-{file}.rs").unwrap();
        writeln!(patch, "@@ -1,{count} +1,{count} @@ generated").unwrap();
        for line in 0..count {
            match line % 5 {
                0 => writeln!(
                    patch,
                    "-let generated_{line} = \"old payload for benchmark\";"
                )
                .unwrap(),
                1 => writeln!(
                    patch,
                    "+let generated_{line} = \"new payload for benchmark\";"
                )
                .unwrap(),
                _ => writeln!(
                    patch,
                    " let generated_{line} = \"context payload for benchmark\";"
                )
                .unwrap(),
            }
        }
    }
    patch
}
