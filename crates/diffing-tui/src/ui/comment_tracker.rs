//! Bottom-of-screen comment tracker. Lists every comment (across all files)
//! with a focus cursor. `]` / `[` move the cursor; `Enter` (or `o`)
//! jumps the diff view to the comment's file/line; `e`/`r`/`x`/`d` act
//! on the focused comment.

use diffing_core::comments::{CommentSeverity, CommentStatus, ReviewComment};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::Span;
use ratatui::widgets::{List, StatefulWidget, Widget};
use std::collections::HashSet;

use crate::themes::Palette;
use crate::ui::comment_thread::render_tracker_row;
use crate::ui::gridline::square_block;

pub struct TrackerState {
    pub cursor: usize,
    pub scroll: usize,
    pub status_filter: TrackerStatusFilter,
    pub severity_filter: TrackerSeverityFilter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackerStatusFilter {
    All,
    Open,
    Replied,
    Resolved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackerSeverityFilter {
    Any,
    Blocking,
    Question,
    Nit,
    Praise,
}

impl TrackerStatusFilter {
    pub fn next(self) -> Self {
        match self {
            Self::All => Self::Open,
            Self::Open => Self::Replied,
            Self::Replied => Self::Resolved,
            Self::Resolved => Self::All,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Open => "open",
            Self::Replied => "replied",
            Self::Resolved => "resolved",
        }
    }
}

impl TrackerSeverityFilter {
    pub fn next(self) -> Self {
        match self {
            Self::Any => Self::Blocking,
            Self::Blocking => Self::Question,
            Self::Question => Self::Nit,
            Self::Nit => Self::Praise,
            Self::Praise => Self::Any,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Any => "any severity",
            Self::Blocking => "blocking",
            Self::Question => "question",
            Self::Nit => "nit",
            Self::Praise => "praise",
        }
    }
}

impl TrackerState {
    pub fn new() -> Self {
        Self {
            cursor: 0,
            scroll: 0,
            status_filter: TrackerStatusFilter::All,
            severity_filter: TrackerSeverityFilter::Any,
        }
    }

    pub fn visible_indices(&self, comments: &[ReviewComment]) -> Vec<usize> {
        comments
            .iter()
            .enumerate()
            .filter(|(_, comment)| match self.status_filter {
                TrackerStatusFilter::All => true,
                TrackerStatusFilter::Open => {
                    comment.status == CommentStatus::Open && comment.replies.is_empty()
                }
                TrackerStatusFilter::Replied => {
                    comment.status == CommentStatus::Open && !comment.replies.is_empty()
                }
                TrackerStatusFilter::Resolved => comment.status == CommentStatus::Resolved,
            })
            .filter(|(_, comment)| match self.severity_filter {
                TrackerSeverityFilter::Any => true,
                TrackerSeverityFilter::Blocking => {
                    comment.severity == Some(CommentSeverity::Blocking)
                }
                TrackerSeverityFilter::Question => {
                    comment.severity == Some(CommentSeverity::Question)
                }
                TrackerSeverityFilter::Nit => comment.severity == Some(CommentSeverity::Nit),
                TrackerSeverityFilter::Praise => comment.severity == Some(CommentSeverity::Praise),
            })
            .map(|(index, _)| index)
            .collect()
    }

    pub fn move_visible_cursor(&mut self, delta: isize, comments: &[ReviewComment]) {
        let visible = self.visible_indices(comments);
        if visible.is_empty() {
            self.cursor = 0;
            return;
        }
        let current = visible
            .iter()
            .position(|index| *index == self.cursor)
            .unwrap_or(0);
        let next = (current as isize + delta).clamp(0, visible.len() as isize - 1) as usize;
        self.cursor = visible[next];
    }

    pub fn normalize_filter_cursor(&mut self, comments: &[ReviewComment]) {
        let visible = self.visible_indices(comments);
        self.cursor = visible.first().copied().unwrap_or(0);
        self.scroll = 0;
    }

    #[allow(dead_code)]
    pub fn focus_first_open(&mut self, comments: &[ReviewComment]) {
        if let Some(idx) = comments
            .iter()
            .position(|c| c.status == CommentStatus::Open)
        {
            self.cursor = idx;
        } else {
            self.cursor = 0;
        }
    }
}

pub fn render_tracker(
    comments: &[ReviewComment],
    outdated_comments: &HashSet<String>,
    state: &mut TrackerState,
    area: Rect,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let title = format!(
        " comments · {} · {} ",
        state.status_filter.label(),
        state.severity_filter.label()
    );
    let block = square_block(
        Span::styled(title, Style::default().fg(palette.fg)),
        palette,
        false,
    );
    let inner = block.inner(area);
    block.render(area, buf);

    let visible = state.visible_indices(comments);
    let items: Vec<_> = visible
        .iter()
        .skip(state.scroll)
        .take(inner.height as usize)
        .filter_map(|index| comments.get(*index).map(|comment| (*index, comment)))
        .map(|(index, comment)| {
            render_tracker_row(
                comment,
                index == state.cursor,
                outdated_comments.contains(&comment.id),
                palette,
            )
        })
        .collect();
    let list = List::new(items).highlight_style(Style::default().bg(palette.selection_bg));
    let mut ls = ratatui::widgets::ListState::default();
    let visible_cursor = visible.iter().position(|index| *index == state.cursor);
    if let Some(cursor) = visible_cursor.and_then(|cursor| cursor.checked_sub(state.scroll)) {
        if cursor < inner.height as usize {
            ls.select(Some(cursor));
        }
    }
    StatefulWidget::render(&list, inner, buf, &mut ls);
}

#[cfg(test)]
mod tests {
    use super::*;
    use diffing_core::comments::{CommentSide, CommentStatus};
    use ratatui::buffer::Buffer;

    fn make_comment(id: &str, status: CommentStatus) -> ReviewComment {
        ReviewComment {
            id: id.to_string(),
            file_path: "src/a.rs".to_string(),
            side: CommentSide::Additions,
            line_number: 1,
            start_line_number: None,
            line_content: String::new(),
            body: "body".to_string(),
            status,
            created_at: 1,
            replies: vec![],
            severity: None,
        }
    }

    #[test]
    fn cursor_clamped_within_bounds() {
        let comments = vec![
            make_comment("a", CommentStatus::Open),
            make_comment("b", CommentStatus::Open),
            make_comment("c", CommentStatus::Open),
        ];
        let mut s = TrackerState::new();
        s.move_visible_cursor(5, &comments);
        assert_eq!(s.cursor, 2);
        s.move_visible_cursor(-100, &comments);
        assert_eq!(s.cursor, 0);
    }

    #[test]
    fn focus_first_open_picks_open_comment() {
        let comments = vec![
            make_comment("a", CommentStatus::Resolved),
            make_comment("b", CommentStatus::Open),
            make_comment("c", CommentStatus::Open),
        ];
        let mut s = TrackerState::new();
        s.focus_first_open(&comments);
        assert_eq!(s.cursor, 1);
    }

    #[test]
    fn focus_first_open_falls_back_to_zero_when_all_resolved() {
        let comments = vec![make_comment("a", CommentStatus::Resolved)];
        let mut s = TrackerState::new();
        s.focus_first_open(&comments);
        assert_eq!(s.cursor, 0);
    }

    #[test]
    fn render_does_not_panic_on_empty_list() {
        let mut s = TrackerState::new();
        let area = Rect::new(0, 0, 80, 5);
        let mut buf = Buffer::empty(area);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        render_tracker(&[], &HashSet::new(), &mut s, area, &palette, &mut buf);
    }

    #[test]
    fn render_does_not_panic_with_comments() {
        let comments = vec![
            make_comment("a", CommentStatus::Open),
            make_comment("b", CommentStatus::Resolved),
        ];
        let mut s = TrackerState::new();
        let area = Rect::new(0, 0, 80, 5);
        let mut buf = Buffer::empty(area);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        render_tracker(&comments, &HashSet::new(), &mut s, area, &palette, &mut buf);
    }
}
