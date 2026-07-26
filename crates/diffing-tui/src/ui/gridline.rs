//! Gridline: the terminal-native design system for the TUI.
//!
//! Components consume semantic tokens instead of choosing raw palette fields.
//! This keeps hierarchy, focus, density, and feedback consistent across every
//! web-derived theme while preserving the compactness expected from a diff UI.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, BorderType, Borders};

use crate::themes::Palette;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GridlineTokens {
    pub canvas: Color,
    pub surface: Color,
    pub raised: Color,
    pub element: Color,
    pub selected: Color,
    pub text: Color,
    pub text_subtle: Color,
    pub muted: Color,
    pub code: Color,
    pub gutter: Color,
    pub rule_subtle: Color,
    pub rule: Color,
    pub focus: Color,
    pub accent: Color,
    pub info: Color,
    pub positive: Color,
    pub warning: Color,
    pub negative: Color,
    pub added_surface: Color,
    pub removed_surface: Color,
}

impl From<&Palette> for GridlineTokens {
    fn from(palette: &Palette) -> Self {
        Self {
            canvas: palette.bg,
            surface: palette.panel,
            raised: palette.elevated,
            element: palette.element,
            selected: palette.selection_bg,
            text: palette.fg,
            text_subtle: palette.code_fg,
            muted: palette.dim,
            code: palette.code_fg,
            gutter: palette.gutter,
            rule_subtle: palette.border_subtle,
            rule: palette.border,
            focus: palette.border_focused,
            accent: palette.accent,
            info: palette.comment,
            positive: palette.added,
            warning: palette.warning,
            negative: palette.removed,
            added_surface: palette.added_bg,
            removed_surface: palette.removed_bg,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Neutral,
    Accent,
    Info,
    Positive,
    Warning,
    Negative,
}

impl GridlineTokens {
    pub fn tone(self, tone: Tone) -> Color {
        match tone {
            Tone::Neutral => self.text_subtle,
            Tone::Accent => self.accent,
            Tone::Info => self.info,
            Tone::Positive => self.positive,
            Tone::Warning => self.warning,
            Tone::Negative => self.negative,
        }
    }
}

/// Geometry tokens for the dense shell. One cell is the smallest meaningful
/// spacing unit in a terminal, so these values intentionally stay conservative.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GridlineMetrics {
    pub compact_pad: u16,
    pub inline_pad: u16,
    pub section_gap: u16,
    pub header_height: u16,
    pub status_height: u16,
    pub modal_margin_x: u16,
    pub modal_margin_y: u16,
    pub sidebar_min_width: u16,
    pub content_min_width: u16,
    pub review_width: u16,
}

pub const METRICS: GridlineMetrics = GridlineMetrics {
    compact_pad: 1,
    inline_pad: 2,
    section_gap: 1,
    header_height: 3,
    status_height: 1,
    modal_margin_x: 4,
    modal_margin_y: 2,
    sidebar_min_width: 22,
    content_min_width: 42,
    review_width: 38,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GridlineGlyphs {
    pub focus_rail: &'static str,
    pub cursor: &'static str,
    pub vertical_rule: &'static str,
    pub horizontal_rule: &'static str,
    pub bullet: &'static str,
    pub resolved: &'static str,
}

pub const GLYPHS: GridlineGlyphs = GridlineGlyphs {
    focus_rail: "▌",
    cursor: "›",
    vertical_rule: "│",
    horizontal_rule: "─",
    bullet: "●",
    resolved: "○",
};

pub fn square_block<'a>(title: impl Into<Line<'a>>, palette: &Palette, focused: bool) -> Block<'a> {
    let tokens = GridlineTokens::from(palette);
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(Style::default().fg(tokens.rule_subtle))
        .title_style(
            Style::default()
                .fg(if focused { tokens.focus } else { tokens.text })
                .add_modifier(if focused {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
        )
        .style(Style::default().bg(tokens.surface))
        .title(title.into())
}

pub fn overlay_block<'a>(title: impl Into<Line<'a>>, palette: &Palette) -> Block<'a> {
    let tokens = GridlineTokens::from(palette);
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(Style::default().fg(tokens.rule))
        .title_style(
            Style::default()
                .fg(tokens.text)
                .add_modifier(Modifier::BOLD),
        )
        .style(Style::default().bg(tokens.raised))
        .title(title.into())
}

