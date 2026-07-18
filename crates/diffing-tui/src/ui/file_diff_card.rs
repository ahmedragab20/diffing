//! Virtual diff viewport.
//!
//! Only rows intersecting the terminal viewport are decoded and highlighted.
//! The complete file is never converted to ratatui widgets or owned strings.

use diffing_core::index::{
    DiffIndex, IndexedChangeKind, IndexedLineKind, ViewRow, DEFAULT_VIEWPORT_MAX_BYTES,
};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Widget};

use crate::diff::highlight::{highlight_line, StyledSpan};
use crate::themes::Palette;

#[allow(clippy::too_many_arguments)]
pub fn render_card(
    index: &DiffIndex,
    file_index: usize,
    area: Rect,
    scroll: u64,
    cursor_row: u64,
    hovered_row: Option<u64>,
    horizontal_offset: usize,
    wrap: bool,
    split: bool,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(palette.border));
    let inner = block.inner(area);
    block.render(area, buf);
    let Ok(viewport) = index.viewport(
        file_index,
        scroll,
        inner.height as usize,
        DEFAULT_VIEWPORT_MAX_BYTES,
    ) else {
        return;
    };
    let path = index
        .files
        .get(file_index)
        .map(|file| file.display_path().to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut y = inner.y;
    for (visible_index, row) in viewport.rows.iter().enumerate() {
        let logical_row = scroll + visible_index as u64;
        let selected = logical_row == cursor_row;
        let hovered = hovered_row == Some(logical_row);
        let lines = build_row_lines(
            row,
            &path,
            horizontal_offset,
            wrap,
            split,
            inner.width,
            palette,
        );
        for line in lines {
            if y >= inner.y + inner.height {
                return;
            }
            render_line(
                line,
                Rect::new(inner.x, y, inner.width, 1),
                selected,
                hovered,
                palette,
                buf,
            );
            y += 1;
        }
    }
}

