//! Bottom status bar: mode + current file + counters + keymap hints.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::themes::Palette;

pub fn render_status_bar(
    area: Rect,
    mode: &str,
    current_file: Option<&str>,
    file_idx: usize,
    file_count: usize,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let bg = Style::default().bg(palette.status_bar_bg);
    // Clear the row.
    for x in area.x..area.x + area.width {
        let cell = &mut buf[(x, area.y)];
        cell.set_symbol(" ");
        cell.set_style(bg);
    }
    let dim = Style::default().fg(palette.dim);
    let accent = Style::default()
        .fg(palette.accent)
        .add_modifier(Modifier::BOLD);
    let file_style = Style::default().fg(palette.fg);
    let mut spans: Vec<Span<'static>> = vec![
        Span::styled("─".to_string(), dim),
        Span::styled(" ".to_string(), bg),
        Span::styled(format!(" {} ", mode), accent),
        Span::styled(" ".to_string(), bg),
    ];
    if let Some(f) = current_file {
        spans.push(Span::styled(f.to_string(), file_style));
    } else {
        spans.push(Span::styled("(no file)", dim));
    }
    spans.push(Span::styled(" ".to_string(), bg));
    spans.push(Span::styled(
        format!("  {}/{}", file_idx + 1, file_count.max(1)),
        dim,
    ));
    spans.push(Span::styled(" ".to_string(), bg));
    // Keymap hint.
    let hint = "  j/k:scroll  J/K:file  Tab:focus  w:wrap  ?:help  q:quit";
    spans.push(Span::styled(hint.to_string(), dim));

    let line = Line::from(spans);
    let mut cx = area.x;
    for span in &line.spans {
        for ch in span.content.as_ref().chars() {
            if cx >= area.x + area.width {
                return;
            }
            let cell = &mut buf[(cx, area.y)];
            cell.set_symbol(&ch.to_string());
            cell.set_style(span.style);
            cx += 1;
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
        render_status_bar(area, "NORMAL", Some("src/a.rs"), 0, 3, &palette, &mut buf);
        // No assertions beyond "didn't panic"; visual output is the contract.
    }
}
