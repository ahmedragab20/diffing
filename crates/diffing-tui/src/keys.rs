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
    CodeColumnLeft,
    CodeColumnRight,
    NextFile,
    PrevFile,
    NextHunk,
    PrevHunk,
    NextSearch,
    PrevSearch,
    CenterCursor,
    ExpandContext,
    CollapseContext,
    FocusFileTree,
    FocusDiff,
    FocusTracker,
    ToggleSidebar,
    ToggleWrap,
    ToggleLineNumbers,
    ToggleLayout,
    OpenImagePreview,
    OpenHelp,
    OpenSearch,
    OpenFileFilter,
    OpenSymbolSearch,
    CycleFileFilter,
    OpenCommand,
    ToggleViewed,
    OpenThemePicker,
    OpenSettings,
    LanguageHover,
    LanguageDefinition,
    AddComment,
    AddFileComment,
    ToggleVisualSelection,
    EditComment,
    ReplyComment,
    ResolveComment,
    ResolveAllComments,
    DeleteComment,
    NextComment,
    PrevComment,
    OpenCommentThread,
    CycleCommentStatus,
    CycleCommentSeverity,
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
            if key.modifiers.is_empty() && (self.count > 0 || digit != '0') {
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
                ('g', KeyCode::Char('h')) => Some(Action::LanguageHover),
                ('g', KeyCode::Char('d')) => Some(Action::LanguageDefinition),
                ('g', KeyCode::Char('s')) => Some(Action::OpenSymbolSearch),
                ('g', KeyCode::Char('n')) => Some(Action::ToggleLineNumbers),
                (']', KeyCode::Char('h')) => Some(Action::NextHunk),
                ('[', KeyCode::Char('h')) => Some(Action::PrevHunk),
                (']', KeyCode::Char('c')) => Some(Action::NextComment),
                ('[', KeyCode::Char('c')) => Some(Action::PrevComment),
                ('z', KeyCode::Char('z')) => Some(Action::CenterCursor),
                (' ', KeyCode::Char('e')) => Some(Action::ToggleSidebar),
                _ => None,
            };
            if let Some(action) = action {
                return Some(self.command(action));
            }
            self.count = 0;
        }
        match key.code {
            KeyCode::Char(prefix @ ('g' | ']' | '[' | 'z' | ' ')) if key.modifiers.is_empty() => {
                self.pending = Some(prefix);
                None
            }
            _ => {
                let action = classify(key);
                if action == Action::Noop {
                    self.clear();
                    None
                } else {
                    Some(self.command(action))
                }
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
            if prefix == ' ' {
                display.push_str("Space");
            } else {
                display.push(prefix);
            }
        }
        display
    }

    pub fn pending_hint(&self) -> Option<&'static str> {
        match self.pending {
            Some('g') => Some("g: top · h: hover · d: definition · s: symbols · n: line numbers"),
            Some(']') => Some("]h: next hunk · ]c: next comment"),
            Some('[') => Some("[h: previous hunk · [c: previous comment"),
            Some('z') => Some("zz: center cursor"),
            Some(' ') => Some("Space e: toggle file sidebar"),
            _ => None,
        }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchSpecialAction {
    ClosePalette,
    UnfocusPreview,
    PeekPreview,
    ClearQuery,
    PageSelectionUp,
}

/// Search-palette keys that differ from normal modal editing (Esc staging, peek, paging).
pub fn classify_search_special(
    key: &KeyEvent,
    preview_focused: bool,
) -> Option<SearchSpecialAction> {
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    let alt = key.modifiers.contains(KeyModifiers::ALT);
    match key.code {
        KeyCode::Esc => Some(if preview_focused {
            SearchSpecialAction::UnfocusPreview
        } else {
            SearchSpecialAction::ClosePalette
        }),
        KeyCode::Enter if alt && !ctrl => Some(SearchSpecialAction::PeekPreview),
        KeyCode::Char('u') if ctrl => Some(SearchSpecialAction::PageSelectionUp),
        KeyCode::Char('l') if ctrl => Some(SearchSpecialAction::ClearQuery),
        _ => None,
    }
}

