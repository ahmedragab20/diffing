//! Unified-diff parser and `git diff` runner shared by the TUI renderer.
//!
//! The parser is intentionally minimal: it understands the common subset of
//! `git diff` output (file headers, hunk headers, +/-/space lines, the
//! `No newline at end of file` marker, new/deleted/renamed files, binary
//! files). The output shape is plain data so future renderers (CPU, GPU,
//! tests, golden files) all consume the same `Vec<FileDiff>`.
//!
//! The runner is a thin wrapper around `git diff --no-ext-diff` that
//! captures stdout. It mirrors the Node CLI's `runTerminalDiff` so the
//! Rust and Node sides produce byte-identical patch text for the same
//! input.

use std::path::{Path, PathBuf};
use std::process::Command;

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Binary,
}

#[derive(Debug, Clone)]
pub struct FileDiff {
    pub old_path: Option<PathBuf>,
    pub new_path: Option<PathBuf>,
    pub kind: ChangeKind,
    pub is_binary: bool,
    pub hunks: Vec<Hunk>,
}

impl FileDiff {
    pub fn display_path(&self) -> &Path {
        self.new_path
            .as_ref()
            .or(self.old_path.as_ref())
            .map(|p| p.as_path())
            .unwrap_or_else(|| Path::new(""))
    }
}

#[derive(Debug, Clone)]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub heading: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineKind {
    Context,
    Add,
    Del,
}

#[derive(Debug, Clone)]
pub struct Line {
    pub kind: LineKind,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
    pub content: String,
}

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("malformed hunk header: {0:?}")]
    HunkHeader(String),
}

/// Parse a unified-diff patch into structured data.
///
/// Robust against the common `git diff` output formats. Unknown lines
/// (e.g. `index ...`, `similarity index ...`) are ignored. Lines starting
/// with neither '+', '-', ' ', nor the `\\ No newline at end of file`
/// marker inside a hunk are treated as continuation context.
pub fn parse_patch(input: &str) -> Result<Vec<FileDiff>, ParseError> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut current_file: Option<FileDiff> = None;
    let mut current_hunk: Option<Hunk> = None;
    let mut old_lineno: u32 = 0;
    let mut new_lineno: u32 = 0;

    let flush = |file: &mut Option<FileDiff>, hunk: &mut Option<Hunk>, out: &mut Vec<FileDiff>| {
        if let Some(mut f) = file.take() {
            if let Some(h) = hunk.take() {
                f.hunks.push(h);
            }
            out.push(f);
        }
    };

    for line in input
        .split_inclusive('\n')
        .map(|s| s.trim_end_matches('\n'))
    {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            // Start a new file section.
            if let Some(f) = current_file.take() {
                let mut f = f;
                if let Some(h) = current_hunk.take() {
                    f.hunks.push(h);
                }
                files.push(f);
            }
            current_file = Some(parse_file_header(rest));
            old_lineno = 0;
            new_lineno = 0;
            continue;
        }

        let Some(f) = current_file.as_mut() else {
            // Lines before the first `diff --git` are part of the preamble;
            // ignore them.
            continue;
        };

        if line.starts_with("@@") {
            // Close the previous hunk if any.
            if let Some(h) = current_hunk.take() {
                f.hunks.push(h);
            }
            let hunk = parse_hunk_header(line)?;
            old_lineno = hunk.old_start;
            new_lineno = hunk.new_start;
            current_hunk = Some(hunk);
            continue;
        }

        // File-level metadata lines.
        if line.starts_with("new file mode") {
            f.kind = ChangeKind::Added;
            continue;
        }
        if line.starts_with("deleted file mode") {
            f.kind = ChangeKind::Deleted;
            continue;
        }
        if let Some(rest) = line.strip_prefix("rename from ") {
            f.kind = ChangeKind::Renamed;
            f.old_path = Some(PathBuf::from(rest));
            continue;
        }
        if let Some(rest) = line.strip_prefix("rename to ") {
            f.kind = ChangeKind::Renamed;
            f.new_path = Some(PathBuf::from(rest));
            continue;
        }
        if line.starts_with("Binary files ") && line.contains("differ") {
            f.is_binary = true;
            f.kind = ChangeKind::Binary;
            continue;
        }
        if let Some(rest) = line.strip_prefix("--- ") {
            // Old path marker. `--- /dev/null` means the file is added.
            let p = rest.trim();
            if p == "/dev/null" {
                f.kind = ChangeKind::Added;
                f.old_path = None;
            } else if let Some(p) = p.strip_prefix("a/") {
                f.old_path = Some(PathBuf::from(p));
            } else {
                f.old_path = Some(PathBuf::from(p));
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("+++ ") {
            // New path marker. `+++ /dev/null` means the file is deleted.
            let p = rest.trim();
            if p == "/dev/null" {
                f.kind = ChangeKind::Deleted;
                f.new_path = None;
            } else if let Some(p) = p.strip_prefix("b/") {
                f.new_path = Some(PathBuf::from(p));
            } else {
                f.new_path = Some(PathBuf::from(p));
            }
            continue;
        }
        // Skip the rest of the file-level metadata: `index ...`, `similarity
        // index ...`, `dissimilarity index ...`, `copy from ...`, `copy to ...`,
        // and blank lines.
        if line.is_empty()
            || line.starts_with("index ")
            || line.starts_with("old mode ")
            || line.starts_with("new mode ")
            || line.starts_with("similarity index ")
            || line.starts_with("dissimilarity index ")
            || line.starts_with("copy from ")
            || line.starts_with("copy to ")
            || line.starts_with("GIT binary patch")
        {
            continue;
        }

        // Hunk body line.
        let Some(h) = current_hunk.as_mut() else {
            // Stray line outside of a hunk — ignore.
            continue;
        };

        if line == "\\ No newline at end of file" {
            // Mark the previous line as having no trailing newline. We don't
            // store that explicitly yet; renderers can detect it by checking
            // the marker.
            continue;
        }

        if let Some(content) = line.strip_prefix('+') {
            h.lines.push(Line {
                kind: LineKind::Add,
                old_lineno: None,
                new_lineno: Some(new_lineno),
                content: content.to_string(),
            });
            new_lineno += 1;
        } else if let Some(content) = line.strip_prefix('-') {
            h.lines.push(Line {
                kind: LineKind::Del,
                old_lineno: Some(old_lineno),
                new_lineno: None,
                content: content.to_string(),
            });
            old_lineno += 1;
        } else if let Some(content) = line.strip_prefix(' ') {
            h.lines.push(Line {
                kind: LineKind::Context,
                old_lineno: Some(old_lineno),
                new_lineno: Some(new_lineno),
                content: content.to_string(),
            });
            old_lineno += 1;
            new_lineno += 1;
        } else {
            // Unknown line prefix — be permissive and treat it as context so
            // we don't lose data.
            h.lines.push(Line {
                kind: LineKind::Context,
                old_lineno: Some(old_lineno),
                new_lineno: Some(new_lineno),
                content: line.to_string(),
            });
            old_lineno += 1;
            new_lineno += 1;
        }
    }

    // Flush the trailing file/hunk.
    flush(&mut current_file, &mut current_hunk, &mut files);

    Ok(files)
}

