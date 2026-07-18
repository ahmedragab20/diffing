use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;

use anyhow::Result;
use diffing_core::comments::{
    CommentSide, CommentStatus, FileCommentStore, NewComment, ReviewComment,
};
use diffing_core::diff::{ChangeKind, FileDiff};
use diffing_core::index::{
    build_git_diff_index, DiffIndex, IndexedChangeKind, IndexedLineKind, ViewRow,
};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::Span;
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Widget};

use crate::agent_api::AgentApi;
use crate::handoff::{CommentsWatcher, RepoWatcher};
use crate::keys::{help_text, Action, Command, Keymap};
use crate::themes::{Palette, ThemeName};
use crate::ui::agent_activity_toast::{render_toast, Toast};
use crate::ui::comment_form::{render_form, CommentFormState};
use crate::ui::comment_tracker::{render_tracker, TrackerState};
use crate::ui::file_diff_card::render_card;
use crate::ui::file_tree::FileTree;
use crate::ui::file_tree_render::render_file_tree;
use crate::ui::send_review_popover::{
    build_send_payload, render_send_popover, send_review_regions, SendField, SendReviewState,
};
use crate::ui::vim_status_bar::{render_status_bar, StatusBarContext};

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
    Search,
    Command,
    Help,
    ThemePicker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentStatus {
    Waiting,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ToolbarAction {
    ToggleSidebar,
    ToggleLayout,
    ToggleWrap,
    OpenTheme,
    ToggleComments,
    OpenHelp,
    SendReview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DragState {
    Sidebar,
    Comments,
}

#[derive(Default)]
struct UiRegions {
    root: Option<Rect>,
    toolbar: Vec<(Rect, ToolbarAction)>,
    file_tree: Option<Rect>,
    file_rows: Vec<(Rect, usize)>,
    diff: Option<Rect>,
    diff_inner: Option<Rect>,
    comment_panel: Option<Rect>,
    comment_rows: Vec<(Rect, usize)>,
    sidebar_divider: Option<Rect>,
    comment_divider: Option<Rect>,
    theme_rows: Vec<(Rect, ThemeName)>,
}

pub struct App {
    #[allow(dead_code)]
    pub repo_root: PathBuf,
    pub index: Arc<DiffIndex>,
    shared_index: Arc<RwLock<Arc<DiffIndex>>>,
    index_tx: Sender<IndexEvent>,
    index_rx: Receiver<IndexEvent>,
    git_diff_args: Vec<String>,
    indexing: bool,
    reindex_pending: bool,
    pub agent_api: AgentApi,
    pub files: Vec<diffing_core::diff::FileDiff>,
    pub file_tree: FileTree,
    viewed_paths: HashSet<PathBuf>,
    pub focus: Focus,
    pub mode: Mode,
    pub wrap: bool,
    pub split: bool,
    pub theme: ThemeName,
    pub palette: Palette,
    pub scroll: usize,
    pub cursor_row: u64,
    pub viewport_height: usize,
    pub horizontal_offset: usize,
    pub sidebar_width: u16,
    pub comment_height: u16,
    pub sidebar_visible: bool,
    pub comments_visible: bool,
    regions: UiRegions,
    drag: Option<DragState>,
    mouse_position: Option<(u16, u16)>,
    theme_cursor: usize,
    theme_original: ThemeName,
    pub keymap: Keymap,
    pub modal_input: String,
    pub search_hits: Vec<diffing_core::index::SearchHit>,
    pub search_cursor: usize,
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
    #[allow(dead_code)]
    pub repo_watcher: RepoWatcher,
}

enum IndexEvent {
    Snapshot(DiffIndex),
    Failed(String),
}

fn spawn_index_worker(
    repo_root: PathBuf,
    git_diff_args: Vec<String>,
    index_tx: Sender<IndexEvent>,
) -> Result<()> {
    thread::Builder::new()
        .name("diffing-index".to_string())
        .spawn(move || {
            let repo = repo_root.to_string_lossy().into_owned();
            let result = build_git_diff_index(&repo, &git_diff_args, |snapshot| {
                let _ = index_tx.send(IndexEvent::Snapshot(snapshot));
            });
            if let Err(error) = result {
                let _ = index_tx.send(IndexEvent::Failed(error.to_string()));
            }
        })?;
    Ok(())
}

impl App {
    pub fn new(repo_root: PathBuf, git_diff_args: Vec<String>) -> Result<Self> {
        let empty_spool = diffing_core::project_storage_dir(repo_root.to_str().unwrap_or("."))
            .join("diff-index")
            .join("pending.patch");
        let index = Arc::new(DiffIndex::empty(now_ms(), empty_spool, false));
        let shared_index = Arc::new(RwLock::new(index.clone()));
        let (index_tx, index_rx) = mpsc::channel();
        spawn_index_worker(repo_root.clone(), git_diff_args.clone(), index_tx.clone())?;
        let agent_api = AgentApi::start(
            repo_root.to_string_lossy().into_owned(),
            shared_index.clone(),
        )?;
        let files = Vec::new();
        let file_tree = FileTree::build(&files);
        let repo_str = repo_root.to_str().unwrap_or(".");
        let persisted = crate::persistence::load(repo_str);
        let theme = persisted.theme;
        let store = FileCommentStore::new(repo_str);
        let comments = store.load().unwrap_or_default();
        let last_comment_count = comments.len();
        let storage_dir = diffing_core::comments::comments_path(repo_str)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| repo_root.clone());
        std::fs::create_dir_all(&storage_dir)?;
        let watcher = CommentsWatcher::start(&storage_dir)?;
        let repo_watcher = RepoWatcher::start(&repo_root)?;
        let agent_status = AgentStatus::Idle;
        Ok(Self {
            repo_root,
            index,
            shared_index,
            index_tx,
            index_rx,
            git_diff_args,
            indexing: true,
            reindex_pending: false,
            agent_api,
            files,
            file_tree,
            viewed_paths: persisted.viewed_files,
            focus: Focus::Diff,
            mode: Mode::Normal,
            wrap: persisted.wrap,
            split: persisted.split,
            theme,
            palette: Palette::for_theme(theme),
            scroll: 0,
            cursor_row: 0,
            viewport_height: 1,
            horizontal_offset: 0,
            sidebar_width: persisted.sidebar_width,
            comment_height: persisted.comment_height,
            sidebar_visible: persisted.sidebar_visible,
            comments_visible: persisted.comments_visible,
            regions: UiRegions::default(),
            drag: None,
            mouse_position: None,
            theme_cursor: 0,
            theme_original: theme,
            keymap: Keymap::default(),
            modal_input: String::new(),
            search_hits: Vec::new(),
            search_cursor: 0,
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
            repo_watcher,
        })
    }

    pub fn tick_index(&mut self) -> bool {
        let mut newest = None;
        while let Ok(event) = self.index_rx.try_recv() {
            match event {
                IndexEvent::Snapshot(snapshot)
                    if newest
                        .as_ref()
                        .map(|current: &DiffIndex| current.generation <= snapshot.generation)
                        .unwrap_or(true) =>
                {
                    newest = Some(snapshot)
                }
                IndexEvent::Snapshot(_) => {}
                IndexEvent::Failed(error) => {
                    self.status_message = Some(format!("diff index failed: {error}"));
                    self.indexing = false;
                }
            }
        }
        let Some(snapshot) = newest else {
            return false;
        };
        let selected_path = self
            .file_tree
            .selected_file_idx()
            .and_then(|index| self.files.get(index))
            .map(|file| file.display_path().to_path_buf());
        self.files = metadata_files(&snapshot);
        self.file_tree = FileTree::build(&self.files);
        for index in 0..self.files.len() {
            let viewed = self
                .files
                .get(index)
                .map(|file| self.viewed_paths.contains(file.display_path()))
                .unwrap_or(false);
            self.file_tree.set_viewed(index, viewed);
        }
        if let Some(path) = selected_path {
            if let Some(file_index) = self
                .files
                .iter()
                .position(|file| file.display_path() == path)
            {
                self.file_tree.jump_to_file(file_index);
            }
        }
        let complete = snapshot.complete;
        self.index = Arc::new(snapshot);
        if let Ok(mut shared) = self.shared_index.write() {
            *shared = self.index.clone();
        }
        self.clamp_cursor();
        if complete {
            self.indexing = false;
            if self.reindex_pending {
                self.reindex_pending = false;
                self.start_reindex();
            }
        }
        true
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
    }

    pub fn tick_watcher(&mut self) -> bool {
        let mut dirty = false;
        while self.watcher.try_recv().is_some() {
            dirty = true;
        }
        if dirty {
            self.reload_comments();
        }
        dirty
    }

    pub fn poll_background(&mut self) -> bool {
        let repo_dirty = self.tick_repo_watcher();
        self.tick_index() | self.tick_watcher() | repo_dirty
    }

    pub fn has_animations(&self) -> bool {
        !self.toasts.is_empty()
    }

    fn tick_repo_watcher(&mut self) -> bool {
        let mut relevant = false;
        while let Some(event) = self.repo_watcher.try_recv() {
            if let Ok(event) = event {
                relevant |= event.paths.iter().any(|path| relevant_repo_path(path));
            }
        }
        if relevant {
            if self.indexing {
                self.reindex_pending = true;
            } else {
                self.start_reindex();
            }
        }
        relevant
    }

    fn start_reindex(&mut self) {
        match spawn_index_worker(
            self.repo_root.clone(),
            self.git_diff_args.clone(),
            self.index_tx.clone(),
        ) {
            Ok(()) => {
                self.indexing = true;
                self.status_message = Some("refreshing diff index…".to_string());
            }
            Err(error) => {
                self.status_message = Some(format!("could not refresh diff: {error}"));
            }
        }
    }

    pub fn handle_key(&mut self, key: crossterm::event::KeyEvent) {
        match self.mode {
            Mode::CommentForm => self.handle_form_key(key),
            Mode::SendReview => self.handle_send_review_key(key),
            Mode::Search => self.handle_search_key(key),
            Mode::Command => self.handle_command_key(key),
            Mode::ThemePicker => self.handle_theme_picker_key(key),
            Mode::Help => {
                self.mode = Mode::Normal;
                self.keymap.clear();
            }
            Mode::Normal => {
                if let Some(command) = self.keymap.feed(&key) {
                    self.dispatch_command(command);
                }
            }
        }
    }

    pub fn handle_mouse(&mut self, mouse: crossterm::event::MouseEvent) {
        use crossterm::event::{KeyModifiers, MouseButton, MouseEventKind};
        self.mouse_position = Some((mouse.column, mouse.row));

        if self.mode == Mode::ThemePicker {
            match mouse.kind {
                MouseEventKind::ScrollDown => {
                    let len = self.filtered_themes().len();
                    if len > 0 {
                        self.theme_cursor = (self.theme_cursor + 3).min(len - 1);
                        self.preview_theme_at_cursor();
                    }
                }
                MouseEventKind::ScrollUp => {
                    self.theme_cursor = self.theme_cursor.saturating_sub(3);
                    self.preview_theme_at_cursor();
                }
                MouseEventKind::Down(MouseButton::Left) => {
                    if let Some((_, theme)) = self
                        .regions
                        .theme_rows
                        .iter()
                        .find(|(area, _)| contains(*area, mouse.column, mouse.row))
                        .copied()
                    {
                        self.theme = theme;
                        self.palette = Palette::for_theme(theme);
                        self.persist_settings();
                        self.status_message = Some(format!("theme: {}", theme.display_name()));
                        self.mode = Mode::Normal;
                        self.modal_input.clear();
                    }
                }
                _ => {}
            }
            return;
        }

        if self.mode == Mode::Help {
            if matches!(mouse.kind, MouseEventKind::Down(MouseButton::Left)) {
                self.mode = Mode::Normal;
            }
            return;
        }

        if self.mode == Mode::SendReview {
            if self.send_review.is_none() {
                self.mode = Mode::Normal;
                return;
            }
            let Some(root) = self.regions.root else {
                return;
            };
            let regions = send_review_regions(root);
            match mouse.kind {
                MouseEventKind::Down(MouseButton::Left) => {
                    if let Some(decision) = regions
                        .verdict_rows
                        .iter()
                        .find(|(area, _)| contains(*area, mouse.column, mouse.row))
                        .map(|(_, decision)| *decision)
                    {
                        if let Some(state) = self.send_review.as_mut() {
                            state.verdict = decision;
                            state.focused = SendField::Verdict;
                        }
                    } else if contains(regions.general, mouse.column, mouse.row) {
                        if let Some(state) = self.send_review.as_mut() {
                            state.focused = SendField::General;
                        }
                    }
                }
                MouseEventKind::ScrollDown
                    if regions
                        .preview
                        .is_some_and(|area| contains(area, mouse.column, mouse.row)) =>
                {
                    if let Some(state) = self.send_review.as_mut() {
                        state.preview_scroll = state.preview_scroll.saturating_add(3);
                    }
                }
                MouseEventKind::ScrollUp
                    if regions
                        .preview
                        .is_some_and(|area| contains(area, mouse.column, mouse.row)) =>
                {
                    if let Some(state) = self.send_review.as_mut() {
                        state.preview_scroll = state.preview_scroll.saturating_sub(3);
                    }
                }
                _ => {}
            }
            return;
        }

        // Text-entry modals own the pointer; do not let clicks leak through to
        // the diff underneath them.
        if matches!(self.mode, Mode::CommentForm | Mode::Search | Mode::Command) {
            return;
        }

        match mouse.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                if self
                    .regions
                    .sidebar_divider
                    .map(|area| contains(area, mouse.column, mouse.row))
                    .unwrap_or(false)
                {
                    self.drag = Some(DragState::Sidebar);
                    return;
                }
                if self
                    .regions
                    .comment_divider
                    .map(|area| contains(area, mouse.column, mouse.row))
                    .unwrap_or(false)
                {
                    self.drag = Some(DragState::Comments);
                    return;
                }
                if let Some(action) = self
                    .regions
                    .toolbar
                    .iter()
                    .find(|(area, _)| contains(*area, mouse.column, mouse.row))
                    .map(|(_, action)| *action)
                {
                    self.activate_toolbar(action);
                    return;
                }
                if let Some(node) = self
                    .regions
                    .file_rows
                    .iter()
                    .find(|(area, _)| contains(*area, mouse.column, mouse.row))
                    .map(|(_, node)| *node)
                {
                    let previous = self.file_tree.selected_file_idx();
                    self.file_tree.cursor = node;
                    self.focus = Focus::FileTree;
                    if self.file_tree.selected_file_idx().is_none() {
                        self.file_tree.toggle_selected();
                    } else if self.file_tree.selected_file_idx() != previous {
                        self.scroll = 0;
                        self.cursor_row = 0;
                        self.horizontal_offset = 0;
                    }
                    return;
                }
                if let Some((inner, _)) = self
                    .regions
                    .diff_inner
                    .zip(self.regions.diff)
                    .filter(|(inner, _)| contains(*inner, mouse.column, mouse.row))
                {
                    self.focus = Focus::Diff;
                    self.cursor_row = (self.scroll as u64)
                        .saturating_add(mouse.row.saturating_sub(inner.y) as u64)
                        .min(self.current_file_rows().saturating_sub(1));
                    return;
                }
                if let Some(comment) = self
                    .regions
                    .comment_rows
                    .iter()
                    .find(|(area, _)| contains(*area, mouse.column, mouse.row))
                    .map(|(_, comment)| *comment)
                {
                    self.tracker.cursor = comment;
                    self.focus = Focus::Tracker;
                    self.jump_to_focused_comment();
                }
            }
            MouseEventKind::Drag(MouseButton::Left) => match self.drag {
                Some(DragState::Sidebar) => {
                    if let Some(root) = self.regions.root {
                        self.sidebar_width = sidebar_width_for_pointer(root, mouse.column);
                    }
                }
                Some(DragState::Comments) => {
                    if let Some(panel) = self.regions.comment_panel {
                        let bottom = panel.y.saturating_add(panel.height);
                        self.comment_height = bottom
                            .saturating_sub(mouse.row)
                            .saturating_sub(1)
                            .clamp(4, 20);
                    }
                }
                None => {}
            },
            MouseEventKind::Up(MouseButton::Left) => {
                if self.drag.take().is_some() {
                    self.persist_layout();
                }
            }
            MouseEventKind::ScrollDown => {
                if mouse.modifiers.contains(KeyModifiers::SHIFT) {
                    self.horizontal_offset = self.horizontal_offset.saturating_add(4);
                } else if self
                    .regions
                    .file_tree
                    .map(|area| contains(area, mouse.column, mouse.row))
                    .unwrap_or(false)
                {
                    self.focus = Focus::FileTree;
                    self.file_tree.move_cursor(3);
                } else if self
                    .regions
                    .comment_panel
                    .map(|area| contains(area, mouse.column, mouse.row))
                    .unwrap_or(false)
                {
                    self.focus = Focus::Tracker;
                    self.tracker.move_cursor(3, self.comments.len());
                } else {
                    self.focus = Focus::Diff;
                    self.move_diff_cursor(3);
                }
            }
            MouseEventKind::ScrollUp => {
                if mouse.modifiers.contains(KeyModifiers::SHIFT) {
                    self.horizontal_offset = self.horizontal_offset.saturating_sub(4);
                } else if self
                    .regions
                    .file_tree
                    .map(|area| contains(area, mouse.column, mouse.row))
                    .unwrap_or(false)
                {
                    self.focus = Focus::FileTree;
                    self.file_tree.move_cursor(-3);
                } else if self
                    .regions
                    .comment_panel
                    .map(|area| contains(area, mouse.column, mouse.row))
                    .unwrap_or(false)
                {
                    self.focus = Focus::Tracker;
                    self.tracker.move_cursor(-3, self.comments.len());
                } else {
                    self.focus = Focus::Diff;
                    self.move_diff_cursor(-3);
                }
            }
            MouseEventKind::ScrollLeft => {
                self.horizontal_offset = self.horizontal_offset.saturating_sub(4)
            }
            MouseEventKind::ScrollRight => {
                self.horizontal_offset = self.horizontal_offset.saturating_add(4)
            }
            _ => {}
        }
    }

    fn activate_toolbar(&mut self, action: ToolbarAction) {
        match action {
            ToolbarAction::ToggleSidebar => {
                self.sidebar_visible = !self.sidebar_visible;
                self.persist_layout();
            }
            ToolbarAction::ToggleLayout => {
                self.split = !self.split;
                self.persist_settings();
            }
            ToolbarAction::ToggleWrap => {
                self.wrap = !self.wrap;
                self.persist_settings();
            }
            ToolbarAction::OpenTheme => self.open_theme_picker(),
            ToolbarAction::ToggleComments => {
                self.comments_visible = !self.comments_visible;
                self.persist_layout();
            }
            ToolbarAction::OpenHelp => self.mode = Mode::Help,
            ToolbarAction::SendReview => self.open_send_review(),
        }
    }

    fn dispatch_command(&mut self, command: Command) {
        match command.action {
            Action::Quit => self.quit = true,
            Action::OpenSendReview => self.open_send_review(),
            Action::OpenHelp => {
                self.mode = Mode::Help;
                self.modal_input.clear();
            }
            Action::OpenSearch => {
                self.mode = Mode::Search;
                self.modal_input.clear();
            }
            Action::OpenCommand => {
                self.mode = Mode::Command;
                self.modal_input.clear();
            }
            Action::NextSearch => self.jump_search(command.count as isize),
            Action::PrevSearch => self.jump_search(-(command.count as isize)),
            Action::NextHunk => self.jump_relative_hunk(command.count as isize),
            Action::PrevHunk => self.jump_relative_hunk(-(command.count as isize)),
            Action::CenterCursor => {
                self.scroll = self
                    .cursor_row
                    .saturating_sub((self.viewport_height / 2) as u64)
                    as usize;
            }
            Action::ScrollLeft if self.focus == Focus::FileTree => {
                self.file_tree.collapse_selected();
            }
            Action::ScrollRight if self.focus == Focus::FileTree => {
                self.file_tree.expand_selected();
            }
            Action::ScrollLeft => {
                self.horizontal_offset = self
                    .horizontal_offset
                    .saturating_sub(command.count as usize);
            }
            Action::ScrollRight => {
                self.horizontal_offset = self
                    .horizontal_offset
                    .saturating_add(command.count as usize);
            }
            Action::ScrollDown if self.focus == Focus::Diff => {
                self.move_diff_cursor(command.count as isize)
            }
            Action::ScrollUp if self.focus == Focus::Diff => {
                self.move_diff_cursor(-(command.count as isize))
            }
            Action::NextFile => self.jump_to_relative_file(command.count as isize),
            Action::PrevFile => self.jump_to_relative_file(-(command.count as isize)),
            action => {
                for _ in 0..command.count.min(10_000) {
                    match self.focus {
                        Focus::FileTree => self.handle_tree_action(action),
                        Focus::Diff => self.handle_diff_action(action),
                        Focus::Tracker => self.handle_tracker_action(action),
                    }
                }
            }
        }
    }

    fn handle_search_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Esc => {
                self.mode = Mode::Normal;
                self.modal_input.clear();
            }
            KeyCode::Enter => self.execute_search(),
            KeyCode::Backspace => {
                self.modal_input.pop();
            }
            KeyCode::Char(character) => self.modal_input.push(character),
            _ => {}
        }
    }

    fn execute_search(&mut self) {
        let query = self.modal_input.trim();
        if query.is_empty() {
            self.mode = Mode::Normal;
            return;
        }
        match self.index.search_literal(query, 0, 0, 512, 2 * 1024 * 1024) {
            Ok(page) => {
                self.search_hits = page.hits;
                self.search_cursor = 0;
                self.mode = Mode::Normal;
                if self.search_hits.is_empty() {
                    self.status_message = Some(format!("no matches for {query:?}"));
                } else {
                    self.jump_to_search_hit();
                    self.status_message = Some(format!(
                        "{} match{}{}",
                        self.search_hits.len(),
                        if self.search_hits.len() == 1 {
                            ""
                        } else {
                            "es"
                        },
                        if page.truncated {
                            " (more available)"
                        } else {
                            ""
                        }
                    ));
                }
            }
            Err(error) => {
                self.mode = Mode::Normal;
                self.status_message = Some(format!("search failed: {error}"));
            }
        }
    }

    fn jump_search(&mut self, delta: isize) {
        if self.search_hits.is_empty() {
            self.status_message = Some("no active search results".to_string());
            return;
        }
        self.search_cursor = (self.search_cursor as isize + delta)
            .rem_euclid(self.search_hits.len() as isize) as usize;
        self.jump_to_search_hit();
    }

    fn jump_to_search_hit(&mut self) {
        let Some(hit) = self.search_hits.get(self.search_cursor) else {
            return;
        };
        self.file_tree.jump_to_file(hit.file_index);
        self.cursor_row = hit.row;
        self.scroll = hit.row.saturating_sub((self.viewport_height / 2) as u64) as usize;
        self.focus = Focus::Diff;
    }

    fn handle_command_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Esc => {
                self.mode = Mode::Normal;
                self.modal_input.clear();
            }
            KeyCode::Enter => self.execute_ex_command(),
            KeyCode::Backspace => {
                self.modal_input.pop();
            }
            KeyCode::Char(character) => self.modal_input.push(character),
            _ => {}
        }
    }

    fn execute_ex_command(&mut self) {
        let command = self.modal_input.trim().to_ascii_lowercase();
        self.mode = Mode::Normal;
        match command.as_str() {
            "q" | "quit" => self.quit = true,
            "w" | "wrap" => {
                self.wrap = !self.wrap;
                self.persist_settings();
            }
            "theme" => self.open_theme_picker(),
            "help" | "h" => self.mode = Mode::Help,
            "top" => {
                self.cursor_row = 0;
                self.scroll = 0;
            }
            "bottom" => self.dispatch_command(Command {
                action: Action::ScrollBottom,
                count: 1,
            }),
            "" => {}
            _ => self.status_message = Some(format!("unknown command: {command}")),
        }
        self.modal_input.clear();
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
        if key.code == KeyCode::Tab
            || (key.code == KeyCode::BackTab && !key.modifiers.contains(KeyModifiers::CONTROL))
        {
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
    }

    fn submit_send_review(&mut self) {
        let Some(sr) = self.send_review.take() else {
            return;
        };
        self.mode = Mode::Normal;
        let body = sr.body();
        let verdict = sr.verdict;
        let next_round = self.review_round.saturating_add(1);
        let Some(xml) = build_send_payload(&self.comments, &body, Some(verdict), next_round) else {
            self.status_message = Some("nothing to send (no comments, no verdict)".to_string());
            return;
        };
        // 1. Persist the XML next to comments.json.
        let path = crate::ui::send_review_popover::pending_review_path(
            self.repo_root.to_str().unwrap_or("."),
        );
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&path, &xml) {
            self.status_message = Some(format!("send failed: {e}"));
            return;
        }
        // 2. Release every CLI/MCP waiter through the embedded loopback API.
        self.review_round = self.agent_api.release_review(xml.clone());
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
                            start_line_number: None,
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
            Action::ToggleViewed => self.toggle_viewed_current(),
            Action::OpenThemePicker => self.open_theme_picker(),
            _ => {}
        }
    }

    fn handle_diff_action(&mut self, action: Action) {
        match action {
            Action::ScrollDown => self.move_diff_cursor(1),
            Action::ScrollUp => self.move_diff_cursor(-1),
            Action::ScrollHalfDown => {
                self.move_diff_cursor((self.viewport_height / 2).max(1) as isize)
            }
            Action::ScrollHalfUp => {
                self.move_diff_cursor(-((self.viewport_height / 2).max(1) as isize))
            }
            Action::ScrollTop => {
                self.cursor_row = 0;
                self.scroll = 0;
            }
            Action::ScrollBottom => {
                let last = self.current_file_rows().saturating_sub(1);
                self.cursor_row = last;
                self.scroll =
                    last.saturating_sub(self.viewport_height.saturating_sub(1) as u64) as usize;
            }
            Action::NextFile => self.jump_to_relative_file(1),
            Action::PrevFile => self.jump_to_relative_file(-1),
            Action::FocusFileTree => self.focus = Focus::FileTree,
            Action::FocusTracker => self.focus = Focus::Tracker,
            Action::ToggleWrap => {
                self.wrap = !self.wrap;
                self.persist_settings();
            }
            Action::ToggleLayout => {
                self.split = !self.split;
                self.persist_settings();
            }
            Action::ToggleViewed => self.toggle_viewed_current(),
            Action::OpenThemePicker => self.open_theme_picker(),
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
            Action::OpenThemePicker => self.open_theme_picker(),
            _ => {}
        }
    }

    fn open_theme_picker(&mut self) {
        self.theme_original = self.theme;
        self.theme_cursor = ThemeName::all()
            .iter()
            .position(|theme| *theme == self.theme)
            .unwrap_or(0);
        self.modal_input.clear();
        self.mode = Mode::ThemePicker;
    }

    fn filtered_themes(&self) -> Vec<ThemeName> {
        let query = self.modal_input.trim().to_ascii_lowercase();
        ThemeName::all()
            .iter()
            .copied()
            .filter(|theme| {
                query.is_empty()
                    || theme.label().contains(&query)
                    || theme.display_name().to_ascii_lowercase().contains(&query)
            })
            .collect()
    }

    fn preview_theme_at_cursor(&mut self) {
        let themes = self.filtered_themes();
        if themes.is_empty() {
            self.theme_cursor = 0;
            return;
        }
        self.theme_cursor = self.theme_cursor.min(themes.len() - 1);
        self.theme = themes[self.theme_cursor];
        self.palette = Palette::for_theme(self.theme);
    }

    fn handle_theme_picker_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Esc => {
                self.theme = self.theme_original;
                self.palette = Palette::for_theme(self.theme);
                self.mode = Mode::Normal;
                self.modal_input.clear();
            }
            KeyCode::Enter => {
                self.preview_theme_at_cursor();
                self.persist_settings();
                self.status_message = Some(format!("theme: {}", self.theme.display_name()));
                self.mode = Mode::Normal;
                self.modal_input.clear();
            }
            KeyCode::Down => {
                let len = self.filtered_themes().len();
                if len > 0 {
                    self.theme_cursor = (self.theme_cursor + 1).min(len - 1);
                    self.preview_theme_at_cursor();
                }
            }
            KeyCode::Up => {
                self.theme_cursor = self.theme_cursor.saturating_sub(1);
                self.preview_theme_at_cursor();
            }
            KeyCode::Backspace => {
                self.modal_input.pop();
                self.theme_cursor = 0;
                self.preview_theme_at_cursor();
            }
            KeyCode::Char(character) => {
                self.modal_input.push(character);
                self.theme_cursor = 0;
                self.preview_theme_at_cursor();
            }
            _ => {}
        }
    }

    fn toggle_viewed_current(&mut self) {
        let Some(index) = self.file_tree.selected_file_idx() else {
            return;
        };
        let Some(path) = self
            .files
            .get(index)
            .map(|file| file.display_path().to_path_buf())
        else {
            return;
        };
        let viewed = if self.viewed_paths.remove(&path) {
            false
        } else {
            self.viewed_paths.insert(path.clone());
            true
        };
        self.file_tree.set_viewed(index, viewed);
        crate::persistence::save_viewed(self.repo_root.to_str().unwrap_or("."), &self.viewed_paths);
    }

    fn persist_settings(&self) {
        crate::persistence::save_settings(self.theme, self.wrap, self.split);
    }

    fn persist_layout(&self) {
        crate::persistence::save_layout(
            self.repo_root.to_str().unwrap_or("."),
            self.sidebar_width,
            self.comment_height,
            self.sidebar_visible,
            self.comments_visible,
        );
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
        self.cursor_row = 0;
        self.horizontal_offset = 0;
    }

    fn move_diff_cursor(&mut self, delta: isize) {
        let rows = self.current_file_rows();
        if rows == 0 {
            return;
        }
        let next =
            (self.cursor_row as isize + delta).clamp(0, rows.saturating_sub(1) as isize) as u64;
        self.cursor_row = next;
        let top = self.scroll as u64;
        let height = self.viewport_height.max(1) as u64;
        if next < top {
            self.scroll = next as usize;
        } else if next >= top + height {
            self.scroll = next.saturating_add(1).saturating_sub(height) as usize;
        }
    }

    fn current_file_rows(&self) -> u64 {
        self.file_tree
            .selected_file_idx()
            .and_then(|index| self.index.files.get(index))
            .map(|file| file.row_count)
            .unwrap_or(0)
    }

    fn clamp_cursor(&mut self) {
        let rows = self.current_file_rows();
        self.cursor_row = self.cursor_row.min(rows.saturating_sub(1));
        self.scroll = (self.scroll as u64).min(rows.saturating_sub(1)) as usize;
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

    fn jump_relative_hunk(&mut self, delta: isize) {
        let Some(file_index) = self.file_tree.selected_file_idx() else {
            return;
        };
        let Some(file) = self.index.files.get(file_index) else {
            return;
        };
        if file.hunks.is_empty() {
            self.status_message = Some("file has no textual hunks".to_string());
            return;
        }
        let current = file
            .hunks
            .partition_point(|hunk| hunk.row_start <= self.cursor_row)
            .saturating_sub(1);
        let next = (current as isize + delta).rem_euclid(file.hunks.len() as isize) as usize;
        self.cursor_row = file.hunks[next].row_start;
        self.scroll = self
            .cursor_row
            .saturating_sub((self.viewport_height / 3) as u64) as usize;
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
            let side = match c.side {
                CommentSide::Deletions => IndexedLineKind::Del,
                CommentSide::Additions => IndexedLineKind::Add,
            };
            match self.index.find_line_row(file_idx, side, c.line_number) {
                Ok(Some(row)) => {
                    self.cursor_row = row;
                    self.scroll = row.saturating_sub((self.viewport_height / 2) as u64) as usize;
                    self.status_message = Some(format!("→ {}:{}", c.file_path, c.line_number));
                }
                _ => {
                    self.status_message = Some(format!(
                        "comment target is outdated: {}:{}",
                        c.file_path, c.line_number
                    ));
                }
            }
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
                    if matches!(next_status, CommentStatus::Resolved) {
                        "resolved"
                    } else {
                        "reopened"
                    }
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
        match self.current_view_row() {
            Some(ViewRow::Line {
                old_lineno,
                new_lineno,
                ..
            }) => new_lineno.or(old_lineno).unwrap_or(1),
            _ => 1,
        }
    }

    fn current_line_content(&self) -> String {
        match self.current_view_row() {
            Some(ViewRow::Line { content, .. }) => content,
            _ => String::new(),
        }
    }

    fn current_side(&self) -> CommentSide {
        match self.current_view_row() {
            Some(ViewRow::Line {
                kind: IndexedLineKind::Del,
                ..
            }) => CommentSide::Deletions,
            _ => CommentSide::Additions,
        }
    }

    fn current_view_row(&self) -> Option<ViewRow> {
        let file_index = self.file_tree.selected_file_idx()?;
        self.index
            .viewport(file_index, self.cursor_row, 1, 64 * 1024)
            .ok()?
            .rows
            .into_iter()
            .next()
    }

    fn current_file(&self) -> Option<&diffing_core::diff::FileDiff> {
        let idx = self.file_tree.selected_file_idx()?;
        self.files.get(idx)
    }

    pub fn render(&mut self, area: Rect, buf: &mut Buffer) {
        self.poll_background();
        self.toasts.retain(|t| !t.is_expired());
        self.regions = UiRegions::default();
        self.regions.root = Some(area);
        fill_area(area, self.palette.bg, buf);
        if area.width < 42 || area.height < 8 {
            Paragraph::new("diffing needs at least 42×8 cells")
                .style(Style::default().fg(self.palette.fg).bg(self.palette.bg))
                .render(area, buf);
            return;
        }

        let header = Rect::new(area.x, area.y, area.width, 3);
        let status = Rect::new(area.x, area.y + area.height - 1, area.width, 1);
        let (show_sidebar, show_comments) = panel_visibility(
            area.width,
            area.height,
            self.sidebar_visible,
            self.comments_visible,
        );
        self.render_header(header, show_sidebar, show_comments, buf);

        let tracker_height = if show_comments {
            self.comment_height
                .clamp(4, area.height.saturating_sub(18).min(20))
        } else {
            0
        };
        let tracker_divider_height = u16::from(show_comments);
        let body_height = area
            .height
            .saturating_sub(3 + 1 + tracker_height + tracker_divider_height);
        let body = Rect::new(area.x, area.y + 3, area.width, body_height);
        let sidebar_width = if show_sidebar {
            self.sidebar_width.clamp(22, area.width.saturating_sub(42))
        } else {
            0
        };
        let sidebar_divider_width = u16::from(show_sidebar);
        let file_area = show_sidebar.then(|| Rect::new(body.x, body.y, sidebar_width, body.height));
        let divider = show_sidebar.then(|| {
            Rect::new(
                body.x + sidebar_width,
                body.y,
                sidebar_divider_width,
                body.height,
            )
        });
        let diff_area = Rect::new(
            body.x + sidebar_width + sidebar_divider_width,
            body.y,
            body.width
                .saturating_sub(sidebar_width + sidebar_divider_width),
            body.height,
        );
        if let Some(file_area) = file_area {
            self.sync_file_tree_scroll_for(file_area.height.saturating_sub(2) as usize);
            render_file_tree(
                &self.file_tree,
                file_area,
                matches!(self.focus, Focus::FileTree),
                self.file_tree_scroll,
                &self.palette,
                &self.files,
                buf,
            );
            self.regions.file_tree = Some(file_area);
            let inner = inset(file_area, 1);
            self.regions.file_rows = (0..inner.height as usize)
                .filter_map(|offset| {
                    let node = self.file_tree_scroll + offset;
                    (node < self.file_tree.nodes.len()).then_some((
                        Rect::new(inner.x, inner.y + offset as u16, inner.width, 1),
                        node,
                    ))
                })
                .collect();
        }
        if let Some(divider) = divider {
            fill_area(divider, self.palette.bg, buf);
            self.regions.sidebar_divider = Some(divider);
        }
        self.regions.diff = Some(diff_area);
        self.regions.diff_inner = Some(inset(diff_area, 1));
        self.render_diff(diff_area, buf);

        if show_comments {
            let divider_y = body.y + body.height;
            let divider = Rect::new(area.x, divider_y, area.width, 1);
            fill_area(divider, self.palette.bg, buf);
            self.regions.comment_divider = Some(divider);
            let tracker_area = Rect::new(area.x, divider_y + 1, area.width, tracker_height);
            render_tracker(
                &self.comments,
                &mut self.tracker,
                tracker_area,
                &self.palette,
                buf,
            );
            self.regions.comment_panel = Some(tracker_area);
            let inner = inset(tracker_area, 1);
            self.regions.comment_rows = (0..inner.height as usize)
                .filter_map(|offset| {
                    let comment = self.tracker.scroll + offset;
                    (comment < self.comments.len()).then_some((
                        Rect::new(inner.x, inner.y + offset as u16, inner.width, 1),
                        comment,
                    ))
                })
                .collect();
        }

        // Agent status indicator in the status line.
        let mode_str = match self.mode {
            Mode::Normal => "NORMAL",
            Mode::CommentForm => "EDIT",
            Mode::SendReview => "SEND",
            Mode::Search => "SEARCH",
            Mode::Command => "COMMAND",
            Mode::Help => "HELP",
            Mode::ThemePicker => "THEME",
        };
        self.agent_status = if self.agent_api.waiter_count() > 0 {
            AgentStatus::Waiting
        } else {
            AgentStatus::Idle
        };
        let agent_str = match self.agent_status {
            AgentStatus::Waiting => "● agent waiting",
            AgentStatus::Idle => "○ agent idle",
        };
        let current = self
            .file_tree
            .selected_file_idx()
            .and_then(|i| self.files.get(i))
            .map(|f| f.display_path().to_string_lossy().to_string());
        let file_idx = self.file_tree.selected_file_idx().unwrap_or(0);
        let file_count = self.files.len();
        let current_label = current.as_deref().unwrap_or("(no file)");
        let hint = match self.mode {
            Mode::ThemePicker => "type to filter · ↑↓ preview · Enter apply · Esc restore",
            Mode::CommentForm => "Ctrl-S save · Esc cancel",
            Mode::SendReview => "Tab field · ←→ verdict · Ctrl-S send · Esc cancel",
            Mode::Search => "type query · Enter search · Esc cancel",
            _ => match self.focus {
                Focus::FileTree => "click/jk select · h/l collapse · v viewed · Tab diff",
                Focus::Tracker => "click/jk select · o open · r reply · x resolve",
                Focus::Diff => "wheel/jk move · c comment · / search · t theme · ? help",
            },
        };
        render_status_bar(
            status,
            StatusBarContext {
                mode: mode_str,
                current_file: Some(&format!(
                    "{current_label} · row {} · {} comments · {agent_str}{}",
                    self.cursor_row + 1,
                    self.comments.len(),
                    if self.keymap.pending_display().is_empty() {
                        String::new()
                    } else {
                        format!(" · keys {}", self.keymap.pending_display())
                    }
                )),
                file_idx,
                file_count,
                hint,
            },
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
        match self.mode {
            Mode::Help => self.render_help(area, buf),
            Mode::Search => self.render_prompt(area, '/', "search changed paths and lines", buf),
            Mode::Command => self.render_prompt(area, ':', "command", buf),
            Mode::ThemePicker => self.render_theme_picker(area, buf),
            _ => {}
        }

        // Toasts: bottom-right overlay.
        if self.mode == Mode::Normal && !self.toasts.is_empty() {
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
            let message = if self.index.complete {
                "✓  Working tree is clean"
            } else {
                "◌  Indexing changes…"
            };
            Paragraph::new(message)
                .style(Style::default().fg(self.palette.dim).bg(self.palette.bg))
                .centered()
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(self.palette.border))
                        .title(" review "),
                )
                .render(area, buf);
            return;
        };
        let Some(file) = self.index.files.get(idx) else {
            return;
        };
        self.viewport_height = area.height.saturating_sub(2).max(1) as usize;
        let total = file.row_count as usize;
        if self.scroll + self.viewport_height > total {
            self.scroll = total.saturating_sub(self.viewport_height);
        }
        let hovered_row = self.mouse_position.and_then(|(column, row)| {
            let inner = inset(area, 1);
            contains(inner, column, row)
                .then_some(self.scroll as u64 + row.saturating_sub(inner.y) as u64)
        });
        render_card(
            &self.index,
            idx,
            area,
            self.scroll as u64,
            self.cursor_row,
            hovered_row,
            self.horizontal_offset,
            self.wrap,
            self.split,
            &self.palette,
            buf,
        );
    }

    fn sync_file_tree_scroll_for(&mut self, body_height: usize) {
        let body_height = body_height.max(1);
        if self.file_tree.cursor < self.file_tree_scroll {
            self.file_tree_scroll = self.file_tree.cursor;
        } else if self.file_tree.cursor >= self.file_tree_scroll + body_height {
            self.file_tree_scroll = self.file_tree.cursor + 1 - body_height;
        }
    }

    fn render_header(
        &mut self,
        area: Rect,
        show_sidebar: bool,
        show_comments: bool,
        buf: &mut Buffer,
    ) {
        fill_area(area, self.palette.panel, buf);
        let repo = self
            .repo_root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("repository");
        buf.set_string(
            area.x + 2,
            area.y,
            "◆ diffing",
            Style::default()
                .fg(self.palette.accent)
                .bg(self.palette.panel)
                .add_modifier(Modifier::BOLD),
        );
        let summary = format!(
            "{repo}  {} files  +{} -{}{}",
            self.files.len(),
            self.index.additions,
            self.index.deletions,
            if self.indexing { "  ◌" } else { "" }
        );
        if summary.chars().count() as u16 + 14 < area.width {
            let summary_x = area.x.saturating_add(
                area.width
                    .saturating_sub(summary.chars().count() as u16 + 2),
            );
            buf.set_string(
                summary_x,
                area.y,
                summary,
                Style::default().fg(self.palette.dim).bg(self.palette.panel),
            );
        }
        let theme_label = ellipsize(self.theme.display_name(), 16);
        let controls = [
            (ToolbarAction::ToggleSidebar, "Files", show_sidebar),
            (
                ToolbarAction::ToggleLayout,
                if self.split { "Split" } else { "Unified" },
                true,
            ),
            (ToolbarAction::ToggleWrap, "Wrap", self.wrap),
            (ToolbarAction::OpenTheme, theme_label.as_str(), false),
            (ToolbarAction::ToggleComments, "Comments", show_comments),
            (ToolbarAction::OpenHelp, "Help", false),
            (ToolbarAction::SendReview, "Send review", false),
        ];
        let mut x = area.x + 2;
        for (action, label, active) in controls {
            if x + label.chars().count() as u16 + 2 >= area.x + area.width {
                break;
            }
            let rect = render_chip(
                x,
                area.y + 1,
                label,
                active,
                self.mouse_position,
                &self.palette,
                buf,
            );
            self.regions.toolbar.push((rect, action));
            x += rect.width + 1;
        }
        for x in area.x..area.x + area.width {
            buf[(x, area.y + 2)]
                .set_symbol("─")
                .set_style(Style::default().fg(self.palette.border).bg(self.palette.bg));
        }
    }

    fn render_theme_picker(&mut self, area: Rect, buf: &mut Buffer) {
        dim_area(area, self.palette.bg, self.palette.dim, buf);
        let width = area.width.saturating_sub(4).min(72);
        let height = area.height.saturating_sub(4).clamp(8, 24);
        let popup = Rect::new(
            area.x + area.width.saturating_sub(width) / 2,
            area.y + area.height.saturating_sub(height) / 2,
            width,
            height,
        );
        Clear.render(popup, buf);
        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(self.palette.border_focused))
            .style(Style::default().bg(self.palette.elevated))
            .title(Span::styled(
                format!(" Theme · {} available ", ThemeName::all().len()),
                Style::default()
                    .fg(self.palette.fg)
                    .add_modifier(Modifier::BOLD),
            ));
        let inner = block.inner(popup);
        block.render(popup, buf);
        buf.set_string(
            inner.x + 1,
            inner.y,
            format!("⌕ {}", self.modal_input),
            Style::default()
                .fg(self.palette.fg)
                .bg(self.palette.elevated),
        );
        let themes = self.filtered_themes();
        self.theme_cursor = self.theme_cursor.min(themes.len().saturating_sub(1));
        let body_y = inner.y + 2;
        let body_height = inner.height.saturating_sub(3) as usize;
        let scroll = self
            .theme_cursor
            .saturating_sub(body_height.saturating_sub(1));
        self.regions.theme_rows.clear();
        for (visible, theme) in themes.iter().skip(scroll).take(body_height).enumerate() {
            let index = scroll + visible;
            let row = Rect::new(inner.x, body_y + visible as u16, inner.width, 1);
            let selected = index == self.theme_cursor;
            fill_area(
                row,
                if selected {
                    self.palette.selection_bg
                } else {
                    self.palette.elevated
                },
                buf,
            );
            let swatch = Palette::for_theme(*theme);
            buf.set_string(
                row.x + 1,
                row.y,
                if selected { "›" } else { " " },
                Style::default().fg(self.palette.accent),
            );
            let row_bg = if selected {
                self.palette.selection_bg
            } else {
                self.palette.elevated
            };
            for (offset, color) in [(3, swatch.bg), (5, swatch.accent), (7, swatch.added)] {
                buf.set_string(
                    row.x + offset,
                    row.y,
                    "●",
                    Style::default().fg(color).bg(row_bg),
                );
            }
            buf.set_string(
                row.x + 10,
                row.y,
                theme.display_name(),
                Style::default().fg(self.palette.fg).bg(row_bg),
            );
            let kind = if theme.is_light() { "LIGHT" } else { "DARK" };
            let kind_x = row.x + row.width.saturating_sub(kind.len() as u16 + 2);
            buf.set_string(
                kind_x,
                row.y,
                kind,
                Style::default().fg(self.palette.dim).bg(if selected {
                    self.palette.selection_bg
                } else {
                    self.palette.elevated
                }),
            );
            self.regions.theme_rows.push((row, *theme));
        }
        buf.set_string(
            inner.x + 1,
            inner.y + inner.height.saturating_sub(1),
            "type to filter  ·  ↑↓ preview  ·  Enter apply  ·  Esc restore",
            Style::default()
                .fg(self.palette.dim)
                .bg(self.palette.elevated),
        );
    }

    fn render_help(&self, area: Rect, buf: &mut Buffer) {
        dim_area(area, self.palette.bg, self.palette.dim, buf);
        let width = area.width.saturating_sub(4).min(72);
        let height = area.height.saturating_sub(2).min(28);
        let popup = Rect::new(
            area.x + area.width.saturating_sub(width) / 2,
            area.y + area.height.saturating_sub(height) / 2,
            width,
            height,
        );
        Clear.render(popup, buf);
        Paragraph::new(help_text())
            .style(
                Style::default()
                    .fg(self.palette.fg)
                    .bg(self.palette.elevated),
            )
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(self.palette.border_focused))
                    .title(" keyboard help · any key closes "),
            )
            .render(popup, buf);
    }

    fn render_prompt(&self, area: Rect, prefix: char, title: &str, buf: &mut Buffer) {
        dim_area(area, self.palette.bg, self.palette.dim, buf);
        let width = area.width.saturating_sub(4).min(90);
        let popup = Rect::new(
            area.x + area.width.saturating_sub(width) / 2,
            area.y + area.height.saturating_sub(3),
            width,
            3.min(area.height),
        );
        Clear.render(popup, buf);
        Paragraph::new(format!("{prefix}{}", self.modal_input))
            .style(
                Style::default()
                    .fg(self.palette.fg)
                    .bg(self.palette.elevated),
            )
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(self.palette.border_focused))
                    .title(format!(" {title} · Enter confirm · Esc cancel ")),
            )
            .render(popup, buf);
    }
}

