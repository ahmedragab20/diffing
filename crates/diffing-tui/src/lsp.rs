//! Optional local Language Server Protocol client.
//!
//! Servers are discovered from PATH and communicate over stdio. Nothing is
//! downloaded and no repository content leaves the machine.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde_json::{json, Value};

const MAX_DIAGNOSTICS_PER_FILE: usize = 200;
const MAX_MESSAGE_CHARS: usize = 512;
static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntelligenceMode {
    Auto,
    Off,
}

impl IntelligenceMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::Auto => "Auto",
            Self::Off => "Off",
        }
    }

    pub fn toggle(self) -> Self {
        match self {
            Self::Auto => Self::Off,
            Self::Off => Self::Auto,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerState {
    Off,
    Starting,
    Unavailable,
    Ready,
    Error,
}

impl ServerState {
    pub fn label(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Starting => "starting",
            Self::Unavailable => "unavailable",
            Self::Ready => "ready",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LspDiagnostic {
    pub line: u32,
    pub start_character: u32,
    pub end_character: u32,
    pub severity: u8,
    pub message: String,
    pub source: Option<String>,
}

impl LspDiagnostic {
    pub fn marker(&self) -> char {
        match self.severity {
            1 => 'E',
            2 => 'W',
            3 => 'I',
            _ => 'H',
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefinitionTarget {
    pub path: PathBuf,
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestKind {
    Hover,
    Definition,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestToken {
    server: String,
    id: u64,
    pub kind: RequestKind,
    started: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LanguageResponse {
    Hover(Option<String>),
    Definition(Vec<DefinitionTarget>),
}

#[derive(Clone)]
struct ServerSpec {
    key: &'static str,
    command: &'static str,
    args: &'static [&'static str],
}

struct OpenDocument {
    version: i32,
    text: String,
}

struct LspSession {
    child: Child,
    writer: Arc<Mutex<ChildStdin>>,
    responses: Arc<Mutex<HashMap<u64, Value>>>,
    opened: HashMap<PathBuf, OpenDocument>,
    initialize_id: Option<u64>,
    started: Instant,
}

impl LspSession {
    fn spawn(
        spec: ServerSpec,
        repo_root: &Path,
        diagnostics: Arc<Mutex<HashMap<PathBuf, Vec<LspDiagnostic>>>>,
        diagnostics_revision: Arc<AtomicU64>,
    ) -> Result<Self> {
        let mut child = Command::new(spec.command)
            .args(spec.args)
            .current_dir(repo_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .with_context(|| format!("starting {}", spec.command))?;
        let stdin = child.stdin.take().context("language server has no stdin")?;
        let stdout = child
            .stdout
            .take()
            .context("language server has no stdout")?;
        let writer = Arc::new(Mutex::new(stdin));
        let reader_writer = writer.clone();
        let responses = Arc::new(Mutex::new(HashMap::new()));
        let reader_responses = responses.clone();
        let reader_diagnostics = diagnostics;
        let reader_revision = diagnostics_revision;
        let root = repo_root.to_path_buf();
        thread::Builder::new()
            .name(format!("diffing-lsp-{}", spec.key))
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                while let Ok(Some(message)) = read_message(&mut reader) {
                    if message.get("method").is_some() && message.get("id").is_some() {
                        respond_to_server_request(&message, &reader_writer);
                        continue;
                    }
                    if let Some(id) = message.get("id").and_then(Value::as_u64) {
                        if let Ok(mut values) = reader_responses.lock() {
                            values.insert(id, message);
                        }
                        continue;
                    }
                    if message.get("method").and_then(Value::as_str)
                        == Some("textDocument/publishDiagnostics")
                    {
                        record_diagnostics(&message, &root, &reader_diagnostics, &reader_revision);
                    }
                }
            })?;

        let mut session = Self {
            child,
            writer,
            responses,
            opened: HashMap::new(),
            initialize_id: None,
            started: Instant::now(),
        };
        let initialize_id = session.request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "rootUri": path_to_uri(repo_root),
                "capabilities": {
                    "textDocument": {
                        "publishDiagnostics": { "relatedInformation": false },
                        "hover": { "contentFormat": ["markdown", "plaintext"] },
                        "definition": { "linkSupport": true }
                    }
                },
                "clientInfo": { "name": "diffing-tui", "version": env!("CARGO_PKG_VERSION") }
            }),
        )?;
        session.initialize_id = Some(initialize_id);
        Ok(session)
    }

    fn request(&mut self, method: &str, params: Value) -> Result<u64> {
        let id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        Ok(id)
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn send(&mut self, message: &Value) -> Result<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("LSP writer poisoned"))?;
        write_message(&mut *writer, message)
    }

    fn take_raw_response(&self, id: u64) -> Option<Value> {
        self.responses.lock().ok()?.remove(&id)
    }

    fn poll_initialized(&mut self) -> Result<bool> {
        self.ensure_running()?;
        let Some(id) = self.initialize_id else {
            return Ok(true);
        };
        if let Some(response) = self.take_raw_response(id) {
            if let Some(error) = response.get("error") {
                anyhow::bail!("language server initialization failed: {error}");
            }
            self.initialize_id = None;
            self.notify("initialized", json!({}))?;
            return Ok(true);
        }
        if self.started.elapsed() > Duration::from_secs(5) {
            anyhow::bail!("language server initialization timed out");
        }
        Ok(false)
    }

    fn is_ready(&self) -> bool {
        self.initialize_id.is_none()
    }

    fn sync_document(&mut self, path: &Path) -> Result<()> {
        self.ensure_running()?;
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("reading {} for language server", path.display()))?;
        let uri = path_to_uri(path);
        if let Some(document) = self.opened.get_mut(path) {
            if document.text == text {
                return Ok(());
            }
            document.version = document.version.saturating_add(1);
            document.text = text.clone();
            let version = document.version;
            self.notify(
                "textDocument/didChange",
                json!({
                    "textDocument": { "uri": uri, "version": version },
                    "contentChanges": [{ "text": text }]
                }),
            )?;
        } else {
            self.notify(
                "textDocument/didOpen",
                json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": language_id(path).unwrap_or("plaintext"),
                        "version": 1,
                        "text": text
                    }
                }),
            )?;
            self.opened
                .insert(path.to_path_buf(), OpenDocument { version: 1, text });
        }
        Ok(())
    }

    fn ensure_running(&mut self) -> Result<()> {
        if let Some(status) = self.child.try_wait()? {
            anyhow::bail!("language server exited with {status}");
        }
        Ok(())
    }
}

