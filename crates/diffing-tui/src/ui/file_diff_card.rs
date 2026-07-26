//! Virtual diff viewport.
//!
//! Only rows intersecting the terminal viewport are decoded and highlighted.
//! The complete file is never converted to ratatui widgets or owned strings.

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use diffing_core::comments::{CommentSeverity, CommentSide, CommentStatus, ReviewComment};
use diffing_core::index::{
    DiffIndex, IndexedChangeKind, IndexedLineKind, ViewRow, DEFAULT_VIEWPORT_MAX_BYTES,
};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use unicode_width::UnicodeWidthChar;

use crate::diff::highlight::highlight_line;
use crate::lsp::LspDiagnostic;
use crate::themes::{Palette, ThemeName};
use crate::ui::gridline::GridlineTokens;

const VIEWPORT_CACHE_ENTRIES: usize = 12;
const VIEWPORT_OVERSCAN_MULTIPLIER: usize = 6;
const VIEWPORT_CACHE_MAX_ROWS: usize = 1_024;
const FRAME_CACHE_ENTRIES: usize = 8;
const FRAME_CACHE_MAX_CELLS: usize = 256 * 1_024;
const INTRALINE_CACHE_ENTRIES: usize = 2_048;
const INTRALINE_CACHE_MAX_BYTES: usize = 8 * 1024 * 1024;

thread_local! {
    static INTRALINE_CACHE: RefCell<IntralineCache> = RefCell::new(IntralineCache::default());
}

#[derive(Default)]
struct IntralineCache {
    entries: HashMap<String, HashMap<String, Arc<IntralineMasks>>>,
    order: VecDeque<(String, String)>,
    bytes: usize,
}

struct IntralineMasks {
    old: Vec<bool>,
    new: Vec<bool>,
}

impl IntralineCache {
    fn get(&self, old: &str, new: &str) -> Option<Arc<IntralineMasks>> {
        self.entries.get(old)?.get(new).cloned()
    }

    fn insert(&mut self, old: &str, new: &str, masks: Arc<IntralineMasks>) {
        if self
            .entries
            .get(old)
            .is_some_and(|entries| entries.contains_key(new))
        {
            return;
        }
        let bytes = old
            .len()
            .saturating_add(new.len())
            .saturating_add(masks.old.len())
            .saturating_add(masks.new.len());
        self.bytes = self.bytes.saturating_add(bytes);
        let key = (old.to_string(), new.to_string());
        self.order.push_back(key.clone());
        self.entries
            .entry(key.0.clone())
            .or_default()
            .insert(key.1.clone(), masks);
        while self.order.len() > INTRALINE_CACHE_ENTRIES || self.bytes > INTRALINE_CACHE_MAX_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            let mut remove_old = false;
            if let Some(entries) = self.entries.get_mut(oldest.0.as_str()) {
                if let Some(removed) = entries.remove(oldest.1.as_str()) {
                    self.bytes = self.bytes.saturating_sub(
                        oldest
                            .0
                            .len()
                            .saturating_add(oldest.1.len())
                            .saturating_add(removed.old.len())
                            .saturating_add(removed.new.len()),
                    );
                }
                remove_old = entries.is_empty();
            }
            if remove_old {
                self.entries.remove(oldest.0.as_str());
            }
        }
    }
}

#[derive(Default)]
pub struct DiffRenderCache {
    generation: Option<u64>,
    viewports: VecDeque<CachedViewport>,
    frames: VecDeque<(FrameKey, Arc<CachedFrame>)>,
    frame_cells: usize,
    last_request: Option<FrameKey>,
    #[cfg(test)]
    fills: usize,
    #[cfg(test)]
    frame_builds: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FrameKey {
    generation: u64,
    patch_bytes: u64,
    file_index: usize,
    scroll: u64,
    width: u16,
    height: u16,
    horizontal_offset: usize,
    wrap: bool,
    split: bool,
    line_numbers: bool,
    tab_size: u8,
    theme: ThemeName,
    annotation_revision: u64,
}

impl FrameKey {
    fn same_layout(self, other: Self) -> bool {
        Self { scroll: 0, ..self } == Self { scroll: 0, ..other }
    }
}

struct CachedFrame {
    buffer: Buffer,
    logical_rows: Vec<[Option<u64>; 2]>,
}

#[derive(Clone, Copy)]
struct FrameInteraction {
    cursor_row: u64,
    selection: Option<(u64, u64)>,
    hovered_row: Option<u64>,
}

impl CachedFrame {
    fn cells(&self) -> usize {
        self.buffer.area.area() as usize
    }

    fn render(
        &self,
        area: Rect,
        source_row: usize,
        interaction: FrameInteraction,
        palette: &Palette,
        buf: &mut Buffer,
    ) {
        for (destination_row, logical_rows) in self
            .logical_rows
            .iter()
            .skip(source_row)
            .take(area.height as usize)
            .enumerate()
        {
            let source_y = source_row.saturating_add(destination_row) as u16;
            let destination_y = destination_row as u16;
            if destination_y >= area.height {
                break;
            }
            let interactive = logical_rows.iter().flatten().any(|logical_row| {
                *logical_row == interaction.cursor_row
                    || interaction.hovered_row == Some(*logical_row)
                    || interaction
                        .selection
                        .is_some_and(|(start, end)| *logical_row >= start && *logical_row <= end)
            });
            for x in 0..area.width {
                let source = &self.buffer[(x, source_y)];
                let target = &mut buf[(area.x + x, area.y + destination_y)];
                target.clone_from(source);
                if interactive {
                    target.set_bg(palette.selection_bg);
                }
            }
        }
    }
}

struct CachedViewport {
    patch_bytes: u64,
    file_index: usize,
    total_rows: u64,
    start_row: u64,
    max_line_bytes: usize,
    rows: Vec<ViewRow>,
}

impl DiffRenderCache {
    fn sequential_request(&mut self, request: FrameKey) -> bool {
        let sequential = self.last_request.is_some_and(|previous| {
            previous.same_layout(request)
                && previous.scroll.abs_diff(request.scroll) <= request.height.max(1) as u64
        });
        self.last_request = Some(request);
        sequential
    }

    fn frame(&mut self, key: FrameKey) -> Option<Arc<CachedFrame>> {
        let position = self
            .frames
            .iter()
            .position(|(candidate, _)| *candidate == key)?;
        let cached = self
            .frames
            .remove(position)
            .expect("position came from the same frame cache");
        let frame = cached.1.clone();
        self.frames.push_back(cached);
        Some(frame)
    }

    fn insert_frame(&mut self, key: FrameKey, frame: CachedFrame) -> Arc<CachedFrame> {
        let frame = Arc::new(frame);
        let cells = frame.cells();
        if cells > FRAME_CACHE_MAX_CELLS {
            return frame;
        }
        self.frame_cells = self.frame_cells.saturating_add(cells);
        self.frames.push_back((key, frame.clone()));
        while self.frames.len() > FRAME_CACHE_ENTRIES || self.frame_cells > FRAME_CACHE_MAX_CELLS {
            let Some((_, removed)) = self.frames.pop_front() else {
                break;
            };
            self.frame_cells = self.frame_cells.saturating_sub(removed.cells());
        }
        frame
    }

    fn rows<'a>(
        &'a mut self,
        index: &DiffIndex,
        file_index: usize,
        start_row: u64,
        requested_rows: usize,
        max_line_bytes: usize,
    ) -> Result<&'a [ViewRow], diffing_core::index::IndexError> {
        if self.generation != Some(index.generation) {
            self.generation = Some(index.generation);
            self.viewports.clear();
            self.frames.clear();
            self.frame_cells = 0;
            self.last_request = None;
        }
        let total_rows = index
            .files
            .get(file_index)
            .map(|file| file.row_count)
            .unwrap_or(0);
        let requested_end = start_row
            .saturating_add(requested_rows as u64)
            .min(total_rows);
        if let Some(position) = self.viewports.iter().position(|cached| {
            let cached_end = cached.start_row.saturating_add(cached.rows.len() as u64);
            cached.patch_bytes == index.patch_bytes
                && cached.file_index == file_index
                && cached.total_rows == total_rows
                && cached.start_row <= start_row
                && cached_end >= requested_end
                && cached.max_line_bytes >= max_line_bytes
        }) {
            let cached = &self.viewports[position];
            let offset = start_row.saturating_sub(cached.start_row) as usize;
            let end = offset.saturating_add(requested_rows).min(cached.rows.len());
            return Ok(&cached.rows[offset..end]);
        }