fn inset(area: Rect, amount: u16) -> Rect {
    Rect::new(
        area.x.saturating_add(amount),
        area.y.saturating_add(amount),
        area.width.saturating_sub(amount.saturating_mul(2)),
        area.height.saturating_sub(amount.saturating_mul(2)),
    )
}

fn contains(area: Rect, column: u16, row: u16) -> bool {
    column >= area.x
        && column < area.x.saturating_add(area.width)
        && row >= area.y
        && row < area.y.saturating_add(area.height)
}

fn sidebar_width_for_pointer(root: Rect, column: u16) -> u16 {
    column
        .saturating_sub(root.x)
        .clamp(22, root.width.saturating_sub(42).clamp(22, 72))
}

fn panel_visibility(
    width: u16,
    height: u16,
    sidebar_preference: bool,
    comments_preference: bool,
) -> (bool, bool) {
    (
        sidebar_preference && width >= 96,
        comments_preference && height >= 22,
    )
}

fn ellipsize(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut shortened: String = value.chars().take(max_chars.saturating_sub(1)).collect();
    shortened.push('…');
    shortened
}

fn fill_area(area: Rect, color: ratatui::style::Color, buf: &mut Buffer) {
    for y in area.y..area.y.saturating_add(area.height) {
        for x in area.x..area.x.saturating_add(area.width) {
            buf[(x, y)]
                .set_symbol(" ")
                .set_style(Style::default().bg(color));
        }
    }
}