fn build_row_lines(
    row: &ViewRow,
    path: &str,
    horizontal_offset: usize,
    wrap: bool,
    split: bool,
    width: u16,
    palette: &Palette,
) -> Vec<Line<'static>> {
    if let ViewRow::Line {
        kind,
        old_lineno,
        new_lineno,
        content,
        ..
    } = row
    {
        if split {
            let content_width = (width.saturating_sub(3) / 2).saturating_sub(10).max(1) as usize;
            let visible: String = content.chars().skip(horizontal_offset).collect();
            let chars: Vec<char> = visible.chars().collect();
            let segments: Vec<String> = if wrap && !chars.is_empty() {
                chars
                    .chunks(content_width)
                    .map(|chunk| chunk.iter().collect())
                    .collect()
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
                        palette,
                    )
                })
                .collect();
        }
        if wrap {
            let content_width = width.saturating_sub(18).max(1) as usize;
            let chars: Vec<char> = content.chars().collect();
            let segments: Vec<String> = if chars.is_empty() {
                vec![String::new()]
            } else {
                chars
                    .chunks(content_width)
                    .map(|chunk| chunk.iter().collect())
                    .collect()
            };
            return segments
                .into_iter()
                .enumerate()
                .map(|(index, segment)| {
                    build_diff_line(
                        path,
                        *kind,
                        (index == 0).then_some(*old_lineno).flatten(),
                        (index == 0).then_some(*new_lineno).flatten(),
                        &segment,
                        0,
                        palette,
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
            Style::default().fg(palette.accent),
        )),
        ViewRow::Line {
            kind,
            old_lineno,
            new_lineno,
            content,
            ..
        } => build_diff_line(
            path,
            *kind,
            *old_lineno,
            *new_lineno,
            content,
            horizontal_offset,
            palette,
        ),
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
    let mut x = area.x;
    for span in line.spans {
        if x >= area.x + area.width {
            break;
        }
        let style = if selected {
            span.style.bg(palette.selection_bg)
        } else if hovered {
            span.style.bg(palette.elevated)
        } else {
            span.style
        };
        for symbol in span.content.chars() {
            if x >= area.x + area.width {
                break;
            }
            buf[(x, area.y)].set_char(symbol).set_style(style);
            x += 1;
        }
    }
    if selected || hovered {
        while x < area.x + area.width {
            buf[(x, area.y)]
                .set_symbol(" ")
                .set_style(Style::default().bg(if selected {
                    palette.selection_bg
                } else {
                    palette.elevated
                }));
            x += 1;
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
    let mut spans = vec![
        Span::raw(" "),
        Span::styled(
            format!(" {marker} "),
            Style::default().bg(palette.border).fg(palette.fg),
        ),
        Span::raw("  "),
        Span::styled(
            path.to_string(),
            Style::default().fg(palette.fg).add_modifier(Modifier::BOLD),
        ),
    ];
    if binary {
        spans.push(Span::styled(
            "  (binary file; no textual diff)",
            Style::default().fg(palette.comment),
        ));
    }
    Line::from(spans)
}

fn build_diff_line(
    path: &str,
    kind: IndexedLineKind,
    old_lineno: Option<u32>,
    new_lineno: Option<u32>,
    content: &str,
    horizontal_offset: usize,
    palette: &Palette,
) -> Line<'static> {
    let (marker, line_style, background) = match kind {
        IndexedLineKind::Add => (
            '+',
            Style::default().fg(palette.added),
            Some(palette.added_bg),
        ),
        IndexedLineKind::Del => (
            '-',
            Style::default().fg(palette.removed),
            Some(palette.removed_bg),
        ),
        IndexedLineKind::Context => (' ', Style::default().fg(palette.fg), None),
    };
    let background = background.unwrap_or(Color::Reset);
    let with_background = |style: Style| style.bg(background);
    let old = old_lineno
        .map(|line| format!("{line:>6}"))
        .unwrap_or_else(|| "      ".to_string());
    let new = new_lineno
        .map(|line| format!("{line:>6}"))
        .unwrap_or_else(|| "      ".to_string());
    let mut spans = vec![
        Span::styled(
            format!(" {old} {new} "),
            with_background(Style::default().fg(palette.gutter)),
        ),
        Span::styled(
            format!(" {marker} "),
            with_background(line_style.add_modifier(Modifier::BOLD)),
        ),
    ];
    let visible_content: String = content.chars().skip(horizontal_offset).collect();
    let highlighted: Vec<StyledSpan> = highlight_line(path, &visible_content);
    if highlighted.is_empty() {
        spans.push(Span::styled(
            " ",
            with_background(Style::default().fg(palette.fg)),
        ));
    } else {
        spans.extend(
            highlighted
                .into_iter()
                .map(|styled| Span::styled(styled.text, styled.style.bg(background))),
        );
    }
    Line::from(spans)
}

fn build_split_diff_line(
    kind: IndexedLineKind,
    old_lineno: Option<u32>,
    new_lineno: Option<u32>,
    content: &str,
    width: u16,
    palette: &Palette,
) -> Line<'static> {
    let left_width = width.saturating_sub(1) as usize / 2;
    let right_width = width.saturating_sub(1) as usize - left_width;
    let old = old_lineno
        .map(|line| format!("{line:>6}  {content}"))
        .unwrap_or_default();
    let new = new_lineno
        .map(|line| format!("{line:>6}  {content}"))
        .unwrap_or_default();
    let (left_style, right_style) = match kind {
        IndexedLineKind::Add => (
            Style::default().fg(palette.gutter),
            Style::default().fg(palette.added).bg(palette.added_bg),
        ),
        IndexedLineKind::Del => (
            Style::default().fg(palette.removed).bg(palette.removed_bg),
            Style::default().fg(palette.gutter),
        ),
        IndexedLineKind::Context => (
            Style::default().fg(palette.fg),
            Style::default().fg(palette.fg),
        ),
    };
    Line::from(vec![
        Span::styled(fit_cell(&old, left_width), left_style),
        Span::styled("│", Style::default().fg(palette.border)),
        Span::styled(fit_cell(&new, right_width), right_style),
    ])
}

fn fit_cell(value: &str, width: usize) -> String {
    let mut cell: String = value.chars().take(width).collect();
    let padding = width.saturating_sub(cell.chars().count());
    cell.extend(std::iter::repeat(' ').take(padding));
    cell
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
        render_card(
            &index,
            0,
            Rect::new(0, 0, 80, 8),
            0,
            2,
            None,
            0,
            false,
            false,
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
}
