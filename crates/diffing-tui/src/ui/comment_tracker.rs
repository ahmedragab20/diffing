//! Bottom-of-screen comment tracker. Lists every comment (across all files)
//! with a focus cursor. `]` / `[` move the cursor; `Enter` (or `o`)
//! jumps the diff view to the comment's file/line; `e`/`r`/`x`/`d` act
//! on the focused comment.

use diffing_core::comments::{CommentStatus, ReviewComment};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::Span;
use ratatui::widgets::{Block, BorderType, Borders, List, StatefulWidget, Widget};

use crate::themes::Palette;
use crate::ui::comment_thread::render_tracker_row;

const TRACKER_TITLE: &str = " comments ";

pub struct TrackerState {
    pub cursor: usize,
    pub scroll: usize,
}

impl TrackerState {
    pub fn new() -> Self {
        Self {
            cursor: 0,
            scroll: 0,
        }
    }

    pub fn move_cursor(&mut self, delta: isize, total: usize) {
        if total == 0 {
            self.cursor = 0;
            return;
        }
        let mut next = self.cursor as isize + delta;
        if next < 0 {
            next = 0;
        }
        if next as usize >= total {
            next = total as isize - 1;
        }
        self.cursor = next as usize;
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
    state: &mut TrackerState,
    area: Rect,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .style(Style::default().bg(palette.panel))
        .border_style(Style::default().fg(palette.border))
        .title(Span::styled(TRACKER_TITLE, Style::default().fg(palette.fg)));
    let inner = block.inner(area);
    block.render(area, buf);

    let items: Vec<_> = comments
        .iter()
        .skip(state.scroll)
        .take(inner.height as usize)
        .enumerate()
        .map(|(i, c)| render_tracker_row(c, state.scroll + i == state.cursor, palette))
        .collect();
    let list = List::new(items).highlight_style(Style::default().bg(palette.selection_bg));
    let mut ls = ratatui::widgets::ListState::default();
    let visible_cursor = state.cursor.saturating_sub(state.scroll);
    if visible_cursor < inner.height as usize {
        ls.select(Some(visible_cursor));
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
        }
    }

    #[test]
    fn cursor_clamped_within_bounds() {
        let mut s = TrackerState::new();
        s.move_cursor(5, 3);
        assert_eq!(s.cursor, 2);
        s.move_cursor(-100, 3);
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
        render_tracker(&[], &mut s, area, &palette, &mut buf);
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
        render_tracker(&comments, &mut s, area, &palette, &mut buf);
    }
}
