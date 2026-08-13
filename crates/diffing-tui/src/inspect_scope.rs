//! Query-time inspect scope (git pathspec-ish globs + lockfile noise).

use diffing_core::index::{DiffIndex, IndexedFile};
use serde_json::{json, Value};

const PATH_MATCH_CAP: usize = 20;
const DIRECTORY_CAP: usize = 20;

#[derive(Clone)]
pub struct PathMatcher {
    parts: Vec<String>,
}

pub fn compile_pathspec(pattern: &str) -> Result<PathMatcher, String> {
    let source = pattern.trim();
    if source.is_empty() {
        return Err("invalid path glob: empty pattern".into());
    }
    let normalized = if source.contains('/') {
        source.to_string()
    } else {
        format!("**/{source}")
    };
    let parts: Vec<String> = normalized.split('/').map(str::to_string).collect();
    for part in &parts {
        if part != "**" && part.contains("**") {
            return Err(format!("invalid path glob: {pattern}"));
        }
        validate_segment(part, pattern)?;
    }
    Ok(PathMatcher { parts })
}

pub fn file_matches(matcher: &PathMatcher, file: &IndexedFile) -> bool {
    if let Some(path) = file.new_path.as_ref() {
        if matcher.test(&path.to_string_lossy()) {
            return true;
        }
    }
    if let Some(path) = file.old_path.as_ref() {
        if matcher.test(&path.to_string_lossy()) {
            return true;
        }
    }
    false
}

impl PathMatcher {
    pub fn test(&self, path: &str) -> bool {
        let path_parts: Vec<&str> = path.split('/').collect();
        let pat: Vec<&str> = self.parts.iter().map(String::as_str).collect();
        match_parts(&pat, &path_parts)
    }
}

pub fn parse_exclude(raw: Option<&str>) -> Result<Vec<String>, String> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let mut values = Vec::new();
    for value in raw
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if value != "lockfiles" {
            return Err(format!("unknown exclude: {value}"));
        }
        if !values.iter().any(|existing| existing == value) {
            values.push(value.to_string());
        }
    }
    Ok(values)
}

pub fn is_lockfile_noise(path: &str) -> bool {
    let base = path.rsplit('/').next().unwrap_or(path);
    base == "package-lock.json"
        || base == "pnpm-lock.yaml"
        || base.ends_with(".lock")
        || base.ends_with(".min.js")
}

pub fn display_path(file: &IndexedFile) -> String {
    file.display_path().to_string_lossy().into_owned()
}

pub enum FileResolve {
    Index(usize),
    Error { status: u16, body: Value },
}

pub fn resolve_file(index: &DiffIndex, file: Option<usize>, path: Option<&str>) -> FileResolve {
    let has_file = file.is_some();
    let has_path = path.is_some_and(|value| !value.is_empty());
    if has_file && has_path {
        return FileResolve::Error {
            status: 400,
            body: json!({ "error": "path and file are mutually exclusive", "path": path }),
        };
    }
    if !has_file && !has_path {
        return FileResolve::Error {
            status: 400,
            body: json!({ "error": "file or path is required" }),
        };
    }
    if let Some(file_index) = file {
        return FileResolve::Index(file_index);
    }
    let matcher = match compile_pathspec(path.unwrap_or("")) {
        Ok(matcher) => matcher,
        Err(error) => {
            return FileResolve::Error {
                status: 400,
                body: json!({ "error": error, "path": path }),
            };
        }
    };
    let matches: Vec<(usize, String)> = index
        .files
        .iter()
        .enumerate()
        .filter(|(_, file)| file_matches(&matcher, file))
        .map(|(i, file)| (i, display_path(file)))
        .collect();
    match matches.len() {
        0 => FileResolve::Error {
            status: 404,
            body: json!({ "error": "path matched no files", "path": path }),
        },
        1 => FileResolve::Index(matches[0].0),
        _ => FileResolve::Error {
            status: 409,
            body: json!({
                "error": "path matched multiple files; narrow the glob or pass file",
                "path": path,
                "matches": matches.into_iter().take(PATH_MATCH_CAP).map(|(index, path)| json!({ "index": index, "path": path })).collect::<Vec<_>>(),
            }),
        },
    }
}

pub fn matching_indexes(index: &DiffIndex, path: Option<&str>) -> Result<Vec<usize>, (u16, Value)> {
    let Some(path) = path.filter(|value| !value.is_empty()) else {
        return Ok((0..index.files.len()).collect());
    };
    let matcher =
        compile_pathspec(path).map_err(|error| (400, json!({ "error": error, "path": path })))?;
    Ok(index
        .files
        .iter()
        .enumerate()
        .filter(|(_, file)| file_matches(&matcher, file))
        .map(|(i, _)| i)
        .collect())
}

