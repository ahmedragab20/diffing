//! Vim-style keymap, centralised so the help modal and event-loop dispatcher
//! stay in sync.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Quit,
    ScrollDown,
    ScrollUp,
    ScrollHalfDown,
    ScrollHalfUp,
    ScrollTop,
    ScrollBottom,
    ScrollLeft,
    ScrollRight,
    NextFile,
    PrevFile,
    NextHunk,
    PrevHunk,
    NextSearch,
    PrevSearch,
    CenterCursor,
    FocusFileTree,
    FocusDiff,
    FocusTracker,
    ToggleWrap,
    ToggleLayout,
    OpenHelp,
    OpenSearch,
    OpenCommand,
    ToggleViewed,
    OpenThemePicker,
    AddComment,
    EditComment,
    ReplyComment,
    ResolveComment,
    DeleteComment,
    NextComment,
    PrevComment,
    OpenCommentThread,
    OpenSendReview,
    CycleVerdict,
    FocusVerdict,
    FocusGeneral,
    Noop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Command {
    pub action: Action,
    pub count: u32,
}

pub struct Keymap {
    pending: Option<char>,
    count: u32,
    updated_at: Instant,
}

impl Default for Keymap {
    fn default() -> Self {
        Self {
            pending: None,
            count: 0,
            updated_at: Instant::now(),
        }
    }
}

impl Keymap {
    pub fn feed(&mut self, key: &KeyEvent) -> Option<Command> {
        if self.updated_at.elapsed() > Duration::from_millis(800) {
            self.clear();
        }
        self.updated_at = Instant::now();
        if let KeyCode::Char(digit @ '0'..='9') = key.code {
            if self.count > 0 || digit != '0' {
                self.count = self
                    .count
                    .saturating_mul(10)
                    .saturating_add(digit.to_digit(10).unwrap_or(0));
                return None;
            }
        }
        if let Some(prefix) = self.pending.take() {
            let action = match (prefix, key.code) {
                ('g', KeyCode::Char('g')) => Some(Action::ScrollTop),
                (']', KeyCode::Char('h')) => Some(Action::NextHunk),
                ('[', KeyCode::Char('h')) => Some(Action::PrevHunk),
                (']', KeyCode::Char('c')) => Some(Action::NextComment),
                ('[', KeyCode::Char('c')) => Some(Action::PrevComment),
                ('z', KeyCode::Char('z')) => Some(Action::CenterCursor),
                _ => None,
            };
            if let Some(action) = action {
                return Some(self.command(action));
            }
            self.count = 0;
        }
        match key.code {
            KeyCode::Char(prefix @ ('g' | ']' | '[' | 'z')) if key.modifiers.is_empty() => {
                self.pending = Some(prefix);
                None
            }
            _ => {
                let action = classify(key);
                (action != Action::Noop).then(|| self.command(action))
            }
        }
    }

    pub fn pending_display(&self) -> String {
        let mut display = if self.count == 0 {
            String::new()
        } else {
            self.count.to_string()
        };
        if let Some(prefix) = self.pending {
            display.push(prefix);
        }
        display
    }

    pub fn clear(&mut self) {
        self.pending = None;
        self.count = 0;
    }

    fn command(&mut self, action: Action) -> Command {
        let command = Command {
            action,
            count: self.count.max(1),
        };
        self.clear();
        command
    }
}

pub fn classify(key: &KeyEvent) -> Action {
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    match key.code {
        KeyCode::Char('c') if ctrl => Action::Quit,
        KeyCode::Char('q') if !ctrl => Action::Quit,
        KeyCode::Esc => Action::Noop,
        KeyCode::Char('j') if !ctrl => Action::ScrollDown,
        KeyCode::Char('k') if !ctrl => Action::ScrollUp,
        KeyCode::Char('d') if ctrl => Action::ScrollHalfDown,
        KeyCode::Char('u') if ctrl => Action::ScrollHalfUp,
        KeyCode::Char('f') if ctrl => Action::ScrollHalfDown,
        KeyCode::Char('b') if ctrl => Action::ScrollHalfUp,
        KeyCode::Char('g') if !ctrl => Action::ScrollTop,
        KeyCode::Char('G') if !ctrl => Action::ScrollBottom,
        KeyCode::Char('J') if !ctrl => Action::NextFile,
        KeyCode::Char('K') if !ctrl => Action::PrevFile,
        KeyCode::Tab if !ctrl => Action::FocusFileTree,
        KeyCode::BackTab if !ctrl => Action::FocusDiff,
        KeyCode::Char('w') if !ctrl => Action::ToggleWrap,
        KeyCode::Char('?') if !ctrl => Action::OpenHelp,
        KeyCode::Char('/') if !ctrl => Action::OpenSearch,
        KeyCode::Char(':') if !ctrl => Action::OpenCommand,
        KeyCode::Char('n') if !ctrl => Action::NextSearch,
        KeyCode::Char('N') if !ctrl => Action::PrevSearch,
        KeyCode::Char('m') if !ctrl => Action::ToggleLayout,
        KeyCode::Char('v') if !ctrl => Action::ToggleViewed,
        KeyCode::Char('t') if !ctrl => Action::OpenThemePicker,
        KeyCode::Char('c') if !ctrl => Action::AddComment,
        KeyCode::Char('e') if !ctrl => Action::EditComment,
        KeyCode::Char('r') if !ctrl => Action::ReplyComment,
        KeyCode::Char('x') if !ctrl => Action::ResolveComment,
        KeyCode::Char('d') if !ctrl => Action::DeleteComment,
        KeyCode::Char(']') if !ctrl => Action::NextComment,
        KeyCode::Char('[') if !ctrl => Action::PrevComment,
        KeyCode::Char('o') if !ctrl => Action::OpenCommentThread,
        KeyCode::Char('T') if !ctrl => Action::FocusTracker,
        KeyCode::Char('S') if !ctrl => Action::OpenSendReview,
        KeyCode::Char('h') if !ctrl => Action::ScrollLeft,
        KeyCode::Char('l') if !ctrl => Action::ScrollRight,
        KeyCode::Tab if ctrl => Action::FocusGeneral,
        KeyCode::BackTab if ctrl => Action::FocusVerdict,
        KeyCode::PageDown => Action::ScrollHalfDown,
        KeyCode::PageUp => Action::ScrollHalfUp,
        KeyCode::Down => Action::ScrollDown,
        KeyCode::Up => Action::ScrollUp,
        KeyCode::Right => Action::CycleVerdict,
        KeyCode::Left => Action::CycleVerdict,
        _ => Action::Noop,
    }
}

