//! Bottom-of-screen comment tracker. Lists every comment (across all files)
//! with a focus cursor. `]` / `[` move the cursor; `Enter` (or `o`)
//! jumps the diff view to the comment's file/line; `e`/`r`/`x`/`d` act
//! on the focused comment.

use diffing_core::comments::{CommentSeverity, CommentStatus, ReviewComment};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::widgets::{List, StatefulWidget};
use std::collections::HashSet;

use crate::themes::Palette;
use crate::ui::comment_thread::render_tracker_row;
use crate::ui::gridline::{fill, vertical_rule, GridlineTokens, GLYPHS};

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

    pub fn keep_cursor_visible(&mut self, comments: &[ReviewComment], height: usize) {
        let visible = self.visible_indices(comments);
        let Some(cursor) = visible.iter().position(|index| *index == self.cursor) else {
            self.scroll = 0;
            return;
        };
        let height = height.max(1);
        if cursor < self.scroll {
            self.scroll = cursor;
        } else if cursor >= self.scroll.saturating_add(height) {
            self.scroll = cursor.saturating_add(1).saturating_sub(height);
        }
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

impl Default for TrackerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Shared by painting, scrolling, and pointer mapping.
pub fn tracker_row_height(inner: Rect) -> u16 {
    if inner.width < 72 && inner.height >= 9 {
        3
    } else if inner.width < 72 && inner.height >= 2 {
        2
    } else {
        1
    }
}

pub fn tracker_content_area(area: Rect) -> Rect {
    let top = if area.height >= 10 { 2 } else { 1 };
    Rect::new(
        area.x + 1,
        area.y + top,
        area.width.saturating_sub(2),
        area.height.saturating_sub(top + 1),
    )
}

pub fn render_tracker(
    comments: &[ReviewComment],
    visible_indices: &[usize],
    outdated_comments: &HashSet<String>,
    state: &mut TrackerState,
    focused: bool,
    area: Rect,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let tokens = GridlineTokens::from(palette);
    let visible = visible_indices;
    let mut title = format!(" Comments {} ", visible.len());
    if state.status_filter != TrackerStatusFilter::All {
        title.push_str(&format!("· {} ", state.status_filter.label()));
    }
    if state.severity_filter != TrackerSeverityFilter::Any {
        title.push_str(&format!("· {} ", state.severity_filter.label()));
    }
    fill(area, tokens.surface, buf);
    vertical_rule(
        Rect::new(area.x, area.y, 1, area.height),
        palette,
        tokens.surface,
        buf,
    );
    buf.set_stringn(
        area.x + 2,
        area.y,
        title.trim(),
        area.width.saturating_sub(4) as usize,
        Style::default()
            .fg(tokens.text)
            .bg(tokens.surface)
            .add_modifier(Modifier::BOLD),
    );
    let inner = tracker_content_area(area);
    if focused && area.height > 2 {
        buf[(area.x, area.y + 1)]
            .set_symbol(GLYPHS.focus_rail)
            .set_style(Style::default().fg(tokens.focus).bg(tokens.surface));
    }

    let row_height = tracker_row_height(inner);
    let capacity = (inner.height / row_height) as usize;
    state.keep_cursor_visible(comments, capacity);
    let visible_cursor = visible.iter().position(|index| *index == state.cursor);
    if visible.is_empty() && inner.width > 0 && inner.height > 0 {
        let message = if comments.is_empty() {
            "No comments yet · c adds a line comment"
        } else {
            "No comments match these filters · s/p changes filters"
        };
        buf.set_stringn(
            inner.x + 1,
            inner.y,
            message,
            inner.width.saturating_sub(2) as usize,
            Style::default().fg(tokens.muted).bg(tokens.surface),
        );
        return;
    }
    let items: Vec<_> = visible
        .iter()
        .skip(state.scroll)
        .take(capacity)
        .filter_map(|index| comments.get(*index).map(|comment| (*index, comment)))
        .map(|(index, comment)| {
            render_tracker_row(
                comment,
                index == state.cursor,
                outdated_comments.contains(&comment.id),
                inner.width,
                row_height,
                focused,
                palette,
            )
        })
        .collect();
    let list = List::new(items).highlight_style(Style::default().bg(if focused {
        tokens.selected
    } else {
        tokens.surface
    }));
    let mut ls = ratatui::widgets::ListState::default();
    if let Some(cursor) = visible_cursor.and_then(|cursor| cursor.checked_sub(state.scroll)) {
        if cursor < capacity {
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
            extra: Default::default(),
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
        render_tracker(
            &[],
            &[],
            &HashSet::new(),
            &mut s,
            false,
            area,
            &palette,
            &mut buf,
        );
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
        let visible = s.visible_indices(&comments);
        render_tracker(
            &comments,
            &visible,
            &HashSet::new(),
            &mut s,
            true,
            area,
            &palette,
            &mut buf,
        );
        assert_eq!(
            buf[(area.x, area.y + 1)].symbol(),
            crate::ui::gridline::GLYPHS.focus_rail
        );
        assert_eq!(
            buf[(area.x, area.y + 1)].style().fg,
            Some(palette.border_focused)
        );
    }

    #[test]
    fn rendering_keeps_the_filtered_cursor_in_view() {
        let comments = (0..8)
            .map(|index| make_comment(&index.to_string(), CommentStatus::Open))
            .collect::<Vec<_>>();
        let mut state = TrackerState::new();
        state.cursor = 7;
        let area = Rect::new(0, 0, 80, 4);
        let mut buffer = Buffer::empty(area);
        let visible = state.visible_indices(&comments);
        render_tracker(
            &comments,
            &visible,
            &HashSet::new(),
            &mut state,
            true,
            area,
            &Palette::default(),
            &mut buffer,
        );
        assert!(state.scroll > 0);
        assert!(state.scroll <= 7);
    }

    #[test]
    fn narrow_tracker_keeps_body_and_last_selection_visible() {
        let comments = (0..8)
            .map(|index| {
                let mut comment = make_comment(&index.to_string(), CommentStatus::Open);
                comment.body = format!("Comment body {index}");
                comment
            })
            .collect::<Vec<_>>();
        let mut state = TrackerState::new();
        state.cursor = 7;
        let area = Rect::new(0, 0, 38, 7);
        let mut buffer = Buffer::empty(area);
        let visible = state.visible_indices(&comments);
        render_tracker(
            &comments,
            &visible,
            &HashSet::new(),
            &mut state,
            true,
            area,
            &Palette::default(),
            &mut buffer,
        );
        let row = |y| {
            (0..area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        };
        assert!(row(1).contains("src/a.rs:1"));
        assert!(row(2).contains("Comment body 6"));
        assert!(row(4).contains("Comment body 7"));
        assert_eq!(state.scroll, 6);
    }
}
