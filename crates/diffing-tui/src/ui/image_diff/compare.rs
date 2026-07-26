use std::sync::Arc;

use super::{ImageDiffData, ImageSide, RasterImage};

const MAX_PREVIEW_DIMENSION: u32 = 2_048;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageCompareMode {
    SideBySide,
    Before,
    After,
    Difference,
}

impl ImageCompareMode {
    const ALL: [Self; 4] = [
        Self::SideBySide,
        Self::Before,
        Self::After,
        Self::Difference,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::SideBySide => "Side by side",
            Self::Before => "Before",
            Self::After => "After",
            Self::Difference => "Difference",
        }
    }

    pub fn cycle(self, delta: isize, data: &ImageDiffData) -> Self {
        let modes: Vec<Self> = Self::ALL
            .into_iter()
            .filter(|mode| mode.is_available(data))
            .collect();
        if modes.is_empty() {
            return self;
        }
        let current = modes.iter().position(|mode| *mode == self).unwrap_or(0);
        modes[(current as isize + delta).rem_euclid(modes.len() as isize) as usize]
    }

    pub fn normalize(self, data: &ImageDiffData) -> Self {
        if self.is_available(data) {
            self
        } else {
            default_compare_mode(data)
        }
    }

    pub fn is_available(self, data: &ImageDiffData) -> bool {
        match self {
            Self::SideBySide | Self::Difference => data.has_two_images(),
            Self::Before => data.before.ready().is_some(),
            Self::After => data.after.ready().is_some(),
        }
    }
}

pub fn default_compare_mode(data: &ImageDiffData) -> ImageCompareMode {
    if data.has_two_images() {
        ImageCompareMode::SideBySide
    } else if data.after.ready().is_some() {
        ImageCompareMode::After
    } else if data.before.ready().is_some() {
        ImageCompareMode::Before
    } else {
        ImageCompareMode::SideBySide
    }
}

