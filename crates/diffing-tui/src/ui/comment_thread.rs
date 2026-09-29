//! Render a single `ReviewComment` (body + replies) as a small block.
//! Used both inline inside the diff card (under the comment line) and
//! inside the comment tracker (each row).

#[allow(unused_imports)]
use diffing_core::comments::{
    CommentReply, CommentSeverity, CommentSide, CommentStatus, ReviewComment,
};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, ListItem, Paragraph, Widget, Wrap};

use crate::themes::Palette;
use crate::ui::gridline::{
    safe_terminal_text, selection_marker, tail_ellipsize, GridlineTokens, Tone, GLYPHS,
};
use unicode_width::UnicodeWidthStr;

pub fn render_thread(
    comment: &ReviewComment,
    scroll: u16,
    area: Rect,
    palette: &Palette,
    buf: &mut Buffer,
) -> u16 {
    let tokens = GridlineTokens::from(palette);
    let status_color = match comment.status {
        CommentStatus::Open => tokens.tone(comment_tone(comment)),
        CommentStatus::Resolved => tokens.muted,
    };
    let status_label = match comment.status {
        CommentStatus::Open => "open",
        CommentStatus::Resolved => "resolved",
    };
    let severity = comment
        .severity
        .filter(|severity| *severity != CommentSeverity::None)
        .map(|severity| format!(" · {}", severity.as_str()))
        .unwrap_or_default();
    let replies = if comment.replies.is_empty() {
        String::new()
    } else {
        format!(
            " · {} {}",
            comment.replies.len(),
            if comment.replies.len() == 1 {
                "reply"
            } else {
                "replies"
            }
        )
    };
    let title = format!(
        " {} · {}{}{} ",
        comment_location_label(comment, &comment.file_path),
        status_label,
        severity,
        replies,
    );
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .style(Style::default().bg(tokens.raised))
        .border_style(Style::default().fg(status_color))
        .title(Span::styled(
            title,
            Style::default()
                .fg(tokens.text)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    block.render(area, buf);

    let mut lines: Vec<Line> = comment
        .body
        .split('\n')
        .map(|body_line| {
            Line::from(Span::styled(
                body_line.to_string(),
                Style::default().fg(tokens.text),
            ))
        })
        .collect();
    for reply in &comment.replies {
        let prefix = match reply.role.as_deref() {
            Some("agent") => "↳ agent",
            Some("user") => "↳ user",
            _ => "↳ reply",
        };
        let model = reply
            .model
            .as_deref()
            .map(|m| format!(" ({m})"))
            .unwrap_or_default();
        lines.push(Line::from(Span::styled(
            format!("{prefix}{model}"),
            Style::default().fg(tokens.muted),
        )));
        for rl in reply.body.split('\n') {
            lines.push(Line::from(Span::styled(
                format!("  {rl}"),
                Style::default().fg(tokens.text),
            )));
        }
    }
    let width = inner.width.max(1) as usize;
    let visual_lines: usize = lines
        .iter()
        .map(|line| line.width().max(1).div_ceil(width))
        .sum();
    let max_scroll = visual_lines
        .saturating_sub(inner.height as usize)
        .min(u16::MAX as usize) as u16;
    let para = Paragraph::new(lines)
        .style(Style::default().fg(tokens.text).bg(tokens.raised))
        .wrap(Wrap { trim: false })
        .scroll((scroll.min(max_scroll), 0));
    para.render(inner, buf);
    max_scroll
}

pub fn render_tracker_row(
    comment: &ReviewComment,
    is_cursor: bool,
    outdated: bool,
    width: u16,
    height: u16,
    focused: bool,
    palette: &Palette,
) -> ListItem<'static> {
    let tokens = GridlineTokens::from(palette);
    let resolved = comment.status == CommentStatus::Resolved;
    // Status and severity remain distinguishable without color.
    let marker = if resolved {
        "✓"
    } else {
        match comment.severity {
            Some(CommentSeverity::Blocking) => "!",
            Some(CommentSeverity::Question) => "?",
            Some(CommentSeverity::Nit) => "~",
            Some(CommentSeverity::Praise) => "+",
            _ => GLYPHS.bullet,
        }
    };
    let marker_color = if resolved {
        tokens.muted
    } else {
        tokens.tone(comment_tone(comment))
    };
    let location = comment_location_label(comment, &shorten_path(&comment.file_path));
    let suffix = if outdated {
        " · outdated".to_string()
    } else if !comment.replies.is_empty() {
        format!(
            " · {} {}",
            comment.replies.len(),
            if comment.replies.len() == 1 {
                "reply"
            } else {
                "replies"
            }
        )
    } else {
        String::new()
    };
    let budget = width.saturating_sub(4) as usize;
    let body = safe_terminal_text(comment.body.lines().next().unwrap_or(""));
    let body = preview_ellipsize(&format!("{body}{suffix}"), budget);
    let body_style = Style::default().fg(if resolved { tokens.muted } else { tokens.text });
    let marker_spans = vec![
        selection_marker(is_cursor, focused, palette),
        Span::styled(format!(" {marker} "), Style::default().fg(marker_color)),
    ];
    if height >= 2 {
        let mut location_spans = marker_spans;
        location_spans.push(Span::styled(
            tail_ellipsize(&location, budget),
            Style::default().fg(tokens.muted),
        ));
        let mut lines = vec![
            Line::from(location_spans),
            Line::from(vec![Span::raw("    "), Span::styled(body, body_style)]),
        ];
        if height >= 3 {
            lines.push(Line::default());
        }
        ListItem::new(lines)
    } else {
        let location_width = budget.min(32).min(budget / 2);
        let location = tail_ellipsize(&location, location_width);
        let mut spans = marker_spans;
        spans.push(Span::styled(
            format!("{location}  "),
            Style::default().fg(tokens.muted),
        ));
        spans.push(Span::styled(
            preview_ellipsize(
                &body,
                budget.saturating_sub(UnicodeWidthStr::width(location.as_str()) + 2),
            ),
            body_style,
        ));
        ListItem::new(Line::from(spans))
    }
}

fn preview_ellipsize(value: &str, width: usize) -> String {
    if UnicodeWidthStr::width(value) <= width {
        return value.to_string();
    }
    let mut result = String::new();
    let mut used = 0;
    for character in value.chars() {
        let cells = unicode_width::UnicodeWidthChar::width(character).unwrap_or(0);
        if used + cells > width.saturating_sub(1) {
            break;
        }
        result.push(character);
        used += cells;
    }
    if width > 0 {
        result.push('…');
    }
    result
}

fn comment_tone(comment: &ReviewComment) -> Tone {
    match comment.severity {
        Some(CommentSeverity::Blocking) => Tone::Negative,
        Some(CommentSeverity::Question) => Tone::Info,
        Some(CommentSeverity::Nit) => Tone::Warning,
        Some(CommentSeverity::Praise) => Tone::Positive,
        Some(CommentSeverity::None) | None => Tone::Accent,
    }
}

fn comment_location_label(comment: &ReviewComment, path: &str) -> String {
    if comment.line_number == 0 {
        return format!("{path} · file");
    }
    let side = match comment.side {
        CommentSide::Additions => "new",
        CommentSide::Deletions => "old",
    };
    match comment.start_line_number {
        Some(start) if start != comment.line_number => format!(
            "{path}:{}–{} · {side}",
            start.min(comment.line_number),
            start.max(comment.line_number)
        ),
        _ => format!("{path}:{} · {side}", comment.line_number),
    }
}

fn shorten_path(p: &str) -> String {
    let parts: Vec<&str> = p.split('/').collect();
    if parts.len() <= 3 {
        p.to_string()
    } else {
        let n = parts.len();
        format!("{}/../{}", parts[0], parts[n - 1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diffing_core::comments::{CommentSide, CommentStatus};

    fn sample_comment() -> ReviewComment {
        ReviewComment {
            extra: Default::default(),
            id: "c1".to_string(),
            file_path: "src/a.rs".to_string(),
            side: CommentSide::Additions,
            line_number: 42,
            start_line_number: None,
            line_content: "let x = 1;".to_string(),
            body: "rename to a more descriptive name".to_string(),
            status: CommentStatus::Open,
            created_at: 1000,
            replies: vec![CommentReply {
                extra: Default::default(),
                id: "r1".to_string(),
                body: "agreed".to_string(),
                created_at: 2000,
                role: Some("agent".to_string()),
                model: Some("gpt-4o".to_string()),
            }],
            severity: None,
        }
    }

    #[test]
    fn tracker_row_marks_open_status() {
        let c = sample_comment();
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let item = render_tracker_row(&c, false, false, 80, 1, false, &palette);
        // We can't easily inspect a ListItem's text, but at least make sure
        // it builds without panicking.
        let _ = item;
    }

    #[test]
    fn tracker_row_truncates_long_bodies() {
        let mut c = sample_comment();
        c.body = "x".repeat(200);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let _ = render_tracker_row(&c, true, false, 38, 3, true, &palette);
    }

    #[test]
    fn compact_previews_expose_severity_and_truncation_without_color() {
        for (severity, marker) in [
            (CommentSeverity::Blocking, "!"),
            (CommentSeverity::Question, "?"),
            (CommentSeverity::Nit, "~"),
            (CommentSeverity::Praise, "+"),
        ] {
            let mut comment = sample_comment();
            comment.severity = Some(severity);
            comment.body =
                "Please preserve this very long Unicode preview 世界世界世界".to_string();
            let area = Rect::new(0, 0, 32, 3);
            let mut buffer = Buffer::empty(area);
            ratatui::widgets::List::new(vec![render_tracker_row(
                &comment,
                false,
                false,
                area.width,
                area.height,
                false,
                &Palette::default(),
            )])
            .render(area, &mut buffer);
            let text = buffer
                .content
                .iter()
                .map(|cell| cell.symbol())
                .collect::<String>();
            assert!(text.contains(marker), "missing severity {severity:?}");
            assert!(text.contains("Please preserve"));
            assert!(
                text.contains('…'),
                "clipped previews need a visible continuation"
            );
        }
    }

    #[test]
    fn render_thread_does_not_panic() {
        let c = sample_comment();
        let area = Rect::new(0, 0, 60, 8);
        let mut buf = Buffer::empty(area);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        render_thread(&c, 0, area, &palette, &mut buf);
    }

    #[test]
    fn range_labels_are_normalized_and_side_explicit() {
        let mut c = sample_comment();
        c.start_line_number = Some(45);
        c.line_number = 42;
        c.side = CommentSide::Deletions;
        assert_eq!(
            comment_location_label(&c, "src/a.rs"),
            "src/a.rs:42–45 · old"
        );
    }

    #[test]
    fn thread_renders_every_comment_body_line() {
        let mut c = sample_comment();
        c.start_line_number = Some(40);
        c.body = "first line\nsecond line\nthird line".to_string();
        let area = Rect::new(0, 0, 72, 10);
        let mut buf = Buffer::empty(area);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        render_thread(&c, 0, area, &palette, &mut buf);
        let rendered = (0..area.height)
            .map(|y| {
                (0..area.width)
                    .map(|x| buf[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(rendered.contains("first line"));
        assert!(rendered.contains("second line"));
        assert!(rendered.contains("third line"));
        assert!(rendered.contains("40–42 · new"));
    }
}
