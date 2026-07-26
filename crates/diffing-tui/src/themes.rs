//! Terminal palettes derived from the web UI's theme CSS.
//!
//! The CSS is embedded in the native binary and parsed once. This keeps the
//! browser and terminal theme catalogs aligned without a network dependency or
//! a second hand-maintained list.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use ratatui::style::Color;

const WEB_THEME_CSS: &str = include_str!("../../../src/ui/styles/global.css");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
    pub element: Color,
    pub fg: Color,
    pub code_fg: Color,
    pub dim: Color,
    pub accent: Color,
    pub added: Color,
    pub removed: Color,
    pub warning: Color,
    pub added_bg: Color,
    pub removed_bg: Color,
    pub gutter: Color,
    pub selection_bg: Color,
    pub border_subtle: Color,
    pub border: Color,
    pub border_focused: Color,
    pub comment: Color,
    pub syntax_keyword: Color,
    pub syntax_string: Color,
    pub syntax_type: Color,
    pub syntax_constant: Color,
    pub syntax_function: Color,
    pub syntax_comment: Color,
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

    pub fn for_terminal(name: ThemeName) -> Self {
        let palette = Self::for_theme(name);
        if std::env::var_os("NO_COLOR").is_some()
            || std::env::var("TERM").is_ok_and(|term| term == "dumb")
        {
            return palette.map_colors(|_| Color::Reset);
        }
        let truecolor = std::env::var("COLORTERM").is_ok_and(|value| {
            let value = value.to_ascii_lowercase();
            value.contains("truecolor") || value.contains("24bit")
        }) || std::env::var("TERM").is_ok_and(|value| {
            let value = value.to_ascii_lowercase();
            value.contains("direct") || value.contains("truecolor")
        });
        if truecolor {
            palette
        } else {
            palette.map_colors(ansi256)
        }
    }

    fn map_colors(self, map: impl Fn(Color) -> Color) -> Self {
        Self {
            bg: map(self.bg),
            panel: map(self.panel),
            elevated: map(self.elevated),
            element: map(self.element),
            fg: map(self.fg),
            code_fg: map(self.code_fg),
            dim: map(self.dim),
            accent: map(self.accent),
            added: map(self.added),
            removed: map(self.removed),
            warning: map(self.warning),
            added_bg: map(self.added_bg),
            removed_bg: map(self.removed_bg),
            gutter: map(self.gutter),
            selection_bg: map(self.selection_bg),
            border_subtle: map(self.border_subtle),
            border: map(self.border),
            border_focused: map(self.border_focused),
            comment: map(self.comment),
            syntax_keyword: map(self.syntax_keyword),
            syntax_string: map(self.syntax_string),
            syntax_type: map(self.syntax_type),
            syntax_constant: map(self.syntax_constant),
            syntax_function: map(self.syntax_function),
            syntax_comment: map(self.syntax_comment),
        }
    }
}

fn ansi256(color: Color) -> Color {
    let Color::Rgb(red, green, blue) = color else {
        return color;
    };
    let component = |value: u8| ((value as u16 * 5 + 127) / 255) as u8;
    Color::Indexed(16 + 36 * component(red) + 6 * component(green) + component(blue))
}

