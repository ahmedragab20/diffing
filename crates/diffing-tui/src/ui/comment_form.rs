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
use crate::ui::gridline::{
    dim_buffer, hint_line, overlay_block, GridlineTokens, Tone, GLYPHS, METRICS,
};
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

#[derive(Debug, Clone, Copy)]
pub struct CommentFormRegions {
    pub popup: Rect,
    pub body: Rect,
    pub severity_button: Rect,
    pub save_button: Rect,
    pub cancel_button: Rect,
    footer: Rect,
}

pub fn comment_form_regions(area: Rect) -> CommentFormRegions {
    let popup = centered_rect(
        area.width.saturating_sub(METRICS.modal_margin_x).min(72),
        area.height.min(14),
        area,
    );
    let inner = Rect::new(
        popup.x.saturating_add(1),
        popup.y.saturating_add(1),
        popup.width.saturating_sub(2),
        popup.height.saturating_sub(2),
    );
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(3), Constraint::Length(1)])
        .split(inner);
    let footer = chunks[1];
    let cancel_width = 10.min(footer.width);
    let save_width = 8.min(footer.width.saturating_sub(cancel_width));
    let cancel_button = Rect::new(
        footer.x + footer.width.saturating_sub(cancel_width),
        footer.y,
        cancel_width,
        footer.height,
    );
    let save_button = Rect::new(
        cancel_button.x.saturating_sub(save_width),
        footer.y,
        save_width,
        footer.height,
    );
    let severity_button = Rect::new(
        footer.x,
        footer.y,
        footer
            .width
            .saturating_sub(save_width + cancel_width)
            .min(16),
        footer.height,
    );
    CommentFormRegions {
        popup,
        body: chunks[0],
        severity_button,
        save_button,
        cancel_button,
        footer,
    }
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

    /// Open an empty reply form. The parent remains visible in the thread;
    /// duplicating it in the editor makes accidental quote-only replies easy.
    pub fn reply(target_label: String) -> Self {
        let mut ta = TextArea::new(vec![String::new()]);
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
    let regions = comment_form_regions(area);
    let popup = regions.popup;
    let tokens = GridlineTokens::from(palette);
    dim_buffer(area, buf);
    Clear.render(popup, buf);

    let block = overlay_block(
        Span::styled(
            format!(" {} ", form.target_label),
            Style::default()
                .fg(tokens.text)
                .add_modifier(Modifier::BOLD),
        ),
        palette,
    );
    block.render(popup, buf);

    // Style the textarea border-less inside the modal.
    form.textarea
        .set_style(Style::default().fg(tokens.text).bg(tokens.element));
    form.textarea
        .set_cursor_line_style(Style::default().add_modifier(Modifier::UNDERLINED));
    form.textarea.set_cursor_style(
        Style::default()
            .fg(tokens.text)
            .add_modifier(Modifier::REVERSED),
    );
    let ta_widget = &form.textarea;
    ta_widget.render(regions.body, buf);

    // Footer.
    let hint = match form.kind {
        FormKind::New => "Ctrl-T severity · Ctrl-S save · Esc cancel",
        FormKind::Reply => "Ctrl-S send reply · Esc cancel",
        FormKind::Edit => "Ctrl-S save · Esc cancel",
    };
    let mut footer_line = Line::default();
    if form.kind == FormKind::New {
        let severity = form.severity.unwrap_or(CommentSeverity::None);
        let tone = match severity {
            CommentSeverity::Blocking => Tone::Negative,
            CommentSeverity::Question => Tone::Info,
            CommentSeverity::Nit => Tone::Warning,
            CommentSeverity::Praise => Tone::Positive,
            CommentSeverity::None => Tone::Neutral,
        };
        footer_line.spans.extend([
            Span::styled(
                format!("{} {}", GLYPHS.bullet, severity.as_str()),
                Style::default().fg(tokens.tone(tone)).bg(tokens.raised),
            ),
            Span::styled("  ·  ", Style::default().fg(tokens.rule).bg(tokens.raised)),
        ]);
    }
    footer_line
        .spans
        .extend(hint_line(hint, tokens.raised, palette).spans);
    Paragraph::new(footer_line)
        .alignment(Alignment::Left)
        .wrap(Wrap { trim: false })
        .render(regions.footer, buf);
    let save_label = if form.kind == FormKind::Reply {
        "Reply"
    } else {
        "Save"
    };
    crate::ui::gridline::fill(regions.save_button, tokens.selected, buf);
    buf.set_stringn(
        regions.save_button.x + 1,
        regions.save_button.y,
        save_label,
        regions.save_button.width.saturating_sub(2) as usize,
        Style::default()
            .fg(tokens.accent)
            .bg(tokens.selected)
            .add_modifier(Modifier::BOLD),
    );
    crate::ui::gridline::fill(regions.cancel_button, tokens.element, buf);
    buf.set_stringn(
        regions.cancel_button.x + 1,
        regions.cancel_button.y,
        "Cancel",
        regions.cancel_button.width.saturating_sub(2) as usize,
        Style::default().fg(tokens.text_subtle).bg(tokens.element),
    );
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
    fn reply_starts_empty() {
        let f = CommentFormState::reply("reply".to_string());
        assert!(f.body().is_empty());
    }

    #[test]
    fn edit_preserves_blank_lines_and_trailing_newline() {
        let f = CommentFormState::edit("edit".to_string(), "first\n\nthird\n");
        assert_eq!(f.body(), "first\n\nthird\n");
    }
}
