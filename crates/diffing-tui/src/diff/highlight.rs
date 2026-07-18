//! Theme-aware, bounded syntax highlighting for terminal diff viewports.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use ratatui::style::{Color, Modifier, Style};
use syntect::easy::HighlightLines;
use syntect::highlighting::{Theme, ThemeSet};
use syntect::parsing::{SyntaxReference, SyntaxSet};

use crate::themes::{Palette, ThemeName};

static SYNTAX_SET: Lazy<SyntaxSet> = Lazy::new(SyntaxSet::load_defaults_newlines);
static THEME_SET: Lazy<ThemeSet> = Lazy::new(ThemeSet::load_defaults);
static CACHE: Lazy<Mutex<HighlightCache>> = Lazy::new(|| Mutex::new(HighlightCache::default()));
const MAX_CACHE_ENTRIES: usize = 4_096;
const MAX_CACHE_BYTES: usize = 8 * 1024 * 1024;

type CacheKey = (String, String, String, u32);

#[derive(Default)]
struct HighlightCache {
    entries: HashMap<CacheKey, Vec<StyledSpan>>,
    order: VecDeque<CacheKey>,
    bytes: usize,
}

impl HighlightCache {
    fn key(path: &str, content: &str, theme: ThemeName, background: Color) -> CacheKey {
        (
            path.to_string(),
            content.to_string(),
            theme.label().to_string(),
            color_key(background),
        )
    }

    fn get(
        &self,
        path: &str,
        content: &str,
        theme: ThemeName,
        background: Color,
    ) -> Option<Vec<StyledSpan>> {
        self.entries
            .get(&Self::key(path, content, theme, background))
            .cloned()
    }

