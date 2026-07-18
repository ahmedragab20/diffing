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
use ratatui::widgets::{Clear, Paragraph, Widget, Wrap};
use tui_textarea::TextArea;

use crate::themes::Palette;
use crate::ui::gridline::{dim_buffer, overlay_block};
use diffing_core::comments::CommentSeverity;

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
    pub severity: Option<CommentSeverity>,
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
            severity: None,
        }
    }

    /// Open a reply form pre-filled with the quoted parent body.
    pub fn reply(target_label: String, quoted_body: &str) -> Self {
        let lines = textarea_lines(quoted_body);
        let mut ta = TextArea::new(lines);
        ta.set_placeholder_text("reply, Ctrl-S to save, Esc to cancel");
        Self {
            kind: FormKind::Reply,
            target_label,
            textarea: ta,
            severity: None,
        }
    }

    /// Open an edit form pre-filled with the existing body.
    pub fn edit(target_label: String, body: &str) -> Self {
        let lines = textarea_lines(body);
        let mut ta = TextArea::new(lines);
        ta.set_placeholder_text("edit, Ctrl-S to save, Esc to cancel");
        Self {
            kind: FormKind::Edit,
            target_label,
            textarea: ta,
            severity: None,
        }
    }

    /// Drain the textarea into a single string.
    pub fn body(&self) -> String {
        self.textarea.lines().join("\n")
    }

    pub fn cycle_severity(&mut self) {
        self.severity = match self.severity {
            None | Some(CommentSeverity::None) => Some(CommentSeverity::Blocking),
            Some(CommentSeverity::Blocking) => Some(CommentSeverity::Question),
            Some(CommentSeverity::Question) => Some(CommentSeverity::Nit),
            Some(CommentSeverity::Nit) => Some(CommentSeverity::Praise),
            Some(CommentSeverity::Praise) => None,
        };
    }
}

fn textarea_lines(body: &str) -> Vec<String> {
    if body.is_empty() {
        return vec![String::new()];
    }
    body.replace("\r\n", "\n")
        .split('\n')
        .map(String::from)
        .collect()
}

pub fn render_form(form: &mut CommentFormState, area: Rect, palette: &Palette, buf: &mut Buffer) {
    let popup = centered_rect(
        area.width.saturating_sub(4).min(72),
        area.height.min(14),
        area,
    );
    dim_buffer(area, buf);
    Clear.render(popup, buf);

    let block = overlay_block(
        Span::styled(
            format!(" {} ", form.target_label),
            Style::default().fg(palette.fg).add_modifier(Modifier::BOLD),
        ),
        palette,
    );
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
        FormKind::New => "Ctrl-T severity  |  Ctrl-S save  |  Esc cancel",
        FormKind::Reply => "Ctrl-S send reply  |  Esc cancel",
        FormKind::Edit => "Ctrl-S save  |  Esc cancel",
    };
    Paragraph::new(Line::from(Span::styled(
        if form.kind == FormKind::New {
            format!(
                "Severity: {}  |  {hint}",
                form.severity.map(CommentSeverity::as_str).unwrap_or("none")
            )
        } else {
            hint.to_string()
        },
        Style::default().fg(palette.dim),
    )))
    .alignment(Alignment::Right)
    .wrap(Wrap { trim: false })
    .render(footer, buf);
}

fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
    Rect::new(
        area.x + area.width.saturating_sub(width) / 2,
        area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    )
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
    fn severity_cycles_through_review_intents() {
        let mut form = CommentFormState::new("target".to_string());
        form.cycle_severity();
        assert_eq!(form.severity, Some(CommentSeverity::Blocking));
        form.cycle_severity();
        assert_eq!(form.severity, Some(CommentSeverity::Question));
    }

    #[test]
    fn reply_prefills_quoted_body() {
        let f = CommentFormState::reply("reply".to_string(), "parent says hi");
        assert!(f.body().contains("parent says hi"));
    }

    #[test]
    fn edit_preserves_blank_lines_and_trailing_newline() {
        let f = CommentFormState::edit("edit".to_string(), "first\n\nthird\n");
        assert_eq!(f.body(), "first\n\nthird\n");
    }
}
