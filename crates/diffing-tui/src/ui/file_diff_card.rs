//! Virtual diff viewport.
//!
//! Only rows intersecting the terminal viewport are decoded and highlighted.
//! The complete file is never converted to ratatui widgets or owned strings.

use diffing_core::comments::{CommentSeverity, CommentSide, CommentStatus, ReviewComment};
use diffing_core::index::{
    DiffIndex, IndexedChangeKind, IndexedLineKind, ViewRow, DEFAULT_VIEWPORT_MAX_BYTES,
};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

use crate::diff::highlight::{highlight_line, StyledSpan};
use crate::lsp::LspDiagnostic;
use crate::themes::{Palette, ThemeName};

#[allow(clippy::too_many_arguments)]
pub fn render_card(
    index: &DiffIndex,
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
    palette: &Palette,
    buf: &mut Buffer,
) {
    let inner = area;
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
        let selected = logical_row == cursor_row
            || selection.is_some_and(|(start, end)| logical_row >= start && logical_row <= end);
        let hovered = hovered_row == Some(logical_row);
        let mut lines = build_row_lines(
            row,
            RowRenderOptions {
                path: &path,
                horizontal_offset,
                wrap,
                split,
                line_numbers,
                tab_size,
                theme,
                width: inner.width.saturating_sub(2),
                palette,
            },
        );
        let markers = review_markers(row, &path, comments, diagnostics, palette);
        for (wrapped_index, line) in lines.iter_mut().enumerate() {
            let markers = if wrapped_index == 0 {
                markers.clone()
            } else {
                vec![Span::raw(" "), Span::raw(" ")]
            };
            line.spans.splice(0..0, markers);
        }
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

fn review_markers(
    row: &ViewRow,
    path: &str,
    comments: &[ReviewComment],
    diagnostics: &[LspDiagnostic],
    palette: &Palette,
) -> Vec<Span<'static>> {
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
    let comment = line.and_then(|line| {
        comments
            .iter()
            .filter(|comment| {
                let start = comment
                    .start_line_number
                    .unwrap_or(comment.line_number)
                    .min(comment.line_number);
                let end = comment
                    .start_line_number
                    .unwrap_or(comment.line_number)
                    .max(comment.line_number);
                comment.file_path == path
                    && comment.side == side
                    && comment.line_number > 0
                    && line >= start
                    && line <= end
            })
            .max_by_key(|comment| match (comment.status, comment.severity) {
                (CommentStatus::Open, Some(CommentSeverity::Blocking)) => 6,
                (CommentStatus::Open, Some(CommentSeverity::Question)) => 5,
                (CommentStatus::Open, None | Some(CommentSeverity::None)) => 4,
                (CommentStatus::Open, Some(CommentSeverity::Nit)) => 3,
                (CommentStatus::Open, Some(CommentSeverity::Praise)) => 2,
                (CommentStatus::Resolved, _) => 1,
            })
    });
    let (comment_symbol, comment_color) = match comment {
        Some(comment) if comment.status == CommentStatus::Resolved => ("✓", palette.dim),
        Some(comment) => match comment.severity {
            Some(CommentSeverity::Blocking) => ("!", palette.removed),
            Some(CommentSeverity::Question) => ("?", palette.comment),
            Some(CommentSeverity::Nit) => ("·", palette.accent),
            Some(CommentSeverity::Praise) => ("♥", palette.added),
            _ => ("●", palette.accent),
        },
        None => (" ", palette.dim),
    };
    let diagnostic = if *kind == IndexedLineKind::Del {
        None
    } else {
        new_lineno
            .and_then(|line| line.checked_sub(1))
            .and_then(|line| {
                diagnostics
                    .iter()
                    .filter(|item| item.line == line)
                    .min_by_key(|item| item.severity)
            })
    };
    let (diagnostic_symbol, diagnostic_color) =
        diagnostic.map_or((" ".to_string(), palette.dim), |item| {
            let color = match item.severity {
                1 => palette.removed,
                2 => palette.comment,
                3 => palette.accent,
                _ => palette.dim,
            };
            (item.marker().to_string(), color)
        });
    let background = match kind {
        IndexedLineKind::Add => palette.added_bg,
        IndexedLineKind::Del => palette.removed_bg,
        IndexedLineKind::Context => palette.bg,
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
            let expanded = expand_tabs(content, tab_size);
            let visible: String = expanded.chars().skip(horizontal_offset).collect();
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
                        &options,
                    )
                })
                .collect();
        }
        if wrap {
            let content_width = width
                .saturating_sub(if line_numbers { 18 } else { 5 })
                .max(1) as usize;
            let expanded = expand_tabs(content, tab_size);
            let chars: Vec<char> = expanded.chars().collect();
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
            Style::default().fg(palette.accent),
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
    let mut x = area.x;
    for span in line.spans {
        if x >= area.x + area.width {
            break;
        }
        let style = if hovered && !selected {
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
    let gutter_width = area.width.min(18);
    if selected {
        for gutter_x in area.x..area.x.saturating_add(gutter_width) {
            buf[(gutter_x, area.y)].set_bg(palette.selection_bg);
        }
    } else if hovered {
        for gutter_x in area.x..area.x.saturating_add(gutter_width) {
            buf[(gutter_x, area.y)].set_bg(palette.elevated);
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
            with_background(Style::default().fg(palette.gutter)),
        ));
    }
    spans.push(Span::styled(
        format!(" {marker} "),
        with_background(line_style.add_modifier(Modifier::BOLD)),
    ));
    let expanded = expand_tabs(content, tab_size);
    let visible_content: String = expanded.chars().skip(horizontal_offset).collect();
    let highlight_background = if background == Color::Reset {
        palette.bg
    } else {
        background
    };
    let highlighted: Vec<StyledSpan> =
        highlight_line(path, &visible_content, theme, palette, highlight_background);
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
    options: &RowRenderOptions<'_>,
) -> Line<'static> {
    let palette = options.palette;
    let left_width = width.saturating_sub(1) as usize / 2;
    let right_width = width.saturating_sub(1) as usize - left_width;
    let (left_background, right_background) = match kind {
        IndexedLineKind::Add => (palette.bg, palette.added_bg),
        IndexedLineKind::Del => (palette.removed_bg, palette.bg),
        IndexedLineKind::Context => (palette.bg, palette.bg),
    };
    let mut spans = build_split_side(
        old_lineno,
        '-',
        content,
        left_width,
        left_background,
        options,
    );
    spans.push(Span::styled("│", Style::default().fg(palette.border)));
    spans.extend(build_split_side(
        new_lineno,
        '+',
        content,
        right_width,
        right_background,
        options,
    ));
    Line::from(spans)
}

