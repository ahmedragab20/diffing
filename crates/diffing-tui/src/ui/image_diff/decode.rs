//! Image loaders, bounds, and raster decoders.

use std::ffi::OsStr;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use diffing_core::index::IndexedChangeKind;
use flate2::read::ZlibDecoder;

use super::{ImageDiffData, ImageKey, ImageSide, RasterImage};

const MAX_ENCODED_BYTES: usize = 32 * 1024 * 1024;
const MAX_DECODED_BYTES: usize = 128 * 1024 * 1024;
const MAX_DIMENSION: u32 = 16_384;
const MAX_PREVIEW_DIMENSION: u32 = 2_048;
const SUBPROCESS_TIMEOUT: Duration = Duration::from_secs(8);

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif",
];

pub fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            IMAGE_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}
pub(crate) fn load_image_diff(repo_root: &Path, key: &ImageKey) -> ImageDiffData {
    let expects_before = !matches!(
        key.kind,
        IndexedChangeKind::Added | IndexedChangeKind::Untracked
    );
    let expects_after = key.kind != IndexedChangeKind::Deleted;
    let before = load_side(
        repo_root,
        key.old_path.as_deref().or(key.new_path.as_deref()),
        key.old_oid.as_deref(),
        Version::Before,
        expects_before,
    );
    let after = load_side(
        repo_root,
        key.new_path.as_deref().or(key.old_path.as_deref()),
        key.new_oid.as_deref(),
        Version::After,
        expects_after,
    );
    let (difference, changed_percent, mean_delta) = before
        .ready()
        .zip(after.ready())
        .map(|(before, after)| super::compare::build_difference(before, after))
        .map(|(image, changed, mean)| (Some(Arc::new(image)), Some(changed), Some(mean)))
        .unwrap_or((None, None, None));
    ImageDiffData {
        before,
        after,
        difference,
        changed_percent,
        mean_delta,
    }
}

#[derive(Debug, Clone, Copy)]
enum Version {
    Before,
    After,
}

fn load_side(
    repo_root: &Path,
    path: Option<&Path>,
    oid: Option<&str>,
    version: Version,
    expected: bool,
) -> ImageSide {
    if !expected {
        return ImageSide::Missing;
    }
    let Some(path) = path else {
        return ImageSide::Missing;
    };
    let bytes = oid
        .and_then(|oid| read_git_blob(repo_root, oid).ok())
        .or_else(|| match version {
            Version::After => read_worktree_file(repo_root, path).ok(),
            Version::Before => None,
        })
        .or_else(|| read_git_path(repo_root, path, version).ok());
    let Some(bytes) = bytes else {
        return ImageSide::Error(format!(
            "{} version is unavailable",
            match version {
                Version::Before => "before",
                Version::After => "after",
            }
        ));
    };
    match decode_raster(&bytes, path) {
        Ok(image) => ImageSide::Ready(Arc::new(image)),
        Err(error) => ImageSide::Error(error.to_string()),
    }
}

fn valid_oid(oid: &str) -> bool {
    (4..=64).contains(&oid.len()) && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn read_git_blob(repo_root: &Path, oid: &str) -> Result<Vec<u8>> {
    if !valid_oid(oid) {
        bail!("invalid Git object id");
    }
    read_bounded_git_output(repo_root, &["cat-file", "blob", oid]).context("reading image blob")
}

fn read_worktree_file(repo_root: &Path, path: &Path) -> Result<Vec<u8>> {
    let mut file = crate::path_safety::open_file_within_repo(repo_root, path)?;
    let metadata = file.metadata().context("reading image metadata")?;
    if !metadata.is_file() || metadata.len() > MAX_ENCODED_BYTES as u64 {
        bail!(
            "image exceeds the {} preview limit",
            human_bytes(MAX_ENCODED_BYTES)
        );
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(MAX_ENCODED_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .context("reading image")?;
    if bytes.len() > MAX_ENCODED_BYTES {
        bail!(
            "image exceeds the {} preview limit",
            human_bytes(MAX_ENCODED_BYTES)
        );
    }
    Ok(bytes)
}

fn read_git_path(repo_root: &Path, path: &Path, version: Version) -> Result<Vec<u8>> {
    if !crate::path_safety::safe_relative_path(path) {
        bail!("image path is outside the repository");
    }
    let path = path.to_string_lossy();
    let object = match version {
        Version::Before => format!("HEAD:{path}"),
        Version::After => format!(":{path}"),
    };
    read_bounded_git_output(repo_root, &["show", object.as_str()]).context("reading image version")
}

fn read_bounded_git_output(repo_root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let deadline = Instant::now() + SUBPROCESS_TIMEOUT;
    let mut child = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Git image output was not captured"))?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut output = Vec::new();
        let result = stdout
            .take(MAX_ENCODED_BYTES as u64 + 1)
            .read_to_end(&mut output)
            .map(|_| output);
        let _ = tx.send(result);
    });
    let output = match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(result) => result?,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            bail!("Git image read timed out");
        }
    };
    if output.len() > MAX_ENCODED_BYTES {
        let _ = child.kill();
        let _ = child.wait();
        bail!(
            "image exceeds the {} preview limit",
            human_bytes(MAX_ENCODED_BYTES)
        );
    }
    let status = loop {
        match child.try_wait()? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                bail!("Git image read timed out");
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };
    if !status.success() {
        bail!("Git image object is unavailable");
    }
    Ok(output)
}

pub(crate) fn human_bytes(bytes: usize) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    if bytes as f64 >= MIB {
        format!("{:.1} MiB", bytes as f64 / MIB)
    } else if bytes as f64 >= KIB {
        format!("{:.1} KiB", bytes as f64 / KIB)
    } else {
        format!("{bytes} B")
    }
}

pub fn decode_raster(bytes: &[u8], path: &Path) -> Result<RasterImage> {
    if bytes.len() > MAX_ENCODED_BYTES {
        bail!(
            "image exceeds the {} preview limit",
            human_bytes(MAX_ENCODED_BYTES)
        );
    }
    let (width, height, pixels) = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        decode_png(bytes)?
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        decode_gif(bytes)?
    } else if bytes.starts_with(b"BM") {
        decode_bmp(bytes)?
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        decode_ico(bytes)?
    } else {
        decode_with_system_tool(bytes, path)?
    };
    validate_dimensions(width, height)?;
    let encoded_bytes = bytes.len();
    let (preview_width, preview_height, pixels) = downsample_preview(width, height, pixels);
    Ok(RasterImage {
        width: preview_width,
        height: preview_height,
        original_width: width,
        original_height: height,
        encoded_bytes,
        pixels: pixels.into(),
        heat_map: false,
    })
}

