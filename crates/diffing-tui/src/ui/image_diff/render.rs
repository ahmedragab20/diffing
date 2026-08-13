use std::path::Path;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::Line;
use ratatui::widgets::{Paragraph, Widget};
use unicode_width::UnicodeWidthStr;

use crate::themes::{Palette, ThemeName};
use crate::ui::gridline::{
    content_footer, difference_heat_rgb, fill, vertical_rule, GridlineTokens,
};

use super::compare::ImageCompareMode;
use super::{ImageDiffData, ImageSide, RasterImage};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImagePresentation {
    Inline,
    Fullscreen,
}

#[derive(Debug, Clone)]
pub struct ImageViewState {
    pub mode: ImageCompareMode,
    zoom_step: usize,
    pan_x: i32,
    pan_y: i32,
}

impl Default for ImageViewState {
    fn default() -> Self {
        Self {
            mode: ImageCompareMode::SideBySide,
            zoom_step: 0,
            pan_x: 0,
            pan_y: 0,
        }
    }
}

impl ImageViewState {
    pub const ZOOM: [f32; 7] = [1.0, 1.25, 1.5, 2.0, 3.0, 4.0, 6.0];

    pub fn zoom_in(&mut self) {
        self.zoom_step = (self.zoom_step + 1).min(Self::ZOOM.len() - 1);
    }

    pub fn zoom_out(&mut self) {
        self.zoom_step = self.zoom_step.saturating_sub(1);
        if self.zoom_step == 0 {
            self.pan_x = 0;
            self.pan_y = 0;
        }
    }

    pub fn reset(&mut self) {
        self.zoom_step = 0;
        self.pan_x = 0;
        self.pan_y = 0;
    }

    pub fn pan(&mut self, x: i32, y: i32) {
        if self.zoom_step > 0 {
            self.pan_x = self.pan_x.saturating_add(x);
            self.pan_y = self.pan_y.saturating_add(y);
        }
    }

    pub fn zoom_label(&self) -> String {
        if self.zoom_step == 0 {
            "Fit".to_string()
        } else {
            format!("{:.0}%", Self::ZOOM[self.zoom_step] * 100.0)
        }
    }

    /// True when zoomed past fit — pan keys and pan gestures apply.
    pub fn is_zoomed(&self) -> bool {
        self.zoom_step > 0
    }
}

pub fn render_image_diff(
    data: &ImageDiffData,
    path: &Path,
    state: &ImageViewState,
    area: Rect,
    theme: ThemeName,
    palette: &Palette,
    presentation: ImagePresentation,
    buf: &mut Buffer,
) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let tokens = GridlineTokens::from(palette);
    fill(area, tokens.canvas, buf);
    let footer_height = u16::from(area.height >= 4);
    let body = Rect::new(
        area.x,
        area.y,
        area.width,
        area.height.saturating_sub(footer_height),
    );
    let effective_mode = effective_mode(data, state.mode, body);
    match effective_mode {
        ImageCompareMode::SideBySide if data.has_two_images() && body.width >= 28 => {
            let left_width = body.width.saturating_sub(1) / 2;
            let left = Rect::new(body.x, body.y, left_width, body.height);
            let divider_x = body.x + left_width;
            let right = Rect::new(
                divider_x + 1,
                body.y,
                body.width.saturating_sub(left_width + 1),
                body.height,
            );
            render_side("Before", &data.before, left, state, theme, palette, buf);
            vertical_rule(
                Rect::new(divider_x, body.y, 1, body.height),
                palette,
                tokens.canvas,
                buf,
            );
            render_side("After", &data.after, right, state, theme, palette, buf);
        }
        ImageCompareMode::Before => {
            render_side("Before", &data.before, body, state, theme, palette, buf)
        }
        ImageCompareMode::After => {
            render_side("After", &data.after, body, state, theme, palette, buf)
        }
        ImageCompareMode::Difference => {
            let side = data
                .difference
                .as_ref()
                .map(|image| ImageSide::Ready(image.clone()))
                .unwrap_or_else(|| ImageSide::Error("difference needs both versions".to_string()));
            render_side("Difference", &side, body, state, theme, palette, buf);
        }
        ImageCompareMode::SideBySide => {
            let side = if data.after.ready().is_some() {
                &data.after
            } else {
                &data.before
            };
            render_side("Image", side, body, state, theme, palette, buf);
        }
    }
    if footer_height > 0 {
        let metrics = data
            .changed_percent
            .zip(data.mean_delta)
            .map(|(changed, mean)| format!(" · {changed:.1}% changed · mean Δ {mean:.1}"))
            .unwrap_or_default();
        let footer = format!(
            "{} · {} · {}{}",
            path.to_string_lossy(),
            effective_mode.label(),
            state.zoom_label(),
            metrics
        );
        content_footer(
            &footer,
            Rect::new(area.x, area.y + body.height, area.width, 1),
            palette,
            buf,
        );
    }
    let _ = presentation;
}

