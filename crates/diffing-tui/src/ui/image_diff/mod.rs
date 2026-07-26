//! Bounded, terminal-native image comparison.
//!
//! The TUI cannot assume a Kitty/iTerm/Sixel-capable terminal. Raster images
//! are decoded on a worker and painted with Unicode half-blocks. See submodules
//! for decode bounds, difference metrics, and Gridline presentation.

mod compare;
mod decode;
mod render;

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread;

use anyhow::Result;
use diffing_core::index::{IndexedChangeKind, IndexedFile};

pub use compare::{default_compare_mode, ImageCompareMode};
pub use render::{render_image_diff, ImagePresentation, ImageViewState};

const CACHE_ENTRIES: usize = 6;
const CACHE_MAX_BYTES: usize = 96 * 1024 * 1024;

pub fn is_image_path(path: &Path) -> bool {
    decode::is_image_path(path)
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ImageKey {
    generation: u64,
    old_path: Option<PathBuf>,
    new_path: Option<PathBuf>,
    old_oid: Option<String>,
    new_oid: Option<String>,
    kind: IndexedChangeKind,
}

impl ImageKey {
    pub fn new(generation: u64, file: &IndexedFile) -> Self {
        Self {
            generation,
            old_path: file.old_path.clone(),
            new_path: file.new_path.clone(),
            old_oid: file.old_oid.clone(),
            new_oid: file.new_oid.clone(),
            kind: file.kind,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RasterImage {
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub encoded_bytes: usize,
    pub(crate) pixels: Arc<[u8]>,
    pub(crate) heat_map: bool,
}

impl RasterImage {
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let x = x.min(self.width.saturating_sub(1));
        let y = y.min(self.height.saturating_sub(1));
        let offset =
            (u64::from(y) * u64::from(self.width) + u64::from(x)).saturating_mul(4) as usize;
        self.pixels
            .get(offset..offset.saturating_add(4))
            .map(|value| [value[0], value[1], value[2], value[3]])
            .unwrap_or([0, 0, 0, 0])
    }

    pub fn summary(&self) -> String {
        let size = if self.encoded_bytes == 0 {
            "derived".to_string()
        } else {
            decode::human_bytes(self.encoded_bytes)
        };
        format!("{}×{} · {size}", self.original_width, self.original_height)
    }
}

#[derive(Debug, Clone)]
pub enum ImageSide {
    Missing,
    Ready(Arc<RasterImage>),
    Error(String),
}

impl ImageSide {
    pub fn ready(&self) -> Option<&Arc<RasterImage>> {
        match self {
            Self::Ready(image) => Some(image),
            Self::Missing | Self::Error(_) => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ImageDiffData {
    pub before: ImageSide,
    pub after: ImageSide,
    pub difference: Option<Arc<RasterImage>>,
    pub changed_percent: Option<f32>,
    pub mean_delta: Option<f32>,
}

impl ImageDiffData {
    pub fn has_two_images(&self) -> bool {
        self.before.ready().is_some() && self.after.ready().is_some()
    }

    fn memory_bytes(&self) -> usize {
        let side_bytes = |side: &ImageSide| {
            side.ready()
                .map(|image| image.pixels.len())
                .unwrap_or_default()
        };
        side_bytes(&self.before)
            .saturating_add(side_bytes(&self.after))
            .saturating_add(
                self.difference
                    .as_ref()
                    .map(|image| image.pixels.len())
                    .unwrap_or_default(),
            )
    }
}

struct ImageRequest {
    key: ImageKey,
}

struct ImageEvent {
    key: ImageKey,
    data: ImageDiffData,
}

pub struct ImageDiffManager {
    request_tx: SyncSender<ImageRequest>,
    result_rx: Receiver<ImageEvent>,
    pending: HashSet<ImageKey>,
    cache: VecDeque<(ImageKey, Arc<ImageDiffData>)>,
}

impl ImageDiffManager {
    pub fn new(repo_root: PathBuf) -> Result<Self> {
        let (request_tx, request_rx) = mpsc::sync_channel::<ImageRequest>(4);
        let (result_tx, result_rx) = mpsc::channel::<ImageEvent>();
        thread::Builder::new()
            .name("diffing-image-preview".to_string())
            .spawn(move || image_worker(repo_root, request_rx, result_tx))?;
        Ok(Self {
            request_tx,
            result_rx,
            pending: HashSet::new(),
            cache: VecDeque::new(),
        })
    }

    pub fn request(&mut self, key: ImageKey) {
        if self.pending.contains(&key) || self.cache.iter().any(|(cached, _)| cached == &key) {
            return;
        }
        match self.request_tx.try_send(ImageRequest { key: key.clone() }) {
            Ok(()) => {
                self.pending.insert(key);
            }
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {}
        }
    }

    pub fn poll(&mut self) -> bool {
        let mut changed = false;
        while let Ok(event) = self.result_rx.try_recv() {
            self.pending.remove(&event.key);
            if let Some(position) = self
                .cache
                .iter()
                .position(|(cached, _)| cached == &event.key)
            {
                self.cache.remove(position);
            }
            self.cache.push_back((event.key, Arc::new(event.data)));
            while self.cache.len() > CACHE_ENTRIES
                || (self.cache.len() > 1
                    && self.cache.iter().fold(0usize, |total, (_, data)| {
                        total.saturating_add(data.memory_bytes())
                    }) > CACHE_MAX_BYTES)
            {
                self.cache.pop_front();
            }
            changed = true;
        }
        changed
    }

    pub fn get(&mut self, key: &ImageKey) -> Option<Arc<ImageDiffData>> {
        let position = self.cache.iter().position(|(cached, _)| cached == key)?;
        let entry = self.cache.remove(position)?;
        let data = entry.1.clone();
        self.cache.push_back(entry);
        Some(data)
    }
}

fn image_worker(
    repo_root: PathBuf,
    request_rx: Receiver<ImageRequest>,
    result_tx: mpsc::Sender<ImageEvent>,
) {
    while let Ok(request) = request_rx.recv() {
        let data = decode::load_image_diff(&repo_root, &request.key);
        if result_tx
            .send(ImageEvent {
                key: request.key,
                data,
            })
            .is_err()
        {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    use crate::ui::image_diff::decode::{decode_raster, tests::rgba_png};

    #[test]
    fn default_mode_prefers_side_by_side_when_both_sides_exist() {
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
        assert_eq!(default_compare_mode(&data), ImageCompareMode::SideBySide);
    }

    #[test]
    fn fullscreen_preserves_view_state_fields() {
        let mut state = ImageViewState::default();
        state.mode = ImageCompareMode::After;
        state.zoom_in();
        state.pan(4, 2);
        let preserved = state.clone();
        assert_eq!(preserved.mode, ImageCompareMode::After);
        assert_ne!(preserved.zoom_label(), "Fit");
    }
}