/// Decode formats that are expensive to implement safely in-tree (JPEG,
/// WebP, AVIF, and SVG) through a commonly available image tool. No shell is
/// involved, input/output are bounded, and a stalled decoder is terminated.
/// This also gives users a graceful capability upgrade without making the TUI
/// depend on a particular terminal graphics protocol.
fn decode_with_system_tool(bytes: &[u8], path: &Path) -> Result<(u32, u32, Vec<u8>)> {
    let format = ExternalImageFormat::detect(bytes, path)?;
    let input = format!("{}:-", format.imagemagick_coder());
    let imagemagick_args = [
        "-limit",
        "memory",
        "192MiB",
        "-limit",
        "map",
        "0",
        "-limit",
        "disk",
        "0",
        "-limit",
        "thread",
        "1",
        "-limit",
        "time",
        "8",
        input.as_str(),
        "-depth",
        "8",
        "ppm:-",
    ];
    let mut decoder_found = false;
    for program in ["magick", "convert"] {
        match run_system_decoder(program, &imagemagick_args, bytes) {
            Ok(ppm) => return decode_ppm(&ppm),
            Err(SystemDecodeError::Unavailable) => {}
            Err(SystemDecodeError::Failed) => decoder_found = true,
        }
    }
    // ffmpeg does not rasterize SVG, and asking it to sniff arbitrary SVG
    // input would weaken the explicit decoder boundary above.
    if format != ExternalImageFormat::Svg {
        let ffmpeg_args = [
            "-v",
            "error",
            "-protocol_whitelist",
            "pipe,data",
            "-threads",
            "1",
            "-i",
            "pipe:0",
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "ppm",
            "pipe:1",
        ];
        match run_system_decoder("ffmpeg", &ffmpeg_args, bytes) {
            Ok(ppm) => return decode_ppm(&ppm),
            Err(SystemDecodeError::Unavailable) => {}
            Err(SystemDecodeError::Failed) => decoder_found = true,
        }
    }
    if decoder_found {
        bail!("{} decoder rejected this image", format.label())
    } else {
        bail!(
            "{} preview needs ImageMagick or ffmpeg in PATH",
            format.label()
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExternalImageFormat {
    Jpeg,
    Webp,
    Avif,
    Svg,
}

impl ExternalImageFormat {
    fn detect(bytes: &[u8], path: &Path) -> Result<Self> {
        if looks_like_svg(bytes, path) {
            validate_svg_source(bytes)?;
            return Ok(Self::Svg);
        }
        if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            return Ok(Self::Jpeg);
        }
        if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
            return Ok(Self::Webp);
        }
        if is_avif(bytes) {
            return Ok(Self::Avif);
        }
        let extension = path
            .extension()
            .and_then(OsStr::to_str)
            .unwrap_or("image")
            .to_ascii_uppercase();
        bail!("{extension} data is corrupt or uses an unsupported image format")
    }

    fn imagemagick_coder(self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg",
            Self::Webp => "webp",
            Self::Avif => "avif",
            Self::Svg => "svg",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Jpeg => "JPEG",
            Self::Webp => "WebP",
            Self::Avif => "AVIF",
            Self::Svg => "SVG",
        }
    }
}

fn is_avif(bytes: &[u8]) -> bool {
    if bytes.len() < 16 || bytes.get(4..8) != Some(b"ftyp") {
        return false;
    }
    let size = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    if size < 16 || size > bytes.len() {
        return false;
    }
    bytes[8..size]
        .chunks_exact(4)
        .any(|brand| matches!(brand, b"avif" | b"avis"))
}

fn looks_like_svg(bytes: &[u8], path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
        || std::str::from_utf8(bytes.get(..bytes.len().min(4096)).unwrap_or(bytes))
            .is_ok_and(|prefix| prefix.to_ascii_lowercase().contains("<svg"))
}

/// External rasterizers have historically differed in how they resolve SVG
/// entities and linked resources. Keep previews local-first by accepting only
/// in-document fragment references; linked files, network URLs, scripts, and
/// embedded documents are rejected before any third-party decoder sees them.
fn validate_svg_source(bytes: &[u8]) -> Result<()> {
    let source = std::str::from_utf8(bytes).context("SVG is not valid UTF-8")?;
    if source
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\t' | '\n' | '\r'))
        || source.contains('\\')
    {
        bail!("SVG preview blocks control characters and escaped resource syntax");
    }
    let lower = source.to_ascii_lowercase();
    let has_svg_element = lower.match_indices("<svg").any(|(start, _)| {
        lower
            .as_bytes()
            .get(start + 4)
            .is_some_and(|next| next.is_ascii_whitespace() || matches!(next, b'>' | b'/' | b':'))
    });
    if !has_svg_element {
        bail!("SVG preview requires an SVG document");
    }
    let searchable = strip_css_comments(&lower)?;
    for forbidden in [
        "<!doctype",
        "<!entity",
        "<?xml-stylesheet",
        "<script",
        "<foreignobject",
        "@import",
        "xml:base",
    ] {
        if searchable.contains(forbidden) {
            bail!("SVG preview blocks scripts, entities, and embedded documents");
        }
    }
    validate_svg_references(&searchable, "href")?;
    validate_svg_references(&searchable, "url(")?;
    Ok(())
}

fn strip_css_comments(source: &str) -> Result<String> {
    let mut output = String::with_capacity(source.len());
    let mut cursor = 0usize;
    while let Some(relative_start) = source[cursor..].find("/*") {
        let start = cursor + relative_start;
        output.push_str(&source[cursor..start]);
        let end = source[start + 2..]
            .find("*/")
            .map(|relative_end| start + 2 + relative_end + 2)
            .ok_or_else(|| anyhow!("SVG CSS comment is unterminated"))?;
        cursor = end;
    }
    output.push_str(&source[cursor..]);
    Ok(output)
}

fn validate_svg_references(source: &str, marker: &str) -> Result<()> {
    let mut cursor = 0usize;
    while let Some(relative) = source[cursor..].find(marker) {
        let start = cursor + relative + marker.len();
        if marker == "href" {
            let mut value_start = start;
            while source
                .as_bytes()
                .get(value_start)
                .is_some_and(u8::is_ascii_whitespace)
            {
                value_start += 1;
            }
            if source.as_bytes().get(value_start) != Some(&b'=') {
                cursor = start;
                continue;
            }
            value_start += 1;
            while source
                .as_bytes()
                .get(value_start)
                .is_some_and(u8::is_ascii_whitespace)
            {
                value_start += 1;
            }
            let quote = *source
                .as_bytes()
                .get(value_start)
                .ok_or_else(|| anyhow!("SVG reference is truncated"))?;
            if !matches!(quote, b'\'' | b'"') {
                bail!("SVG preview only accepts quoted local references");
            }
            value_start += 1;
            let end = source[value_start..]
                .find(quote as char)
                .map(|end| value_start + end)
                .ok_or_else(|| anyhow!("SVG reference is unterminated"))?;
            if !source[value_start..end].trim().starts_with('#') {
                bail!("SVG preview blocks linked files and network resources");
            }
            cursor = end + 1;
        } else {
            let end = source[start..]
                .find(')')
                .map(|end| start + end)
                .ok_or_else(|| anyhow!("SVG CSS reference is unterminated"))?;
            let value = source[start..end].trim().trim_matches(['\'', '"']);
            if !value.starts_with('#') {
                bail!("SVG preview blocks linked files and network resources");
            }
            cursor = end + 1;
        }
    }
    Ok(())
}