pub fn help_text() -> &'static str {
    "NAVIGATION\n  j/k, ↑/↓       row down/up\n  {count}j/k     repeat motion\n  gg / G         first/last row\n  Ctrl-d/u       half page down/up\n  J / K          next/previous file\n  ]h / [h        next/previous hunk\n  ]c / [c        next/previous comment\n  h / l          horizontal scroll\n  zz             center cursor\n\nREVIEW\n  c              comment at cursor\n  e / r          edit/reply\n  x / d          resolve/delete thread\n  v              toggle viewed\n  m              split/unified layout\n  S              send review\n\nTOOLS\n  /              search changed content\n  n / N          next/previous search hit\n  :              command line\n  t / w          theme / wrap\n  Tab / Shift-Tab focus panes\n  ?              this help\n  q              quit\n  Esc            cancel current mode"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    fn key(code: KeyCode, mods: KeyModifiers) -> KeyEvent {
        KeyEvent::new(code, mods)
    }

    #[test]
    fn q_is_quit() {
        assert_eq!(
            classify(&key(KeyCode::Char('q'), KeyModifiers::NONE)),
            Action::Quit
        );
    }

    #[test]
    fn ctrl_c_is_quit() {
        assert_eq!(
            classify(&key(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            Action::Quit
        );
    }

    #[test]
    fn esc_is_not_a_normal_mode_quit() {
        assert_eq!(
            classify(&key(KeyCode::Esc, KeyModifiers::NONE)),
            Action::Noop
        );
    }

    #[test]
    fn j_k_navigate() {
        assert_eq!(
            classify(&key(KeyCode::Char('j'), KeyModifiers::NONE)),
            Action::ScrollDown
        );
        assert_eq!(
            classify(&key(KeyCode::Char('k'), KeyModifiers::NONE)),
            Action::ScrollUp
        );
    }

    #[test]
    #[allow(non_snake_case)]
    fn J_K_jump_files() {
        assert_eq!(
            classify(&key(KeyCode::Char('J'), KeyModifiers::NONE)),
            Action::NextFile
        );
        assert_eq!(
            classify(&key(KeyCode::Char('K'), KeyModifiers::NONE)),
            Action::PrevFile
        );
    }

    #[test]
    fn arrows_navigate() {
        assert_eq!(
            classify(&key(KeyCode::Down, KeyModifiers::NONE)),
            Action::ScrollDown
        );
        assert_eq!(
            classify(&key(KeyCode::Up, KeyModifiers::NONE)),
            Action::ScrollUp
        );
    }

    #[test]
    fn page_keys_half_page() {
        assert_eq!(
            classify(&key(KeyCode::PageDown, KeyModifiers::NONE)),
            Action::ScrollHalfDown
        );
        assert_eq!(
            classify(&key(KeyCode::PageUp, KeyModifiers::NONE)),
            Action::ScrollHalfUp
        );
    }

    #[test]
    fn tab_toggles_focus() {
        assert_eq!(
            classify(&key(KeyCode::Tab, KeyModifiers::NONE)),
            Action::FocusFileTree
        );
        assert_eq!(
            classify(&key(KeyCode::BackTab, KeyModifiers::NONE)),
            Action::FocusDiff
        );
    }

    #[test]
    fn capital_s_opens_send_review() {
        assert_eq!(
            classify(&key(KeyCode::Char('S'), KeyModifiers::NONE)),
            Action::OpenSendReview
        );
    }

    #[test]
    fn arrows_cycle_verdict_in_send_popover() {
        // Without a focus arg, classify still returns CycleVerdict for arrows
        // so the popover's verdict radios can use them.
        assert_eq!(
            classify(&key(KeyCode::Right, KeyModifiers::NONE)),
            Action::CycleVerdict
        );
        assert_eq!(
            classify(&key(KeyCode::Left, KeyModifiers::NONE)),
            Action::CycleVerdict
        );
    }

    #[test]
    fn keymap_supports_counts_and_sequences() {
        let mut keymap = Keymap::default();
        assert!(keymap
            .feed(&key(KeyCode::Char('2'), KeyModifiers::NONE))
            .is_none());
        assert!(keymap
            .feed(&key(KeyCode::Char('5'), KeyModifiers::NONE))
            .is_none());
        assert_eq!(
            keymap.feed(&key(KeyCode::Char('j'), KeyModifiers::NONE)),
            Some(Command {
                action: Action::ScrollDown,
                count: 25
            })
        );
        assert!(keymap
            .feed(&key(KeyCode::Char('g'), KeyModifiers::NONE))
            .is_none());
        assert_eq!(
            keymap.feed(&key(KeyCode::Char('g'), KeyModifiers::NONE)),
            Some(Command {
                action: Action::ScrollTop,
                count: 1
            })
        );
    }
}
