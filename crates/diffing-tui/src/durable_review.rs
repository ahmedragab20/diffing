//! Explicit, read-only client for an adopted review. Never opens classic stores,
//! executes Git, mints credentials, or offers mutation keys in this mode.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, ensure, Context, Result};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute, terminal,
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Layout},
    widgets::{Block, Paragraph, Wrap},
    Terminal,
};
use serde::Deserialize;
use serde_json::Value;

const MAX_BYTES: usize = 512 * 1024;
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    review_id: String,
    repository_id: String,
    workspace_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Connection {
    version: u32,
    origin: String,
    identity: Identity,
    actor: Value,
    credential: String,
    headers: std::collections::BTreeMap<String, String>,
    expires_at: u64,
}
/// Transport also used by the noninteractive `--review-read` diagnostic.
/// Errors never include connection content or response text supplied by a peer.
pub struct Client {
    connection: Connection,
    address: SocketAddr,
}
impl Client {
    pub fn open(path: &Path) -> Result<Self> {
        let file = std::fs::File::open(path).context("connection_failed: reconnect")?;
        let metadata = file.metadata()?;
        ensure!(
            metadata.is_file() && metadata.len() <= 16384,
            "invalid_connection: reconnect"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            ensure!(
                metadata.permissions().mode() & 0o077 == 0,
                "insecure_connection: reconnect"
            );
        }
        let mut bytes = Vec::new();
        file.take(16385).read_to_end(&mut bytes)?;
        ensure!(bytes.len() <= 16384, "invalid_connection: reconnect");
        let connection: Connection = serde_json::from_slice(&bytes)
            .map_err(|_| anyhow::anyhow!("invalid_connection: reconnect"))?;
        Self::new(connection)
    }
    fn new(connection: Connection) -> Result<Self> {
        ensure!(
            connection.version == 1,
            "unsupported_version: upgrade_client"
        );
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        ensure!(connection.expires_at > now, "credential_expired: reconnect");
        ensure!(
            connection.credential.len() == 43
                && connection
                    .credential
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
            "invalid_connection: reconnect"
        );
        ensure!(
            connection.headers.len() == 1
                && connection
                    .headers
                    .get("x-diffing-token")
                    .is_some_and(|s| s.len() == 64
                        && s.bytes()
                            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())),
            "invalid_connection: reconnect"
        );
        ensure!(
            matches!(
                connection.actor.get("kind").and_then(Value::as_str),
                Some("human" | "agent" | "system")
            ),
            "invalid_connection: reconnect"
        );
        let origin = connection
            .origin
            .strip_prefix("http://")
            .context("invalid_connection: loopback required")?;
        let authority = origin.strip_suffix('/').unwrap_or(origin);
        let (host, port) = authority
            .rsplit_once(':')
            .context("invalid_connection: loopback required")?;
        ensure!(
            ["localhost", "127.0.0.1", "[::1]"].contains(&host),
            "invalid_connection: loopback required"
        );
        let port: u16 = port.parse().context("invalid_connection: port")?;
        ensure!(port != 0, "invalid_connection: port");
        let host = if host == "localhost" {
            "127.0.0.1"
        } else {
            host
        };
        let address = format!("{host}:{port}").parse()?;
        Ok(Self {
            connection,
            address,
        })
    }
    pub fn read(&self, path: &str) -> Result<Value> {
        ensure!(
            path.starts_with('/') && path.bytes().all(|b| b.is_ascii_graphic()),
            "invalid_request"
        );
        let mut stream = TcpStream::connect_timeout(&self.address, Duration::from_secs(2))
            .context("connection_failed: reconnect")?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        write!(stream, "GET /api/review-core{path} HTTP/1.1\r\nHost: {}\r\nX-Diffing-Review-Protocol: 1\r\nX-Diffing-Review-Credential: {}\r\nx-diffing-token: {}\r\nConnection: close\r\n\r\n", self.address, self.connection.credential, self.connection.headers["x-diffing-token"])?;
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut response = Vec::new();
        let mut chunk = [0; 8192];
        while response.len() <= MAX_BYTES + 16384 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            ensure!(!remaining.is_zero(), "connection_failed: response timeout");
            stream.set_read_timeout(Some(remaining))?;
            let count = stream
                .read(&mut chunk)
                .context("connection_failed: response timeout")?;
            if count == 0 {
                break;
            }
            response.extend_from_slice(&chunk[..count]);
        }
        ensure!(
            response.len() <= MAX_BYTES + 16384,
            "response_too_large: read_events"
        );
        let value = decode_http(&response)?;
        let identity: Identity =
            serde_json::from_value(value.get("identity").cloned().context("invalid_response")?)
                .context("invalid_response")?;
        ensure!(
            identity == self.connection.identity,
            "wrong_review: reconnect"
        );
        Ok(value)
    }
    pub fn state(&self) -> Result<Value> {
        let state = self.read("/state")?;
        ensure!(
            state["version"].as_u64().is_some()
                && ["comments", "viewed", "handoffs", "decisions"]
                    .iter()
                    .all(|key| state[key].is_array()),
            "invalid_response"
        );
        if !state["currentSnapshotId"].is_null() {
            ensure!(valid_id(&state["currentSnapshotId"]), "invalid_response");
        }
        Ok(state)
    }
    fn source(&self, snapshot: &str, file: Option<u64>, offset: u64) -> Result<Value> {
        ensure!(valid_id(&Value::String(snapshot.into())), "invalid_request");
        let path = format!(
            "/source?snapshotId={snapshot}&offset={offset}&limit=100{}",
            file.map(|n| format!("&fileIndex={n}")).unwrap_or_default()
        );
        let page = self.read(&path)?;
        let entries = page["entries"].as_array().context("invalid_response")?;
        let end = offset
            .checked_add(entries.len() as u64)
            .context("invalid_response")?;
        let total = page["total"].as_u64().context("invalid_response")?;
        ensure!(
            page["snapshotId"] == snapshot
                && page["fileIndex"] == file.map(Value::from).unwrap_or(Value::Null)
                && page["offset"] == offset
                && entries.len() <= 100
                && end <= total,
            "invalid_response"
        );
        ensure!(
            page["next"]
                == if end < total {
                    Value::from(end)
                } else {
                    Value::Null
                },
            "invalid_response"
        );
        ensure!(end == total || !entries.is_empty(), "invalid_response");
        ensure!(
            entries
                .iter()
                .enumerate()
                .all(|(n, e)| e["index"] == offset + n as u64
                    && (e["omitted"] == "row_too_large"
                        || if file.is_some() {
                            e["row"].is_object()
                        } else {
                            e["file"].is_object()
                        })),
            "invalid_response"
        );
        if file.is_none() {
            ensure!(
                entries.iter().all(|entry| {
                    entry["omitted"] == "row_too_large"
                        || (entry["file"]["index"] == entry["index"]
                            && entry["file"].get("anchor").map_or(true, |anchor| {
                                anchor["snapshotId"] == snapshot
                                    && anchor["repositoryId"]
                                        == self.connection.identity.repository_id
                                    && anchor["workspaceId"]
                                        == self.connection.identity.workspace_id
                            }))
                }),
                "invalid_response"
            );
        }
        Ok(page)
    }
}
fn valid_id(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 36
            && s.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            })
    })
}
fn decode_http(response: &[u8]) -> Result<Value> {
    let boundary = response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .context("invalid_response")?;
    ensure!(boundary <= 16384, "invalid_response");
    let header = std::str::from_utf8(&response[..boundary]).context("invalid_response")?;
    let status = header
        .lines()
        .next()
        .and_then(|s| s.split_whitespace().nth(1))
        .context("invalid_response")?;
    let headers: Vec<_> = header
        .lines()
        .skip(1)
        .filter_map(|s| s.split_once(':'))
        .map(|(k, v)| (k.to_ascii_lowercase(), v.trim()))
        .collect();
    ensure!(
        headers
            .iter()
            .any(|(k, v)| k == "x-diffing-review-protocol" && *v == "1"),
        "unsupported_version: upgrade_client"
    );
    let payload = &response[boundary + 4..];
    let decoded;
    let payload = if headers
        .iter()
        .any(|(k, v)| k == "transfer-encoding" && v.eq_ignore_ascii_case("chunked"))
    {
        decoded = decode_chunks(payload)?;
        &decoded[..]
    } else {
        payload
    };
    ensure!(
        payload.len() <= MAX_BYTES,
        "response_too_large: read_events"
    );
    let value: Value = serde_json::from_slice(payload).context("invalid_response")?;
    if status != "200" {
        let safe = |s: &str| s.len() < 80 && s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
        let code = value["code"]
            .as_str()
            .filter(|s| safe(s))
            .unwrap_or("invalid_response");
        let recovery = value["recovery"]
            .as_str()
            .filter(|s| safe(s))
            .unwrap_or("reconnect");
        bail!("{code}: {recovery}");
    }
    Ok(value)
}
fn decode_chunks(mut data: &[u8]) -> Result<Vec<u8>> {
    let mut result = Vec::new();
    loop {
        let end = data
            .windows(2)
            .position(|w| w == b"\r\n")
            .context("invalid_response")?;
        let size = usize::from_str_radix(
            std::str::from_utf8(&data[..end])?
                .split(';')
                .next()
                .unwrap_or(""),
            16,
        )
        .context("invalid_response")?;
        data = &data[end + 2..];
        if size == 0 {
            break;
        }
        ensure!(
            size <= MAX_BYTES - result.len()
                && data.len() >= size + 2
                && &data[size..size + 2] == b"\r\n",
            "invalid_response"
        );
        result.extend_from_slice(&data[..size]);
        data = &data[size + 2..];
    }
    Ok(result)
}
fn text(value: &Value) -> String {
    value
        .as_str()
        .unwrap_or("")
        .chars()
        .map(|c| {
            if c.is_control() && c != '\n' && c != '\t' {
                '�'
            } else {
                c
            }
        })
        .collect()
}
fn summary(state: &Value) -> String {
    let mut lines = vec![
        format!(
            "Revision {} · captured source: {}",
            state["version"], state["currentSnapshotId"]
        ),
        "Freshness is checked by the owner when an action requires it.".into(),
    ];
    for comment in state["comments"].as_array().into_iter().flatten() {
        lines.push(format!(
            "\n{}:{} [{}]\n{}",
            text(&comment["filePath"]),
            comment["lineNumber"],
            text(&comment["status"]),
            text(&comment["body"])
        ));
        for reply in comment["replies"].as_array().into_iter().flatten() {
            lines.push(format!("  {}", text(&reply["body"])));
        }
    }
    for handoff in state["handoffs"].as_array().into_iter().flatten() {
        lines.push(format!(
            "\nRound {} · {}\n{}\n{}",
            handoff["round"],
            text(&handoff["status"]),
            text(&handoff["instructions"]),
            text(&handoff["result"]["body"])
        ));
    }
    for decision in state["decisions"].as_array().into_iter().flatten() {
        lines.push(format!(
            "\n{} · {}",
            text(&decision["decision"]),
            text(&decision["rationale"])
        ));
    }
    lines.join("\n")
}
fn file_label(entry: &Value) -> String {
    if entry["omitted"] == "row_too_large" {
        "File omitted (too large)".into()
    } else {
        text(&entry["file"]["path"])
    }
}