fn parse_file_header(rest: &str) -> FileDiff {
    // `diff --git a/<path> b/<path>` — the paths are space-separated. We don't
    // split naively because filenames can contain spaces (rare but legal).
    // Use a heuristic: find the " b/" separator.
    let (a, b) = match rest.rfind(" b/") {
        Some(i) => (&rest[..i + 1], &rest[i + 2..]),
        None => (rest, ""),
    };
    let a = a.trim_start_matches("a/").trim_end();
    let b = b.trim();

    let old_path = if a.is_empty() || a == "/dev/null" {
        None
    } else {
        Some(PathBuf::from(a))
    };
    let new_path = if b.is_empty() || b == "/dev/null" {
        None
    } else {
        Some(PathBuf::from(b))
    };

    let kind = match (old_path.is_some(), new_path.is_some()) {
        (false, true) => ChangeKind::Added,
        (true, false) => ChangeKind::Deleted,
        _ => ChangeKind::Modified,
    };

    FileDiff {
        old_path,
        new_path,
        kind,
        is_binary: false,
        hunks: Vec::new(),
    }
}

fn parse_hunk_header(line: &str) -> Result<Hunk, ParseError> {
    // `@@ -old_start,old_lines +new_start,new_lines @@ heading`
    let after = line
        .strip_prefix("@@")
        .ok_or_else(|| ParseError::HunkHeader(line.to_string()))?;
    let (body, heading) = match after.split_once("@@") {
        Some((a, b)) => (a, b),
        None => return Err(ParseError::HunkHeader(line.to_string())),
    };
    let body = body.trim();
    let (old_part, new_part) = body
        .split_once(' ')
        .ok_or_else(|| ParseError::HunkHeader(line.to_string()))?;
    let (old_start, old_lines) = parse_range(old_part.trim_start_matches('-'))?;
    let (new_start, new_lines) = parse_range(new_part.trim_start_matches('+'))?;
    Ok(Hunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        heading: heading.trim().to_string(),
        lines: Vec::new(),
    })
}

