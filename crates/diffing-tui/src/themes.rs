//! Terminal palettes derived from the web UI's theme CSS.
//!
//! The CSS is embedded in the native binary and parsed once. This keeps the
//! browser and terminal theme catalogs aligned without a network dependency or
//! a second hand-maintained list.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use ratatui::style::Color;

const WEB_THEME_CSS: &str = include_str!("../../../src/ui/styles/global.css");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThemeName(u16);

#[derive(Debug, Clone)]
pub struct ThemeDefinition {
    pub id: String,
    pub name: String,
    pub light: bool,
    pub palette: Palette,
}

static THEMES: Lazy<Vec<ThemeDefinition>> = Lazy::new(parse_theme_catalog);
static THEME_NAMES: Lazy<Vec<ThemeName>> = Lazy::new(|| {
    (0..THEMES.len())
        .map(|index| ThemeName(index as u16))
        .collect()
});

impl ThemeName {
    #[allow(non_upper_case_globals)]
    #[cfg(test)]
    pub const GithubDark: ThemeName = ThemeName(7);

    pub fn all() -> &'static [ThemeName] {
        THEME_NAMES.as_slice()
    }

    pub fn label(self) -> &'static str {
        &THEMES[self.0 as usize].id
    }

    pub fn display_name(self) -> &'static str {
        &THEMES[self.0 as usize].name
    }

    pub fn is_light(self) -> bool {
        THEMES[self.0 as usize].light
    }

    pub fn from_label(label: &str) -> Option<ThemeName> {
        THEMES
            .iter()
            .position(|theme| theme.id == label)
            .map(|index| ThemeName(index as u16))
    }
}

