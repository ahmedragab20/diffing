//! Theme-aware, bounded syntax highlighting for terminal diff viewports.
//!
//! Highlighting is sequential per `(file, syntax, theme)` session: callers
//! rendering a viewport should invoke [`reset_highlight_session`] once per
//! file card so multi-line constructs (strings, block comments) colorize
//! correctly across adjacent diff lines.

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use once_cell::sync::Lazy;
use ratatui::style::{Color, Modifier, Style};
use syntect::easy::HighlightLines;
use syntect::highlighting::{Theme, ThemeSet};
use syntect::parsing::{SyntaxReference, SyntaxSet};

use crate::themes::{Palette, ThemeName};

static SYNTAX_SET: Lazy<SyntaxSet> = Lazy::new(two_face::syntax::extra_newlines);
static THEME_SET: Lazy<ThemeSet> = Lazy::new(ThemeSet::load_defaults);
thread_local! {
    static CACHE: RefCell<HighlightCache> = RefCell::new(HighlightCache::default());
    static SEQUENTIAL: RefCell<Option<SequentialSession>> = const { RefCell::new(None) };
}
const MAX_CACHE_ENTRIES: usize = 4_096;
const MAX_CACHE_BYTES: usize = 8 * 1024 * 1024;
const MAX_SEQUENTIAL_LOOKBACK: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct HighlightContext {
    theme: ThemeName,
    background: u32,
    palette: u64,
}

type HighlightedLine = Arc<[StyledSpan]>;
type ContentHighlights = HashMap<String, HighlightedLine>;
type LanguageHighlights = HashMap<String, ContentHighlights>;

#[derive(Default)]
struct HighlightCache {
    entries: HashMap<HighlightContext, LanguageHighlights>,
    order: VecDeque<(HighlightContext, String, String)>,
    bytes: usize,
}

impl HighlightCache {
    fn get(
        &self,
        context: HighlightContext,
        language: &str,
        content: &str,
    ) -> Option<HighlightedLine> {
        self.entries
            .get(&context)?
            .get(language)?
            .get(content)
            .cloned()
    }

    fn insert(
        &mut self,
        context: HighlightContext,
        language: &str,
        content: &str,
        spans: HighlightedLine,
    ) {
        if self
            .entries
            .get(&context)
            .and_then(|languages| languages.get(language))
            .is_some_and(|contents| contents.contains_key(content))
        {
            return;
        }
        let bytes = language.len()
            + content.len()
            + spans.iter().map(|span| span.text.len() + 32).sum::<usize>();
        self.bytes = self.bytes.saturating_add(bytes);
        self.order
            .push_back((context, language.to_string(), content.to_string()));
        self.entries
            .entry(context)
            .or_default()
            .entry(language.to_string())
            .or_default()
            .insert(content.to_string(), spans);
        while self.order.len() > MAX_CACHE_ENTRIES || self.bytes > MAX_CACHE_BYTES {
            let Some((old_context, old_language, old_content)) = self.order.pop_front() else {
                break;
            };
            let mut remove_context = false;
            if let Some(languages) = self.entries.get_mut(&old_context) {
                let mut remove_language = false;
                if let Some(contents) = languages.get_mut(old_language.as_str()) {
                    if let Some(removed) = contents.remove(old_content.as_str()) {
                        let removed_bytes = old_language.len()
                            + old_content.len()
                            + removed
                                .iter()
                                .map(|span| span.text.len() + 32)
                                .sum::<usize>();
                        self.bytes = self.bytes.saturating_sub(removed_bytes);
                    }
                    remove_language = contents.is_empty();
                }
                if remove_language {
                    languages.remove(old_language.as_str());
                }
                remove_context = languages.is_empty();
            }
            if remove_context {
                self.entries.remove(&old_context);
            }
        }
    }
}

struct SequentialSession {
    key: (String, HighlightContext),
    highlighter: HighlightLines<'static>,
    recent: VecDeque<String>,
}

impl SequentialSession {
    fn new(path: &str, context: HighlightContext) -> Self {
        let syntax = syntax_for_path(path);
        Self {
            key: (path.to_string(), context),
            highlighter: HighlightLines::new(syntax, syntax_theme()),
            recent: VecDeque::with_capacity(MAX_SEQUENTIAL_LOOKBACK),
        }
    }

    fn highlight_line(
        &mut self,
        content: &str,
        palette: &Palette,
        background: Color,
    ) -> Vec<StyledSpan> {
        if self.recent.len() >= MAX_SEQUENTIAL_LOOKBACK {
            let syntax = syntax_for_path(&self.key.0);
            self.highlighter = HighlightLines::new(syntax, syntax_theme());
            self.recent.clear();
        }
        self.recent.push_back(content.to_string());
        highlight_uncached_with_highlighter(&mut self.highlighter, content, palette, background)
    }
}

