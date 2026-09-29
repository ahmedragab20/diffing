//! Keyboard-first review handoff: intent, comments, note, and agent availability.
use std::path::PathBuf;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::Span;
use ratatui::widgets::{Block, Borders, Clear, Widget};
use tui_textarea::TextArea;

use crate::agent_api::AgentSnapshot;
use crate::handoff::format::format_comments;
use crate::handoff::review::ReviewDecision;
use crate::themes::Palette;
use crate::ui::gridline::safe_terminal_text;
use crate::ui::gridline::{dim_buffer, field_block, fill, overlay_block, GridlineTokens};
use diffing_core::comments::{CommentStatus, ReviewComment};
use diffing_core::diff::FileDiff;

#[derive(Debug, Clone)]
pub struct SendReviewRegions {
    pub popup: Rect,
    pub verdict_rows: Vec<(Rect, ReviewDecision)>,
    pub verdict: Rect,
    connection: Rect,
    summary: Rect,
    description: Rect,
    pub comments: Rect,
    general_panel: Rect,
    pub general: Rect,
    notice: Rect,
    footer: Rect,
    pub send_button: Rect,
    pub cancel_button: Rect,
    pub copy_button: Rect,
}

/// Rendering and pointer input share these rectangles, including tiny terminals.
pub fn send_review_regions(area: Rect) -> SendReviewRegions {
    let width = area.width.saturating_sub(4).max(area.width.min(8)).min(78);
    let height = area
        .height
        .saturating_sub(2)
        .max(area.height.min(8))
        .min(22);
    let popup = Rect::new(
        area.x + (area.width - width) / 2,
        area.y + (area.height - height) / 2,
        width,
        height,
    );
    let inner = Block::default().borders(Borders::ALL).inner(popup);
    let mut remaining = inner;
    let mut take = |height: u16| {
        let row = Rect::new(
            remaining.x,
            remaining.y,
            remaining.width,
            height.min(remaining.height),
        );
        remaining.y += row.height;
        remaining.height -= row.height;
        row
    };
    let connection = take(u16::from(inner.height >= 10));
    let summary = take(u16::from(inner.height >= 8));
    let verdict = take(if inner.height >= 16 { 4 } else { 1 });
    let description = take(u16::from(inner.height >= 14));
    let comments = take(if inner.height >= 20 { 5 } else { 0 });
    let notice_height = u16::from(inner.height >= 6);
    let fixed = connection.height
        + summary.height
        + verdict.height
        + description.height
        + comments.height
        + notice_height
        + 1;
    let general_panel = take(inner.height.saturating_sub(fixed));
    let notice = take(notice_height);
    let footer = take(1);
    let verdict_rows = if verdict.height == 4 {
        ReviewDecision::ALL
            .iter()
            .enumerate()
            .map(|(i, decision)| {
                (
                    Rect::new(verdict.x, verdict.y + i as u16, verdict.width, 1),
                    *decision,
                )
            })
            .collect()
    } else {
        Vec::new()
    };
    let cancel_width = footer.width.min(10);
    let send_width = footer.width.saturating_sub(cancel_width).min(12);
    let copy_width = footer
        .width
        .saturating_sub(cancel_width + send_width)
        .min(12);
    let cancel_button = Rect::new(
        footer.right() - cancel_width,
        footer.y,
        cancel_width,
        footer.height,
    );
    let send_button = Rect::new(
        cancel_button.x - send_width,
        footer.y,
        send_width,
        footer.height,
    );
    let copy_button = Rect::new(
        send_button.x - copy_width,
        footer.y,
        copy_width,
        footer.height,
    );
    SendReviewRegions {
        popup,
        verdict_rows,
        verdict,
        connection,
        summary,
        description,
        comments,
        general: Block::default().borders(Borders::ALL).inner(general_panel),
        general_panel,
        notice,
        footer,
        send_button,
        cancel_button,
        copy_button,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendField {
    Verdict,
    Comments,
    General,
}

pub struct SendReviewState {
    pub verdict: ReviewDecision,
    pub general: TextArea<'static>,
    pub focused: SendField,
    pub unviewed_files: usize,
    pub guard_acknowledged: bool,
    pub general_char_count: usize,
    pub comment_cursor: usize,
    pub feedback: Option<String>,
}

impl SendReviewState {
    pub fn new(unviewed_files: usize) -> Self {
        let mut general = TextArea::new(vec![String::new()]);
        general.set_placeholder_text("Optional note for the agent…");
        Self {
            verdict: ReviewDecision::ChangesRequested,
            general,
            focused: SendField::Verdict,
            unviewed_files,
            guard_acknowledged: false,
            general_char_count: 0,
            comment_cursor: 0,
            feedback: None,
        }
    }
    pub fn cycle_verdict(&mut self, delta: isize) {
        let index = (self.verdict as isize + delta).rem_euclid(ReviewDecision::ALL.len() as isize);
        self.verdict = ReviewDecision::ALL[index as usize];
        self.guard_acknowledged = false;
        self.feedback = None;
    }
    pub fn body(&self) -> String {
        self.general.lines().join("\n")
    }
}

pub fn agent_connection_label(agent: &AgentSnapshot) -> String {
    if agent.waiters > 0 {
        let name = agent
            .agents
            .first()
            .and_then(|a| a["label"].as_str().or(a["model"].as_str()));
        if agent.waiters == 1 {
            name.map(|name| format!("Agent waiting · {name}"))
                .unwrap_or_else(|| "Agent waiting".into())
        } else {
            format!("{} agents waiting · review goes to all", agent.waiters)
        }
    } else {
        "No agent waiting · send now, collect later".into()
    }
}

pub fn render_send_popover(
    state: &mut SendReviewState,
    area: Rect,
    palette: &Palette,
    comments: &[ReviewComment],
    files: &[FileDiff],
    agent: &AgentSnapshot,
    buf: &mut Buffer,
) {
    let tokens = GridlineTokens::from(palette);
    let r = send_review_regions(area);
    if r.comments.height == 0 && state.focused == SendField::Comments {
        state.focused = SendField::General;
    }
    dim_buffer(area, buf);
    Clear.render(r.popup, buf);
    overlay_block(
        Span::styled(
            " Send to agent ",
            Style::default()
                .fg(tokens.text)
                .add_modifier(Modifier::BOLD),
        ),
        palette,
    )
    .render(r.popup, buf);
    let text = |rect: Rect, value: &str, style: Style, buf: &mut Buffer| {
        if rect.height > 0 && rect.width > 0 {
            buf.set_stringn(
                rect.x,
                rect.y,
                safe_terminal_text(value),
                rect.width as usize,
                style,
            );
        }
    };
    let subtle = Style::default().fg(tokens.text_subtle).bg(tokens.raised);
    text(r.connection, &agent_connection_label(agent), subtle, buf);
    let open = comments
        .iter()
        .filter(|c| c.status == CommentStatus::Open)
        .count();
    let summary = format!(
        "{} open · {} resolved · {}/{} files viewed",
        open,
        comments.len() - open,
        files.len().saturating_sub(state.unviewed_files),
        files.len()
    );
    text(r.summary, &summary, subtle, buf);
    let choices: Vec<_> = if r.verdict_rows.is_empty() {
        vec![(r.verdict, state.verdict)]
    } else {
        r.verdict_rows.clone()
    };
    for (row, decision) in choices {
        let selected = decision == state.verdict;
        let bg = if selected {
            tokens.selected
        } else {
            tokens.raised
        };
        fill(row, bg, buf);
        let color = if selected {
            tokens.accent
        } else {
            tokens.text_subtle
        };
        let label = if r.verdict_rows.is_empty() {
            format!("‹ {} ›", decision.label())
        } else {
            format!("{} {}", if selected { "›" } else { " " }, decision.label())
        };
        text(
            row,
            &label,
            Style::default().fg(color).bg(bg).add_modifier(
                if selected && state.focused == SendField::Verdict {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                },
            ),
            buf,
        );
    }
    text(r.description, state.verdict.description(), subtle, buf);
    if r.comments.height > 0 {
        let title = if state.focused == SendField::Comments {
            " Comments · ↑↓ browse · Enter open "
        } else {
            " Comments "
        };
        let block = field_block(title, palette, state.focused == SendField::Comments);
        let inner = block.inner(r.comments);
        block.render(r.comments, buf);
        state.comment_cursor = state.comment_cursor.min(comments.len().saturating_sub(1));
        if comments.is_empty() {
            text(
                inner,
                "No inline comments. You can send a note or verdict.",
                subtle,
                buf,
            );
        }
        let start = state
            .comment_cursor
            .saturating_sub(inner.height.saturating_sub(1) as usize);
        for (offset, comment) in comments
            .iter()
            .skip(start)
            .take(inner.height as usize)
            .enumerate()
        {
            let row = Rect::new(inner.x, inner.y + offset as u16, inner.width, 1);
            let selected =
                start + offset == state.comment_cursor && state.focused == SendField::Comments;
            let style = Style::default().fg(tokens.text_subtle).bg(if selected {
                tokens.selected
            } else {
                tokens.raised
            });
            fill(row, style.bg.unwrap(), buf);
            let marker = if comment.status == CommentStatus::Resolved {
                "✓"
            } else {
                "·"
            };
            text(
                row,
                &format!(
                    "{marker} {}:{}  {}",
                    comment.file_path,
                    comment.line_number,
                    comment.body.lines().next().unwrap_or("")
                ),
                style,
                buf,
            );
        }
    }
    state
        .general
        .set_style(Style::default().fg(tokens.text).bg(tokens.element));
    state.general.set_cursor_line_style(Style::default());
    state
        .general
        .set_cursor_style(if state.focused == SendField::General {
            Style::default().add_modifier(Modifier::REVERSED)
        } else {
            Style::default()
        });
    field_block(
        " Note · optional ",
        palette,
        state.focused == SendField::General,
    )
    .render(r.general_panel, buf);
    (&state.general).render(r.general, buf);
    let notice = state.feedback.clone().unwrap_or_else(|| {
        if state.guard_acknowledged {
            format!(
                "{} unviewed · Ctrl-S again to send anyway",
                state.unviewed_files
            )
        } else if state.unviewed_files > 0 {
            format!("{} files still unviewed", state.unviewed_files)
        } else {
            "Your comments and replies will be included.".into()
        }
    });
    text(
        r.notice,
        &notice,
        Style::default().fg(if state.feedback.is_some() || state.guard_acknowledged {
            tokens.warning
        } else {
            tokens.muted
        }),
        buf,
    );
    if r.copy_button.x.saturating_sub(r.footer.x) >= 9 {
        text(r.footer, "Tab field", subtle, buf);
    }
    fill(r.copy_button, tokens.raised, buf);
    text(r.copy_button, " ^Y Copy", subtle, buf);
    fill(r.send_button, tokens.selected, buf);
    text(
        r.send_button,
        " ^S Send",
        Style::default()
            .fg(tokens.accent)
            .bg(tokens.selected)
            .add_modifier(Modifier::BOLD),
        buf,
    );
    fill(r.cancel_button, tokens.raised, buf);
    text(r.cancel_button, " Esc Back", subtle, buf);
}

pub fn build_send_payload(
    comments: &[ReviewComment],
    general: &str,
    verdict: Option<ReviewDecision>,
    _round: u32,
) -> Option<String> {
    let xml = format_comments(comments, Some(general.trim()), verdict);
    (!xml.is_empty()).then_some(xml)
}

pub fn pending_review_path(repo_root: &str) -> PathBuf {
    diffing_core::project_storage_dir(repo_root).join("pending-review.xml")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn buffer_text(buf: &Buffer) -> String {
        buf.content.iter().map(|cell| cell.symbol()).collect()
    }
    #[test]
    fn every_web_verdict_is_reachable_including_reply_only() {
        let mut state = SendReviewState::new(0);
        for decision in [
            ReviewDecision::Rejected,
            ReviewDecision::CommentOnly,
            ReviewDecision::Approved,
            ReviewDecision::ChangesRequested,
        ] {
            state.cycle_verdict(1);
            assert_eq!(state.verdict, decision);
        }
        state.verdict = ReviewDecision::CommentOnly;
        let xml = build_send_payload(&[], "Discuss the approach", Some(state.verdict), 1).unwrap();
        assert!(xml.contains("mode=\"comment-only\""));
        assert!(xml.contains("MUST NOT edit any files"));
        assert!(!xml.contains("apply the changes requested."));
    }
    #[test]
    fn empty_export_without_a_verdict_stays_empty() {
        assert!(build_send_payload(&[], "  ", None, 1).is_none());
    }
    #[test]
    fn layout_keeps_note_and_actions_usable_at_every_supported_size() {
        for (width, height) in [(160, 48), (100, 30), (80, 24), (60, 16), (42, 8), (1, 1)] {
            let area = Rect::new(0, 0, width, height);
            let r = send_review_regions(area);
            let mut buffer = Buffer::empty(area);
            let mut state = SendReviewState::new(1);
            state.verdict = ReviewDecision::CommentOnly;
            render_send_popover(
                &mut state,
                area,
                &Palette::default(),
                &[],
                &[],
                &AgentSnapshot::default(),
                &mut buffer,
            );
            assert!(r.popup.right() <= area.right() && r.popup.bottom() <= area.bottom());
            if width >= 42 {
                assert!(r.general.width > 0 && r.general.height > 0);
                let text = buffer_text(&buffer);
                for label in ["Comment only", "^S Send", "Esc Back"] {
                    assert!(
                        text.contains(label),
                        "missing {label} at {width}x{height}: {text}"
                    );
                }
            }
        }
    }
}
