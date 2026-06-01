use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use diffing_core::comments::{CommentSide, CommentStatus, FileCommentStore, NewComment, ReviewComment};
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Direction, Layout, Rect};

use crate::server_lock::ServerLock;

use crate::handoff::CommentsWatcher;
use crate::keys::{Action, classify};
use crate::themes::{Palette, ThemeName};
use crate::ui::agent_activity_toast::{Toast, render_toast};
use crate::ui::comment_form::{CommentFormState, render_form};
use crate::ui::comment_tracker::{TrackerState, render_tracker};
use crate::ui::file_diff_card::render_card;
use crate::ui::file_tree::FileTree;
use crate::ui::file_tree_render::render_file_tree;
use crate::ui::send_review_popover::{SendField, SendReviewState, build_send_payload, render_send_popover};
use crate::ui::vim_status_bar::render_status_bar;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    FileTree,
    Diff,
    Tracker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Normal,
    CommentForm,
    SendReview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentStatus {
    /// `server.json` exists and the process is alive.
    Waiting,
    /// No agent is currently blocked on `await-review`.
    Idle,
    /// `server.json` exists but the process is dead (stale lock).
    Stale,
}

pub struct App {
    #[allow(dead_code)]
    pub repo_root: PathBuf,
    pub files: Vec<diffing_core::diff::FileDiff>,
    pub file_tree: FileTree,
    pub focus: Focus,
    pub mode: Mode,
    pub wrap: bool,
    pub theme: ThemeName,
    pub palette: Palette,
    pub scroll: usize,
    pub file_tree_scroll: usize,
    pub status_message: Option<String>,
    pub quit: bool,
    pub comments: Vec<ReviewComment>,
    pub comment_store: FileCommentStore,
    pub tracker: TrackerState,
    pub comment_form: Option<CommentFormState>,
    pub send_review: Option<SendReviewState>,
    pub toasts: Vec<Toast>,
    pub agent_status: AgentStatus,
    pub review_round: u32,
    pub last_comment_count: usize,
    #[allow(dead_code)]
    pub watcher: CommentsWatcher,
}

