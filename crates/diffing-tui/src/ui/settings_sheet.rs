use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph, Widget};

use crate::lsp::IntelligenceMode;
use crate::persistence::FileDisplay;
use crate::themes::Palette;
use crate::ui::gridline::{fill, overlay_block, GridlineTokens};

pub const SETTINGS_ROWS: usize = 8;

#[derive(Debug, Clone, Copy, Default)]
pub struct SettingsState {
    pub cursor: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct SettingsValues {
    pub file_display: FileDisplay,
    pub split: bool,
    pub wrap: bool,
    pub tab_size: u8,
    pub line_numbers: bool,
    pub comments_visible: bool,
    pub intelligence_mode: IntelligenceMode,
    pub theme_name: &'static str,
}

impl SettingsState {
    pub fn move_cursor(&mut self, delta: isize) {
        self.cursor = (self.cursor as isize + delta).rem_euclid(SETTINGS_ROWS as isize) as usize;
    }
}

fn settings_geometry(area: Rect) -> (Rect, Rect) {
    let width = area.width.saturating_sub(4).min(70);
    let height = area.height.saturating_sub(2).min(20);
    let popup = Rect::new(
        area.x + area.width.saturating_sub(width) / 2,
        area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    );
    let inner = Rect::new(
        popup.x.saturating_add(1),
        popup.y.saturating_add(1),
        popup.width.saturating_sub(2),
        popup.height.saturating_sub(2),
    );
    (popup, inner)
}

pub fn settings_row_at(area: Rect, column: u16, row: u16) -> Option<usize> {
    let (_, inner) = settings_geometry(area);
    (0..SETTINGS_ROWS).find(|index| {
        let y = inner.y + 1 + *index as u16 * 2;
        row == y && column >= inner.x && column < inner.x.saturating_add(inner.width)
    })
}

pub fn render_settings(
    state: &SettingsState,
    values: SettingsValues,
    area: Rect,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let tokens = GridlineTokens::from(palette);
    fill(area, tokens.canvas, buf);
    let (popup, _) = settings_geometry(area);
    Clear.render(popup, buf);
    let block = overlay_block(" Settings · local diffs ", palette);
    let inner = block.inner(popup);
    block.render(popup, buf);

    let rows = [
        ("File display", values.file_display.label()),
        (
            "Diff layout",
            if values.split { "Split" } else { "Unified" },
        ),
        ("Wrap long lines", if values.wrap { "On" } else { "Off" }),
        (
            "Tab size",
            match values.tab_size {
                2 => "2",
                8 => "8",
                _ => "4",
            },
        ),
        (
            "Line numbers",
            if values.line_numbers {
                "Shown"
            } else {
                "Hidden"
            },
        ),
        (
            "Review drawer",
            if values.comments_visible {
                "Shown"
            } else {
                "Hidden"
            },
        ),
        ("Language intelligence", values.intelligence_mode.label()),
        ("Theme", values.theme_name),
    ];

    for (index, (label, value)) in rows.into_iter().enumerate() {
        let y = inner.y + 1 + index as u16 * 2;
        if y >= inner.y + inner.height.saturating_sub(1) {
            break;
        }
        let selected = state.cursor == index;
        let background = if selected {
            tokens.selection
        } else {
            tokens.raised
        };
        let row = Rect::new(inner.x, y, inner.width, 1);
        fill(row, background, buf);
        let marker = if selected { "▌" } else { " " };
        let value_width = value.chars().count() as u16;
        buf.set_string(
            row.x,
            row.y,
            marker,
            Style::default().fg(tokens.focus).bg(background),
        );
        buf.set_string(
            row.x + 2,
            row.y,
            label,
            Style::default()
                .fg(tokens.text)
                .bg(background)
                .add_modifier(if selected {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
        );
        let value_x = row.x + row.width.saturating_sub(value_width + 2);
        buf.set_string(
            value_x,
            row.y,
            value,
            Style::default()
                .fg(if selected { tokens.focus } else { tokens.muted })
                .bg(background),
        );
    }

    Paragraph::new(Line::from(vec![
        Span::styled("↑↓", Style::default().fg(tokens.focus)),
        Span::styled(" select  ", Style::default().fg(tokens.muted)),
        Span::styled("←→/Enter", Style::default().fg(tokens.focus)),
        Span::styled(" change  ", Style::default().fg(tokens.muted)),
        Span::styled("Esc", Style::default().fg(tokens.focus)),
        Span::styled(" close", Style::default().fg(tokens.muted)),
    ]))
    .render(
        Rect::new(
            inner.x + 1,
            inner.y + inner.height.saturating_sub(1),
            inner.width.saturating_sub(2),
            1,
        ),
        buf,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_cursor_wraps() {
        let mut state = SettingsState::default();
        state.move_cursor(-1);
        assert_eq!(state.cursor, SETTINGS_ROWS - 1);
        state.move_cursor(1);
        assert_eq!(state.cursor, 0);
    }

    #[test]
    fn settings_rows_are_mouse_addressable() {
        let area = Rect::new(0, 0, 100, 30);
        let (_, inner) = settings_geometry(area);
        assert_eq!(settings_row_at(area, inner.x + 3, inner.y + 1), Some(0));
        assert_eq!(settings_row_at(area, inner.x + 3, inner.y + 3), Some(1));
        assert_eq!(settings_row_at(area, inner.x - 1, inner.y + 1), None);
    }
}