        let overscan = requested_rows
            .saturating_mul(VIEWPORT_OVERSCAN_MULTIPLIER)
            .clamp(requested_rows, VIEWPORT_CACHE_MAX_ROWS);
        let look_behind = requested_rows.saturating_mul(2) as u64;
        let cache_start = start_row.saturating_sub(look_behind);
        let mut viewport = index.viewport_for_render(
            file_index,
            cache_start,
            overscan,
            DEFAULT_VIEWPORT_MAX_BYTES.saturating_mul(4),
            max_line_bytes,
        )?;
        let viewport_end = viewport
            .start_row
            .saturating_add(viewport.rows.len() as u64);
        if viewport.start_row > start_row || viewport_end <= start_row {
            viewport = index.viewport_for_render(
                file_index,
                start_row,
                requested_rows,
                DEFAULT_VIEWPORT_MAX_BYTES,
                max_line_bytes,
            )?;
        }
        self.viewports.push_back(CachedViewport {
            patch_bytes: index.patch_bytes,
            file_index,
            total_rows,
            start_row: viewport.start_row,
            max_line_bytes,
            rows: viewport.rows,
        });
        while self.viewports.len() > VIEWPORT_CACHE_ENTRIES {
            self.viewports.pop_front();
        }
        #[cfg(test)]
        {
            self.fills += 1;
        }
        let cached = self.viewports.back().expect("viewport was just cached");
        let offset = start_row.saturating_sub(cached.start_row) as usize;
        let end = offset.saturating_add(requested_rows).min(cached.rows.len());
        Ok(cached.rows.get(offset..end).unwrap_or_default())
    }
}

#[allow(clippy::too_many_arguments)]
pub fn render_card(
    index: &DiffIndex,
    cache: &mut DiffRenderCache,
    file_index: usize,
    area: Rect,
    scroll: u64,
    cursor_row: u64,
    selection: Option<(u64, u64)>,
    hovered_row: Option<u64>,
    horizontal_offset: usize,
    wrap: bool,
    split: bool,
    line_numbers: bool,
    tab_size: u8,
    theme: ThemeName,
    comments: &[ReviewComment],
    diagnostics: &[LspDiagnostic],
    annotation_revision: u64,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let request = FrameKey {
        generation: index.generation,
        patch_bytes: index.patch_bytes,
        file_index,
        scroll,
        width: area.width,
        height: area.height,
        horizontal_offset,
        wrap,
        split,
        line_numbers,
        tab_size,
        theme,
        annotation_revision,
    };
    let sequential = cache.sequential_request(request);
    let (frame_scroll, frame_height, source_row) =
        if sequential && !split && !wrap && area.height > 0 {
            let chunk = area.height.max(1) as u64 * 3;
            let frame_scroll = scroll / chunk * chunk;
            (
                frame_scroll,
                area.height.saturating_mul(6).min(1_024),
                scroll.saturating_sub(frame_scroll) as usize,
            )
        } else {
            (scroll, area.height, 0)
        };
    let key = FrameKey {
        scroll: frame_scroll,
        height: frame_height,
        ..request
    };
    if let Some(frame) = cache.frame(key) {
        frame.render(
            area,
            source_row,
            FrameInteraction {
                cursor_row,
                selection,
                hovered_row,
            },
            palette,
            buf,
        );
        return;
    }

    let requested_rows = if split {
        // A side-by-side display row may consume two unified patch rows.
        // Decode enough logical rows to keep the terminal viewport full.
        frame_height.saturating_mul(2).saturating_add(4) as usize
    } else {
        frame_height as usize
    };
    let path = index
        .files
        .get(file_index)
        .map(|file| file.display_path().to_string_lossy().into_owned())
        .unwrap_or_default();
    let options = RowRenderOptions {
        path: &path,
        horizontal_offset,
        wrap,
        split,
        line_numbers,
        tab_size,
        theme,
        width: area.width.saturating_sub(2),
        max_lines: frame_height.max(1) as usize,
        palette,
    };
    // Four bytes per terminal cell covers the largest UTF-8 scalar. Wrapped
    // rows need only enough source for the physical viewport; unwrapped rows
    // additionally retain the horizontal prefix that must be skipped.
    let visible_cells = if wrap {
        (area.width as usize).saturating_mul(frame_height.max(1) as usize)
    } else {
        horizontal_offset.saturating_add(area.width as usize)
    };
    let max_line_bytes = visible_cells.saturating_mul(4).saturating_add(8);
    let frame = {
        let Ok(viewport_rows) = cache.rows(
            index,
            file_index,
            frame_scroll,
            requested_rows,
            max_line_bytes,
        ) else {
            return;
        };
        build_cached_frame(
            viewport_rows,
            frame_scroll,
            split,
            area.width,
            frame_height,
            &path,
            options,
            comments,
            diagnostics,
            palette,
        )
    };
    #[cfg(test)]
    {
        cache.frame_builds += 1;
    }
    let frame = cache.insert_frame(key, frame);
    frame.render(
        area,
        source_row,
        FrameInteraction {
            cursor_row,
            selection,
            hovered_row,
        },
        palette,
        buf,
    );
}

#[allow(clippy::too_many_arguments)]
fn build_cached_frame(
    viewport_rows: &[ViewRow],
    scroll: u64,
    split: bool,
    width: u16,
    height: u16,
    path: &str,
    options: RowRenderOptions<'_>,
    comments: &[ReviewComment],
    diagnostics: &[LspDiagnostic],
    palette: &Palette,
) -> CachedFrame {
    let mut buffer = Buffer::empty(Rect::new(0, 0, width, height));
    let mut physical_rows = Vec::with_capacity(height as usize);
    let decorations = DecorationIndex::new(path, comments, diagnostics);
    let rows = display_rows(viewport_rows, scroll, split);
    let mut y = 0u16;
    'rows: for row in rows {
        let logical_rows = row.logical_rows();
        let row_options = RowRenderOptions {
            max_lines: height.saturating_sub(y).max(1) as usize,
            ..options
        };
        let (mut lines, markers) = match row {
            DisplayRow::Shared { row, .. } => (
                build_row_lines(row, row_options),
                review_markers(row, &decorations, palette),
            ),
            DisplayRow::Split { left, right } => {
                let lines = build_paired_split_lines(
                    left.map(|(_, row)| row),
                    right.map(|(_, row)| row),
                    &row_options,
                );
                let markers = merge_review_markers(
                    left.map(|(_, row)| row),
                    right.map(|(_, row)| row),
                    &decorations,
                    palette,
                );
                (lines, markers)
            }
        };
        for (wrapped_index, line) in lines.iter_mut().enumerate() {
            let markers = if wrapped_index == 0 {
                markers.clone()
            } else {
                vec![Span::raw(" "), Span::raw(" ")]
            };
            line.spans.splice(0..0, markers);
        }
        for line in lines {
            if y >= height {
                break 'rows;
            }
            render_line(
                line,
                Rect::new(0, y, width, 1),
                false,
                false,
                palette,
                &mut buffer,
            );
            physical_rows.push(logical_rows);
            y += 1;
        }
    }
    CachedFrame {
        buffer,
        logical_rows: physical_rows,
    }
}

#[derive(Clone, Copy)]
enum DisplayRow<'a> {
    Shared {
        logical_row: u64,
        row: &'a ViewRow,
    },
    Split {
        left: Option<(u64, &'a ViewRow)>,
        right: Option<(u64, &'a ViewRow)>,
    },
}

impl DisplayRow<'_> {
    fn logical_rows(self) -> [Option<u64>; 2] {
        match self {
            Self::Shared { logical_row, .. } => [Some(logical_row), None],
            Self::Split { left, right } => [
                left.map(|(logical_row, _)| logical_row),
                right.map(|(logical_row, _)| logical_row),
            ],
        }
    }
}

