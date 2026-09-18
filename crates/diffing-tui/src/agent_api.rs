//! Capability-scoped loopback API for headless agents.
//!
//! This intentionally serves small, paginated views backed by the same sparse
//! index as the TUI.  It is not a second diff engine and never binds beyond
//! loopback.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::inspect_scope::{
    directories, display_path, is_lockfile_noise, matching_indexes, parse_exclude, resolve_file,
    FileResolve,
};
use crate::inspect_snapshots::{Capture, InspectError, InspectSnapshots};
use anyhow::{Context, Result};
use diffing_core::comments::{
    CommentSeverity, CommentSide, CommentStatus, FileCommentStore, NewComment,
};
use diffing_core::index::DiffIndex;
use serde_json::{json, Value};

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_PAGE_LINES: usize = 1_000;
const MAX_CONCURRENT_CONNECTIONS: usize = 32;

#[derive(Clone)]
pub struct AgentApi {
    pub port: u16,
    pub capability: String,
    review: Arc<(Mutex<ReviewState>, Condvar)>,
    shutdown: Arc<Mutex<Option<mpsc::Sender<()>>>>,
}

impl Drop for AgentApi {
    fn drop(&mut self) {
        if Arc::strong_count(&self.shutdown) == 1 {
            if let Ok(mut guard) = self.shutdown.lock() {
                if let Some(shutdown) = guard.take() {
                    let _ = shutdown.send(());
                }
            }
        }
    }
}

#[derive(Default)]
struct ReviewState {
    round: u32,
    payload: Option<String>,
    waiters: u32,
}

struct ApiState {
    capability: String,
    repo_root: String,
    index: Arc<RwLock<Arc<DiffIndex>>>,
    review: Arc<(Mutex<ReviewState>, Condvar)>,
    snapshots: Mutex<InspectSnapshots>,
    capture_work: Mutex<()>,
}

