use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::widgets::{Clear, Paragraph, Widget};

use crate::lsp::IntelligenceMode;
use crate::persistence::FileDisplay;
use crate::themes::Palette;
use crate::ui::gridline::{
    dim_buffer, fill, hint_line, overlay_block, GridlineTokens, GLYPHS, METRICS,
};

pub const SETTINGS_ROWS: usize = 12;

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
    pub mouse_enabled: bool,
    pub sidebar_visible: bool,
    pub sidebar_width: u16,
    pub comments_visible: bool,
    pub review_enabled: bool,
    pub intelligence_mode: IntelligenceMode,
    pub trust_repo_local_bin: bool,
    pub theme_name: &'static str,
}

impl SettingsState {
    pub fn move_cursor(&mut self, delta: isize) {
        self.cursor = (self.cursor as isize + delta).rem_euclid(SETTINGS_ROWS as isize) as usize;
    }
}

fn settings_geometry(area: Rect) -> (Rect, Rect) {
    let width = area.width.saturating_sub(METRICS.modal_margin_x).min(70);
    let height = area
        .height
        .saturating_sub(METRICS.modal_margin_y)
        .min(26)
        .max(8.min(area.height));
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

pub fn settings_row_at(state: &SettingsState, area: Rect, column: u16, row: u16) -> Option<usize> {
    let (_, inner) = settings_geometry(area);
    let stride = settings_row_stride(inner);
    let visible = visible_setting_rows(inner, stride);
    let scroll = setting_scroll(state.cursor, visible);
    (0..visible).find_map(|offset| {
        let index = scroll + offset;
        let y = inner.y + 1 + offset as u16 * stride;
        (index < SETTINGS_ROWS
            && row == y
            && column >= inner.x
            && column < inner.x.saturating_add(inner.width))
        .then_some(index)
    })
}

fn settings_row_stride(inner: Rect) -> u16 {
    let spacious_height = SETTINGS_ROWS as u16 * 2 + 2;
    if inner.height >= spacious_height {
        2
    } else {
        1
    }
}

fn visible_setting_rows(inner: Rect, stride: u16) -> usize {
    if inner.height < 3 {
        0
    } else {
        (usize::from(inner.height - 3) / usize::from(stride.max(1)) + 1).min(SETTINGS_ROWS)
    }
}

fn setting_scroll(cursor: usize, visible: usize) -> usize {
    if visible == 0 {
        return 0;
    }
    cursor
        .saturating_sub(visible.saturating_sub(1))
        .min(SETTINGS_ROWS.saturating_sub(visible))
}

pub fn render_settings(
    state: &SettingsState,
    values: SettingsValues,
    area: Rect,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let tokens = GridlineTokens::from(palette);
    dim_buffer(area, buf);
    let (popup, _) = settings_geometry(area);
    Clear.render(popup, buf);
    let block = overlay_block(" Settings ", palette);
    let inner = block.inner(popup);
    block.render(popup, buf);

    let sidebar_width = format!("{} cols", values.sidebar_width);
    let stride = settings_row_stride(inner);
    let visible = visible_setting_rows(inner, stride);
    let scroll = setting_scroll(state.cursor, visible);
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
            "Mouse input",
            if values.mouse_enabled {
                "Enabled"
            } else {
                "Disabled"
            },
        ),
        (
            "File sidebar",
            if values.sidebar_visible {
                "Shown"
            } else {
                "Hidden"
            },
        ),
        ("Sidebar width", sidebar_width.as_str()),
        (
            "Review drawer",
            if !values.review_enabled {
                "Review mode only"
            } else if values.comments_visible {
                "Shown"
            } else {
                "Hidden"
            },
        ),
        ("Language intelligence", values.intelligence_mode.label()),
        (
            "Repo-local LSP binaries",
            if values.trust_repo_local_bin {
                "Trusted"
            } else {
                "Blocked"
            },
        ),
        ("Theme", values.theme_name),
    ];

    for (offset, (index, (label, value))) in rows
        .into_iter()
        .enumerate()
        .skip(scroll)
        .take(visible)
        .enumerate()
    {
        let y = inner.y + 1 + offset as u16 * stride;
        let selected = state.cursor == index;
        let enabled = index != 8 || values.review_enabled;
        let background = if selected {
            tokens.selected
        } else {
            tokens.raised
        };
        let row = Rect::new(inner.x, y, inner.width, 1);
        fill(row, background, buf);
        let marker = if selected { GLYPHS.focus_rail } else { " " };
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
                .fg(if enabled { tokens.text } else { tokens.muted })
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
                .fg(if !enabled {
                    tokens.muted
                } else if selected {
                    tokens.focus
                } else {
                    tokens.muted
                })
                .bg(background),
        );
    }

    const DESCRIPTIONS: [&str; SETTINGS_ROWS] = [
        "Single focuses one file; continuous scrolls through every file",
        "Split aligns old/new sides; unified maximizes code width",
        "Wrap keeps long lines visible; off enables horizontal scrolling",
        "Display width used when expanding tab characters",
        "Show or hide old/new source line gutters",
        "Enable clicks, wheel scrolling, hover, and panel resizing",
        "Show or hide the changed-files sidebar",
        "Adjust sidebar width in terminal columns",
        "Show the review thread drawer (review mode only)",
        "Hover, definitions, and diagnostics through language servers",
        "Allow language servers from this repository's node_modules/.bin",
        "Choose a terminal-aware color palette",
    ];
    let footer = format!(
        "{}/{} · {} · ↑↓ select · ←→/Enter change · Esc close",
        state.cursor.min(SETTINGS_ROWS - 1) + 1,
        SETTINGS_ROWS,
        DESCRIPTIONS[state.cursor.min(SETTINGS_ROWS - 1)]
    );
    Paragraph::new(hint_line(&footer, tokens.raised, palette)).render(
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
        let state = SettingsState::default();
        assert_eq!(
            settings_row_at(&state, area, inner.x + 3, inner.y + 1),
            Some(0)
        );
        for index in 0..SETTINGS_ROWS {
            let stride = settings_row_stride(inner);
            let scroll = setting_scroll(state.cursor, visible_setting_rows(inner, stride));
            let row = inner.y + 1 + ((index - scroll) as u16) * stride;
            assert_eq!(settings_row_at(&state, area, inner.x + 3, row), Some(index));
        }
        assert_eq!(
            settings_row_at(&state, area, inner.x - 1, inner.y + 1),
            None
        );
    }

    #[test]
    fn compact_settings_keep_every_row_reachable() {
        let area = Rect::new(0, 0, 80, 14);
        let (_, inner) = settings_geometry(area);
        assert_eq!(settings_row_stride(inner), 1);
        let state = SettingsState {
            cursor: SETTINGS_ROWS - 1,
        };
        let visible = visible_setting_rows(inner, 1);
        let scroll = setting_scroll(state.cursor, visible);
        let row = inner.y + 1 + (state.cursor - scroll) as u16;
        assert!(row < inner.y + inner.height.saturating_sub(1));
        assert_eq!(settings_row_at(&state, area, inner.x + 3, row), Some(11));
    }

    #[test]
    fn settings_dim_instead_of_erasing_the_background() {
        let area = Rect::new(0, 0, 100, 30);
        let mut buffer = Buffer::empty(area);
        buffer[(1, 1)]
            .set_symbol("X")
            .set_style(Style::default().fg(ratatui::style::Color::Red));

        render_settings(
            &SettingsState::default(),
            SettingsValues {
                file_display: FileDisplay::Continuous,
                split: false,
                wrap: false,
                tab_size: 4,
                line_numbers: true,
                mouse_enabled: true,
                sidebar_visible: true,
                sidebar_width: 34,
                comments_visible: true,
                review_enabled: true,
                intelligence_mode: IntelligenceMode::Auto,
                trust_repo_local_bin: false,
                theme_name: "Rose Pine",
            },
            area,
            &Palette::default(),
            &mut buffer,
        );

        assert_eq!(buffer[(1, 1)].symbol(), "X");
        assert!(buffer[(1, 1)].style().add_modifier.contains(Modifier::DIM));
    }

    #[test]
    fn selected_setting_uses_the_shared_focus_rail_and_surface() {
        let area = Rect::new(0, 0, 100, 30);
        let palette = Palette::default();
        let tokens = GridlineTokens::from(&palette);
        let mut buffer = Buffer::empty(area);
        render_settings(
            &SettingsState { cursor: 0 },
            SettingsValues {
                file_display: FileDisplay::Continuous,
                split: false,
                wrap: true,
                tab_size: 4,
                line_numbers: true,
                mouse_enabled: true,
                sidebar_visible: true,
                sidebar_width: 34,
                comments_visible: true,
                review_enabled: true,
                intelligence_mode: IntelligenceMode::Auto,
                trust_repo_local_bin: false,
                theme_name: "GitHub Dark",
            },
            area,
            &palette,
            &mut buffer,
        );
        let (_, inner) = settings_geometry(area);
        let row_y = inner.y + 1;
        assert_eq!(buffer[(inner.x, row_y)].symbol(), GLYPHS.focus_rail);
        assert_eq!(buffer[(inner.x, row_y)].style().bg, Some(tokens.selected));
        assert!(buffer[(inner.x + 2, row_y)]
            .style()
            .add_modifier
            .contains(Modifier::BOLD));
    }
}