struct SplitRun {
    deletion_start: usize,
    addition_start: usize,
    end: usize,
    offset: usize,
}

struct DisplayRows<'a> {
    rows: &'a [ViewRow],
    start: u64,
    split: bool,
    cursor: usize,
    run: Option<SplitRun>,
}

impl<'a> DisplayRows<'a> {
    fn new(rows: &'a [ViewRow], start: u64, split: bool) -> Self {
        Self {
            rows,
            start,
            split,
            cursor: 0,
            run: None,
        }
    }
}

impl<'a> Iterator for DisplayRows<'a> {
    type Item = DisplayRow<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if !self.split {
            let index = self.cursor;
            let row = self.rows.get(index)?;
            self.cursor += 1;
            return Some(DisplayRow::Shared {
                logical_row: self.start + index as u64,
                row,
            });
        }

        if let Some(run) = self.run.as_mut() {
            let deletions = run.addition_start - run.deletion_start;
            let additions = run.end - run.addition_start;
            if run.offset < deletions.max(additions) {
                let offset = run.offset;
                run.offset += 1;
                let left_index = (offset < deletions).then_some(run.deletion_start + offset);
                let right_index = (offset < additions).then_some(run.addition_start + offset);
                return Some(DisplayRow::Split {
                    left: left_index.map(|index| (self.start + index as u64, &self.rows[index])),
                    right: right_index.map(|index| (self.start + index as u64, &self.rows[index])),
                });
            }
            self.cursor = run.end;
            self.run = None;
        }

        let row = self.rows.get(self.cursor)?;
        match row {
            ViewRow::Line {
                kind: IndexedLineKind::Del,
                ..
            } => {
                let deletion_start = self.cursor;
                let mut cursor = self.cursor;
                while matches!(
                    self.rows.get(cursor),
                    Some(ViewRow::Line {
                        kind: IndexedLineKind::Del,
                        ..
                    })
                ) {
                    cursor += 1;
                }
                let addition_start = cursor;
                while matches!(
                    self.rows.get(cursor),
                    Some(ViewRow::Line {
                        kind: IndexedLineKind::Add,
                        ..
                    })
                ) {
                    cursor += 1;
                }
                self.run = Some(SplitRun {
                    deletion_start,
                    addition_start,
                    end: cursor,
                    offset: 0,
                });
                self.next()
            }
            ViewRow::Line {
                kind: IndexedLineKind::Add,
                ..
            } => {
                let index = self.cursor;
                self.cursor += 1;
                Some(DisplayRow::Split {
                    left: None,
                    right: Some((self.start + index as u64, &self.rows[index])),
                })
            }
            ViewRow::Line {
                kind: IndexedLineKind::Context,
                ..
            } => {
                let index = self.cursor;
                self.cursor += 1;
                Some(DisplayRow::Split {
                    left: Some((self.start + index as u64, row)),
                    right: Some((self.start + index as u64, row)),
                })
            }
            row => {
                let index = self.cursor;
                self.cursor += 1;
                Some(DisplayRow::Shared {
                    logical_row: self.start + index as u64,
                    row,
                })
            }
        }
    }
}

fn display_rows(rows: &[ViewRow], start: u64, split: bool) -> DisplayRows<'_> {
    DisplayRows::new(rows, start, split)
}

struct CommentInterval<'a> {
    start: u32,
    end: u32,
    comment: &'a ReviewComment,
}

#[derive(Default)]
struct CommentIntervals<'a> {
    intervals: Vec<CommentInterval<'a>>,
    prefix_max_end: Vec<u32>,
}

impl<'a> CommentIntervals<'a> {
    fn push(&mut self, comment: &'a ReviewComment) {
        let anchor = comment.start_line_number.unwrap_or(comment.line_number);
        self.intervals.push(CommentInterval {
            start: anchor.min(comment.line_number),
            end: anchor.max(comment.line_number),
            comment,
        });
    }

    fn finish(&mut self) {
        self.intervals.sort_by_key(|interval| interval.start);
        self.prefix_max_end.clear();
        self.prefix_max_end.reserve(self.intervals.len());
        let mut maximum = 0u32;
        for interval in &self.intervals {
            maximum = maximum.max(interval.end);
            self.prefix_max_end.push(maximum);
        }
    }

    fn best(&self, line: u32) -> Option<&'a ReviewComment> {
        let mut cursor = self
            .intervals
            .partition_point(|interval| interval.start <= line);
        let mut best = None;
        while cursor > 0 {
            cursor -= 1;
            let interval = &self.intervals[cursor];
            if interval.end >= line
                && best
                    .map(|current| comment_priority(interval.comment) > comment_priority(current))
                    .unwrap_or(true)
            {
                best = Some(interval.comment);
            }
            if cursor == 0 || self.prefix_max_end[cursor - 1] < line {
                break;
            }
        }
        best
    }
}

struct DecorationIndex<'a> {
    additions: CommentIntervals<'a>,
    deletions: CommentIntervals<'a>,
    diagnostics: Vec<&'a LspDiagnostic>,
}

impl<'a> DecorationIndex<'a> {
    fn new(path: &str, comments: &'a [ReviewComment], diagnostics: &'a [LspDiagnostic]) -> Self {
        let mut additions = CommentIntervals::default();
        let mut deletions = CommentIntervals::default();
        for comment in comments
            .iter()
            .filter(|comment| comment.file_path == path && comment.line_number > 0)
        {
            match comment.side {
                CommentSide::Additions => additions.push(comment),
                CommentSide::Deletions => deletions.push(comment),
            }
        }
        additions.finish();
        deletions.finish();
        let mut diagnostics: Vec<_> = diagnostics.iter().collect();
        diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.severity));
        Self {
            additions,
            deletions,
            diagnostics,
        }
    }

    fn comment(&self, side: CommentSide, line: u32) -> Option<&ReviewComment> {
        match side {
            CommentSide::Additions => self.additions.best(line),
            CommentSide::Deletions => self.deletions.best(line),
        }
    }

    fn diagnostic(&self, line: u32) -> Option<&LspDiagnostic> {
        let index = self
            .diagnostics
            .partition_point(|diagnostic| diagnostic.line < line);
        self.diagnostics
            .get(index)
            .copied()
            .filter(|diagnostic| diagnostic.line == line)
    }
}

fn comment_priority(comment: &ReviewComment) -> u8 {
    match (comment.status, comment.severity) {
        (CommentStatus::Open, Some(CommentSeverity::Blocking)) => 6,
        (CommentStatus::Open, Some(CommentSeverity::Question)) => 5,
        (CommentStatus::Open, None | Some(CommentSeverity::None)) => 4,
        (CommentStatus::Open, Some(CommentSeverity::Nit)) => 3,
        (CommentStatus::Open, Some(CommentSeverity::Praise)) => 2,
        (CommentStatus::Resolved, _) => 1,
    }
}

fn merge_review_markers(
    left: Option<&ViewRow>,
    right: Option<&ViewRow>,
    decorations: &DecorationIndex<'_>,
    palette: &Palette,
) -> Vec<Span<'static>> {
    let left = left
        .map(|row| review_markers(row, decorations, palette))
        .unwrap_or_else(|| vec![Span::raw(" "), Span::raw(" ")]);
    let right = right
        .map(|row| review_markers(row, decorations, palette))
        .unwrap_or_else(|| vec![Span::raw(" "), Span::raw(" ")]);
    left.into_iter()
        .zip(right)
        .map(|(left, right)| {
            if left.content.as_ref() == " " {
                right
            } else {
                left
            }
        })
        .collect()
}

