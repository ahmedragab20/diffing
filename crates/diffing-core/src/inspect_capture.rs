//! Optimistic validation for retained native inspection. Live rendering remains
//! streaming; only starting a retained capture performs these extra Git reads.
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::index::{DiffIndex, NATIVE_PATCH_FLAGS};

const MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct GitScope {
    pub root: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionIdentity {
    pub repository_id: String,
    pub workspace_id: String,
    pub head: Option<String>,
    pub index_digest: String,
    pub resolved_revisions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureManifest {
    pub version: u8,
    pub snapshot_id: String,
    #[serde(flatten)]
    pub identity: InspectionIdentity,
    pub scope_digest: String,
    pub source_digest: String,
    pub captured_at: u64,
    pub consistency: String,
    pub complete: bool,
    pub options: BTreeMap<String, Value>,
    pub layers: Vec<CaptureLayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureLayer {
    pub id: String,
    pub kind: String,
    pub source_digest: String,
    pub first_file: usize,
    pub file_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CaptureError {
    #[error("source_unavailable")]
    Unavailable,
    #[error("inconsistent_capture")]
    Inconsistent,
    #[error("unsupported_capture")]
    Unsupported,
    #[error("snapshot_too_large")]
    TooLarge,
}

type Result<T> = std::result::Result<T, CaptureError>;

fn digest(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes.as_ref()))
}

/// Replay only unified-patch options with known read-only behavior. In
/// particular, never replay --output, external drivers, combined or show
/// formats, prefixes, or an option whose separate value could be a revision.
fn revisions(args: &[String]) -> Result<Vec<String>> {
    if args.len() > 1000
        || args
            .iter()
            .any(|arg| arg.len() > 8192 || arg.contains('\0'))
    {
        return Err(CaptureError::Unsupported);
    }
    let mut refs = Vec::new();
    for arg in args.iter().take_while(|arg| arg.as_str() != "--") {
        if !arg.starts_with('-') {
            refs.push(arg.clone());
            continue;
        }
        let accepted = matches!(
            arg.as_str(),
            "--staged"
                | "--cached"
                | "--no-color"
                | "--no-ext-diff"
                | "--no-textconv"
                | "--no-indent-heuristic"
                | "--indent-heuristic"
                | "--ignore-space-change"
                | "--ignore-all-space"
                | "--ignore-blank-lines"
                | "--ignore-cr-at-eol"
                | "--ignore-space-at-eol"
                | "--function-context"
                | "--find-copies-harder"
                | "--no-renames"
                | "--relative"
                | "--text"
                | "--binary"
                | "--full-index"
                | "--exit-code"
                | "--reverse"
                | "--pickaxe-all"
                | "--pickaxe-regex"
                | "--word-diff=none"
                | "--submodule=short"
                | "-R"
                | "-w"
                | "-b"
                | "-W"
                | "-a"
                | "-M"
                | "-C"
                | "-B"
                | "-p"
                | "--patch"
        ) || [
            "--diff-algorithm=",
            "--anchored=",
            "--unified=",
            "--inter-hunk-context=",
            "--diff-filter=",
            "--relative=",
            "--find-renames=",
            "--find-copies=",
            "--break-rewrites=",
            "--ignore-matching-lines=",
            "--abbrev=",
            "--ignore-submodules=",
        ]
        .iter()
        .any(|prefix| arg.starts_with(prefix))
            || ["-M", "-C", "-B", "-U"].iter().any(|prefix| {
                arg.strip_prefix(prefix).is_some_and(|value| {
                    !value.is_empty()
                        && value
                            .bytes()
                            .all(|b| b.is_ascii_digit() || b == b'%' || b == b'/')
                })
            })
            || ["-S", "-G"].iter().any(|prefix| {
                arg.strip_prefix(prefix)
                    .is_some_and(|value| !value.is_empty())
            });
        if !accepted {
            return Err(CaptureError::Unsupported);
        }
    }
    Ok(refs)
}

fn command(root: &str, args: impl IntoIterator<Item = impl AsRef<OsStr>>) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(["--no-optional-locks", "-c", "core.fsmonitor=false"])
        .args(args)
        .current_dir(root)
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    cmd
}

/// Each subprocess has bounded output and a deadline. The read worker owns no
/// files or child; timeout kills and reaps Git before returning an error.
fn output(
    mut cmd: Command,
    allow_difference: bool,
    limit: u64,
    deadline: Instant,
) -> Result<Vec<u8>> {
    if Instant::now() >= deadline {
        return Err(CaptureError::Unavailable);
    }
    let mut child = cmd.spawn().map_err(|_| CaptureError::Unavailable)?;
    let stdout = child.stdout.take().ok_or(CaptureError::Unavailable)?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(2)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(CaptureError::Unavailable);
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| CaptureError::Unavailable)?
        .map_err(|_| CaptureError::Unavailable)?;
    if bytes.len() as u64 > limit {
        return Err(CaptureError::TooLarge);
    }
    let status = status?;
    if !status.success() && !(allow_difference && status.code() == Some(1)) {
        return Err(CaptureError::Unavailable);
    }
    Ok(bytes)
}