pub fn build_difference(before: &RasterImage, after: &RasterImage) -> (RasterImage, f32, f32) {
    let original_width = before.original_width.max(after.original_width);
    let original_height = before.original_height.max(after.original_height);
    let scale = (MAX_PREVIEW_DIMENSION as f64 / original_width as f64)
        .min(MAX_PREVIEW_DIMENSION as f64 / original_height as f64)
        .min(1.0);
    let width = (original_width as f64 * scale).round().max(1.0) as u32;
    let height = (original_height as f64 * scale).round().max(1.0) as u32;
    let mut pixels = vec![0; width as usize * height as usize * 4];
    let mut changed = 0u64;
    let mut total_delta = 0u64;
    for y in 0..height {
        for x in 0..width {
            let original_x = u64::from(x) * u64::from(original_width) / u64::from(width);
            let original_y = u64::from(y) * u64::from(original_height) / u64::from(height);
            let sample = |image: &RasterImage| {
                if original_x >= u64::from(image.original_width)
                    || original_y >= u64::from(image.original_height)
                {
                    return None;
                }
                let sx = original_x * u64::from(image.width) / u64::from(image.original_width);
                let sy = original_y * u64::from(image.height) / u64::from(image.original_height);
                Some(image.pixel(sx as u32, sy as u32))
            };
            let visual = |pixel: [u8; 4]| {
                let alpha = u16::from(pixel[3]);
                [
                    (u16::from(pixel[0]) * alpha / 255) as u8,
                    (u16::from(pixel[1]) * alpha / 255) as u8,
                    (u16::from(pixel[2]) * alpha / 255) as u8,
                    pixel[3],
                ]
            };
            let delta = match (sample(before), sample(after)) {
                (Some(left), Some(right)) => visual(left)
                    .iter()
                    .zip(visual(right).iter())
                    .map(|(left, right)| left.abs_diff(*right) as u16)
                    .max()
                    .unwrap_or(0) as u8,
                (None, None) => 0,
                (Some(_), None) | (None, Some(_)) => 255,
            };
            changed += u64::from(delta > 8);
            total_delta += u64::from(delta);
            let offset = (u64::from(y) * u64::from(width) + u64::from(x)) as usize * 4;
            pixels[offset..offset + 4].copy_from_slice(&[delta, 0, 0, 255]);
        }
    }
    let count = u64::from(width) * u64::from(height);
    let changed_percent = if count == 0 {
        0.0
    } else {
        changed as f32 * 100.0 / count as f32
    };
    let mean_delta = if count == 0 {
        0.0
    } else {
        total_delta as f32 / count as f32
    };
    (
        RasterImage {
            width,
            height,
            original_width,
            original_height,
            encoded_bytes: 0,
            pixels: pixels.into(),
            heat_map: true,
        },
        changed_percent,
        mean_delta,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    use crate::ui::image_diff::decode::{decode_raster, tests::rgba_png};

    #[test]
    fn image_difference_reports_changed_pixels() {
        let before =
            decode_raster(&rgba_png(2, 1, &[[0, 0, 0, 255], [0, 0, 0, 255]]), Path::new("before.png"))
                .unwrap();
        let after = decode_raster(
            &rgba_png(2, 1, &[[255, 255, 255, 255], [0, 0, 0, 255]]),
            Path::new("after.png"),
        )
        .unwrap();
        let (_, changed, mean) = build_difference(&before, &after);
        assert_eq!(changed, 50.0);
        assert_eq!(mean, 127.5);
    }

    #[test]
    fn image_difference_ignores_hidden_rgb_in_fully_transparent_pixels() {
        let before =
            decode_raster(&rgba_png(1, 1, &[[255, 0, 0, 0]]), Path::new("before.png")).unwrap();
        let after =
            decode_raster(&rgba_png(1, 1, &[[0, 255, 255, 0]]), Path::new("after.png")).unwrap();
        let (_, changed, mean) = build_difference(&before, &after);
        assert_eq!(changed, 0.0);
        assert_eq!(mean, 0.0);
    }

    #[test]
    fn image_difference_treats_canvas_size_as_a_visual_change() {
        let before =
            decode_raster(&rgba_png(1, 1, &[[0, 0, 0, 0]]), Path::new("before.png")).unwrap();
        let after = decode_raster(
            &rgba_png(2, 1, &[[0, 0, 0, 0], [0, 0, 0, 0]]),
            Path::new("after.png"),
        )
        .unwrap();
        let (difference, changed, mean) = build_difference(&before, &after);
        assert_eq!((difference.width, difference.height), (2, 1));
        assert!(difference.heat_map);
        assert_eq!(changed, 50.0);
        assert_eq!(mean, 127.5);
    }

    #[test]
    fn unavailable_comparison_modes_fall_back_to_the_existing_side() {
        let after =
            decode_raster(&rgba_png(1, 1, &[[1, 2, 3, 255]]), Path::new("after.png")).unwrap();
        let data = ImageDiffData {
            before: ImageSide::Missing,
            after: ImageSide::Ready(Arc::new(after)),
            difference: None,
            changed_percent: None,
            mean_delta: None,
        };
        assert_eq!(
            ImageCompareMode::SideBySide.normalize(&data),
            ImageCompareMode::After
        );
        assert_eq!(
            ImageCompareMode::Difference.normalize(&data),
            ImageCompareMode::After
        );
    }

    #[test]
    fn mode_cycle_skips_unavailable_views() {
        let after =
            decode_raster(&rgba_png(1, 1, &[[1, 2, 3, 255]]), Path::new("after.png")).unwrap();
        let data = ImageDiffData {
            before: ImageSide::Missing,
            after: ImageSide::Ready(Arc::new(after)),
            difference: None,
            changed_percent: None,
            mean_delta: None,
        };
        assert_eq!(
            ImageCompareMode::After.cycle(1, &data),
            ImageCompareMode::After
        );
        assert!(!ImageCompareMode::Difference.is_available(&data));
    }
}
