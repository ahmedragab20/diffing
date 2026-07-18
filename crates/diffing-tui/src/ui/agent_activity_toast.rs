//! Dismissable bottom-of-screen toast for fresh agent activity. Shown
//! when the notify watcher detects a new comment, reply, or status
//! change on disk (e.g., the agent unblocked, the agent replied). The
//! toast auto-dismisses after a few seconds OR when the user presses
//! the dismiss key.

use std::time::{Duration, Instant};

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Widget, Wrap};

use crate::themes::Palette;

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
    let border_color = match toast.accent {
        ToastAccent::Info => palette.accent,
        ToastAccent::Success => palette.added,
        ToastAccent::Warn => palette.removed,
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color));
    Paragraph::new(Line::from(Span::styled(
        format!(" {} ", toast.message),
        Style::default().fg(palette.fg).add_modifier(Modifier::BOLD),
    )))
    .wrap(Wrap { trim: false })
    .render(area, buf);
    block.render(area, buf);
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
}