fn parse_range(s: &str) -> Result<(u32, u32), ParseError> {
    let (start, lines) = match s.split_once(',') {
        Some((a, b)) => (a, b),
        None => (s, "1"),
    };
    let start: u32 = start
        .parse()
        .map_err(|_| ParseError::HunkHeader(s.to_string()))?;
    let lines: u32 = lines
        .parse()
        .map_err(|_| ParseError::HunkHeader(s.to_string()))?;
    Ok((start, lines))
}

#[derive(Debug, Error)]
pub enum GitDiffError {
    #[error("failed to run `git diff`: {0}")]
    Io(#[from] std::io::Error),
    #[error("git diff failed (exit {code:?}): {stderr}")]
    Git { code: Option<i32>, stderr: String },
    #[error("git diff produced non-UTF-8 output")]
    Utf8,
}

/// Run `git diff` in `repo_root` with the given args, capture the patch text.
///
/// `args` should be a subset of `git diff` options (e.g. `["--staged"]`,
/// `["--", "src/foo.rs"]`). The function appends `--no-ext-diff` to ensure a
/// stable unified-diff output regardless of the user's `diff.external`
/// config (mirroring the Node CLI's `runTerminalDiff`).
pub fn run_git_diff(repo_root: &str, args: &[String]) -> Result<String, GitDiffError> {
    let mut cmd = Command::new("git");
    cmd.arg("diff").arg("--no-ext-diff");
    for a in args {
        if a != "--no-ext-diff" {
            cmd.arg(a);
        }
    }
    cmd.current_dir(repo_root);

    let output = cmd.output()?;
    // `git diff` exits 0 with or without differences, 1 only when the user
    // explicitly passed --exit-code, and 128+ on real errors.
    match output.status.code() {
        Some(0) | Some(1) => {
            let stdout = String::from_utf8(output.stdout).map_err(|_| GitDiffError::Utf8)?;
            Ok(stdout)
        }
        code => {
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            Err(GitDiffError::Git { code, stderr })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_hunk_modification() {
        let patch = "diff --git a/src/a.txt b/src/a.txt\nindex 111..222 100644\n--- a/src/a.txt\n+++ b/src/a.txt\n@@ -1,3 +1,4 @@\n one\n-two\n+two\n+three\n three\n";
        let files = parse_patch(patch).unwrap();
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.kind, ChangeKind::Modified);
        assert_eq!(f.display_path().to_str(), Some("src/a.txt"));
        assert_eq!(f.hunks.len(), 1);
        let h = &f.hunks[0];
        assert_eq!(h.old_start, 1);
        assert_eq!(h.old_lines, 3);
        assert_eq!(h.new_start, 1);
        assert_eq!(h.new_lines, 4);
        // Lines: context, del, add, add, context  (5 total).
        assert_eq!(h.lines.len(), 5);
        assert_eq!(h.lines[0].kind, LineKind::Context);
        assert_eq!(h.lines[0].content, "one");
        assert_eq!(h.lines[1].kind, LineKind::Del);
        assert_eq!(h.lines[1].content, "two");
        assert_eq!(h.lines[2].kind, LineKind::Add);
        assert_eq!(h.lines[2].content, "two");
        assert_eq!(h.lines[3].kind, LineKind::Add);
        assert_eq!(h.lines[3].content, "three");
        assert_eq!(h.lines[4].kind, LineKind::Context);
        assert_eq!(h.lines[4].content, "three");
    }

    #[test]
    fn parses_added_file() {
        let patch = "diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 000..111\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n";
        let files = parse_patch(patch).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].kind, ChangeKind::Added);
        assert_eq!(files[0].old_path, None);
        assert_eq!(
            files[0].new_path.as_deref().unwrap().to_str(),
            Some("new.txt")
        );
        let h = &files[0].hunks[0];
        assert_eq!(h.lines.len(), 2);
        assert_eq!(h.lines[0].kind, LineKind::Add);
        assert_eq!(h.lines[0].content, "hello");
    }