enum SystemDecodeError {
    Unavailable,
    Failed,
}

fn run_system_decoder(
    program: &str,
    args: &[&str],
    bytes: &[u8],
) -> std::result::Result<Vec<u8>, SystemDecodeError> {
    let deadline = Instant::now() + SUBPROCESS_TIMEOUT;
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                SystemDecodeError::Unavailable
            } else {
                SystemDecodeError::Failed
            }
        })?;
    let mut stdin = child.stdin.take().ok_or(SystemDecodeError::Failed)?;
    let input = bytes.to_vec();
    thread::spawn(move || {
        let _ = stdin.write_all(&input);
    });
    let stdout = child.stdout.take().ok_or(SystemDecodeError::Failed)?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut output = Vec::new();
        let result = stdout
            .take(MAX_DECODED_BYTES as u64 + 65_536)
            .read_to_end(&mut output)
            .map(|_| output);
        let _ = tx.send(result);
    });
    let output = match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(Ok(output)) if output.len() <= MAX_DECODED_BYTES + 65_535 => output,
        Ok(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(SystemDecodeError::Failed);
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(SystemDecodeError::Failed);
        }
    };
    let status = loop {
        match child.try_wait().map_err(|_| SystemDecodeError::Failed)? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(SystemDecodeError::Failed);
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };
    if status.success() {
        Ok(output)
    } else {
        Err(SystemDecodeError::Failed)
    }
}

fn decode_ppm(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    let mut cursor = 0usize;
    if ppm_token(bytes, &mut cursor)? != b"P6" {
        bail!("external decoder returned an unsupported raster")
    }
    let width: u32 = std::str::from_utf8(ppm_token(bytes, &mut cursor)?)?.parse()?;
    let height: u32 = std::str::from_utf8(ppm_token(bytes, &mut cursor)?)?.parse()?;
    let maximum: u16 = std::str::from_utf8(ppm_token(bytes, &mut cursor)?)?.parse()?;
    if maximum != 255 {
        bail!("external decoder returned an unsupported color depth")
    }
    validate_dimensions(width, height)?;
    if bytes.get(cursor) == Some(&b'\r') && bytes.get(cursor + 1) == Some(&b'\n') {
        cursor += 2;
    } else if bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    } else {
        bail!("external decoder returned a malformed raster")
    }
    let pixel_count = width as usize * height as usize;
    let rgb_bytes = pixel_count
        .checked_mul(3)
        .ok_or_else(|| anyhow!("external raster size overflow"))?;
    let rgb = bytes
        .get(cursor..cursor.saturating_add(rgb_bytes))
        .ok_or_else(|| anyhow!("external raster is truncated"))?;
    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for pixel in rgb.chunks_exact(3) {
        rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
    }
    Ok((width, height, rgba))
}

fn ppm_token<'a>(bytes: &'a [u8], cursor: &mut usize) -> Result<&'a [u8]> {
    loop {
        while bytes.get(*cursor).is_some_and(u8::is_ascii_whitespace) {
            *cursor += 1;
        }
        if bytes.get(*cursor) != Some(&b'#') {
            break;
        }
        while bytes.get(*cursor).is_some_and(|byte| *byte != b'\n') {
            *cursor += 1;
        }
    }
    let start = *cursor;
    while bytes
        .get(*cursor)
        .is_some_and(|byte| !byte.is_ascii_whitespace())
    {
        *cursor += 1;
    }
    bytes
        .get(start..*cursor)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| anyhow!("external raster header is truncated"))
}

fn validate_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        bail!("image dimensions are empty");
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        bail!("image dimensions exceed {MAX_DIMENSION}×{MAX_DIMENSION}");
    }
    let bytes = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| anyhow!("image dimensions overflow"))?;
    if bytes > MAX_DECODED_BYTES as u64 {
        bail!(
            "decoded image exceeds the {} memory limit",
            human_bytes(MAX_DECODED_BYTES)
        );
    }
    Ok(())
}

fn downsample_preview(width: u32, height: u32, pixels: Vec<u8>) -> (u32, u32, Vec<u8>) {
    if width <= MAX_PREVIEW_DIMENSION && height <= MAX_PREVIEW_DIMENSION {
        return (width, height, pixels);
    }
    let scale = (MAX_PREVIEW_DIMENSION as f64 / width as f64)
        .min(MAX_PREVIEW_DIMENSION as f64 / height as f64);
    let target_width = (width as f64 * scale).round().max(1.0) as u32;
    let target_height = (height as f64 * scale).round().max(1.0) as u32;
    let mut output = vec![0; target_width as usize * target_height as usize * 4];
    for y in 0..target_height {
        let source_y = (u64::from(y) * u64::from(height) / u64::from(target_height)) as u32;
        for x in 0..target_width {
            let source_x = (u64::from(x) * u64::from(width) / u64::from(target_width)) as u32;
            let source =
                (u64::from(source_y) * u64::from(width) + u64::from(source_x)) as usize * 4;
            let target = (u64::from(y) * u64::from(target_width) + u64::from(x)) as usize * 4;
            output[target..target + 4].copy_from_slice(&pixels[source..source + 4]);
        }
    }
    (target_width, target_height, output)
}
// Decoder implementations live below. They intentionally return a plain RGBA
// buffer so rendering and comparison never depend on codec-specific state.

#[derive(Debug, Clone)]
struct PngHeader {
    width: u32,
    height: u32,
    bit_depth: u8,
    color_type: u8,
    interlace: u8,
}

