//! Bottom command strip. Keys stay legible; descriptions and counters recede.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use unicode_width::UnicodeWidthStr;

use crate::themes::Palette;
use crate::ui::gridline::{hint_line, safe_terminal_text, tail_ellipsize, GridlineTokens};

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
    let accent = Style::default()
        .fg(tokens.focus)
        .bg(tokens.selected)
        .add_modifier(Modifier::BOLD);
    let file_style = Style::default().fg(tokens.text_subtle);
    let mut mode_spans: Vec<Span<'static>> = Vec::new();
    if !context.mode.is_empty() {
        mode_spans.push(Span::styled(
            format!(" {} ", context.mode.to_ascii_lowercase()),
            accent,
        ));
    }
    let mode_line = Line::from(mode_spans);
    let mode_width = line_width(&mode_line);
    let hint_line = styled_hint(context.hint, palette);
    let hint_width = line_width(&hint_line);
    let location = context.current_file.map(|file| {
        let position = if context.file_count == 0 {
            "0/0".to_string()
        } else {
            format!(
                "{}/{}",
                context.file_idx.min(context.file_count - 1) + 1,
                context.file_count
            )
        };
        format!("{} · {position}", safe_terminal_text(file))
    });

    if context.mode.is_empty() {
        let content_width = area.width.saturating_sub(2);
        let location_width = location.as_deref().map(UnicodeWidthStr::width).unwrap_or(0) as u16;
        let show_full_location =
            hint_width.saturating_add(location_width).saturating_add(2) <= content_width;
        let location_budget = if location.is_some() && !show_full_location && content_width >= 28 {
            (content_width / 3).max(10)
        } else if show_full_location {
            location_width
        } else {
            0
        };
        let hint_budget = content_width.saturating_sub(if location_budget > 0 {
            location_budget.saturating_add(2)
        } else {
            0
        });
        write_line_clipped(area.x + 1, area, &hint_line, hint_budget, buf);
        if let Some(location) = location.filter(|_| location_budget > 0) {
            let location = tail_ellipsize(&location, location_budget as usize);
            let line = Line::from(Span::styled(location, file_style.bg(tokens.canvas)));
            let width = line_width(&line);
            write_line_clipped(
                area.x + area.width.saturating_sub(width + 1),
                area,
                &line,
                location_budget,
                buf,
            );
        }
    } else {
        write_line_clipped(area.x, area, &mode_line, mode_width, buf);
        let remaining = area.width.saturating_sub(mode_width.saturating_add(1));
        let hint_budget = hint_width.min(remaining);
        let hint_x = area.x + area.width.saturating_sub(hint_budget + 1);
        write_line_clipped(hint_x, area, &hint_line, hint_budget, buf);

        let location_x = area.x.saturating_add(mode_width).saturating_add(2);
        let location_budget = hint_x.saturating_sub(location_x.saturating_add(2));
        if let Some(location) = location.filter(|_| location_budget >= 8) {
            let location = tail_ellipsize(&location, location_budget as usize);
            write_line_clipped(
                location_x,
                area,
                &Line::from(Span::styled(location, file_style.bg(tokens.canvas))),
                location_budget,
                buf,
            );
        }
    }
}

fn styled_hint(hint: &str, palette: &Palette) -> Line<'static> {
    hint_line(
        &safe_terminal_text(hint),
        GridlineTokens::from(palette).canvas,
        palette,
    )
}

fn line_width(line: &Line<'_>) -> u16 {
    line.spans
        .iter()
        .map(|span| UnicodeWidthStr::width(span.content.as_ref()) as u16)
        .sum()
}

fn write_line_clipped(x: u16, area: Rect, line: &Line<'_>, max_width: u16, buf: &mut Buffer) {
    let mut cursor = x;
    let mut budget = max_width;
    for span in &line.spans {
        let remaining = area
            .x
            .saturating_add(area.width)
            .saturating_sub(cursor)
            .min(budget);
        if remaining == 0 {
            return;
        }
        buf.set_stringn(
            cursor,
            area.y,
            span.content.as_ref(),
            remaining as usize,
            span.style,
        );
        let used = UnicodeWidthStr::width(span.content.as_ref()).min(remaining as usize) as u16;
        cursor = cursor.saturating_add(used);
        budget = budget.saturating_sub(used);
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

    #[test]
    fn review_strip_keeps_commands_visible_with_a_long_location() {
        let area = Rect::new(0, 0, 52, 1);
        let palette = Palette::default();
        let mut buffer = Buffer::empty(area);
        render_status_bar(
            area,
            StatusBarContext {
                mode: "NORMAL",
                current_file: Some("crates/diffing-tui/src/a-very-long-file-name.rs:128"),
                file_idx: 8,
                file_count: 12,
                hint: "c comment · / search",
            },
            &palette,
            &mut buffer,
        );
        let rendered = (0..area.width)
            .map(|x| buffer[(x, 0)].symbol())
            .collect::<String>();
        assert!(rendered.contains("c comment"));
        assert!(rendered.contains("/ search"));
    }

    #[test]
    fn tail_ellipsis_preserves_the_actionable_end_of_a_path() {
        assert_eq!(
            tail_ellipsize("crates/diffing-tui/src/app.rs:42", 14),
            "…src/app.rs:42"
        );
        assert!(UnicodeWidthStr::width(tail_ellipsize("界面/renderer.rs", 8).as_str()) <= 8);
    }
}