pub fn field_block<'a>(title: impl Into<Line<'a>>, palette: &Palette, focused: bool) -> Block<'a> {
    let tokens = GridlineTokens::from(palette);
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(Style::default().fg(tokens.rule_subtle))
        .title_style(
            Style::default()
                .fg(if focused {
                    tokens.focus
                } else {
                    tokens.text_subtle
                })
                .add_modifier(if focused {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
        )
        .style(Style::default().bg(tokens.raised))
        .title(title.into())
}

pub fn focus_rail(area: Rect, focused: bool, palette: &Palette, buf: &mut Buffer) {
    if !focused || area.width == 0 || area.height < 3 {
        return;
    }
    let tokens = GridlineTokens::from(palette);
    for y in area.y.saturating_add(1)..area.y.saturating_add(area.height).saturating_sub(1) {
        buf[(area.x, y)]
            .set_symbol(GLYPHS.focus_rail)
            .set_style(Style::default().fg(tokens.focus).bg(tokens.surface));
    }
}

pub fn selection_marker(selected: bool, focused: bool, palette: &Palette) -> Span<'static> {
    let tokens = GridlineTokens::from(palette);
    Span::styled(
        if selected {
            GLYPHS.focus_rail.to_string()
        } else {
            " ".to_string()
        },
        Style::default().fg(if selected && focused {
            tokens.focus
        } else {
            tokens.rule_subtle
        }),
    )
}

pub fn selected_row_style(selected: bool, palette: &Palette) -> Style {
    let tokens = GridlineTokens::from(palette);
    Style::default().fg(tokens.text).bg(if selected {
        tokens.selected
    } else {
        tokens.surface
    })
}

/// Style a command hint such as `jk move · / search` using one shared
/// key/description grammar across the status bar and modal footers.
pub fn hint_line(hint: &str, background: Color, palette: &Palette) -> Line<'static> {
    let tokens = GridlineTokens::from(palette);
    let key = Style::default()
        .fg(tokens.text)
        .bg(background)
        .add_modifier(Modifier::BOLD);
    let description = Style::default().fg(tokens.muted).bg(background);
    let separator = Style::default().fg(tokens.rule).bg(background);
    let mut spans = Vec::new();
    for (index, section) in hint.split(" · ").enumerate() {
        if index > 0 {
            spans.push(Span::styled("  ·  ".to_string(), separator));
        }
        if let Some((binding, label)) = section.split_once(' ') {
            spans.push(Span::styled(binding.to_string(), key));
            spans.push(Span::styled(format!(" {label}"), description));
        } else {
            spans.push(Span::styled(section.to_string(), description));
        }
    }
    Line::from(spans)
}

/// Turn the keymap's plain-text help contract into a styled, scan-friendly
/// reference without duplicating the bindings in the renderer.
pub fn shortcut_help(source: &str, palette: &Palette) -> Text<'static> {
    let tokens = GridlineTokens::from(palette);
    let heading = Style::default()
        .fg(tokens.accent)
        .bg(tokens.raised)
        .add_modifier(Modifier::BOLD);
    let key = Style::default()
        .fg(tokens.text)
        .bg(tokens.raised)
        .add_modifier(Modifier::BOLD);
    let description = Style::default().fg(tokens.text_subtle).bg(tokens.raised);
    let mut lines = Vec::new();
    for source_line in source.lines() {
        if source_line.is_empty() {
            lines.push(Line::default());
            continue;
        }
        if !source_line.starts_with(char::is_whitespace) {
            lines.push(Line::from(Span::styled(source_line.to_string(), heading)));
            continue;
        }
        let trimmed = source_line.trim_start();
        let split = trimmed
            .match_indices("  ")
            .find(|(index, _)| *index > 0)
            .map(|(index, _)| index);
        let (binding, label) = match split {
            Some(index) => (trimmed[..index].trim_end(), trimmed[index..].trim_start()),
            None => (trimmed, ""),
        };
        lines.push(Line::from(vec![
            Span::styled(format!("  {binding:<16}"), key),
            Span::styled(label.to_string(), description),
        ]));
    }
    Text::from(lines)
}