fn dim_area(area: Rect, bg: ratatui::style::Color, fg: ratatui::style::Color, buf: &mut Buffer) {
    for y in area.y..area.y.saturating_add(area.height) {
        for x in area.x..area.x.saturating_add(area.width) {
            let cell = &mut buf[(x, y)];
            cell.set_style(Style::default().fg(fg).bg(bg).add_modifier(Modifier::DIM));
        }
    }
}

fn render_chip(
    x: u16,
    y: u16,
    label: &str,
    active: bool,
    pointer: Option<(u16, u16)>,
    palette: &Palette,
    buf: &mut Buffer,
) -> Rect {
    let width = label.chars().count() as u16 + 2;
    let area = Rect::new(x, y, width, 1);
    let hovered = pointer
        .map(|(column, row)| contains(area, column, row))
        .unwrap_or(false);
    let background = if active || hovered {
        palette.selection_bg
    } else {
        palette.elevated
    };
    fill_area(area, background, buf);
    buf.set_string(
        x + 1,
        y,
        label,
        Style::default()
            .fg(if active || hovered {
                palette.fg
            } else {
                palette.dim
            })
            .bg(background)
            .add_modifier(if active {
                Modifier::BOLD
            } else {
                Modifier::empty()
            }),
    );
    area
}

fn metadata_files(index: &DiffIndex) -> Vec<FileDiff> {
    index
        .files
        .iter()
        .map(|file| FileDiff {
            old_path: file.old_path.clone(),
            new_path: file.new_path.clone(),
            kind: match file.kind {
                IndexedChangeKind::Modified => ChangeKind::Modified,
                IndexedChangeKind::Added => ChangeKind::Added,
                IndexedChangeKind::Deleted => ChangeKind::Deleted,
                IndexedChangeKind::Renamed => ChangeKind::Renamed,
                IndexedChangeKind::Untracked => ChangeKind::Untracked,
                IndexedChangeKind::Binary => ChangeKind::Binary,
            },
            is_binary: file.is_binary,
            hunks: Vec::new(),
        })
        .collect()
}