pub fn classify(key: &KeyEvent) -> Action {
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    let alt = key.modifiers.contains(KeyModifiers::ALT);
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
        KeyCode::Char('b') if !ctrl => Action::ToggleSidebar,
        KeyCode::Char('w') if !ctrl => Action::ToggleWrap,
        KeyCode::Char('#') if !ctrl => Action::ToggleLineNumbers,
        KeyCode::Enter if !ctrl => Action::ExpandContext,
        KeyCode::Char('+' | '=') if !ctrl => Action::ExpandContext,
        KeyCode::Char('-') if !ctrl => Action::CollapseContext,
        KeyCode::Char('?') if !ctrl => Action::OpenHelp,
        KeyCode::Char('/') if !ctrl => Action::OpenSearch,
        KeyCode::Char('f') if !ctrl => Action::OpenFileFilter,
        KeyCode::Char('a') if !ctrl => Action::CycleFileFilter,
        KeyCode::Char(':') if !ctrl => Action::OpenCommand,
        KeyCode::Char('n') if !ctrl => Action::NextSearch,
        KeyCode::Char('N') if !ctrl => Action::PrevSearch,
        KeyCode::Char('m') if !ctrl => Action::ToggleLayout,
        KeyCode::Char('i') if !ctrl => Action::OpenImagePreview,
        KeyCode::Char('v') if !ctrl => Action::ToggleViewed,
        KeyCode::Char('t') if !ctrl => Action::OpenThemePicker,
        KeyCode::Char(',') if !ctrl => Action::OpenSettings,
        KeyCode::Char('c') if !ctrl => Action::AddComment,
        KeyCode::Char('C') if !ctrl => Action::AddFileComment,
        KeyCode::Char('V') if !ctrl => Action::ToggleVisualSelection,
        KeyCode::Char('e') if !ctrl => Action::EditComment,
        KeyCode::Char('r') if !ctrl => Action::ReplyComment,
        KeyCode::Char('x') if !ctrl => Action::ResolveComment,
        KeyCode::Char('X') if !ctrl => Action::ResolveAllComments,
        KeyCode::Char('d') if !ctrl => Action::DeleteComment,
        KeyCode::Char(']') if !ctrl => Action::NextComment,
        KeyCode::Char('[') if !ctrl => Action::PrevComment,
        KeyCode::Char('o') if !ctrl => Action::OpenCommentThread,
        KeyCode::Char('s') if !ctrl => Action::CycleCommentStatus,
        KeyCode::Char('p') if !ctrl => Action::CycleCommentSeverity,
        KeyCode::Char('T') if !ctrl => Action::FocusTracker,
        KeyCode::Char('S') if !ctrl => Action::OpenSendReview,
        KeyCode::Char('h') if alt => Action::CodeColumnLeft,
        KeyCode::Char('l') if alt => Action::CodeColumnRight,
        KeyCode::Char('h') if key.modifiers.is_empty() => Action::ScrollLeft,
        KeyCode::Char('l') if key.modifiers.is_empty() => Action::ScrollRight,
        KeyCode::Tab if ctrl => Action::FocusGeneral,
        KeyCode::BackTab if ctrl => Action::FocusVerdict,
        KeyCode::PageDown => Action::ScrollHalfDown,
        KeyCode::PageUp => Action::ScrollHalfUp,
        KeyCode::Down => Action::ScrollDown,
        KeyCode::Up => Action::ScrollUp,
        KeyCode::Right => Action::ScrollRight,
        KeyCode::Left => Action::ScrollLeft,
        _ => Action::Noop,
    }
}

pub fn help_text() -> &'static str {
    r#"NAVIGATION
  j/k, ↑/↓       row down/up
  {count}j/k     repeat motion
  gg / G         first/last row
  Ctrl-d/u       half page down/up
  J / K          next/previous matching file
  ]h / [h        next/previous hunk
  ]c / [c        next/previous comment
  Enter/+ / -    expand/collapse context
  h / l          horizontal scroll
  Alt-h/l        symbol column left/right
  zz             center cursor

SEARCH · POWERED BY FFF
  / / f / gs     all / files / symbols search (changed-only)
  Tab/Shift-Tab  cycle scope
  Ctrl-g/r       whole repo / text regex
  ↑/↓, Ctrl-n/p  select result
  PgUp/PgDn      page result list
  Shift-↑/↓      scroll preview
  ←/→, Home/End  edit query cursor
  Ctrl-w/l       delete word / clear query
  Ctrl-u/d       page selection up/down (±8)
  Enter          jump to selected match
  Alt-Enter      peek preview (Esc unfocuses first)
  n / N          next/previous result (after close)

REVIEW
  c / C          line / file comment
  V              start/cancel line selection
  o / Enter      open focused thread
  e / r          edit/reply
  x / X          resolve thread / X×2 all (confirm)
  d d            confirm thread deletion
  s / p          filter status/severity
  v              toggle viewed
  S              send review

IMAGE DIFFS
  i              fullscreen image comparison (Esc exits)
  1/2/3/4        before/after/side/difference
  Tab            cycle image view (diff pane, image selected)
  +/- / 0        zoom in/out / fit
  h/j/k/l        pan a zoomed image

LAYOUT & TOOLS
  m              split/unified layout
  a              all/unviewed/commented files
  :              command line
  ,              settings
  # / gn         toggle line numbers (, settings too)
  Space e / b    toggle file sidebar
  t / w          theme / wrap
  Tab/Shift-Tab  cycle pane focus
  mouse          click, resize, map-jump, dismiss
  ?              this help
  q              quit
  Esc            cancel current mode"#
}