pub fn directories(files: &[IndexedFile], skip_lockfiles: bool) -> Vec<Value> {
    use std::collections::BTreeMap;
    struct Bucket {
        files: usize,
        hunks: usize,
        additions: u64,
        deletions: u64,
    }
    let mut buckets: BTreeMap<String, Bucket> = BTreeMap::new();
    for file in files {
        let path = display_path(file);
        if skip_lockfiles && is_lockfile_noise(&path) {
            continue;
        }
        let dir = path.split_once('/').map(|(head, _)| head).unwrap_or(".");
        let bucket = buckets.entry(dir.to_string()).or_insert(Bucket {
            files: 0,
            hunks: 0,
            additions: 0,
            deletions: 0,
        });
        bucket.files += 1;
        bucket.hunks += file.hunks.len();
        bucket.additions += file.additions;
        bucket.deletions += file.deletions;
    }
    let mut ranked: Vec<(String, Bucket)> = buckets.into_iter().collect();
    ranked.sort_by(|a, b| {
        b.1.files
            .cmp(&a.1.files)
            .then((b.1.additions + b.1.deletions).cmp(&(a.1.additions + a.1.deletions)))
    });
    let mut out = Vec::new();
    let (head, rest) = if ranked.len() > DIRECTORY_CAP {
        ranked.split_at(DIRECTORY_CAP)
    } else {
        (&ranked[..], &[][..])
    };
    for (path, bucket) in head {
        out.push(json!({
            "path": path,
            "files": bucket.files,
            "hunks": bucket.hunks,
            "additions": bucket.additions,
            "deletions": bucket.deletions,
        }));
    }
    if !rest.is_empty() {
        let mut other = Bucket {
            files: 0,
            hunks: 0,
            additions: 0,
            deletions: 0,
        };
        for (_, bucket) in rest {
            other.files += bucket.files;
            other.hunks += bucket.hunks;
            other.additions += bucket.additions;
            other.deletions += bucket.deletions;
        }
        out.push(json!({
            "path": "+other",
            "files": other.files,
            "hunks": other.hunks,
            "additions": other.additions,
            "deletions": other.deletions,
        }));
    }
    out
}

fn match_parts(pat: &[&str], path: &[&str]) -> bool {
    match (pat.first().copied(), path.first().copied()) {
        (None, None) => true,
        (Some("**"), _) => {
            match_parts(&pat[1..], path) || (!path.is_empty() && match_parts(pat, &path[1..]))
        }
        (Some(pattern), Some(segment)) if glob_segment(pattern, segment) => {
            match_parts(&pat[1..], &path[1..])
        }
        _ => false,
    }
}

fn validate_segment(segment: &str, pattern: &str) -> Result<(), String> {
    let chars: Vec<char> = segment.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '[' {
            let close = chars[i + 1..].iter().position(|c| *c == ']');
            let Some(offset) = close else {
                return Err(format!("invalid path glob: {pattern}"));
            };
            if offset == 0 {
                return Err(format!("invalid path glob: {pattern}"));
            }
            i += offset + 2;
            continue;
        }
        if chars[i] == '\\' {
            if i + 1 >= chars.len() {
                return Err(format!("invalid path glob: {pattern}"));
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    Ok(())
}

fn glob_segment(pattern: &str, value: &str) -> bool {
    glob_seg(
        &pattern.chars().collect::<Vec<_>>(),
        &value.chars().collect::<Vec<_>>(),
    )
}

fn glob_seg(pattern: &[char], value: &[char]) -> bool {
    if pattern.is_empty() {
        return value.is_empty();
    }
    match pattern[0] {
        '*' => {
            glob_seg(&pattern[1..], value) || (!value.is_empty() && glob_seg(pattern, &value[1..]))
        }
        '?' => !value.is_empty() && glob_seg(&pattern[1..], &value[1..]),
        '[' => {
            let Some(close) = pattern[1..].iter().position(|c| *c == ']') else {
                return false;
            };
            let class = &pattern[1..1 + close];
            if value.is_empty() {
                return false;
            }
            let negated = class.first() == Some(&'!') || class.first() == Some(&'^');
            let body = if negated { &class[1..] } else { class };
            if class_matches(body, value[0]) == negated {
                return false;
            }
            glob_seg(&pattern[close + 2..], &value[1..])
        }
        '\\' => {
            pattern.len() > 1
                && !value.is_empty()
                && pattern[1] == value[0]
                && glob_seg(&pattern[2..], &value[1..])
        }
        literal => !value.is_empty() && literal == value[0] && glob_seg(&pattern[1..], &value[1..]),
    }
}

fn class_matches(body: &[char], value: char) -> bool {
    let mut i = 0;
    while i < body.len() {
        if i + 2 < body.len() && body[i + 1] == '-' {
            let start = body[i];
            let end = body[i + 2];
            if (start..=end).contains(&value) {
                return true;
            }
            i += 3;
            continue;
        }
        if body[i] == value {
            return true;
        }
        i += 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pathspec_globs() {
        let src = compile_pathspec("src/**").unwrap();
        assert!(src.test("src/a.ts"));
        assert!(!src.test("gone.ts"));
        let deep = compile_pathspec("**/a.ts").unwrap();
        assert!(deep.test("src/a.ts"));
        let base = compile_pathspec("b.ts").unwrap();
        assert!(base.test("src/b.ts"));
        assert!(compile_pathspec("src/[").is_err());
        let nested = compile_pathspec("src/**/*.ts").unwrap();
        assert!(nested.test("src/a.ts"));
        assert!(nested.test("src/lib/a.ts"));
        assert!(!nested.test("gone.ts"));
    }
}
