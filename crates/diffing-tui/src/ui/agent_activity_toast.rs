//! Dismissable bottom-of-screen toast for fresh agent activity. Shown
//! when the notify watcher detects a new comment, reply, or status
//! change on disk (e.g., the agent unblocked, the agent replied). The
//! toast auto-dismisses after a few seconds OR when the user presses
//! the dismiss key.

use std::time::{Duration, Instant};

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};

use crate::themes::Palette;
use crate::ui::gridline::{fill, GridlineTokens, Tone, GLYPHS};

#[derive(Debug, Clone)]
pub struct Toast {
    pub message: String,
    pub accent: ToastAccent,
    pub created_at: Instant,
    pub ttl: Duration,
    #[allow(dead_code)]
    pub dismissed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastAccent {
    Info,
    Success,
    #[allow(dead_code)]
    Warn,
}

impl Toast {
    pub fn info(msg: impl Into<String>) -> Self {
        Self::new(msg, ToastAccent::Info, Duration::from_secs(4))
    }
    pub fn success(msg: impl Into<String>) -> Self {
        Self::new(msg, ToastAccent::Success, Duration::from_secs(4))
    }
    #[allow(dead_code)]
    pub fn warn(msg: impl Into<String>) -> Self {
        Self::new(msg, ToastAccent::Warn, Duration::from_secs(6))
    }
    fn new(msg: impl Into<String>, accent: ToastAccent, ttl: Duration) -> Self {
        Self {
            message: msg.into(),
            accent,
            created_at: Instant::now(),
            ttl,
            dismissed: false,
        }
    }
    pub fn is_expired(&self) -> bool {
        self.created_at.elapsed() >= self.ttl
    }
}

pub fn render_toast(toast: &Toast, area: Rect, palette: &Palette, buf: &mut Buffer) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let tokens = GridlineTokens::from(palette);
    let tone = match toast.accent {
        ToastAccent::Info => Tone::Info,
        ToastAccent::Success => Tone::Positive,
        ToastAccent::Warn => Tone::Warning,
    };
    let accent = tokens.tone(tone);
    fill(area, tokens.raised, buf);
    buf[(area.x, area.y)]
        .set_symbol(GLYPHS.focus_rail)
        .set_style(Style::default().fg(accent).bg(tokens.raised));
    if area.width > 2 {
        buf.set_string(
            area.x + 2,
            area.y,
            GLYPHS.bullet,
            Style::default().fg(accent).bg(tokens.raised),
        );
    }
    if area.width > 4 {
        let message: String = toast
            .message
            .chars()
            .take(area.width.saturating_sub(5) as usize)
            .collect();
        buf.set_string(
            area.x + 4,
            area.y,
            message,
            Style::default()
                .fg(tokens.text)
                .bg(tokens.raised)
                .add_modifier(Modifier::BOLD),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_toast_has_default_ttl() {
        let t = Toast::info("hi");
        assert_eq!(t.accent, ToastAccent::Info);
        assert!(!t.is_expired());
    }

    #[test]
    fn warn_toast_uses_warn_accent() {
        let t = Toast::warn("careful");
        assert_eq!(t.accent, ToastAccent::Warn);
    }

    #[test]
    fn compact_toast_keeps_content_on_a_single_row() {
        let area = Rect::new(0, 0, 24, 1);
        let palette = Palette::default();
        let mut buffer = Buffer::empty(area);
        render_toast(&Toast::success("review sent"), area, &palette, &mut buffer);
        assert_eq!(buffer[(0, 0)].symbol(), GLYPHS.focus_rail);
        assert_eq!(buffer[(2, 0)].symbol(), GLYPHS.bullet);
        assert_eq!(buffer[(4, 0)].symbol(), "r");
        assert_eq!(buffer[(0, 0)].style().fg, Some(palette.added));
    }
}