    fn insert(
        &mut self,
        path: &str,
        content: &str,
        theme: ThemeName,
        background: Color,
        spans: Vec<StyledSpan>,
    ) {
        let key = Self::key(path, content, theme, background);
        if self.entries.contains_key(&key) {
            return;
        }
        let bytes = key.0.len()
            + key.1.len()
            + key.2.len()
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
                    + oldest.2.len()
                    + removed
                        .iter()
                        .map(|span| span.text.len() + 32)
                        .sum::<usize>();
                self.bytes = self.bytes.saturating_sub(removed_bytes);
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct StyledSpan {
    pub text: String,
    pub style: Style,
}

pub fn syntax_for_path(path: &str) -> &SyntaxReference {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    SYNTAX_SET
        .find_syntax_by_name(language_for_extension(ext))
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

pub fn highlight_line(
    path: &str,
    content: &str,
    theme: ThemeName,
    palette: &Palette,
    background: Color,
) -> Vec<StyledSpan> {
    if let Ok(cache) = CACHE.lock() {
        if let Some(spans) = cache.get(path, content, theme, background) {
            return spans;
        }
    }
    let spans = highlight_uncached(path, content, theme, palette, background);
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(path, content, theme, background, spans.clone());
    }
    spans
}

fn highlight_uncached(
    path: &str,
    content: &str,
    theme_name: ThemeName,
    palette: &Palette,
    background: Color,
) -> Vec<StyledSpan> {
    let syntax = syntax_for_path(path);
    let mut highlighter = HighlightLines::new(syntax, syntax_theme(theme_name));
    let synthetic = format!("{}\n", content.trim_end_matches('\n'));
    match highlighter.highlight_line(&synthetic, &SYNTAX_SET) {
        Ok(ranges) => ranges
            .into_iter()
            .map(|(style, text)| StyledSpan {
                text: text.trim_end_matches('\n').to_string(),
                style: syntect_style_to_ratatui(style, palette.fg, background),
            })
            .filter(|span| !span.text.is_empty())
            .collect(),
        Err(_) => vec![StyledSpan {
            text: content.to_string(),
            style: Style::default().fg(palette.fg),
        }],
    }
}

fn syntax_theme(theme: ThemeName) -> &'static Theme {
    let preferred = if theme.is_light() {
        "InspiredGitHub"
    } else {
        "base16-ocean.dark"
    };
    THEME_SET
        .themes
        .get(preferred)
        .or_else(|| THEME_SET.themes.values().next())
        .expect("syntect default theme set is empty")
}

fn syntect_style_to_ratatui(
    style: syntect::highlighting::Style,
    fallback: Color,
    background: Color,
) -> Style {
    let foreground = ensure_contrast(
        Color::Rgb(style.foreground.r, style.foreground.g, style.foreground.b),
        fallback,
        background,
    );
    let mut output = Style::default().fg(foreground);
    if style
        .font_style
        .contains(syntect::highlighting::FontStyle::BOLD)
    {
        output = output.add_modifier(Modifier::BOLD);
    }
    if style
        .font_style
        .contains(syntect::highlighting::FontStyle::ITALIC)
    {
        output = output.add_modifier(Modifier::ITALIC);
    }
    if style
        .font_style
        .contains(syntect::highlighting::FontStyle::UNDERLINE)
    {
        output = output.add_modifier(Modifier::UNDERLINED);
    }
    output
}

fn ensure_contrast(color: Color, fallback: Color, background: Color) -> Color {
    if contrast_ratio(color, background) >= 4.5 {
        return color;
    }
    (1..=20)
        .map(|step| blend(fallback, color, step as f32 / 20.0))
        .find(|candidate| contrast_ratio(*candidate, background) >= 4.5)
        .unwrap_or(fallback)
}

fn blend(foreground: Color, background: Color, amount: f32) -> Color {
    let (fr, fg, fb) = rgb(foreground);
    let (br, bg, bb) = rgb(background);
    let channel =
        |front: u8, back: u8| (back as f32 + (front as f32 - back as f32) * amount).round() as u8;
    Color::Rgb(channel(fr, br), channel(fg, bg), channel(fb, bb))
}

fn contrast_ratio(foreground: Color, background: Color) -> f32 {
    let foreground = relative_luminance(foreground);
    let background = relative_luminance(background);
    let lighter = foreground.max(background);
    let darker = foreground.min(background);
    (lighter + 0.05) / (darker + 0.05)
}

fn relative_luminance(color: Color) -> f32 {
    let (r, g, b) = rgb(color);
    let linear = |channel: u8| {
        let value = channel as f32 / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

fn color_key(color: Color) -> u32 {
    let (r, g, b) = rgb(color);
    ((r as u32) << 16) | ((g as u32) << 8) | b as u32
}

fn rgb(color: Color) -> (u8, u8, u8) {
    match color {
        Color::Rgb(r, g, b) => (r, g, b),
        _ => (128, 128, 128),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_extension_resolves() {
        assert_eq!(syntax_for_path("foo.rs").name, "Rust");
    }

    #[test]
    fn unknown_extension_falls_back_to_plain_text() {
        assert_eq!(syntax_for_path("foo.unknownext").name, "Plain Text");
    }

    #[test]
    fn highlighting_preserves_content_and_emits_multiple_styles() {
        let theme = ThemeName::default();
        let palette = Palette::for_theme(theme);
        let spans = highlight_line("foo.rs", "let value = 1;", theme, &palette, palette.bg);
        let joined: String = spans.iter().map(|span| span.text.as_str()).collect();
        assert_eq!(joined, "let value = 1;");
        let colors: std::collections::HashSet<_> = spans.iter().map(|span| span.style.fg).collect();
        assert!(colors.len() > 1);
    }

    #[test]
    fn cache_isolated_by_terminal_theme() {
        let dark = ThemeName::from_label("github-dark").unwrap();
        let light = ThemeName::from_label("github-light").unwrap();
        let dark_palette = Palette::for_theme(dark);
        let light_palette = Palette::for_theme(light);
        let dark_spans = highlight_line(
            "foo.rs",
            "let value = 1;",
            dark,
            &dark_palette,
            dark_palette.bg,
        );
        let light_spans = highlight_line(
            "foo.rs",
            "let value = 1;",
            light,
            &light_palette,
            light_palette.bg,
        );
        assert_ne!(dark_spans[0].style.fg, light_spans[0].style.fg);
    }
}