    #[test]
    fn parses_deleted_file() {
        let patch = "diff --git a/old.txt b/old.txt\ndeleted file mode 100644\nindex 111..000\n--- a/old.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-bye\n-cruel world\n";
        let files = parse_patch(patch).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].kind, ChangeKind::Deleted);
        assert_eq!(files[0].new_path, None);
        let h = &files[0].hunks[0];
        assert_eq!(h.lines[0].kind, LineKind::Del);
    }

    #[test]
    fn parses_renamed_file() {
        let patch = "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n--- a/old.txt\n+++ b/new.txt\n";
        let files = parse_patch(patch).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].kind, ChangeKind::Renamed);
        assert_eq!(
            files[0].old_path.as_deref().unwrap().to_str(),
            Some("old.txt")
        );
        assert_eq!(
            files[0].new_path.as_deref().unwrap().to_str(),
            Some("new.txt")
        );
    }

    #[test]
    fn parses_multiple_files_and_hunks() {
        let patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-old\n+new\ndiff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1,1 +1,2 @@\n unchanged\n+added\n@@ -10,2 +11,3 @@\n a\n-b\n+b\n+b2\n c\n";
        let files = parse_patch(patch).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].hunks.len(), 1);
        assert_eq!(files[1].hunks.len(), 2);
        let h1 = &files[1].hunks[0];
        assert_eq!(h1.new_start, 1);
        let h2 = &files[1].hunks[1];
        assert_eq!(h2.old_start, 10);
        assert_eq!(h2.new_start, 11);
    }

    #[test]
    fn parses_binary_file() {
        let patch = "diff --git a/img.png b/img.png\nindex abc..def 100644\nBinary files a/img.png and b/img.png differ\n";
        let files = parse_patch(patch).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].is_binary);
        assert_eq!(files[0].kind, ChangeKind::Binary);
    }

    #[test]
    fn handles_no_newline_marker() {
        let patch = "diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -1,1 +1,1 @@\n-no newline\n+with newline\n\\ No newline at end of file\n";
        let files = parse_patch(patch).unwrap();
        assert_eq!(files[0].hunks[0].lines.len(), 2);
    }

    #[test]
    fn parses_filename_with_spaces() {
        let patch = "diff --git a/dir with space/file.txt b/dir with space/file.txt\n--- a/dir with space/file.txt\n+++ b/dir with space/file.txt\n@@ -0,0 +1,1 @@\n+hi\n";
        let files = parse_patch(patch).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].display_path().to_str(),
            Some("dir with space/file.txt")
        );
    }

    #[test]
    fn assigns_line_numbers() {
        let patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -5,3 +5,4 @@\n ctx\n-del\n+add1\n+add2\n ctx\n";
        let files = parse_patch(patch).unwrap();
        let h = &files[0].hunks[0];
        // ctx: old=5, new=5
        assert_eq!(h.lines[0].old_lineno, Some(5));
        assert_eq!(h.lines[0].new_lineno, Some(5));
        // del: old=6, new=-
        assert_eq!(h.lines[1].old_lineno, Some(6));
        assert_eq!(h.lines[1].new_lineno, None);
        // add1: old=-, new=6
        assert_eq!(h.lines[2].old_lineno, None);
        assert_eq!(h.lines[2].new_lineno, Some(6));
        // add2: old=-, new=7
        assert_eq!(h.lines[3].old_lineno, None);
        assert_eq!(h.lines[3].new_lineno, Some(7));
        // ctx: old=7, new=8
        assert_eq!(h.lines[4].old_lineno, Some(7));
        assert_eq!(h.lines[4].new_lineno, Some(8));
    }

    #[test]
    fn empty_patch_returns_empty_vec() {
        assert!(parse_patch("").unwrap().is_empty());
        assert!(parse_patch("just some prose\n").unwrap().is_empty());
    }

    #[test]
    fn run_git_diff_returns_patch_for_clean_repo() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        // Init a repo with a known commit.
        std::process::Command::new("git")
            .arg("init")
            .arg("-q")
            .arg("-b")
            .arg("main")
            .arg(path)
            .status()
            .unwrap();
        std::process::Command::new("git")
            .args(["-C", path.to_str().unwrap(), "config", "user.email", "t@e"])
            .status()
            .unwrap();
        std::process::Command::new("git")
            .args(["-C", path.to_str().unwrap(), "config", "user.name", "t"])
            .status()
            .unwrap();
        std::fs::write(path.join("a.txt"), "one\n").unwrap();
        std::process::Command::new("git")
            .args(["-C", path.to_str().unwrap(), "add", "."])
            .status()
            .unwrap();
        std::process::Command::new("git")
            .args(["-C", path.to_str().unwrap(), "commit", "-q", "-m", "i"])
            .status()
            .unwrap();
        std::fs::write(path.join("a.txt"), "one\ntwo\n").unwrap();

        let patch = run_git_diff(path.to_str().unwrap(), &[]).unwrap();
        assert!(patch.contains("diff --git"));
        assert!(patch.contains("@@"));
    }
}
