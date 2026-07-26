use std::collections::{HashSet, VecDeque};
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
    DEFAULT_VIEWPORT_MAX_BYTES,
};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Span;
use ratatui::widgets::{Clear, Paragraph, Widget, Wrap};

use crate::agent_api::AgentApi;
use crate::diff::highlight::highlight_line;
use crate::diff_context::DiffContext;
use crate::editorconfig::EditorConfigCache;
use crate::handoff::{CommentsWatcher, RepoWatcher};
use crate::keys::{help_text, viewer_help_text, Action, Command, Keymap};
use crate::lsp::{
    character_column_from_utf16, utf16_column, DefinitionTarget, IntelligenceMode,
    LanguageResponse, LspManager, RequestKind, RequestToken, ServerState,
};
use crate::persistence::FileDisplay;
use crate::search::{
    SearchClient, SearchHit, SearchHitKind, SearchPreview, SearchResponse, SearchScope,
};
use crate::themes::{Palette, ThemeName};
use crate::ui::agent_activity_toast::{render_toast, Toast};
use crate::ui::comment_form::{render_form, CommentFormState};
use crate::ui::comment_tracker::{render_tracker, TrackerState};
use crate::ui::file_diff_card::{render_card, DiffRenderCache};
use crate::ui::file_tree::FileTree;
use crate::ui::file_tree_render::{
    content_area as file_tree_content_area, render_file_tree, FileTreeRenderOptions,
};
use crate::ui::gridline::{
    dim_buffer, hint_line, horizontal_rule, overlay_block, shortcut_help, shortcut_help_columns,
    vertical_rule, GridlineTokens, GLYPHS, METRICS,
};
use crate::ui::send_review_popover::{
    build_send_payload, render_send_popover, send_review_regions, SendField, SendReviewState,
};
use crate::ui::settings_sheet::{render_settings, settings_row_at, SettingsState, SettingsValues};
use crate::ui::vim_status_bar::{render_status_bar, StatusBarContext};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    FileTree,
    Diff,
    Tracker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Experience {
    Review,
    Viewer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditorTarget {
    pub path: PathBuf,
    pub line: u32,
    pub column: usize,
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
    Settings,
    Hover,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileFilterMode {
    All,
    Unviewed,
    Comments,
}

impl FileFilterMode {
    fn next(self) -> Self {
        match self {
            Self::All => Self::Unviewed,
            Self::Unviewed => Self::Comments,
            Self::Comments => Self::All,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::Unviewed => "Unviewed",
            Self::Comments => "Has comments",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentStatus {
    Waiting,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ToolbarAction {
    SendReview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PointerVisualTarget {
    Toolbar(ToolbarAction),
    DiffRow(u16),
    None,
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

impl UiRegions {
    fn pointer_visual_target(&self, position: Option<(u16, u16)>) -> PointerVisualTarget {
        let Some((column, row)) = position else {
            return PointerVisualTarget::None;
        };
        if let Some(action) = self
            .toolbar
            .iter()
            .find(|(area, _)| contains(*area, column, row))
            .map(|(_, action)| *action)
        {
            return PointerVisualTarget::Toolbar(action);
        }
        if self
            .diff_inner
            .is_some_and(|area| contains(area, column, row))
        {
            return PointerVisualTarget::DiffRow(row);
        }
        PointerVisualTarget::None
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingCommentTarget {
    file_path: String,
    side: CommentSide,
    start_line_number: Option<u32>,
    line_number: u32,
    line_content: String,
}

fn inline_comment_target(
    file_path: String,
    rows: Vec<ViewRow>,
) -> std::result::Result<PendingCommentTarget, &'static str> {
    let mut side = None;
    let mut line_numbers: Vec<u32> = Vec::with_capacity(rows.len());
    let mut contents = Vec::with_capacity(rows.len());
    for row in rows {
        let ViewRow::Line {
            kind,
            old_lineno,
            new_lineno,
            content,
            ..
        } = row
        else {
            return Err("select code lines only");
        };
        let row_side = if kind == IndexedLineKind::Del {
            CommentSide::Deletions
        } else {
            CommentSide::Additions
        };
        if side.is_some_and(|existing| existing != row_side) {
            return Err("selection must stay on one diff side");
        }
        side = Some(row_side);
        let number = match row_side {
            CommentSide::Deletions => old_lineno,
            CommentSide::Additions => new_lineno.or(old_lineno),
        }
        .ok_or("selected line has no comment anchor")?;
        if line_numbers
            .last()
            .is_some_and(|previous| previous.checked_add(1) != Some(number))
        {
            return Err("selection must be contiguous on one diff side");
        }
        line_numbers.push(number);
        contents.push(content);
    }
    let line_number = *line_numbers.last().ok_or("select at least one code line")?;
    let start_line_number = (line_numbers.len() > 1).then(|| line_numbers[0]);
    Ok(PendingCommentTarget {
        file_path,
        side: side.unwrap_or(CommentSide::Additions),
        start_line_number,
        line_number,
        line_content: contents.join("\n"),
    })
}

fn blocked_in_viewer(action: Action) -> bool {
    matches!(
        action,
        Action::OpenSendReview
            | Action::AddComment
            | Action::AddFileComment
            | Action::ToggleVisualSelection
            | Action::EditComment
            | Action::ReplyComment
            | Action::ResolveComment
            | Action::ResolveAllComments
            | Action::DeleteComment
            | Action::NextComment
            | Action::PrevComment
            | Action::OpenCommentThread
            | Action::CycleCommentStatus
            | Action::CycleCommentSeverity
            | Action::ToggleViewed
            | Action::CycleFileFilter
    )
}

pub struct App {
    #[allow(dead_code)]
    pub repo_root: PathBuf,
    pub index: Arc<DiffIndex>,
    shared_index: Arc<RwLock<Arc<DiffIndex>>>,
    index_tx: Sender<IndexEvent>,
    index_rx: Receiver<IndexEvent>,
    git_diff_args: Vec<String>,
    default_context_lines: u32,
    context_lines: u32,
    indexing: bool,
    reindex_pending: bool,
    refresh_anchor: Option<RefreshAnchor>,
    pub agent_api: Option<AgentApi>,
    pub files: Vec<diffing_core::diff::FileDiff>,
    pub file_tree: FileTree,
    pub experience: Experience,
    pub diff_context: DiffContext,
    viewed_paths: HashSet<PathBuf>,
    pub focus: Focus,
    pub mode: Mode,
    pub wrap: bool,
    pub split: bool,
    pub file_display: FileDisplay,
    pub tab_size: u8,
    editorconfig: EditorConfigCache,
    pub line_numbers: bool,
    pub mouse_enabled: bool,
    pub theme: ThemeName,
    pub palette: Palette,
    pub scroll: usize,
    pub cursor_row: u64,
    pub continuous_scroll: u64,
    pub continuous_cursor: u64,
    pub viewport_height: usize,
    render_metadata: DiffRenderMetadata,
    diff_render_cache: DiffRenderCache,
    pub horizontal_offset: usize,
    code_column: Option<usize>,
    lsp: LspManager,
    lsp_active_path: Option<PathBuf>,
    lsp_last_state: ServerState,
    lsp_revision: u64,
    queued_lsp: Option<RequestKind>,
    pending_lsp: Option<RequestToken>,
    hover_content: Option<String>,
    hover_scroll: u16,
    visual_anchor: Option<(usize, u64)>,
    pending_comment_target: Option<PendingCommentTarget>,
    pending_editor: Option<EditorTarget>,
    pub sidebar_width: u16,
    pub comment_height: u16,
    pub sidebar_visible: bool,
    pub comments_visible: bool,
    regions: UiRegions,
    drag: Option<DragState>,
    mouse_position: Option<(u16, u16)>,
    theme_cursor: usize,
    theme_original: ThemeName,
    theme_return_to_settings: bool,
    settings_state: SettingsState,
    pub keymap: Keymap,
    pub modal_input: String,
    pub search_cursor: usize,
    search_client: Option<SearchClient>,
    search_scope: SearchScope,
    search_changed_only: bool,
    search_regex: bool,
    repo_search_hits: Vec<SearchHit>,
    repo_search_total: usize,
    repo_search_indexing: bool,
    repo_search_loading: bool,
    repo_search_error: Option<String>,
    repo_search_query: String,
    search_request_id: u64,
    search_request_tx: Option<Sender<SearchRequest>>,
    search_result_rx: Receiver<SearchEvent>,
    search_preview: Option<SearchPreview>,
    search_preview_loading: bool,
    search_preview_error: Option<String>,
    search_preview_scroll: usize,
    preview_request_id: u64,
    preview_request_tx: Option<Sender<PreviewRequest>>,
    preview_result_rx: Receiver<PreviewEvent>,
    pub file_tree_scroll: usize,
    file_filter_mode: FileFilterMode,
    pub status_message: Option<String>,
    pending_delete_id: Option<String>,
    pub quit: bool,
    pub comments: Vec<ReviewComment>,
    comments_revision: u64,
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

struct SearchRequest {
    id: u64,
    query: String,
    scope: SearchScope,
    regex: bool,
    changed_paths: Option<Vec<String>>,
}

struct SearchEvent {
    id: u64,
    response: Result<SearchResponse, String>,
}

struct PreviewRequest {
    id: u64,
    path: String,
}

struct PreviewEvent {
    id: u64,
    response: Result<SearchPreview, String>,
}

#[derive(Debug, Clone)]
struct RefreshAnchor {
    path: PathBuf,
    kind: IndexedLineKind,
    line: u32,
    viewport_offset: u64,
}

const CHANGE_MAP_CACHE_ENTRIES: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChangeMapMarker {
    Added,
    Removed,
    Modified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ChangeMapKey {
    file_index: Option<usize>,
    height: u16,
}

struct CachedChangeMap {
    key: ChangeMapKey,
    markers: Arc<[Option<ChangeMapMarker>]>,
}

#[derive(Default)]
struct DiffRenderMetadata {
    /// Inclusive file starts followed by one terminal total-row sentinel.
    file_offsets: Vec<u64>,
    change_maps: VecDeque<CachedChangeMap>,
}

impl DiffRenderMetadata {
    fn new(index: &DiffIndex) -> Self {
        let mut metadata = Self::default();
        metadata.rebuild(index);
        metadata
    }

    fn rebuild(&mut self, index: &DiffIndex) {
        self.file_offsets.clear();
        self.file_offsets
            .reserve(index.files.len().saturating_add(1));
        self.file_offsets.push(0);
        for file in &index.files {
            let next = self
                .file_offsets
                .last()
                .copied()
                .unwrap_or(0u64)
                .saturating_add(file.row_count);
            self.file_offsets.push(next);
        }
        self.change_maps.clear();
    }

    fn total_rows(&self) -> u64 {
        self.file_offsets.last().copied().unwrap_or(0)
    }

    fn file_offset(&self, file_index: usize) -> u64 {
        self.file_offsets
            .get(file_index)
            .copied()
            .unwrap_or_else(|| self.total_rows())
    }

    fn position(&self, global_row: u64) -> Option<(usize, u64)> {
        let total = self.total_rows();
        if total == 0 || self.file_offsets.len() < 2 {
            return None;
        }
        let row = global_row.min(total.saturating_sub(1));
        let file_index = self
            .file_offsets
            .partition_point(|offset| *offset <= row)
            .saturating_sub(1)
            .min(self.file_offsets.len().saturating_sub(2));
        Some((
            file_index,
            row.saturating_sub(self.file_offsets[file_index]),
        ))
    }

    fn change_map(
        &mut self,
        index: &DiffIndex,
        file_index: Option<usize>,
        height: u16,
    ) -> Arc<[Option<ChangeMapMarker>]> {
        let key = ChangeMapKey { file_index, height };
        if let Some(position) = self.change_maps.iter().position(|cached| cached.key == key) {
            let cached = self
                .change_maps
                .remove(position)
                .expect("position came from the same cache");
            let markers = cached.markers.clone();
            self.change_maps.push_back(cached);
            return markers;
        }

        let total_rows = file_index
            .and_then(|selected| index.files.get(selected))
            .map(|file| file.row_count)
            .unwrap_or_else(|| self.total_rows());
        let mut markers = vec![None; height as usize];
        if height > 0 && total_rows > 0 {
            for (current_index, file) in index.files.iter().enumerate() {
                if file_index.is_some_and(|selected| selected != current_index) {
                    continue;
                }
                let base = if file_index.is_some() {
                    0
                } else {
                    self.file_offset(current_index)
                };
                for hunk in &file.hunks {
                    let logical = base.saturating_add(hunk.row_start);
                    let bucket = (logical.saturating_mul(height.saturating_sub(1) as u64)
                        / total_rows) as usize;
                    let bucket = bucket.min(markers.len().saturating_sub(1));
                    markers[bucket] = Some(if hunk.new_lines > hunk.old_lines {
                        ChangeMapMarker::Added
                    } else if hunk.old_lines > hunk.new_lines {
                        ChangeMapMarker::Removed
                    } else {
                        ChangeMapMarker::Modified
                    });
                }
            }
        }
        let markers: Arc<[Option<ChangeMapMarker>]> = markers.into();
        self.change_maps.push_back(CachedChangeMap {
            key,
            markers: markers.clone(),
        });
        while self.change_maps.len() > CHANGE_MAP_CACHE_ENTRIES {
            self.change_maps.pop_front();
        }
        markers
    }
}

fn diff_first_search_hits(hits: Vec<SearchHit>, changed_paths: &HashSet<String>) -> Vec<SearchHit> {
    let (mut in_diff, outside_diff): (Vec<_>, Vec<_>) = hits
        .into_iter()
        .partition(|hit| changed_paths.contains(&hit.path));
    in_diff.extend(outside_diff);
    in_diff
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

fn spawn_search_worker(
    client: SearchClient,
    request_rx: Receiver<SearchRequest>,
    result_tx: Sender<SearchEvent>,
) -> Result<()> {
    thread::Builder::new()
        .name("diffing-fff-search".to_string())
        .spawn(move || {
            while let Ok(mut request) = request_rx.recv() {
                // Coalesce a burst of keystrokes so the native engine only
                // evaluates the newest query.
                thread::sleep(Duration::from_millis(55));
                while let Ok(newer) = request_rx.try_recv() {
                    request = newer;
                }
                let response = client
                    .search(
                        &request.query,
                        request.scope,
                        request.regex,
                        request.changed_paths.as_deref(),
                    )
                    .map_err(|error| error.to_string());
                let _ = result_tx.send(SearchEvent {
                    id: request.id,
                    response,
                });
            }
        })?;
    Ok(())
}

fn spawn_preview_worker(
    client: SearchClient,
    request_rx: Receiver<PreviewRequest>,
    result_tx: Sender<PreviewEvent>,
) -> Result<()> {
    thread::Builder::new()
        .name("diffing-fff-preview".to_string())
        .spawn(move || {
            while let Ok(mut request) = request_rx.recv() {
                while let Ok(newer) = request_rx.try_recv() {
                    request = newer;
                }
                let response = client
                    .preview(&request.path)
                    .map_err(|error| error.to_string());
                let _ = result_tx.send(PreviewEvent {
                    id: request.id,
                    response,
                });
            }
        })?;
    Ok(())
}

impl App {
    pub fn new(
        repo_root: PathBuf,
        git_diff_args: Vec<String>,
        experience: Experience,
        diff_context: DiffContext,
        search_client: Option<SearchClient>,
    ) -> Result<Self> {
        let empty_spool = diffing_core::project_storage_dir(repo_root.to_str().unwrap_or("."))
            .join("diff-index")
            .join("pending.patch");
        let index = Arc::new(DiffIndex::empty(now_ms(), empty_spool, false));
        let render_metadata = DiffRenderMetadata::new(&index);
        let shared_index = Arc::new(RwLock::new(index.clone()));
        let (index_tx, index_rx) = mpsc::channel();
        let default_context_lines = context_lines_from_args(&git_diff_args).unwrap_or(3);
        spawn_index_worker(repo_root.clone(), git_diff_args.clone(), index_tx.clone())?;
        let agent_api = (experience == Experience::Review)
            .then(|| {
                AgentApi::start(
                    repo_root.to_string_lossy().into_owned(),
                    shared_index.clone(),
                )
            })
            .transpose()?;
        let files = Vec::new();
        let file_tree = FileTree::build(&files);
        let repo_str = repo_root.to_str().unwrap_or(".");
        let persisted = crate::persistence::load(repo_str);
        let (search_request_tx, search_request_rx) = mpsc::channel();
        let (search_result_tx, search_result_rx) = mpsc::channel();
        let (preview_request_tx, preview_request_rx) = mpsc::channel();
        let (preview_result_tx, preview_result_rx) = mpsc::channel();
        let has_search_client = search_client.is_some();
        if let Some(client) = search_client.clone() {
            spawn_search_worker(client.clone(), search_request_rx, search_result_tx)?;
            spawn_preview_worker(client, preview_request_rx, preview_result_tx)?;
        }
        let theme = persisted.theme;
        let lsp = LspManager::new(
            repo_root.clone(),
            if experience == Experience::Viewer {
                IntelligenceMode::Off
            } else {
                persisted.intelligence_mode
            },
        );
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
            default_context_lines,
            context_lines: default_context_lines,
            indexing: true,
            reindex_pending: false,
            refresh_anchor: None,
            agent_api,
            files,
            file_tree,
            experience,
            diff_context,
            viewed_paths: persisted.viewed_files,
            focus: Focus::Diff,
            mode: Mode::Normal,
            wrap: persisted.wrap,
            split: persisted.split,
            file_display: if experience == Experience::Viewer {
                FileDisplay::Continuous
            } else {
                persisted.file_display
            },
            tab_size: persisted.tab_size,
            editorconfig: EditorConfigCache::default(),
            line_numbers: persisted.line_numbers,
            mouse_enabled: persisted.mouse_enabled,
            theme,
            palette: Palette::for_terminal(theme),
            scroll: 0,
            cursor_row: 0,
            continuous_scroll: 0,
            continuous_cursor: 0,
            viewport_height: 1,
            render_metadata,
            diff_render_cache: DiffRenderCache::default(),
            horizontal_offset: 0,
            code_column: None,
            lsp,
            lsp_active_path: None,
            lsp_last_state: ServerState::Unavailable,
            lsp_revision: 0,
            queued_lsp: None,
            pending_lsp: None,
            hover_content: None,
            hover_scroll: 0,
            visual_anchor: None,
            pending_comment_target: None,
            pending_editor: None,
            sidebar_width: persisted.sidebar_width,
            comment_height: persisted.comment_height,
            sidebar_visible: persisted.sidebar_visible,
            comments_visible: experience == Experience::Review && persisted.comments_visible,
            regions: UiRegions::default(),
            drag: None,
            mouse_position: None,
            theme_cursor: 0,
            theme_original: theme,
            theme_return_to_settings: false,
            settings_state: SettingsState::default(),
            keymap: Keymap::default(),
            modal_input: String::new(),
            search_cursor: 0,
            search_client,
            search_scope: SearchScope::All,
            search_changed_only: false,
            search_regex: false,
            repo_search_hits: Vec::new(),
            repo_search_total: 0,
            repo_search_indexing: false,
            repo_search_loading: false,
            repo_search_error: None,
            repo_search_query: String::new(),
            search_request_id: 0,
            search_request_tx: has_search_client.then_some(search_request_tx),
            search_result_rx,
            search_preview: None,
            search_preview_loading: false,
            search_preview_error: None,
            search_preview_scroll: 0,
            preview_request_id: 0,
            preview_request_tx: has_search_client.then_some(preview_request_tx),
            preview_result_rx,
            file_tree_scroll: 0,
            file_filter_mode: FileFilterMode::All,
            status_message: None,
            pending_delete_id: None,
            quit: false,
            tracker: TrackerState::new(),
            comments,
            comments_revision: 1,
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
                    self.refresh_anchor = None;
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
        self.editorconfig.clear();
        self.visual_anchor = None;
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
        self.apply_file_filter();
        let complete = snapshot.complete;
        self.render_metadata.rebuild(&snapshot);
        self.index = Arc::new(snapshot);
        self.lsp_active_path = None;
        if let Ok(mut shared) = self.shared_index.write() {
            *shared = self.index.clone();
        }
        self.clamp_cursor();
        if complete {
            self.restore_refresh_anchor();
            self.indexing = false;
            if self.reindex_pending {
                self.reindex_pending = false;
                self.start_reindex();
            }
        }
        if self.mode == Mode::Search {
            self.queue_repo_search();
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
                self.comments_revision = self.comments_revision.wrapping_add(1);
                self.last_comment_count = self.comments.len();
                self.apply_file_filter();
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
        let review_dirty = if self.experience == Experience::Review {
            self.tick_watcher()
        } else {
            false
        };
        self.tick_index()
            | self.tick_search()
            | self.tick_search_preview()
            | self.tick_lsp()
            | review_dirty
            | repo_dirty
    }

    fn tick_search(&mut self) -> bool {
        let mut dirty = false;
        while let Ok(event) = self.search_result_rx.try_recv() {
            if event.id != self.search_request_id {
                continue;
            }
            self.repo_search_loading = false;
            match event.response {
                Ok(response) => {
                    let changed_paths: HashSet<String> = self
                        .index
                        .files
                        .iter()
                        .map(|file| file.display_path().to_string_lossy().into_owned())
                        .collect();
                    self.repo_search_hits = diff_first_search_hits(response.hits, &changed_paths);
                    self.repo_search_total = response.total;
                    self.repo_search_indexing = response.indexing;
                    self.repo_search_error = response.error;
                    self.search_cursor = self
                        .search_cursor
                        .min(self.repo_search_hits.len().saturating_sub(1));
                    self.queue_search_preview();
                }
                Err(error) => {
                    self.repo_search_hits.clear();
                    self.repo_search_total = 0;
                    self.repo_search_error = Some(error);
                    self.clear_search_preview();
                }
            }
            dirty = true;
        }
        dirty
    }

    fn tick_search_preview(&mut self) -> bool {
        let mut dirty = false;
        while let Ok(event) = self.preview_result_rx.try_recv() {
            if event.id != self.preview_request_id {
                continue;
            }
            self.search_preview_loading = false;
            match event.response {
                Ok(preview) => {
                    self.search_preview = Some(preview);
                    self.search_preview_error = None;
                }
                Err(error) => {
                    self.search_preview = None;
                    self.search_preview_error = Some(error);
                }
            }
            dirty = true;
        }
        dirty
    }

    fn tick_lsp(&mut self) -> bool {
        let mut dirty = false;
        let revision = self.lsp.diagnostics_revision();
        if revision != self.lsp_revision {
            self.lsp_revision = revision;
            dirty = true;
        }

        let path = self
            .file_tree
            .selected_file_idx()
            .and_then(|index| self.files.get(index))
            .map(|file| file.display_path().to_path_buf());
        if path != self.lsp_active_path {
            self.lsp_active_path = None;
            self.code_column = None;
            self.queued_lsp = None;
            self.cancel_pending_language_request();
        }
        if let Some(path) = path {
            if self.lsp_active_path.is_none() || self.lsp_last_state == ServerState::Starting {
                let previous = self.lsp_last_state;
                self.lsp_last_state = match self.lsp.sync_document(&path) {
                    Ok(state) => state,
                    Err(error) => {
                        self.status_message = Some(format!("language server: {error}"));
                        ServerState::Error
                    }
                };
                self.lsp_active_path = Some(path);
                dirty |= previous != self.lsp_last_state;
            }
        }

        if self.lsp_last_state == ServerState::Ready {
            if let Some(kind) = self.queued_lsp.take() {
                self.start_language_request(kind);
                dirty = true;
            }
        }

        if let Some(token) = self.pending_lsp.clone() {
            if let Some(response) = self.lsp.take_response(&token) {
                self.pending_lsp = None;
                match response {
                    Ok(LanguageResponse::Hover(Some(content))) => {
                        self.hover_content = Some(content);
                        self.hover_scroll = 0;
                        self.mode = Mode::Hover;
                    }
                    Ok(LanguageResponse::Hover(None)) => {
                        self.status_message =
                            Some("no hover information at this symbol".to_string());
                    }
                    Ok(LanguageResponse::Definition(targets)) => {
                        self.open_definition(targets);
                    }
                    Err(error) => {
                        self.status_message = Some(format!("language request failed: {error}"));
                    }
                }
                dirty = true;
            }
        }
        dirty
    }

    fn request_language(&mut self, kind: RequestKind) {
        self.cancel_pending_language_request();
        let Some((path, _, _)) = self.current_language_position() else {
            self.status_message = Some(
                "language actions require an added or context line in a supported file".to_string(),
            );
            return;
        };
        match self.lsp.sync_document(&path) {
            Ok(ServerState::Ready) => self.start_language_request(kind),
            Ok(ServerState::Starting) => {
                self.queued_lsp = Some(kind);
                self.lsp_last_state = ServerState::Starting;
                self.lsp_active_path = Some(path);
                self.status_message = Some("language server starting…".to_string());
            }
            Ok(ServerState::Off) => {
                self.status_message = Some("language intelligence is off in Settings".to_string());
            }
            Ok(ServerState::Unavailable) => {
                let server = LspManager::expected_server(&path).unwrap_or("language server");
                self.status_message = Some(format!(
                    "{server} was not found in node_modules/.bin or PATH"
                ));
            }
            Ok(ServerState::Error) | Err(_) => {
                self.status_message = Some("language server could not start".to_string());
            }
        }
    }

    fn start_language_request(&mut self, kind: RequestKind) {
        let Some((path, line, character)) = self.current_language_position() else {
            self.status_message = Some("current diff row has no working-tree position".to_string());
            return;
        };
        let request = match kind {
            RequestKind::Hover => self.lsp.request_hover(&path, line, character),
            RequestKind::Definition => self.lsp.request_definition(&path, line, character),
        };
        match request {
            Ok(token) => {
                self.pending_lsp = Some(token);
                self.status_message = Some(match kind {
                    RequestKind::Hover => "loading hover…".to_string(),
                    RequestKind::Definition => "finding definition…".to_string(),
                });
            }
            Err(error) => {
                self.status_message = Some(format!("language request failed: {error}"));
            }
        }
    }

    fn cancel_pending_language_request(&mut self) {
        if let Some(token) = self.pending_lsp.take() {
            self.lsp.cancel_request(&token);
        }
    }

    fn current_language_position(&self) -> Option<(PathBuf, u32, u32)> {
        let file = self.current_file()?;
        let path = file.display_path().to_path_buf();
        let ViewRow::Line {
            kind,
            new_lineno,
            content,
            ..
        } = self.current_view_row()?
        else {
            return None;
        };
        if kind == IndexedLineKind::Del {
            return None;
        }
        let line = new_lineno?.checked_sub(1)?;
        let character_count = content.chars().count();
        let column = self.effective_code_column().min(character_count);
        Some((path, line, utf16_column(&content, column)))
    }

    fn effective_code_column(&self) -> usize {
        self.code_column.unwrap_or_else(|| {
            self.current_line_content()
                .chars()
                .position(|character| !character.is_whitespace())
                .unwrap_or(0)
        })
    }

    fn open_definition(&mut self, targets: Vec<DefinitionTarget>) {
        let Some(target) = targets.first() else {
            self.status_message = Some("no definition found".to_string());
            return;
        };
        let extra = targets.len().saturating_sub(1);
        let relative = target
            .path
            .strip_prefix(&self.repo_root)
            .unwrap_or(&target.path)
            .to_path_buf();
        let line_number = target.line.saturating_add(1);
        let Some(file_index) = self
            .files
            .iter()
            .position(|file| file.display_path() == relative)
        else {
            self.status_message = Some(format!(
                "definition: {}:{}:{}{}",
                relative.display(),
                line_number,
                target.character.saturating_add(1),
                if extra == 0 {
                    String::new()
                } else {
                    format!(" (+{extra})")
                }
            ));
            return;
        };
        let row = self
            .index
            .find_line_row(file_index, IndexedLineKind::Add, line_number)
            .ok()
            .flatten();
        let Some(row) = row else {
            self.status_message = Some(format!(
                "definition is outside the visible diff: {}:{}",
                relative.display(),
                line_number
            ));
            return;
        };
        self.file_tree.jump_to_file(file_index);
        self.focus = Focus::Diff;
        self.cursor_row = row;
        self.code_column = self
            .index
            .viewport(file_index, row, 1, 64 * 1024)
            .ok()
            .and_then(|page| page.rows.into_iter().next())
            .and_then(|view_row| match view_row {
                ViewRow::Line { content, .. } => {
                    Some(character_column_from_utf16(&content, target.character))
                }
                _ => None,
            })
            .or(Some(target.character as usize));
        if self.file_display == FileDisplay::Continuous {
            self.continuous_cursor = self.continuous_offset_for_file(file_index) + row;
            self.continuous_scroll = self
                .continuous_cursor
                .saturating_sub((self.viewport_height / 2) as u64);
        } else {
            self.scroll = row.saturating_sub((self.viewport_height / 2) as u64) as usize;
        }
        self.status_message = Some(format!("→ {}:{line_number}", relative.display()));
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
        if self.refresh_anchor.is_none() {
            self.refresh_anchor = self.capture_refresh_anchor();
        }
        let git_diff_args = with_context_lines(&self.git_diff_args, self.context_lines);
        match spawn_index_worker(self.repo_root.clone(), git_diff_args, self.index_tx.clone()) {
            Ok(()) => {
                self.indexing = true;
                self.status_message = Some("refreshing diff index…".to_string());
            }
            Err(error) => {
                self.status_message = Some(format!("could not refresh diff: {error}"));
                self.refresh_anchor = None;
            }
        }
    }

    fn capture_refresh_anchor(&self) -> Option<RefreshAnchor> {
        let file_index = self.file_tree.selected_file_idx()?;
        let path = self.files.get(file_index)?.display_path().to_path_buf();
        let ViewRow::Line {
            kind,
            old_lineno,
            new_lineno,
            ..
        } = self.current_view_row()?
        else {
            return None;
        };
        let line = match kind {
            IndexedLineKind::Del => old_lineno,
            _ => new_lineno.or(old_lineno),
        }?;
        let viewport_offset = if self.file_display == FileDisplay::Continuous {
            self.continuous_cursor
                .saturating_sub(self.continuous_scroll)
        } else {
            self.cursor_row.saturating_sub(self.scroll as u64)
        };
        Some(RefreshAnchor {
            path,
            kind,
            line,
            viewport_offset,
        })
    }

    fn restore_refresh_anchor(&mut self) {
        let Some(anchor) = self.refresh_anchor.take() else {
            return;
        };
        let Some(file_index) = self
            .files
            .iter()
            .position(|file| file.display_path() == anchor.path)
        else {
            return;
        };
        let Some(row) = self
            .index
            .find_line_row(file_index, anchor.kind, anchor.line)
            .ok()
            .flatten()
        else {
            return;
        };
        self.file_tree.jump_to_file(file_index);
        self.cursor_row = row;
        if self.file_display == FileDisplay::Continuous {
            self.continuous_cursor = self.continuous_offset_for_file(file_index) + row;
            self.continuous_scroll = self
                .continuous_cursor
                .saturating_sub(anchor.viewport_offset);
        } else {
            self.scroll = row.saturating_sub(anchor.viewport_offset) as usize;
        }
    }

    fn change_context(&mut self, expand: bool) {
        let next = if expand {
            match self.context_lines {
                0..=3 => 10,
                4..=10 => 25,
                11..=25 => 100,
                26..=100 => 500,
                current => current.saturating_mul(2).min(10_000),
            }
        } else {
            match self.context_lines {
                0..=10 => self.default_context_lines,
                11..=25 => 10,
                26..=100 => 25,
                101..=500 => 100,
                _ => 500,
            }
            .max(self.default_context_lines)
        };
        if next == self.context_lines {
            self.status_message = Some(format!("context: {} lines", self.context_lines));
            return;
        }
        self.context_lines = next;
        if self.indexing {
            self.reindex_pending = true;
        } else {
            self.start_reindex();
        }
        self.status_message = Some(format!("loading {} lines of context…", next));
    }

    pub fn handle_key(&mut self, key: crossterm::event::KeyEvent) {
        self.status_message = None;
        match self.mode {
            Mode::CommentForm => self.handle_form_key(key),
            Mode::SendReview => self.handle_send_review_key(key),
            Mode::Search => self.handle_search_key(key),
            Mode::Command => self.handle_command_key(key),
            Mode::ThemePicker => self.handle_theme_picker_key(key),
            Mode::Settings => self.handle_settings_key(key),
            Mode::Hover => self.handle_hover_key(key),
            Mode::Help => {
                self.mode = Mode::Normal;
                self.keymap.clear();
            }
            Mode::Normal => {
                if key.code == crossterm::event::KeyCode::Esc && self.visual_anchor.take().is_some()
                {
                    self.status_message = Some("line selection cancelled".to_string());
                    return;
                }
                if self.experience == Experience::Viewer
                    && self.focus == Focus::FileTree
                    && key.code == crossterm::event::KeyCode::Enter
                {
                    if self.file_tree.selected_file_idx().is_some() {
                        self.focus = Focus::Diff;
                    } else {
                        self.file_tree.toggle_selected();
                    }
                    return;
                }
                if let Some(command) = self.keymap.feed(&key) {
                    self.dispatch_command(command);
                }
            }
        }
    }

    /// Apply a mouse event and report whether it can change visible output.
    /// Pointer motion is common and may be emitted at a much higher rate than
    /// terminal frames; only crossing a hoverable row or toolbar target needs
    /// a redraw.
    pub fn handle_mouse(&mut self, mouse: crossterm::event::MouseEvent) -> bool {
        use crossterm::event::{KeyModifiers, MouseButton, MouseEventKind};
        let previous_target = self.regions.pointer_visual_target(self.mouse_position);
        let moved = matches!(mouse.kind, MouseEventKind::Moved);
        if !self.mouse_enabled {
            self.mouse_position = None;
            self.drag = None;
            return previous_target != PointerVisualTarget::None;
        }
        self.mouse_position = Some((mouse.column, mouse.row));

        if moved {
            return previous_target
                != self
                    .regions
                    .pointer_visual_target(Some((mouse.column, mouse.row)));
        }

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
                        self.palette = Palette::for_terminal(theme);
                        self.persist_settings();
                        self.status_message = Some(format!("theme: {}", theme.display_name()));
                        self.mode = if self.theme_return_to_settings {
                            Mode::Settings
                        } else {
                            Mode::Normal
                        };
                        self.modal_input.clear();
                    }
                }
                _ => {}
            }
            return true;
        }

        if self.mode == Mode::Settings {
            match mouse.kind {
                MouseEventKind::ScrollDown => self.settings_state.move_cursor(1),
                MouseEventKind::ScrollUp => self.settings_state.move_cursor(-1),
                MouseEventKind::Down(MouseButton::Left) => {
                    if let Some(root) = self.regions.root {
                        if let Some(index) = settings_row_at(root, mouse.column, mouse.row) {
                            self.settings_state.cursor = index;
                            self.activate_setting(1);
                        }
                    }
                }
                _ => {}
            }
            return true;
        }

        if self.mode == Mode::Hover {
            match mouse.kind {
                MouseEventKind::ScrollDown => {
                    self.hover_scroll = self.hover_scroll.saturating_add(3)
                }
                MouseEventKind::ScrollUp => self.hover_scroll = self.hover_scroll.saturating_sub(3),
                MouseEventKind::Down(MouseButton::Left) => {
                    self.mode = Mode::Normal;
                    self.hover_content = None;
                }
                _ => {}
            }
            return true;
        }

        if self.mode == Mode::Help {
            if matches!(mouse.kind, MouseEventKind::Down(MouseButton::Left)) {
                self.mode = Mode::Normal;
            }
            return true;
        }

        if self.mode == Mode::SendReview {
            if self.send_review.is_none() {
                self.mode = Mode::Normal;
                return true;
            }
            let Some(root) = self.regions.root else {
                return true;
            };
            let regions = send_review_regions(root);
            if let MouseEventKind::Down(MouseButton::Left) = mouse.kind {
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
            return true;
        }

        // Text-entry modals own the pointer; do not let clicks leak through to
        // the diff underneath them.
        if matches!(self.mode, Mode::CommentForm | Mode::Search | Mode::Command) {
            return true;
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
                    return true;
                }
                if self
                    .regions
                    .comment_divider
                    .map(|area| contains(area, mouse.column, mouse.row))
                    .unwrap_or(false)
                {
                    self.drag = Some(DragState::Comments);
                    return true;
                }
                if let Some(action) = self
                    .regions
                    .toolbar
                    .iter()
                    .find(|(area, _)| contains(*area, mouse.column, mouse.row))
                    .map(|(_, action)| *action)
                {
                    self.activate_toolbar(action);
                    return true;
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
                        self.visual_anchor = None;
                        if self.file_display == FileDisplay::Continuous {
                            if let Some(file) = self.file_tree.selected_file_idx() {
                                let offset = self.continuous_offset_for_file(file);
                                self.continuous_cursor = offset;
                                self.continuous_scroll = offset;
                            }
                        } else {
                            self.scroll = 0;
                            self.cursor_row = 0;
                        }
                        self.horizontal_offset = 0;
                    }
                    return true;
                }
                if let Some((inner, _)) = self
                    .regions
                    .diff_inner
                    .zip(self.regions.diff)
                    .filter(|(inner, _)| contains(*inner, mouse.column, mouse.row))
                {
                    self.focus = Focus::Diff;
                    if self.file_display == FileDisplay::Continuous {
                        self.continuous_cursor = self
                            .continuous_scroll
                            .saturating_add(mouse.row.saturating_sub(inner.y) as u64)
                            .min(self.continuous_total_rows().saturating_sub(1));
                        self.sync_continuous_active();
                    } else {
                        self.cursor_row = (self.scroll as u64)
                            .saturating_add(mouse.row.saturating_sub(inner.y) as u64)
                            .min(self.current_file_rows().saturating_sub(1));
                    }
                    return true;
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
                        self.comment_height = bottom.saturating_sub(mouse.row).clamp(4, 20);
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
                    self.tracker.move_visible_cursor(3, &self.comments);
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
                    self.tracker.move_visible_cursor(-3, &self.comments);
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
        true
    }

    fn activate_toolbar(&mut self, action: ToolbarAction) {
        match action {
            ToolbarAction::SendReview => self.open_send_review(),
        }
    }

    fn dispatch_command(&mut self, command: Command) {
        if self.experience == Experience::Viewer && command.action == Action::EditComment {
            self.queue_editor_for_current_line();
            return;
        }
        if self.experience == Experience::Viewer && blocked_in_viewer(command.action) {
            self.status_message = Some("viewer mode is read-only".to_string());
            return;
        }
        if command.action != Action::DeleteComment {
            self.pending_delete_id = None;
        }
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
                self.search_scope = SearchScope::All;
                self.search_changed_only =
                    self.experience == Experience::Viewer || self.search_request_tx.is_none();
                self.search_regex = false;
                self.search_cursor = 0;
                self.clear_search_preview();
                self.queue_repo_search();
            }
            Action::OpenFileFilter => {
                self.mode = Mode::Search;
                self.modal_input.clear();
                self.search_scope = SearchScope::Files;
                self.search_changed_only =
                    self.experience == Experience::Viewer || self.search_request_tx.is_none();
                self.search_regex = false;
                self.search_cursor = 0;
                self.clear_search_preview();
                self.queue_repo_search();
            }
            Action::CycleFileFilter => {
                self.file_filter_mode = self.file_filter_mode.next();
                self.apply_file_filter();
                self.status_message = Some(format!("files: {}", self.file_filter_mode.label()));
            }
            Action::OpenCommand => {
                self.mode = Mode::Command;
                self.modal_input.clear();
            }
            Action::ToggleSidebar => self.toggle_sidebar(),
            Action::OpenSettings => self.open_settings(),
            Action::LanguageHover => self.request_language(RequestKind::Hover),
            Action::LanguageDefinition => self.request_language(RequestKind::Definition),
            Action::CodeColumnLeft => {
                let column = self
                    .effective_code_column()
                    .saturating_sub(command.count as usize);
                self.code_column = Some(column);
                self.status_message = Some(format!("symbol column {}", column + 1));
            }
            Action::CodeColumnRight => {
                let column = self
                    .effective_code_column()
                    .saturating_add(command.count as usize);
                self.code_column = Some(column);
                self.status_message = Some(format!("symbol column {}", column + 1));
            }
            Action::ResolveAllComments => self.resolve_all_comments(),
            Action::NextSearch => self.jump_search(command.count as isize),
            Action::PrevSearch => self.jump_search(-(command.count as isize)),
            Action::NextHunk => self.jump_relative_hunk(command.count as isize),
            Action::PrevHunk => self.jump_relative_hunk(-(command.count as isize)),
            Action::CenterCursor => {
                if self.file_display == FileDisplay::Continuous {
                    self.continuous_scroll = self
                        .continuous_cursor
                        .saturating_sub((self.viewport_height / 2) as u64);
                } else {
                    self.scroll = self
                        .cursor_row
                        .saturating_sub((self.viewport_height / 2) as u64)
                        as usize;
                }
            }
            Action::ExpandContext => self.change_context(true),
            Action::CollapseContext => self.change_context(false),
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
            Action::FocusFileTree => self.cycle_focus(1),
            Action::FocusDiff => self.cycle_focus(-1),
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

    fn queue_editor_for_current_line(&mut self) {
        let Some(file) = self.current_file() else {
            self.status_message = Some("no file selected".to_string());
            return;
        };
        let path = self.repo_root.join(file.display_path());
        self.pending_editor = Some(EditorTarget {
            path,
            line: self.current_line().max(1),
            column: self.effective_code_column().saturating_add(1),
        });
        self.status_message = Some("opening editor…".to_string());
    }

    pub fn take_editor_target(&mut self) -> Option<EditorTarget> {
        self.pending_editor.take()
    }

    fn cycle_focus(&mut self, delta: isize) {
        let mut order = vec![Focus::Diff];
        if self.sidebar_visible {
            order.push(Focus::FileTree);
        }
        if self.comments_visible && !self.comments.is_empty() {
            order.push(Focus::Tracker);
        }
        let current = order
            .iter()
            .position(|focus| *focus == self.focus)
            .unwrap_or(0);
        let next = (current as isize + delta).rem_euclid(order.len() as isize) as usize;
        self.focus = order[next];
    }

    fn toggle_sidebar(&mut self) {
        self.sidebar_visible = !self.sidebar_visible;
        if !self.sidebar_visible && self.focus == Focus::FileTree {
            self.focus = Focus::Diff;
        }
        self.persist_layout();
        self.status_message = Some(format!(
            "file sidebar: {}",
            if self.sidebar_visible {
                "shown"
            } else {
                "hidden"
            }
        ));
    }

    fn handle_search_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::{KeyCode, KeyModifiers};
        let control = key.modifiers.contains(KeyModifiers::CONTROL);
        let preview_scroll = key
            .modifiers
            .intersects(KeyModifiers::ALT | KeyModifiers::SHIFT);
        match key.code {
            KeyCode::Esc => {
                self.mode = Mode::Normal;
                self.modal_input.clear();
                self.clear_search_preview();
            }
            KeyCode::Enter => self.activate_repo_search_hit(),
            KeyCode::Tab => {
                self.search_scope = self.search_scope.next(1);
                if self.search_scope != SearchScope::Text {
                    self.search_regex = false;
                }
                self.search_cursor = 0;
                self.queue_repo_search();
            }
            KeyCode::BackTab => {
                self.search_scope = self.search_scope.next(-1);
                if self.search_scope != SearchScope::Text {
                    self.search_regex = false;
                }
                self.search_cursor = 0;
                self.queue_repo_search();
            }
            KeyCode::Down if preview_scroll => {
                self.search_preview_scroll = self.search_preview_scroll.saturating_add(4);
            }
            KeyCode::Up if preview_scroll => {
                self.search_preview_scroll = self.search_preview_scroll.saturating_sub(4);
            }
            KeyCode::PageDown => {
                self.search_preview_scroll = self.search_preview_scroll.saturating_add(10)
            }
            KeyCode::PageUp => {
                self.search_preview_scroll = self.search_preview_scroll.saturating_sub(10)
            }
            KeyCode::Down => self.move_search_cursor(1),
            KeyCode::Up => self.move_search_cursor(-1),
            KeyCode::Char('n' | 'j') if control => self.move_search_cursor(1),
            KeyCode::Char('p' | 'k') if control => self.move_search_cursor(-1),
            KeyCode::Char('d') if control => self.move_search_cursor(8),
            KeyCode::Char('u') if control => self.move_search_cursor(-8),
            KeyCode::Char('g') if control => {
                self.search_changed_only = !self.search_changed_only;
                self.search_cursor = 0;
                self.queue_repo_search();
            }
            KeyCode::Char('r') if control && self.search_scope == SearchScope::Text => {
                self.search_regex = !self.search_regex;
                self.search_cursor = 0;
                self.queue_repo_search();
            }
            KeyCode::Backspace => {
                self.modal_input.pop();
                self.search_cursor = 0;
                self.queue_repo_search();
            }
            KeyCode::Char(character) if !control && !key.modifiers.contains(KeyModifiers::ALT) => {
                self.modal_input.push(character);
                self.search_cursor = 0;
                self.queue_repo_search();
            }
            _ => {}
        }
    }

    fn queue_repo_search(&mut self) {
        let Some(tx) = self.search_request_tx.clone() else {
            self.refresh_changed_search_fallback();
            return;
        };
        self.search_request_id = self.search_request_id.saturating_add(1);
        self.repo_search_loading = true;
        self.repo_search_error = None;
        self.repo_search_query = self.modal_input.trim().to_string();
        self.repo_search_hits.clear();
        self.repo_search_total = 0;
        self.clear_search_preview();
        let request = SearchRequest {
            id: self.search_request_id,
            query: self.repo_search_query.clone(),
            scope: self.search_scope,
            regex: self.search_scope == SearchScope::Text && self.search_regex,
            changed_paths: self.search_changed_only.then(|| {
                self.index
                    .files
                    .iter()
                    .map(|file| file.display_path().to_string_lossy().into_owned())
                    .collect()
            }),
        };
        if tx.send(request).is_err() {
            self.repo_search_loading = false;
            self.repo_search_error = Some("fff search worker stopped".to_string());
        }
    }

    fn refresh_changed_search_fallback(&mut self) {
        self.search_changed_only = true;
        self.repo_search_query = self.modal_input.trim().to_string();
        self.repo_search_hits.clear();
        self.repo_search_total = 0;
        self.repo_search_loading = false;
        self.repo_search_indexing = self.indexing;
        self.repo_search_error = None;
        self.clear_search_preview();

        if self.repo_search_query.is_empty() {
            return;
        }
        if self.search_scope == SearchScope::Symbols {
            self.repo_search_error =
                Some("Symbol search requires the diffing Node launcher".to_string());
            return;
        }

        match self
            .index
            .search_literal(&self.repo_search_query, 0, 0, 512, 2 * 1024 * 1024)
        {
            Ok(page) => {
                let truncated = page.truncated;
                self.repo_search_hits = page
                    .hits
                    .into_iter()
                    .filter(|hit| match self.search_scope {
                        SearchScope::Files => hit.old_lineno.is_none() && hit.new_lineno.is_none(),
                        SearchScope::Text => hit.old_lineno.is_some() || hit.new_lineno.is_some(),
                        SearchScope::All => true,
                        SearchScope::Symbols => false,
                    })
                    .map(|hit| {
                        let line = hit.new_lineno.or(hit.old_lineno);
                        let kind = if line.is_some() {
                            SearchHitKind::Text
                        } else {
                            SearchHitKind::File
                        };
                        let title = if line.is_some() {
                            hit.preview.trim().to_string()
                        } else {
                            std::path::Path::new(&hit.path)
                                .file_name()
                                .and_then(|name| name.to_str())
                                .unwrap_or(&hit.path)
                                .to_string()
                        };
                        let detail = if let Some(line) = line {
                            format!("{}:{line}", hit.path)
                        } else {
                            std::path::Path::new(&hit.path)
                                .parent()
                                .map(|parent| {
                                    let value = parent.to_string_lossy();
                                    if value.is_empty() {
                                        "./".to_string()
                                    } else {
                                        format!("{value}/")
                                    }
                                })
                                .unwrap_or_else(|| "./".to_string())
                        };
                        let git_status = self
                            .index
                            .files
                            .get(hit.file_index)
                            .map(|file| match file.kind {
                                IndexedChangeKind::Modified => "modified",
                                IndexedChangeKind::Added => "added",
                                IndexedChangeKind::Deleted => "deleted",
                                IndexedChangeKind::Renamed => "renamed",
                                IndexedChangeKind::Untracked => "untracked",
                                IndexedChangeKind::Binary => "binary",
                            })
                            .unwrap_or("")
                            .to_string();
                        SearchHit {
                            kind,
                            path: hit.path,
                            line,
                            title,
                            detail,
                            git_status,
                        }
                    })
                    .collect();
                self.repo_search_total = self.repo_search_hits.len() + usize::from(truncated);
                self.search_cursor = self
                    .search_cursor
                    .min(self.repo_search_hits.len().saturating_sub(1));
            }
            Err(error) => {
                self.repo_search_error = Some(format!("search failed: {error}"));
            }
        }
    }

    fn move_search_cursor(&mut self, delta: isize) {
        if self.repo_search_hits.is_empty() {
            return;
        }
        self.search_cursor = (self.search_cursor as isize + delta)
            .rem_euclid(self.repo_search_hits.len() as isize) as usize;
        self.queue_search_preview();
    }

    fn clear_search_preview(&mut self) {
        self.preview_request_id = self.preview_request_id.saturating_add(1);
        self.search_preview = None;
        self.search_preview_loading = false;
        self.search_preview_error = None;
        self.search_preview_scroll = 0;
    }

    fn queue_search_preview(&mut self) {
        let Some(hit) = self.repo_search_hits.get(self.search_cursor) else {
            self.clear_search_preview();
            return;
        };
        let Some(tx) = self.preview_request_tx.as_ref() else {
            return;
        };
        self.preview_request_id = self.preview_request_id.saturating_add(1);
        self.search_preview_loading = true;
        self.search_preview_error = None;
        self.search_preview_scroll = hit
            .line
            .map(|line| line.saturating_sub(4) as usize)
            .unwrap_or(0);
        let request = PreviewRequest {
            id: self.preview_request_id,
            path: hit.path.clone(),
        };
        if tx.send(request).is_err() {
            self.search_preview_loading = false;
            self.search_preview_error = Some("preview worker stopped".to_string());
        }
    }

    fn activate_repo_search_hit(&mut self) {
        if self.repo_search_hits.is_empty() {
            if self.modal_input.trim().is_empty() {
                self.mode = Mode::Normal;
            } else {
                self.status_message = Some(format!("no matches for {:?}", self.modal_input.trim()));
            }
            return;
        }
        let Some(hit) = self.repo_search_hits.get(self.search_cursor).cloned() else {
            return;
        };
        if let Some(client) = self.search_client.clone() {
            let query = self.repo_search_query.clone();
            let path = hit.path.clone();
            let _ = thread::Builder::new()
                .name("diffing-fff-track".to_string())
                .spawn(move || client.track(&query, &path));
        }
        let Some(file_index) = self
            .index
            .files
            .iter()
            .position(|file| file.display_path() == std::path::Path::new(&hit.path))
        else {
            self.status_message = Some(format!(
                "Previewing {} · Ctrl-G limits results to this diff",
                hit.path
            ));
            return;
        };
        let row = if hit.kind == SearchHitKind::File {
            0
        } else {
            let row = hit.line.and_then(|line| {
                self.index
                    .find_line_row(file_index, IndexedLineKind::Add, line)
                    .ok()
                    .flatten()
            });
            let Some(row) = row else {
                self.status_message = Some(format!(
                    "Previewing {} · match is outside changed lines",
                    hit.path
                ));
                return;
            };
            row
        };
        self.file_tree.jump_to_file(file_index);
        self.cursor_row = row;
        self.continuous_cursor = self.continuous_offset_for_file(file_index) + row;
        self.continuous_scroll = self
            .continuous_cursor
            .saturating_sub((self.viewport_height / 2) as u64);
        self.scroll = row.saturating_sub((self.viewport_height / 2) as u64) as usize;
        self.focus = Focus::Diff;
        self.mode = Mode::Normal;
        self.clear_search_preview();
        self.status_message = Some(match (hit.kind, hit.line) {
            (SearchHitKind::File, _) => format!("→ {}", hit.path),
            (_, Some(line)) => format!("→ {}:{line}", hit.path),
            _ => format!("→ {}", hit.path),
        });
        self.modal_input.clear();
    }

    fn handle_hover_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::{KeyCode, KeyModifiers};
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => {
                self.mode = Mode::Normal;
                self.hover_content = None;
                self.hover_scroll = 0;
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.hover_scroll = self.hover_scroll.saturating_add(1)
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.hover_scroll = self.hover_scroll.saturating_sub(1)
            }
            KeyCode::PageDown => self.hover_scroll = self.hover_scroll.saturating_add(10),
            KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.hover_scroll = self.hover_scroll.saturating_add(10)
            }
            KeyCode::PageUp => self.hover_scroll = self.hover_scroll.saturating_sub(10),
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.hover_scroll = self.hover_scroll.saturating_sub(10)
            }
            _ => {}
        }
    }

    fn apply_file_filter(&mut self) {
        for index in 0..self.files.len() {
            let path = self.files[index].display_path();
            let count = if self.experience == Experience::Review {
                self.comments
                    .iter()
                    .filter(|comment| std::path::Path::new(&comment.file_path) == path)
                    .count() as u32
            } else {
                0
            };
            self.file_tree.set_comment_count(index, count);
            self.file_tree.set_viewed(
                index,
                self.experience == Experience::Review && self.viewed_paths.contains(path),
            );
        }
        self.file_tree.apply_filter(
            "",
            self.file_filter_mode == FileFilterMode::Unviewed,
            self.file_filter_mode == FileFilterMode::Comments,
        );
        self.file_tree_scroll = 0;
    }

    fn jump_search(&mut self, delta: isize) {
        if self.repo_search_hits.is_empty() {
            self.status_message = Some("no active search results".to_string());
            return;
        }
        self.search_cursor = (self.search_cursor as isize + delta)
            .rem_euclid(self.repo_search_hits.len() as isize) as usize;
        self.activate_repo_search_hit();
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
            "mouse" => self.set_mouse_enabled(!self.mouse_enabled),
            "theme" => self.open_theme_picker(),
            "settings" | "set" => self.open_settings(),
            "files" | "display" => self.open_settings(),
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
        if key.code == KeyCode::Char('t') && key.modifiers.contains(KeyModifiers::CONTROL) {
            if let Some(form) = self.comment_form.as_mut() {
                if form.kind == crate::ui::comment_form::FormKind::New {
                    form.cycle_severity();
                }
            }
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
        let unviewed = self
            .files
            .iter()
            .filter(|file| !self.viewed_paths.contains(file.display_path()))
            .count();
        self.send_review = Some(SendReviewState::new(unviewed));
        self.mode = Mode::SendReview;
    }

    fn submit_send_review(&mut self) {
        if let Some(state) = self.send_review.as_mut() {
            if state.unviewed_files > 0 && !state.guard_acknowledged {
                state.guard_acknowledged = true;
                self.status_message = Some(format!(
                    "{} unviewed file{} · press Ctrl-S again to send",
                    state.unviewed_files,
                    if state.unviewed_files == 1 { "" } else { "s" }
                ));
                return;
            }
        }
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
        self.review_round = self
            .agent_api
            .as_ref()
            .map(|api| api.release_review(xml.clone()))
            .unwrap_or(self.review_round);
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
            self.pending_comment_target = None;
            self.mode = Mode::Normal;
            self.status_message = Some("comment cancelled".to_string());
            return;
        }
        if key.code == KeyCode::Char('s') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.submit_form();
            return;
        }
        if key.code == KeyCode::Char('t') && key.modifiers.contains(KeyModifiers::CONTROL) {
            if let Some(form) = self.comment_form.as_mut() {
                if form.kind == crate::ui::comment_form::FormKind::New {
                    form.cycle_severity();
                }
            }
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
        let severity = form.severity;
        self.mode = Mode::Normal;
        if body.trim().is_empty() {
            self.status_message = Some("comment empty, discarded".to_string());
            return;
        }
        let now = now_ms();
        let result: Result<()> = match form.kind {
            crate::ui::comment_form::FormKind::New => {
                let target = self.pending_comment_target.take().unwrap_or_else(|| {
                    let file_path = self
                        .current_file()
                        .map(|file| file.display_path().to_string_lossy().to_string())
                        .unwrap_or_default();
                    PendingCommentTarget {
                        file_path,
                        side: self.current_side(),
                        start_line_number: None,
                        line_number: self.current_line(),
                        line_content: self.current_line_content(),
                    }
                });
                self.comment_store
                    .add(
                        if target.line_number == 0 {
                            NewComment::FileLevel {
                                file_path: &target.file_path,
                                body: &body,
                                severity,
                            }
                        } else {
                            NewComment::Inline {
                                file_path: &target.file_path,
                                side: target.side,
                                start_line_number: target.start_line_number,
                                line_number: target.line_number,
                                line_content: &target.line_content,
                                body: &body,
                                severity,
                            }
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
                if self.file_display == FileDisplay::Continuous {
                    self.continuous_cursor = 0;
                    self.continuous_scroll = 0;
                    self.sync_continuous_active();
                } else {
                    self.cursor_row = 0;
                    self.scroll = 0;
                }
            }
            Action::ScrollBottom => {
                if self.file_display == FileDisplay::Continuous {
                    let last = self.continuous_total_rows().saturating_sub(1);
                    self.continuous_cursor = last;
                    self.continuous_scroll =
                        last.saturating_sub(self.viewport_height.saturating_sub(1) as u64);
                    self.sync_continuous_active();
                } else {
                    let last = self.current_file_rows().saturating_sub(1);
                    self.cursor_row = last;
                    self.scroll =
                        last.saturating_sub(self.viewport_height.saturating_sub(1) as u64) as usize;
                }
            }
            Action::NextFile => self.jump_to_relative_file(1),
            Action::PrevFile => self.jump_to_relative_file(-1),
            Action::FocusFileTree => self.focus = Focus::FileTree,
            Action::FocusTracker => {
                if self.comments.is_empty() {
                    self.status_message = Some("No comments yet · c adds one".to_string());
                    return;
                }
                self.comments_visible = true;
                self.focus = Focus::Tracker;
                self.persist_layout();
            }
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
            Action::AddFileComment => self.open_file_comment_form(),
            Action::ToggleVisualSelection => self.toggle_visual_selection(),
            Action::EditComment => self.open_edit_form_for_focused(),
            Action::ReplyComment => self.open_reply_form_for_focused(),
            Action::ResolveComment => self.resolve_focused(),
            Action::DeleteComment => self.delete_focused(),
            Action::NextComment => self.jump_relative_comment(1),
            Action::PrevComment => self.jump_relative_comment(-1),
            Action::OpenCommentThread => {
                self.comments_visible = true;
                self.focus = Focus::Tracker;
                self.persist_layout();
            }
            _ => {}
        }
    }

    fn handle_tracker_action(&mut self, action: Action) {
        match action {
            Action::ScrollDown | Action::NextComment => {
                self.tracker.move_visible_cursor(1, &self.comments);
            }
            Action::ScrollUp | Action::PrevComment => {
                self.tracker.move_visible_cursor(-1, &self.comments);
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
            Action::CycleCommentStatus => {
                self.tracker.status_filter = self.tracker.status_filter.next();
                self.tracker.normalize_filter_cursor(&self.comments);
            }
            Action::CycleCommentSeverity => {
                self.tracker.severity_filter = self.tracker.severity_filter.next();
                self.tracker.normalize_filter_cursor(&self.comments);
            }
            Action::OpenThemePicker => self.open_theme_picker(),
            _ => {}
        }
    }

    fn open_theme_picker(&mut self) {
        self.theme_return_to_settings = self.mode == Mode::Settings;
        self.theme_original = self.theme;
        self.theme_cursor = ThemeName::all()
            .iter()
            .position(|theme| *theme == self.theme)
            .unwrap_or(0);
        self.modal_input.clear();
        self.mode = Mode::ThemePicker;
    }

    fn open_settings(&mut self) {
        self.settings_state.cursor = 0;
        self.mode = Mode::Settings;
    }

    fn handle_settings_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Esc | KeyCode::Char(',') => self.mode = Mode::Normal,
            KeyCode::Up | KeyCode::Char('k') => self.settings_state.move_cursor(-1),
            KeyCode::Down | KeyCode::Char('j') => self.settings_state.move_cursor(1),
            KeyCode::Left => self.activate_setting(-1),
            KeyCode::Right | KeyCode::Enter | KeyCode::Char(' ') => self.activate_setting(1),
            _ => {}
        }
    }

    fn activate_setting(&mut self, direction: isize) {
        match self.settings_state.cursor {
            0 => self.toggle_file_display(),
            1 => {
                self.split = !self.split;
                self.persist_settings();
            }
            2 => {
                self.wrap = !self.wrap;
                self.persist_settings();
            }
            3 => {
                self.tab_size = match self.tab_size {
                    2 => 4,
                    4 => 8,
                    _ => 2,
                };
                self.persist_settings();
            }
            4 => {
                self.line_numbers = !self.line_numbers;
                self.persist_settings();
            }
            5 => {
                self.set_mouse_enabled(!self.mouse_enabled);
            }
            6 => {
                self.toggle_sidebar();
            }
            7 => {
                self.sidebar_width = if direction < 0 {
                    self.sidebar_width.saturating_sub(2)
                } else {
                    self.sidebar_width.saturating_add(2)
                }
                .clamp(22, 72);
                self.persist_layout();
                self.status_message =
                    Some(format!("sidebar width: {} columns", self.sidebar_width));
            }
            8 => {
                self.comments_visible = !self.comments_visible;
                if !self.comments_visible && self.focus == Focus::Tracker {
                    self.focus = Focus::Diff;
                }
                self.persist_layout();
            }
            9 => {
                let mode = self.lsp.mode().toggle();
                self.lsp.set_mode(mode);
                self.lsp_active_path = None;
                self.lsp_last_state = if mode == crate::lsp::IntelligenceMode::Off {
                    ServerState::Off
                } else {
                    ServerState::Unavailable
                };
                self.queued_lsp = None;
                self.cancel_pending_language_request();
                self.persist_settings();
                self.status_message = Some(format!("language intelligence: {}", mode.label()));
            }
            10 => self.open_theme_picker(),
            _ => {}
        }
    }

    fn set_mouse_enabled(&mut self, enabled: bool) {
        self.mouse_enabled = enabled;
        self.mouse_position = None;
        self.drag = None;
        self.persist_settings();
        self.status_message = Some(format!(
            "mouse input: {}",
            if enabled { "enabled" } else { "disabled" }
        ));
    }

    fn toggle_file_display(&mut self) {
        self.file_display = self.file_display.toggle();
        match self.file_display {
            FileDisplay::Single => {
                if let Some((file, row)) = self.continuous_position(self.continuous_cursor) {
                    self.file_tree.jump_to_file(file);
                    self.cursor_row = row;
                    self.scroll = row.saturating_sub((self.viewport_height / 3) as u64) as usize;
                }
            }
            FileDisplay::Continuous => {
                let file = self.file_tree.selected_file_idx().unwrap_or(0);
                self.continuous_cursor = self.continuous_offset_for_file(file) + self.cursor_row;
                self.continuous_scroll = self
                    .continuous_cursor
                    .saturating_sub((self.viewport_height / 3) as u64);
            }
        }
        self.persist_layout();
        self.status_message = Some(format!("file display: {}", self.file_display.label()));
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
        self.palette = Palette::for_terminal(self.theme);
    }

    fn handle_theme_picker_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Esc => {
                self.theme = self.theme_original;
                self.palette = Palette::for_terminal(self.theme);
                self.mode = if self.theme_return_to_settings {
                    Mode::Settings
                } else {
                    Mode::Normal
                };
                self.modal_input.clear();
            }
            KeyCode::Enter => {
                self.preview_theme_at_cursor();
                self.persist_settings();
                self.status_message = Some(format!("theme: {}", self.theme.display_name()));
                self.mode = if self.theme_return_to_settings {
                    Mode::Settings
                } else {
                    Mode::Normal
                };
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
        self.apply_file_filter();
    }

    fn persist_settings(&self) {
        crate::persistence::save_settings(
            self.theme,
            self.wrap,
            self.split,
            self.tab_size,
            self.line_numbers,
            self.mouse_enabled,
            self.lsp.mode(),
        );
    }

    fn persist_layout(&self) {
        crate::persistence::save_layout(
            self.repo_root.to_str().unwrap_or("."),
            self.sidebar_width,
            self.comment_height,
            self.sidebar_visible,
            self.comments_visible,
            self.file_display,
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
        self.visual_anchor = None;
        if self.file_display == FileDisplay::Continuous {
            let offset = self.continuous_offset_for_file(next);
            self.continuous_cursor = offset;
            self.continuous_scroll = offset;
            self.sync_continuous_active();
        } else {
            self.scroll = 0;
            self.cursor_row = 0;
        }
        self.horizontal_offset = 0;
        self.code_column = None;
    }

    fn move_diff_cursor(&mut self, delta: isize) {
        self.code_column = None;
        if self.file_display == FileDisplay::Continuous {
            let rows = self.continuous_total_rows();
            if rows == 0 {
                return;
            }
            self.continuous_cursor = (self.continuous_cursor as isize + delta)
                .clamp(0, rows.saturating_sub(1) as isize)
                as u64;
            let top = self.continuous_scroll;
            let height = self.viewport_height.max(1) as u64;
            if self.continuous_cursor < top {
                self.continuous_scroll = self.continuous_cursor;
            } else if self.continuous_cursor >= top + height {
                self.continuous_scroll = self
                    .continuous_cursor
                    .saturating_add(1)
                    .saturating_sub(height);
            }
            self.sync_continuous_active();
            return;
        }
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

    fn continuous_total_rows(&self) -> u64 {
        self.render_metadata.total_rows()
    }

    fn continuous_offset_for_file(&self, file_index: usize) -> u64 {
        self.render_metadata.file_offset(file_index)
    }

    fn continuous_position(&self, global_row: u64) -> Option<(usize, u64)> {
        self.render_metadata.position(global_row)
    }

    fn sync_continuous_active(&mut self) {
        if let Some((file, row)) = self.continuous_position(self.continuous_cursor) {
            if self
                .visual_anchor
                .is_some_and(|(anchor_file, _)| anchor_file != file)
            {
                self.visual_anchor = None;
            }
            self.file_tree.jump_to_file(file);
            self.cursor_row = row;
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
        self.code_column = None;
        self.cursor_row = file.hunks[next].row_start;
        if self.file_display == FileDisplay::Continuous {
            self.continuous_cursor = self.continuous_offset_for_file(file_index) + self.cursor_row;
            self.continuous_scroll = self
                .continuous_cursor
                .saturating_sub((self.viewport_height / 3) as u64);
        } else {
            self.scroll =
                self.cursor_row
                    .saturating_sub((self.viewport_height / 3) as u64) as usize;
        }
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
            let target_row = if c.line_number == 0 {
                Some(0)
            } else {
                self.find_comment_row(file_idx, &c)
            };
            match target_row {
                Some(row) => {
                    self.cursor_row = row;
                    if self.file_display == FileDisplay::Continuous {
                        self.continuous_cursor = self.continuous_offset_for_file(file_idx) + row;
                        self.continuous_scroll = self
                            .continuous_cursor
                            .saturating_sub((self.viewport_height / 2) as u64);
                    } else {
                        self.scroll =
                            row.saturating_sub((self.viewport_height / 2) as u64) as usize;
                    }
                    self.status_message = Some(format!("→ {}:{}", c.file_path, c.line_number));
                }
                None => {
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
        let Some(target) = self.build_comment_target(false) else {
            return;
        };
        let label = if let Some(start) = target.start_line_number {
            format!(
                "new comment · {}:{start}-{}",
                target.file_path, target.line_number
            )
        } else {
            format!("new comment · {}:{}", target.file_path, target.line_number)
        };
        self.pending_comment_target = Some(target);
        self.visual_anchor = None;
        self.comment_form = Some(CommentFormState::new(label));
        self.mode = Mode::CommentForm;
    }

    fn open_file_comment_form(&mut self) {
        let Some(target) = self.build_comment_target(true) else {
            return;
        };
        let label = format!("new file comment · {}", target.file_path);
        self.pending_comment_target = Some(target);
        self.comment_form = Some(CommentFormState::new(label));
        self.mode = Mode::CommentForm;
    }

    fn toggle_visual_selection(&mut self) {
        let Some(file) = self.file_tree.selected_file_idx() else {
            return;
        };
        if self.visual_anchor.take().is_some() {
            self.status_message = Some("line selection cancelled".to_string());
        } else {
            self.visual_anchor = Some((file, self.cursor_row));
            self.status_message =
                Some("line selection started · move, then c to comment".to_string());
        }
    }

    fn build_comment_target(&mut self, file_level: bool) -> Option<PendingCommentTarget> {
        let file_index = self.file_tree.selected_file_idx()?;
        let file_path = self
            .files
            .get(file_index)?
            .display_path()
            .to_string_lossy()
            .to_string();
        if file_level {
            return Some(PendingCommentTarget {
                file_path,
                side: CommentSide::Additions,
                start_line_number: None,
                line_number: 0,
                line_content: String::new(),
            });
        }

        let (start_row, end_row) = match self.visual_anchor {
            Some((anchor_file, anchor_row)) if anchor_file == file_index => (
                anchor_row.min(self.cursor_row),
                anchor_row.max(self.cursor_row),
            ),
            Some(_) => {
                self.status_message = Some("line selection cannot cross files".to_string());
                return None;
            }
            None => (self.cursor_row, self.cursor_row),
        };
        let Ok(count) = usize::try_from(end_row.saturating_sub(start_row).saturating_add(1)) else {
            self.status_message = Some("selected range is too large".to_string());
            return None;
        };
        let viewport =
            match self
                .index
                .viewport(file_index, start_row, count, DEFAULT_VIEWPORT_MAX_BYTES)
            {
                Ok(viewport) => viewport,
                Err(error) => {
                    self.status_message = Some(format!("could not select lines: {error}"));
                    return None;
                }
            };
        if viewport.truncated || viewport.rows.len() != count {
            self.status_message = Some(
                "selection exceeds the safe comment range; choose fewer or smaller lines"
                    .to_string(),
            );
            return None;
        }
        match inline_comment_target(file_path, viewport.rows) {
            Ok(target) => Some(target),
            Err(message) => {
                self.status_message = Some(message.to_string());
                None
            }
        }
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

    fn resolve_all_comments(&mut self) {
        match self.comment_store.resolve_all() {
            Ok(0) => self.status_message = Some("no open comments".to_string()),
            Ok(count) => {
                self.status_message = Some(format!("resolved {count} comment threads"));
                self.reload_comments();
            }
            Err(_) => self.status_message = Some("resolve all failed".to_string()),
        }
    }

    fn comment_is_outdated(&self, comment: &ReviewComment) -> bool {
        let Some(file_index) = self
            .files
            .iter()
            .position(|file| file.display_path() == std::path::Path::new(&comment.file_path))
        else {
            return true;
        };
        if comment.line_number == 0 {
            return false;
        }
        let end = comment
            .line_number
            .max(comment.start_line_number.unwrap_or(comment.line_number));
        let start = comment
            .line_number
            .min(comment.start_line_number.unwrap_or(comment.line_number));
        self.find_comment_line_row(file_index, comment.side, start)
            .zip(self.find_comment_line_row(file_index, comment.side, end))
            .is_none()
    }

    fn find_comment_row(&self, file_index: usize, comment: &ReviewComment) -> Option<u64> {
        self.find_comment_line_row(
            file_index,
            comment.side,
            comment
                .line_number
                .max(comment.start_line_number.unwrap_or(comment.line_number)),
        )
    }

    fn find_comment_line_row(
        &self,
        file_index: usize,
        side: CommentSide,
        line_number: u32,
    ) -> Option<u64> {
        let kinds: &[IndexedLineKind] = match side {
            CommentSide::Deletions => &[IndexedLineKind::Del],
            CommentSide::Additions => &[IndexedLineKind::Add, IndexedLineKind::Context],
        };
        kinds.iter().find_map(|kind| {
            self.index
                .find_line_row(file_index, *kind, line_number)
                .ok()
                .flatten()
        })
    }

    fn delete_focused(&mut self) {
        let Some(c) = self.comments.get(self.tracker.cursor) else {
            return;
        };
        let id = c.id.clone();
        if self.pending_delete_id.as_deref() != Some(&id) {
            self.pending_delete_id = Some(id);
            self.status_message =
                Some("press d again to permanently delete this thread".to_string());
            return;
        }
        self.pending_delete_id = None;
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

    fn current_diagnostic_hint(&self) -> Option<String> {
        let file = self.current_file()?;
        let ViewRow::Line {
            kind, new_lineno, ..
        } = self.current_view_row()?
        else {
            return None;
        };
        if kind == IndexedLineKind::Del {
            return None;
        }
        let line = new_lineno?.checked_sub(1)?;
        let diagnostics = self.lsp.diagnostics_for(file.display_path());
        let diagnostic = diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.line == line)
            .min_by_key(|diagnostic| diagnostic.severity)?;
        Some(format!(
            "{} {}{}",
            diagnostic.marker(),
            diagnostic
                .source
                .as_deref()
                .map(|source| format!("{source}: "))
                .unwrap_or_default(),
            diagnostic.message.replace(['\n', '\r'], " ")
        ))
    }

    fn annotation_revision(&self) -> u64 {
        if self.experience == Experience::Viewer {
            0
        } else {
            self.comments_revision.rotate_left(17) ^ self.lsp.diagnostics_revision()
        }
    }

    fn current_file(&self) -> Option<&diffing_core::diff::FileDiff> {
        let idx = self.file_tree.selected_file_idx()?;
        self.files.get(idx)
    }

    pub fn render(&mut self, area: Rect, buf: &mut Buffer) {
        self.toasts.retain(|t| !t.is_expired());
        self.regions = UiRegions::default();
        self.regions.root = Some(area);
        fill_area(area, self.palette.bg, buf);
        if area.width < METRICS.content_min_width || area.height < 8 {
            Paragraph::new(format!(
                "diffing needs at least {}×8 cells",
                METRICS.content_min_width
            ))
            .style(Style::default().fg(self.palette.fg).bg(self.palette.bg))
            .render(area, buf);
            return;
        }

        if self.comments.is_empty() && self.focus == Focus::Tracker {
            self.focus = Focus::Diff;
        }

        let header_height = METRICS.header_height;
        let header = Rect::new(area.x, area.y, area.width, header_height);
        let status = Rect::new(
            area.x,
            area.y + area.height - METRICS.status_height,
            area.width,
            METRICS.status_height,
        );
        let comments_requested = self.experience == Experience::Review
            && self.comments_visible
            && !self.comments.is_empty();
        let (mut show_sidebar, mut show_comments) = panel_visibility(
            area.width,
            area.height,
            self.sidebar_visible,
            comments_requested,
        );
        if self.experience == Experience::Viewer {
            show_sidebar = self.sidebar_visible && area.width >= 84;
            show_comments = false;
        }
        let compact_workspace = area.width < 88;
        let show_diff = !compact_workspace || self.focus == Focus::Diff;
        if compact_workspace {
            show_sidebar = self.sidebar_visible && self.focus == Focus::FileTree;
            show_comments = self.comments_visible && self.focus == Focus::Tracker;
        }
        if header.height > 0 {
            self.render_header(header, buf);
        }

        let comments_right = show_comments && area.width >= 132;
        let comments_workspace = compact_workspace && show_comments;
        let tracker_height = if show_comments && !comments_right && !comments_workspace {
            self.comment_height
                .clamp(4, area.height.saturating_sub(18).min(20))
        } else {
            0
        };
        let body_height = area
            .height
            .saturating_sub(header_height + METRICS.status_height + tracker_height);
        let body = Rect::new(area.x, area.y + header_height, area.width, body_height);
        let sidebar_width = if show_sidebar && compact_workspace {
            body.width
        } else if show_sidebar {
            self.sidebar_width.clamp(
                METRICS.sidebar_min_width,
                area.width.saturating_sub(METRICS.content_min_width),
            )
        } else {
            0
        };
        let sidebar_divider_width = u16::from(show_sidebar && !compact_workspace);
        let review_width = if comments_right {
            METRICS.review_width.min(
                body.width
                    .saturating_sub(sidebar_width + METRICS.content_min_width + 2),
            )
        } else {
            0
        };
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
            if show_diff {
                body.width
                    .saturating_sub(sidebar_width + sidebar_divider_width + review_width)
            } else {
                0
            },
            body.height,
        );
        if let Some(file_area) = file_area {
            let minimal_tree = self.experience == Experience::Viewer;
            self.sync_file_tree_scroll_for(
                file_tree_content_area(file_area, minimal_tree).height as usize,
            );
            render_file_tree(
                &self.file_tree,
                file_area,
                FileTreeRenderOptions {
                    focused: matches!(self.focus, Focus::FileTree),
                    scroll: self.file_tree_scroll,
                    minimal: minimal_tree,
                    file_count: self.files.len(),
                },
                &self.palette,
                buf,
            );
            self.regions.file_tree = Some(file_area);
            let inner = file_tree_content_area(file_area, minimal_tree);
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
            vertical_rule(divider, &self.palette, self.palette.bg, buf);
            self.regions.sidebar_divider = Some(divider);
        }
        if show_diff && diff_area.width > 0 {
            let diff_header_height = if self.experience == Experience::Review
                || self.file_display != FileDisplay::Continuous
            {
                2
            } else {
                0
            };
            let diff_header = Rect::new(
                diff_area.x,
                diff_area.y,
                diff_area.width,
                diff_header_height,
            );
            let diff_content = Rect::new(
                diff_area.x,
                diff_area.y + diff_header_height,
                diff_area.width,
                diff_area.height.saturating_sub(diff_header_height),
            );
            if diff_header.height > 0 {
                self.render_active_file_header(diff_header, buf);
            }
            self.regions.diff = Some(diff_content);
            self.regions.diff_inner = Some(diff_content);
            self.render_diff(diff_content, buf);
        }

        if show_comments {
            let tracker_area = if comments_workspace {
                body
            } else if comments_right {
                Rect::new(
                    diff_area.x + diff_area.width,
                    body.y,
                    review_width,
                    body.height,
                )
            } else {
                let divider_y = body.y + body.height;
                let divider = Rect::new(area.x, divider_y, area.width, 1);
                self.regions.comment_divider = Some(divider);
                Rect::new(area.x, divider_y, area.width, tracker_height)
            };
            let outdated_comments: HashSet<String> = self
                .tracker
                .visible_indices(&self.comments)
                .into_iter()
                .skip(self.tracker.scroll)
                .take(tracker_area.height as usize)
                .filter_map(|index| self.comments.get(index))
                .filter(|comment| self.comment_is_outdated(comment))
                .map(|comment| comment.id.clone())
                .collect();
            render_tracker(
                &self.comments,
                &outdated_comments,
                &mut self.tracker,
                matches!(self.focus, Focus::Tracker),
                tracker_area,
                &self.palette,
                buf,
            );
            self.regions.comment_panel = Some(tracker_area);
            let inner = inset(tracker_area, 1);
            let visible_comments = self.tracker.visible_indices(&self.comments);
            self.regions.comment_rows = (0..inner.height as usize)
                .filter_map(|offset| {
                    visible_comments
                        .get(self.tracker.scroll + offset)
                        .copied()
                        .map(|comment| {
                            (
                                Rect::new(inner.x, inner.y + offset as u16, inner.width, 1),
                                comment,
                            )
                        })
                })
                .collect();
        }

        // Agent status indicator in the status line.
        let mode_str = if self.experience == Experience::Viewer && self.mode == Mode::Normal {
            ""
        } else if self.mode == Mode::Normal && self.visual_anchor.is_some() {
            "VISUAL"
        } else {
            match self.mode {
                Mode::Normal => "NORMAL",
                Mode::CommentForm => "EDIT",
                Mode::SendReview => "SEND",
                Mode::Search => "SEARCH",
                Mode::Command => "COMMAND",
                Mode::Help => "HELP",
                Mode::ThemePicker => "THEME",
                Mode::Settings => "SETTINGS",
                Mode::Hover => "HOVER",
            }
        };
        self.agent_status = if self
            .agent_api
            .as_ref()
            .is_some_and(|api| api.waiter_count() > 0)
        {
            AgentStatus::Waiting
        } else {
            AgentStatus::Idle
        };
        let file_idx = self.file_tree.selected_file_idx().unwrap_or(0);
        let file_count = self.files.len();
        let hint = match self.mode {
            Mode::ThemePicker => "type to filter · ↑↓ preview · Enter apply · Esc restore",
            Mode::CommentForm => "Ctrl-S save · Esc cancel",
            Mode::SendReview => "Tab field · ←→ verdict · Ctrl-S send · Esc cancel",
            Mode::Search => {
                "type to search · Tab scope · ^G changed · ↑↓ select · ⇧↑↓ preview · Enter jump"
            }
            Mode::Settings => "↑↓ select · ←→ change · Esc close",
            Mode::Hover => "j/k or wheel scroll · Esc close",
            _ => match self.focus {
                Focus::FileTree if self.experience == Experience::Viewer => {
                    "jk select · Enter open · h/l collapse · Tab diff · / search"
                }
                Focus::FileTree => "click/jk select · h/l collapse · v viewed · Tab diff",
                Focus::Tracker => "jk select · s status · p severity · o open · x resolve",
                Focus::Diff if self.experience == Experience::Viewer => {
                    "jk move · J/K files · ]h/[h hunks · / search · ? help"
                }
                Focus::Diff => "wheel/jk move · c comment · / search · , settings · ? help",
            },
        };
        let diagnostic_hint = self.current_diagnostic_hint();
        let pending_key_hint = self.keymap.pending_hint();
        let selection_hint = self.visual_anchor.map(|(_, anchor)| {
            let rows = anchor.abs_diff(self.cursor_row).saturating_add(1);
            format!("{rows} rows selected · c comment · V/Esc cancel")
        });
        let hint = self
            .status_message
            .as_deref()
            .or(selection_hint.as_deref())
            .or(diagnostic_hint.as_deref())
            .or(pending_key_hint)
            .unwrap_or(hint);
        render_status_bar(
            status,
            StatusBarContext {
                mode: mode_str,
                current_file: Some(&format!(
                    "Ln {}{}{}",
                    self.cursor_row + 1,
                    if self.experience == Experience::Viewer || self.comments.is_empty() {
                        String::new()
                    } else {
                        format!(" · {} comments", self.comments.len())
                    },
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
            Mode::Search => self.render_search_palette(area, buf),
            Mode::Command => self.render_prompt(area, ':', "command", buf),
            Mode::ThemePicker => self.render_theme_picker(area, buf),
            Mode::Settings => render_settings(
                &self.settings_state,
                SettingsValues {
                    file_display: self.file_display,
                    split: self.split,
                    wrap: self.wrap,
                    tab_size: self.tab_size,
                    line_numbers: self.line_numbers,
                    mouse_enabled: self.mouse_enabled,
                    sidebar_visible: self.sidebar_visible,
                    sidebar_width: self.sidebar_width,
                    comments_visible: self.comments_visible,
                    intelligence_mode: self.lsp.mode(),
                    theme_name: self.theme.display_name(),
                },
                area,
                &self.palette,
                buf,
            ),
            Mode::Hover => self.render_hover(area, buf),
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
                .render(area, buf);
            return;
        };
        if self.file_display == FileDisplay::Continuous {
            self.render_continuous_diff(area, buf);
            return;
        }
        let Some(file) = self.index.files.get(idx) else {
            return;
        };
        let file_row_count = file.row_count;
        self.viewport_height = area.height.max(1) as usize;
        let total = file.row_count as usize;
        if self.scroll + self.viewport_height > total {
            self.scroll = total.saturating_sub(self.viewport_height);
        }
        let hovered_row = self.mouse_position.and_then(|(column, row)| {
            contains(area, column, row)
                .then_some(self.scroll as u64 + row.saturating_sub(area.y) as u64)
        });
        let diagnostics = self.lsp.diagnostics_for(file.display_path());
        let tab_size =
            self.editorconfig
                .tab_size_for(&self.repo_root, file.display_path(), self.tab_size);
        let comments: &[ReviewComment] = if self.experience == Experience::Viewer {
            &[]
        } else {
            &self.comments
        };
        let annotation_revision = self.annotation_revision();
        render_card(
            &self.index,
            &mut self.diff_render_cache,
            idx,
            area,
            self.scroll as u64,
            self.cursor_row,
            self.visual_anchor.and_then(|(file, anchor)| {
                (file == idx).then_some((anchor.min(self.cursor_row), anchor.max(self.cursor_row)))
            }),
            hovered_row,
            self.horizontal_offset,
            self.wrap,
            self.split,
            self.line_numbers,
            tab_size,
            self.theme,
            comments,
            &diagnostics,
            annotation_revision,
            &self.palette,
            buf,
        );
        self.render_change_map(area, Some(idx), self.scroll as u64, file_row_count, buf);
    }

    fn render_active_file_header(&self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 {
            return;
        }
        let tokens = GridlineTokens::from(&self.palette);
        fill_area(area, tokens.surface, buf);
        let Some(index) = self.file_tree.selected_file_idx() else {
            buf.set_string(
                area.x + 2,
                area.y,
                "Local changes",
                Style::default().fg(tokens.muted).bg(tokens.surface),
            );
            return;
        };
        let Some(file) = self.index.files.get(index) else {
            return;
        };
        let path = file.display_path().to_string_lossy();
        let marker = match file.kind {
            IndexedChangeKind::Modified => "M",
            IndexedChangeKind::Added => "A",
            IndexedChangeKind::Deleted => "D",
            IndexedChangeKind::Renamed => "R",
            IndexedChangeKind::Untracked => "U",
            IndexedChangeKind::Binary => "B",
        };
        let comments = self
            .comments
            .iter()
            .filter(|comment| comment.file_path == path)
            .count();
        let diagnostics = self.lsp.diagnostic_count(file.display_path());
        let language_state = self.lsp.state_for_path(file.display_path());
        let viewed = self.viewed_paths.contains(file.display_path());
        let marker_color = match file.kind {
            IndexedChangeKind::Added | IndexedChangeKind::Untracked => tokens.positive,
            IndexedChangeKind::Deleted => tokens.negative,
            IndexedChangeKind::Binary => tokens.warning,
            IndexedChangeKind::Modified | IndexedChangeKind::Renamed => tokens.accent,
        };
        buf.set_string(
            area.x + 2,
            area.y,
            marker,
            Style::default()
                .fg(marker_color)
                .bg(tokens.surface)
                .add_modifier(Modifier::BOLD),
        );
        buf.set_string(
            area.x + 5,
            area.y,
            ellipsize(&path, area.width.saturating_sub(7) as usize),
            Style::default()
                .fg(tokens.text)
                .bg(tokens.surface)
                .add_modifier(Modifier::BOLD),
        );
        if area.height < 2 {
            return;
        }
        let mut x = render_change_counts(
            area.x + 5,
            area.y + 1,
            file.additions,
            file.deletions,
            tokens.surface,
            &self.palette,
            buf,
        );
        let end = area.x.saturating_add(area.width).saturating_sub(2);
        let mut metadata = vec![(
            format!("  {} hunks", file.hunks.len()),
            Style::default().fg(tokens.muted).bg(tokens.surface),
        )];
        if self.experience == Experience::Viewer {
            render_metadata_segments(&mut x, end, area.y + 1, metadata, buf);
            return;
        }
        if comments > 0 {
            metadata.push((
                format!("  {comments} comments"),
                Style::default().fg(tokens.info).bg(tokens.surface),
            ));
        }
        if diagnostics > 0 {
            metadata.push((
                format!("  {diagnostics} diagnostics"),
                Style::default().fg(tokens.warning).bg(tokens.surface),
            ));
        }
        if matches!(language_state, ServerState::Starting | ServerState::Error) {
            metadata.push((
                format!("  lsp {}", language_state.label()),
                Style::default().fg(tokens.warning).bg(tokens.surface),
            ));
        }
        metadata.push((
            if viewed {
                "  ✓ viewed".to_string()
            } else {
                "  unviewed".to_string()
            },
            Style::default()
                .fg(if viewed {
                    tokens.positive
                } else {
                    tokens.muted
                })
                .bg(tokens.surface),
        ));
        render_metadata_segments(&mut x, end, area.y + 1, metadata, buf);
    }

    fn render_continuous_diff(&mut self, area: Rect, buf: &mut Buffer) {
        self.viewport_height = area.height.max(1) as usize;
        let total = self.continuous_total_rows();
        if total == 0 {
            return;
        }
        self.continuous_cursor = self.continuous_cursor.min(total.saturating_sub(1));
        self.continuous_scroll = self
            .continuous_scroll
            .min(total.saturating_sub(area.height.max(1) as u64));
        self.sync_continuous_active();

        let mut global = self.continuous_scroll;
        let mut y = area.y;
        let bottom = area.y.saturating_add(area.height);
        while y < bottom && global < total {
            let Some((file_index, local_start)) = self.continuous_position(global) else {
                break;
            };
            let Some(file) = self.index.files.get(file_index) else {
                break;
            };
            let available = file.row_count.saturating_sub(local_start);
            if available == 0 {
                global = self.continuous_offset_for_file(file_index.saturating_add(1));
                continue;
            }
            let height = available.min(bottom.saturating_sub(y) as u64) as u16;
            let segment = Rect::new(area.x, y, area.width, height);
            let cursor = if global <= self.continuous_cursor
                && self.continuous_cursor < global.saturating_add(height as u64)
            {
                local_start + self.continuous_cursor.saturating_sub(global)
            } else {
                u64::MAX
            };
            let hovered = self.mouse_position.and_then(|(column, row)| {
                contains(segment, column, row)
                    .then_some(local_start + row.saturating_sub(segment.y) as u64)
            });
            let diagnostics = self.lsp.diagnostics_for(file.display_path());
            let tab_size =
                self.editorconfig
                    .tab_size_for(&self.repo_root, file.display_path(), self.tab_size);
            let comments: &[ReviewComment] = if self.experience == Experience::Viewer {
                &[]
            } else {
                &self.comments
            };
            let annotation_revision = self.annotation_revision();
            render_card(
                &self.index,
                &mut self.diff_render_cache,
                file_index,
                segment,
                local_start,
                cursor,
                self.visual_anchor.and_then(|(anchor_file, anchor)| {
                    (anchor_file == file_index)
                        .then_some((anchor.min(self.cursor_row), anchor.max(self.cursor_row)))
                }),
                hovered,
                self.horizontal_offset,
                self.wrap,
                self.split,
                self.line_numbers,
                tab_size,
                self.theme,
                comments,
                &diagnostics,
                annotation_revision,
                &self.palette,
                buf,
            );
            y = y.saturating_add(height);
            global = global.saturating_add(height as u64);
        }
        self.render_change_map(area, None, self.continuous_scroll, total, buf);
    }

    fn render_change_map(
        &mut self,
        area: Rect,
        single_file: Option<usize>,
        scroll: u64,
        total_rows: u64,
        buf: &mut Buffer,
    ) {
        if area.width < 8 || area.height < 3 || total_rows == 0 {
            return;
        }
        let tokens = GridlineTokens::from(&self.palette);
        let x = area.x + area.width - 1;
        for y in area.y..area.y + area.height {
            buf[(x, y)]
                .set_symbol("│")
                .set_style(Style::default().fg(tokens.rule_subtle).bg(tokens.canvas));
        }
        if self.experience == Experience::Review {
            let markers = self
                .render_metadata
                .change_map(&self.index, single_file, area.height);
            for (offset, marker) in markers.iter().enumerate() {
                let Some(marker) = marker else {
                    continue;
                };
                let color = match marker {
                    ChangeMapMarker::Added => tokens.positive,
                    ChangeMapMarker::Removed => tokens.negative,
                    ChangeMapMarker::Modified => tokens.accent,
                };
                let y = area.y.saturating_add(offset as u16);
                if y < area.y.saturating_add(area.height) {
                    buf[(x, y)]
                        .set_symbol("▪")
                        .set_style(Style::default().fg(color).bg(tokens.canvas));
                }
            }
        }
        let viewport_start = ((scroll.saturating_mul(area.height as u64) / total_rows) as u16)
            .min(area.height.saturating_sub(1));
        let viewport_rows = ((self.viewport_height as u64)
            .saturating_mul(area.height as u64)
            .div_ceil(total_rows))
        .max(1) as u16;
        for offset in 0..viewport_rows.min(area.height) {
            let y = area.y + (viewport_start + offset).min(area.height.saturating_sub(1));
            buf[(x, y)]
                .set_symbol("┃")
                .set_style(Style::default().fg(tokens.muted).bg(tokens.canvas));
        }
    }

    fn sync_file_tree_scroll_for(&mut self, body_height: usize) {
        let body_height = body_height.max(1);
        if self.file_tree.cursor < self.file_tree_scroll {
            self.file_tree_scroll = self.file_tree.cursor;
        } else if self.file_tree.cursor >= self.file_tree_scroll + body_height {
            self.file_tree_scroll = self.file_tree.cursor + 1 - body_height;
        }
    }

    fn render_header(&mut self, area: Rect, buf: &mut Buffer) {
        let tokens = GridlineTokens::from(&self.palette);
        fill_area(area, self.palette.bg, buf);
        let repo = self
            .repo_root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("repository");
        let title = if repo == "diffing" {
            "diffing".to_string()
        } else {
            format!("diffing · {repo}")
        };
        buf.set_string(
            area.x + 2,
            area.y,
            "diffing",
            Style::default()
                .fg(tokens.accent)
                .bg(tokens.canvas)
                .add_modifier(Modifier::BOLD),
        );
        if repo != "diffing" {
            buf.set_string(
                area.x + 9,
                area.y,
                "·",
                Style::default().fg(tokens.rule).bg(tokens.canvas),
            );
            buf.set_string(
                area.x + 11,
                area.y,
                repo,
                Style::default().fg(tokens.text).bg(tokens.canvas),
            );
        }
        let agent = if self.experience == Experience::Review
            && self
                .agent_api
                .as_ref()
                .is_some_and(|api| api.waiter_count() > 0)
        {
            "  agent"
        } else {
            ""
        };
        let file_count = format!("{} files", self.files.len());
        let additions = format!("+{}", self.index.additions);
        let deletions = format!("-{}", self.index.deletions);
        let indexing = if self.indexing { "  indexing" } else { "" };
        let summary_width: u16 = [
            file_count.as_str(),
            "  ",
            additions.as_str(),
            "  ",
            deletions.as_str(),
            agent,
            indexing,
        ]
        .iter()
        .map(|part| part.chars().count() as u16)
        .sum();
        let summary_x = area
            .x
            .saturating_add(area.width.saturating_sub(summary_width + 1));
        if summary_width + 14 < area.width {
            let mut x = summary_x;
            buf.set_string(
                x,
                area.y,
                &file_count,
                Style::default()
                    .fg(tokens.text_subtle)
                    .bg(tokens.canvas)
                    .add_modifier(Modifier::BOLD),
            );
            x += file_count.chars().count() as u16 + 2;
            x = render_change_counts(
                x,
                area.y,
                self.index.additions,
                self.index.deletions,
                self.palette.bg,
                &self.palette,
                buf,
            );
            if !agent.is_empty() {
                buf.set_string(
                    x,
                    area.y,
                    agent,
                    Style::default().fg(tokens.info).bg(tokens.canvas),
                );
                x += agent.chars().count() as u16;
            }
            if !indexing.is_empty() {
                buf.set_string(
                    x,
                    area.y,
                    indexing,
                    Style::default().fg(tokens.warning).bg(tokens.canvas),
                );
            }
        }
        let action_x = area.x + title.chars().count() as u16 + 5;
        if self.experience == Experience::Review && action_x + 15 < summary_x {
            let rect = render_chip(
                action_x,
                area.y,
                "S send review",
                true,
                self.mouse_position,
                &self.palette,
                buf,
            );
            self.regions.toolbar.push((rect, ToolbarAction::SendReview));
        }
        if area.height >= 2 {
            let detail = self
                .diff_context
                .detail
                .as_deref()
                .map(|detail| format!(" · {detail}"))
                .unwrap_or_default();
            let context = format!("{}{}", self.diff_context.headline, detail);
            let context = ellipsize(&context, area.width.saturating_sub(6) as usize);
            buf.set_string(
                area.x + 2,
                area.y + 1,
                self.diff_context.marker(),
                Style::default()
                    .fg(tokens.accent)
                    .bg(tokens.canvas)
                    .add_modifier(Modifier::BOLD),
            );
            buf.set_string(
                area.x + 4,
                area.y + 1,
                context,
                Style::default().fg(tokens.text_subtle).bg(tokens.canvas),
            );
        }
        horizontal_rule(
            Rect::new(
                area.x,
                area.y + area.height.saturating_sub(1),
                area.width,
                1,
            ),
            &self.palette,
            buf,
        );
    }

    fn render_theme_picker(&mut self, area: Rect, buf: &mut Buffer) {
        let tokens = GridlineTokens::from(&self.palette);
        dim_buffer(area, buf);
        let width = area.width.saturating_sub(METRICS.modal_margin_x).min(72);
        let height = area
            .height
            .saturating_sub(METRICS.modal_margin_y)
            .clamp(8, 24);
        let popup = Rect::new(
            area.x + area.width.saturating_sub(width) / 2,
            area.y + area.height.saturating_sub(height) / 2,
            width,
            height,
        );
        Clear.render(popup, buf);
        let block = overlay_block(" Themes ", &self.palette);
        let inner = block.inner(popup);
        block.render(popup, buf);
        buf.set_string(
            inner.x + 1,
            inner.y,
            format!("/ {}", self.modal_input),
            Style::default().fg(tokens.text).bg(tokens.element),
        );
        let themes = self.filtered_themes();
        self.theme_cursor = self.theme_cursor.min(themes.len().saturating_sub(1));
        let body_y = inner.y + 1 + METRICS.section_gap;
        let body_height = inner.height.saturating_sub(2 + METRICS.section_gap) as usize;
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
                    tokens.selected
                } else {
                    tokens.raised
                },
                buf,
            );
            let swatch = Palette::for_terminal(*theme);
            buf.set_string(
                row.x + 1,
                row.y,
                if selected { GLYPHS.cursor } else { " " },
                Style::default().fg(tokens.focus),
            );
            let row_bg = if selected {
                tokens.selected
            } else {
                tokens.raised
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
                Style::default().fg(tokens.text).bg(row_bg),
            );
            let kind = if theme.is_light() { "LIGHT" } else { "DARK" };
            let kind_x = row.x + row.width.saturating_sub(kind.len() as u16 + 2);
            buf.set_string(
                kind_x,
                row.y,
                kind,
                Style::default().fg(tokens.muted).bg(if selected {
                    tokens.selected
                } else {
                    tokens.raised
                }),
            );
            self.regions.theme_rows.push((row, *theme));
        }
        let footer = hint_line(
            "↑↓ preview · Enter apply · Esc restore",
            tokens.raised,
            &self.palette,
        );
        Paragraph::new(footer).render(
            Rect::new(
                inner.x + 1,
                inner.y + inner.height.saturating_sub(1),
                inner.width.saturating_sub(2),
                1,
            ),
            buf,
        );
    }

    fn render_help(&self, area: Rect, buf: &mut Buffer) {
        dim_buffer(area, buf);
        let width = area
            .width
            .saturating_sub(METRICS.modal_margin_x)
            .min(if area.width >= 78 { 112 } else { 72 });
        let height = area.height.saturating_sub(METRICS.modal_margin_y).min(32);
        let popup = Rect::new(
            area.x + area.width.saturating_sub(width) / 2,
            area.y + area.height.saturating_sub(height) / 2,
            width,
            height,
        );
        Clear.render(popup, buf);
        let help = if self.experience == Experience::Viewer {
            viewer_help_text()
        } else {
            help_text()
        };
        let inner_width = popup.width.saturating_sub(2) as usize;
        let help = if inner_width >= 72 {
            shortcut_help_columns(help, inner_width.saturating_sub(2) / 2, &self.palette)
        } else {
            shortcut_help(help, &self.palette)
        };
        Paragraph::new(help)
            .style(
                Style::default()
                    .fg(self.palette.fg)
                    .bg(self.palette.elevated),
            )
            .block(overlay_block(" Help ", &self.palette))
            .render(popup, buf);
    }

    fn render_search_palette(&self, area: Rect, buf: &mut Buffer) {
        let tokens = GridlineTokens::from(&self.palette);
        dim_buffer(area, buf);
        let width = area.width.saturating_sub(METRICS.modal_margin_x).min(132);
        let height = area
            .height
            .saturating_sub(METRICS.modal_margin_y)
            .clamp(10, 26);
        let popup = Rect::new(
            area.x + area.width.saturating_sub(width) / 2,
            area.y + area.height.saturating_sub(height) / 2,
            width,
            height,
        );
        Clear.render(popup, buf);
        fill_area(popup, self.palette.elevated, buf);
        let title = if self.repo_search_loading {
            " Search · loading "
        } else if self.repo_search_indexing {
            " Search · indexing "
        } else {
            " Search "
        };
        let block = overlay_block(
            Span::styled(
                title,
                Style::default()
                    .fg(self.palette.accent)
                    .add_modifier(Modifier::BOLD),
            ),
            &self.palette,
        );
        let inner = block.inner(popup);
        block.render(popup, buf);

        let scopes = [
            SearchScope::All,
            SearchScope::Files,
            SearchScope::Text,
            SearchScope::Symbols,
        ];
        let mut x = inner.x + 1;
        for scope in scopes {
            let active = scope == self.search_scope;
            let label = format!(" {} ", scope.label());
            if x + label.len() as u16 >= inner.x + inner.width {
                break;
            }
            buf.set_string(
                x,
                inner.y,
                &label,
                Style::default()
                    .fg(if active { tokens.text } else { tokens.muted })
                    .bg(if active {
                        tokens.selected
                    } else {
                        tokens.raised
                    })
                    .add_modifier(if active {
                        Modifier::BOLD
                    } else {
                        Modifier::empty()
                    }),
            );
            x += label.len() as u16 + 1;
        }
        let changed_label = if self.search_changed_only {
            " ✓ Changed "
        } else {
            " Changed "
        };
        let regex_label = if self.search_scope == SearchScope::Text {
            if self.search_regex {
                " .*✓ "
            } else {
                " .* "
            }
        } else {
            ""
        };
        let controls_width = changed_label.chars().count() as u16 + regex_label.len() as u16;
        if controls_width + 1 < inner.width {
            let controls_x = inner.x + inner.width - controls_width - 1;
            if !regex_label.is_empty() {
                buf.set_string(
                    controls_x,
                    inner.y,
                    regex_label,
                    Style::default()
                        .fg(if self.search_regex {
                            tokens.accent
                        } else {
                            tokens.muted
                        })
                        .bg(tokens.element),
                );
            }
            buf.set_string(
                controls_x + regex_label.len() as u16,
                inner.y,
                changed_label,
                Style::default()
                    .fg(if self.search_changed_only {
                        tokens.accent
                    } else {
                        tokens.muted
                    })
                    .bg(tokens.element),
            );
        }

        let input_y = inner.y + 1 + METRICS.section_gap;
        fill_area(
            Rect::new(inner.x, input_y, inner.width, 1),
            tokens.element,
            buf,
        );
        buf.set_string(
            inner.x + 1,
            input_y,
            format!("/ {}_", self.modal_input),
            Style::default().fg(tokens.text).bg(tokens.element),
        );

        let result_y = input_y + 1 + METRICS.section_gap;
        let result_height = inner
            .y
            .saturating_add(inner.height)
            .saturating_sub(result_y + 2) as usize;
        let body = Rect::new(
            inner.x,
            result_y,
            inner.width,
            result_height.min(u16::MAX as usize) as u16,
        );
        if inner.width >= 88 {
            let list_width = inner.width.saturating_mul(43) / 100;
            let list = Rect::new(body.x, body.y, list_width, body.height);
            let divider_x = list.x + list.width;
            for y in body.y..body.y.saturating_add(body.height) {
                buf[(divider_x, y)].set_symbol("│").set_style(
                    Style::default()
                        .fg(self.palette.border)
                        .bg(self.palette.elevated),
                );
            }
            let preview = Rect::new(
                divider_x.saturating_add(1),
                body.y,
                body.width.saturating_sub(list.width + 1),
                body.height,
            );
            self.render_search_results(list, buf);
            self.render_search_preview(preview, buf);
        } else {
            self.render_search_results(body, buf);
        }

        let shown = self.repo_search_hits.len();
        let count = if self.repo_search_total > shown {
            format!("{shown} of {}", self.repo_search_total)
        } else {
            format!("{shown}")
        };
        let footer = format!(
            "{count} result{} · Tab scope · ^G Changed · ↑↓ move · Enter jump · ⇧↑↓ preview · Esc close",
            if self.repo_search_total == 1 { "" } else { "s" }
        );
        buf.set_string(
            inner.x + 1,
            inner.y + inner.height.saturating_sub(1),
            ellipsize(&footer, inner.width.saturating_sub(2) as usize),
            Style::default()
                .fg(self.palette.dim)
                .bg(self.palette.elevated),
        );
    }

    fn render_search_results(&self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 {
            return;
        }
        if let Some(error) = self.repo_search_error.as_deref() {
            buf.set_string(
                area.x + 1,
                area.y,
                ellipsize(error, area.width.saturating_sub(2) as usize),
                Style::default()
                    .fg(self.palette.comment)
                    .bg(self.palette.elevated),
            );
        } else if self.repo_search_hits.is_empty() && !self.repo_search_loading {
            buf.set_string(
                area.x + 1,
                area.y,
                if self.modal_input.is_empty() {
                    "Start typing to search the repository"
                } else {
                    "No matches"
                },
                Style::default()
                    .fg(self.palette.dim)
                    .bg(self.palette.elevated),
            );
        } else {
            let scroll = self
                .search_cursor
                .saturating_sub(area.height.saturating_sub(1) as usize);
            for (visible, hit) in self
                .repo_search_hits
                .iter()
                .skip(scroll)
                .take(area.height as usize)
                .enumerate()
            {
                let index = scroll + visible;
                let row = Rect::new(area.x, area.y + visible as u16, area.width, 1);
                let selected = index == self.search_cursor;
                let background = if selected {
                    self.palette.selection_bg
                } else {
                    self.palette.elevated
                };
                fill_area(row, background, buf);
                let (icon, color) = match hit.kind {
                    SearchHitKind::File => ("F", self.palette.accent),
                    SearchHitKind::Text => ("T", self.palette.added),
                    SearchHitKind::Symbol => ("S", self.palette.comment),
                };
                buf.set_string(
                    row.x + 1,
                    row.y,
                    if selected { "›" } else { " " },
                    Style::default().fg(self.palette.accent).bg(background),
                );
                buf.set_string(
                    row.x + 3,
                    row.y,
                    icon,
                    Style::default()
                        .fg(color)
                        .bg(background)
                        .add_modifier(Modifier::BOLD),
                );
                let title_width = row.width.saturating_mul(2) / 3;
                buf.set_string(
                    row.x + 5,
                    row.y,
                    ellipsize(&hit.title, title_width.saturating_sub(6) as usize),
                    Style::default().fg(self.palette.fg).bg(background),
                );
                let detail_x = row.x + title_width;
                let in_diff = self
                    .index
                    .files
                    .iter()
                    .any(|file| file.display_path() == std::path::Path::new(&hit.path));
                let badge = if in_diff {
                    "DIFF"
                } else {
                    match hit.git_status.as_str() {
                        "modified" => "M",
                        "untracked" => "U",
                        "staged_new" | "added" => "A",
                        "deleted" => "D",
                        "renamed" => "R",
                        _ => "",
                    }
                };
                let badge_width = badge.len() as u16;
                let detail_end = row
                    .x
                    .saturating_add(row.width)
                    .saturating_sub(badge_width + 1);
                if detail_x < detail_end {
                    buf.set_string(
                        detail_x,
                        row.y,
                        ellipsize(
                            &hit.detail,
                            detail_end.saturating_sub(detail_x + 1) as usize,
                        ),
                        Style::default().fg(self.palette.dim).bg(background),
                    );
                }
                if !badge.is_empty() {
                    buf.set_string(
                        detail_end,
                        row.y,
                        badge,
                        Style::default()
                            .fg(if in_diff {
                                self.palette.accent
                            } else {
                                self.palette.warning
                            })
                            .bg(background)
                            .add_modifier(Modifier::BOLD),
                    );
                }
            }
        }
    }

    fn render_search_preview(&self, area: Rect, buf: &mut Buffer) {
        if area.width < 8 || area.height == 0 {
            return;
        }
        fill_area(area, self.palette.panel, buf);
        let selected = self.repo_search_hits.get(self.search_cursor);
        let path = self
            .search_preview
            .as_ref()
            .map(|preview| preview.path.as_str())
            .or_else(|| selected.map(|hit| hit.path.as_str()))
            .unwrap_or("Preview");
        buf.set_string(
            area.x + 1,
            area.y,
            ellipsize(path, area.width.saturating_sub(2) as usize),
            Style::default()
                .fg(self.palette.accent)
                .bg(self.palette.panel)
                .add_modifier(Modifier::BOLD),
        );
        let content_y = area.y.saturating_add(2);
        let content_height = area.height.saturating_sub(3);
        if self.search_preview_loading {
            buf.set_string(
                area.x + 1,
                content_y,
                "Loading preview…",
                Style::default().fg(self.palette.dim).bg(self.palette.panel),
            );
            return;
        }
        if let Some(error) = self.search_preview_error.as_deref() {
            buf.set_string(
                area.x + 1,
                content_y,
                ellipsize(error, area.width.saturating_sub(2) as usize),
                Style::default()
                    .fg(self.palette.comment)
                    .bg(self.palette.panel),
            );
            return;
        }
        let Some(preview) = self.search_preview.as_ref() else {
            buf.set_string(
                area.x + 1,
                content_y,
                "Select a result to preview",
                Style::default().fg(self.palette.dim).bg(self.palette.panel),
            );
            return;
        };
        if preview.binary || preview.missing {
            let message = if preview.binary {
                "Binary file — no preview"
            } else {
                "File not present in the working tree"
            };
            buf.set_string(
                area.x + 1,
                content_y,
                message,
                Style::default().fg(self.palette.dim).bg(self.palette.panel),
            );
            return;
        }

        let target_line = selected.and_then(|hit| hit.line);
        for (visible, (line_index, line)) in preview
            .content
            .lines()
            .enumerate()
            .skip(self.search_preview_scroll)
            .take(content_height as usize)
            .enumerate()
        {
            let y = content_y + visible as u16;
            let line_number = line_index + 1;
            let highlighted = target_line == Some(line_number as u32);
            let background = if highlighted {
                self.palette.selection_bg
            } else {
                self.palette.panel
            };
            fill_area(Rect::new(area.x, y, area.width, 1), background, buf);
            let gutter_width = 7u16.min(area.width);
            buf.set_string(
                area.x,
                y,
                format!("{line_number:>5} "),
                Style::default().fg(self.palette.gutter).bg(background),
            );
            let mut x = area.x.saturating_add(gutter_width);
            let end = area.x.saturating_add(area.width);
            for span in highlight_line(
                &preview.path,
                line.trim_end_matches('\r'),
                self.theme,
                &self.palette,
                background,
            )
            .iter()
            {
                if x >= end {
                    break;
                }
                let remaining = end.saturating_sub(x) as usize;
                let text: String = span.text.chars().take(remaining).collect();
                let used = text.chars().count() as u16;
                if used > 0 {
                    buf.set_string(x, y, text, span.style.bg(background));
                    x = x.saturating_add(used);
                }
            }
        }
        if preview.truncated && area.height > 1 {
            let label = " preview truncated ";
            let width = label.len() as u16;
            if width + 1 < area.width {
                buf.set_string(
                    area.x + area.width - width - 1,
                    area.y + area.height - 1,
                    label,
                    Style::default()
                        .fg(self.palette.warning)
                        .bg(self.palette.panel),
                );
            }
        }
    }

    fn render_hover(&self, area: Rect, buf: &mut Buffer) {
        let Some(content) = self.hover_content.as_deref() else {
            return;
        };
        dim_buffer(area, buf);
        let width = area.width.saturating_sub(METRICS.modal_margin_x).min(84);
        let height = area
            .height
            .saturating_sub(METRICS.modal_margin_y)
            .clamp(6, 24);
        let popup = Rect::new(
            area.x + area.width.saturating_sub(width) / 2,
            area.y + area.height.saturating_sub(height) / 2,
            width,
            height,
        );
        Clear.render(popup, buf);
        Paragraph::new(content)
            .style(
                Style::default()
                    .fg(self.palette.fg)
                    .bg(self.palette.elevated),
            )
            .wrap(Wrap { trim: false })
            .scroll((self.hover_scroll, 0))
            .block(overlay_block(" Hover ", &self.palette))
            .render(popup, buf);
    }

    fn render_prompt(&self, area: Rect, prefix: char, title: &str, buf: &mut Buffer) {
        dim_buffer(area, buf);
        let width = area.width.saturating_sub(METRICS.modal_margin_x).min(90);
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
            .block(overlay_block(format!(" {title} "), &self.palette))
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
    column.saturating_sub(root.x).clamp(
        METRICS.sidebar_min_width,
        root.width
            .saturating_sub(METRICS.content_min_width)
            .clamp(METRICS.sidebar_min_width, 72),
    )
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

fn render_change_counts(
    mut x: u16,
    y: u16,
    additions: u64,
    deletions: u64,
    background: Color,
    palette: &Palette,
    buf: &mut Buffer,
) -> u16 {
    let tokens = GridlineTokens::from(palette);
    let added = format!("+{additions}");
    buf.set_string(
        x,
        y,
        &added,
        Style::default()
            .fg(tokens.positive)
            .bg(background)
            .add_modifier(Modifier::BOLD),
    );
    x = x.saturating_add(added.chars().count() as u16 + 2);
    let removed = format!("-{deletions}");
    buf.set_string(
        x,
        y,
        &removed,
        Style::default()
            .fg(tokens.negative)
            .bg(background)
            .add_modifier(Modifier::BOLD),
    );
    x.saturating_add(removed.chars().count() as u16)
}

fn render_metadata_segments(
    x: &mut u16,
    end: u16,
    y: u16,
    segments: Vec<(String, Style)>,
    buf: &mut Buffer,
) {
    for (text, style) in segments {
        let width = text.chars().count() as u16;
        if (*x).saturating_add(width) > end {
            break;
        }
        buf.set_string(*x, y, text, style);
        *x = (*x).saturating_add(width);
    }
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

fn render_chip(
    x: u16,
    y: u16,
    label: &str,
    active: bool,
    pointer: Option<(u16, u16)>,
    palette: &Palette,
    buf: &mut Buffer,
) -> Rect {
    let tokens = GridlineTokens::from(palette);
    let width = label.chars().count() as u16 + 2;
    let area = Rect::new(x, y, width, 1);
    let hovered = pointer
        .map(|(column, row)| contains(area, column, row))
        .unwrap_or(false);
    let background = if hovered {
        tokens.selected
    } else if active {
        tokens.surface
    } else {
        tokens.canvas
    };
    fill_area(area, background, buf);
    if let Some((key, description)) = label.split_once(' ') {
        buf.set_string(
            x + 1,
            y,
            key,
            Style::default()
                .fg(if active || hovered {
                    tokens.accent
                } else {
                    tokens.muted
                })
                .bg(background)
                .add_modifier(Modifier::BOLD),
        );
        buf.set_string(
            x + 1 + key.chars().count() as u16,
            y,
            format!(" {description}"),
            Style::default()
                .fg(if active || hovered {
                    tokens.text
                } else {
                    tokens.muted
                })
                .bg(background),
        );
    } else {
        buf.set_string(
            x + 1,
            y,
            label,
            Style::default().fg(tokens.text).bg(background),
        );
    }
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

fn context_lines_from_args(args: &[String]) -> Option<u32> {
    let mut index = 0;
    let mut context = None;
    while index < args.len() {
        let arg = &args[index];
        if let Some(value) = arg.strip_prefix("--unified=") {
            context = value.parse().ok();
        } else if arg == "--unified" || arg == "-U" {
            if let Some(value) = args.get(index + 1) {
                context = value.parse().ok();
                index += 1;
            }
        } else if let Some(value) = arg.strip_prefix("-U") {
            if !value.is_empty() {
                context = value.parse().ok();
            }
        }
        index += 1;
    }
    context
}

fn with_context_lines(args: &[String], context: u32) -> Vec<String> {
    let mut output = Vec::with_capacity(args.len() + 1);
    let mut index = 0;
    let mut inserted = false;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--" && !inserted {
            output.push(format!("--unified={context}"));
            inserted = true;
        }
        if arg == "--unified" || arg == "-U" {
            index += 2;
            continue;
        }
        if arg.starts_with("--unified=")
            || (arg.starts_with("-U") && arg.len() > 2 && arg[2..].parse::<u32>().is_ok())
        {
            index += 1;
            continue;
        }
        output.push(arg.clone());
        index += 1;
    }
    if !inserted {
        output.push(format!("--unified={context}"));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_arguments_are_replaced_without_moving_pathspecs() {
        let args = vec![
            "--no-color".to_string(),
            "-U3".to_string(),
            "--".to_string(),
            "src/lib.rs".to_string(),
        ];
        assert_eq!(context_lines_from_args(&args), Some(3));
        assert_eq!(
            with_context_lines(&args, 25),
            vec!["--no-color", "--unified=25", "--", "src/lib.rs"]
        );
    }

    fn diff_line(kind: IndexedLineKind, old: Option<u32>, new: Option<u32>, text: &str) -> ViewRow {
        ViewRow::Line {
            hunk_index: 0,
            kind,
            old_lineno: old,
            new_lineno: new,
            content: text.to_string(),
        }
    }

    #[test]
    fn multi_line_comment_target_is_inclusive_and_preserves_source() {
        let target = inline_comment_target(
            "src/lib.rs".to_string(),
            vec![
                diff_line(IndexedLineKind::Context, Some(11), Some(11), "alpha"),
                diff_line(IndexedLineKind::Add, None, Some(12), "beta"),
                diff_line(IndexedLineKind::Add, None, Some(13), "gamma"),
            ],
        )
        .unwrap();
        assert_eq!(target.side, CommentSide::Additions);
        assert_eq!(target.start_line_number, Some(11));
        assert_eq!(target.line_number, 13);
        assert_eq!(target.line_content, "alpha\nbeta\ngamma");
    }

    #[test]
    fn deletion_ranges_keep_old_side_anchors() {
        let target = inline_comment_target(
            "src/lib.rs".to_string(),
            vec![
                diff_line(IndexedLineKind::Del, Some(7), None, "old one"),
                diff_line(IndexedLineKind::Del, Some(8), None, "old two"),
            ],
        )
        .unwrap();
        assert_eq!(target.side, CommentSide::Deletions);
        assert_eq!(target.start_line_number, Some(7));
        assert_eq!(target.line_number, 8);
    }

    #[test]
    fn multi_line_comment_target_rejects_cross_side_and_gapped_ranges() {
        let cross_side = inline_comment_target(
            "src/lib.rs".to_string(),
            vec![
                diff_line(IndexedLineKind::Del, Some(7), None, "old"),
                diff_line(IndexedLineKind::Add, None, Some(7), "new"),
            ],
        );
        assert_eq!(
            cross_side.unwrap_err(),
            "selection must stay on one diff side"
        );

        let gapped = inline_comment_target(
            "src/lib.rs".to_string(),
            vec![
                diff_line(IndexedLineKind::Add, None, Some(7), "one"),
                diff_line(IndexedLineKind::Add, None, Some(9), "three"),
            ],
        );
        assert_eq!(
            gapped.unwrap_err(),
            "selection must be contiguous on one diff side"
        );
    }

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

        let regions = UiRegions {
            toolbar: vec![(Rect::new(2, 1, 12, 1), ToolbarAction::SendReview)],
            diff_inner: Some(Rect::new(20, 4, 80, 20)),
            ..UiRegions::default()
        };
        assert_eq!(
            regions.pointer_visual_target(Some((3, 1))),
            PointerVisualTarget::Toolbar(ToolbarAction::SendReview)
        );
        assert_eq!(
            regions.pointer_visual_target(Some((40, 9))),
            PointerVisualTarget::DiffRow(9)
        );
        assert_eq!(
            regions.pointer_visual_target(Some((19, 9))),
            PointerVisualTarget::None
        );
    }

    #[test]
    fn render_metadata_maps_global_rows_with_prefix_offsets() {
        let metadata = DiffRenderMetadata {
            file_offsets: vec![0, 3, 3, 8],
            change_maps: VecDeque::new(),
        };
        assert_eq!(metadata.total_rows(), 8);
        assert_eq!(metadata.file_offset(0), 0);
        assert_eq!(metadata.file_offset(2), 3);
        assert_eq!(metadata.position(0), Some((0, 0)));
        assert_eq!(metadata.position(2), Some((0, 2)));
        assert_eq!(metadata.position(3), Some((2, 0)));
        assert_eq!(metadata.position(99), Some((2, 4)));
    }

    #[test]
    fn viewer_keeps_settings_and_commands_available() {
        assert!(!blocked_in_viewer(Action::OpenSettings));
        assert!(!blocked_in_viewer(Action::OpenCommand));
        assert!(!blocked_in_viewer(Action::LanguageHover));
        assert!(!blocked_in_viewer(Action::LanguageDefinition));
        assert!(blocked_in_viewer(Action::AddComment));
    }

    #[test]
    fn toolbar_labels_are_bounded_without_splitting_characters() {
        assert_eq!(ellipsize("GitHub Dark", 16), "GitHub Dark");
        assert_eq!(ellipsize("A very long theme", 8), "A very …");
    }

    #[test]
    fn change_counts_use_semantic_colors_and_generous_spacing() {
        let area = Rect::new(0, 0, 40, 1);
        let mut buffer = Buffer::empty(area);
        let palette = Palette::default();
        let end = render_change_counts(0, 0, 3290, 456, palette.bg, &palette, &mut buffer);

        assert_eq!(end, 11);
        assert_eq!(buffer[(0, 0)].symbol(), "+");
        assert_eq!(buffer[(0, 0)].style().fg, Some(palette.added));
        assert_eq!(buffer[(7, 0)].symbol(), "-");
        assert_eq!(buffer[(7, 0)].style().fg, Some(palette.removed));
    }

    #[test]
    fn search_results_keep_fff_order_with_changed_files_first() {
        let hit = |path: &str| SearchHit {
            kind: SearchHitKind::File,
            path: path.to_string(),
            line: None,
            title: path.to_string(),
            detail: String::new(),
            git_status: String::new(),
        };
        let changed = HashSet::from(["src/changed.rs".to_string()]);
        let ranked = diff_first_search_hits(
            vec![
                hit("src/outside-a.rs"),
                hit("src/changed.rs"),
                hit("src/outside-b.rs"),
            ],
            &changed,
        );
        assert_eq!(
            ranked
                .iter()
                .map(|hit| hit.path.as_str())
                .collect::<Vec<_>>(),
            ["src/changed.rs", "src/outside-a.rs", "src/outside-b.rs"]
        );
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
