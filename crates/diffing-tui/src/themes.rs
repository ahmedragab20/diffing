//! Color palettes for the TUI. 8 themes, all built from 256-color and
//! truecolor escapes that crossterm supports out of the box.

use ratatui::style::Color;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThemeName {
    #[default]
    GithubDark,
    Nord,
    Dracula,
    Monokai,
    TokyoNight,
    CatppuccinMocha,
    GruvboxDark,
    SolarizedDark,
}

impl ThemeName {
    pub const ALL: &'static [ThemeName] = &[
        ThemeName::Nord,
        ThemeName::GithubDark,
        ThemeName::Dracula,
        ThemeName::Monokai,
        ThemeName::TokyoNight,
        ThemeName::CatppuccinMocha,
        ThemeName::GruvboxDark,
        ThemeName::SolarizedDark,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ThemeName::Nord => "nord",
            ThemeName::GithubDark => "github-dark",
            ThemeName::Dracula => "dracula",
            ThemeName::Monokai => "monokai",
            ThemeName::TokyoNight => "tokyo-night",
            ThemeName::CatppuccinMocha => "catppuccin-mocha",
            ThemeName::GruvboxDark => "gruvbox-dark",
            ThemeName::SolarizedDark => "solarized-dark",
        }
    }

    #[allow(dead_code)]
    pub fn from_label(label: &str) -> Option<ThemeName> {
        Self::ALL.iter().copied().find(|t| t.label() == label)
    }
}