pub fn effective_mode(
    data: &ImageDiffData,
    mode: ImageCompareMode,
    body: Rect,
) -> ImageCompareMode {
    if mode == ImageCompareMode::SideBySide && (!data.has_two_images() || body.width < 28) {
        if data.after.ready().is_some() {
            ImageCompareMode::After
        } else {
            ImageCompareMode::Before
        }
    } else {
        mode
    }
}

fn render_side(
    title: &str,
    side: &ImageSide,
    area: Rect,
    state: &ImageViewState,
    theme: ThemeName,
    palette: &Palette,
    buf: &mut Buffer,
) {
    if area.width < 2 || area.height < 2 {
        return;
    }
    let tokens = GridlineTokens::from(palette);
    let label = match side {
        ImageSide::Ready(image) => format!("{title} · {}", image.summary()),
        ImageSide::Missing | ImageSide::Error(_) => title.to_string(),
    };
    let label_width = UnicodeWidthStr::width(label.as_str()) as u16;
    if label_width + 2 <= area.width {
        buf.set_string(
            area.x,
            area.y,
            label,
            Style::default()
                .fg(tokens.text_subtle)
                .bg(tokens.canvas)
                .add_modifier(ratatui::style::Modifier::BOLD),
        );
    }
    let raster = Rect::new(
        area.x,
        area.y.saturating_add(1),
        area.width,
        area.height.saturating_sub(1),
    );
    match side {
        ImageSide::Ready(image) => render_raster(image, raster, state, theme, palette, buf),
        ImageSide::Missing => centered_message(
            "Version does not exist",
            raster,
            tokens.muted,
            tokens.canvas,
            buf,
        ),
        ImageSide::Error(error) => {
            centered_message(error, raster, tokens.warning, tokens.canvas, buf)
        }
    }
}

fn centered_message(message: &str, area: Rect, color: Color, background: Color, buf: &mut Buffer) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    Paragraph::new(Line::from(message))
        .style(Style::default().fg(color).bg(background))
        .centered()
        .render(area, buf);
}

fn render_raster(
    image: &RasterImage,
    area: Rect,
    state: &ImageViewState,
    _theme: ThemeName,
    palette: &Palette,
    buf: &mut Buffer,
) {
    if area.width == 0 || area.height == 0 || image.width == 0 || image.height == 0 {
        return;
    }
    let tokens = GridlineTokens::from(palette);
    let monochrome = std::env::var_os("NO_COLOR").is_some()
        || std::env::var("TERM").is_ok_and(|term| term == "dumb");
    let truecolor = std::env::var("COLORTERM").is_ok_and(|value| {
        let value = value.to_ascii_lowercase();
        value.contains("truecolor") || value.contains("24bit")
    }) || std::env::var("TERM").is_ok_and(|value| {
        let value = value.to_ascii_lowercase();
        value.contains("direct") || value.contains("truecolor")
    });
    let background = rgb_of(tokens.canvas);
    let pixel_height = u32::from(area.height).saturating_mul(2);
    let base_scale =
        (area.width as f64 / image.width as f64).min(pixel_height as f64 / image.height as f64);
    let zoom = ImageViewState::ZOOM[state.zoom_step] as f64;
    let draw_width = (image.width as f64 * base_scale * zoom).round().max(1.0) as i32;
    let draw_height = (image.height as f64 * base_scale * zoom).round().max(1.0) as i32;
    let pixel_height = pixel_height as i32;
    let horizontal_overflow = (draw_width - i32::from(area.width)).max(0);
    let vertical_overflow = (draw_height - pixel_height).max(0);
    let max_pan_x = (horizontal_overflow + 1) / 2;
    let max_pan_y = (vertical_overflow + 1) / 2;
    let pan_x = state.pan_x.clamp(-max_pan_x, max_pan_x);
    let pan_y = state.pan_y.saturating_mul(2).clamp(-max_pan_y, max_pan_y);
    let origin_x = (i32::from(area.width) - draw_width) / 2 + pan_x;
    let origin_y = (pixel_height - draw_height) / 2 + pan_y;
    let color = |pixel: [u8; 4]| {
        let [r, g, b] = if image.heat_map {
            difference_heat_rgb(tokens, pixel[0])
        } else {
            composite(pixel, background)
        };
        if truecolor {
            Color::Rgb(r, g, b)
        } else {
            ansi256(r, g, b)
        }
    };
    for cell_y in 0..area.height {
        for cell_x in 0..area.width {
            let sample = |pixel_y: i32| {
                let x = i32::from(cell_x) - origin_x;
                let y = pixel_y - origin_y;
                if x < 0 || y < 0 || x >= draw_width || y >= draw_height {
                    return [background.0, background.1, background.2, 255];
                }
                let source_x = (x as u64 * u64::from(image.width) / draw_width as u64) as u32;
                let source_y = (y as u64 * u64::from(image.height) / draw_height as u64) as u32;
                image.pixel(source_x, source_y)
            };
            let top = sample(i32::from(cell_y) * 2);
            let bottom = sample(i32::from(cell_y) * 2 + 1);
            let target = &mut buf[(area.x + cell_x, area.y + cell_y)];
            if monochrome {
                let [tr, tg, tb] = if image.heat_map {
                    difference_heat_rgb(tokens, top[0])
                } else {
                    composite(top, background)
                };
                let [br, bg, bb] = if image.heat_map {
                    difference_heat_rgb(tokens, bottom[0])
                } else {
                    composite(bottom, background)
                };
                let luminance = (u32::from(tr) * 54
                    + u32::from(tg) * 183
                    + u32::from(tb) * 19
                    + u32::from(br) * 54
                    + u32::from(bg) * 183
                    + u32::from(bb) * 19)
                    / 512;
                let ramp = b" .:-=+*#%@";
                let index = (luminance as usize * (ramp.len() - 1) / 255).min(ramp.len() - 1);
                target
                    .set_char(ramp[index] as char)
                    .set_style(Style::default().fg(tokens.text).bg(tokens.canvas));
            } else {
                target
                    .set_symbol("▀")
                    .set_style(Style::default().fg(color(top)).bg(color(bottom)));
            }
        }
    }
}