fn review_markers(
    row: &ViewRow,
    decorations: &DecorationIndex<'_>,
    palette: &Palette,
) -> Vec<Span<'static>> {
    let tokens = GridlineTokens::from(palette);
    let ViewRow::Line {
        kind,
        old_lineno,
        new_lineno,
        ..
    } = row
    else {
        return vec![Span::raw(" "), Span::raw(" ")];
    };
    let side = if *kind == IndexedLineKind::Del {
        CommentSide::Deletions
    } else {
        CommentSide::Additions
    };
    let line = match side {
        CommentSide::Deletions => *old_lineno,
        CommentSide::Additions => new_lineno.or(*old_lineno),
    };
    let comment = line.and_then(|line| decorations.comment(side, line));
    let (comment_symbol, comment_color) = match comment {
        Some(comment) if comment.status == CommentStatus::Resolved => ("✓", tokens.muted),
        Some(comment) => match comment.severity {
            Some(CommentSeverity::Blocking) => ("!", tokens.negative),
            Some(CommentSeverity::Question) => ("?", tokens.info),
            Some(CommentSeverity::Nit) => ("·", tokens.warning),
            Some(CommentSeverity::Praise) => ("♥", tokens.positive),
            _ => ("●", tokens.accent),
        },
        None => (" ", tokens.muted),
    };
    let diagnostic = if *kind == IndexedLineKind::Del {
        None
    } else {
        new_lineno
            .and_then(|line| line.checked_sub(1))
            .and_then(|line| decorations.diagnostic(line))
    };
    let (diagnostic_symbol, diagnostic_color) =
        diagnostic.map_or((" ".to_string(), tokens.muted), |item| {
            let color = match item.severity {
                1 => tokens.negative,
                2 => tokens.warning,
                3 => tokens.info,
                _ => tokens.muted,
            };
            (item.marker().to_string(), color)
        });
    let background = match kind {
        IndexedLineKind::Add => tokens.added_surface,
        IndexedLineKind::Del => tokens.removed_surface,
        IndexedLineKind::Context => tokens.canvas,
    };
    vec![
        Span::styled(
            comment_symbol,
            Style::default()
                .fg(comment_color)
                .bg(background)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            diagnostic_symbol,
            Style::default()
                .fg(diagnostic_color)
                .bg(background)
                .add_modifier(Modifier::BOLD),
        ),
    ]
}

#[derive(Clone, Copy)]
struct RowRenderOptions<'a> {
    path: &'a str,
    horizontal_offset: usize,
    wrap: bool,
    split: bool,
    line_numbers: bool,
    tab_size: u8,
    theme: ThemeName,
    width: u16,
    max_lines: usize,
    palette: &'a Palette,
}

fn build_row_lines(row: &ViewRow, options: RowRenderOptions<'_>) -> Vec<Line<'static>> {
    let RowRenderOptions {
        path: _,
        horizontal_offset,
        wrap,
        split,
        line_numbers,
        tab_size,
        theme: _,
        width,
        max_lines,
        palette,
    } = options;
    if let ViewRow::Line {
        kind,
        old_lineno,
        new_lineno,
        content,
        ..
    } = row
    {
        if split {
            let gutter = if line_numbers { 8 } else { 2 };
            let content_width =
                (width.saturating_sub(3) / 2).saturating_sub(gutter).max(1) as usize;
            let visible = bounded_expand_slice(
                content,
                tab_size,
                horizontal_offset,
                content_width.saturating_mul(max_lines.max(1)),
            );
            let segments = if wrap && !visible.is_empty() {
                bounded_wrapped_segments(&visible, 1, content_width, max_lines)
            } else {
                vec![visible]
            };
            return segments
                .into_iter()
                .enumerate()
                .map(|(index, segment)| {
                    build_split_diff_line(
                        *kind,
                        (index == 0).then_some(*old_lineno).flatten(),
                        (index == 0).then_some(*new_lineno).flatten(),
                        &segment,
                        width,
                        &options,
                    )
                })
                .collect();
        }
        if wrap {
            let content_width = width
                .saturating_sub(if line_numbers { 18 } else { 5 })
                .max(1) as usize;
            let segments = bounded_wrapped_segments(content, tab_size, content_width, max_lines);
            return segments
                .into_iter()
                .enumerate()
                .map(|(index, segment)| {
                    build_diff_line(
                        *kind,
                        (index == 0).then_some(*old_lineno).flatten(),
                        (index == 0).then_some(*new_lineno).flatten(),
                        &segment,
                        &RowRenderOptions {
                            horizontal_offset: 0,
                            ..options
                        },
                    )
                })
                .collect();
        }
    }
    let line = match row {
        ViewRow::FileHeader {
            path, kind, binary, ..
        } => build_file_header(path, *kind, *binary, palette),
        ViewRow::HunkHeader {
            old_start,
            old_lines,
            new_start,
            new_lines,
            heading,
            ..
        } => Line::from(Span::styled(
            format!(
                "@@ -{old_start},{old_lines} +{new_start},{new_lines} @@{}",
                if heading.is_empty() {
                    String::new()
                } else {
                    format!(" {heading}")
                }
            ),
            Style::default()
                .fg(palette.accent)
                .add_modifier(Modifier::ITALIC),
        )),
        ViewRow::Line {
            kind,
            old_lineno,
            new_lineno,
            content,
            ..
        } => build_diff_line(*kind, *old_lineno, *new_lineno, content, &options),
        ViewRow::NoNewline { .. } => Line::from(Span::styled(
            "\\ No newline at end of file",
            Style::default().fg(palette.comment),
        )),
    };
    vec![line]
}

fn render_line(
    line: Line<'static>,
    area: Rect,
    selected: bool,
    hovered: bool,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let row_background = line
        .spans
        .iter()
        .filter_map(|span| span.style.bg)
        .find(|background| *background != Color::Reset);
    let interactive = selected || hovered;
    let background = if interactive {
        palette.selection_bg
    } else {
        row_background.unwrap_or(palette.bg)
    };
    for cell_x in area.x..area.x.saturating_add(area.width) {
        buf[(cell_x, area.y)]
            .set_symbol(" ")
            .set_style(Style::default().bg(background));
    }
    let mut x = area.x;
    for span in line.spans {
        if x >= area.x + area.width {
            break;
        }
        let style = if interactive {
            span.style.bg(palette.selection_bg)
        } else {
            span.style
        };
        for symbol in span.content.chars() {
            let symbol_width = UnicodeWidthChar::width(symbol).unwrap_or(0);
            if x.saturating_add(symbol_width as u16) > area.x + area.width {
                break;
            }
            if symbol_width == 0 {
                continue;
            }
            buf[(x, area.y)].set_char(symbol).set_style(style);
            x += symbol_width as u16;
        }
    }
}

fn build_file_header(
    path: &str,
    kind: IndexedChangeKind,
    binary: bool,
    palette: &Palette,
) -> Line<'static> {
    let marker = match kind {
        IndexedChangeKind::Modified => 'M',
        IndexedChangeKind::Added => 'A',
        IndexedChangeKind::Deleted => 'D',
        IndexedChangeKind::Renamed => 'R',
        IndexedChangeKind::Untracked => 'U',
        IndexedChangeKind::Binary => 'B',
    };
    let marker_color = match kind {
        IndexedChangeKind::Added | IndexedChangeKind::Untracked => palette.added,
        IndexedChangeKind::Deleted => palette.removed,
        IndexedChangeKind::Binary => palette.warning,
        IndexedChangeKind::Modified | IndexedChangeKind::Renamed => palette.accent,
    };
    let mut spans = vec![
        Span::styled("  ", Style::default().bg(palette.panel)),
        Span::styled(
            format!("{marker} "),
            Style::default()
                .bg(palette.panel)
                .fg(marker_color)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            path.to_string(),
            Style::default()
                .bg(palette.panel)
                .fg(palette.fg)
                .add_modifier(Modifier::BOLD),
        ),
    ];
    if binary {
        spans.push(Span::styled(
            "  (binary file; no textual diff)",
            Style::default().fg(palette.comment).bg(palette.panel),
        ));
    }
    Line::from(spans)
}