fn parse_theme_catalog() -> Vec<ThemeDefinition> {
    let mut themes = Vec::new();
    let mut seen = HashSet::new();
    // Match selectors, not prose such as the :root comment that mentions
    // `[data-theme="rose-pine"]` before the real selector appears.
    let marker = "\n[data-theme=\"";
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
    let raw_fg = css_color(block, "text-primary")?;
    let light = relative_luminance(bg) > relative_luminance(raw_fg);
    // Web surfaces have physical spacing and shadows between them. In a
    // terminal those same raw colors become hard rectangular bands, so pull
    // them back toward the canvas and let rules carry the hierarchy.
    let raw_panel = css_color(block, "bg-secondary").unwrap_or(bg);
    let raw_elevated = css_color(block, "bg-tertiary").unwrap_or_else(|| blend(raw_panel, bg, 0.5));
    let panel = blend(raw_panel, bg, if light { 0.68 } else { 0.52 });
    let elevated = blend(raw_elevated, bg, if light { 0.72 } else { 0.62 });
    let element = blend(raw_elevated, bg, if light { 0.86 } else { 0.82 });
    let surfaces = [bg, panel, elevated, element];
    let fg = ensure_contrast(raw_fg, &surfaces, 4.5);
    let raw_code_fg = css_color(block, "text-secondary").unwrap_or(fg);
    let code_fg = ensure_contrast(
        blend(fg, raw_code_fg, if light { 0.25 } else { 0.38 }),
        &surfaces,
        4.5,
    );
    let raw_dim = css_color(block, "text-muted").unwrap_or_else(|| blend(fg, bg, 0.55));
    let dim = ensure_contrast(
        blend(raw_dim, bg, if light { 0.86 } else { 0.72 }),
        &surfaces,
        3.0,
    );
    let accent = css_color(block, "border-focus")
        .or_else(|| css_color(block, "primary"))
        .unwrap_or(fg);
    let added = css_color(block, "feedback-success-text")
        .or_else(|| css_color(block, "success"))
        .unwrap_or(Color::Rgb(63, 185, 80));
    let removed = css_color(block, "feedback-danger-text")
        .or_else(|| css_color(block, "danger"))
        .unwrap_or(Color::Rgb(248, 81, 73));
    let warning = css_color(block, "feedback-warning-text")
        .or_else(|| css_color(block, "warning"))
        .unwrap_or(accent);
    let raw_border = css_color(block, "border-color")
        .or_else(|| css_color(block, "border-normal"))
        .unwrap_or(elevated);
    let border_subtle = blend(raw_border, bg, if light { 0.42 } else { 0.38 });
    let border = blend(raw_border, bg, if light { 0.72 } else { 0.66 });
    let comment = css_color(block, "comment-border").unwrap_or(accent);
    let syntax_keyword = css_color(block, "primary-hover")
        .or_else(|| css_color(block, "primary"))
        .unwrap_or(accent);
    let syntax_function = css_color(block, "accent").unwrap_or(accent);
    let syntax_constant = css_color(block, "warning").unwrap_or(warning);
    let added_bg = ensure_surface_contrast(
        blend(added, bg, if light { 0.075 } else { 0.10 }),
        bg,
        &[fg, code_fg],
        4.5,
    );
    let removed_bg = ensure_surface_contrast(
        blend(removed, bg, if light { 0.07 } else { 0.10 }),
        bg,
        &[fg, code_fg],
        4.5,
    );
    let selection_bg = ensure_surface_contrast(
        blend(accent, bg, if light { 0.075 } else { 0.10 }),
        bg,
        &[fg, code_fg],
        4.5,
    );
    Some(ThemeDefinition {
        id: id.to_string(),
        name: display_name(id),
        light,
        palette: Palette {
            bg,
            panel,
            elevated,
            element,
            fg,
            code_fg,
            dim,
            accent,
            added,
            removed,
            warning,
            added_bg,
            removed_bg,
            gutter: dim,
            selection_bg,
            border_subtle,
            border,
            border_focused: accent,
            comment,
            syntax_keyword,
            syntax_string: added,
            syntax_type: warning,
            syntax_constant,
            syntax_function,
            syntax_comment: dim,
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

fn contrast_ratio(foreground: Color, background: Color) -> f32 {
    let foreground = relative_luminance(foreground);
    let background = relative_luminance(background);
    let lighter = foreground.max(background);
    let darker = foreground.min(background);
    (lighter + 0.05) / (darker + 0.05)
}

fn ensure_contrast(foreground: Color, backgrounds: &[Color], minimum: f32) -> Color {
    let passes = |candidate| {
        backgrounds
            .iter()
            .all(|background| contrast_ratio(candidate, *background) >= minimum)
    };
    if passes(foreground) {
        return foreground;
    }
    let black = Color::Rgb(0, 0, 0);
    let white = Color::Rgb(255, 255, 255);
    let minimum_ratio = |candidate| {
        backgrounds
            .iter()
            .map(|background| contrast_ratio(candidate, *background))
            .fold(f32::INFINITY, f32::min)
    };
    let target = if minimum_ratio(black) > minimum_ratio(white) {
        black
    } else {
        white
    };
    (1..=20)
        .map(|step| blend(target, foreground, step as f32 / 20.0))
        .find(|candidate| passes(*candidate))
        .unwrap_or(target)
}

fn ensure_surface_contrast(
    surface: Color,
    canvas: Color,
    foregrounds: &[Color],
    minimum: f32,
) -> Color {
    let passes = |candidate| {
        foregrounds
            .iter()
            .all(|foreground| contrast_ratio(*foreground, candidate) >= minimum)
    };
    if passes(surface) {
        return surface;
    }
    (0..20)
        .rev()
        .map(|step| blend(surface, canvas, step as f32 / 20.0))
        .find(|candidate| passes(*candidate))
        .unwrap_or(canvas)
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
    fn rgb_colors_have_a_256_color_fallback() {
        assert_eq!(ansi256(Color::Rgb(255, 0, 0)), Color::Indexed(196));
        assert_eq!(ansi256(Color::Rgb(0, 255, 0)), Color::Indexed(46));
        assert_eq!(ansi256(Color::Blue), Color::Blue);
    }

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
            assert!(
                contrast_ratio(palette.fg, palette.bg) >= 4.5,
                "low text contrast for {}",
                theme.label()
            );
            assert!(
                contrast_ratio(palette.fg, palette.panel) >= 4.5,
                "low panel text contrast for {}",
                theme.label()
            );
            assert!(
                contrast_ratio(palette.fg, palette.elevated) >= 4.5
                    && contrast_ratio(palette.fg, palette.element) >= 4.5,
                "low raised/element text contrast for {}",
                theme.label()
            );
            assert!(
                contrast_ratio(palette.code_fg, palette.bg) >= 4.5
                    && contrast_ratio(palette.code_fg, palette.panel) >= 4.5,
                "low code contrast for {}",
                theme.label()
            );
            assert!(
                contrast_ratio(palette.dim, palette.bg) >= 3.0
                    && contrast_ratio(palette.dim, palette.panel) >= 3.0,
                "low muted text contrast for {}",
                theme.label()
            );
            assert_ne!(
                rgb(palette.panel),
                rgb(palette.fg),
                "bad panel for {}",
                theme.label()
            );
        }
    }

    #[test]
    fn semantic_backgrounds_remain_tonal_across_the_catalog() {
        for theme in ThemeName::all() {
            let palette = Palette::for_theme(*theme);
            let distance = |left: Color, right: Color| {
                let (lr, lg, lb) = rgb(left);
                let (rr, rg, rb) = rgb(right);
                (lr.abs_diff(rr) as u16) + (lg.abs_diff(rg) as u16) + (lb.abs_diff(rb) as u16)
            };
            assert!(
                distance(palette.added_bg, palette.bg) < distance(palette.added, palette.bg),
                "addition fill is too loud for {}",
                theme.label()
            );
            assert!(
                distance(palette.removed_bg, palette.bg) < distance(palette.removed, palette.bg),
                "deletion fill is too loud for {}",
                theme.label()
            );
            assert!(
                distance(palette.selection_bg, palette.bg) < distance(palette.accent, palette.bg),
                "selection fill is too loud for {}",
                theme.label()
            );
            assert!(
                distance(palette.border_subtle, palette.bg) <= distance(palette.border, palette.bg),
                "subtle rule is stronger than the default rule for {}",
                theme.label()
            );
            assert!(
                contrast_ratio(palette.fg, palette.selection_bg) >= 4.5,
                "selected text is not readable for {}",
                theme.label()
            );
            for surface in [palette.selection_bg, palette.added_bg, palette.removed_bg] {
                assert!(
                    contrast_ratio(palette.code_fg, surface) >= 4.5,
                    "code text is not readable on a semantic surface for {}",
                    theme.label()
                );
            }
        }
    }

    #[test]
    fn label_round_trip() {
        for theme in ThemeName::all() {
            assert_eq!(ThemeName::from_label(theme.label()), Some(*theme));
        }
    }
}