/// Begin (or reset) sequential highlighting for one file card render pass.
pub fn reset_highlight_session(path: &str, theme: ThemeName, palette: &Palette, background: Color) {
    let context = HighlightContext {
        theme,
        background: color_key(background),
        palette: palette_key(palette),
    };
    SEQUENTIAL.with(|session| {
        *session.borrow_mut() = Some(SequentialSession::new(path, context));
    });
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
        .find_syntax_by_extension(ext)
        .or_else(|| SYNTAX_SET.find_syntax_by_name(language_for_extension(ext)))
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

const MAX_HIGHLIGHT_LINE_BYTES: usize = 8 * 1024;

pub fn highlight_line(
    path: &str,
    content: &str,
    theme: ThemeName,
    palette: &Palette,
    background: Color,
) -> Arc<[StyledSpan]> {
    if content.len() > MAX_HIGHLIGHT_LINE_BYTES {
        return Arc::from([StyledSpan {
            text: content.to_string(),
            style: Style::default().fg(palette.code_fg),
        }]);
    }
    let syntax = syntax_for_path(path);
    let context = HighlightContext {
        theme,
        background: color_key(background),
        palette: palette_key(palette),
    };
    if let Some(spans) =
        CACHE.with(|cache| cache.borrow().get(context, syntax.name.as_str(), content))
    {
        return spans;
    }
    let spans: Arc<[StyledSpan]> = if let Some(spans) = SEQUENTIAL.with(|session| {
        let mut session = session.borrow_mut();
        if let Some(active) = session.as_mut() {
            if active.key == (path.to_string(), context) {
                return Some(active.highlight_line(content, palette, background));
            }
        }
        None
    }) {
        Arc::from(spans)
    } else {
        Arc::from(highlight_uncached(syntax, content, palette, background))
    };
    CACHE.with(|cache| {
        cache
            .borrow_mut()
            .insert(context, syntax.name.as_str(), content, spans.clone());
    });
    spans
}

fn highlight_uncached(
    syntax: &SyntaxReference,
    content: &str,
    palette: &Palette,
    background: Color,
) -> Vec<StyledSpan> {
    let mut highlighter = HighlightLines::new(syntax, syntax_theme());
    highlight_uncached_with_highlighter(&mut highlighter, content, palette, background)
}

fn highlight_uncached_with_highlighter(
    highlighter: &mut HighlightLines<'_>,
    content: &str,
    palette: &Palette,
    background: Color,
) -> Vec<StyledSpan> {
    let synthetic = format!("{}\n", content.trim_end_matches('\n'));
    match highlighter.highlight_line(&synthetic, &SYNTAX_SET) {
        Ok(ranges) => ranges
            .into_iter()
            .map(|(style, text)| StyledSpan {
                text: text.trim_end_matches('\n').to_string(),
                style: syntect_style_to_ratatui(style, palette, background),
            })
            .filter(|span| !span.text.is_empty())
            .collect(),
        Err(_) => vec![StyledSpan {
            text: content.to_string(),
            style: Style::default().fg(palette.code_fg),
        }],
    }
}

fn syntax_theme() -> &'static Theme {
    THEME_SET
        .themes
        .get("base16-ocean.dark")
        .or_else(|| THEME_SET.themes.values().next())
        .expect("syntect default theme set is empty")
}