fn build_diff_line(
    kind: IndexedLineKind,
    old_lineno: Option<u32>,
    new_lineno: Option<u32>,
    content: &str,
    options: &RowRenderOptions<'_>,
) -> Line<'static> {
    let RowRenderOptions {
        path,
        horizontal_offset,
        line_numbers,
        tab_size,
        theme,
        palette,
        ..
    } = *options;
    let tokens = GridlineTokens::from(palette);
    let (marker, line_style, background) = match kind {
        IndexedLineKind::Add => (
            '+',
            Style::default().fg(tokens.positive),
            Some(tokens.added_surface),
        ),
        IndexedLineKind::Del => (
            '-',
            Style::default().fg(tokens.negative),
            Some(tokens.removed_surface),
        ),
        IndexedLineKind::Context => (' ', Style::default().fg(tokens.code), None),
    };
    let background = background.unwrap_or(tokens.canvas);
    let with_background = |style: Style| style.bg(background);
    let mut spans = Vec::new();
    if line_numbers {
        let old = old_lineno
            .map(|line| format!("{line:>6}"))
            .unwrap_or_else(|| "      ".to_string());
        let new = new_lineno
            .map(|line| format!("{line:>6}"))
            .unwrap_or_else(|| "      ".to_string());
        spans.push(Span::styled(
            format!(" {old} {new} "),
            with_background(Style::default().fg(tokens.gutter)),
        ));
    }
    spans.push(Span::styled(
        format!(" {marker} "),
        with_background(line_style.add_modifier(Modifier::BOLD)),
    ));
    let gutter_width = if line_numbers { 15 } else { 0 };
    let content_width = options
        .width
        .saturating_sub(gutter_width)
        .saturating_sub(3)
        .max(1) as usize;
    let visible_content = bounded_expand_slice(content, tab_size, horizontal_offset, content_width);
    let highlight_background = if background == Color::Reset {
        tokens.canvas
    } else {
        background
    };
    let highlighted = highlight_line(path, &visible_content, theme, palette, highlight_background);
    if highlighted.is_empty() {
        spans.push(Span::styled(
            " ",
            with_background(Style::default().fg(tokens.code)),
        ));
    } else {
        spans.extend(
            highlighted
                .iter()
                .map(|styled| Span::styled(styled.text.clone(), styled.style.bg(background))),
        );
    }
    Line::from(spans)
}

fn build_paired_split_lines(
    left: Option<&ViewRow>,
    right: Option<&ViewRow>,
    options: &RowRenderOptions<'_>,
) -> Vec<Line<'static>> {
    let tokens = GridlineTokens::from(options.palette);
    let width = options.width;
    let left_width = width.saturating_sub(1) as usize / 2;
    let right_width = width.saturating_sub(1) as usize - left_width;
    let gutter = if options.line_numbers { 8 } else { 2 };
    let content_width = left_width.min(right_width).saturating_sub(gutter).max(1);

    let visible_cells = if options.wrap {
        content_width.saturating_mul(options.max_lines.max(1))
    } else {
        content_width
    };
    let offset = if options.wrap {
        0
    } else {
        options.horizontal_offset
    };
    let left_data = split_line_data(left, true, options.tab_size, offset, visible_cells);
    let right_data = split_line_data(right, false, options.tab_size, offset, visible_cells);
    let masks = match (&left_data, &right_data) {
        (Some(left), Some(right))
            if left.kind == IndexedLineKind::Del && right.kind == IndexedLineKind::Add =>
        {
            intraline_masks(&left.content, &right.content)
        }
        _ => Arc::new(IntralineMasks {
            old: Vec::new(),
            new: Vec::new(),
        }),
    };
    let left_mask = &masks.old;
    let right_mask = &masks.new;

    let left_visible = left_data
        .as_ref()
        .map(|data| visible_side(&data.content, left_mask, 0, options.wrap));
    let right_visible = right_data
        .as_ref()
        .map(|data| visible_side(&data.content, right_mask, 0, options.wrap));
    let left_len = left_visible
        .as_ref()
        .map(|(content, _)| cell_width(content))
        .unwrap_or(0);
    let right_len = right_visible
        .as_ref()
        .map(|(content, _)| cell_width(content))
        .unwrap_or(0);
    let segment_count = if options.wrap {
        left_len.max(right_len).max(1).div_ceil(content_width)
    } else {
        1
    }
    .min(options.max_lines.max(1));

    (0..segment_count)
        .map(|segment_index| {
            let start = segment_index * content_width;
            let end = start + content_width;
            let mut spans = if let (Some(data), Some((content, mask))) =
                (left_data.as_ref(), left_visible.as_ref())
            {
                let (segment, segment_mask) = cell_slice(content, mask, start, end);
                build_split_side(
                    (segment_index == 0).then_some(data.line_number).flatten(),
                    if data.kind == IndexedLineKind::Context {
                        ' '
                    } else {
                        '-'
                    },
                    &segment,
                    Some(&segment_mask),
                    left_width,
                    if data.kind == IndexedLineKind::Del {
                        tokens.removed_surface
                    } else {
                        tokens.canvas
                    },
                    tokens.negative,
                    options,
                )
            } else {
                empty_split_side(left_width, tokens.canvas, options.palette)
            };
            spans.push(Span::styled(
                "│",
                Style::default().fg(tokens.rule_subtle).bg(tokens.canvas),
            ));
            if let (Some(data), Some((content, mask))) =
                (right_data.as_ref(), right_visible.as_ref())
            {
                let (segment, segment_mask) = cell_slice(content, mask, start, end);
                spans.extend(build_split_side(
                    (segment_index == 0).then_some(data.line_number).flatten(),
                    if data.kind == IndexedLineKind::Context {
                        ' '
                    } else {
                        '+'
                    },
                    &segment,
                    Some(&segment_mask),
                    right_width,
                    if data.kind == IndexedLineKind::Add {
                        tokens.added_surface
                    } else {
                        tokens.canvas
                    },
                    tokens.positive,
                    options,
                ));
            } else {
                spans.extend(empty_split_side(
                    right_width,
                    tokens.canvas,
                    options.palette,
                ));
            }
            Line::from(spans)
        })
        .collect()
}

struct SplitLineData {
    kind: IndexedLineKind,
    line_number: Option<u32>,
    content: String,
}

fn split_line_data(
    row: Option<&ViewRow>,
    old_side: bool,
    tab_size: u8,
    horizontal_offset: usize,
    visible_cells: usize,
) -> Option<SplitLineData> {
    let ViewRow::Line {
        kind,
        old_lineno,
        new_lineno,
        content,
        ..
    } = row?
    else {
        return None;
    };
    Some(SplitLineData {
        kind: *kind,
        line_number: if old_side { *old_lineno } else { *new_lineno },
        content: bounded_expand_slice(content, tab_size, horizontal_offset, visible_cells),
    })
}

fn visible_side(
    content: &str,
    mask: &[bool],
    horizontal_offset: usize,
    wrap: bool,
) -> (String, Vec<bool>) {
    let offset = if wrap { 0 } else { horizontal_offset };
    let mut column = 0;
    let mut visible = String::new();
    let mut visible_mask = Vec::new();
    for (index, character) in content.chars().enumerate() {
        let width = UnicodeWidthChar::width(character).unwrap_or(0);
        if column + width <= offset {
            column += width;
            continue;
        }
        visible.push(character);
        visible_mask.push(mask.get(index).copied().unwrap_or(false));
        column += width;
    }
    (visible, visible_mask)
}

fn cell_slice(value: &str, mask: &[bool], start: usize, end: usize) -> (String, Vec<bool>) {
    let mut column = 0;
    let mut text = String::new();
    let mut sliced_mask = Vec::new();
    for (index, character) in value.chars().enumerate() {
        let width = UnicodeWidthChar::width(character).unwrap_or(0);
        let next = column + width;
        if next > start && column < end {
            text.push(character);
            sliced_mask.push(mask.get(index).copied().unwrap_or(false));
        }
        column = next;
        if column >= end {
            break;
        }
    }
    (text, sliced_mask)
}

fn empty_split_side(width: usize, background: Color, palette: &Palette) -> Vec<Span<'static>> {
    let tokens = GridlineTokens::from(palette);
    vec![Span::styled(
        " ".repeat(width),
        Style::default().fg(tokens.gutter).bg(background),
    )]
}