impl AgentApi {
    pub fn start(repo_root: String, index: Arc<RwLock<Arc<DiffIndex>>>) -> Result<Self> {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).context("binding TUI agent API to loopback")?;
        let port = listener.local_addr()?.port();
        let capability = new_capability()?;
        let review = Arc::new((Mutex::new(ReviewState::default()), Condvar::new()));
        let state = Arc::new(ApiState {
            capability: capability.clone(),
            repo_root,
            index,
            review: review.clone(),
            snapshots: Mutex::new(
                InspectSnapshots::new().map_err(|error| anyhow::anyhow!(error.1))?,
            ),
            capture_work: Mutex::new(()),
        });
        let connection_slots = Arc::new(Mutex::new(0usize));
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let shutdown = Arc::new(Mutex::new(Some(shutdown_tx)));
        listener
            .set_nonblocking(true)
            .context("configuring TUI agent API listener")?;
        thread::Builder::new()
            .name("diffing-agent-api".to_string())
            .spawn(move || loop {
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }
                match listener.accept() {
                    Ok((stream, _)) => {
                        let state = state.clone();
                        let slots = connection_slots.clone();
                        let mut guard = match slots.lock() {
                            Ok(guard) => guard,
                            Err(_) => continue,
                        };
                        if *guard >= MAX_CONCURRENT_CONNECTIONS {
                            continue;
                        }
                        *guard += 1;
                        drop(guard);
                        let slots_for_handler = connection_slots.clone();
                        let spawned = thread::Builder::new()
                            .name("diffing-agent-request".to_string())
                            .spawn(move || {
                                let _ = handle_connection(stream, &state);
                                if let Ok(mut guard) = slots_for_handler.lock() {
                                    *guard = guard.saturating_sub(1);
                                }
                            });
                        if spawned.is_err() {
                            if let Ok(mut guard) = connection_slots.lock() {
                                *guard = guard.saturating_sub(1);
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            })?;
        Ok(Self {
            port,
            capability,
            review,
            shutdown,
        })
    }

    pub fn release_review(&self, payload: String) -> u32 {
        let (lock, wake) = &*self.review;
        let mut state = lock.lock().expect("review state poisoned");
        state.round = state.round.saturating_add(1);
        state.payload = Some(payload);
        let round = state.round;
        wake.notify_all();
        round
    }

    pub fn waiter_count(&self) -> u32 {
        self.review.0.lock().map(|state| state.waiters).unwrap_or(0)
    }
}

fn handle_connection(mut stream: TcpStream, state: &ApiState) -> Result<()> {
    // Accepted sockets inherit the listener's O_NONBLOCK.  A WouldBlock on the
    // first read used to drop the connection with no HTTP response.
    stream
        .set_nonblocking(false)
        .context("configuring TUI agent API connection")?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let request = read_request(&mut stream)?;
    let authorized = request
        .headers
        .get("x-diffing-capability")
        .is_some_and(|value| constant_time_eq(value, &state.capability));
    if !authorized {
        return write_json(
            &mut stream,
            401,
            json!({ "error": "invalid TUI session capability" }),
        );
    }
    let (path, query) = split_target(&request.target);
    let params = parse_query(query);
    let response = route(&request.method, path, &params, &request.body, state);
    match response {
        Ok((status, body)) => write_json(&mut stream, status, body),
        Err(error) => {
            if let Some(lease_error) =
                error.downcast_ref::<diffing_core::legacy_write_lease::LegacyWriteError>()
            {
                let code = lease_error.to_string();
                return write_json(&mut stream, 409, json!({ "error": code, "code": code }));
            }
            let message = error.to_string();
            let status = if message.starts_with("stale generation ") {
                409
            } else {
                500
            };
            write_json(&mut stream, status, json!({ "error": message }))
        }
    }
}

fn route(
    method: &str,
    path: &str,
    params: &HashMap<String, String>,
    body: &[u8],
    state: &ApiState,
) -> Result<(u16, Value)> {
    if method == "GET"
        && matches!(
            path,
            "/api/diff/summary"
                | "/api/diff/files"
                | "/api/diff/hunks"
                | "/api/diff/slice"
                | "/api/diff/search"
        )
    {
        return retained_inspect(path, params, state);
    }
    route_inner(method, path, params, body, state, None)
}

fn route_inner(
    method: &str,
    path: &str,
    params: &HashMap<String, String>,
    body: &[u8],
    state: &ApiState,
    retained: Option<&Arc<DiffIndex>>,
) -> Result<(u16, Value)> {
    if method == "GET" && path == "/api/diff/summary" {
        let index = retained.cloned().unwrap_or_else(|| current_index(state));
        let exclude = match parse_exclude(params.get("exclude").map(String::as_str)) {
            Ok(value) => value,
            Err(error) => return Ok((400, json!({ "error": error }))),
        };
        let skip_lockfiles = exclude.iter().any(|value| value == "lockfiles");
        let mut changes: HashMap<String, usize> = HashMap::new();
        let mut files = 0usize;
        let mut hunks = 0usize;
        let mut rows = 0u64;
        let mut additions = 0u64;
        let mut deletions = 0u64;
        for file in &index.files {
            if skip_lockfiles && is_lockfile_noise(&display_path(file)) {
                continue;
            }
            files += 1;
            hunks += file.hunks.len();
            rows += file.row_count;
            additions += file.additions;
            deletions += file.deletions;
            *changes
                .entry(format!("{:?}", file.kind).to_lowercase())
                .or_default() += 1;
        }
        let mut body = json!({
            "generation": index.generation,
            "complete": index.complete,
            "files": files,
            "hunks": hunks,
            "rows": rows,
            "additions": additions,
            "deletions": deletions,
            "patchBytes": index.patch_bytes,
            "changes": changes,
            "directories": directories(&index.files, skip_lockfiles),
            "next": ["diff_files", "diff_search", "diff_slice"]
        });
        if !exclude.is_empty() {
            body["exclude"] = json!(exclude);
        }
        return Ok((200, body));
    }
    if method == "GET" && path == "/api/diff/files" {
        for key in ["cursor", "limit", "generation"] {
            if let Some(value) = params.get(key) {
                if value.is_empty()
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                    || value
                        .parse::<u64>()
                        .map_or(true, |number| number > 9_007_199_254_740_991)
                {
                    return Ok((
                        400,
                        json!({
                            "error": format!("{key} must be a non-negative safe integer."),
                            "code": "invalid_continuation",
                            "recovery": "restart_files"
                        }),
                    ));
                }
            }
        }
        let cursor = usize_param(params, "cursor", 0);
        if cursor > 0 && !params.contains_key("generation") {
            return Ok((
                400,
                json!({
                    "error": "Numeric file cursors require generation; restart files and carry the returned generation.",
                    "code": "continuation_required",
                    "recovery": "restart_files"
                }),
            ));
        }
        let index = retained.cloned().unwrap_or_else(|| current_index(state));
        if let Some(generation) = params
            .get("generation")
            .and_then(|value| value.parse::<u64>().ok())
        {
            if generation != index.generation {
                return Ok((
                    409,
                    json!({
                        "error": format!("stale generation {generation}; current generation is {}", index.generation),
                        "code": "stale_generation",
                        "recovery": "restart_files"
                    }),
                ));
            }
        }
        let matched_indexes = match matching_indexes(&index, params.get("path").map(String::as_str))
        {
            Ok(value) => value,
            Err(response) => return Ok(response),
        };
        let limit = usize_param(params, "limit", 100).clamp(1, MAX_PAGE_LINES);
        let start = cursor.min(matched_indexes.len());
        let end = start.saturating_add(limit).min(matched_indexes.len());
        let files: Vec<Value> = matched_indexes[start..end]
            .iter()
            .map(|&file_index| {
                let file = &index.files[file_index];
                json!({
                    "index": file_index,
                    "path": display_path(file),
                    "oldPath": file.old_path,
                    "newPath": file.new_path,
                    "kind": file.kind,
                    "binary": file.is_binary,
                    "hunks": file.hunks.len(),
                    "rows": file.row_count,
                    "additions": file.additions,
                    "deletions": file.deletions,
                    "metadata": {
                        "oldMode": file.old_mode,
                        "newMode": file.new_mode,
                        "oldBlob": file.old_oid,
                        "newBlob": file.new_oid,
                        "submodule": file.old_mode.as_deref() == Some("160000") || file.new_mode.as_deref() == Some("160000"),
                    },
                })
            })
            .collect();
        let mut body = json!({
            "generation": index.generation,
            "returned": files.len(),
            "total": index.files.len(),
            "matched": matched_indexes.len(),
            "nextCursor": (end < matched_indexes.len()).then_some(end),
            "files": files,
        });
        if let Some(path) = params.get("path") {
            if !path.is_empty() {
                body["path"] = json!(path);
            }
        }
        return Ok((200, body));
    }
    if method == "GET" && path == "/api/diff/hunks" {
        let index = retained.cloned().unwrap_or_else(|| current_index(state));
        generation_guard(params, &index)?;
        let file_index = match resolve_file(
            &index,
            optional_usize(params, "file"),
            params.get("path").map(String::as_str),
        ) {
            FileResolve::Index(value) => value,
            FileResolve::Error { status, body } => return Ok((status, body)),
        };
        let Some(file) = index.files.get(file_index) else {
            return Ok((404, json!({ "error": "file index not found" })));
        };
        let cursor = usize_param(params, "cursor", 0).min(file.hunks.len());
        let limit = usize_param(params, "limit", 100).clamp(1, MAX_PAGE_LINES);
        let end = cursor.saturating_add(limit).min(file.hunks.len());
        return Ok((
            200,
            json!({
                "generation": index.generation,
                "file": file_index,
                "path": display_path(file),
                "returned": end - cursor,
                "total": file.hunks.len(),
                "nextCursor": (end < file.hunks.len()).then_some(end),
                "hunks": &file.hunks[cursor..end],
            }),
        ));
    }
    if method == "GET" && path == "/api/diff/slice" {
        let index = retained.cloned().unwrap_or_else(|| current_index(state));
        generation_guard(params, &index)?;
        let file = match resolve_file(
            &index,
            optional_usize(params, "file"),
            params.get("path").map(String::as_str),
        ) {
            FileResolve::Index(value) => value,
            FileResolve::Error { status, body } => return Ok((status, body)),
        };
        let start = u64_param(params, "start", 0);
        let max_lines = usize_param(params, "maxLines", 120).clamp(1, MAX_PAGE_LINES);
        let max_bytes = usize_param(params, "maxBytes", 256 * 1024).clamp(1, MAX_BODY_BYTES);
        let viewport = index.viewport(file, start, max_lines, max_bytes)?;
        return Ok((200, serde_json::to_value(viewport)?));
    }
    if method == "GET" && path == "/api/diff/search" {
        let index = retained.cloned().unwrap_or_else(|| current_index(state));
        generation_guard(params, &index)?;
        let query = params.get("q").map(String::as_str).unwrap_or("");
        let file = usize_param(params, "file", 0);
        let row = u64_param(params, "row", 0);
        let limit = usize_param(params, "limit", 100).clamp(1, MAX_PAGE_LINES);
        let max_bytes = usize_param(params, "maxBytes", 256 * 1024).clamp(1, MAX_BODY_BYTES);
        let allowed: HashSet<usize> =
            match matching_indexes(&index, params.get("path").map(String::as_str)) {
                Ok(indexes) => indexes.into_iter().collect(),
                Err(response) => return Ok(response),
            };
        let page =
            index.search_literal_filtered(query, file, row, limit, max_bytes, Some(&allowed))?;
        return Ok((200, serde_json::to_value(page)?));
    }
    let store = FileCommentStore::new(&state.repo_root);
    if method == "GET" && path == "/api/comments" {
        return Ok((200, serde_json::to_value(store.load()?)?));
    }
    if method == "POST" && path == "/api/comments" {
        let value = match parse_json_body(body) {
            Ok(value) => value,
            Err(response) => return Ok(response),
        };
        let file_path = value.get("filePath").and_then(Value::as_str).unwrap_or("");
        let line_number = match optional_u32_field(&value, "lineNumber") {
            Ok(value) => value.unwrap_or(0),
            Err(response) => return Ok(response),
        };
        let start_line_number = match optional_u32_field(&value, "startLineNumber") {
            Ok(value) => value,
            Err(response) => return Ok(response),
        };
        let comment_body = value.get("body").and_then(Value::as_str).unwrap_or("");
        if file_path.is_empty() || comment_body.trim().is_empty() {
            return Ok((400, json!({ "error": "filePath and body are required" })));
        }
        let side = if value.get("side").and_then(Value::as_str) == Some("deletions") {
            CommentSide::Deletions
        } else {
            CommentSide::Additions
        };
        let severity = match value.get("severity").and_then(Value::as_str) {
            Some("blocking") => Some(CommentSeverity::Blocking),
            Some("nit") => Some(CommentSeverity::Nit),
            Some("question") => Some(CommentSeverity::Question),
            Some("praise") => Some(CommentSeverity::Praise),
            _ => None,
        };
        let source_anchor = match (value.get("snapshotId"), value.get("fileIndex")) {
            (None, None) => None,
            (Some(snapshot), Some(file)) => {
                let (Some(snapshot), Some(file)) = (
                    snapshot.as_str(),
                    file.as_u64().and_then(|file| usize::try_from(file).ok()),
                ) else {
                    return Ok(inspect_error(InspectError(400, "invalid_anchor")));
                };
                let capture = match state
                    .snapshots
                    .lock()
                    .map_err(|_| anyhow::anyhow!("snapshot state poisoned"))?
                    .get(snapshot, now_ms())
                {
                    Ok(capture) => capture,
                    Err(error) => return Ok(inspect_error(error)),
                };
                let anchor = match capture.anchor(
                    file,
                    value.get("side").and_then(Value::as_str).unwrap_or(""),
                    start_line_number.unwrap_or(line_number),
                    line_number,
                ) {
                    Ok(anchor) => anchor,
                    Err(error) => return Ok(inspect_error(error)),
                };
                if anchor["file"]["oldPath"].as_str() != Some(file_path)
                    && anchor["file"]["newPath"].as_str() != Some(file_path)
                {
                    return Ok(inspect_error(InspectError(400, "invalid_anchor")));
                }
                Some(anchor)
            }
            _ => return Ok(inspect_error(InspectError(400, "invalid_anchor"))),
        };
        let new_comment = if line_number == 0 {
            NewComment::FileLevel {
                file_path,
                body: comment_body,
                severity,
            }
        } else {
            NewComment::Inline {
                file_path,
                side,
                start_line_number,
                line_number,
                line_content: value
                    .get("lineContent")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                body: comment_body,
                severity,
            }
        };
        let comment = store.add_with_source_anchor(new_comment, now_ms(), source_anchor)?;
        return Ok((200, serde_json::to_value(comment)?));
    }
    if let Some(id) = path.strip_prefix("/api/comments/") {
        if let Some(id) = id.strip_suffix("/replies") {
            if method == "POST" {
                let value = match parse_json_body(body) {
                    Ok(value) => value,
                    Err(response) => return Ok(response),
                };
                let reply = store.add_reply(
                    id,
                    value.get("body").and_then(Value::as_str).unwrap_or(""),
                    value.get("role").and_then(Value::as_str),
                    value.get("model").and_then(Value::as_str),
                    now_ms(),
                )?;
                return Ok((
                    if reply.is_some() { 200 } else { 404 },
                    serde_json::to_value(reply)?,
                ));
            }
        } else if method == "PUT" {
            let value = match parse_json_body(body) {
                Ok(value) => value,
                Err(response) => return Ok(response),
            };
            let status = match value.get("status").and_then(Value::as_str) {
                Some("resolved") => Some(CommentStatus::Resolved),
                Some("open") => Some(CommentStatus::Open),
                _ => None,
            };
            let updated = store.update(id, value.get("body").and_then(Value::as_str), status)?;
            return Ok((
                if updated.is_some() { 200 } else { 404 },
                serde_json::to_value(updated)?,
            ));
        } else if method == "DELETE" {
            let removed = store.remove(id)?;
            return Ok((
                if removed { 200 } else { 404 },
                json!({ "removed": removed }),
            ));
        }
    }
    if method == "GET" && path == "/api/review/status" {
        let review = state.review.0.lock().expect("review state poisoned");
        return Ok((
            200,
            json!({ "round": review.round, "waiters": review.waiters }),
        ));
    }
    if method == "GET" && path == "/api/review/await" {
        let since = u32_param(params, "sinceRound", 0);
        let timeout = u64_param(params, "timeoutMs", 25_000).clamp(1, 30_000);
        let (lock, wake) = &*state.review;
        let mut review = lock.lock().expect("review state poisoned");
        review.waiters = review.waiters.saturating_add(1);
        if review.round <= since {
            let result = wake
                .wait_timeout(review, Duration::from_millis(timeout))
                .expect("review state poisoned");
            review = result.0;
        }
        review.waiters = review.waiters.saturating_sub(1);
        if review.round > since {
            return Ok((
                200,
                json!({
                    "status": "released",
                    "payload": { "round": review.round, "commentXml": review.payload.clone().unwrap_or_default() }
                }),
            ));
        }
        return Ok((200, json!({ "status": "timeout", "round": review.round })));
    }
    Ok((404, json!({ "error": "unknown TUI API route" })))
}

fn current_index(state: &ApiState) -> Arc<DiffIndex> {
    state.index.read().expect("index state poisoned").clone()
}

fn inspect_error(error: InspectError) -> (u16, Value) {
    (
        error.0,
        json!({ "code": error.1, "error": error.1, "recovery": "restart_files" }),
    )
}

fn retained_inspect(
    path: &str,
    params: &HashMap<String, String>,
    state: &ApiState,
) -> Result<(u16, Value)> {
    let invalid = || inspect_error(InspectError(400, "invalid_continuation"));
    let operation = path.rsplit('/').next().unwrap_or("");
    for key in [
        "cursor",
        "limit",
        "generation",
        "file",
        "row",
        "start",
        "maxLines",
        "maxBytes",
    ] {
        if let Some(value) = params.get(key) {
            if value.is_empty()
                || !value.bytes().all(|byte| byte.is_ascii_digit())
                || value
                    .parse::<u64>()
                    .map_or(true, |number| number > 9_007_199_254_740_991)
            {
                return Ok(invalid());
            }
        }
    }
    if params.contains_key("continuation") && params.len() != 1 {
        return Ok(invalid());
    }
    // Keep every generated token usable by the CLI/MCP's 16 KiB contract,
    // including JSON escaping, UTF-8, envelope fields and base64 expansion.
    if !params.contains_key("continuation") && serde_json::to_vec(params)?.len() > 8 * 1024 {
        return Ok(invalid());
    }
    if !params.contains_key("continuation")
        && !params.contains_key("snapshotId")
        && !params.contains_key("generation")
        && ["cursor", "start", "row"]
            .iter()
            .any(|key| u64_param(params, key, 0) > 0)
    {
        return Ok(inspect_error(InspectError(400, "continuation_required")));
    }
    let now = now_ms();
    let fresh = !params.contains_key("snapshotId") && !params.contains_key("continuation");
    let _capture_permit = if fresh {
        match state.capture_work.try_lock() {
            Ok(permit) => Some(permit),
            Err(_) => return Ok(inspect_error(InspectError(503, "capture_busy"))),
        }
    } else {
        None
    };
    let prepared = if fresh {
        let budget = usize_param(params, "maxBytes", 256 * 1024);
        if !(512..=MAX_BODY_BYTES).contains(&budget) {
            return Ok(invalid());
        }
        // A slow source capture must not block historical pages or multiply
        // large Git buffers across the connection pool. New captures retry
        // explicitly; retained reads do not need this permit.
        let current = current_index(state);
        if params
            .get("generation")
            .is_some_and(|value| value.parse::<u64>().ok() != Some(current.generation))
        {
            return Ok(inspect_error(InspectError(409, "stale_generation")));
        }
        match InspectSnapshots::prepare(&current, now) {
            Ok(capture) => Some(capture),
            Err(error) => return Ok(inspect_error(error)),
        }
    } else {
        None
    };
    let mut snapshots = state
        .snapshots
        .lock()
        .map_err(|_| anyhow::anyhow!("snapshot state poisoned"))?;
    let (capture, mut query) = if let Some(token) = params.get("continuation") {
        match snapshots.resume(token, operation, now) {
            Ok((capture, query)) => (capture, query.into_iter().collect::<HashMap<_, _>>()),
            Err(error) => return Ok(inspect_error(error)),
        }
    } else {
        let mut query = params.clone();
        let capture = if let Some(id) = query.remove("snapshotId") {
            snapshots.get(&id, now)
        } else {
            Ok(snapshots.retain(prepared.expect("fresh capture was prepared"), now))
        };
        match capture {
            Ok(capture) => (capture, query),
            Err(error) => return Ok(inspect_error(error)),
        }
    };
    if query
        .get("generation")
        .is_some_and(|value| value.parse::<u64>().ok() != Some(capture.index.generation))
    {
        return Ok(inspect_error(InspectError(409, "stale_generation")));
    }
    let budget = usize_param(&query, "maxBytes", 256 * 1024);
    if !(512..=MAX_BODY_BYTES).contains(&budget) {
        return Ok(invalid());
    }
    query.insert("generation".into(), capture.index.generation.to_string());
    let (status, raw) = match route_inner("GET", path, &query, b"", state, Some(&capture.index)) {
        Ok(response) => response,
        Err(_) => return Ok(inspect_error(InspectError(503, "source_unavailable"))),
    };
    if status != 200 {
        return Ok((status, raw));
    }
    let array = match operation {
        "files" => "files",
        "hunks" => "hunks",
        "slice" => "rows",
        "search" => "hits",
        _ => "",
    };
    let length = raw.get(array).and_then(Value::as_array).map_or(0, Vec::len);
    let assemble = |count, omit| {
        bounded_inspect_page(&snapshots, &capture, operation, &query, &raw, count, omit)
    };
    let full = assemble(length, false);
    if serde_json::to_vec(&full)?.len() <= budget {
        return Ok((200, full));
    }
    let mut best = None;
    let mut low = 1;
    let mut high = length.saturating_sub(1);
    while low <= high {
        let count = low + (high - low) / 2;
        let candidate = assemble(count, false);
        if serde_json::to_vec(&candidate)?.len() <= budget {
            best = Some(candidate);
            low = count + 1;
        } else {
            high = count - 1;
        }
    }
    if let Some(page) = best {
        return Ok((200, page));
    }
    let omission = assemble(0, length > 0);
    if serde_json::to_vec(&omission)?.len() <= budget {
        return Ok((200, omission));
    }
    Ok(inspect_error(InspectError(413, "response_too_large")))
}

fn bounded_inspect_page(
    cache: &InspectSnapshots,
    capture: &Capture,
    operation: &str,
    query: &HashMap<String, String>,
    raw: &Value,
    count: usize,
    omit: bool,
) -> Value {
    let mut page = raw.clone();
    let consumed = if omit { 1 } else { count } as u64;
    let mut next = query.clone();
    let more = match operation {
        "files" | "hunks" => {
            let array = if operation == "files" {
                "files"
            } else {
                "hunks"
            };
            page[array] = json!(&raw[array].as_array().unwrap()[..count]);
            if operation == "files" {
                for file in page[array].as_array_mut().unwrap() {
                    if let Some(anchor) = file["index"]
                        .as_u64()
                        .and_then(|index| capture.anchors.get(index as usize))
                    {
                        file["metadata"]["patchDigest"] = anchor["file"]["contentDigest"].clone();
                        file["sourceAnchor"] = anchor.clone();
                    }
                }
            }
            page["returned"] = json!(count);
            let total = raw[if operation == "files" {
                "matched"
            } else {
                "total"
            }]
            .as_u64()
            .unwrap_or(0);
            let cursor = u64_param(query, "cursor", 0).min(total) + consumed;
            page["nextCursor"] = json!((cursor < total).then_some(cursor));
            next.insert("cursor".into(), cursor.to_string());
            cursor < total
        }
        "slice" => {
            page["rows"] = json!(&raw["rows"].as_array().unwrap()[..count]);
            let cursor = raw["startRow"].as_u64().unwrap_or(0) + consumed;
            let more = cursor < raw["totalRows"].as_u64().unwrap_or(0);
            page["nextRow"] = json!(more.then_some(cursor));
            page["truncated"] = json!(more || omit);
            next.insert("start".into(), cursor.to_string());
            more
        }
        "search" => {
            let hits = raw["hits"].as_array().unwrap();
            page["hits"] = json!(&hits[..count]);
            let excluded = hits.get(consumed as usize);
            let file = excluded
                .and_then(|hit| hit["fileIndex"].as_u64())
                .or(raw["nextFile"].as_u64());
            let row = excluded
                .and_then(|hit| hit["row"].as_u64())
                .or(raw["nextRow"].as_u64());
            page["nextFile"] = json!(file);
            page["nextRow"] = json!(row);
            page["truncated"] = json!(file.is_some() || omit);
            if let Some(file) = file {
                next.insert("file".into(), file.to_string());
                next.insert("row".into(), row.unwrap_or(0).to_string());
            }
            file.is_some()
        }
        _ => false,
    };
    page["snapshotId"] = json!(capture.id);
    page["expiresAt"] = json!(capture.expires_at);
    page["freshness"] = json!("not-checked");
    page["complete"] = json!(capture.index.complete);
    if let Some(manifest) = &capture.index.manifest {
        page["manifest"] = json!(manifest);
    }
    page["nextContinuation"] = if more {
        json!(cache.encode(capture, operation, next.into_iter().collect()))
    } else {
        Value::Null
    };
    if omit {
        page["omitted"] = json!({ "reason": "row_too_large", "count": 1 });
    }
    if page.get("estimatedBytes").is_some() {
        page["estimatedBytes"] = json!(0);
        loop {
            let bytes = serde_json::to_vec(&page)
                .expect("serializing inspect page")
                .len();
            if page["estimatedBytes"].as_u64() == Some(bytes as u64) {
                break;
            }
            page["estimatedBytes"] = json!(bytes);
        }
    }
    page
}

fn generation_guard(params: &HashMap<String, String>, index: &DiffIndex) -> Result<()> {
    if let Some(generation) = params
        .get("generation")
        .and_then(|value| value.parse::<u64>().ok())
    {
        anyhow::ensure!(
            generation == index.generation,
            "stale generation {generation}; current generation is {}",
            index.generation
        );
    }
    Ok(())
}

struct Request {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request> {
    let mut bytes = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut chunk)?;
        anyhow::ensure!(read > 0, "client closed before sending headers");
        bytes.extend_from_slice(&chunk[..read]);
        anyhow::ensure!(bytes.len() <= MAX_HEADER_BYTES, "request headers too large");
        if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break end + 4;
        }
    };
    let headers_text = String::from_utf8_lossy(&bytes[..header_end]);
    let mut lines = headers_text.split("\r\n");
    let request_line = lines.next().context("missing HTTP request line")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().context("missing HTTP method")?.to_string();
    let target = parts.next().context("missing HTTP target")?.to_string();
    let mut headers = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    anyhow::ensure!(content_length <= MAX_BODY_BYTES, "request body too large");
    while bytes.len() - header_end < content_length {
        let read = stream.read(&mut chunk)?;
        anyhow::ensure!(read > 0, "client closed before request body completed");
        bytes.extend_from_slice(&chunk[..read]);
    }
    Ok(Request {
        method,
        target,
        headers,
        body: bytes[header_end..header_end + content_length].to_vec(),
    })
}

