//! Repository-relative path validation shared by editor launch, LSP sync, and
//! local file readers.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};

use anyhow::{bail, Context, Result};

pub fn safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

/// Canonicalize `relative` and ensure it stays inside `repo_root`.
pub fn resolve_within_repo(repo_root: &Path, relative: &Path) -> Result<PathBuf> {
    if !safe_relative_path(relative) {
        bail!("path must stay inside the repository");
    }
    let canonical_repo = repo_root.canonicalize().context("resolving repository")?;
    let candidate = repo_root.join(relative);
    let canonical = candidate
        .canonicalize()
        .with_context(|| format!("resolving path {}", relative.display()))?;
    if !canonical.starts_with(&canonical_repo) {
        bail!("path escapes the repository");
    }
    Ok(canonical)
}

/// Open a repository file with reduced symlink-swap exposure: reject traversal,
/// open without following symlinks on Unix, then verify the open fd path.
pub fn open_file_within_repo(repo_root: &Path, relative: &Path) -> Result<File> {
    if !safe_relative_path(relative) {
        bail!("path must stay inside the repository");
    }
    let canonical_repo = repo_root.canonicalize().context("resolving repository")?;
    let candidate = repo_root.join(relative);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&candidate)
            .with_context(|| format!("opening {}", candidate.display()))?;
        let resolved = canonicalize_open_file(&file)?;
        if !resolved.starts_with(&canonical_repo) {
            bail!("path escapes the repository");
        }
        return Ok(file);
    }

    #[cfg(not(unix))]
    {
        let resolved = candidate
            .canonicalize()
            .with_context(|| format!("resolving path {}", relative.display()))?;
        if !resolved.starts_with(&canonical_repo) {
            bail!("path escapes the repository");
        }
        Ok(File::open(&resolved).with_context(|| format!("opening {}", resolved.display()))?)
    }
}

#[cfg(unix)]
fn canonicalize_open_file(file: &File) -> Result<PathBuf> {
    use std::os::unix::io::AsRawFd;

    let fd = file.as_raw_fd();
    #[cfg(target_os = "linux")]
    {
        return std::fs::canonicalize(format!("/proc/self/fd/{}", fd))
            .context("canonicalizing open file");
    }

    #[cfg(target_os = "macos")]
    {
        let mut buffer = vec![0u8; libc::PATH_MAX as usize];
        let status = unsafe {
            libc::fcntl(
                fd,
                libc::F_GETPATH,
                buffer.as_mut_ptr() as *mut libc::c_void,
            )
        };
        if status == -1 {
            return Err(io::Error::last_os_error()).context("canonicalizing open file");
        }
        let len = buffer
            .iter()
            .position(|&byte| byte == 0)
            .unwrap_or(buffer.len());
        return Ok(PathBuf::from(
            String::from_utf8_lossy(&buffer[..len]).into_owned(),
        ));
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = fd;
        bail!("cannot canonicalize open file on this platform");
    }
}