fn build_split_diff_line(
    kind: IndexedLineKind,
    old_lineno: Option<u32>,
    new_lineno: Option<u32>,
    content: &str,
    width: u16,
    options: &RowRenderOptions<'_>,
) -> Line<'static> {
    let palette = options.palette;
    let tokens = GridlineTokens::from(palette);
    let left_width = width.saturating_sub(1) as usize / 2;
    let right_width = width.saturating_sub(1) as usize - left_width;
    let (left_background, right_background) = match kind {
        IndexedLineKind::Add => (tokens.canvas, tokens.added_surface),
        IndexedLineKind::Del => (tokens.removed_surface, tokens.canvas),
        IndexedLineKind::Context => (tokens.canvas, tokens.canvas),
    };
    let mut spans = build_split_side(
        old_lineno,
        '-',
        content,
        None,
        left_width,
        left_background,
        tokens.negative,
        options,
    );
    spans.push(Span::styled("│", Style::default().fg(tokens.rule_subtle)));
    spans.extend(build_split_side(
        new_lineno,
        '+',
        content,
        None,
        right_width,
        right_background,
        tokens.positive,
        options,
    ));
    Line::from(spans)
}

#[allow(clippy::too_many_arguments)]
fn build_split_side(
    line_number: Option<u32>,
    marker: char,
    content: &str,
    changed: Option<&[bool]>,
    width: usize,
    background: Color,
    semantic: Color,
    options: &RowRenderOptions<'_>,
) -> Vec<Span<'static>> {
    let palette = options.palette;
    let tokens = GridlineTokens::from(palette);
    let Some(line_number) = line_number else {
        return vec![Span::styled(
            " ".repeat(width),
            Style::default().fg(tokens.gutter).bg(background),
        )];
    };
    let prefix = if options.line_numbers {
        format!("{line_number:>6}  ")
    } else {
        format!("{marker} ")
    };
    let marker_color = match marker {
        '+' => tokens.positive,
        '-' => tokens.negative,
        _ => tokens.gutter,
    };
    let mut spans = vec![Span::styled(
        prefix,
        Style::default().fg(marker_color).bg(background),
    )];
    spans.extend(highlight_with_intraline(
        options.path,
        content,
        changed,
        options.theme,
        palette,
        background,
        semantic,
    ));
    clip_and_pad(
        spans,
        width,
        Style::default().fg(tokens.code).bg(background),
    )
}

fn highlight_with_intraline(
    path: &str,
    content: &str,
    changed: Option<&[bool]>,
    theme: ThemeName,
    palette: &Palette,
    background: Color,
    semantic: Color,
) -> Vec<Span<'static>> {
    let highlighted = highlight_line(path, content, theme, palette, background);
    let Some(mask) = changed.filter(|mask| !mask.is_empty()) else {
        return highlighted
            .iter()
            .map(|span| Span::styled(span.text.clone(), span.style.bg(background)))
            .collect();
    };
    let mut output = Vec::new();
    let mut cursor = 0usize;
    for styled in highlighted.iter() {
        let mut run = String::new();
        let mut run_changed = None;
        for character in styled.text.chars() {
            let is_changed = mask.get(cursor).copied().unwrap_or(false);
            cursor += 1;
            if run_changed.is_some_and(|current| current != is_changed) && !run.is_empty() {
                let changed = run_changed.unwrap_or(false);
                output.push(Span::styled(
                    std::mem::take(&mut run),
                    intraline_style(styled.style, changed, background, semantic),
                ));
            }
            run_changed = Some(is_changed);
            run.push(character);
        }
        if !run.is_empty() {
            output.push(Span::styled(
                run,
                intraline_style(
                    styled.style,
                    run_changed.unwrap_or(false),
                    background,
                    semantic,
                ),
            ));
        }
    }
    output
}

fn intraline_style(base: Style, changed: bool, background: Color, semantic: Color) -> Style {
    let style = base.bg(background);
    if changed {
        style
            .fg(semantic)
            .add_modifier(Modifier::BOLD | Modifier::UNDERLINED)
    } else {
        style
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TokenKind {
    Word,
    Space,
    Punctuation,
}

struct IntralineToken {
    text: String,
    start: usize,
    end: usize,
}

fn intraline_tokens(value: &str) -> Vec<IntralineToken> {
    let mut tokens = Vec::<IntralineToken>::new();
    let mut current_kind = None;
    for (index, character) in value.chars().enumerate() {
        let kind = if character.is_alphanumeric() || character == '_' {
            TokenKind::Word
        } else if character.is_whitespace() {
            TokenKind::Space
        } else {
            TokenKind::Punctuation
        };
        if current_kind != Some(kind) {
            tokens.push(IntralineToken {
                text: String::new(),
                start: index,
                end: index,
            });
            current_kind = Some(kind);
        }
        let token = tokens.last_mut().expect("token was just created");
        token.text.push(character);
        token.end = index + 1;
    }
    tokens
}

fn intraline_masks(old: &str, new: &str) -> Arc<IntralineMasks> {
    if let Some(masks) = INTRALINE_CACHE.with(|cache| cache.borrow().get(old, new)) {
        return masks;
    }
    let masks = Arc::new(compute_intraline_masks(old, new));
    INTRALINE_CACHE.with(|cache| cache.borrow_mut().insert(old, new, masks.clone()));
    masks
}

fn compute_intraline_masks(old: &str, new: &str) -> IntralineMasks {
    let old_chars = old.chars().count();
    let new_chars = new.chars().count();
    let old_tokens = intraline_tokens(old);
    let new_tokens = intraline_tokens(new);
    if old_tokens.len() > 256 || new_tokens.len() > 256 {
        return prefix_suffix_masks(old, new);
    }
    let columns = new_tokens.len() + 1;
    let mut lcs = vec![0u16; (old_tokens.len() + 1) * columns];
    for old_index in 0..old_tokens.len() {
        for new_index in 0..new_tokens.len() {
            let destination = (old_index + 1) * columns + new_index + 1;
            lcs[destination] = if old_tokens[old_index].text == new_tokens[new_index].text {
                lcs[old_index * columns + new_index].saturating_add(1)
            } else {
                lcs[old_index * columns + new_index + 1]
                    .max(lcs[(old_index + 1) * columns + new_index])
            };
        }
    }
    let mut old_mask = vec![true; old_chars];
    let mut new_mask = vec![true; new_chars];
    let mut old_index = old_tokens.len();
    let mut new_index = new_tokens.len();
    while old_index > 0 && new_index > 0 {
        if old_tokens[old_index - 1].text == new_tokens[new_index - 1].text {
            for changed in
                &mut old_mask[old_tokens[old_index - 1].start..old_tokens[old_index - 1].end]
            {
                *changed = false;
            }
            for changed in
                &mut new_mask[new_tokens[new_index - 1].start..new_tokens[new_index - 1].end]
            {
                *changed = false;
            }
            old_index -= 1;
            new_index -= 1;
        } else if lcs[(old_index - 1) * columns + new_index]
            >= lcs[old_index * columns + new_index - 1]
        {
            old_index -= 1;
        } else {
            new_index -= 1;
        }
    }
    IntralineMasks {
        old: old_mask,
        new: new_mask,
    }
}

fn prefix_suffix_masks(old: &str, new: &str) -> IntralineMasks {
    let old: Vec<char> = old.chars().collect();
    let new: Vec<char> = new.chars().collect();
    let prefix = old
        .iter()
        .zip(&new)
        .take_while(|(left, right)| left == right)
        .count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(left, right)| left == right)
        .count();
    let mut old_mask = vec![true; old.len()];
    let mut new_mask = vec![true; new.len()];
    old_mask[..prefix].fill(false);
    new_mask[..prefix].fill(false);
    if suffix > 0 {
        let old_len = old_mask.len();
        let new_len = new_mask.len();
        old_mask[old_len - suffix..].fill(false);
        new_mask[new_len - suffix..].fill(false);
    }
    IntralineMasks {
        old: old_mask,
        new: new_mask,
    }
}

fn clip_and_pad(
    spans: Vec<Span<'static>>,
    width: usize,
    padding_style: Style,
) -> Vec<Span<'static>> {
    let mut output = Vec::new();
    let mut remaining = width;
    for span in spans {
        if remaining == 0 {
            break;
        }
        let text = take_cells(&span.content, remaining);
        let used = cell_width(&text);
        if used > 0 {
            output.push(Span::styled(text, span.style));
            remaining -= used;
        }
    }
    if remaining > 0 {
        output.push(Span::styled(" ".repeat(remaining), padding_style));
    }
    output
}