fn decode_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        bail!("invalid PNG signature");
    }
    let mut cursor = 8usize;
    let mut header = None;
    let mut palette = Vec::new();
    let mut transparency = Vec::new();
    let mut compressed = Vec::new();
    let mut saw_end = false;
    while cursor.saturating_add(12) <= bytes.len() {
        let length = read_be_u32(bytes, cursor)? as usize;
        let chunk_end = cursor
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
            .ok_or_else(|| anyhow!("PNG chunk length overflow"))?;
        if chunk_end > bytes.len() {
            bail!("truncated PNG chunk");
        }
        let kind = &bytes[cursor + 4..cursor + 8];
        let data = &bytes[cursor + 8..cursor + 8 + length];
        let expected_crc = read_be_u32(bytes, cursor + 8 + length)?;
        let mut hasher = crc32fast::Hasher::new();
        hasher.update(kind);
        hasher.update(data);
        if hasher.finalize() != expected_crc {
            bail!("PNG checksum mismatch");
        }
        match kind {
            b"IHDR" if header.is_none() && data.len() == 13 => {
                let value = PngHeader {
                    width: read_be_u32(data, 0)?,
                    height: read_be_u32(data, 4)?,
                    bit_depth: data[8],
                    color_type: data[9],
                    interlace: data[12],
                };
                if data[10] != 0 || data[11] != 0 || value.interlace > 1 {
                    bail!("unsupported PNG compression, filter, or interlace method");
                }
                validate_dimensions(value.width, value.height)?;
                validate_png_format(value.color_type, value.bit_depth)?;
                header = Some(value);
            }
            b"PLTE" => palette = data.to_vec(),
            b"tRNS" => transparency = data.to_vec(),
            b"IDAT" => {
                if compressed.len().saturating_add(data.len()) > MAX_ENCODED_BYTES {
                    bail!("PNG compressed stream exceeds preview limit");
                }
                compressed.extend_from_slice(data);
            }
            b"IEND" => {
                saw_end = true;
                break;
            }
            _ => {}
        }
        cursor = chunk_end;
    }
    let header = header.ok_or_else(|| anyhow!("PNG is missing IHDR"))?;
    if !saw_end || compressed.is_empty() {
        bail!("PNG is missing image data");
    }
    if header.color_type == 3 && (palette.is_empty() || palette.len() % 3 != 0) {
        bail!("indexed PNG has no valid palette");
    }
    let expected = png_expected_stream_len(&header)?;
    if expected > MAX_DECODED_BYTES {
        bail!("PNG decompressed stream exceeds preview limit");
    }
    let mut decoder = ZlibDecoder::new(Cursor::new(compressed));
    let mut stream = Vec::with_capacity(expected);
    Read::by_ref(&mut decoder)
        .take(expected.saturating_add(1) as u64)
        .read_to_end(&mut stream)
        .context("decompressing PNG")?;
    if stream.len() != expected {
        bail!("PNG decompressed to an unexpected size");
    }
    let mut output = vec![0; header.width as usize * header.height as usize * 4];
    let passes: &[(u32, u32, u32, u32)] = if header.interlace == 0 {
        &[(0, 0, 1, 1)]
    } else {
        &[
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ]
    };
    let channels = png_channels(header.color_type)?;
    let bytes_per_pixel =
        ((usize::from(channels) * usize::from(header.bit_depth)).div_ceil(8)).max(1);
    let mut stream_offset = 0usize;
    for (start_x, start_y, step_x, step_y) in passes {
        let pass_width = pass_size(header.width, *start_x, *step_x);
        let pass_height = pass_size(header.height, *start_y, *step_y);
        if pass_width == 0 || pass_height == 0 {
            continue;
        }
        let row_bytes = png_row_bytes(pass_width, channels, header.bit_depth)?;
        let mut previous = vec![0u8; row_bytes];
        let mut current = vec![0u8; row_bytes];
        for pass_y in 0..pass_height {
            let filter = *stream
                .get(stream_offset)
                .ok_or_else(|| anyhow!("truncated PNG scanline"))?;
            stream_offset += 1;
            let source = stream
                .get(stream_offset..stream_offset + row_bytes)
                .ok_or_else(|| anyhow!("truncated PNG scanline"))?;
            stream_offset += row_bytes;
            unfilter_png_row(filter, source, &previous, bytes_per_pixel, &mut current)?;
            for pass_x in 0..pass_width {
                let pixel = png_pixel(
                    &current,
                    pass_x,
                    header.color_type,
                    header.bit_depth,
                    &palette,
                    &transparency,
                )?;
                let x = start_x + pass_x * step_x;
                let y = start_y + pass_y * step_y;
                let offset = (u64::from(y) * u64::from(header.width) + u64::from(x)) as usize * 4;
                output[offset..offset + 4].copy_from_slice(&pixel);
            }
            std::mem::swap(&mut previous, &mut current);
        }
    }
    Ok((header.width, header.height, output))
}

fn validate_png_format(color_type: u8, bit_depth: u8) -> Result<()> {
    let valid = match color_type {
        0 => matches!(bit_depth, 1 | 2 | 4 | 8 | 16),
        2 => matches!(bit_depth, 8 | 16),
        3 => matches!(bit_depth, 1 | 2 | 4 | 8),
        4 | 6 => matches!(bit_depth, 8 | 16),
        _ => false,
    };
    if !valid {
        bail!("unsupported PNG color type {color_type} / depth {bit_depth}");
    }
    Ok(())
}

fn png_channels(color_type: u8) -> Result<u8> {
    match color_type {
        0 | 3 => Ok(1),
        2 => Ok(3),
        4 => Ok(2),
        6 => Ok(4),
        _ => bail!("unsupported PNG color type"),
    }
}

fn png_row_bytes(width: u32, channels: u8, bit_depth: u8) -> Result<usize> {
    let bits = u64::from(width)
        .checked_mul(u64::from(channels))
        .and_then(|value| value.checked_mul(u64::from(bit_depth)))
        .ok_or_else(|| anyhow!("PNG row size overflow"))?;
    usize::try_from(bits.div_ceil(8)).context("PNG row is too large")
}

fn pass_size(total: u32, start: u32, step: u32) -> u32 {
    if total <= start {
        0
    } else {
        (total - start).div_ceil(step)
    }
}

fn png_expected_stream_len(header: &PngHeader) -> Result<usize> {
    let channels = png_channels(header.color_type)?;
    let passes: &[(u32, u32, u32, u32)] = if header.interlace == 0 {
        &[(0, 0, 1, 1)]
    } else {
        &[
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ]
    };
    passes.iter().try_fold(0usize, |total, (x, y, sx, sy)| {
        let width = pass_size(header.width, *x, *sx);
        let height = pass_size(header.height, *y, *sy) as usize;
        if width == 0 || height == 0 {
            return Ok(total);
        }
        let row = png_row_bytes(width, channels, header.bit_depth)?.saturating_add(1);
        total
            .checked_add(
                row.checked_mul(height)
                    .ok_or_else(|| anyhow!("PNG size overflow"))?,
            )
            .ok_or_else(|| anyhow!("PNG size overflow"))
    })
}

fn unfilter_png_row(
    filter: u8,
    source: &[u8],
    previous: &[u8],
    bpp: usize,
    output: &mut [u8],
) -> Result<()> {
    if source.len() != previous.len() || source.len() != output.len() {
        bail!("PNG scanline sizes disagree");
    }
    for index in 0..source.len() {
        let left = index.checked_sub(bpp).map(|left| output[left]).unwrap_or(0);
        let up = previous[index];
        let upper_left = index
            .checked_sub(bpp)
            .map(|left| previous[left])
            .unwrap_or(0);
        output[index] = match filter {
            0 => source[index],
            1 => source[index].wrapping_add(left),
            2 => source[index].wrapping_add(up),
            3 => source[index].wrapping_add(((u16::from(left) + u16::from(up)) / 2) as u8),
            4 => source[index].wrapping_add(paeth(left, up, upper_left)),
            _ => bail!("unsupported PNG filter {filter}"),
        };
    }
    Ok(())
}

