//! Bottom command strip. Keys stay legible; descriptions and counters recede.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::themes::Palette;
use crate::ui::gridline::{hint_line, GridlineTokens};

pub struct StatusBarContext<'a> {
    pub mode: &'a str,
    pub current_file: Option<&'a str>,
    pub file_idx: usize,
    pub file_count: usize,
    pub hint: &'a str,
}

pub fn render_status_bar(
    area: Rect,
    context: StatusBarContext<'_>,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let tokens = GridlineTokens::from(palette);
    let bg = Style::default().bg(tokens.canvas);
    // Clear the row.
    for x in area.x..area.x + area.width {
        let cell = &mut buf[(x, area.y)];
        cell.set_symbol(" ");
        cell.set_style(bg);
    }
    let dim = Style::default().fg(tokens.muted).bg(tokens.canvas);
    let accent = Style::default()
        .fg(tokens.focus)
        .bg(tokens.selected)
        .add_modifier(Modifier::BOLD);
    let file_style = Style::default().fg(tokens.text_subtle);
    let mut context_spans: Vec<Span<'static>> = Vec::new();
    if !context.mode.is_empty() {
        context_spans.push(Span::styled(
            format!(" {} ", context.mode.to_ascii_lowercase()),
            accent,
        ));
        context_spans.push(Span::styled("  ".to_string(), bg));
    }
    if let Some(file) = context.current_file {
        context_spans.push(Span::styled(file.to_string(), file_style.bg(tokens.canvas)));
        context_spans.push(Span::styled(
            format!(" · {}/{}", context.file_idx + 1, context.file_count.max(1)),
            dim,
        ));
    }
    let context_line = Line::from(context_spans);
    let context_width = context_line
        .spans
        .iter()
        .map(|span| span.content.chars().count() as u16)
        .sum::<u16>();
    let hint_line = styled_hint(context.hint, palette);
    let hint_width = hint_line
        .spans
        .iter()
        .map(|span| span.content.chars().count() as u16)
        .sum::<u16>();

    if context.mode.is_empty() {
        write_line(area.x + 1, area, &hint_line, buf);
        if context_width + hint_width + 4 < area.width {
            write_line(
                area.x + area.width - context_width - 1,
                area,
                &context_line,
                buf,
            );
        }
    } else {
        write_line(area.x, area, &context_line, buf);
        if context_width + hint_width + 3 < area.width {
            write_line(area.x + area.width - hint_width - 1, area, &hint_line, buf);
        }
    }
}

fn styled_hint(hint: &str, palette: &Palette) -> Line<'static> {
    hint_line(hint, GridlineTokens::from(palette).canvas, palette)
}

fn write_line(x: u16, area: Rect, line: &Line<'_>, buf: &mut Buffer) {
    let mut cursor = x;
    for span in &line.spans {
        for character in span.content.chars() {
            if cursor >= area.x + area.width {
                return;
            }
            buf[(cursor, area.y)]
                .set_char(character)
                .set_style(span.style);
            cursor += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::buffer::Buffer;

    #[test]
    fn renders_without_panicking() {
        let area = Rect::new(0, 0, 80, 1);
        let mut buf = Buffer::empty(area);
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        render_status_bar(
            area,
            StatusBarContext {
                mode: "NORMAL",
                current_file: Some("src/a.rs"),
                file_idx: 0,
                file_count: 3,
                hint: "j/k move",
            },
            &palette,
            &mut buf,
        );
        // No assertions beyond "didn't panic"; visual output is the contract.
    }

    #[test]
    fn viewer_strip_keeps_key_bindings_brighter_than_descriptions() {
        let palette = Palette::for_theme(crate::themes::ThemeName::GithubDark);
        let line = styled_hint("jk move · / search", &palette);
        assert_eq!(line.spans[0].content.as_ref(), "jk");
        assert_eq!(line.spans[0].style.fg, Some(palette.fg));
        assert!(line.spans[0].style.add_modifier.contains(Modifier::BOLD));
        assert_eq!(line.spans[1].style.fg, Some(palette.dim));
    }

    #[test]
    fn mode_uses_the_shared_selected_surface() {
        let area = Rect::new(0, 0, 40, 1);
        let palette = Palette::default();
        let mut buffer = Buffer::empty(area);
        render_status_bar(
            area,
            StatusBarContext {
                mode: "SEARCH",
                current_file: None,
                file_idx: 0,
                file_count: 0,
                hint: "Esc close",
            },
            &palette,
            &mut buffer,
        );
        assert_eq!(buffer[(0, 0)].style().bg, Some(palette.selection_bg));
        assert_eq!(buffer[(1, 0)].style().fg, Some(palette.border_focused));
    }
}