fn navigate_source_page(
    current: &Value,
    previous: &mut Vec<u64>,
    forward: bool,
    fetch: impl FnOnce(u64) -> Result<Value>,
) -> Result<Option<Value>> {
    let offset = if forward {
        current["next"].as_u64()
    } else {
        previous.last().copied()
    };
    let Some(offset) = offset else {
        return Ok(None);
    };
    let page = fetch(offset)?;
    if forward {
        previous.push(current["offset"].as_u64().context("invalid_response")?);
    } else {
        previous.pop();
    }
    Ok(Some(page))
}

struct Screen;
impl Drop for Screen {
    fn drop(&mut self) {
        terminal::disable_raw_mode().ok();
        execute!(std::io::stdout(), terminal::LeaveAlternateScreen).ok();
    }
}

pub fn run(path: &Path, read: Option<&str>) -> Result<()> {
    let client = Client::open(path)?;
    let capabilities = client.read("/capabilities")?;
    ensure!(
        capabilities["protocolVersion"] == 1
            && capabilities["permissions"]
                .as_array()
                .is_some_and(|p| p.iter().any(|p| p == "read")),
        "forbidden: request_permission"
    );
    if let Some(read) = read {
        let value = match read {
            "state" => client.state()?,
            "capabilities" => capabilities,
            "next-actions" => client.read("/next-actions")?,
            _ => bail!("unsupported_operation: use review-core CLI for mutations"),
        };
        println!("{}", serde_json::to_string(&value)?);
        return Ok(());
    }
    let mut state = client.state()?;
    let mut body = summary(&state);
    let mut page: Option<Value> = None;
    let mut file: Option<u64> = None;
    let mut previous_pages = Vec::new();
    let mut cursor = 0usize;
    let mut scroll = 0u16;
    terminal::enable_raw_mode()?;
    let _screen = Screen;
    execute!(std::io::stdout(), terminal::EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(std::io::stdout()))?;
    let mut notice = String::new();
    loop {
        terminal.draw(|frame| {
            let areas = Layout::vertical([Constraint::Length(3), Constraint::Min(1), Constraint::Length(3)]).split(frame.area());
            frame.render_widget(Paragraph::new("Durable review · read only\n1 discussion  2 files  Enter open  n/p page  j/k scroll  r reload  q quit"), areas[0]);
            frame.render_widget(Paragraph::new(body.as_str()).wrap(Wrap { trim: false }).scroll((scroll,0)).block(Block::bordered().title(if file.is_some() { "Captured source" } else { "Review" })), areas[1]);
            frame.render_widget(Paragraph::new(format!("{notice}\nComments, viewed marks, handoffs and decisions: use the web workspace or review-core CLI.")), areas[2]);
        })?;
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        let action = (|| -> Result<()> {
            match key.code {
                KeyCode::Char('q') | KeyCode::Esc => return Ok(()),
                KeyCode::Char('1') => {
                    body = summary(&state);
                    page = None;
                    file = None;
                    previous_pages.clear();
                    scroll = 0;
                }
                KeyCode::Char('r') => {
                    state = client.state()?;
                    body = summary(&state);
                    page = None;
                    file = None;
                    previous_pages.clear();
                    scroll = 0;
                }
                KeyCode::Char('2') => {
                    page = Some(
                        client.source(
                            state["currentSnapshotId"]
                                .as_str()
                                .context("capture_source: use web or CLI to capture")?,
                            None,
                            0,
                        )?,
                    );
                    file = None;
                    previous_pages.clear();
                    cursor = 0;
                    scroll = 0;
                }
                KeyCode::Char('n') | KeyCode::Char('p') => {
                    if let Some(current) = &page {
                        if let Some(next) = navigate_source_page(
                            current,
                            &mut previous_pages,
                            key.code == KeyCode::Char('n'),
                            |offset| {
                                client.source(
                                    state["currentSnapshotId"]
                                        .as_str()
                                        .context("invalid_response")?,
                                    file,
                                    offset,
                                )
                            },
                        )? {
                            page = Some(next);
                            cursor = 0;
                            scroll = 0;
                        }
                    }
                }
                KeyCode::Enter => {
                    if let Some(current) = &page {
                        if file.is_none() {
                            let index = current["entries"][cursor]["file"]["index"]
                                .as_u64()
                                .context("Select a displayed file")?;
                            page = Some(
                                client.source(
                                    state["currentSnapshotId"]
                                        .as_str()
                                        .context("invalid_response")?,
                                    Some(index),
                                    0,
                                )?,
                            );
                            file = Some(index);
                            previous_pages.clear();
                            scroll = 0;
                        }
                    }
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    if file.is_none() && page.is_some() {
                        cursor = (cursor + 1).min(
                            page.as_ref().unwrap()["entries"]
                                .as_array()
                                .map_or(0, |a| a.len().saturating_sub(1)),
                        );
                    }
                    scroll = scroll.saturating_add(1);
                }
                KeyCode::Up | KeyCode::Char('k') => {
                    cursor = cursor.saturating_sub(1);
                    scroll = scroll.saturating_sub(1);
                }
                _ => {
                    notice = "Read-only mode; this key does not change the review.".into();
                }
            }
            if let Some(current) = &page {
                body = current["entries"]
                    .as_array()
                    .context("invalid_response")?
                    .iter()
                    .enumerate()
                    .map(|(i, e)| {
                        if file.is_none() {
                            format!("{} {}", if i == cursor { ">" } else { " " }, file_label(e))
                        } else {
                            let row = &e["row"];
                            match row["type"].as_str() {
                                Some("line") => format!(
                                    "{:>6} {:>6} {}{}",
                                    row["oldLineno"]
                                        .as_u64()
                                        .map(|n| n.to_string())
                                        .unwrap_or_default(),
                                    row["newLineno"]
                                        .as_u64()
                                        .map(|n| n.to_string())
                                        .unwrap_or_default(),
                                    if row["kind"] == "add" {
                                        "+"
                                    } else if row["kind"] == "del" {
                                        "-"
                                    } else {
                                        " "
                                    },
                                    text(&row["content"])
                                ),
                                Some("fileHeader") => text(&row["path"]),
                                Some("hunkHeader") => format!("@@ {}", text(&row["heading"])),
                                Some("noNewline") => "No newline at end of file".into(),
                                _ => "Row omitted (too large)".into(),
                            }
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                notice = format!(
                    "Rows {}–{} / {} · retained snapshot · {}",
                    current["offset"],
                    current["offset"].as_u64().unwrap_or(0)
                        + current["entries"].as_array().map_or(0, |a| a.len()) as u64,
                    current["total"],
                    if current["complete"] == true {
                        "complete capture"
                    } else {
                        "incomplete capture"
                    }
                );
            }
            Ok(())
        })();
        if key.code == KeyCode::Char('q') || key.code == KeyCode::Esc {
            break;
        }
        if let Err(error) = action {
            notice = error.to_string();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_chunked_and_typed_errors_without_echoing_arbitrary_data() {
        let response = b"HTTP/1.1 200 OK\r\nX-Diffing-Review-Protocol: 1\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n";
        assert_eq!(decode_http(response).unwrap(), serde_json::json!({}));
        assert!(decode_http(b"HTTP/1.1 200 OK\r\n\r\n{}")
            .unwrap_err()
            .to_string()
            .contains("unsupported_version"));
        assert_eq!(decode_http(b"HTTP/1.1 403 Forbidden\r\nX-Diffing-Review-Protocol: 1\r\n\r\n{\"code\":\"forbidden\",\"recovery\":\"request_permission\"}").unwrap_err().to_string(), "forbidden: request_permission");
        assert!(decode_chunks(b"ffffffffff\r\n").is_err());
    }
    fn read_file_page(entry: Value) -> Result<Value> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let snapshot = "00000000-0000-4000-8000-000000000001";
        let identity = serde_json::json!({
            "reviewId": "00000000-0000-4000-8000-000000000002",
            "repositoryId": "a".repeat(64), "workspaceId": "b".repeat(64)
        });
        let body = serde_json::json!({
            "identity": identity, "snapshotId": snapshot, "fileIndex": null,
            "offset": 0, "total": 1, "next": null, "complete": true, "entries": [entry]
        })
        .to_string();
        let responder = std::thread::spawn(move || -> Result<()> {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        ensure!(Instant::now() < deadline, "test connection timeout");
                        std::thread::yield_now();
                    }
                    Err(error) => return Err(error.into()),
                }
            };
            stream.set_nonblocking(false)?;
            stream.set_read_timeout(Some(Duration::from_secs(5)))?;
            stream.set_write_timeout(Some(Duration::from_secs(5)))?;
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte)?;
                request.push(byte[0]);
                ensure!(request.len() <= 16384, "test request too large");
            }
            let request = String::from_utf8(request)?;
            ensure!(request.starts_with(&format!("GET /api/review-core/source?snapshotId={snapshot}&offset=0&limit=100 HTTP/1.1\r\n")), "unexpected source request");
            write!(stream, "HTTP/1.1 200 OK\r\nX-Diffing-Review-Protocol: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body)?;
            Ok(())
        });
        let connection: Connection = serde_json::from_value(serde_json::json!({
            "version": 1, "origin": format!("http://{address}/"), "identity": identity,
            "actor": {"id": "agent", "kind": "agent"}, "credential": "x".repeat(43),
            "headers": {"x-diffing-token": "d".repeat(64)}, "expiresAt": u64::MAX
        }))?;
        let result = Client::new(connection)?.source(snapshot, None, 0);
        responder.join().expect("source responder panicked")?;
        result
    }

    #[test]
    fn source_files_bind_inner_index_and_anchor_to_the_requested_capture() {
        let valid = serde_json::json!({"index": 0, "file": {
            "index": 0, "path": "a", "anchor": {
                "snapshotId": "00000000-0000-4000-8000-000000000001",
                "repositoryId": "a".repeat(64), "workspaceId": "b".repeat(64)
            }
        }});
        read_file_page(valid.clone()).expect("valid source page");
        for field in ["index", "snapshotId", "repositoryId", "workspaceId"] {
            let mut invalid = valid.clone();
            if field == "index" {
                invalid["file"]["index"] = serde_json::json!(1);
            } else {
                invalid["file"]["anchor"][field] = serde_json::json!(if field == "snapshotId" {
                    "00000000-0000-4000-8000-000000000003".to_string()
                } else {
                    "c".repeat(64)
                });
            }
            assert_eq!(
                read_file_page(invalid).unwrap_err().to_string(),
                "invalid_response",
                "{field}"
            );
        }
        assert!(
            read_file_page(serde_json::json!({"index": 0, "file": {"index": 0, "path": "a"}}))
                .is_ok()
        );
        assert!(
            read_file_page(serde_json::json!({"index": 0, "omitted": "row_too_large"})).is_ok()
        );
    }

    #[test]
    fn omitted_files_are_visible_in_the_file_list() {
        assert_eq!(
            file_label(&serde_json::json!({"index": 4, "omitted": "row_too_large"})),
            "File omitted (too large)"
        );
        assert_eq!(
            file_label(&serde_json::json!({"index": 5, "file": {"path": "normal.ts"}})),
            "normal.ts"
        );
    }

    #[test]
    fn previous_source_page_returns_to_the_actual_short_page_boundary() {
        let first = serde_json::json!({"offset": 0, "next": 7});
        let second = serde_json::json!({"offset": 7, "next": 13});
        let third = serde_json::json!({"offset": 13, "next": null});
        let mut previous = Vec::new();
        assert!(
            navigate_source_page(&first, &mut previous, true, |_| bail!("unavailable")).is_err()
        );
        assert!(previous.is_empty(), "failed navigation preserves history");
        let second_page = navigate_source_page(&first, &mut previous, true, |offset| {
            assert_eq!(offset, 7);
            Ok(second.clone())
        })
        .unwrap()
        .unwrap();
        let third_page = navigate_source_page(&second_page, &mut previous, true, |offset| {
            assert_eq!(offset, 13);
            Ok(third)
        })
        .unwrap()
        .unwrap();
        let back = navigate_source_page(&third_page, &mut previous, false, |offset| {
            assert_eq!(offset, 7);
            Ok(second.clone())
        })
        .unwrap()
        .unwrap();
        assert_eq!(back, second);
        assert_eq!(previous, vec![0]);
        assert!(
            navigate_source_page(&back, &mut previous, false, |_| bail!("unavailable")).is_err()
        );
        assert_eq!(previous, vec![0], "failed navigation preserves history");
        navigate_source_page(&back, &mut previous, false, |offset| {
            assert_eq!(offset, 0);
            Ok(first.clone())
        })
        .unwrap();
        assert!(previous.is_empty());
        assert!(
            navigate_source_page(&first, &mut previous, false, |_| panic!(
                "already first page"
            ))
            .unwrap()
            .is_none()
        );
        let last = serde_json::json!({"offset": 13, "next": null});
        assert!(
            navigate_source_page(&last, &mut previous, true, |_| panic!("already last page"))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn never_renders_terminal_escape_sequences_from_review_text() {
        assert_eq!(text(&Value::String("x\u{1b}[31m\u{7}".into())), "x�[31m�");
    }
}