fn write_json(stream: &mut TcpStream, status: u16, body: Value) -> Result<()> {
    let bytes = serde_json::to_vec(&body)?;
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        _ => "Internal Server Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        bytes.len()
    )?;
    stream.write_all(&bytes)?;
    stream.flush()?;
    Ok(())
}

fn split_target(target: &str) -> (&str, &str) {
    target.split_once('?').unwrap_or((target, ""))
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            (percent_decode(key), percent_decode(value))
        })
        .collect()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            b'%' => {
                let hex = match bytes.get(index + 1..index + 3) {
                    Some(slice) => std::str::from_utf8(slice).ok(),
                    None => None,
                };
                if let Some(hex) = hex {
                    if let Ok(byte) = u8::from_str_radix(hex, 16) {
                        decoded.push(byte);
                        index += 3;
                        continue;
                    }
                }
                decoded.push(bytes[index]);
                index += 1;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (left_byte, right_byte) in left.bytes().zip(right.bytes()) {
        diff |= left_byte ^ right_byte;
    }
    diff == 0
}

fn usize_param(params: &HashMap<String, String>, name: &str, default: usize) -> usize {
    params
        .get(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn optional_usize(params: &HashMap<String, String>, name: &str) -> Option<usize> {
    params.get(name).and_then(|value| value.parse().ok())
}

fn u64_param(params: &HashMap<String, String>, name: &str, default: u64) -> u64 {
    params
        .get(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn u32_param(params: &HashMap<String, String>, name: &str, default: u32) -> u32 {
    params
        .get(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn parse_json_body(body: &[u8]) -> Result<Value, (u16, Value)> {
    serde_json::from_slice(body).map_err(|error| {
        (
            400,
            json!({ "error": format!("invalid JSON body: {error}") }),
        )
    })
}

fn optional_u32_field(value: &Value, field: &str) -> Result<Option<u32>, (u16, Value)> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(number) => number
            .as_u64()
            .ok_or_else(|| {
                (
                    400,
                    json!({ "error": format!("{field} must be a non-negative integer") }),
                )
            })
            .and_then(|line| {
                u32::try_from(line)
                    .map_err(|_| (400, json!({ "error": format!("{field} out of range") })))
            })
            .map(Some),
    }
}

fn new_capability() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| anyhow::anyhow!("generating TUI session capability: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn query_decoder_handles_spaces_multibyte_and_percent_encoding() {
        let params = parse_query("q=hello+world%21&limit=10");
        assert_eq!(params.get("q").map(String::as_str), Some("hello world!"));
        assert_eq!(usize_param(&params, "limit", 1), 10);

        let adversarial = parse_query("q=%E2%82%AC&broken=%E");
        assert_eq!(adversarial.get("q").map(String::as_str), Some("€"));
        assert_eq!(adversarial.get("broken").map(String::as_str), Some("%E"));
    }

    #[test]
    fn constant_time_capability_compare_matches_equal_values() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "ab"));
    }

    #[test]
    fn capabilities_are_full_width_and_unique() {
        let first = new_capability().unwrap();
        let second = new_capability().unwrap();
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
    }

    #[test]
    fn native_manifest_is_retained_and_pages_do_not_reopen_git() {
        let repo = tempfile::tempdir().unwrap();
        let root = repo.path().to_str().unwrap().to_owned();
        assert!(std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(&root)
            .status()
            .unwrap()
            .success());
        std::fs::write(repo.path().join("a.txt"), "first\n").unwrap();
        std::fs::write(repo.path().join("b.txt"), "second\n").unwrap();
        let index = diffing_core::index::build_git_diff_index(&root, &[], |_| {}).unwrap();
        let spool = index.spool_path.clone();
        let state = ApiState {
            repo_root: root.clone(),
            index: Arc::new(RwLock::new(Arc::new(index))),
            capability: "cap".into(),
            review: Arc::new((Mutex::new(ReviewState::default()), Condvar::new())),
            snapshots: Mutex::new(InspectSnapshots::new().unwrap()),
            capture_work: Mutex::new(()),
        };
        let first_query = HashMap::from([("limit".into(), "1".into())]);
        let (status, first) = route("GET", "/api/diff/files", &first_query, b"", &state).unwrap();
        assert_eq!(status, 200, "{first}");
        assert_eq!(first["manifest"]["snapshotId"], first["snapshotId"]);
        assert_eq!(first["manifest"]["consistency"], "optimistic-validated");
        assert_eq!(first["manifest"]["layers"][0]["fileCount"], 2);
        assert_eq!(first["files"][0]["path"], "a.txt");
        assert_eq!(
            first["files"][0]["sourceAnchor"]["snapshotId"],
            first["snapshotId"]
        );
        assert_eq!(
            first["files"][0]["metadata"]["patchDigest"],
            first["files"][0]["sourceAnchor"]["file"]["contentDigest"]
        );
        let manifest = first["manifest"].clone();
        {
            let _capture_in_progress = state.capture_work.lock().unwrap();
            let (status, body) =
                route("GET", "/api/diff/files", &first_query, b"", &state).unwrap();
            assert_eq!(status, 503);
            assert_eq!(body["code"], "capture_busy");
            let existing = HashMap::from([(
                "snapshotId".into(),
                first["snapshotId"].as_str().unwrap().into(),
            )]);
            let (status, body) = route("GET", "/api/diff/files", &existing, b"", &state).unwrap();
            assert_eq!(status, 200);
            assert_eq!(body["manifest"], manifest);
        }
        std::fs::write(repo.path().join("a.txt"), "changed\n").unwrap();
        let (status, error) = route("GET", "/api/diff/files", &first_query, b"", &state).unwrap();
        assert_eq!(status, 409);
        assert_eq!(error["code"], "inconsistent_capture");
        // A continuation must not run Git or touch the original spool. Removing
        // both makes any accidental fresh collection fail deterministically.
        std::fs::remove_dir_all(repo.path().join(".git")).unwrap();
        std::fs::remove_file(spool).unwrap();
        let continuation = HashMap::from([(
            "continuation".into(),
            first["nextContinuation"].as_str().unwrap().into(),
        )]);
        let (status, second) = route("GET", "/api/diff/files", &continuation, b"", &state).unwrap();
        assert_eq!(status, 200, "{second}");
        assert_eq!(second["manifest"], manifest);
        assert_eq!(second["files"][0]["path"], "b.txt");
        assert!(second["nextContinuation"].is_null());
        // Creating feedback against a retained capture must keep its historical
        // identity even after the live source and original spool disappear.
        let comment_request = json!({
            "snapshotId": first["snapshotId"], "fileIndex": 0,
            "filePath": "a.txt", "side": "additions", "lineNumber": 1,
            "lineContent": "first", "body": "historical feedback",
        });
        let (status, comment) = route(
            "POST",
            "/api/comments",
            &HashMap::new(),
            &serde_json::to_vec(&comment_request).unwrap(),
            &state,
        )
        .unwrap();
        assert_eq!(status, 200, "{comment}");
        assert_eq!(comment["sourceAnchor"]["snapshotId"], first["snapshotId"]);
        assert_eq!(comment["sourceAnchor"]["file"]["newPath"], "a.txt");
        assert_eq!(
            comment["sourceAnchor"]["range"],
            json!({"side": "additions", "start": 1, "end": 1})
        );
        assert_eq!(
            FileCommentStore::new(&root).load().unwrap()[0].extra["sourceAnchor"],
            comment["sourceAnchor"]
        );
        for invalid in [
            json!({"snapshotId": "missing"}),
            json!({"fileIndex": 10}),
            json!({"filePath": "b.txt"}),
            json!({"lineNumber": 2}),
            json!({"side": "deletions"}),
            json!({"fileIndex": null}),
            json!({"snapshotId": null}),
        ] {
            let mut request = comment_request.clone();
            request
                .as_object_mut()
                .unwrap()
                .extend(invalid.as_object().unwrap().clone());
            let (status, _) = route(
                "POST",
                "/api/comments",
                &HashMap::new(),
                &serde_json::to_vec(&request).unwrap(),
                &state,
            )
            .unwrap();
            assert!(status == 400 || status == 410, "{request}: {status}");
        }
        for key in ["snapshotId", "fileIndex"] {
            let mut request = comment_request.clone();
            request.as_object_mut().unwrap().remove(key);
            let (status, _) = route(
                "POST",
                "/api/comments",
                &HashMap::new(),
                &serde_json::to_vec(&request).unwrap(),
                &state,
            )
            .unwrap();
            assert_eq!(status, 400);
        }
        assert_eq!(FileCommentStore::new(&root).load().unwrap().len(), 1);
        let query = HashMap::from([
            (
                "snapshotId".into(),
                first["snapshotId"].as_str().unwrap().into(),
            ),
            ("file".into(), "0".into()),
        ]);
        let (status, slice) = route("GET", "/api/diff/slice", &query, b"", &state).unwrap();
        assert_eq!(status, 200);
        assert!(slice["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["content"] == "first"));
        let mut small = query.clone();
        small.insert("maxBytes".into(), "512".into());
        let (status, body) = route("GET", "/api/diff/slice", &small, b"", &state).unwrap();
        assert_eq!(status, 413); // Manifest metadata counts against the budget.
        assert_eq!(body["code"], "response_too_large");
        let _ = std::fs::remove_dir_all(diffing_core::project_storage_dir(&root));
    }

    #[test]
    fn malformed_comment_json_returns_400() {
        let index = Arc::new(DiffIndex::empty(1, PathBuf::from("/tmp/repo"), true));
        let shared = Arc::new(RwLock::new(index));
        let state = ApiState {
            repo_root: "/tmp/repo".to_string(),
            index: shared,
            capability: "cap".to_string(),
            review: Arc::new((Mutex::new(ReviewState::default()), Condvar::new())),
            snapshots: Mutex::new(InspectSnapshots::new().unwrap()),
            capture_work: Mutex::new(()),
        };
        let (status, body) = route(
            "POST",
            "/api/comments",
            &HashMap::new(),
            b"{not json",
            &state,
        )
        .unwrap();
        assert_eq!(status, 400);
        assert!(body.get("error").is_some());
    }

    #[test]
    fn oversized_line_number_returns_400() {
        let index = Arc::new(DiffIndex::empty(1, PathBuf::from("/tmp/repo"), true));
        let shared = Arc::new(RwLock::new(index));
        let state = ApiState {
            repo_root: "/tmp/repo".to_string(),
            index: shared,
            capability: "cap".to_string(),
            review: Arc::new((Mutex::new(ReviewState::default()), Condvar::new())),
            snapshots: Mutex::new(InspectSnapshots::new().unwrap()),
            capture_work: Mutex::new(()),
        };
        let payload = json!({
            "filePath": "a.rs",
            "lineNumber": u64::MAX,
            "body": "note"
        });
        let (status, body) = route(
            "POST",
            "/api/comments",
            &HashMap::new(),
            &serde_json::to_vec(&payload).unwrap(),
            &state,
        )
        .unwrap();
        assert_eq!(status, 400);
        assert!(body.get("error").is_some());
    }

    #[test]
    fn review_release_wakes_and_caches_round() {
        let review = Arc::new((Mutex::new(ReviewState::default()), Condvar::new()));
        let api = AgentApi {
            port: 1,
            capability: "test".to_string(),
            review: review.clone(),
            shutdown: Arc::new(Mutex::new(None)),
        };
        assert_eq!(api.release_review("<review/>".to_string()), 1);
        let state = review.0.lock().unwrap();
        assert_eq!(state.round, 1);
        assert_eq!(state.payload.as_deref(), Some("<review/>"));
    }

    #[test]
    fn inspect_path_and_file_are_mutually_exclusive() {
        let index = Arc::new(DiffIndex::empty(7, PathBuf::from("/tmp/repo"), true));
        let shared = Arc::new(RwLock::new(index));
        let state = ApiState {
            repo_root: "/tmp/repo".to_string(),
            index: shared,
            capability: "cap".to_string(),
            review: Arc::new((Mutex::new(ReviewState::default()), Condvar::new())),
            snapshots: Mutex::new(InspectSnapshots::new().unwrap()),
            capture_work: Mutex::new(()),
        };
        let mut both = HashMap::new();
        both.insert("file".to_string(), "0".to_string());
        both.insert("path".to_string(), "src/a.ts".to_string());
        let (status, body) = route("GET", "/api/diff/slice", &both, b"", &state).unwrap();
        assert_eq!(status, 400);
        assert_eq!(
            body.get("error").and_then(Value::as_str),
            Some("path and file are mutually exclusive")
        );

        let mut missing = HashMap::new();
        missing.insert("path".to_string(), "src/a.ts".to_string());
        let (status, body) = route("GET", "/api/diff/hunks", &missing, b"", &state).unwrap();
        assert_eq!(status, 404);
        assert_eq!(
            body.get("error").and_then(Value::as_str),
            Some("path matched no files")
        );

        let mut files = HashMap::new();
        files.insert("path".to_string(), "src/**".to_string());
        let (status, body) = route("GET", "/api/diff/files", &files, b"", &state).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body.get("matched").and_then(Value::as_u64), Some(0));
        assert_eq!(body.get("total").and_then(Value::as_u64), Some(0));
        assert_eq!(body.get("path").and_then(Value::as_str), Some("src/**"));
    }

    #[test]
    fn file_pages_require_generation_and_reject_invalid_continuations() {
        let state = ApiState {
            repo_root: "/tmp/repo".to_string(),
            index: Arc::new(RwLock::new(Arc::new(DiffIndex::empty(
                7,
                PathBuf::from("/tmp/repo"),
                true,
            )))),
            capability: "cap".to_string(),
            review: Arc::new((Mutex::new(ReviewState::default()), Condvar::new())),
            snapshots: Mutex::new(InspectSnapshots::new().unwrap()),
            capture_work: Mutex::new(()),
        };
        for operation in ["files", "hunks", "slice", "search"] {
            for parameter in ["continuation", "snapshotId"] {
                let params = HashMap::from([(parameter.to_string(), "retained".to_string())]);
                let (status, body) = route(
                    "GET",
                    &format!("/api/diff/{operation}"),
                    &params,
                    b"",
                    &state,
                )
                .unwrap();
                assert_eq!(status, if parameter == "snapshotId" { 410 } else { 400 });
                assert_eq!(
                    body["code"],
                    if parameter == "snapshotId" {
                        "snapshot_expired"
                    } else {
                        "invalid_continuation"
                    }
                );
            }
        }
        for (query, expected_status, expected_code) in [
            (vec![("cursor", "1")], 400, "continuation_required"),
            (
                vec![("cursor", "1"), ("generation", "6")],
                409,
                "stale_generation",
            ),
            (vec![("generation", "bad")], 400, "invalid_continuation"),
            (vec![("cursor", "1.5")], 400, "invalid_continuation"),
            (
                vec![("limit", "9007199254740992")],
                400,
                "invalid_continuation",
            ),
            (
                vec![("continuation", "opaque")],
                400,
                "invalid_continuation",
            ),
        ] {
            let params = query
                .into_iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect();
            let (status, body) = route("GET", "/api/diff/files", &params, b"", &state).unwrap();
            assert_eq!(status, expected_status);
            assert_eq!(body["code"], expected_code);
            assert_eq!(body["recovery"], "restart_files");
        }
        let params = HashMap::from([
            ("cursor".to_string(), "1".to_string()),
            ("generation".to_string(), "7".to_string()),
        ]);
        let (status, body) = route("GET", "/api/diff/files", &params, b"", &state).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body["generation"], 7);
        assert_eq!(body["nextCursor"], Value::Null);
    }

    #[test]
    fn loopback_api_requires_capability_and_returns_bounded_summary() {
        let index = Arc::new(DiffIndex::empty(42, PathBuf::from("unused"), true));
        let shared = Arc::new(RwLock::new(index));
        let api = AgentApi::start("/tmp/repo".to_string(), shared).unwrap();

        let authorized = raw_get(api.port, "/api/diff/summary", Some(api.capability.as_str()));
        assert!(authorized.starts_with("HTTP/1.1 200"), "{authorized}");
        assert!(authorized.contains("\"generation\":42"), "{authorized}");

        let denied = raw_get(api.port, "/api/diff/summary", None);
        assert!(denied.starts_with("HTTP/1.1 401"), "{denied}");
    }

    fn snapshot_fixture(patch: &str) -> (tempfile::TempDir, ApiState) {
        let directory = tempfile::tempdir().unwrap();
        let index = diffing_core::index::build_index_from_reader(
            std::io::Cursor::new(patch),
            &directory.path().join("live.patch"),
            7,
            |_| {},
        )
        .unwrap();
        let state = ApiState {
            repo_root: directory.path().to_string_lossy().into_owned(),
            index: Arc::new(RwLock::new(Arc::new(index))),
            capability: "cap".into(),
            review: Arc::new((Mutex::new(ReviewState::default()), Condvar::new())),
            snapshots: Mutex::new(InspectSnapshots::new().unwrap()),
            capture_work: Mutex::new(()),
        };
        (directory, state)
    }

    #[test]
    fn all_native_pages_retain_one_capture_after_live_refresh_and_spool_removal() {
        let patch = ["a", "b", "c"].iter().map(|name| format!("diff --git a/{name}.ts b/{name}.ts\n--- a/{name}.ts\n+++ b/{name}.ts\n@@ -1 +1 @@\n-old\n+new {name}\n")).collect::<String>();
        let (directory, state) = snapshot_fixture(&patch);
        let (status, summary) =
            route("GET", "/api/diff/summary", &HashMap::new(), b"", &state).unwrap();
        assert_eq!(status, 200);
        let snapshot = summary["snapshotId"].as_str().unwrap();
        let files = HashMap::from([
            ("snapshotId".into(), snapshot.to_owned()),
            ("limit".into(), "1".into()),
        ]);
        let (status, first) = route("GET", "/api/diff/files", &files, b"", &state).unwrap();
        assert_eq!(status, 200);
        let slice = HashMap::from([
            ("snapshotId".into(), snapshot.to_owned()),
            ("file".into(), "0".into()),
            ("maxLines".into(), "2".into()),
        ]);
        let (status, first_slice) = route("GET", "/api/diff/slice", &slice, b"", &state).unwrap();
        assert_eq!(status, 200);
        let search = HashMap::from([
            ("snapshotId".into(), snapshot.to_owned()),
            ("q".into(), "new".into()),
            ("limit".into(), "1".into()),
        ]);
        let (status, first_search) =
            route("GET", "/api/diff/search", &search, b"", &state).unwrap();
        assert_eq!(status, 200);
        *state.index.write().unwrap() = Arc::new(DiffIndex::empty(8, "removed".into(), true));
        std::fs::remove_file(directory.path().join("live.patch")).unwrap();

        let mut page = first;
        let mut names = vec![page["files"][0]["path"].as_str().unwrap().to_owned()];
        while let Some(token) = page["nextContinuation"].as_str() {
            let params = HashMap::from([("continuation".into(), token.to_owned())]);
            let (status, next) = route("GET", "/api/diff/files", &params, b"", &state).unwrap();
            assert_eq!(status, 200);
            assert_eq!(next["snapshotId"], snapshot);
            assert_eq!(next["generation"], 7);
            names.push(next["files"][0]["path"].as_str().unwrap().to_owned());
            page = next;
        }
        assert_eq!(names, ["a.ts", "b.ts", "c.ts"]);
        let next_slice = HashMap::from([(
            "continuation".into(),
            first_slice["nextContinuation"].as_str().unwrap().to_owned(),
        )]);
        let (status, continued) =
            route("GET", "/api/diff/slice", &next_slice, b"", &state).unwrap();
        assert_eq!(status, 200);
        assert_eq!(continued["rows"][1]["content"], "new a");
        assert_eq!(continued["snapshotId"], snapshot);
        assert_eq!(
            route("GET", "/api/diff/search", &next_slice, b"", &state)
                .unwrap()
                .1["code"],
            "invalid_continuation"
        );
        let mut conflicting = next_slice.clone();
        conflicting.insert("file".into(), "1".into());
        assert_eq!(
            route("GET", "/api/diff/slice", &conflicting, b"", &state)
                .unwrap()
                .0,
            400
        );

        let mut hits = vec![first_search["hits"][0]["path"].as_str().unwrap().to_owned()];
        let mut page = first_search;
        while let Some(token) = page["nextContinuation"].as_str() {
            let params = HashMap::from([("continuation".into(), token.to_owned())]);
            let (status, next) = route("GET", "/api/diff/search", &params, b"", &state).unwrap();
            assert_eq!(status, 200);
            hits.extend(
                next["hits"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|hit| hit["path"].as_str().unwrap().to_owned()),
            );
            page = next;
        }
        assert_eq!(hits, ["a.ts", "b.ts", "c.ts"]);
        let (status, hunks) = route(
            "GET",
            "/api/diff/hunks",
            &HashMap::from([
                ("snapshotId".into(), snapshot.to_owned()),
                ("file".into(), "0".into()),
            ]),
            b"",
            &state,
        )
        .unwrap();
        assert_eq!(status, 200);
        assert_eq!(hunks["hunks"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn retained_native_pages_bound_serialized_bytes_and_omit_an_oversized_row() {
        let patch = format!(
            "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+{}\n",
            "☕".repeat(10_000)
        );
        let (_directory, state) = snapshot_fixture(&patch);
        let (_, summary) = route("GET", "/api/diff/summary", &HashMap::new(), b"", &state).unwrap();
        let params = HashMap::from([
            (
                "snapshotId".into(),
                summary["snapshotId"].as_str().unwrap().to_owned(),
            ),
            ("file".into(), "0".into()),
            ("start".into(), "3".into()),
            ("maxBytes".into(), "2048".into()),
        ]);
        let (status, page) = route("GET", "/api/diff/slice", &params, b"", &state).unwrap();
        assert_eq!(status, 200);
        assert!(serde_json::to_vec(&page).unwrap().len() <= 2048);
        assert_eq!(
            page["estimatedBytes"],
            serde_json::to_vec(&page).unwrap().len()
        );
        assert_eq!(page["omitted"]["reason"], "row_too_large");
        assert_eq!(page["omitted"]["count"], 1);
        assert!(page["rows"].as_array().unwrap().is_empty());
        assert!(page["nextContinuation"].is_null());
        assert_eq!(page["complete"], summary["complete"]);
    }

    fn raw_get(port: u16, path: &str, capability: Option<&str>) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        // Pause after accept so the handler must wait for headers.  Without a
        // blocking socket this used to close the connection with an empty body.
        thread::sleep(Duration::from_millis(20));
        let capability = capability
            .map(|value| format!("X-Diffing-Capability: {value}\r\n"))
            .unwrap_or_default();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{capability}Connection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }
}