fn paeth(left: u8, up: u8, upper_left: u8) -> u8 {
    let left = i32::from(left);
    let up = i32::from(up);
    let upper_left = i32::from(upper_left);
    let estimate = left + up - upper_left;
    let dl = (estimate - left).abs();
    let du = (estimate - up).abs();
    let dul = (estimate - upper_left).abs();
    if dl <= du && dl <= dul {
        left as u8
    } else if du <= dul {
        up as u8
    } else {
        upper_left as u8
    }
}

fn png_sample(row: &[u8], sample: usize, depth: u8) -> Result<u16> {
    match depth {
        1 | 2 | 4 => {
            let depth = usize::from(depth);
            let bit = sample
                .checked_mul(depth)
                .ok_or_else(|| anyhow!("PNG sample overflow"))?;
            let byte = *row
                .get(bit / 8)
                .ok_or_else(|| anyhow!("PNG sample is truncated"))?;
            let shift = 8 - depth - bit % 8;
            Ok(u16::from((byte >> shift) & ((1 << depth) - 1)))
        }
        8 => row
            .get(sample)
            .copied()
            .map(u16::from)
            .ok_or_else(|| anyhow!("PNG sample is truncated")),
        16 => {
            let offset = sample
                .checked_mul(2)
                .ok_or_else(|| anyhow!("PNG sample overflow"))?;
            let bytes: [u8; 2] = row
                .get(offset..offset + 2)
                .ok_or_else(|| anyhow!("PNG sample is truncated"))?
                .try_into()
                .expect("slice length was checked");
            Ok(u16::from_be_bytes(bytes))
        }
        _ => bail!("unsupported PNG sample depth"),
    }
}

fn scale_sample(value: u16, depth: u8) -> u8 {
    if depth == 16 {
        (value >> 8) as u8
    } else {
        let maximum = (1u16 << depth) - 1;
        ((u32::from(value) * 255 + u32::from(maximum) / 2) / u32::from(maximum)) as u8
    }
}

fn png_pixel(
    row: &[u8],
    x: u32,
    color_type: u8,
    depth: u8,
    palette: &[u8],
    transparency: &[u8],
) -> Result<[u8; 4]> {
    let x = x as usize;
    match color_type {
        0 => {
            let raw = png_sample(row, x, depth)?;
            let gray = scale_sample(raw, depth);
            let transparent = (transparency.len() >= 2)
                .then(|| u16::from_be_bytes([transparency[0], transparency[1]]))
                .is_some_and(|value| value == raw);
            Ok([gray, gray, gray, if transparent { 0 } else { 255 }])
        }
        2 => {
            let red_raw = png_sample(row, x * 3, depth)?;
            let green_raw = png_sample(row, x * 3 + 1, depth)?;
            let blue_raw = png_sample(row, x * 3 + 2, depth)?;
            let transparent = if transparency.len() >= 6 {
                red_raw == u16::from_be_bytes([transparency[0], transparency[1]])
                    && green_raw == u16::from_be_bytes([transparency[2], transparency[3]])
                    && blue_raw == u16::from_be_bytes([transparency[4], transparency[5]])
            } else {
                false
            };
            Ok([
                scale_sample(red_raw, depth),
                scale_sample(green_raw, depth),
                scale_sample(blue_raw, depth),
                if transparent { 0 } else { 255 },
            ])
        }
        3 => {
            let index = png_sample(row, x, depth)? as usize;
            let offset = index.saturating_mul(3);
            let rgb = palette
                .get(offset..offset + 3)
                .ok_or_else(|| anyhow!("PNG palette index is out of range"))?;
            Ok([
                rgb[0],
                rgb[1],
                rgb[2],
                transparency.get(index).copied().unwrap_or(255),
            ])
        }
        4 => {
            let gray = scale_sample(png_sample(row, x * 2, depth)?, depth);
            let alpha = scale_sample(png_sample(row, x * 2 + 1, depth)?, depth);
            Ok([gray, gray, gray, alpha])
        }
        6 => Ok([
            scale_sample(png_sample(row, x * 4, depth)?, depth),
            scale_sample(png_sample(row, x * 4 + 1, depth)?, depth),
            scale_sample(png_sample(row, x * 4 + 2, depth)?, depth),
            scale_sample(png_sample(row, x * 4 + 3, depth)?, depth),
        ]),
        _ => bail!("unsupported PNG color type"),
    }
}

fn decode_bmp(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    if bytes.len() < 54 || !bytes.starts_with(b"BM") {
        bail!("invalid BMP header");
    }
    let data_offset = read_le_u32(bytes, 10)? as usize;
    decode_bmp_dib(bytes, 14, data_offset, false)
}

fn decode_bmp_dib(
    bytes: &[u8],
    dib_offset: usize,
    data_offset: usize,
    ico: bool,
) -> Result<(u32, u32, Vec<u8>)> {
    let header_size = read_le_u32(bytes, dib_offset)? as usize;
    if header_size < 40 || dib_offset.saturating_add(header_size) > bytes.len() {
        bail!("unsupported BMP DIB header");
    }
    let width = read_le_i32(bytes, dib_offset + 4)?;
    let raw_height = read_le_i32(bytes, dib_offset + 8)?;
    if width <= 0 || raw_height == 0 {
        bail!("invalid BMP dimensions");
    }
    let height_abs = raw_height.unsigned_abs();
    let height = if ico { height_abs / 2 } else { height_abs };
    let width = width as u32;
    validate_dimensions(width, height)?;
    let planes = read_le_u16(bytes, dib_offset + 12)?;
    let bits = read_le_u16(bytes, dib_offset + 14)?;
    let compression = read_le_u32(bytes, dib_offset + 16)?;
    if planes != 1 || !matches!(bits, 24 | 32) || compression != 0 {
        bail!("BMP preview supports uncompressed 24/32-bit images");
    }
    let bytes_per_pixel = usize::from(bits / 8);
    let row_bytes = (width as usize)
        .checked_mul(bytes_per_pixel)
        .ok_or_else(|| anyhow!("BMP row size overflow"))?;
    let stride = row_bytes.div_ceil(4) * 4;
    let required = data_offset
        .checked_add(
            stride
                .checked_mul(height as usize)
                .ok_or_else(|| anyhow!("BMP size overflow"))?,
        )
        .ok_or_else(|| anyhow!("BMP size overflow"))?;
    if required > bytes.len() {
        bail!("truncated BMP pixel data");
    }
    let top_down = raw_height < 0 && !ico;
    let mut output = vec![0; width as usize * height as usize * 4];
    for y in 0..height as usize {
        let source_y = if top_down { y } else { height as usize - 1 - y };
        let row = data_offset + source_y * stride;
        for x in 0..width as usize {
            let source = row + x * bytes_per_pixel;
            let target = (y * width as usize + x) * 4;
            output[target..target + 4].copy_from_slice(&[
                bytes[source + 2],
                bytes[source + 1],
                bytes[source],
                if bits == 32 && ico {
                    bytes[source + 3]
                } else {
                    255
                },
            ]);
        }
    }
    if ico {
        if bits == 32 && output.chunks_exact(4).all(|pixel| pixel[3] == 0) {
            for pixel in output.chunks_exact_mut(4) {
                pixel[3] = 255;
            }
        }
        let mask_offset = data_offset + stride * height as usize;
        let mask_stride = (width as usize).div_ceil(32) * 4;
        if mask_offset.saturating_add(mask_stride.saturating_mul(height as usize)) <= bytes.len() {
            for y in 0..height as usize {
                let source_y = height as usize - 1 - y;
                for x in 0..width as usize {
                    let byte = bytes[mask_offset + source_y * mask_stride + x / 8];
                    if byte & (0x80 >> (x % 8)) != 0 {
                        output[(y * width as usize + x) * 4 + 3] = 0;
                    }
                }
            }
        }
    }
    Ok((width, height, output))
}