impl Drop for LspSession {
    fn drop(&mut self) {
        let _ = self.notify("exit", json!({}));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct LspManager {
    repo_root: PathBuf,
    mode: IntelligenceMode,
    sessions: HashMap<String, LspSession>,
    unavailable: HashMap<String, String>,
    diagnostics: Arc<Mutex<HashMap<PathBuf, Vec<LspDiagnostic>>>>,
    diagnostics_revision: Arc<AtomicU64>,
}

impl LspManager {
    pub fn new(repo_root: PathBuf, mode: IntelligenceMode) -> Self {
        Self {
            repo_root,
            mode,
            sessions: HashMap::new(),
            unavailable: HashMap::new(),
            diagnostics: Arc::new(Mutex::new(HashMap::new())),
            diagnostics_revision: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn mode(&self) -> IntelligenceMode {
        self.mode
    }

    pub fn set_mode(&mut self, mode: IntelligenceMode) {
        self.mode = mode;
        if mode == IntelligenceMode::Off {
            self.sessions.clear();
            self.unavailable.clear();
            if let Ok(mut diagnostics) = self.diagnostics.lock() {
                diagnostics.clear();
            }
        }
    }

    pub fn state_for_path(&self, path: &Path) -> ServerState {
        if self.mode == IntelligenceMode::Off {
            return ServerState::Off;
        }
        let Some(spec) = server_spec(path) else {
            return ServerState::Unavailable;
        };
        if self.sessions.contains_key(spec.key) {
            if self
                .sessions
                .get(spec.key)
                .is_some_and(LspSession::is_ready)
            {
                ServerState::Ready
            } else {
                ServerState::Starting
            }
        } else if self
            .unavailable
            .get(spec.key)
            .is_some_and(|reason| reason.ends_with("not found"))
        {
            ServerState::Unavailable
        } else if self.unavailable.contains_key(spec.key) {
            ServerState::Error
        } else {
            ServerState::Unavailable
        }
    }

    pub fn sync_document(&mut self, relative_path: &Path) -> Result<ServerState> {
        if self.mode == IntelligenceMode::Off {
            return Ok(ServerState::Off);
        }
        let absolute = self.repo_root.join(relative_path);
        let Some(spec) = server_spec(&absolute) else {
            return Ok(ServerState::Unavailable);
        };
        if !self.sessions.contains_key(spec.key) {
            if !command_exists(spec.command) {
                self.unavailable
                    .insert(spec.key.to_string(), format!("{} not found", spec.command));
                return Ok(ServerState::Unavailable);
            }
            match LspSession::spawn(
                spec.clone(),
                &self.repo_root,
                self.diagnostics.clone(),
                self.diagnostics_revision.clone(),
            ) {
                Ok(session) => {
                    self.sessions.insert(spec.key.to_string(), session);
                }
                Err(error) => {
                    self.unavailable
                        .insert(spec.key.to_string(), error.to_string());
                    return Ok(ServerState::Error);
                }
            }
        }
        let initialized = self
            .sessions
            .get_mut(spec.key)
            .context("language server session disappeared")?
            .poll_initialized();
        match initialized {
            Ok(false) => return Ok(ServerState::Starting),
            Ok(true) => {}
            Err(error) => {
                self.sessions.remove(spec.key);
                self.unavailable
                    .insert(spec.key.to_string(), error.to_string());
                return Ok(ServerState::Error);
            }
        }
        let Some(session) = self.sessions.get_mut(spec.key) else {
            return Ok(ServerState::Error);
        };
        if let Err(error) = session.sync_document(&absolute) {
            self.sessions.remove(spec.key);
            self.unavailable
                .insert(spec.key.to_string(), error.to_string());
            return Ok(ServerState::Error);
        }
        Ok(ServerState::Ready)
    }

    pub fn request_hover(
        &mut self,
        relative_path: &Path,
        line: u32,
        character: u32,
    ) -> Result<RequestToken> {
        self.request_position(relative_path, line, character, RequestKind::Hover)
    }

    pub fn request_definition(
        &mut self,
        relative_path: &Path,
        line: u32,
        character: u32,
    ) -> Result<RequestToken> {
        self.request_position(relative_path, line, character, RequestKind::Definition)
    }

    fn request_position(
        &mut self,
        relative_path: &Path,
        line: u32,
        character: u32,
        kind: RequestKind,
    ) -> Result<RequestToken> {
        let state = self.sync_document(relative_path)?;
        if state != ServerState::Ready {
            anyhow::bail!("language server {}", state.label());
        }
        let absolute = self.repo_root.join(relative_path);
        let spec = server_spec(&absolute).context("unsupported file type")?;
        let session = self
            .sessions
            .get_mut(spec.key)
            .context("language server unavailable")?;
        let method = match kind {
            RequestKind::Hover => "textDocument/hover",
            RequestKind::Definition => "textDocument/definition",
        };
        let id = session.request(
            method,
            json!({
                "textDocument": { "uri": path_to_uri(&absolute) },
                "position": { "line": line, "character": character }
            }),
        )?;
        Ok(RequestToken {
            server: spec.key.to_string(),
            id,
            kind,
            started: Instant::now(),
        })
    }

    pub fn take_response(&self, token: &RequestToken) -> Option<Result<LanguageResponse, String>> {
        let Some(session) = self.sessions.get(&token.server) else {
            return Some(Err("language server stopped".to_string()));
        };
        let Some(value) = session.take_raw_response(token.id) else {
            return (token.started.elapsed() > Duration::from_secs(5))
                .then(|| Err("language request timed out".to_string()));
        };
        if let Some(error) = value.get("error") {
            return Some(Err(error.to_string()));
        }
        let result = value.get("result").cloned().unwrap_or(Value::Null);
        Some(match token.kind {
            RequestKind::Hover => Ok(LanguageResponse::Hover(parse_hover(&result))),
            RequestKind::Definition => Ok(LanguageResponse::Definition(parse_definitions(&result))),
        })
    }

    pub fn cancel_request(&mut self, token: &RequestToken) {
        if let Some(session) = self.sessions.get_mut(&token.server) {
            let _ = session.notify("$/cancelRequest", json!({ "id": token.id }));
            let _ = session.take_raw_response(token.id);
        }
    }

    pub fn diagnostics_for(&self, relative_path: &Path) -> Vec<LspDiagnostic> {
        let absolute = self.repo_root.join(relative_path);
        self.diagnostics
            .lock()
            .ok()
            .and_then(|diagnostics| diagnostics.get(&absolute).cloned())
            .unwrap_or_default()
    }

    pub fn diagnostic_count(&self, relative_path: &Path) -> usize {
        self.diagnostics_for(relative_path).len()
    }

    pub fn diagnostics_revision(&self) -> u64 {
        self.diagnostics_revision.load(Ordering::Relaxed)
    }

    pub fn expected_server(relative_path: &Path) -> Option<&'static str> {
        server_spec(relative_path).map(|spec| spec.command)
    }
}

fn server_spec(path: &Path) -> Option<ServerSpec> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "rs" => Some(ServerSpec {
            key: "rust",
            command: "rust-analyzer",
            args: &[],
        }),
        "ts" | "tsx" | "js" | "jsx" | "mts" | "cts" | "mjs" | "cjs" => Some(ServerSpec {
            key: "typescript",
            command: "typescript-language-server",
            args: &["--stdio"],
        }),
        "py" | "pyi" => Some(ServerSpec {
            key: "python",
            command: "pyright-langserver",
            args: &["--stdio"],
        }),
        "go" => Some(ServerSpec {
            key: "go",
            command: "gopls",
            args: &[],
        }),
        "c" | "h" | "cpp" | "cc" | "cxx" | "hpp" | "hxx" => Some(ServerSpec {
            key: "clangd",
            command: "clangd",
            args: &[],
        }),
        _ => None,
    }
}

fn language_id(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "rs" => Some("rust"),
        "ts" | "mts" | "cts" => Some("typescript"),
        "tsx" => Some("typescriptreact"),
        "js" | "mjs" | "cjs" => Some("javascript"),
        "jsx" => Some("javascriptreact"),
        "py" | "pyi" => Some("python"),
        "go" => Some("go"),
        "c" | "h" => Some("c"),
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" => Some("cpp"),
        _ => None,
    }
}