fn build_split_side(
    line_number: Option<u32>,
    marker: char,
    content: &str,
    width: usize,
    background: Color,
    options: &RowRenderOptions<'_>,
) -> Vec<Span<'static>> {
    let palette = options.palette;
    let Some(line_number) = line_number else {
        return vec![Span::styled(
            " ".repeat(width),
            Style::default().fg(palette.gutter).bg(background),
        )];
    };
    let prefix = if options.line_numbers {
        format!("{line_number:>6}  ")
    } else {
        format!("{marker} ")
    };
    let marker_color = match marker {
        '+' => palette.added,
        '-' => palette.removed,
        _ => palette.gutter,
    };
    let mut spans = vec![Span::styled(
        prefix,
        Style::default().fg(marker_color).bg(background),
    )];
    spans.extend(
        highlight_line(options.path, content, options.theme, palette, background)
            .into_iter()
            .map(|span| Span::styled(span.text, span.style.bg(background))),
    );
    clip_and_pad(spans, width, Style::default().fg(palette.fg).bg(background))
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
        let text: String = span.content.chars().take(remaining).collect();
        let used = text.chars().count();
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
            column += 1;
        }
    }
    expanded
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
            None,
            0,
            false,
            false,
            true,
            4,
            crate::themes::ThemeName::GithubDark,
            &[],
            &[],
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
    fn tab_expansion_respects_current_columns() {
        assert_eq!(expand_tabs("\tlet\tx", 4), "    let x");
        assert_eq!(expand_tabs("ab\tc", 4), "ab  c");
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
        let markers = review_markers(&row, "src/main.rs", &[], &diagnostics, &palette);
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
        for line in 11..=13 {
            let row = ViewRow::Line {
                hunk_index: 0,
                kind: IndexedLineKind::Add,
                old_lineno: None,
                new_lineno: Some(line),
                content: "changed".to_string(),
            };
            let markers = review_markers(
                &row,
                "src/main.rs",
                std::slice::from_ref(&comment),
                &[],
                &palette,
            );
            assert_eq!(markers[0].content.as_ref(), "!");
        }
        let deletion = ViewRow::Line {
            hunk_index: 0,
            kind: IndexedLineKind::Del,
            old_lineno: Some(12),
            new_lineno: None,
            content: "old".to_string(),
        };
        let markers = review_markers(&deletion, "src/main.rs", &[comment], &[], &palette);
        assert_eq!(markers[0].content.as_ref(), " ");
    }
}