fn decode_ico(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    if bytes.len() < 6 || read_le_u16(bytes, 0)? != 0 || read_le_u16(bytes, 2)? != 1 {
        bail!("invalid ICO header");
    }
    let count = usize::from(read_le_u16(bytes, 4)?);
    if count == 0 || 6usize.saturating_add(count.saturating_mul(16)) > bytes.len() {
        bail!("ICO has no valid entries");
    }
    let mut entries = Vec::new();
    for index in 0..count {
        let offset = 6 + index * 16;
        let width = if bytes[offset] == 0 {
            256
        } else {
            u32::from(bytes[offset])
        };
        let height = if bytes[offset + 1] == 0 {
            256
        } else {
            u32::from(bytes[offset + 1])
        };
        let size = read_le_u32(bytes, offset + 8)? as usize;
        let data_offset = read_le_u32(bytes, offset + 12)? as usize;
        if data_offset.saturating_add(size) <= bytes.len() {
            entries.push((u64::from(width) * u64::from(height), data_offset, size));
        }
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    let mut last_error = None;
    for (_, offset, size) in entries {
        let payload = &bytes[offset..offset + size];
        let decoded = if payload.starts_with(b"\x89PNG\r\n\x1a\n") {
            decode_png(payload)
        } else {
            read_le_u32(payload, 0)
                .and_then(|header| decode_bmp_dib(payload, 0, header as usize, true))
        };
        match decoded {
            Ok(image) => return Ok(image),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("ICO entries are truncated")))
}

fn decode_gif(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    if bytes.len() < 13 || !(bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        bail!("invalid GIF header");
    }
    let width = u32::from(read_le_u16(bytes, 6)?);
    let height = u32::from(read_le_u16(bytes, 8)?);
    validate_dimensions(width, height)?;
    let packed = bytes[10];
    let global_size = if packed & 0x80 != 0 {
        6usize << usize::from(packed & 0x07)
    } else {
        0
    };
    let mut cursor = 13usize;
    let global_palette = bytes
        .get(cursor..cursor.saturating_add(global_size))
        .ok_or_else(|| anyhow!("truncated GIF color table"))?
        .to_vec();
    cursor = cursor.saturating_add(global_size);
    let mut transparent = None;
    loop {
        let marker = *bytes
            .get(cursor)
            .ok_or_else(|| anyhow!("GIF has no image frame"))?;
        cursor += 1;
        match marker {
            0x21 => {
                let label = *bytes
                    .get(cursor)
                    .ok_or_else(|| anyhow!("truncated GIF extension"))?;
                cursor += 1;
                if label == 0xf9 {
                    let size = *bytes
                        .get(cursor)
                        .ok_or_else(|| anyhow!("truncated GIF control block"))?
                        as usize;
                    cursor += 1;
                    let data = bytes
                        .get(cursor..cursor + size)
                        .ok_or_else(|| anyhow!("truncated GIF control block"))?;
                    if size >= 4 && data[0] & 1 != 0 {
                        transparent = Some(data[3]);
                    }
                    cursor += size;
                    if bytes.get(cursor) != Some(&0) {
                        bail!("invalid GIF control terminator");
                    }
                    cursor += 1;
                } else {
                    skip_gif_subblocks(bytes, &mut cursor)?;
                }
            }
            0x2c => {
                if cursor.saturating_add(9) > bytes.len() {
                    bail!("truncated GIF image descriptor");
                }
                let left = u32::from(read_le_u16(bytes, cursor)?);
                let top = u32::from(read_le_u16(bytes, cursor + 2)?);
                let frame_width = u32::from(read_le_u16(bytes, cursor + 4)?);
                let frame_height = u32::from(read_le_u16(bytes, cursor + 6)?);
                let descriptor = bytes[cursor + 8];
                cursor += 9;
                if frame_width == 0
                    || frame_height == 0
                    || left.saturating_add(frame_width) > width
                    || top.saturating_add(frame_height) > height
                {
                    bail!("GIF frame leaves the canvas");
                }
                let local_size = if descriptor & 0x80 != 0 {
                    6usize << usize::from(descriptor & 0x07)
                } else {
                    0
                };
                let palette = if local_size > 0 {
                    let table = bytes
                        .get(cursor..cursor + local_size)
                        .ok_or_else(|| anyhow!("truncated GIF local color table"))?;
                    cursor += local_size;
                    table
                } else {
                    global_palette.as_slice()
                };
                if palette.is_empty() {
                    bail!("GIF frame has no color table");
                }
                let minimum_code_size = *bytes
                    .get(cursor)
                    .ok_or_else(|| anyhow!("truncated GIF LZW header"))?;
                cursor += 1;
                let compressed = read_gif_subblocks(bytes, &mut cursor)?;
                let indices = gif_lzw_decode(
                    &compressed,
                    minimum_code_size,
                    frame_width as usize * frame_height as usize,
                )?;
                let mut output = vec![0; width as usize * height as usize * 4];
                let rows: Vec<u32> = if descriptor & 0x40 != 0 {
                    [(0, 8), (4, 8), (2, 4), (1, 2)]
                        .into_iter()
                        .flat_map(|(start, step)| (start..frame_height).step_by(step))
                        .collect()
                } else {
                    (0..frame_height).collect()
                };
                for (source_y, target_y) in rows.into_iter().enumerate() {
                    for x in 0..frame_width as usize {
                        let index = indices[source_y * frame_width as usize + x];
                        let target = (u64::from(top + target_y) * u64::from(width)
                            + u64::from(left + x as u32))
                            as usize
                            * 4;
                        let palette_offset = usize::from(index) * 3;
                        let rgb = palette
                            .get(palette_offset..palette_offset + 3)
                            .ok_or_else(|| anyhow!("GIF color index is out of range"))?;
                        output[target..target + 4].copy_from_slice(&[
                            rgb[0],
                            rgb[1],
                            rgb[2],
                            if transparent == Some(index) { 0 } else { 255 },
                        ]);
                    }
                }
                return Ok((width, height, output));
            }
            0x3b => bail!("GIF contains no image frame"),
            _ => bail!("unknown GIF block marker"),
        }
    }
}

fn skip_gif_subblocks(bytes: &[u8], cursor: &mut usize) -> Result<()> {
    loop {
        let length = *bytes
            .get(*cursor)
            .ok_or_else(|| anyhow!("truncated GIF sub-block"))? as usize;
        *cursor += 1;
        if length == 0 {
            return Ok(());
        }
        *cursor = (*cursor)
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| anyhow!("truncated GIF sub-block"))?;
    }
}