fn syntect_style_to_ratatui(
    style: syntect::highlighting::Style,
    palette: &Palette,
    background: Color,
) -> Style {
    let source = Color::Rgb(style.foreground.r, style.foreground.g, style.foreground.b);
    let (target, role) = map_source_color(source, palette);
    let foreground = ensure_contrast(target, palette.code_fg, background, role.minimum_contrast());
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
    if role == SyntaxRole::Comment {
        output = output.add_modifier(Modifier::ITALIC);
    }
    output
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SyntaxRole {
    Text,
    Comment,
    Keyword,
    String,
    Type,
    Constant,
    Function,
}

impl SyntaxRole {
    fn minimum_contrast(self) -> f32 {
        match self {
            Self::Text => 4.5,
            _ => 3.0,
        }
    }
}

fn map_source_color(source: Color, palette: &Palette) -> (Color, SyntaxRole) {
    // Syntect ships a compact Base16 theme whose role colors are stable.
    // Treat it as a syntax classifier, then project those roles onto the
    // selected diffing theme instead of leaking Ocean/GitHub colors into all
    // 52 terminal themes.
    const ANCHORS: [((u8, u8, u8), SyntaxRole); 16] = [
        ((43, 48, 59), SyntaxRole::Text),
        ((52, 61, 70), SyntaxRole::Text),
        ((79, 91, 102), SyntaxRole::Comment),
        ((101, 115, 126), SyntaxRole::Comment),
        ((167, 173, 186), SyntaxRole::Text),
        ((192, 197, 206), SyntaxRole::Text),
        ((223, 225, 232), SyntaxRole::Text),
        ((239, 241, 245), SyntaxRole::Text),
        ((191, 97, 106), SyntaxRole::Constant),
        ((208, 135, 112), SyntaxRole::Constant),
        ((235, 203, 139), SyntaxRole::Type),
        ((163, 190, 140), SyntaxRole::String),
        ((150, 181, 180), SyntaxRole::Function),
        ((143, 161, 179), SyntaxRole::Function),
        ((180, 142, 173), SyntaxRole::Keyword),
        ((171, 121, 103), SyntaxRole::Constant),
    ];
    let source = rgb(source);
    let role = ANCHORS
        .iter()
        .min_by_key(|((r, g, b), _)| {
            let dr = source.0 as i32 - *r as i32;
            let dg = source.1 as i32 - *g as i32;
            let db = source.2 as i32 - *b as i32;
            dr * dr + dg * dg + db * db
        })
        .map(|(_, role)| *role)
        .unwrap_or(SyntaxRole::Text);
    let color = match role {
        SyntaxRole::Text => palette.code_fg,
        SyntaxRole::Comment => palette.syntax_comment,
        SyntaxRole::Keyword => palette.syntax_keyword,
        SyntaxRole::String => palette.syntax_string,
        SyntaxRole::Type => palette.syntax_type,
        SyntaxRole::Constant => palette.syntax_constant,
        SyntaxRole::Function => palette.syntax_function,
    };
    (color, role)
}

fn ensure_contrast(color: Color, fallback: Color, background: Color, minimum: f32) -> Color {
    if contrast_ratio(color, background) >= minimum {
        return color;
    }
    (1..=20)
        .map(|step| blend(fallback, color, step as f32 / 20.0))
        .find(|candidate| contrast_ratio(*candidate, background) >= minimum)
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

fn palette_key(palette: &Palette) -> u64 {
    [
        palette.code_fg,
        palette.syntax_keyword,
        palette.syntax_string,
        palette.syntax_type,
        palette.syntax_constant,
        palette.syntax_function,
        palette.syntax_comment,
    ]
    .into_iter()
    .fold(0xcbf2_9ce4_8422_2325u64, |hash, color| {
        (hash ^ color_key(color) as u64).wrapping_mul(0x100_0000_01b3)
    })
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
    fn web_language_extensions_do_not_fall_back_to_plain_text() {
        for path in ["foo.ts", "foo.tsx", "foo.js", "foo.jsx"] {
            assert_ne!(
                syntax_for_path(path).name,
                "Plain Text",
                "{path} resolved as plain text"
            );
        }
    }

    #[test]
    fn typescript_highlighting_emits_semantic_token_colors() {
        let theme = ThemeName::from_label("rose-pine").unwrap();
        let palette = Palette::for_theme(theme);
        let spans = highlight_line(
            "src/cli.ts",
            "const result = await import('./module.js');",
            theme,
            &palette,
            palette.bg,
        );
        let colors: std::collections::HashSet<_> =
            spans.iter().filter_map(|span| span.style.fg).collect();
        assert!(
            colors.contains(&palette.syntax_keyword),
            "TypeScript keywords were not classified: {spans:?}"
        );
        assert!(
            colors.contains(&palette.syntax_string),
            "TypeScript strings were not classified: {spans:?}"
        );
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

    #[test]
    fn comments_use_the_selected_theme_and_remain_italic() {
        let rose_pine = ThemeName::from_label("rose-pine").unwrap();
        let tokyo_night = ThemeName::from_label("tokyo-night").unwrap();
        let rose_palette = Palette::for_theme(rose_pine);
        let tokyo_palette = Palette::for_theme(tokyo_night);
        let rose = highlight_line(
            "foo.rs",
            "// quiet comment",
            rose_pine,
            &rose_palette,
            rose_palette.bg,
        );
        let tokyo = highlight_line(
            "foo.rs",
            "// quiet comment",
            tokyo_night,
            &tokyo_palette,
            tokyo_palette.bg,
        );
        assert_eq!(rose[0].style.fg, Some(rose_palette.syntax_comment));
        assert_eq!(tokyo[0].style.fg, Some(tokyo_palette.syntax_comment));
        assert_ne!(rose[0].style.fg, tokyo[0].style.fg);
        assert!(rose[0].style.add_modifier.contains(Modifier::ITALIC));
    }
}