fn command_exists(command: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&paths).any(|directory| {
        let candidate = directory.join(command);
        if candidate.is_file() {
            return true;
        }
        if !cfg!(windows) {
            return false;
        }
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
            .split(';')
            .any(|extension| directory.join(format!("{command}{extension}")).is_file())
    })
}

fn record_diagnostics(
    message: &Value,
    repo_root: &Path,
    store: &Arc<Mutex<HashMap<PathBuf, Vec<LspDiagnostic>>>>,
    revision: &Arc<AtomicU64>,
) {
    let Some(params) = message.get("params") else {
        return;
    };
    let Some(uri) = params.get("uri").and_then(Value::as_str) else {
        return;
    };
    let Some(path) = uri_to_path(uri) else {
        return;
    };
    if !path.starts_with(repo_root) {
        return;
    }
    let diagnostics = params
        .get("diagnostics")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_DIAGNOSTICS_PER_FILE)
        .filter_map(parse_diagnostic)
        .collect();
    if let Ok(mut values) = store.lock() {
        values.insert(path, diagnostics);
        revision.fetch_add(1, Ordering::Relaxed);
    }
}

fn parse_diagnostic(value: &Value) -> Option<LspDiagnostic> {
    let range = value.get("range")?;
    let start = range.get("start")?;
    let end = range.get("end")?;
    Some(LspDiagnostic {
        line: start.get("line")?.as_u64()? as u32,
        start_character: start.get("character")?.as_u64()? as u32,
        end_character: end.get("character")?.as_u64()? as u32,
        severity: value.get("severity").and_then(Value::as_u64).unwrap_or(3) as u8,
        message: value
            .get("message")?
            .as_str()?
            .chars()
            .take(MAX_MESSAGE_CHARS)
            .collect(),
        source: value
            .get("source")
            .and_then(Value::as_str)
            .map(String::from),
    })
}