/// Expand tabs while materializing only the requested terminal-cell window.
/// A pathological single line therefore costs O(horizontal offset + width),
/// never O(the invisible tail).
fn bounded_expand_slice(
    content: &str,
    tab_size: u8,
    horizontal_offset: usize,
    width: usize,
) -> String {
    let tab_size = tab_size.max(1) as usize;
    let end = horizontal_offset.saturating_add(width.max(1));
    let mut column = 0usize;
    let mut visible = String::with_capacity(width.min(content.len()));
    for character in content.chars() {
        if character == '\t' {
            let spaces = tab_size - column % tab_size;
            for _ in 0..spaces {
                if column >= horizontal_offset && column < end {
                    visible.push(' ');
                }
                column = column.saturating_add(1);
                if column >= end {
                    return visible;
                }
            }
            continue;
        }

        let character_width = UnicodeWidthChar::width(character).unwrap_or(0);
        let next = column.saturating_add(character_width);
        if character_width == 0 {
            if column >= horizontal_offset && column < end {
                visible.push(character);
            }
        } else if next > horizontal_offset && column < end {
            visible.push(character);
        }
        column = next;
        if column >= end {
            break;
        }
    }
    visible
}

/// Expand and wrap no more physical lines than the remaining viewport can
/// display. This deliberately stops reading the source string once full.
fn bounded_wrapped_segments(
    content: &str,
    tab_size: u8,
    width: usize,
    max_lines: usize,
) -> Vec<String> {
    let width = width.max(1);
    let max_lines = max_lines.max(1);
    let tab_size = tab_size.max(1) as usize;
    let mut segments = vec![String::new()];
    let mut line_width = 0usize;
    let mut expanded_column = 0usize;

    for character in content.chars() {
        let (expanded, repetitions) = if character == '\t' {
            (' ', tab_size - expanded_column % tab_size)
        } else {
            (character, 1)
        };
        for _ in 0..repetitions {
            let character_width = UnicodeWidthChar::width(expanded).unwrap_or(0);
            if character_width > 0
                && line_width > 0
                && line_width.saturating_add(character_width) > width
            {
                if segments.len() >= max_lines {
                    return segments;
                }
                segments.push(String::new());
                line_width = 0;
            }
            segments
                .last_mut()
                .expect("segments always contains one line")
                .push(expanded);
            line_width = line_width.saturating_add(character_width);
            expanded_column = expanded_column.saturating_add(character_width);
        }
    }
    segments
}

#[cfg(test)]
fn expand_tabs(content: &str, tab_size: u8) -> String {
    let tab_size = tab_size.max(1) as usize;
    let mut column = 0usize;
    let mut expanded = String::with_capacity(content.len());
    for character in content.chars() {
        if character == '\t' {
            let spaces = tab_size - column % tab_size;
            expanded.extend(std::iter::repeat(' ').take(spaces));
            column += spaces;
        } else {
            expanded.push(character);
            column += UnicodeWidthChar::width(character).unwrap_or(0);
        }
    }
    expanded
}

fn cell_width(value: &str) -> usize {
    value
        .chars()
        .map(|character| UnicodeWidthChar::width(character).unwrap_or(0))
        .sum()
}

fn take_cells(value: &str, width: usize) -> String {
    let mut used = 0;
    value
        .chars()
        .take_while(|character| {
            let next = used + UnicodeWidthChar::width(*character).unwrap_or(0);
            if next > width {
                false
            } else {
                used = next;
                true
            }
        })
        .collect()
}