fn rgb_of(color: Color) -> (u8, u8, u8) {
    match color {
        Color::Rgb(red, green, blue) => (red, green, blue),
        _ => (0, 0, 0),
    }
}

fn composite(pixel: [u8; 4], background: (u8, u8, u8)) -> [u8; 3] {
    let alpha = u16::from(pixel[3]);
    let blend = |foreground: u8, back: u8| {
        ((u16::from(foreground) * alpha + u16::from(back) * (255 - alpha) + 127) / 255) as u8
    };
    [
        blend(pixel[0], background.0),
        blend(pixel[1], background.1),
        blend(pixel[2], background.2),
    ]
}

fn ansi256(red: u8, green: u8, blue: u8) -> Color {
    let component = |value: u8| ((value as u16 * 5 + 127) / 255) as u8;
    Color::Indexed(16 + 36 * component(red) + 6 * component(green) + component(blue))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::Arc;

    use crate::ui::image_diff::decode::{decode_raster, tests::rgba_png};
    use crate::ui::image_diff::{ImageDiffData, ImageSide};

    #[test]
    fn raster_render_uses_half_blocks_and_bounded_pan_zoom() {
        let image = decode_raster(
            &rgba_png(1, 2, &[[255, 0, 0, 255], [0, 0, 255, 255]]),
            Path::new("sample.png"),
        )
        .unwrap();
        let mut state = ImageViewState::default();
        state.zoom_in();
        state.pan(2, -1);
        let area = Rect::new(0, 0, 12, 4);
        let mut buffer = Buffer::empty(area);
        render_raster(
            &image,
            area,
            &state,
            ThemeName::default(),
            &Palette::default(),
            &mut buffer,
        );
        assert!((0..area.height).any(|y| (0..area.width).any(|x| buffer[(x, y)].symbol() != " ")));
    }

    #[test]
    fn narrow_width_collapses_side_by_side_to_single_side() {
        let before =
            decode_raster(&rgba_png(1, 1, &[[0, 0, 0, 255]]), Path::new("before.png")).unwrap();
        let after =
            decode_raster(&rgba_png(1, 1, &[[1, 1, 1, 255]]), Path::new("after.png")).unwrap();
        let data = ImageDiffData {
            before: ImageSide::Ready(Arc::new(before)),
            after: ImageSide::Ready(Arc::new(after)),
            difference: None,
            changed_percent: None,
            mean_delta: None,
        };
        let body = Rect::new(0, 0, 20, 8);
        assert_eq!(
            effective_mode(&data, ImageCompareMode::SideBySide, body),
            ImageCompareMode::After
        );
        let wide = Rect::new(0, 0, 40, 8);
        assert_eq!(
            effective_mode(&data, ImageCompareMode::SideBySide, wide),
            ImageCompareMode::SideBySide
        );
    }
}
