//! File diff card using ratatui's built-in widgets (Paragraph, List, Line).
//! Each diff hunk and each diff line is rendered as a `Paragraph` so we
//! get correct text shaping, ANSI styling, and diff-friendly frame updates
//! for free.

use diffing_core::diff::{FileDiff, Hunk, Line as DiffLine, LineKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Widget};

use crate::diff::highlight::{highlight_line, StyledSpan};
use crate::themes::Palette;

/// Total rendered-row count the card *would* produce for the given file.
/// Used by the scroll clamp in the main loop.
pub fn measure_card_rows(file: &FileDiff) -> usize {
    let mut rows = 0;
    rows += 1; // file header
    for h in &file.hunks {
        rows += 1; // hunk header
        rows += h.lines.len();
    }
    rows
}

pub fn render_card(
    file: &FileDiff,
    area: Rect,
    scroll: usize,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(palette.border));
    let inner = block.inner(area);
    block.render(area, buf);

    // Build the full list of rendered lines.
    let mut rows: Vec<Line<'static>> = Vec::new();
    rows.push(build_file_header(file, palette));
    for hunk in &file.hunks {
        rows.push(build_hunk_header(hunk, palette));
        for hl in &hunk.lines {
            rows.push(build_diff_line(file, hl, palette));
        }
    }
    let visible: Vec<ListItem> = rows
        .into_iter()
        .skip(scroll)
        .take(inner.height as usize)
        .map(ListItem::new)
        .collect();
    let list = List::new(visible);
    list.render(inner, buf);
}

fn build_file_header(file: &FileDiff, palette: &Palette) -> Line<'static> {
    let marker = match file.kind {
        diffing_core::diff::ChangeKind::Modified => 'M',
        diffing_core::diff::ChangeKind::Added => 'A',
        diffing_core::diff::ChangeKind::Deleted => 'D',
        diffing_core::diff::ChangeKind::Renamed => 'R',
        diffing_core::diff::ChangeKind::Untracked => 'U',
        diffing_core::diff::ChangeKind::Binary => 'B',
    };
    let path = file.display_path().to_string_lossy().to_string();
    let path_style = Style::default().fg(palette.fg).add_modifier(Modifier::BOLD);
    let mut spans: Vec<Span<'static>> = vec![
        Span::styled(" ".to_string(), Style::default()),
        Span::styled(
            format!(" {} ", marker),
            Style::default().bg(palette.border).fg(palette.fg),
        ),
        Span::styled("  ".to_string(), Style::default()),
        Span::styled(path, path_style),
    ];
    if file.is_binary {
        spans.push(Span::styled(
            "  (binary file; no diff)".to_string(),
            Style::default().fg(palette.comment),
        ));
    }
    if let (Some(old), Some(new)) = (&file.old_path, &file.new_path) {
        if old != new {
            spans.push(Span::styled(
                format!("  ({} → {})", old.display(), new.display()),
                Style::default().fg(palette.comment),
            ));
        }
    }
    Line::from(spans)
}

fn build_hunk_header(hunk: &Hunk, palette: &Palette) -> Line<'static> {
    Line::from(Span::styled(
        format!(
            "@@ -{},{} +{},{} @@{}",
            hunk.old_start,
            hunk.old_lines,
            hunk.new_start,
            hunk.new_lines,
            if hunk.heading.is_empty() {
                String::new()
            } else {
                format!(" {}", hunk.heading)
            }
        ),
        Style::default().fg(palette.accent),
    ))
}

fn build_diff_line(file: &FileDiff, line: &DiffLine, palette: &Palette) -> Line<'static> {
    let path = file.display_path().to_string_lossy();
    let (marker, line_style, bg) = match line.kind {
        LineKind::Add => ('+', Style::default().fg(palette.added), Some(palette.added_bg)),
        LineKind::Del => ('-', Style::default().fg(palette.removed), Some(palette.removed_bg)),
        LineKind::Context => (' ', Style::default().fg(palette.fg), None),
    };
    let bg_color: Option<Color> = bg;

    let mut spans: Vec<Span<'static>> = Vec::new();
    let old = line.old_lineno.map(|n| format!("{:>3}", n)).unwrap_or_else(|| "   ".to_string());
    let new = line.new_lineno.map(|n| format!("{:>3}", n)).unwrap_or_else(|| "   ".to_string());
    let with_bg = |s: Style| s.bg(bg_color.unwrap_or(Color::Reset));
    spans.push(Span::styled(
        format!(" {} {} ", old, new),
        with_bg(Style::default().fg(palette.gutter)),
    ));
    spans.push(Span::styled(" ".to_string(), with_bg(Style::default())));
    spans.push(Span::styled(
        marker.to_string(),
        with_bg(line_style.add_modifier(Modifier::BOLD)),
    ));
    spans.push(Span::styled(" ".to_string(), with_bg(Style::default())));

    let content_spans: Vec<StyledSpan> = highlight_line(&path, &line.content);
    if content_spans.is_empty() {
        spans.push(Span::styled(
            " ".to_string(),
            with_bg(Style::default().fg(palette.fg)),
        ));
    } else {
        for cs in content_spans {
            let mut s = cs.style;
            if let Some(b) = bg_color {
                s = s.bg(b);
            }
            if matches!(line.kind, LineKind::Add | LineKind::Del) && s.fg.is_none() {
                s = s.fg(line_style.fg.unwrap_or(palette.fg));
            }
            spans.push(Span::styled(cs.text, s));
        }
    }
    Line::from(spans)
}