fn relevant_repo_path(path: &std::path::Path) -> bool {
    !path.components().any(|component| {
        let name = component.as_os_str();
        name == ".git"
            || name == "node_modules"
            || name == "target"
            || name == "dist"
            || name == ".diffing"
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn copy_to_clipboard(text: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    for cmd in clipboard_candidates() {
        let argv = cmd.argv();
        if let Ok(mut child) = Command::new(argv[0])
            .args(&argv[1..])
            .stdin(Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let payload = if cmd.want_crlf() {
                    // `clip.exe` reads raw stdin; pasting into typical Windows
                    // apps works best with CRLF endings.
                    text.replace('\n', "\r\n")
                } else {
                    text.to_string()
                };
                if stdin.write_all(payload.as_bytes()).is_ok() {
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
        "no clipboard tool found (tried pbcopy / wl-copy / xclip / xsel / clip / powershell)",
    ))
}

/// One clipboard tool candidate. We model the `clip.exe` line-ending quirk
/// explicitly so tests can verify it without spawning a real child process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ClipboardCandidate {
    pub argv: &'static [&'static str],
    pub crlf: bool,
}

impl ClipboardCandidate {
    pub(crate) fn argv(&self) -> &'static [&'static str] {
        self.argv
    }
    pub(crate) fn want_crlf(&self) -> bool {
        self.crlf
    }
}

/// Ordered list of clipboard tools to try. Order matters: the *first*
/// successful spawn wins, so platform-native tools should come first.
pub(crate) fn clipboard_candidates() -> &'static [ClipboardCandidate] {
    #[cfg(target_os = "macos")]
    {
        const CANDS: &[ClipboardCandidate] = &[ClipboardCandidate {
            argv: &["pbcopy"],
            crlf: false,
        }];
        CANDS
    }
    #[cfg(target_os = "windows")]
    {
        const CANDS: &[ClipboardCandidate] = &[
            ClipboardCandidate {
                argv: &["clip"],
                crlf: true,
            },
            ClipboardCandidate {
                argv: &[
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "$input | Set-Clipboard",
                ],
                crlf: true,
            },
        ];
        CANDS
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Wayland first (modern desktops), then the two X11 tools. Either
        // ordering of xclip/xsel is fine; xclip is more common.
        const CANDS: &[ClipboardCandidate] = &[
            ClipboardCandidate {
                argv: &["wl-copy"],
                crlf: false,
            },
            ClipboardCandidate {
                argv: &["xclip", "-selection", "clipboard"],
                crlf: false,
            },
            ClipboardCandidate {
                argv: &["xsel", "--clipboard", "--input"],
                crlf: false,
            },
        ];
        CANDS
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        const CANDS: &[ClipboardCandidate] = &[];
        CANDS
    }
}