impl Default for Palette {
    fn default() -> Self {
        Palette::for_theme(ThemeName::default())
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Palette {
    pub bg: Color,
    pub fg: Color,
    pub dim: Color,
    pub accent: Color,
    pub added: Color,
    pub removed: Color,
    pub added_bg: Color,
    pub removed_bg: Color,
    pub gutter: Color,
    #[allow(dead_code)]
    pub gutter_focused: Color,
    pub selection_bg: Color,
    pub border: Color,
    pub border_focused: Color,
    pub comment: Color,
    pub status_bar_bg: Color,
}

impl Palette {
    pub fn for_theme(name: ThemeName) -> Self {
        match name {
            ThemeName::Nord => nord(),
            ThemeName::GithubDark => github_dark(),
            ThemeName::Dracula => dracula(),
            ThemeName::Monokai => monokai(),
            ThemeName::TokyoNight => tokyo_night(),
            ThemeName::CatppuccinMocha => catppuccin_mocha(),
            ThemeName::GruvboxDark => gruvbox_dark(),
            ThemeName::SolarizedDark => solarized_dark(),
        }
    }
}

fn hex(hex: u32) -> Color {
    let r = ((hex >> 16) & 0xff) as u8;
    let g = ((hex >> 8) & 0xff) as u8;
    let b = (hex & 0xff) as u8;
    Color::Rgb(r, g, b)
}

fn nord() -> Palette {
    Palette {
        bg: hex(0x2e3440),
        fg: hex(0xd8dee9),
        dim: hex(0x4c566a),
        accent: hex(0x88c0d0),
        added: hex(0xa3be8c),
        removed: hex(0xbf616a),
        added_bg: hex(0x3b4252),
        removed_bg: hex(0x3b4252),
        gutter: hex(0x4c566a),
        gutter_focused: hex(0x88c0d0),
        selection_bg: hex(0x434c5e),
        border: hex(0x434c5e),
        border_focused: hex(0x88c0d0),
        comment: hex(0x616e88),
        status_bar_bg: hex(0x3b4252),
    }
}

fn github_dark() -> Palette {
    Palette {
        bg: hex(0x0d1117),
        fg: hex(0xc9d1d9),
        dim: hex(0x484f58),
        accent: hex(0x58a6ff),
        added: hex(0x3fb950),
        removed: hex(0xf85149),
        added_bg: hex(0x033a16),
        removed_bg: hex(0x67060c),
        gutter: hex(0x484f58),
        gutter_focused: hex(0x58a6ff),
        selection_bg: hex(0x1f6feb),
        border: hex(0x30363d),
        border_focused: hex(0x58a6ff),
        comment: hex(0x8b949e),
        status_bar_bg: hex(0x161b22),
    }
}

fn dracula() -> Palette {
    Palette {
        bg: hex(0x282a36),
        fg: hex(0xf8f8f2),
        dim: hex(0x44475a),
        accent: hex(0xbd93f9),
        added: hex(0x50fa7b),
        removed: hex(0xff5555),
        added_bg: hex(0x1e3a2a),
        removed_bg: hex(0x4a1f1f),
        gutter: hex(0x6272a4),
        gutter_focused: hex(0xbd93f9),
        selection_bg: hex(0x44475a),
        border: hex(0x44475a),
        border_focused: hex(0xbd93f9),
        comment: hex(0x6272a4),
        status_bar_bg: hex(0x21222c),
    }
}

fn monokai() -> Palette {
    Palette {
        bg: hex(0x272822),
        fg: hex(0xf8f8f2),
        dim: hex(0x75715e),
        accent: hex(0x66d9ef),
        added: hex(0xa6e22e),
        removed: hex(0xf92672),
        added_bg: hex(0x1e3a1e),
        removed_bg: hex(0x4a1f2a),
        gutter: hex(0x75715e),
        gutter_focused: hex(0x66d9ef),
        selection_bg: hex(0x3e3d32),
        border: hex(0x3e3d32),
        border_focused: hex(0x66d9ef),
        comment: hex(0x75715e),
        status_bar_bg: hex(0x1e1f1c),
    }
}

fn tokyo_night() -> Palette {
    Palette {
        bg: hex(0x1a1b26),
        fg: hex(0xc0caf5),
        dim: hex(0x414868),
        accent: hex(0x7aa2f7),
        added: hex(0x9ece6a),
        removed: hex(0xf7768e),
        added_bg: hex(0x1f2a3a),
        removed_bg: hex(0x3a1f2a),
        gutter: hex(0x414868),
        gutter_focused: hex(0x7aa2f7),
        selection_bg: hex(0x28344a),
        border: hex(0x292e42),
        border_focused: hex(0x7aa2f7),
        comment: hex(0x565f89),
        status_bar_bg: hex(0x16161e),
    }
}

fn catppuccin_mocha() -> Palette {
    Palette {
        bg: hex(0x1e1e2e),
        fg: hex(0xcdd6f4),
        dim: hex(0x45475a),
        accent: hex(0x89b4fa),
        added: hex(0xa6e3a1),
        removed: hex(0xf38ba8),
        added_bg: hex(0x22303b),
        removed_bg: hex(0x3a2a32),
        gutter: hex(0x585b70),
        gutter_focused: hex(0x89b4fa),
        selection_bg: hex(0x313244),
        border: hex(0x313244),
        border_focused: hex(0x89b4fa),
        comment: hex(0x6c7086),
        status_bar_bg: hex(0x181825),
    }
}

fn gruvbox_dark() -> Palette {
    Palette {
        bg: hex(0x282828),
        fg: hex(0xebdbb2),
        dim: hex(0x504945),
        accent: hex(0x83a598),
        added: hex(0xb8bb26),
        removed: hex(0xfb4934),
        added_bg: hex(0x32302f),
        removed_bg: hex(0x3a2a2a),
        gutter: hex(0x7c6f64),
        gutter_focused: hex(0x83a598),
        selection_bg: hex(0x3c3836),
        border: hex(0x3c3836),
        border_focused: hex(0x83a598),
        comment: hex(0xa89984),
        status_bar_bg: hex(0x1d2021),
    }
}

fn solarized_dark() -> Palette {
    Palette {
        bg: hex(0x002b36),
        fg: hex(0x93a1a1),
        dim: hex(0x073642),
        accent: hex(0x268bd2),
        added: hex(0x859900),
        removed: hex(0xdc322f),
        added_bg: hex(0x073642),
        removed_bg: hex(0x073642),
        gutter: hex(0x586e75),
        gutter_focused: hex(0x268bd2),
        selection_bg: hex(0x073642),
        border: hex(0x073642),
        border_focused: hex(0x268bd2),
        comment: hex(0x586e75),
        status_bar_bg: hex(0x001f27),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_themes_have_distinct_palettes() {
        let palettes: Vec<Palette> = ThemeName::ALL
            .iter()
            .map(|t| Palette::for_theme(*t))
            .collect();
        for (i, a) in palettes.iter().enumerate() {
            for b in &palettes[i + 1..] {
                assert_ne!(
                    format!("{:?}", a),
                    format!("{:?}", b),
                    "palettes must differ"
                );
            }
        }
    }

    #[test]
    fn label_round_trip() {
        for t in ThemeName::ALL {
            assert_eq!(ThemeName::from_label(t.label()), Some(*t));
        }
    }
}