fn read_gif_subblocks(bytes: &[u8], cursor: &mut usize) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    loop {
        let length = *bytes
            .get(*cursor)
            .ok_or_else(|| anyhow!("truncated GIF image data"))? as usize;
        *cursor += 1;
        if length == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(length) > MAX_ENCODED_BYTES {
            bail!("GIF compressed data exceeds preview limit");
        }
        let data = bytes
            .get(*cursor..(*cursor).saturating_add(length))
            .ok_or_else(|| anyhow!("truncated GIF image data"))?;
        output.extend_from_slice(data);
        *cursor += length;
    }
}

fn gif_lzw_decode(data: &[u8], minimum_size: u8, expected: usize) -> Result<Vec<u8>> {
    if !(2..=8).contains(&minimum_size) {
        bail!("invalid GIF LZW code size");
    }
    let clear = 1u16 << minimum_size;
    let end = clear + 1;
    let mut prefix = [0u16; 4096];
    let mut suffix = [0u8; 4096];
    for (index, value) in suffix.iter_mut().enumerate().take(clear as usize) {
        *value = index as u8;
    }
    let mut code_size = minimum_size + 1;
    let mut next_code = end + 1;
    let mut bit = 0usize;
    let mut previous = None;
    let mut terminated = false;
    let mut output = Vec::with_capacity(expected);
    let mut stack = [0u8; 4096];
    while let Some(code) = read_gif_code(data, &mut bit, code_size) {
        if code == clear {
            code_size = minimum_size + 1;
            next_code = end + 1;
            previous = None;
            continue;
        }
        if code == end {
            terminated = true;
            break;
        }
        if code >= 4096 || code > next_code || (previous.is_none() && code >= clear) {
            bail!("invalid GIF LZW code");
        }
        let mut current = code;
        let mut stack_len = 0usize;
        let first = if code == next_code {
            let previous_code = previous.ok_or_else(|| anyhow!("invalid GIF LZW stream"))?;
            current = previous_code;
            while current >= clear {
                if stack_len >= stack.len() {
                    bail!("GIF LZW dictionary cycle");
                }
                stack[stack_len] = suffix[current as usize];
                stack_len += 1;
                current = prefix[current as usize];
            }
            let first = suffix[current as usize];
            stack[stack_len] = first;
            stack_len += 1;
            first
        } else {
            while current >= clear {
                if stack_len >= stack.len() {
                    bail!("GIF LZW dictionary cycle");
                }
                stack[stack_len] = suffix[current as usize];
                stack_len += 1;
                current = prefix[current as usize];
            }
            let first = suffix[current as usize];
            stack[stack_len] = first;
            stack_len += 1;
            first
        };
        if output.len().saturating_add(stack_len) > expected {
            bail!("GIF frame decoded more pixels than expected");
        }
        output.extend(stack[..stack_len].iter().rev());
        if let Some(previous_code) = previous {
            if next_code < 4096 {
                prefix[next_code as usize] = previous_code;
                suffix[next_code as usize] = first;
                next_code += 1;
                if next_code == (1u16 << code_size) && code_size < 12 {
                    code_size += 1;
                }
            }
        }
        previous = Some(code);
    }
    if !terminated {
        bail!("GIF image data is missing an end code");
    }
    if output.len() != expected {
        bail!("GIF frame decoded to an unexpected size");
    }
    Ok(output)
}

fn read_gif_code(data: &[u8], bit: &mut usize, size: u8) -> Option<u16> {
    if bit.saturating_add(size as usize) > data.len().saturating_mul(8) {
        return None;
    }
    let mut value = 0u16;
    for offset in 0..size as usize {
        let position = bit.saturating_add(offset);
        value |= u16::from((data[position / 8] >> (position % 8)) & 1) << offset;
    }
    *bit += size as usize;
    Some(value)
}

fn read_be_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let value: [u8; 4] = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("truncated data"))?
        .try_into()
        .expect("slice length was checked");
    Ok(u32::from_be_bytes(value))
}

fn read_le_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    let value: [u8; 2] = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| anyhow!("truncated data"))?
        .try_into()
        .expect("slice length was checked");
    Ok(u16::from_le_bytes(value))
}

fn read_le_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let value: [u8; 4] = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("truncated data"))?
        .try_into()
        .expect("slice length was checked");
    Ok(u32::from_le_bytes(value))
}