fn parse_hover(value: &Value) -> Option<String> {
    let contents = value.get("contents")?;
    let text = if let Some(text) = contents.as_str() {
        text.to_string()
    } else if let Some(markup) = contents.get("value").and_then(Value::as_str) {
        markup.to_string()
    } else if let Some(items) = contents.as_array() {
        items
            .iter()
            .filter_map(|item| {
                item.as_str()
                    .or_else(|| item.get("value").and_then(Value::as_str))
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    } else {
        return None;
    };
    Some(text.chars().take(8_192).collect())
}

fn parse_definitions(value: &Value) -> Vec<DefinitionTarget> {
    let values: Vec<&Value> = if let Some(values) = value.as_array() {
        values.iter().collect()
    } else if value.is_object() {
        vec![value]
    } else {
        Vec::new()
    };
    values
        .into_iter()
        .filter_map(|target| {
            let uri = target
                .get("uri")
                .or_else(|| target.get("targetUri"))?
                .as_str()?;
            let range = target
                .get("range")
                .or_else(|| target.get("targetSelectionRange"))?;
            let start = range.get("start")?;
            Some(DefinitionTarget {
                path: uri_to_path(uri)?,
                line: start.get("line")?.as_u64()? as u32,
                character: start.get("character")?.as_u64()? as u32,
            })
        })
        .collect()
}

fn respond_to_server_request(message: &Value, writer: &Arc<Mutex<ChildStdin>>) {
    let Some(id) = message.get("id").cloned() else {
        return;
    };
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "workspace/configuration" => Value::Array(
            message
                .pointer("/params/items")
                .and_then(Value::as_array)
                .map(|items| vec![Value::Null; items.len()])
                .unwrap_or_default(),
        ),
        "workspace/applyEdit" => json!({
            "applied": false,
            "failureReason": "diffing is a read-only review client"
        }),
        _ => Value::Null,
    };
    if let Ok(mut writer) = writer.lock() {
        let _ = write_message(
            &mut *writer,
            &json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        );
    }
}

fn write_message(writer: &mut impl Write, message: &Value) -> Result<()> {
    let body = serde_json::to_vec(message)?;
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(&body)?;
    writer.flush()?;
    Ok(())
}

fn read_message(reader: &mut impl BufRead) -> Result<Option<Value>> {
    let mut content_length = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            return Ok(None);
        }
        if header == "\r\n" || header == "\n" {
            break;
        }
        if let Some(value) = header.trim().strip_prefix("Content-Length:").map(str::trim) {
            content_length = value.parse::<usize>().ok();
        }
    }
    let Some(content_length) = content_length else {
        anyhow::bail!("LSP message missing Content-Length");
    };
    let mut body = vec![0; content_length];
    reader.read_exact(&mut body)?;
    Ok(Some(serde_json::from_slice(&body)?))
}

