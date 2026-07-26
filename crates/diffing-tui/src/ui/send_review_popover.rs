//! Send-review popover. A modal that asks for:
//!  - a verdict (Approved / Request changes / Rejected) — radios
//!  - an optional overall comment — multi-line textarea
//!  - a compact summary of the review handoff
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
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Widget};
use tui_textarea::TextArea;

use diffing_core::comments::{CommentStatus, ReviewComment};
use diffing_core::diff::FileDiff;

use crate::handoff::format::format_comments;
use crate::handoff::review::ReviewDecision;
use crate::themes::Palette;
use crate::ui::gridline::{
    dim_buffer, field_block, fill, hint_line, overlay_block, GridlineTokens, Tone, GLYPHS, METRICS,
};

fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
    Rect::new(
        area.x + area.width.saturating_sub(width) / 2,
        area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    )
}

#[derive(Debug, Clone)]
pub struct SendReviewRegions {
    pub popup: Rect,
    pub verdict_rows: Vec<(Rect, ReviewDecision)>,
    verdict_panel: Rect,
    general_panel: Rect,
    pub general: Rect,
    footer: Rect,
    compact: bool,
}

/// Shared geometry for rendering and mouse hit-testing.
pub fn send_review_regions(area: Rect) -> SendReviewRegions {
    let compact = area.width < 100 || area.height < 18;
    let popup = centered_rect(
        area.width.saturating_sub(METRICS.modal_margin_x).min(78),
        area.height.saturating_sub(METRICS.modal_margin_y).min(20),
        area,
    );
    let inner = Block::default().borders(Borders::ALL).inner(popup);
    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),
            Constraint::Min(4),
            Constraint::Length(1),
        ])
        .split(inner);
    let verdict_panel = left_chunks[0];
    let general_panel = left_chunks[1];
    let verdict_inner = Block::default().borders(Borders::ALL).inner(verdict_panel);
    let verdict_rows = ReviewDecision::ALL
        .iter()
        .enumerate()
        .filter_map(|(index, decision)| {
            (index < verdict_inner.height as usize).then_some((
                Rect::new(
                    verdict_inner.x,
                    verdict_inner.y + index as u16,
                    verdict_inner.width,
                    1,
                ),
                *decision,
            ))
        })
        .collect();

    SendReviewRegions {
        popup,
        verdict_rows,
        verdict_panel,
        general_panel,
        general: Block::default().borders(Borders::ALL).inner(general_panel),
        footer: left_chunks[2],
        compact,
    }
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
    pub unviewed_files: usize,
    pub guard_acknowledged: bool,
}

