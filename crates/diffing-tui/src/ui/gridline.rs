//! Gridline: square, terminal-native visual primitives for the TUI.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{Block, BorderType, Borders};

use crate::themes::Palette;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub struct GridlineTokens {
    pub canvas: Color,
    pub surface: Color,
    pub raised: Color,
    pub text: Color,
    pub muted: Color,
    pub rule: Color,
    pub focus: Color,
    pub selection: Color,
    pub positive: Color,
    pub negative: Color,
    pub warning: Color,
}

impl From<&Palette> for GridlineTokens {
    fn from(palette: &Palette) -> Self {
        Self {
            canvas: palette.bg,
            surface: palette.panel,
            raised: palette.elevated,
            text: palette.fg,
            muted: palette.dim,
            rule: palette.border,
            focus: palette.border_focused,
            selection: palette.selection_bg,
            positive: palette.added,
            negative: palette.removed,
            warning: palette.comment,
        }
    }
}

pub fn square_block<'a>(title: impl Into<Line<'a>>, palette: &Palette, focused: bool) -> Block<'a> {
    let tokens = GridlineTokens::from(palette);
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(Style::default().fg(if focused { tokens.focus } else { tokens.rule }))
        .style(Style::default().bg(tokens.surface))
        .title(title.into())
}

pub fn overlay_block<'a>(title: impl Into<Line<'a>>, palette: &Palette) -> Block<'a> {
    let tokens = GridlineTokens::from(palette);
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(tokens.focus))
        .style(Style::default().bg(tokens.raised))
        .title(title.into())
}

pub fn dim_buffer(area: Rect, buf: &mut Buffer) {
    for y in area.y..area.y.saturating_add(area.height) {
        for x in area.x..area.x.saturating_add(area.width) {
            buf[(x, y)].set_style(Style::default().add_modifier(Modifier::DIM));
        }
    }
}

pub fn fill(area: Rect, color: Color, buf: &mut Buffer) {
    for y in area.y..area.y.saturating_add(area.height) {
        for x in area.x..area.x.saturating_add(area.width) {
            buf[(x, y)]
                .set_symbol(" ")
                .set_style(Style::default().bg(color));
        }
    }
}

pub fn horizontal_rule(area: Rect, palette: &Palette, buf: &mut Buffer) {
    let tokens = GridlineTokens::from(palette);
    for x in area.x..area.x.saturating_add(area.width) {
        buf[(x, area.y)]
            .set_symbol("─")
            .set_style(Style::default().fg(tokens.rule).bg(tokens.canvas));
    }
}

pub fn focus_rail(area: Rect, focused: bool, palette: &Palette, buf: &mut Buffer) {
    if !focused || area.width == 0 {
        return;
    }
    let tokens = GridlineTokens::from(palette);
    for y in area.y..area.y.saturating_add(area.height) {
        buf[(area.x, y)]
            .set_symbol("▌")
            .set_style(Style::default().fg(tokens.focus).bg(tokens.surface));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_blocks_never_use_rounded_corners() {
        let palette = Palette::default();
        let block = square_block(" files ", &palette, false);
        let area = Rect::new(0, 0, 12, 3);
        let mut buffer = Buffer::empty(area);
        use ratatui::widgets::Widget;
        block.render(area, &mut buffer);
        assert_eq!(buffer[(0, 0)].symbol(), "┌");
        assert_eq!(buffer[(11, 0)].symbol(), "┐");
    }
}