fn git(root: &str, args: &[&str], deadline: Instant) -> Result<Vec<u8>> {
    output(command(root, args), false, MAX_BYTES, deadline)
}

fn text(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes).map_err(|_| CaptureError::Unsupported)
}

fn canonical_id(root: &str, args: &[&str], deadline: Instant) -> Result<String> {
    let raw = text(git(root, args, deadline)?)?;
    let path = raw.strip_suffix('\n').unwrap_or(&raw);
    let path = path.strip_suffix('\r').unwrap_or(path);
    let path = fs::canonicalize(path).map_err(|_| CaptureError::Unavailable)?;
    let path = path.to_str().ok_or(CaptureError::Unsupported)?;
    // Match Node realpath's non-namespaced Windows representation.
    #[cfg(windows)]
    let path = path
        .strip_prefix("\\\\?\\UNC\\")
        .map(|path| format!("\\\\{path}"))
        .unwrap_or_else(|| path.strip_prefix("\\\\?\\").unwrap_or(path).to_owned());
    Ok(digest(path))
}

fn valid_revision(value: &str) -> bool {
    let hash = value.strip_prefix('^').unwrap_or(value);
    matches!(hash.len(), 40 | 64)
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn identity(scope: &GitScope, refs: &[String], deadline: Instant) -> Result<InspectionIdentity> {
    let repository_id = canonical_id(
        &scope.root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        deadline,
    )?;
    let workspace_id = canonical_id(&scope.root, &["rev-parse", "--absolute-git-dir"], deadline)?;
    let index_digest = digest(git(&scope.root, &["ls-files", "--stage", "-z"], deadline)?);
    let head = match git(&scope.root, &["rev-parse", "--verify", "HEAD"], deadline) {
        Ok(bytes) => {
            let head = text(bytes)?.trim().to_owned();
            if !valid_revision(&head) {
                return Err(CaptureError::Unavailable);
            }
            Some(head)
        }
        Err(_) => {
            let branch = text(git(
                &scope.root,
                &["symbolic-ref", "--quiet", "HEAD"],
                deadline,
            )?)?;
            if !git(
                &scope.root,
                &["for-each-ref", "--format=%(refname)", branch.trim()],
                deadline,
            )?
            .is_empty()
            {
                return Err(CaptureError::Unavailable);
            }
            None
        }
    };
    let resolved_revisions = if refs.is_empty() {
        Vec::new()
    } else {
        let mut args = vec!["rev-parse", "--revs-only", "--end-of-options"];
        args.extend(refs.iter().map(String::as_str));
        let revisions: Vec<String> = text(git(&scope.root, &args, deadline)?)?
            .lines()
            .map(str::to_owned)
            .collect();
        if revisions.is_empty()
            || revisions.len() > 1000
            || revisions.iter().any(|r| !valid_revision(r))
        {
            return Err(CaptureError::Unavailable);
        }
        revisions
    };
    Ok(InspectionIdentity {
        repository_id,
        workspace_id,
        head,
        index_digest,
        resolved_revisions,
    })
}

fn patch(scope: &GitScope, deadline: Instant) -> Result<String> {
    let untracked = if scope.args.is_empty() {
        git(
            &scope.root,
            &["ls-files", "--others", "--exclude-standard", "-z"],
            deadline,
        )?
    } else {
        Vec::new()
    };
    let mut args = vec![OsString::from("diff")];
    args.extend(NATIVE_PATCH_FLAGS.iter().map(OsString::from));
    args.extend(scope.args.iter().map(OsString::from));
    let bytes = output(command(&scope.root, args), true, MAX_BYTES, deadline)?;
    reject_unsupported_patch(&bytes)?;
    let mut size = bytes.len() as u64;
    let mut hash = Sha256::new();
    hash.update(&bytes);
    drop(bytes);
    for path in untracked.split(|b| *b == 0).filter(|p| !p.is_empty()) {
        #[cfg(unix)]
        let path = {
            use std::os::unix::ffi::OsStrExt;
            OsStr::from_bytes(path)
        };
        #[cfg(not(unix))]
        let path = OsStr::new(std::str::from_utf8(path).map_err(|_| CaptureError::Unsupported)?);
        #[cfg(windows)]
        let null = "NUL";
        #[cfg(not(windows))]
        let null = "/dev/null";
        let mut args = vec![OsStr::new("diff"), OsStr::new("--no-index")];
        args.extend(NATIVE_PATCH_FLAGS.iter().map(OsStr::new));
        args.extend([OsStr::new("--"), OsStr::new(null), path]);
        let bytes = output(command(&scope.root, args), true, MAX_BYTES - size, deadline)?;
        reject_unsupported_patch(&bytes)?;
        size += bytes.len() as u64;
        hash.update(&bytes);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn reject_unsupported_patch(bytes: &[u8]) -> Result<()> {
    if bytes.split(|b| *b == b'\n').any(|line| {
        line.starts_with(b"diff --cc ")
            || line.starts_with(b"diff --combined ")
            || line.starts_with(b"* Unmerged path ")
            || line.starts_with(b"Submodule ")
    }) {
        return Err(CaptureError::Unsupported);
    }
    Ok(())
}

fn source_digest(index: &DiffIndex) -> Result<String> {
    if index.patch_bytes == 0 {
        return Ok(digest([]));
    }
    let mut file = fs::File::open(&index.spool_path).map_err(|_| CaptureError::Unavailable)?;
    let mut hash = Sha256::new();
    let count = std::io::copy(
        &mut Read::by_ref(&mut file).take(index.patch_bytes),
        &mut HashWriter(&mut hash),
    )
    .map_err(|_| CaptureError::Unavailable)?;
    if count != index.patch_bytes {
        return Err(CaptureError::Unavailable);
    }
    Ok(format!("{:x}", hash.finalize()))
}

struct HashWriter<'a>(&'a mut Sha256);
impl Write for HashWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Validate the exact retained prefix against two fresh collections and three
/// identities. A stale live index is rejected, never silently replaced under
/// its old generation. Continued reads do not call this function.
pub fn validate(index: &DiffIndex, snapshot_id: &str, now: u64) -> Result<Option<CaptureManifest>> {
    let Some(scope) = index.source_scope.as_ref() else {
        return Ok(None);
    };
    if !index.complete {
        return Ok(None);
    }
    let refs = revisions(&scope.args)?;
    let source = source_digest(index)?;
    let deadline = Instant::now() + Duration::from_secs(30);
    validate_with(
        index,
        snapshot_id,
        now,
        &source,
        || identity(scope, &refs, deadline),
        || patch(scope, deadline),
    )
    .map(Some)
}

fn validate_with(
    index: &DiffIndex,
    snapshot_id: &str,
    now: u64,
    source: &str,
    mut identity: impl FnMut() -> Result<InspectionIdentity>,
    mut patch: impl FnMut() -> Result<String>,
) -> Result<CaptureManifest> {
    for _ in 0..3 {
        let before = identity()?;
        let first = patch()?;
        let middle = identity()?;
        let second = patch()?;
        let after = identity()?;
        if before != middle || middle != after || first != second || first != source {
            continue;
        }
        let scope = index
            .source_scope
            .as_ref()
            .ok_or(CaptureError::Unavailable)?;
        let options = BTreeMap::from([
            ("nativeGitDiffArgs".into(), json!(scope.args)),
            ("includeUntracked".into(), json!(scope.args.is_empty())),
            ("nativeCaptureFormat".into(), json!("unified-v1")),
            ("externalDiff".into(), json!(false)),
            ("textconv".into(), json!(false)),
            ("srcPrefix".into(), json!("a/")),
            ("dstPrefix".into(), json!("b/")),
        ]);
        let scope_digest =
            digest(serde_json::to_vec(&options).map_err(|_| CaptureError::Unsupported)?);
        let kind = if scope.args.is_empty() {
            "mixed"
        } else if scope
            .args
            .iter()
            .take_while(|a| a.as_str() != "--")
            .any(|a| matches!(a.as_str(), "--staged" | "--cached"))
        {
            "staged"
        } else if !before.resolved_revisions.is_empty() {
            "revision"
        } else {
            "working"
        };
        return Ok(CaptureManifest {
            version: 1,
            snapshot_id: snapshot_id.into(),
            identity: before,
            scope_digest: scope_digest.clone(),
            source_digest: source.into(),
            captured_at: now,
            consistency: "optimistic-validated".into(),
            complete: true,
            options,
            layers: vec![CaptureLayer {
                id: digest(format!("native:0:{kind}:{scope_digest}:{source}")),
                kind: kind.into(),
                source_digest: source.into(),
                first_file: 0,
                file_count: index.files.len(),
            }],
        });
    }
    Err(CaptureError::Inconsistent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::build_git_diff_index;
    use std::cell::Cell;

    struct Repo(tempfile::TempDir);
    impl Repo {
        fn new() -> Self {
            let repo = Self(tempfile::tempdir().unwrap());
            repo.run(&["init", "-q"]);
            repo.run(&["config", "user.name", "Capture Test"]);
            repo.run(&["config", "user.email", "test@example.invalid"]);
            repo.run(&["config", "core.autocrlf", "false"]);
            repo
        }
        fn root(&self) -> &str {
            self.0.path().to_str().unwrap()
        }
        fn run(&self, args: &[&str]) {
            assert!(
                Command::new("git")
                    .args(args)
                    .current_dir(self.root())
                    .output()
                    .unwrap()
                    .status
                    .success(),
                "git {args:?}"
            );
        }
        fn index(&self, args: &[&str]) -> DiffIndex {
            build_git_diff_index(
                self.root(),
                &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                |_| {},
            )
            .unwrap()
        }
    }
    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(crate::project_storage_dir(self.root()));
        }
    }

    const ID: &str = "12345678-1234-4234-8234-123456789abc";

    #[test]
    fn real_working_staged_revision_and_unborn_captures_bind_exact_bytes() {
        let repo = Repo::new();
        fs::write(repo.0.path().join("new.txt"), "a\r\nb\n").unwrap();
        let index = repo.index(&[]);
        let manifest = validate(&index, ID, 12).unwrap().unwrap();
        assert_eq!(manifest.snapshot_id, ID);
        assert_eq!(manifest.identity.head, None);
        assert_eq!(manifest.layers[0].kind, "mixed");
        assert_eq!(manifest.layers[0].file_count, 1);
        assert_eq!(
            manifest.source_digest,
            digest(fs::read(&index.spool_path).unwrap())
        );
        assert!(manifest.complete);
        assert_eq!(manifest.consistency, "optimistic-validated");
        assert_eq!(
            manifest.identity.repository_id,
            manifest.identity.workspace_id
        );

        repo.run(&["add", "."]);
        repo.run(&["commit", "-qm", "base"]);
        fs::write(repo.0.path().join("new.txt"), "staged\n").unwrap();
        repo.run(&["add", "."]);
        let staged = repo.index(&["--staged"]);
        let staged_manifest = validate(&staged, ID, 13).unwrap().unwrap();
        assert_eq!(staged_manifest.layers[0].kind, "staged");
        assert_eq!(staged_manifest.identity.head.as_ref().unwrap().len(), 40);
        let staged_digest = staged_manifest.source_digest;
        fs::write(repo.0.path().join("new.txt"), "working\n").unwrap();
        let working = repo.index(&["--unified=2", "--", "new.txt"]);
        let working_manifest = validate(&working, ID, 14).unwrap().unwrap();
        assert_eq!(working_manifest.layers[0].kind, "working");
        assert_ne!(working_manifest.source_digest, staged_digest);
        assert_eq!(
            working_manifest.options["nativeGitDiffArgs"],
            json!(["--unified=2", "--", "new.txt"])
        );
        let revision = repo.index(&["HEAD", "--", "new.txt"]);
        let manifest = validate(&revision, ID, 15).unwrap().unwrap();
        assert_eq!(manifest.layers[0].kind, "revision");
        assert_eq!(
            manifest.identity.resolved_revisions,
            vec![manifest.identity.head.clone().unwrap()]
        );
    }

    #[test]
    fn a_changed_worktree_is_not_relabelled_as_a_current_capture() {
        let repo = Repo::new();
        fs::write(repo.0.path().join("new.txt"), "before\n").unwrap();
        let index = repo.index(&[]);
        fs::write(repo.0.path().join("new.txt"), "after\n").unwrap();
        assert_eq!(
            validate(&index, ID, 12).unwrap_err(),
            CaptureError::Inconsistent
        );
        fs::remove_dir_all(repo.0.path().join(".git")).unwrap();
        assert_eq!(
            validate(&index, ID, 12).unwrap_err(),
            CaptureError::Unavailable
        );
    }

    #[test]
    fn repository_prefix_settings_cannot_corrupt_binary_capture_paths() {
        let repo = Repo::new();
        let name = "café.bin";
        fs::write(repo.0.path().join(name), [0, 1, 2]).unwrap();
        repo.run(&["add", "."]);
        repo.run(&["commit", "-qm", "binary"]);
        repo.run(&["config", "diff.noprefix", "true"]);
        repo.run(&["config", "diff.mnemonicPrefix", "true"]);
        fs::write(repo.0.path().join(name), [0, 1, 3]).unwrap();
        let index = repo.index(&["--binary"]);
        assert_eq!(index.files[0].display_path(), std::path::Path::new(name));
        assert!(index.files[0].is_binary);
        let manifest = validate(&index, ID, 1).unwrap().unwrap();
        assert_eq!(manifest.layers[0].file_count, 1);
        assert_eq!(
            manifest.source_digest,
            digest(fs::read(index.spool_path).unwrap())
        );
    }

    #[test]
    fn option_shaped_pathspec_is_literal_after_the_separator() {
        let repo = Repo::new();
        for name in ["--no-color", "other.txt"] {
            fs::write(repo.0.path().join(name), "before\n").unwrap();
        }
        repo.run(&["add", "."]);
        repo.run(&["commit", "-qm", "paths"]);
        for name in ["--no-color", "other.txt"] {
            fs::write(repo.0.path().join(name), "after\n").unwrap();
        }
        let index = repo.index(&["--", "--no-color"]);
        assert_eq!(index.files.len(), 1);
        assert_eq!(
            index.files[0].display_path(),
            std::path::Path::new("--no-color")
        );
        let manifest = validate(&index, ID, 1).unwrap().unwrap();
        assert_eq!(
            manifest.options["nativeGitDiffArgs"],
            json!(["--", "--no-color"])
        );
        assert_eq!(manifest.layers[0].file_count, 1);
    }

    fn fixture_identity() -> InspectionIdentity {
        InspectionIdentity {
            repository_id: "a".repeat(64),
            workspace_id: "b".repeat(64),
            head: None,
            index_digest: "c".repeat(64),
            resolved_revisions: vec![],
        }
    }

    #[test]
    fn controlled_concurrent_mutation_retries_and_exhaustion_is_bounded() {
        let mut index = DiffIndex::empty(1, Default::default(), true);
        index.source_scope = Some(GitScope {
            root: "unused".into(),
            args: vec![],
        });
        let identities = Cell::new(0);
        let patches = Cell::new(0);
        let result = validate_with(
            &index,
            ID,
            1,
            "expected",
            || {
                let n = identities.get();
                identities.set(n + 1);
                let mut identity = fixture_identity();
                if n == 1 {
                    identity.index_digest = "d".repeat(64);
                }
                Ok(identity)
            },
            || {
                patches.set(patches.get() + 1);
                Ok("expected".into())
            },
        )
        .unwrap();
        assert_eq!(result.identity, fixture_identity());
        assert_eq!(identities.get(), 6);
        assert_eq!(patches.get(), 4);

        patches.set(0);
        let error = validate_with(
            &index,
            ID,
            1,
            "expected",
            || Ok(fixture_identity()),
            || {
                patches.set(patches.get() + 1);
                Ok(if patches.get() % 2 == 0 {
                    "expected"
                } else {
                    "changed"
                }
                .into())
            },
        )
        .unwrap_err();
        assert_eq!(error, CaptureError::Inconsistent);
        assert_eq!(patches.get(), 6);
    }

    #[test]
    fn unsupported_scope_is_rejected_before_spawning_git_or_writing_output() {
        let mut index = DiffIndex::empty(1, Default::default(), true);
        for arg in [
            "--output=should-not-exist",
            "--ext-diff",
            "--textconv",
            "--quiet",
            "--word-diff=plain",
            "--submodule=diff",
            "--cc",
            "--name-only",
            "--no-prefix",
            "--base",
        ] {
            index.source_scope = Some(GitScope {
                root: "missing repository".into(),
                args: vec![arg.into()],
            });
            assert_eq!(
                validate(&index, ID, 1).unwrap_err(),
                CaptureError::Unsupported,
                "{arg}"
            );
        }
        assert_eq!(
            revisions(&["HEAD".into(), "--".into(), "--output=literal-file".into()]).unwrap(),
            ["HEAD"]
        );
        for bytes in [
            b"diff --cc file\n".as_slice(),
            b"diff --combined file\n",
            b"* Unmerged path file\n",
            b"Submodule file\n",
        ] {
            assert_eq!(
                reject_unsupported_patch(bytes),
                Err(CaptureError::Unsupported)
            );
        }
        assert!(reject_unsupported_patch(b"+Submodule is source text\n").is_ok());
    }

    #[test]
    fn partial_sources_do_not_claim_optimistic_validation() {
        let mut index = DiffIndex::empty(1, Default::default(), false);
        index.source_scope = Some(GitScope {
            root: "missing repository".into(),
            args: vec![],
        });
        assert!(validate(&index, ID, 1).unwrap().is_none());
    }

    #[test]
    fn linked_worktree_has_same_repository_and_distinct_workspace() {
        let repo = Repo::new();
        repo.run(&["commit", "--allow-empty", "-qm", "base"]);
        let directory = tempfile::tempdir().unwrap();
        let linked = directory.path().join("linked");
        repo.run(&[
            "worktree",
            "add",
            "-q",
            "--detach",
            linked.to_str().unwrap(),
        ]);
        let deadline = Instant::now() + Duration::from_secs(30);
        let main = identity(
            &GitScope {
                root: repo.root().into(),
                args: vec![],
            },
            &[],
            deadline,
        )
        .unwrap();
        let other = identity(
            &GitScope {
                root: linked.to_str().unwrap().into(),
                args: vec![],
            },
            &[],
            deadline,
        )
        .unwrap();
        assert_eq!(main.repository_id, other.repository_id);
        assert_ne!(main.workspace_id, other.workspace_id);
        assert_eq!(main.head, other.head);
    }

    #[test]
    fn git_probe_output_and_deadline_are_bounded() {
        let repo = Repo::new();
        let command = || command(repo.root(), ["rev-parse", "--absolute-git-dir"]);
        assert_eq!(
            output(
                command(),
                false,
                1,
                Instant::now() + Duration::from_secs(30)
            )
            .unwrap_err(),
            CaptureError::TooLarge
        );
        assert_eq!(
            output(command(), false, MAX_BYTES, Instant::now()).unwrap_err(),
            CaptureError::Unavailable
        );
    }
}