fn read_le_i32(bytes: &[u8], offset: usize) -> Result<i32> {
    Ok(read_le_u32(bytes, offset)? as i32)
}
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn png_chunk(kind: &[u8; 4], data: &[u8], output: &mut Vec<u8>) {
        output.extend_from_slice(&(data.len() as u32).to_be_bytes());
        output.extend_from_slice(kind);
        output.extend_from_slice(data);
        let mut hasher = crc32fast::Hasher::new();
        hasher.update(kind);
        hasher.update(data);
        output.extend_from_slice(&hasher.finalize().to_be_bytes());
    }

    pub fn rgba_png(width: u32, height: u32, pixels: &[[u8; 4]]) -> Vec<u8> {
        let mut raw = Vec::new();
        for row in pixels.chunks(width as usize).take(height as usize) {
            raw.push(0);
            for pixel in row {
                raw.extend_from_slice(pixel);
            }
        }
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(&raw).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut header = Vec::new();
        header.extend_from_slice(&width.to_be_bytes());
        header.extend_from_slice(&height.to_be_bytes());
        header.extend_from_slice(&[8, 6, 0, 0, 0]);
        png_chunk(b"IHDR", &header, &mut png);
        png_chunk(b"IDAT", &compressed, &mut png);
        png_chunk(b"IEND", &[], &mut png);
        png
    }

    #[test]
    fn png_decoder_preserves_rgba_pixels() {
        let bytes = rgba_png(2, 1, &[[255, 0, 0, 255], [0, 255, 0, 128]]);
        let image = decode_raster(&bytes, Path::new("sample.png")).unwrap();
        assert_eq!((image.width, image.height), (2, 1));
        assert_eq!(image.pixel(0, 0), [255, 0, 0, 255]);
        assert_eq!(image.pixel(1, 0), [0, 255, 0, 128]);
    }

    #[test]
    fn png_decoder_rejects_corrupt_checksums_and_bombs() {
        let mut corrupt = rgba_png(1, 1, &[[1, 2, 3, 255]]);
        corrupt[29] ^= 1;
        assert!(decode_png(&corrupt).is_err());

        let mut header = PngHeader {
            width: MAX_DIMENSION + 1,
            height: 1,
            bit_depth: 8,
            color_type: 6,
            interlace: 0,
        };
        assert!(validate_dimensions(header.width, header.height).is_err());
        header.width = 1;
        assert!(png_expected_stream_len(&header).is_ok());
    }

    #[test]
    fn bmp_decoder_reads_bottom_up_bgr_pixels() {
        let mut bytes = vec![0u8; 54 + 8];
        let byte_len = bytes.len() as u32;
        bytes[0..2].copy_from_slice(b"BM");
        bytes[2..6].copy_from_slice(&byte_len.to_le_bytes());
        bytes[10..14].copy_from_slice(&54u32.to_le_bytes());
        bytes[14..18].copy_from_slice(&40u32.to_le_bytes());
        bytes[18..22].copy_from_slice(&2i32.to_le_bytes());
        bytes[22..26].copy_from_slice(&1i32.to_le_bytes());
        bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
        bytes[28..30].copy_from_slice(&24u16.to_le_bytes());
        bytes[54..60].copy_from_slice(&[0, 0, 255, 0, 255, 0]);
        let (width, height, pixels) = decode_bmp(&bytes).unwrap();
        assert_eq!((width, height), (2, 1));
        assert_eq!(&pixels[..8], &[255, 0, 0, 255, 0, 255, 0, 255]);
    }

    #[test]
    fn gif_decoder_reads_the_first_frame() {
        let bytes = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\x00\x00\x00\x00\xff,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;";
        let (width, height, pixels) = decode_gif(bytes).unwrap();
        assert_eq!((width, height), (1, 1));
        assert_eq!(&pixels[..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn ico_decoder_reads_an_embedded_png() {
        let png = rgba_png(1, 1, &[[12, 34, 56, 255]]);
        let mut ico = vec![0, 0, 1, 0, 1, 0];
        ico.extend_from_slice(&[1, 1, 0, 0]);
        ico.extend_from_slice(&1u16.to_le_bytes());
        ico.extend_from_slice(&32u16.to_le_bytes());
        ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
        ico.extend_from_slice(&22u32.to_le_bytes());
        ico.extend_from_slice(&png);
        let (width, height, pixels) = decode_ico(&ico).unwrap();
        assert_eq!((width, height), (1, 1));
        assert_eq!(&pixels[..4], &[12, 34, 56, 255]);
    }

    #[test]
    fn ico_decoder_skips_a_corrupt_larger_entry() {
        let png = rgba_png(1, 1, &[[12, 34, 56, 255]]);
        let mut ico = vec![0, 0, 1, 0, 2, 0];
        ico.extend_from_slice(&[2, 2, 0, 0, 1, 0, 32, 0]);
        ico.extend_from_slice(&8u32.to_le_bytes());
        ico.extend_from_slice(&38u32.to_le_bytes());
        ico.extend_from_slice(&[1, 1, 0, 0, 1, 0, 32, 0]);
        ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
        ico.extend_from_slice(&46u32.to_le_bytes());
        ico.extend_from_slice(b"garbage!");
        ico.extend_from_slice(&png);
        let (width, height, pixels) = decode_ico(&ico).unwrap();
        assert_eq!((width, height), (1, 1));
        assert_eq!(&pixels[..4], &[12, 34, 56, 255]);
    }

    #[test]
    fn gif_decoder_requires_an_end_code_and_exact_pixel_count() {
        assert!(gif_lzw_decode(&[0x04], 2, 1).is_err());
        assert!(gif_lzw_decode(&[0x04, 0x0a], 2, 1).is_err());
    }

    #[test]
    fn ppm_decoder_accepts_comments_without_consuming_pixel_whitespace() {
        let mut ppm = b"P6\n# generated\n2 1\n255\n".to_vec();
        ppm.extend_from_slice(&[32, 0, 255, 0, 255, 0]);
        let (width, height, pixels) = decode_ppm(&ppm).unwrap();
        assert_eq!((width, height), (2, 1));
        assert_eq!(&pixels[..8], &[32, 0, 255, 255, 0, 255, 0, 255]);
    }

    #[test]
    fn paths_and_object_ids_are_constrained() {
        assert!(crate::path_safety::safe_relative_path(Path::new("assets/image.png")));
        assert!(!crate::path_safety::safe_relative_path(Path::new("../secret.png")));
        assert!(valid_oid("abcdef12"));
        assert!(!valid_oid("HEAD:secret"));
    }

    #[test]
    fn svg_preview_allows_fragments_but_blocks_external_resources() {
        validate_svg_source(
            br##"<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><use href="#g" style="fill:url(#g)"/></svg>"##,
        )
        .unwrap();
        assert!(validate_svg_source(br#"<svg><image href="../../secret.png"/></svg>"#).is_err());
        assert!(validate_svg_source(br#"<!DOCTYPE svg SYSTEM "file:///tmp/x"><svg/>"#).is_err());
        assert!(validate_svg_source(
            br#"<svg><style>@import 'https://example.com/x.css'</style></svg>"#
        )
        .is_err());
        assert!(validate_svg_source(b"<svg>\x1b</svg>").is_err());
        assert!(validate_svg_source(
            br#"<svg><style>fill:url(\68 ttps://example.com/x)</style></svg>"#
        )
        .is_err());
        assert!(validate_svg_source(br#"<svg xml:base="https://example.com/"/>"#).is_err());
        assert!(
            validate_svg_source(br#"<svg><style>@im/* hidden */port "x"</style></svg>"#).is_err()
        );
        assert!(validate_svg_source(b"push graphic-context").is_err());
    }

    #[test]
    fn external_decoder_accepts_only_signature_verified_formats() {
        assert_eq!(
            ExternalImageFormat::detect(b"\xff\xd8\xffsample", Path::new("image.jpg")).unwrap(),
            ExternalImageFormat::Jpeg
        );
        assert_eq!(
            ExternalImageFormat::detect(b"RIFF\x04\0\0\0WEBP", Path::new("image.webp")).unwrap(),
            ExternalImageFormat::Webp
        );
        let avif = b"\0\0\0\x18ftypmif1\0\0\0\0avifmif1";
        assert_eq!(
            ExternalImageFormat::detect(avif, Path::new("image.avif")).unwrap(),
            ExternalImageFormat::Avif
        );
        assert!(ExternalImageFormat::detect(
            b"push graphic-context\nviewbox 0 0 1 1",
            Path::new("disguised.jpg")
        )
        .is_err());
    }
}