impl SendReviewState {
    pub fn new(unviewed_files: usize) -> Self {
        let mut ta = TextArea::new(vec![String::new()]);
        ta.set_placeholder_text("optional — overall note for the agent");
        Self {
            verdict: ReviewDecision::ChangesRequested,
            general: ta,
            focused: SendField::Verdict,
            unviewed_files,
            guard_acknowledged: false,
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
    let tokens = GridlineTokens::from(palette);
    let regions = send_review_regions(area);
    let popup = regions.popup;
    dim_buffer(area, buf);
    Clear.render(popup, buf);

    let block = overlay_block(
        Span::styled(
            " Send review ",
            Style::default()
                .fg(tokens.text)
                .add_modifier(Modifier::BOLD),
        ),
        palette,
    );
    block.render(popup, buf);

    // Verdict radios
    let verdict_block = field_block(" Verdict ", palette, state.focused == SendField::Verdict);
    let verdict_inner = verdict_block.inner(regions.verdict_panel);
    verdict_block.render(regions.verdict_panel, buf);
    for (index, decision) in ReviewDecision::ALL.iter().enumerate() {
        if index >= verdict_inner.height as usize {
            break;
        }
        let selected = *decision == state.verdict;
        let background = if selected {
            tokens.selected
        } else {
            tokens.raised
        };
        let tone = match decision {
            ReviewDecision::Approved => Tone::Positive,
            ReviewDecision::ChangesRequested => Tone::Warning,
            ReviewDecision::Rejected => Tone::Negative,
        };
        let row = Rect::new(
            verdict_inner.x,
            verdict_inner.y + index as u16,
            verdict_inner.width,
            1,
        );
        fill(row, background, buf);
        buf.set_string(
            row.x + 1,
            row.y,
            if selected {
                GLYPHS.bullet
            } else {
                GLYPHS.resolved
            },
            Style::default()
                .fg(if selected {
                    tokens.tone(tone)
                } else {
                    tokens.muted
                })
                .bg(background),
        );
        buf.set_string(
            row.x + 3,
            row.y,
            decision.label(),
            Style::default()
                .fg(if selected {
                    tokens.text
                } else {
                    tokens.text_subtle
                })
                .bg(background)
                .add_modifier(if selected {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
        );
    }

    // General comment textarea
    state
        .general
        .set_style(Style::default().fg(tokens.text).bg(tokens.element));
    state
        .general
        .set_cursor_line_style(Style::default().add_modifier(Modifier::UNDERLINED));
    state.general.set_cursor_style(
        Style::default()
            .fg(tokens.text)
            .add_modifier(Modifier::REVERSED),
    );
    let general_block = field_block(
        " General comment ",
        palette,
        state.focused == SendField::General,
    );
    let general_inner = general_block.inner(regions.general_panel);
    general_block.render(regions.general_panel, buf);
    (&state.general).render(general_inner, buf);

    // Footer: hint + counts
    let open_count = comments
        .iter()
        .filter(|c| c.status == CommentStatus::Open)
        .count();
    let total = comments.len();
    let command_hint = if state.unviewed_files == 0 {
        "Ctrl-S send · Esc cancel"
    } else if state.guard_acknowledged {
        "Ctrl-S confirm · Esc cancel"
    } else {
        "Ctrl-S review unviewed · Esc cancel"
    };
    let stats = format!(
        "{} files  ·  {} comments  ·  {} open",
        files.len(),
        total,
        open_count
    );
    let mut footer = Line::from(vec![Span::styled(
        stats,
        Style::default().fg(tokens.muted).bg(tokens.raised),
    )]);
    if state.unviewed_files > 0 {
        footer.spans.extend([
            Span::styled("  ·  ", Style::default().fg(tokens.rule).bg(tokens.raised)),
            Span::styled(
                format!("{} unviewed", state.unviewed_files),
                Style::default().fg(tokens.warning).bg(tokens.raised),
            ),
        ]);
    }
    footer.spans.push(Span::styled(
        "  ·  ",
        Style::default().fg(tokens.rule).bg(tokens.raised),
    ));
    if !regions.compact {
        footer
            .spans
            .extend(hint_line("Tab field · ←→ verdict", tokens.raised, palette).spans);
        footer.spans.push(Span::styled(
            "  ·  ",
            Style::default().fg(tokens.rule).bg(tokens.raised),
        ));
    }
    footer
        .spans
        .extend(hint_line(command_hint, tokens.raised, palette).spans);
    Paragraph::new(footer)
        .alignment(Alignment::Center)
        .render(regions.footer, buf);
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
            severity: None,
        }]
    }

    #[test]
    fn cycle_verdict_wraps_around() {
        // The default order is [Approved, ChangesRequested, Rejected].
        // Start at ChangesRequested (index 1).
        let mut s = SendReviewState::new(0);
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
        let s = SendReviewState::new(0);
        assert_eq!(s.verdict, ReviewDecision::ChangesRequested);
        assert_eq!(s.focused, SendField::Verdict);
    }

    #[test]
    fn state_tracks_unviewed_review_guard() {
        let s = SendReviewState::new(3);
        assert_eq!(s.unviewed_files, 3);
        assert!(!s.guard_acknowledged);
    }

    #[test]
    fn selected_verdict_uses_semantic_tone_and_selected_surface() {
        let area = Rect::new(0, 0, 100, 30);
        let palette = Palette::default();
        let tokens = GridlineTokens::from(&palette);
        let mut state = SendReviewState::new(0);
        let mut buffer = Buffer::empty(area);
        render_send_popover(&mut state, area, &palette, &[], &[], &mut buffer);
        let regions = send_review_regions(area);
        let row = regions
            .verdict_rows
            .iter()
            .find(|(_, decision)| *decision == ReviewDecision::ChangesRequested)
            .map(|(row, _)| *row)
            .unwrap();
        assert_eq!(buffer[(row.x + 1, row.y)].symbol(), GLYPHS.bullet);
        assert_eq!(buffer[(row.x + 1, row.y)].style().fg, Some(tokens.warning));
        assert_eq!(buffer[(row.x + 1, row.y)].style().bg, Some(tokens.selected));
    }

    #[test]
    fn mouse_regions_expose_every_verdict_and_text_panel() {
        let regions = send_review_regions(Rect::new(0, 0, 120, 40));
        assert_eq!(regions.verdict_rows.len(), ReviewDecision::ALL.len());
        assert!(regions.general.width > 0);
        assert!(regions.general.height > 0);
        for (index, (_, decision)) in regions.verdict_rows.iter().enumerate() {
            assert_eq!(*decision, ReviewDecision::ALL[index]);
        }
    }

    #[test]
    fn compact_modal_keeps_controls_wide() {
        let regions = send_review_regions(Rect::new(0, 0, 80, 24));
        assert!(regions.compact);
        assert_eq!(regions.popup.width, 76);
        assert!(regions.general.width > 70);
        assert_eq!(regions.verdict_rows.len(), ReviewDecision::ALL.len());
    }
}
