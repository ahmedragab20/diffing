//! Send-review popover. A modal that asks for:
//!  - a verdict (Approved / Request changes / Rejected) — radios
//!  - an optional overall comment — multi-line textarea
//!  - a live preview of the XML that will be sent (read-only)
//!  - "Copy" and "Send" buttons
//!
//! On Send: writes the XML to `pending-review.xml` in the per-repo
//! storage dir, updates the lockfile with a `pendingReview` marker so
//! a long-running `diffing await-review` (or any consumer that polls
//! the lockfile) can pick it up, and copies the XML to the system
//! clipboard when possible.

use std::path::PathBuf;

use ratatui::buffer::Buffer;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Widget, Wrap};
use tui_textarea::TextArea;

use diffing_core::comments::{CommentStatus, ReviewComment};
use diffing_core::diff::FileDiff;

use crate::handoff::format::format_comments;
use crate::handoff::review::ReviewDecision;
use crate::themes::Palette;

/// Centred rect helper (copied from `comment_form` so the two modals can
/// have different sizes without a public surface coupling).
fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendField {
    Verdict,
    General,
}

pub struct SendReviewState {
    pub verdict: ReviewDecision,
    pub general: TextArea<'static>,
    pub focused: SendField,
    pub preview_scroll: u16,
}

impl SendReviewState {
    pub fn new() -> Self {
        let mut ta = TextArea::new(vec![String::new()]);
        ta.set_placeholder_text("optional — overall note for the agent");
        Self {
            verdict: ReviewDecision::ChangesRequested,
            general: ta,
            focused: SendField::Verdict,
            preview_scroll: 0,
        }
    }

    pub fn cycle_verdict(&mut self, delta: isize) {
        let cur = self.verdict as isize;
        let n = ReviewDecision::ALL.len() as isize;
        let mut next = (cur + delta).rem_euclid(n);
        if next < 0 {
            next += n;
        }
        self.verdict = ReviewDecision::ALL[next as usize];
    }

    pub fn body(&self) -> String {
        self.general.lines().join("\n")
    }
}

pub fn render_send_popover(
    state: &mut SendReviewState,
    area: Rect,
    palette: &Palette,
    comments: &[ReviewComment],
    files: &[FileDiff],
    buf: &mut Buffer,
) {
    let popup = centered_rect(85, 80, area);
    let dim = Block::default().style(Style::default().bg(palette.bg));
    dim.render(area, buf);
    Clear.render(popup, buf);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(palette.accent))
        .title(Span::styled(
            " send review to agent ",
            Style::default().fg(palette.fg).add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);

    // Two-column layout: controls on the left, preview on the right.
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(45), Constraint::Percentage(55)])
        .split(inner);
    let left = chunks[0];
    let right = chunks[1];

    // ── Left: verdict radios + general comment + footer ──
    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // verdict
            Constraint::Min(4),     // general
            Constraint::Length(1),  // footer
        ])
        .split(left);

    // Verdict radios
    let verdict_lines: Vec<Line> = ReviewDecision::ALL
        .iter()
        .map(|d| {
            let is_selected = *d == state.verdict;
            let marker = if is_selected { "●" } else { "○" };
            let color = if is_selected { palette.accent } else { palette.dim };
            let style = if is_selected {
                Style::default().fg(color).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(color)
            };
            Line::from(Span::styled(format!("  {marker} {}", d.label()), style))
        })
        .collect();
    let verdict_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(if state.focused == SendField::Verdict { palette.accent } else { palette.border }))
        .title(Span::styled(" verdict (Tab to switch, ←→ to change) ", Style::default().fg(palette.fg)));
    let verdict_inner = verdict_block.inner(left_chunks[0]);
    verdict_block.render(left_chunks[0], buf);
    Paragraph::new(verdict_lines)
        .alignment(Alignment::Left)
        .render(verdict_inner, buf);

    // General comment textarea
    state.general.set_style(Style::default().fg(palette.fg).bg(palette.bg));
    state.general.set_cursor_line_style(Style::default().add_modifier(Modifier::UNDERLINED));
    state.general.set_cursor_style(Style::default().fg(palette.fg).add_modifier(Modifier::REVERSED));
    let general_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(if state.focused == SendField::General { palette.accent } else { palette.border }))
        .title(Span::styled(" general comment ", Style::default().fg(palette.fg)));
    let general_inner = general_block.inner(left_chunks[1]);
    general_block.render(left_chunks[1], buf);
    (&state.general).render(general_inner, buf);

    // Footer: hint + counts
    let open_count = comments.iter().filter(|c| c.status == CommentStatus::Open).count();
    let total = comments.len();
    let footer = format!(
        " ↑/↓: focus · ←/→: verdict · {} files · {} cmts ({} open) · Ctrl-S: send · Esc: cancel",
        files.len(),
        total,
        open_count
    );
    Paragraph::new(Line::from(Span::styled(
        footer,
        Style::default().fg(palette.dim),
    )))
    .alignment(Alignment::Center)
    .render(left_chunks[2], buf);

    // ── Right: live XML preview ──
    let xml = format_comments(comments, Some(&state.body()), Some(state.verdict));
    let preview_lines: Vec<Line> = if xml.is_empty() {
        vec![Line::from(Span::styled(
            " (nothing to send — no comments, no verdict, no general note) ",
            Style::default().fg(palette.comment),
        ))]
    } else {
        xml.lines()
            .take((right.height.saturating_sub(2)) as usize)
            .map(|l| {
                let s = Style::default().fg(palette.fg);
                Line::from(Span::styled(l.to_string(), s))
            })
            .collect()
    };
    let preview_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(palette.border))
        .title(Span::styled(" preview (xml sent to agent) ", Style::default().fg(palette.fg)));
    let preview_inner = preview_block.inner(right);
    preview_block.render(right, buf);
    Paragraph::new(preview_lines)
        .wrap(Wrap { trim: false })
        .scroll((0, state.preview_scroll))
        .render(preview_inner, buf);
}