pub fn shortcut_help_columns(
    source: &str,
    column_width: usize,
    palette: &Palette,
) -> Text<'static> {
    let sections: Vec<&str> = source.split("\n\n").collect();
    if sections.len() < 2 {
        return shortcut_help(source, palette);
    }
    let split = sections.len().div_ceil(2);
    let left = shortcut_help(&sections[..split].join("\n\n"), palette);
    let right = shortcut_help(&sections[split..].join("\n\n"), palette);
    let tokens = GridlineTokens::from(palette);
    let rows = left.lines.len().max(right.lines.len());
    let mut lines = Vec::with_capacity(rows);
    for index in 0..rows {
        let mut spans = left
            .lines
            .get(index)
            .map(|line| line.spans.clone())
            .unwrap_or_default();
        let used = spans
            .iter()
            .map(|span| span.content.chars().count())
            .sum::<usize>();
        spans.push(Span::styled(
            " ".repeat(column_width.saturating_sub(used).saturating_add(2)),
            Style::default().bg(tokens.raised),
        ));
        if let Some(line) = right.lines.get(index) {
            spans.extend(line.spans.clone());
        }
        lines.push(Line::from(spans));
    }
    Text::from(lines)
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
            .set_symbol(GLYPHS.horizontal_rule)
            .set_style(Style::default().fg(tokens.rule_subtle).bg(tokens.canvas));
    }
}

pub fn vertical_rule(area: Rect, palette: &Palette, background: Color, buf: &mut Buffer) {
    let tokens = GridlineTokens::from(palette);
    for y in area.y..area.y.saturating_add(area.height) {
        buf[(area.x, y)]
            .set_symbol(GLYPHS.vertical_rule)
            .set_style(Style::default().fg(tokens.rule_subtle).bg(background));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_blocks_use_square_terminal_corners() {
        let palette = Palette::default();
        let area = Rect::new(0, 0, 12, 3);
        use ratatui::widgets::Widget;
        for block in [
            square_block(" files ", &palette, false),
            overlay_block(" settings ", &palette),
            field_block(" general ", &palette, true),
        ] {
            let mut buffer = Buffer::empty(area);
            block.render(area, &mut buffer);
            assert_eq!(buffer[(0, 0)].symbol(), "┌");
            assert_eq!(buffer[(11, 0)].symbol(), "┐");
            assert_eq!(buffer[(0, 2)].symbol(), "└");
            assert_eq!(buffer[(11, 2)].symbol(), "┘");
        }
    }

    #[test]
    fn semantic_tokens_map_feedback_without_overloading_warning() {
        let palette = Palette::default();
        let tokens = GridlineTokens::from(&palette);
        assert_eq!(tokens.info, palette.comment);
        assert_eq!(tokens.warning, palette.warning);
        assert_eq!(tokens.positive, palette.added);
        assert_eq!(tokens.negative, palette.removed);
        assert_ne!(tokens.rule_subtle, tokens.focus);
    }

    #[test]
    fn hint_grammar_emphasizes_keys_and_recedes_descriptions() {
        let palette = Palette::default();
        let line = hint_line("jk move · / search", palette.bg, &palette);
        assert_eq!(line.spans[0].content.as_ref(), "jk");
        assert!(line.spans[0].style.add_modifier.contains(Modifier::BOLD));
        assert_eq!(line.spans[1].style.fg, Some(palette.dim));
    }

    #[test]
    fn shortcut_help_distinguishes_sections_keys_and_descriptions() {
        let palette = Palette::default();
        let text = shortcut_help("NAVIGATION\n  j/k            move", &palette);
        assert_eq!(text.lines[0].spans[0].style.fg, Some(palette.accent));
        assert!(text.lines[1].spans[0]
            .style
            .add_modifier
            .contains(Modifier::BOLD));
        assert_eq!(text.lines[1].spans[1].style.fg, Some(palette.code_fg));
    }

    #[test]
    fn shortcut_columns_reduce_long_help_without_losing_sections() {
        let palette = Palette::default();
        let source = "ONE\n  a              first\n\nTWO\n  b              second\n\nTHREE\n  c              third\n\nFOUR\n  d              fourth";
        let single = shortcut_help(source, &palette);
        let columns = shortcut_help_columns(source, 32, &palette);
        assert!(columns.lines.len() < single.lines.len());
        let rendered = columns
            .lines
            .iter()
            .flat_map(|line| line.spans.iter())
            .map(|span| span.content.as_ref())
            .collect::<String>();
        for heading in ["ONE", "TWO", "THREE", "FOUR"] {
            assert!(rendered.contains(heading));
        }
    }
}
