//! Tiny syntax-highlighting wrapper around `syntect`.
//!
//! Uses a built-in theme (`InspiredGitHub`) and a `default-newlines` syntax
//! set so we don't need any external `.tmTheme` / `.tmLanguage` files. The
//! highlighter is thread-safe (syntect's `SyntaxSet` / `Theme` are immutable
//! after construction) and cheap to clone (Arc-backed).
//!
//! The `Line` API is allocation-free per call: it returns styled spans that
//! can be wrapped in `ratatui::text::Span` and composed into a `Line`.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Span;
use syntect::easy::HighlightLines;
use syntect::highlighting::{Theme, ThemeSet};
use syntect::parsing::{SyntaxReference, SyntaxSet};

static SYNTAX_SET: Lazy<SyntaxSet> = Lazy::new(SyntaxSet::load_defaults_newlines);
static THEME: Lazy<Theme> =
    Lazy::new(|| ThemeSet::load_defaults().themes["InspiredGitHub"].clone());
static CACHE: Lazy<Mutex<HighlightCache>> = Lazy::new(|| Mutex::new(HighlightCache::default()));
const MAX_CACHE_ENTRIES: usize = 4_096;
const MAX_CACHE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
struct HighlightCache {
    entries: HashMap<(String, String), Vec<StyledSpan>>,
    order: VecDeque<(String, String)>,
    bytes: usize,
}

impl HighlightCache {
    fn get(&self, path: &str, content: &str) -> Option<Vec<StyledSpan>> {
        self.entries
            .get(&(path.to_string(), content.to_string()))
            .cloned()
    }

    fn insert(&mut self, path: &str, content: &str, spans: Vec<StyledSpan>) {
        let key = (path.to_string(), content.to_string());
        if self.entries.contains_key(&key) {
            return;
        }
        let bytes = key.0.len()
            + key.1.len()
            + spans.iter().map(|span| span.text.len() + 32).sum::<usize>();
        self.bytes = self.bytes.saturating_add(bytes);
        self.order.push_back(key.clone());
        self.entries.insert(key, spans);
        while self.entries.len() > MAX_CACHE_ENTRIES || self.bytes > MAX_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                let removed_bytes = oldest.0.len()
                    + oldest.1.len()
                    + removed
                        .iter()
                        .map(|span| span.text.len() + 32)
                        .sum::<usize>();
                self.bytes = self.bytes.saturating_sub(removed_bytes);
            }
        }
    }
}

/// One styled span within a highlighted line. Cheap to construct and pass
/// around; the renderer converts to a `ratatui::text::Span`.
#[derive(Debug, Clone)]
pub struct StyledSpan {
    pub text: String,
    pub style: Style,
}

impl StyledSpan {
    #[allow(dead_code)]
    pub fn to_ratatui(&self) -> Span<'static> {
        Span::styled(self.text.clone(), self.style)
    }
}

/// Resolve a syntax for a file path (by extension). Falls back to plain text
/// for unknown extensions.
pub fn syntax_for_path(path: &str) -> &SyntaxReference {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let name = language_for_extension(ext);
    SYNTAX_SET
        .find_syntax_by_name(name)
        .unwrap_or_else(|| SYNTAX_SET.find_syntax_by_name("Plain Text").unwrap())
}

fn language_for_extension(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "rs" => "Rust",
        "ts" | "mts" | "cts" => "TypeScript",
        "tsx" => "TypeScriptReact",
        "js" | "mjs" | "cjs" => "JavaScript",
        "jsx" => "JavaScriptReact",
        "py" | "pyi" => "Python",
        "go" => "Go",
        "json" | "jsonc" => "JSON",
        "md" | "markdown" => "Markdown",
        "css" => "CSS",
        "html" | "htm" => "HTML",
        "sh" | "bash" | "zsh" => "Bourne Again Shell (bash)",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        "sql" => "SQL",
        "swift" => "Swift",
        "kt" | "kts" => "Kotlin",
        "java" => "Java",
        "c" | "h" => "C",
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" => "C++",
        "rb" => "Ruby",
        "php" => "PHP",
        "scala" | "sbt" => "Scala",
        "lua" => "Lua",
        "vim" => "VimL",
        _ => "Plain Text",
    }
}

/// Highlight a single line of `content` (no trailing newline) for the syntax
/// resolved from `path`. The returned spans preserve the original
/// whitespace so the caller can compose them into a `ratatui::text::Line`
/// at any width.
pub fn highlight_line(path: &str, content: &str) -> Vec<StyledSpan> {
    if let Ok(cache) = CACHE.lock() {
        if let Some(spans) = cache.get(path, content) {
            return spans;
        }
    }
    let spans = highlight_uncached(path, content);
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(path, content, spans.clone());
    }
    spans
}

fn highlight_uncached(path: &str, content: &str) -> Vec<StyledSpan> {
    let syntax = syntax_for_path(path);
    // `LinesWithEndings` is what `syntect` expects: it wants lines *with*
    // their trailing newline so it can keep its parser state across lines.
    let mut highlighter = HighlightLines::new(syntax, &THEME);
    // Pre-pad with a fake newline so the API contract is "one line in, one
    // line worth of spans out". The newline is consumed by syntect and does
    // not appear in the output.
    let synthetic = format!("{}\n", content.trim_end_matches('\n'));
    match highlighter.highlight_line(&synthetic, &SYNTAX_SET) {
        Ok(ranges) => ranges
            .into_iter()
            .map(|(style, text)| StyledSpan {
                text: text.trim_end_matches('\n').to_string(),
                style: syntect_style_to_ratatui(style),
            })
            .filter(|s| !s.text.is_empty())
            .collect(),
        Err(_) => vec![StyledSpan {
            text: content.to_string(),
            style: Style::default(),
        }],
    }
}

fn syntect_style_to_ratatui(s: syntect::highlighting::Style) -> Style {
    let mut out = Style::default().fg(Color::Rgb(s.foreground.r, s.foreground.g, s.foreground.b));
    if s.font_style
        .contains(syntect::highlighting::FontStyle::BOLD)
    {
        out = out.add_modifier(Modifier::BOLD);
    }
    if s.font_style
        .contains(syntect::highlighting::FontStyle::ITALIC)
    {
        out = out.add_modifier(Modifier::ITALIC);
    }
    if s.font_style
        .contains(syntect::highlighting::FontStyle::UNDERLINE)
    {
        out = out.add_modifier(Modifier::UNDERLINED);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_extension_resolves() {
        let s = syntax_for_path("foo.rs");
        assert_eq!(s.name, "Rust");
    }

    #[test]
    fn unknown_extension_falls_back_to_plain_text() {
        let s = syntax_for_path("foo.unknownext");
        assert_eq!(s.name, "Plain Text");
    }

    #[test]
    fn highlight_returns_at_least_one_span_for_nonempty_line() {
        let spans = highlight_line("foo.rs", "let x = 1;");
        assert!(!spans.is_empty());
        let joined: String = spans.iter().map(|s| s.text.as_str()).collect();
        assert!(joined.contains("let"));
    }

    #[test]
    fn highlight_preserves_text_content() {
        let spans = highlight_line("foo.py", "def hello(): pass");
        let joined: String = spans.iter().map(|s| s.text.as_str()).collect();
        assert!(joined.contains("def"));
        assert!(joined.contains("hello"));
        assert!(joined.contains("pass"));
    }
}