#[allow(dead_code)]
fn _quiet_duration(_: Duration) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responsive_panels_preserve_the_diff_on_compact_terminals() {
        assert_eq!(panel_visibility(80, 24, true, true), (false, true));
        assert_eq!(panel_visibility(120, 20, true, true), (true, false));
        assert_eq!(panel_visibility(120, 40, false, true), (false, true));
    }

    #[test]
    fn pointer_geometry_clamps_sidebar_and_uses_half_open_rects() {
        let root = Rect::new(10, 0, 120, 40);
        assert_eq!(sidebar_width_for_pointer(root, 12), 22);
        assert_eq!(sidebar_width_for_pointer(root, 50), 40);
        assert_eq!(sidebar_width_for_pointer(root, 129), 72);
        let area = Rect::new(5, 7, 4, 3);
        assert!(contains(area, 5, 7));
        assert!(contains(area, 8, 9));
        assert!(!contains(area, 9, 9));
        assert!(!contains(area, 8, 10));
    }

    #[test]
    fn toolbar_labels_are_bounded_without_splitting_characters() {
        assert_eq!(ellipsize("GitHub Dark", 16), "GitHub Dark");
        assert_eq!(ellipsize("A very long theme", 8), "A very …");
    }

    // Sanity-check that the platform-conditional candidate list never ships
    // a binary that obviously doesn't belong on this OS. These tests are
    // intentionally compiled per-platform so each host asserts only its own
    // expected toolchain — if someone reshuffles the cfg blocks and breaks
    // a platform, the test for that platform will fail.

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_clipboard_uses_pbcopy() {
        let cands = clipboard_candidates();
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].argv(), ["pbcopy"]);
        assert!(!cands[0].want_crlf());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_clipboard_prefers_clip_then_powershell() {
        let cands = clipboard_candidates();
        assert!(cands.len() >= 2);
        assert_eq!(cands[0].argv()[0], "clip");
        assert!(cands[0].want_crlf(), "clip.exe wants CRLF endings");
        assert_eq!(cands[1].argv()[0], "powershell");
        assert!(
            cands[1].argv().iter().any(|a| a.contains("Set-Clipboard")),
            "PowerShell fallback must use Set-Clipboard"
        );
    }

    #[test]
    #[cfg(all(unix, not(target_os = "macos")))]
    fn linux_clipboard_offers_wayland_and_x11() {
        let cands = clipboard_candidates();
        let names: Vec<&str> = cands.iter().map(|c| c.argv()[0]).collect();
        assert!(names.contains(&"wl-copy"), "wl-copy missing: {:?}", names);
        assert!(names.contains(&"xclip"), "xclip missing: {:?}", names);
        // wl-copy must come before the X11 tools so Wayland-only sessions
        // don't trip over an X11 fallback that silently writes to the wrong
        // clipboard.
        let wl = names.iter().position(|&n| n == "wl-copy").unwrap();
        let xclip = names.iter().position(|&n| n == "xclip").unwrap();
        assert!(wl < xclip, "wl-copy must be tried before xclip");
        assert!(cands.iter().all(|c| !c.want_crlf()));
    }
}