impl Default for ThemeName {
    fn default() -> Self {
        Self::from_label("github-dark").unwrap_or(ThemeName(0))
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Palette {
    pub bg: Color,
    pub panel: Color,
    pub elevated: Color,
    pub fg: Color,
    pub dim: Color,
    pub accent: Color,
    pub added: Color,
    pub removed: Color,
    pub added_bg: Color,
    pub removed_bg: Color,
    pub gutter: Color,
    pub selection_bg: Color,
    pub border: Color,
    pub border_focused: Color,
    pub comment: Color,
    pub status_bar_bg: Color,
}

impl Default for Palette {
    fn default() -> Self {
        Self::for_theme(ThemeName::default())
    }
}

impl Palette {
    pub fn for_theme(name: ThemeName) -> Self {
        THEMES
            .get(name.0 as usize)
            .map(|theme| theme.palette)
            .unwrap_or_else(|| THEMES[0].palette)
    }
}

fn parse_theme_catalog() -> Vec<ThemeDefinition> {
    let mut themes = Vec::new();
    let mut seen = HashSet::new();
    let marker = "[data-theme=\"";
    let mut remainder = WEB_THEME_CSS;
    while let Some(start) = remainder.find(marker) {
        remainder = &remainder[start + marker.len()..];
        let Some(id_end) = remainder.find("\"]") else {
            break;
        };
        let id = &remainder[..id_end];
        let Some(open) = remainder[id_end..].find('{') else {
            break;
        };
        let block_start = id_end + open + 1;
        let Some(close) = remainder[block_start..].find('}') else {
            break;
        };
        let block = &remainder[block_start..block_start + close];
        remainder = &remainder[block_start + close + 1..];
        if !seen.insert(id.to_string()) {
            continue;
        }
        if let Some(theme) = parse_theme(id, block) {
            themes.push(theme);
        }
    }
    assert!(!themes.is_empty(), "embedded web theme catalog is empty");
    themes
}

fn parse_theme(id: &str, block: &str) -> Option<ThemeDefinition> {
    let bg = css_color(block, "bg-primary")?;
    let panel = css_color(block, "bg-secondary").unwrap_or(bg);
    let elevated = css_color(block, "bg-tertiary").unwrap_or_else(|| blend(panel, bg, 0.5));
    let fg = css_color(block, "text-primary")?;
    let dim = css_color(block, "text-muted").unwrap_or_else(|| blend(fg, bg, 0.55));
    let accent = css_color(block, "border-focus")
        .or_else(|| css_color(block, "primary"))
        .unwrap_or(fg);
    let added = css_color(block, "feedback-success-text")
        .or_else(|| css_color(block, "success"))
        .unwrap_or(Color::Rgb(63, 185, 80));
    let removed = css_color(block, "feedback-danger-text")
        .or_else(|| css_color(block, "danger"))
        .unwrap_or(Color::Rgb(248, 81, 73));
    let border = css_color(block, "border-color")
        .or_else(|| css_color(block, "border-normal"))
        .unwrap_or(elevated);
    let comment = css_color(block, "comment-border").unwrap_or(accent);
    let light = relative_luminance(bg) > relative_luminance(fg);
    Some(ThemeDefinition {
        id: id.to_string(),
        name: display_name(id),
        light,
        palette: Palette {
            bg,
            panel,
            elevated,
            fg,
            dim,
            accent,
            added,
            removed,
            added_bg: blend(added, bg, if light { 0.12 } else { 0.18 }),
            removed_bg: blend(removed, bg, if light { 0.10 } else { 0.18 }),
            gutter: dim,
            selection_bg: blend(accent, bg, if light { 0.16 } else { 0.28 }),
            border,
            border_focused: accent,
            comment,
            status_bar_bg: panel,
        },
    })
}

fn css_color(block: &str, property: &str) -> Option<Color> {
    let prefix = format!("--{property}:");
    let value = block
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix(&prefix))?
        .split(';')
        .next()?
        .trim();
    parse_hex(value)
}

fn parse_hex(value: &str) -> Option<Color> {
    let hex = value.strip_prefix('#')?;
    let (r, g, b) = match hex.len() {
        3 => {
            let mut chars = hex.chars();
            let r = chars.next()?.to_digit(16)? as u8 * 17;
            let g = chars.next()?.to_digit(16)? as u8 * 17;
            let b = chars.next()?.to_digit(16)? as u8 * 17;
            (r, g, b)
        }
        6 => (
            u8::from_str_radix(&hex[0..2], 16).ok()?,
            u8::from_str_radix(&hex[2..4], 16).ok()?,
            u8::from_str_radix(&hex[4..6], 16).ok()?,
        ),
        _ => return None,
    };
    Some(Color::Rgb(r, g, b))
}

fn rgb(color: Color) -> (u8, u8, u8) {
    match color {
        Color::Rgb(r, g, b) => (r, g, b),
        _ => (128, 128, 128),
    }
}

fn blend(foreground: Color, background: Color, amount: f32) -> Color {
    let (fr, fg, fb) = rgb(foreground);
    let (br, bg, bb) = rgb(background);
    let channel =
        |front: u8, back: u8| (back as f32 + (front as f32 - back as f32) * amount).round() as u8;
    Color::Rgb(channel(fr, br), channel(fg, bg), channel(fb, bb))
}

fn relative_luminance(color: Color) -> f32 {
    let (r, g, b) = rgb(color);
    0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32
}

fn display_name(id: &str) -> String {
    id.split('-')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_contains_every_unique_web_theme() {
        assert_eq!(ThemeName::all().len(), 52);
        for required in [
            "github-dark",
            "github-light",
            "catppuccin-mocha",
            "material-theme-palenight",
            "rose-pine-dawn",
            "vitesse-light",
            "dawnfox",
        ] {
            assert!(
                ThemeName::from_label(required).is_some(),
                "missing {required}"
            );
        }
    }

    #[test]
    fn every_theme_has_readable_foreground_and_distinct_surfaces() {
        for theme in ThemeName::all() {
            let palette = Palette::for_theme(*theme);
            let contrast = (relative_luminance(palette.fg) - relative_luminance(palette.bg)).abs();
            assert!(contrast >= 45.0, "low contrast for {}", theme.label());
            assert_ne!(
                rgb(palette.panel),
                rgb(palette.fg),
                "bad panel for {}",
                theme.label()
            );
        }
    }

    #[test]
    fn label_round_trip() {
        for theme in ThemeName::all() {
            assert_eq!(ThemeName::from_label(theme.label()), Some(*theme));
        }
    }
}
