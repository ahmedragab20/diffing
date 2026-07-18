//! Modal comment-form overlay. Wraps `tui_textarea::TextArea` so the user
//! can type a multi-line comment body. Renders centred on top of the
//! existing TUI, dimming the background by drawing a fullscreen block of
//! reversed-video spaces first.
//!
//! Save: Ctrl-S. Cancel: Esc. While the form is open, all other key
//! events are consumed by the textarea.

use ratatui::buffer::Buffer;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Widget, Wrap};
use tui_textarea::TextArea;

use crate::themes::Palette;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormKind {
    New,
    Reply,
    Edit,
}

pub struct CommentFormState {
    pub kind: FormKind,
    pub target_label: String,
    pub textarea: TextArea<'static>,
}

impl CommentFormState {
    /// Open a new-comment form. `target_label` is rendered as the
    /// form's title (e.g. "new comment on src/a.rs:42").
    pub fn new(target_label: String) -> Self {
        let mut ta = TextArea::new(vec![String::new()]);
        ta.set_placeholder_text("type your comment, Ctrl-S to save, Esc to cancel");
        ta.set_style(
            Style::default()
                .fg(crate::themes::Palette::for_theme(crate::themes::ThemeName::default()).fg),
        );
        Self {
            kind: FormKind::New,
            target_label,
            textarea: ta,
        }
    }

    /// Open a reply form pre-filled with the quoted parent body.
    pub fn reply(target_label: String, quoted_body: &str) -> Self {
        let lines: Vec<String> = if quoted_body.is_empty() {
            vec![String::new()]
        } else {
            quoted_body.lines().map(String::from).collect()
        };
        let mut ta = TextArea::new(lines);
        ta.set_placeholder_text("reply, Ctrl-S to save, Esc to cancel");
        Self {
            kind: FormKind::Reply,
            target_label,
            textarea: ta,
        }
    }

    /// Open an edit form pre-filled with the existing body.
    pub fn edit(target_label: String, body: &str) -> Self {
        let lines: Vec<String> = if body.is_empty() {
            vec![String::new()]
        } else {
            body.lines().map(String::from).collect()
        };
        let mut ta = TextArea::new(lines);
        ta.set_placeholder_text("edit, Ctrl-S to save, Esc to cancel");
        Self {
            kind: FormKind::Edit,
            target_label,
            textarea: ta,
        }
    }

    /// Drain the textarea into a single string.
    pub fn body(&self) -> String {
        self.textarea.lines().join("\n")
    }
}

pub fn render_form(form: &mut CommentFormState, area: Rect, palette: &Palette, buf: &mut Buffer) {
    // Modal box: 80% width, 60% height, centered.
    let popup = centered_rect(80, 60, area);
    // Dim the area behind the popup with a default-styled block.
    let dim = Block::default().style(Style::default().bg(palette.bg).fg(palette.dim));
    dim.render(area, buf);
    Clear.render(popup, buf);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .style(Style::default().bg(palette.elevated))
        .border_style(Style::default().fg(palette.accent))
        .title(Span::styled(
            format!(" {} ", form.target_label),
            Style::default().fg(palette.fg).add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(3), Constraint::Length(1)])
        .split(inner);
    // Body — the textarea.
    let body = chunks[0];
    let footer = chunks[1];

    // Style the textarea border-less inside the modal.
    form.textarea
        .set_style(Style::default().fg(palette.fg).bg(palette.elevated));
    form.textarea
        .set_cursor_line_style(Style::default().add_modifier(Modifier::UNDERLINED));
    form.textarea.set_cursor_style(
        Style::default()
            .fg(palette.fg)
            .add_modifier(Modifier::REVERSED),
    );
    let ta_widget = &form.textarea;
    ta_widget.render(body, buf);

    // Footer.
    let hint = match form.kind {
        FormKind::New => "Ctrl-S save  |  Esc cancel",
        FormKind::Reply => "Ctrl-S send reply  |  Esc cancel",
        FormKind::Edit => "Ctrl-S save  |  Esc cancel",
    };
    Paragraph::new(Line::from(Span::styled(
        hint,
        Style::default().fg(palette.dim),
    )))
    .alignment(Alignment::Right)
    .wrap(Wrap { trim: false })
    .render(footer, buf);
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_concatenates_lines_with_newlines() {
        let mut f = CommentFormState::new("test".to_string());
        f.textarea.insert_str("hello");
        f.textarea.insert_newline();
        f.textarea.insert_str("world");
        assert_eq!(f.body(), "hello\nworld");
    }

    #[test]
    fn reply_prefills_quoted_body() {
        let f = CommentFormState::reply("reply".to_string(), "parent says hi");
        assert!(f.body().contains("parent says hi"));
    }
}