pub fn viewer_help_text() -> &'static str {
    r#"DIFF NAVIGATION
  j/k, ↑/↓       line down/up
  {count}j/k     repeat motion
  gg / G         first/last change
  Ctrl-d/u       half page down/up
  J / K          next/previous matching file
  ]h / [h        next/previous hunk
  Enter/+ / -    expand/collapse context
  h / l          horizontal scroll
  zz             center cursor

SEARCH · POWERED BY FFF
  / / f / gs     all / files / symbols search (changed-only)
  Tab/Shift-Tab  cycle scope
  Ctrl-g         include/exclude whole repository
  Ctrl-r         regex in Text scope
  ↑/↓, Ctrl-n/p  select result
  PgUp/PgDn      page result list
  Shift-↑/↓      scroll file preview
  ←/→, Home/End  edit query cursor
  Ctrl-w/l       delete word / clear query
  Ctrl-u/d       page selection up/down (±8)
  Enter          jump when present in diff
  Alt-Enter      peek preview (Esc unfocuses first)
  n / N          next/previous result (after close)

CODE & IMAGES
  e              open line in $EDITOR
  gh / gd        hover / go to definition
  Alt-h/l        symbol column left/right
  i              fullscreen image comparison (Esc exits)
  1/2/3/4        before/after/side/difference
  Tab            cycle image view (diff pane, image selected)
  +/- / 0        zoom in/out / fit
  h/j/k/l        pan a zoomed image

LAYOUT & TOOLS
  m              split/unified diff
  Space e / b    toggle file sidebar
  w              toggle line wrap
  # / gn         toggle line numbers (, settings too)
  t              choose theme
  ,              settings
  Tab/Shift-Tab  cycle pane focus
  mouse          click, resize, map-jump, dismiss
  ?              this help
  q              quit"#
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
    fn image_comparison_has_a_direct_binding() {
        assert_eq!(
            classify(&key(KeyCode::Char('i'), KeyModifiers::NONE)),
            Action::OpenImagePreview
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
    fn b_toggles_the_file_sidebar() {
        assert_eq!(
            classify(&key(KeyCode::Char('b'), KeyModifiers::NONE)),
            Action::ToggleSidebar
        );
    }

    #[test]
    fn space_e_toggles_the_file_sidebar() {
        let mut keymap = Keymap::default();
        assert!(keymap
            .feed(&key(KeyCode::Char(' '), KeyModifiers::NONE))
            .is_none());
        assert_eq!(keymap.pending_display(), "Space");
        assert_eq!(keymap.pending_hint(), Some("Space e: toggle file sidebar"));
        assert_eq!(
            keymap.feed(&key(KeyCode::Char('e'), KeyModifiers::NONE)),
            Some(Command {
                action: Action::ToggleSidebar,
                count: 1,
            })
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
    fn horizontal_arrows_scroll_in_normal_mode() {
        assert_eq!(
            classify(&key(KeyCode::Right, KeyModifiers::NONE)),
            Action::ScrollRight
        );
        assert_eq!(
            classify(&key(KeyCode::Left, KeyModifiers::NONE)),
            Action::ScrollLeft
        );
    }

    #[test]
    fn unrecognized_keys_and_esc_clear_pending_prefix() {
        let mut keymap = Keymap::default();
        assert!(keymap
            .feed(&key(KeyCode::Char('g'), KeyModifiers::NONE))
            .is_none());
        assert_eq!(keymap.pending_display(), "g");
        assert!(keymap
            .feed(&key(KeyCode::Esc, KeyModifiers::NONE))
            .is_none());
        assert!(keymap.pending_display().is_empty());
        assert!(keymap
            .feed(&key(KeyCode::Char('2'), KeyModifiers::NONE))
            .is_none());
        assert!(keymap
            .feed(&key(KeyCode::F(1), KeyModifiers::NONE))
            .is_none());
        assert!(keymap.pending_display().is_empty());
    }

    #[test]
    fn ctrl_digit_does_not_accumulate_count() {
        let mut keymap = Keymap::default();
        assert!(keymap
            .feed(&key(KeyCode::Char('2'), KeyModifiers::CONTROL))
            .is_none());
        assert!(keymap.pending_display().is_empty());
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

    #[test]
    fn pending_sequences_explain_available_completions() {
        let mut keymap = Keymap::default();
        assert!(keymap
            .feed(&key(KeyCode::Char(']'), KeyModifiers::NONE))
            .is_none());
        assert_eq!(
            keymap.pending_hint(),
            Some("]h: next hunk · ]c: next comment")
        );
    }

    #[test]
    fn gs_opens_symbol_search() {
        let mut keymap = Keymap::default();
        assert!(keymap
            .feed(&key(KeyCode::Char('g'), KeyModifiers::NONE))
            .is_none());
        assert_eq!(
            keymap.feed(&key(KeyCode::Char('s'), KeyModifiers::NONE)),
            Some(Command {
                action: Action::OpenSymbolSearch,
                count: 1,
            })
        );
    }

    #[test]
    fn hash_toggles_line_numbers() {
        assert_eq!(
            classify(&key(KeyCode::Char('#'), KeyModifiers::NONE)),
            Action::ToggleLineNumbers
        );
    }

    #[test]
    fn gn_toggles_line_numbers() {
        let mut keymap = Keymap::default();
        assert!(keymap
            .feed(&key(KeyCode::Char('g'), KeyModifiers::NONE))
            .is_none());
        assert_eq!(
            keymap.feed(&key(KeyCode::Char('n'), KeyModifiers::NONE)),
            Some(Command {
                action: Action::ToggleLineNumbers,
                count: 1,
            })
        );
    }

    #[test]
    fn search_special_esc_is_two_stage_when_preview_focused() {
        assert_eq!(
            classify_search_special(&key(KeyCode::Esc, KeyModifiers::NONE), true),
            Some(SearchSpecialAction::UnfocusPreview)
        );
        assert_eq!(
            classify_search_special(&key(KeyCode::Esc, KeyModifiers::NONE), false),
            Some(SearchSpecialAction::ClosePalette)
        );
    }

    #[test]
    fn search_special_ctrl_u_pages_up_and_ctrl_l_clears() {
        assert_eq!(
            classify_search_special(&key(KeyCode::Char('u'), KeyModifiers::CONTROL), false),
            Some(SearchSpecialAction::PageSelectionUp)
        );
        assert_eq!(
            classify_search_special(&key(KeyCode::Char('l'), KeyModifiers::CONTROL), false),
            Some(SearchSpecialAction::ClearQuery)
        );
    }

    #[test]
    fn search_special_alt_enter_peeks_preview() {
        assert_eq!(
            classify_search_special(&key(KeyCode::Enter, KeyModifiers::ALT), false),
            Some(SearchSpecialAction::PeekPreview)
        );
    }

    #[test]
    fn keymap_exposes_language_actions_without_stealing_horizontal_scroll() {
        let mut keymap = Keymap::default();
        assert!(keymap
            .feed(&key(KeyCode::Char('g'), KeyModifiers::NONE))
            .is_none());
        assert_eq!(
            keymap.feed(&key(KeyCode::Char('h'), KeyModifiers::NONE)),
            Some(Command {
                action: Action::LanguageHover,
                count: 1,
            })
        );
        assert!(keymap
            .feed(&key(KeyCode::Char('g'), KeyModifiers::NONE))
            .is_none());
        assert_eq!(
            keymap.feed(&key(KeyCode::Char('d'), KeyModifiers::NONE)),
            Some(Command {
                action: Action::LanguageDefinition,
                count: 1,
            })
        );
        assert_eq!(
            classify(&key(KeyCode::Char('h'), KeyModifiers::NONE)),
            Action::ScrollLeft
        );
        assert_eq!(
            classify(&key(KeyCode::Char('l'), KeyModifiers::ALT)),
            Action::CodeColumnRight
        );
    }
}