impl App {
    pub fn new(
        repo_root: PathBuf,
        files: Vec<diffing_core::diff::FileDiff>,
    ) -> Result<Self> {
        let file_tree = FileTree::build(&files);
        let theme = ThemeName::default();
        let repo_str = repo_root.to_str().unwrap_or(".");
        let store = FileCommentStore::new(repo_str);
        let comments = store.load().unwrap_or_default();
        let last_comment_count = comments.len();
        let storage_dir = diffing_core::comments::comments_path(repo_str)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| repo_root.clone());
        let watcher = CommentsWatcher::start(&storage_dir)?;
        let agent_status = detect_agent_status(repo_str);
        Ok(Self {
            repo_root,
            files,
            file_tree,
            focus: Focus::Diff,
            mode: Mode::Normal,
            wrap: false,
            theme,
            palette: Palette::for_theme(theme),
            scroll: 0,
            file_tree_scroll: 0,
            status_message: None,
            quit: false,
            tracker: TrackerState::new(),
            comments,
            comment_store: store,
            comment_form: None,
            send_review: None,
            toasts: Vec::new(),
            agent_status,
            review_round: 0,
            last_comment_count,
            watcher,
        })
    }

    pub fn reload_comments(&mut self) {
        match self.comment_store.load() {
            Ok(comments) => {
                let delta = comments.len() as isize - self.last_comment_count as isize;
                if delta > 0 {
                    self.toasts.push(Toast::info(format!(
                        "{} new comment{}",
                        delta,
                        if delta == 1 { "" } else { "s" }
                    )));
                }
                self.comments = comments;
                self.last_comment_count = self.comments.len();
            }
            Err(e) => {
                self.status_message = Some(format!("reload failed: {e}"));
            }
        }
        self.agent_status = detect_agent_status(self.repo_root.to_str().unwrap_or("."));
    }

    pub fn tick_watcher(&mut self) {
        let mut dirty = false;
        while self.watcher.try_recv().is_some() {
            dirty = true;
        }
        if dirty {
            self.reload_comments();
        }
    }

    pub fn handle_key(&mut self, key: crossterm::event::KeyEvent) {
        match self.mode {
            Mode::CommentForm => self.handle_form_key(key),
            Mode::SendReview => self.handle_send_review_key(key),
            Mode::Normal => {
                let action = classify(&key);
                match action {
                    Action::Quit => self.quit = true,
                    Action::Noop => {}
                    Action::OpenSendReview => self.open_send_review(),
                    _ => match self.focus {
                        Focus::FileTree => self.handle_tree_action(action),
                        Focus::Diff => self.handle_diff_action(action),
                        Focus::Tracker => self.handle_tracker_action(action),
                    },
                }
            }
        }
    }

    fn handle_send_review_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::{KeyCode, KeyModifiers};
        if key.code == KeyCode::Esc {
            self.send_review = None;
            self.mode = Mode::Normal;
            self.status_message = Some("send cancelled".to_string());
            return;
        }
        if key.code == KeyCode::Char('s') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.submit_send_review();
            return;
        }
        let Some(sr) = self.send_review.as_mut() else {
            return;
        };
        // Toggle focused field.
        if key.code == KeyCode::Tab || (key.code == KeyCode::BackTab && !key.modifiers.contains(KeyModifiers::CONTROL)) {
            sr.focused = match sr.focused {
                SendField::Verdict => SendField::General,
                SendField::General => SendField::Verdict,
            };
            return;
        }
        if key.code == KeyCode::BackTab && key.modifiers.contains(KeyModifiers::CONTROL) {
            // Ctrl-Tab toggles back; same as Tab here.
            sr.focused = match sr.focused {
                SendField::Verdict => SendField::General,
                SendField::General => SendField::Verdict,
            };
            return;
        }
        // When the verdict is focused, ←/→ cycles the verdict radios.
        if sr.focused == SendField::Verdict {
            if key.code == KeyCode::Right {
                sr.cycle_verdict(1);
                return;
            }
            if key.code == KeyCode::Left {
                sr.cycle_verdict(-1);
                return;
            }
        }
        // Otherwise feed the key to the general-comment textarea.
        if sr.focused == SendField::General {
            sr.general.input(key);
        }
    }

    fn open_send_review(&mut self) {
        self.send_review = Some(SendReviewState::new());
        self.mode = Mode::SendReview;
        self.toasts.push(Toast::info("open send-review popover (Ctrl-S to send, Esc to cancel)"));
    }

    fn submit_send_review(&mut self) {
        let Some(sr) = self.send_review.take() else {
            return;
        };
        self.mode = Mode::Normal;
        self.review_round = self.review_round.saturating_add(1);
        let body = sr.body();
        let verdict = sr.verdict;
        let Some(xml) = build_send_payload(&self.comments, &body, Some(verdict), self.review_round) else {
            self.status_message = Some("nothing to send (no comments, no verdict)".to_string());
            return;
        };
        // 1. Persist the XML next to comments.json.
        let path = crate::ui::send_review_popover::pending_review_path(self.repo_root.to_str().unwrap_or("."));
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&path, &xml) {
            self.status_message = Some(format!("send failed: {e}"));
            return;
        }
        // 2. Update server.json with a pendingReview marker.
        let lock = ServerLock {
            port: 0,
            host: "127.0.0.1".to_string(),
            pid: std::process::id(),
            repo_root: self.repo_root.to_string_lossy().to_string(),
            started_at: now_ms(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            mode: Some("tui".to_string()),
        };
        let _ = crate::server_lock::write_server_lock(
            self.repo_root.to_str().unwrap_or("."),
            &lock,
        );
        // 3. Best-effort clipboard copy.
        let _ = copy_to_clipboard(&xml);
        // 4. Surface a toast and status message.
        self.toasts.push(Toast::success(format!(
            "review sent · {} · xml in pending-review.xml",
            verdict.as_str()
        )));
        self.status_message = Some(format!(
            "review #{} sent ({} cmts, {})",
            self.review_round,
            self.comments.len(),
            verdict.as_str()
        ));
    }

    fn handle_form_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::{KeyCode, KeyModifiers};
        if key.code == KeyCode::Esc {
            self.comment_form = None;
            self.mode = Mode::Normal;
            self.status_message = Some("comment cancelled".to_string());
            return;
        }
        if key.code == KeyCode::Char('s') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.submit_form();
            return;
        }
        if let Some(form) = self.comment_form.as_mut() {
            form.textarea.input(key);
        }
    }

    fn submit_form(&mut self) {
        let Some(form) = self.comment_form.take() else {
            return;
        };
        let body = form.body();
        self.mode = Mode::Normal;
        if body.trim().is_empty() {
            self.status_message = Some("comment empty, discarded".to_string());
            return;
        }
        let now = now_ms();
        let result: Result<()> = match form.kind {
            crate::ui::comment_form::FormKind::New => {
                let file = self.current_file();
                let line = self.current_line();
                let content = self.current_line_content();
                let side = self.current_side();
                let file_path = file
                    .map(|f| f.display_path().to_string_lossy().to_string())
                    .unwrap_or_default();
                self.comment_store
                    .add(
                        NewComment::Inline {
                            file_path: &file_path,
                            side,
                            line_number: line,
                            line_content: &content,
                            body: &body,
                        },
                        now,
                    )
                    .map(|_| ())
            }
            crate::ui::comment_form::FormKind::Edit => {
                let target = self.comments.get(self.tracker.cursor).map(|c| c.id.clone());
                match target {
                    Some(id) => self
                        .comment_store
                        .update(&id, Some(&body), None)
                        .map(|_| ()),
                    None => {
                        self.status_message = Some("no comment selected to edit".to_string());
                        return;
                    }
                }
            }
            crate::ui::comment_form::FormKind::Reply => {
                let target = self.comments.get(self.tracker.cursor).map(|c| c.id.clone());
                match target {
                    Some(id) => self
                        .comment_store
                        .add_reply(&id, &body, Some("user"), None, now)
                        .map(|_| ()),
                    None => {
                        self.status_message = Some("no comment selected to reply to".to_string());
                        return;
                    }
                }
            }
        };
        match result {
            Ok(()) => {
                self.status_message = Some("comment saved".to_string());
                self.reload_comments();
                self.toasts
                    .push(Toast::success("comment saved".to_string()));
            }
            Err(e) => {
                self.status_message = Some(format!("save failed: {e}"));
            }
        }
    }

    fn handle_tree_action(&mut self, action: Action) {
        match action {
            Action::ScrollDown => self.file_tree.move_cursor(1),
            Action::ScrollUp => self.file_tree.move_cursor(-1),
            Action::ScrollTop => self.file_tree.cursor = 0,
            Action::ScrollBottom => {
                self.file_tree.cursor = self.file_tree.nodes.len().saturating_sub(1);
            }
            Action::NextFile => self.jump_to_relative_file(1),
            Action::PrevFile => self.jump_to_relative_file(-1),
            Action::FocusDiff => self.focus = Focus::Diff,
            Action::ToggleViewed => self.file_tree.toggle_viewed(),
            Action::OpenThemePicker => self.cycle_theme(),
            _ => {}
        }
    }

    fn handle_diff_action(&mut self, action: Action) {
        match action {
            Action::ScrollDown => self.scroll = self.scroll.saturating_add(1),
            Action::ScrollUp => self.scroll = self.scroll.saturating_sub(1),
            Action::ScrollHalfDown => self.scroll = self.scroll.saturating_add(10),
            Action::ScrollHalfUp => self.scroll = self.scroll.saturating_sub(10),
            Action::ScrollTop => self.scroll = 0,
            Action::ScrollBottom => {
                self.scroll = usize::MAX;
            }
            Action::NextFile => self.jump_to_relative_file(1),
            Action::PrevFile => self.jump_to_relative_file(-1),
            Action::FocusFileTree => self.focus = Focus::FileTree,
            Action::FocusTracker => self.focus = Focus::Tracker,
            Action::ToggleWrap => self.wrap = !self.wrap,
            Action::ToggleViewed => {
                if let Some(idx) = self.file_tree.selected_file_idx() {
                    if let Some(node) = self
                        .file_tree
                        .nodes
                        .iter_mut()
                        .find(|n| n.file_diff_idx == Some(idx))
                    {
                        node.viewed = !node.viewed;
                    }
                }
            }
            Action::OpenThemePicker => self.cycle_theme(),
            Action::AddComment => self.open_new_comment_form(),
            Action::EditComment => self.open_edit_form_for_focused(),
            Action::ReplyComment => self.open_reply_form_for_focused(),
            Action::ResolveComment => self.resolve_focused(),
            Action::DeleteComment => self.delete_focused(),
            Action::NextComment => self.jump_relative_comment(1),
            Action::PrevComment => self.jump_relative_comment(-1),
            Action::OpenCommentThread => self.focus = Focus::Tracker,
            _ => {}
        }
    }

    fn handle_tracker_action(&mut self, action: Action) {
        match action {
            Action::ScrollDown | Action::NextComment => {
                self.tracker.move_cursor(1, self.comments.len());
            }
            Action::ScrollUp | Action::PrevComment => {
                self.tracker.move_cursor(-1, self.comments.len());
            }
            Action::ScrollTop => self.tracker.cursor = 0,
            Action::ScrollBottom => match self.comments.len() {
                0 => {}
                n => self.tracker.cursor = n - 1,
            },
            Action::FocusDiff => self.focus = Focus::Diff,
            Action::FocusTracker | Action::FocusFileTree => self.focus = Focus::Tracker,
            Action::EditComment => self.open_edit_form_for_focused(),
            Action::ReplyComment => self.open_reply_form_for_focused(),
            Action::ResolveComment => self.resolve_focused(),
            Action::DeleteComment => self.delete_focused(),
            Action::OpenCommentThread => self.jump_to_focused_comment(),
            Action::OpenThemePicker => self.cycle_theme(),
            _ => {}
        }
    }

    fn cycle_theme(&mut self) {
        let all = ThemeName::ALL;
        let cur = self.theme as usize;
        let next = (cur + 1) % all.len();
        self.theme = all[next];
        self.palette = Palette::for_theme(self.theme);
        self.status_message = Some(format!("theme: {}", self.theme.label()));
    }

    fn jump_to_relative_file(&mut self, delta: isize) {
        if self.files.is_empty() {
            return;
        }
        let current = self
            .file_tree
            .selected_file_idx()
            .unwrap_or(0)
            .min(self.files.len() - 1);
        let next = (current as isize + delta).rem_euclid(self.files.len() as isize) as usize;
        self.file_tree.jump_to_file(next);
        self.scroll = 0;
    }

    fn jump_relative_comment(&mut self, delta: isize) {
        if self.comments.is_empty() {
            return;
        }
        let n = self.comments.len() as isize;
        let cur = self.tracker.cursor as isize;
        let next = (cur + delta).rem_euclid(n);
        self.tracker.cursor = next as usize;
        self.jump_to_focused_comment();
    }

    fn jump_to_focused_comment(&mut self) {
        let Some(c) = self.comments.get(self.tracker.cursor).cloned() else {
            return;
        };
        if let Some(file_idx) = self
            .files
            .iter()
            .position(|f| f.display_path() == std::path::Path::new(&c.file_path))
        {
            self.file_tree.jump_to_file(file_idx);
            self.focus = Focus::Diff;
            self.status_message = Some(format!("→ {}:{}", c.file_path, c.line_number));
        } else {
            self.status_message = Some(format!("file not in current diff: {}", c.file_path));
        }
    }

    fn open_new_comment_form(&mut self) {
        let file = self.current_file();
        let line = self.current_line();
        let label = match file {
            Some(f) => format!("new comment · {}:{line}", f.display_path().display()),
            None => "new comment".to_string(),
        };
        self.comment_form = Some(CommentFormState::new(label));
        self.mode = Mode::CommentForm;
    }

    fn open_edit_form_for_focused(&mut self) {
        let Some(c) = self.comments.get(self.tracker.cursor) else {
            self.status_message = Some("no comment focused".to_string());
            return;
        };
        let label = format!("edit · {}:{}", c.file_path, c.line_number);
        let body = c.body.clone();
        self.comment_form = Some(CommentFormState::edit(label, &body));
        self.mode = Mode::CommentForm;
    }

    fn open_reply_form_for_focused(&mut self) {
        let Some(c) = self.comments.get(self.tracker.cursor) else {
            self.status_message = Some("no comment focused".to_string());
            return;
        };
        let label = format!("reply · {}:{}", c.file_path, c.line_number);
        let quoted = c.body.clone();
        self.comment_form = Some(CommentFormState::reply(label, &quoted));
        self.mode = Mode::CommentForm;
    }

    fn resolve_focused(&mut self) {
        let Some(c) = self.comments.get(self.tracker.cursor) else {
            return;
        };
        let id = c.id.clone();
        let next_status = match c.status {
            CommentStatus::Open => CommentStatus::Resolved,
            CommentStatus::Resolved => CommentStatus::Open,
        };
        match self.comment_store.update(&id, None, Some(next_status)) {
            Ok(Some(_)) => {
                self.status_message = Some(format!(
                    "comment {}",
                    if matches!(next_status, CommentStatus::Resolved) { "resolved" } else { "reopened" }
                ));
                self.reload_comments();
            }
            _ => {
                self.status_message = Some("resolve failed".to_string());
            }
        }
    }

    fn delete_focused(&mut self) {
        let Some(c) = self.comments.get(self.tracker.cursor) else {
            return;
        };
        let id = c.id.clone();
        match self.comment_store.remove(&id) {
            Ok(true) => {
                self.status_message = Some("comment deleted".to_string());
                self.reload_comments();
            }
            _ => {
                self.status_message = Some("delete failed".to_string());
            }
        }
    }

    fn current_line(&self) -> u32 {
        if let Some(file) = self.current_file() {
            for h in &file.hunks {
                if let Some(l) = h.lines.first() {
                    return l.old_lineno.or(l.new_lineno).unwrap_or(1);
                }
            }
        }
        1
    }

    fn current_line_content(&self) -> String {
        if let Some(file) = self.current_file() {
            for h in &file.hunks {
                if let Some(l) = h.lines.first() {
                    return l.content.clone();
                }
            }
        }
        String::new()
    }

    fn current_side(&self) -> CommentSide {
        CommentSide::Additions
    }

    fn current_file(&self) -> Option<&diffing_core::diff::FileDiff> {
        let idx = self.file_tree.selected_file_idx()?;
        self.files.get(idx)
    }

    pub fn render(&mut self, area: Rect, buf: &mut Buffer) {
        self.tick_watcher();
        // Expire toasts.
        self.toasts.retain(|t| !t.is_expired());

        let outer = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(0),
                Constraint::Min(5),
                Constraint::Length(6),
                Constraint::Length(1),
            ])
            .split(area);
        let body = outer[1];
        let tracker_area = outer[2];
        let status = outer[3];

        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Length(32), Constraint::Min(20)])
            .split(body);
        self.sync_file_tree_scroll();
        render_file_tree(
            &self.file_tree,
            cols[0],
            matches!(self.focus, Focus::FileTree),
            self.file_tree_scroll,
            &self.palette,
            &self.files,
            buf,
        );
        self.render_diff(cols[1], buf);

        render_tracker(
            &self.comments,
            &mut self.tracker,
            tracker_area,
            &self.palette,
            buf,
        );

        // Agent status indicator in the status line.
        let mode_str = match self.mode {
            Mode::Normal => "NORMAL",
            Mode::CommentForm => "EDIT",
            Mode::SendReview => "SEND",
        };
        let agent_str = match self.agent_status {
            AgentStatus::Waiting => "● agent waiting",
            AgentStatus::Idle => "○ agent idle",
            AgentStatus::Stale => "⚠ agent stale",
        };
        let current = self
            .file_tree
            .selected_file_idx()
            .and_then(|i| self.files.get(i))
            .map(|f| f.display_path().to_string_lossy().to_string());
        let file_idx = self.file_tree.selected_file_idx().unwrap_or(0);
        let file_count = self.files.len();
        let current_label = current.as_deref().unwrap_or("(no file)");
        render_status_bar(
            status,
            mode_str,
            Some(&format!(
                "{current_label} · {}/{} · {}cmts · {agent_str}",
                file_idx + 1,
                file_count,
                self.comments.len()
            )),
            file_idx,
            file_count,
            &self.palette,
            buf,
        );

        // Modals.
        if let Some(form) = self.comment_form.as_mut() {
            render_form(form, area, &self.palette, buf);
        }
        if let Some(sr) = self.send_review.as_mut() {
            render_send_popover(sr, area, &self.palette, &self.comments, &self.files, buf);
        }

        // Toasts: bottom-right overlay.
        if !self.toasts.is_empty() {
            let toast_height = self.toasts.len() as u16;
            let toast_area = Rect {
                x: area.x + area.width.saturating_sub(40),
                y: area.y + area.height.saturating_sub(toast_height + 1),
                width: 38.min(area.width),
                height: toast_height.min(area.height),
            };
            for (i, toast) in self.toasts.iter().rev().take(3).enumerate() {
                let row = Rect {
                    x: toast_area.x,
                    y: toast_area.y + i as u16,
                    width: toast_area.width,
                    height: 1,
                };
                render_toast(toast, row, &self.palette, buf);
            }
        }
    }

    fn render_diff(&mut self, area: Rect, buf: &mut Buffer) {
        for y in area.y..area.y + area.height {
            for x in area.x..area.x + area.width {
                let cell = &mut buf[(x, y)];
                cell.set_symbol(" ");
                cell.set_style(ratatui::style::Style::default().bg(self.palette.bg));
            }
        }
        let Some(idx) = self.file_tree.selected_file_idx() else {
            return;
        };
        let Some(file) = self.files.get(idx) else {
            return;
        };
        let total = crate::ui::file_diff_card::measure_card_rows(file);
        if self.scroll == usize::MAX || self.scroll + area.height as usize > total {
            self.scroll = total.saturating_sub(area.height as usize);
        }
        render_card(file, area, self.scroll, &self.palette, buf);
    }

    fn sync_file_tree_scroll(&mut self) {
        const APPROX_BODY: usize = 20;
        if self.file_tree.cursor < self.file_tree_scroll {
            self.file_tree_scroll = self.file_tree.cursor;
        } else if self.file_tree.cursor >= self.file_tree_scroll + APPROX_BODY {
            self.file_tree_scroll = self.file_tree.cursor + 1 - APPROX_BODY;
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

fn detect_agent_status(repo_root: &str) -> AgentStatus {
    let Some(lock) = crate::server_lock::read_server_lock(repo_root) else {
        return AgentStatus::Idle;
    };
    if !crate::server_lock::is_lock_alive(&lock) {
        return AgentStatus::Stale;
    }
    AgentStatus::Waiting
}

fn copy_to_clipboard(text: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    // Try pbcopy (macOS), then xclip (Linux), then wl-copy (Wayland). On
    // failure we just don't copy — the user can grab it from the disk file.
    for cmd in &["pbcopy", "xclip", "wl-copy"] {
        let argv: &[&str] = match *cmd {
            "pbcopy" => &["pbcopy"],
            "xclip" => &["xclip", "-selection", "clipboard"],
            "wl-copy" => &["wl-copy"],
            _ => continue,
        };
        if let Ok(mut child) = Command::new(argv[0]).args(&argv[1..]).stdin(Stdio::piped()).spawn() {
            if let Some(mut stdin) = child.stdin.take() {
                if stdin.write_all(text.as_bytes()).is_ok() {
                    let _ = stdin.flush();
                    drop(stdin);
                    if child.wait().map(|s| s.success()).unwrap_or(false) {
                        return Ok(());
                    }
                }
            }
        }
    }
        Err(std::io::Error::other(
            "no clipboard tool found (pbcopy / xclip / wl-copy)",
        ))
}

#[allow(dead_code)]
fn _quiet_duration(_: Duration) {}