#[cfg(test)]
fn skip_cells(value: &str, offset: usize) -> String {
    let mut used = 0;
    value
        .chars()
        .skip_while(|character| {
            if used >= offset {
                return false;
            }
            used += UnicodeWidthChar::width(*character).unwrap_or(0);
            true
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use diffing_core::index::build_index_from_reader;
    use std::io::Cursor;

    #[test]
    fn render_decodes_only_the_viewport() {
        let patch = b"diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -1,3 +1,3 @@\n one\n-two\n+three\n";
        let dir = tempfile::tempdir().unwrap();
        let spool = dir.path().join("patch");
        let index = build_index_from_reader(Cursor::new(patch), &spool, 1, |_| {}).unwrap();
        let mut buffer = Buffer::empty(Rect::new(0, 0, 80, 8));
        let mut cache = DiffRenderCache::default();
        render_card(
            &index,
            &mut cache,
            0,
            Rect::new(0, 0, 80, 8),
            0,
            2,
            None,
            None,
            0,
            false,
            false,
            true,
            4,
            crate::themes::ThemeName::GithubDark,
            &[],
            &[],
            0,
            &Palette::for_theme(crate::themes::ThemeName::GithubDark),
            &mut buffer,
        );
        let rendered: String = (0..8)
            .map(|y| (0..80).map(|x| buffer[(x, y)].symbol()).collect::<String>())
            .collect();
        assert!(rendered.contains("a.rs"));
        assert!(rendered.contains("two"));
        assert!(rendered.contains("three"));
    }

    #[test]
    fn adjacent_scrolls_reuse_the_overscanned_viewport() {
        let mut patch =
            String::from("diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -1,400 +1,400 @@\n");
        for line in 1..=400 {
            patch.push_str(&format!(" line {line}\n"));
        }
        let dir = tempfile::tempdir().unwrap();
        let spool = dir.path().join("patch");
        let index =
            build_index_from_reader(Cursor::new(patch.into_bytes()), &spool, 1, |_| {}).unwrap();
        let mut cache = DiffRenderCache::default();

        assert_eq!(cache.rows(&index, 0, 100, 20, 4_096).unwrap().len(), 20);
        assert_eq!(cache.fills, 1);
        assert_eq!(cache.rows(&index, 0, 110, 20, 4_096).unwrap().len(), 20);
        assert_eq!(cache.fills, 1, "nearby scroll should hit overscan");
        assert_eq!(cache.rows(&index, 0, 300, 20, 4_096).unwrap().len(), 20);
        assert_eq!(cache.fills, 2, "distant jump should refill once");
    }

    #[test]
    fn tab_expansion_respects_current_columns() {
        assert_eq!(expand_tabs("\tlet\tx", 4), "    let x");
        assert_eq!(expand_tabs("ab\tc", 4), "ab  c");
        assert_eq!(expand_tabs("界\tx", 4), "界  x");
    }

    #[test]
    fn visible_slices_stop_before_an_invisible_long_tail() {
        assert_eq!(bounded_expand_slice("ab\t界xyz", 4, 3, 4), " 界x");
        let huge = "x".repeat(2 * 1024 * 1024);
        let visible = bounded_expand_slice(&huge, 4, 1_000_000, 80);
        assert_eq!(visible.len(), 80);
        assert_eq!(cell_width(&visible), 80);
    }

    #[test]
    fn wrapping_materializes_only_remaining_physical_rows() {
        let huge = "x".repeat(2 * 1024 * 1024);
        let segments = bounded_wrapped_segments(&huge, 4, 80, 3);
        assert_eq!(segments.len(), 3);
        assert!(segments.iter().all(|segment| cell_width(segment) == 80));
        assert_eq!(segments.iter().map(String::len).sum::<usize>(), 240);
    }

    #[test]
    fn retained_frames_invalidate_only_for_render_inputs() {
        let patch = b"diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -1,3 +1,3 @@\n one\n-two\n+three\n";
        let dir = tempfile::tempdir().unwrap();
        let spool = dir.path().join("patch");
        let index = build_index_from_reader(Cursor::new(patch), &spool, 11, |_| {}).unwrap();
        let area = Rect::new(0, 0, 80, 8);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let mut buffer = Buffer::empty(area);
        let mut cache = DiffRenderCache::default();
        let paint = |index: &DiffIndex,
                     cache: &mut DiffRenderCache,
                     buffer: &mut Buffer,
                     cursor,
                     revision| {
            render_card(
                index,
                cache,
                0,
                area,
                0,
                cursor,
                None,
                None,
                0,
                false,
                false,
                true,
                4,
                crate::themes::ThemeName::GithubDark,
                &[],
                &[],
                revision,
                &palette,
                buffer,
            );
        };

        paint(&index, &mut cache, &mut buffer, 0, 0);
        paint(&index, &mut cache, &mut buffer, 1, 0);
        paint(&index, &mut cache, &mut buffer, 2, 0);
        let warmed_builds = cache.frame_builds;
        paint(&index, &mut cache, &mut buffer, 3, 0);
        assert_eq!(cache.frame_builds, warmed_builds, "cursor is an overlay");

        paint(&index, &mut cache, &mut buffer, 2, 1);
        assert_eq!(cache.frame_builds, warmed_builds + 1);

        let mut partial = index.clone();
        partial.patch_bytes += 1;
        paint(&partial, &mut cache, &mut buffer, 2, 1);
        assert_eq!(cache.frame_builds, warmed_builds + 2);
    }

    #[test]
    fn split_display_pairs_replaced_lines() {
        let rows = vec![
            ViewRow::Line {
                hunk_index: 0,
                kind: IndexedLineKind::Del,
                old_lineno: Some(3),
                new_lineno: None,
                content: "old name".to_string(),
            },
            ViewRow::Line {
                hunk_index: 0,
                kind: IndexedLineKind::Add,
                old_lineno: None,
                new_lineno: Some(3),
                content: "new name".to_string(),
            },
        ];
        let paired: Vec<_> = display_rows(&rows, 10, true).collect();
        assert_eq!(paired.len(), 1);
        assert!(matches!(
            paired[0],
            DisplayRow::Split {
                left: Some((10, _)),
                right: Some((11, _))
            }
        ));
    }

    #[test]
    fn intraline_masks_only_mark_changed_tokens() {
        let masks = intraline_masks("let old_name = 1;", "let new_name = 1;");
        let old = &masks.old;
        let new = &masks.new;
        assert!(old.iter().any(|changed| *changed));
        assert!(new.iter().any(|changed| *changed));
        assert!(!old[0]);
        assert!(!new[0]);
        assert!(!old[old.len() - 1]);
        assert!(!new[new.len() - 1]);
    }

    #[test]
    fn wide_characters_occupy_terminal_cells_without_shifting_following_text() {
        assert_eq!(cell_width("a界b"), 4);
        assert_eq!(take_cells("a界b", 3), "a界");
        assert_eq!(skip_cells("a界b", 1), "界b");

        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let area = Rect::new(0, 0, 4, 1);
        let mut buffer = Buffer::empty(area);
        render_line(
            Line::from(Span::raw("界x")),
            area,
            false,
            false,
            &palette,
            &mut buffer,
        );
        assert_eq!(buffer[(0, 0)].symbol(), "界");
        assert_eq!(buffer[(2, 0)].symbol(), "x");
    }

    #[test]
    fn split_rows_preserve_syntax_token_styles() {
        let theme = crate::themes::ThemeName::GithubDark;
        let palette = Palette::for_theme(theme);
        let options = RowRenderOptions {
            path: "src/main.rs",
            horizontal_offset: 0,
            wrap: false,
            split: true,
            line_numbers: true,
            tab_size: 4,
            theme,
            width: 100,
            max_lines: 1,
            palette: &palette,
        };
        let line = build_split_diff_line(
            IndexedLineKind::Context,
            Some(1),
            Some(1),
            "let value = Some(42);",
            100,
            &options,
        );
        let colors: std::collections::HashSet<_> =
            line.spans.iter().filter_map(|span| span.style.fg).collect();
        assert!(colors.len() > 2);
        assert_eq!(line.width(), 100);
    }

    #[test]
    fn split_typescript_rows_keep_keywords_and_strings() {
        let theme = crate::themes::ThemeName::from_label("rose-pine").unwrap();
        let palette = Palette::for_theme(theme);
        let options = RowRenderOptions {
            path: "src/cli.ts",
            horizontal_offset: 0,
            wrap: false,
            split: true,
            line_numbers: true,
            tab_size: 4,
            theme,
            width: 120,
            max_lines: 1,
            palette: &palette,
        };
        let line = build_split_diff_line(
            IndexedLineKind::Add,
            None,
            Some(12),
            "const result = await import('./module.js');",
            120,
            &options,
        );
        let colors: std::collections::HashSet<_> =
            line.spans.iter().filter_map(|span| span.style.fg).collect();
        assert!(colors.contains(&palette.syntax_keyword));
        assert!(colors.contains(&palette.syntax_string));
    }

    #[test]
    fn context_rows_use_the_theme_canvas_instead_of_terminal_reset() {
        let theme = crate::themes::ThemeName::GithubDark;
        let palette = Palette::for_theme(theme);
        let options = RowRenderOptions {
            path: "src/main.rs",
            horizontal_offset: 0,
            wrap: false,
            split: false,
            line_numbers: true,
            tab_size: 4,
            theme,
            width: 100,
            max_lines: 1,
            palette: &palette,
        };
        let line = build_diff_line(
            IndexedLineKind::Context,
            Some(1),
            Some(1),
            "let value = Some(42);",
            &options,
        );
        assert!(line
            .spans
            .iter()
            .all(|span| span.style.bg == Some(palette.bg)));
    }

    #[test]
    fn keyboard_active_and_mouse_hover_rows_render_identically() {
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let area = Rect::new(0, 0, 24, 1);
        let line = Line::from(vec![
            Span::styled(
                " + ",
                Style::default().fg(palette.added).bg(palette.added_bg),
            ),
            Span::styled(
                "changed",
                Style::default().fg(palette.code_fg).bg(palette.added_bg),
            ),
        ]);
        let mut active = Buffer::empty(area);
        let mut hovered = Buffer::empty(area);

        render_line(line.clone(), area, true, false, &palette, &mut active);
        render_line(line, area, false, true, &palette, &mut hovered);

        assert_eq!(active, hovered);
        for x in area.x..area.x + area.width {
            assert_eq!(active[(x, area.y)].bg, palette.selection_bg);
        }
    }

    #[test]
    fn diagnostic_marker_uses_working_tree_line_and_severity() {
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let row = ViewRow::Line {
            hunk_index: 0,
            kind: IndexedLineKind::Add,
            old_lineno: None,
            new_lineno: Some(7),
            content: "let value = missing;".to_string(),
        };
        let diagnostics = vec![LspDiagnostic {
            line: 6,
            start_character: 12,
            end_character: 19,
            severity: 1,
            message: "unknown value".to_string(),
            source: Some("test".to_string()),
        }];
        let decorations = DecorationIndex::new("src/main.rs", &[], &diagnostics);
        let markers = review_markers(&row, &decorations, &palette);
        assert_eq!(markers[0].content.as_ref(), " ");
        assert_eq!(markers[1].content.as_ref(), "E");
        assert_eq!(markers[1].style.fg, Some(palette.removed));
    }

    #[test]
    fn comment_marker_covers_every_line_of_inclusive_range_on_its_side() {
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let comment = ReviewComment {
            id: "range".to_string(),
            file_path: "src/main.rs".to_string(),
            side: CommentSide::Additions,
            line_number: 13,
            start_line_number: Some(11),
            line_content: "one\ntwo\nthree".to_string(),
            body: "range note".to_string(),
            status: CommentStatus::Open,
            created_at: 1,
            replies: Vec::new(),
            severity: Some(CommentSeverity::Blocking),
        };
        let comments = [comment];
        let decorations = DecorationIndex::new("src/main.rs", &comments, &[]);
        for line in 11..=13 {
            let row = ViewRow::Line {
                hunk_index: 0,
                kind: IndexedLineKind::Add,
                old_lineno: None,
                new_lineno: Some(line),
                content: "changed".to_string(),
            };
            let markers = review_markers(&row, &decorations, &palette);
            assert_eq!(markers[0].content.as_ref(), "!");
        }
        let deletion = ViewRow::Line {
            hunk_index: 0,
            kind: IndexedLineKind::Del,
            old_lineno: Some(12),
            new_lineno: None,
            content: "old".to_string(),
        };
        let markers = review_markers(&deletion, &decorations, &palette);
        assert_eq!(markers[0].content.as_ref(), " ");
    }
}