fn path_to_uri(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    let root = if cfg!(windows) && !value.starts_with('/') {
        "/"
    } else {
        ""
    };
    format!("file://{root}{}", percent_encode(value.as_bytes()))
}

fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let encoded = uri.strip_prefix("file://")?;
    let mut decoded = percent_decode(encoded)?;
    if cfg!(windows) {
        if decoded.starts_with('/') && decoded.as_bytes().get(2) == Some(&b':') {
            decoded.remove(0);
        }
        decoded = decoded.replace('/', "\\");
    }
    Some(PathBuf::from(decoded))
}

fn percent_encode(value: &[u8]) -> String {
    let mut output = String::new();
    for byte in value {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'/' | b':' | b'-' | b'_' | b'.' | b'~')
        {
            output.push(*byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            output.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

pub fn utf16_column(text: &str, character_column: usize) -> u32 {
    text.chars()
        .take(character_column)
        .map(char::len_utf16)
        .sum::<usize>() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn json_rpc_framing_round_trips() {
        let message = json!({"jsonrpc":"2.0","id":7,"result":{"ok":true}});
        let mut bytes = Vec::new();
        write_message(&mut bytes, &message).unwrap();
        let parsed = read_message(&mut BufReader::new(Cursor::new(bytes)))
            .unwrap()
            .unwrap();
        assert_eq!(parsed, message);
    }

    #[test]
    fn file_uri_round_trips_spaces_and_unicode() {
        let path = PathBuf::from("/tmp/a path/λ.rs");
        assert_eq!(uri_to_path(&path_to_uri(&path)), Some(path));
    }

    #[test]
    fn utf16_columns_count_surrogate_pairs() {
        assert_eq!(utf16_column("a😀b", 0), 0);
        assert_eq!(utf16_column("a😀b", 2), 3);
        assert_eq!(utf16_column("a😀b", 3), 4);
    }

    #[test]
    fn diagnostics_are_bounded_and_truncated() {
        let root = PathBuf::from("/tmp/repo");
        let uri = path_to_uri(&root.join("a.rs"));
        let diagnostic = json!({
            "range": {"start":{"line":2,"character":1},"end":{"line":2,"character":4}},
            "severity": 1,
            "message": "x".repeat(1000),
            "source": "test"
        });
        let message = json!({
            "method": "textDocument/publishDiagnostics",
            "params": {"uri": uri, "diagnostics": vec![diagnostic; 250]}
        });
        let store = Arc::new(Mutex::new(HashMap::new()));
        let revision = Arc::new(AtomicU64::new(0));
        record_diagnostics(&message, &root, &store, &revision);
        let diagnostics = store.lock().unwrap();
        let values = diagnostics.get(&root.join("a.rs")).unwrap();
        assert_eq!(values.len(), MAX_DIAGNOSTICS_PER_FILE);
        assert_eq!(values[0].message.chars().count(), MAX_MESSAGE_CHARS);
        assert_eq!(revision.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn hover_and_definition_shapes_are_supported() {
        assert_eq!(
            parse_hover(&json!({"contents":{"kind":"markdown","value":"**type**"}})),
            Some("**type**".to_string())
        );
        let path = PathBuf::from("/tmp/definition.rs");
        let targets = parse_definitions(&json!({
            "uri": path_to_uri(&path),
            "range": {"start":{"line":4,"character":2},"end":{"line":4,"character":5}}
        }));
        assert_eq!(targets[0].path, path);
        assert_eq!(targets[0].line, 4);
    }
}
