//! Vim-style keymap. Centralised so the help modal (`Phase G`) and the
//! event-loop dispatcher stay in sync.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Quit,
    ScrollDown,
    ScrollUp,
    ScrollHalfDown,
    ScrollHalfUp,
    ScrollTop,
    ScrollBottom,
    NextFile,
    PrevFile,
    FocusFileTree,
    FocusDiff,
    FocusTracker,
    ToggleWrap,
    OpenHelp,
    OpenSearch,
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
    ToggleVerdict,
    Noop,
}

pub fn classify(key: &KeyEvent) -> Action {
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    match key.code {
        KeyCode::Char('c') if ctrl => Action::Quit,
        KeyCode::Char('q') if !ctrl => Action::Quit,
        KeyCode::Esc => Action::Quit,
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
        KeyCode::Char('m') if !ctrl => Action::ToggleViewed,
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
        KeyCode::Char('h') if !ctrl => Action::ToggleVerdict,
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
    fn esc_is_quit() {
        assert_eq!(
            classify(&key(KeyCode::Esc, KeyModifiers::NONE)),
            Action::Quit
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
        assert_eq!(classify(&key(KeyCode::Tab, KeyModifiers::NONE)), Action::FocusFileTree);
        assert_eq!(classify(&key(KeyCode::BackTab, KeyModifiers::NONE)), Action::FocusDiff);
    }

    #[test]
    fn capital_s_opens_send_review() {
        assert_eq!(classify(&key(KeyCode::Char('S'), KeyModifiers::NONE)), Action::OpenSendReview);
    }

    #[test]
    fn arrows_cycle_verdict_in_send_popover() {
        // Without a focus arg, classify still returns CycleVerdict for arrows
        // so the popover's verdict radios can use them.
        assert_eq!(classify(&key(KeyCode::Right, KeyModifiers::NONE)), Action::CycleVerdict);
        assert_eq!(classify(&key(KeyCode::Left, KeyModifiers::NONE)), Action::CycleVerdict);
    }
}