/// What the send action actually does on disk. The TUI:
///   1. writes the XML to `pending-review.xml` next to `comments.json`
///   2. updates `server.json` with `pendingReview: { sentAt, verdict, round }`
///   3. tries to copy the XML to the system clipboard (best-effort)
///
/// Returns the XML that was sent (also stored on disk). `None` means
/// "nothing to send" — no comments, no verdict, no general note.
pub fn build_send_payload(
    comments: &[ReviewComment],
    general: &str,
    verdict: Option<ReviewDecision>,
    round: u32,
) -> Option<String> {
    let trimmed = general.trim();
    let xml = format_comments(comments, Some(trimmed), verdict);
    if xml.is_empty() {
        return None;
    }
    let _ = round; // reserved for the lockfile update
    Some(xml)
}

pub fn pending_review_path(repo_root: &str) -> PathBuf {
    diffing_core::project_storage_dir(repo_root).join("pending-review.xml")
}

#[cfg(test)]
mod tests {
    use super::*;
    use diffing_core::comments::{CommentSide, CommentStatus};

    fn sample() -> Vec<ReviewComment> {
        vec![ReviewComment {
            id: "c1".to_string(),
            file_path: "src/a.rs".to_string(),
            side: CommentSide::Additions,
            line_number: 42,
            start_line_number: None,
            line_content: "let x = 1;".to_string(),
            body: "rename".to_string(),
            status: CommentStatus::Open,
            created_at: 1,
            replies: vec![],
        }]
    }

    #[test]
    fn cycle_verdict_wraps_around() {
        // The default order is [Approved, ChangesRequested, Rejected].
        // Start at ChangesRequested (index 1).
        let mut s = SendReviewState::new();
        assert_eq!(s.verdict, ReviewDecision::ChangesRequested);
        // -1 → Approved (index 0).
        s.cycle_verdict(-1);
        assert_eq!(s.verdict, ReviewDecision::Approved);
        // -1 again → wraps to Rejected (the last element).
        s.cycle_verdict(-1);
        assert_eq!(s.verdict, ReviewDecision::Rejected);
        // +1 → wraps to Approved (the first element).
        s.cycle_verdict(1);
        assert_eq!(s.verdict, ReviewDecision::Approved);
    }

    #[test]
    fn build_send_payload_returns_none_for_no_inputs() {
        // No comments, no verdict, no general → no XML.
        let p = build_send_payload(&[], "", None, 1);
        assert!(p.is_none());
        // With a verdict but no comments, we still emit the envelope.
        let p2 = build_send_payload(&[], "", Some(ReviewDecision::Approved), 1);
        assert!(p2.is_some());
    }

    #[test]
    fn build_send_payload_includes_comments_when_present() {
        let p = build_send_payload(&sample(), "general", Some(ReviewDecision::Approved), 1);
        let xml = p.unwrap();
        assert!(xml.contains("decision=\"approved\""));
        assert!(xml.contains("rename"));
        assert!(xml.contains("general"));
    }

    #[test]
    fn new_state_starts_in_changes_requested() {
        let s = SendReviewState::new();
        assert_eq!(s.verdict, ReviewDecision::ChangesRequested);
        assert_eq!(s.focused, SendField::Verdict);
    }
}
