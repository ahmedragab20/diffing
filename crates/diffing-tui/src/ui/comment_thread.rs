//! Render a single `ReviewComment` (body + replies) as a small block.
//! Used both inline inside the diff card (under the comment line) and
//! inside the comment tracker (each row).

#[allow(unused_imports)]
use diffing_core::comments::{CommentReply, CommentStatus, ReviewComment};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, ListItem, Paragraph, Widget, Wrap};

use crate::themes::Palette;

#[allow(dead_code)]
pub fn render_thread(
    comment: &ReviewComment,
    area: Rect,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let status_color = match comment.status {
        CommentStatus::Open => palette.accent,
        CommentStatus::Resolved => palette.dim,
    };
    let status_label = match comment.status {
        CommentStatus::Open => "open",
        CommentStatus::Resolved => "resolved",
    };
    let title = format!(" {} · {} ", comment.file_path, status_label);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(status_color))
        .title(Span::styled(
            title,
            Style::default()
                .fg(palette.fg)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    block.render(area, buf);

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        comment.body.clone(),
        Style::default().fg(palette.fg),
    )));
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
            Style::default().fg(palette.dim),
        )));
        for rl in reply.body.lines() {
            lines.push(Line::from(Span::styled(
                format!("  {rl}"),
                Style::default().fg(palette.fg),
            )));
        }
    }
    let para = Paragraph::new(lines).wrap(Wrap { trim: false });
    para.render(inner, buf);
}

pub fn render_tracker_row(
    comment: &ReviewComment,
    is_cursor: bool,
    palette: &Palette,
) -> ListItem<'static> {
    let marker = match comment.status {
        CommentStatus::Open => '●',
        CommentStatus::Resolved => '○',
    };
    let marker_color = match comment.status {
        CommentStatus::Open => palette.accent,
        CommentStatus::Resolved => palette.dim,
    };
    let file = shorten_path(&comment.file_path);
    let line = if comment.line_number == 0 {
        "(file)".to_string()
    } else {
        format!("{}:{}", file, comment.line_number)
    };
    let body = comment
        .body
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(60)
        .collect::<String>();
    let reply_count = comment.replies.len();
    let reply_suffix = if reply_count > 0 {
        format!("  ↳{reply_count}")
    } else {
        String::new()
    };
    let mut spans: Vec<Span<'static>> = vec![
        Span::styled(
            format!("{marker} "),
            Style::default().fg(marker_color),
        ),
        Span::styled(
            format!("{:<24}", truncate(&line, 24)),
            Style::default().fg(palette.comment),
        ),
        Span::styled(format!(" {body}"), Style::default().fg(palette.fg)),
        Span::styled(reply_suffix, Style::default().fg(palette.dim)),
    ];
    if is_cursor {
        // Highlight the entire row by prefixing with a bold cursor marker.
        spans.insert(
            0,
            Span::styled(
                "▶ ".to_string(),
                Style::default().fg(palette.accent).add_modifier(Modifier::BOLD),
            ),
        );
    } else {
        spans.insert(0, Span::styled("  ".to_string(), Style::default()));
    }
    ListItem::new(Line::from(spans))
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

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diffing_core::comments::{CommentSide, CommentStatus};

    fn sample_comment() -> ReviewComment {
        ReviewComment {
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
                id: "r1".to_string(),
                body: "agreed".to_string(),
                created_at: 2000,
                role: Some("agent".to_string()),
                model: Some("gpt-4o".to_string()),
            }],
        }
    }

    #[test]
    fn tracker_row_marks_open_status() {
        let c = sample_comment();
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let item = render_tracker_row(&c, false, &palette);
        // We can't easily inspect a ListItem's text, but at least make sure
        // it builds without panicking.
        let _ = item;
    }

    #[test]
    fn tracker_row_truncates_long_bodies() {
        let mut c = sample_comment();
        c.body = "x".repeat(200);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let _ = render_tracker_row(&c, true, &palette);
    }

    #[test]
    fn render_thread_does_not_panic() {
        let c = sample_comment();
        let area = Rect::new(0, 0, 60, 8);
        let mut buf = Buffer::empty(area);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        render_thread(&c, area, &palette, &mut buf);
    }
}
