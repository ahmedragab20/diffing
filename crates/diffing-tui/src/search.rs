//! Client for the capability-scoped fff bridge owned by the Node launcher.
//!
//! The web UI and TUI intentionally share one search implementation and one
//! frecency database. Keeping the native fff binding in Node avoids shipping a
//! second platform-specific ABI while this small loopback client keeps the
//! Rust renderer self-contained.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchScope {
    All,
    Files,
    Text,
    Symbols,
}

impl SearchScope {
    pub fn label(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::Files => "Files",
            Self::Text => "Text",
            Self::Symbols => "Symbols",
        }
    }

    pub fn next(self, delta: isize) -> Self {
        let scopes = [Self::All, Self::Files, Self::Text, Self::Symbols];
        let index = scopes.iter().position(|scope| *scope == self).unwrap_or(0);
        scopes[(index as isize + delta).rem_euclid(scopes.len() as isize) as usize]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchHitKind {
    File,
    Text,
    Symbol,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub kind: SearchHitKind,
    pub path: String,
    pub line: Option<u32>,
    pub title: String,
    pub detail: String,
    pub git_status: String,
}

#[derive(Debug, Clone)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    pub total: usize,
    pub indexing: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchPreview {
    pub path: String,
    pub content: String,
    pub missing: bool,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct SearchClient {
    host: String,
    port: u16,
    capability: String,
}

impl SearchClient {
    pub fn from_env() -> Option<Self> {
        let endpoint = std::env::var("DIFFING_TUI_SEARCH_ENDPOINT").ok()?;
        let capability = std::env::var("DIFFING_TUI_SEARCH_CAPABILITY").ok()?;
        Self::new(&endpoint, capability).ok()
    }

    pub fn new(endpoint: &str, capability: String) -> Result<Self> {
        let authority = endpoint
            .strip_prefix("http://")
            .ok_or_else(|| anyhow!("TUI search endpoint must use http://"))?
            .trim_end_matches('/');
        let (host, port) = authority
            .rsplit_once(':')
            .ok_or_else(|| anyhow!("TUI search endpoint is missing a port"))?;
        if host != "127.0.0.1" && host != "localhost" {
            bail!("TUI search endpoint must be loopback");
        }
        Ok(Self {
            host: host.to_string(),
            port: port.parse().context("invalid TUI search endpoint port")?,
            capability,
        })
    }

    pub fn search(
        &self,
        query: &str,
        scope: SearchScope,
        regex: bool,
        changed_paths: Option<&[String]>,
    ) -> Result<SearchResponse> {
        let value = self.post(
            "/search",
            json!({
                "scope": scope,
                "query": query,
                "limit": 80,
                "regex": regex,
                "changedPaths": changed_paths,
            }),
        )?;
        decode_response(value, scope)
    }

    pub fn preview(&self, path: &str) -> Result<SearchPreview> {
        let value = self.post("/preview", json!({ "path": path }))?;
        Ok(decode_preview(value, path))
    }

    pub fn track(&self, query: &str, path: &str) {
        let _ = self.post("/track", json!({ "query": query, "path": path }));
    }

    fn post(&self, path: &str, body: Value) -> Result<Value> {
        let body = serde_json::to_vec(&body)?;
        let mut stream = TcpStream::connect((self.host.as_str(), self.port))
            .context("connecting to fff search bridge")?;
        stream.set_read_timeout(Some(Duration::from_secs(12)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        write!(
            stream,
            "POST {path} HTTP/1.1\r\nHost: {}:{}\r\nX-Diffing-Capability: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.host,
            self.port,
            self.capability,
            body.len()
        )?;
        stream.write_all(&body)?;
        stream.flush()?;

        let mut response = Vec::new();
        stream
            .take((MAX_RESPONSE_BYTES + 1) as u64)
            .read_to_end(&mut response)?;
        if response.len() > MAX_RESPONSE_BYTES {
            bail!("fff search response is too large");
        }
        let header_end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .ok_or_else(|| anyhow!("invalid response from fff search bridge"))?;
        let headers = String::from_utf8_lossy(&response[..header_end]);
        let status = headers
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(500);
        let payload = &response[header_end + 4..];
        let value: Value =
            serde_json::from_slice(payload).context("decoding response from fff search bridge")?;
        if !(200..300).contains(&status) {
            bail!(
                "{}",
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("fff search request failed")
            );
        }
        Ok(value)
    }
}

fn decode_response(value: Value, scope: SearchScope) -> Result<SearchResponse> {
    let total = value.get("total").and_then(Value::as_u64).unwrap_or(0) as usize;
    let indexing = value
        .get("indexing")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let error = value
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut hits = Vec::new();
    for item in value
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (kind, hit) = if scope == SearchScope::All {
            let kind = match item.get("kind").and_then(Value::as_str) {
                Some("text") => SearchHitKind::Text,
                Some("symbol") => SearchHitKind::Symbol,
                _ => SearchHitKind::File,
            };
            (kind, item.get("hit").unwrap_or(item))
        } else {
            (
                match scope {
                    SearchScope::Files => SearchHitKind::File,
                    SearchScope::Text => SearchHitKind::Text,
                    SearchScope::Symbols => SearchHitKind::Symbol,
                    SearchScope::All => SearchHitKind::File,
                },
                item,
            )
        };
        let Some(path) = hit.get("path").and_then(Value::as_str) else {
            continue;
        };
        let line = hit
            .get("line")
            .and_then(Value::as_u64)
            .map(|line| line as u32);
        let content = hit
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let git_status = hit
            .get("gitStatus")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let title = match kind {
            SearchHitKind::File => hit
                .get("fileName")
                .and_then(Value::as_str)
                .or_else(|| path.rsplit('/').next())
                .unwrap_or(path)
                .to_string(),
            SearchHitKind::Text => content.clone(),
            SearchHitKind::Symbol => hit
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(&content)
                .to_string(),
        };
        let detail = match (kind.clone(), line) {
            (SearchHitKind::File, _) => path
                .rsplit_once('/')
                .map(|(directory, _)| format!("{directory}/"))
                .unwrap_or_else(|| "./".to_string()),
            (SearchHitKind::Symbol, Some(line)) => format!("{path}:{line} · {content}"),
            (_, Some(line)) => format!("{path}:{line}"),
            _ => path.to_string(),
        };
        hits.push(SearchHit {
            kind,
            path: path.to_string(),
            line,
            title,
            detail,
            git_status,
        });
    }
    Ok(SearchResponse {
        hits,
        total,
        indexing,
        error,
    })
}

fn decode_preview(value: Value, fallback_path: &str) -> SearchPreview {
    SearchPreview {
        path: value
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or(fallback_path)
            .to_string(),
        content: value
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        missing: value
            .get("missing")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        binary: value
            .get("binary")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        truncated: value
            .get("truncated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_cycles_in_both_directions() {
        assert_eq!(SearchScope::All.next(1), SearchScope::Files);
        assert_eq!(SearchScope::All.next(-1), SearchScope::Symbols);
    }

    #[test]
    fn rejects_non_loopback_endpoints() {
        assert!(SearchClient::new("http://example.com:80", "token".into()).is_err());
        assert!(SearchClient::new("https://127.0.0.1:80", "token".into()).is_err());
    }

    #[test]
    fn decodes_mixed_web_search_shape() {
        let response = decode_response(
            json!({
                "total": 2,
                "indexing": false,
                "items": [
                    { "kind": "file", "hit": { "path": "src/app.rs", "matchType": "fuzzy" } },
                    { "kind": "text", "hit": { "path": "src/app.rs", "line": 42, "content": "fn render()" } }
                ]
            }),
            SearchScope::All,
        )
        .unwrap();
        assert_eq!(response.hits.len(), 2);
        assert_eq!(response.total, 2);
        assert_eq!(response.hits[0].title, "app.rs");
        assert_eq!(response.hits[0].detail, "src/");
        assert_eq!(response.hits[1].line, Some(42));
        assert_eq!(response.hits[1].detail, "src/app.rs:42");
    }

    #[test]
    fn decodes_preview_shape() {
        let preview = decode_preview(
            json!({
                "path": "src/app.rs",
                "content": "fn main() {}",
                "missing": false,
                "binary": false,
                "truncated": true
            }),
            "fallback.rs",
        );
        assert_eq!(preview.path, "src/app.rs");
        assert_eq!(preview.content, "fn main() {}");
        assert!(preview.truncated);
    }
}
