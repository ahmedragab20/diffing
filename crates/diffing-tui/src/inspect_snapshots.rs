//! Retained native indexes own their spool bytes independently of live refresh.
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use diffing_core::index::DiffIndex;
use diffing_core::inspect_capture::{self, CaptureError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_BYTES: u64 = 64 * 1024 * 1024;
const TTL_MS: u64 = 5 * 60 * 1000;

#[derive(Debug)]
pub struct InspectError(pub u16, pub &'static str);
type Result<T> = std::result::Result<T, InspectError>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Continuation {
    version: u8,
    owner: String,
    snapshot: String,
    operation: String,
    query: BTreeMap<String, String>,
}

pub struct Capture {
    pub id: String,
    pub index: Arc<DiffIndex>,
    pub expires_at: u64,
    pub anchors: Vec<Value>,
    bytes: u64,
    owns_spool: bool,
}

impl Capture {
    pub fn anchor(&self, file: usize, side: &str, start: u32, end: u32) -> Result<Value> {
        let invalid = || InspectError(400, "invalid_anchor");
        if !matches!(side, "additions" | "deletions")
            || start > end
            || end.saturating_sub(start) > 1000
            || (end > 0 && start == 0)
        {
            return Err(invalid());
        }
        let mut anchor = self.anchors.get(file).cloned().ok_or_else(invalid)?;
        if end > 0 {
            // These coordinates come from the validated Git patch, not live
            // file contents. Require every requested line, including context,
            // to occur on the selected side of a captured hunk.
            let indexed = &self.index.files[file];
            for line in start..=end {
                if !indexed.hunks.iter().any(|hunk| {
                    let (first, count) = if side == "deletions" {
                        (hunk.old_start, hunk.old_lines)
                    } else {
                        (hunk.new_start, hunk.new_lines)
                    };
                    u64::from(line) >= u64::from(first)
                        && u64::from(line) < u64::from(first) + u64::from(count)
                }) {
                    return Err(invalid());
                }
            }
        }
        anchor["range"] = json!({ "side": side, "start": start, "end": end });
        Ok(anchor)
    }
}

/// Match the shared raw-section digest: preserve all bytes except trailing LF
/// separators. Hash incrementally so a capture need not duplicate its patch.
fn file_digests(index: &DiffIndex) -> Result<Vec<String>> {
    if index.patch_bytes == 0 {
        return Ok(Vec::new());
    }
    let source =
        File::open(&index.spool_path).map_err(|_| InspectError(503, "source_unavailable"))?;
    let mut input = BufReader::new(source.take(index.patch_bytes));
    let mut line = Vec::new();
    let mut hasher: Option<Sha256> = None;
    let mut pending_lf = 0usize;
    let mut result = Vec::new();
    loop {
        line.clear();
        if input
            .read_until(b'\n', &mut line)
            .map_err(|_| InspectError(503, "source_unavailable"))?
            == 0
        {
            break;
        }
        if line.starts_with(b"diff --git ") {
            if let Some(previous) = hasher.take() {
                result.push(format!("{:x}", previous.finalize()));
            }
            hasher = Some(Sha256::new());
            pending_lf = 0;
        }
        if let Some(hasher) = hasher.as_mut() {
            let end = line
                .iter()
                .rposition(|byte| *byte != b'\n')
                .map_or(0, |position| position + 1);
            if end > 0 {
                let newlines = [b'\n'; 1024];
                while pending_lf > 0 {
                    let count = pending_lf.min(newlines.len());
                    hasher.update(&newlines[..count]);
                    pending_lf -= count;
                }
                hasher.update(&line[..end]);
            }
            pending_lf += line.len() - end;
        }
    }
    if let Some(hasher) = hasher {
        result.push(format!("{:x}", hasher.finalize()));
    }
    if result.len() != index.files.len() {
        return Err(InspectError(422, "unsupported_capture"));
    }
    Ok(result)
}

fn source_anchors(index: &DiffIndex, budget: u64) -> Result<Vec<Value>> {
    let Some(manifest) = &index.manifest else {
        return Ok(Vec::new());
    };
    if !index.complete || !manifest.complete {
        return Ok(Vec::new());
    }
    let digests = file_digests(index)?;
    let mut occurrences = HashMap::new();
    let mut anchors = Vec::with_capacity(index.files.len());
    let mut bytes = 2u64; // JSON array delimiters, with commas added below.
    for (position, (file, digest)) in index.files.iter().zip(digests).enumerate() {
        let (ordinal, layer) = manifest
            .layers
            .iter()
            .enumerate()
            .find(|(_, layer)| {
                position >= layer.first_file && position < layer.first_file + layer.file_count
            })
            .ok_or(InspectError(422, "unsupported_capture"))?;
        let occurrence = occurrences
            .entry((ordinal, file.old_path.clone(), file.new_path.clone()))
            .or_insert(0usize);
        let path = |path: &std::path::PathBuf| {
            path.to_str()
                .filter(|path| path.encode_utf16().count() <= 4096)
                .map(str::to_owned)
                .ok_or(InspectError(422, "unsupported_capture"))
        };
        let old_path = file.old_path.as_ref().map(path).transpose()?;
        let new_path = file.new_path.as_ref().map(path).transpose()?;
        let anchor = json!({
            "version": 1, "snapshotId": manifest.snapshot_id,
            "repositoryId": manifest.identity.repository_id, "workspaceId": manifest.identity.workspace_id,
            "scopeDigest": manifest.scope_digest, "head": manifest.identity.head,
            "resolvedRevisions": manifest.identity.resolved_revisions,
            "layer": { "id": layer.id, "kind": layer.kind, "ordinal": ordinal },
            "file": { "oldPath": old_path, "newPath": new_path, "occurrence": *occurrence, "contentDigest": digest },
        });
        bytes += serde_json::to_vec(&anchor)
            .map_err(|_| InspectError(503, "source_unavailable"))?
            .len() as u64
            + u64::from(!anchors.is_empty());
        if bytes > budget {
            return Err(InspectError(413, "snapshot_too_large"));
        }
        anchors.push(anchor);
        *occurrence += 1;
    }
    Ok(anchors)
}

impl Drop for Capture {
    fn drop(&mut self) {
        if self.owns_spool {
            let _ = std::fs::remove_file(&self.index.spool_path);
        }
    }
}

pub struct InspectSnapshots {
    owner: String,
    key: [u8; 32],
    captures: VecDeque<Arc<Capture>>,
}

fn random_id() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| InspectError(503, "source_unavailable"))?;
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let hex = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

// HMAC-SHA256 (RFC 2104), using the already bundled SHA-256 implementation.
fn mac(key: &[u8; 32], payload: &[u8]) -> Vec<u8> {
    let mut inner = [0x36; 64];
    let mut outer = [0x5c; 64];
    for i in 0..32 {
        inner[i] ^= key[i];
        outer[i] ^= key[i];
    }
    let mut digest = Sha256::new();
    digest.update(inner);
    digest.update(payload);
    let hash = digest.finalize();
    let mut digest = Sha256::new();
    digest.update(outer);
    digest.update(hash);
    digest.finalize().to_vec()
}

impl InspectSnapshots {
    pub fn new() -> Result<Self> {
        let mut key = [0; 32];
        getrandom::getrandom(&mut key).map_err(|_| InspectError(503, "source_unavailable"))?;
        Ok(Self {
            owner: random_id()?,
            key,
            captures: VecDeque::new(),
        })
    }

    pub fn prepare(index: &Arc<DiffIndex>, now: u64) -> Result<Capture> {
        let metadata = serde_json::to_vec(index.as_ref())
            .map_err(|_| InspectError(503, "source_unavailable"))?;
        let bytes = metadata.len() as u64 + index.patch_bytes;
        if bytes > MAX_BYTES {
            return Err(InspectError(413, "snapshot_too_large"));
        }
        let id = random_id()?;
        let mut retained = index.as_ref().clone();
        if index.patch_bytes > 0 {
            // The sparse index references a flushed prefix. A live partial spool
            // may still grow; copying precisely that prefix retains its meaning.
            let source = File::open(&index.spool_path)
                .map_err(|_| InspectError(503, "source_unavailable"))?;
            let path = std::env::temp_dir().join(format!("diffing-inspect-{id}"));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut output = options
                .open(&path)
                .map_err(|_| InspectError(503, "source_unavailable"))?;
            let copied = std::io::copy(&mut source.take(index.patch_bytes), &mut output);
            if !matches!(copied, Ok(count) if count == index.patch_bytes) || output.flush().is_err()
            {
                drop(output);
                let _ = std::fs::remove_file(path);
                return Err(InspectError(503, "source_unavailable"));
            }
            retained.spool_path = path;
        }
        // Own the private spool before validation so every error path removes
        // it. Validation reads this exact copy, never a live spool that cleanup
        // or a concurrent refresh can remove underneath us.
        let mut capture = Capture {
            id,
            index: Arc::new(retained),
            expires_at: now.saturating_add(TTL_MS),
            anchors: Vec::new(),
            bytes,
            owns_spool: index.patch_bytes > 0,
        };
        let manifest = inspect_capture::validate(&capture.index, &capture.id, now).map_err(
            |error| match error {
                CaptureError::Unavailable => InspectError(503, "source_unavailable"),
                CaptureError::Inconsistent => InspectError(409, "inconsistent_capture"),
                CaptureError::Unsupported => InspectError(422, "unsupported_capture"),
                CaptureError::TooLarge => InspectError(413, "snapshot_too_large"),
            },
        )?;
        Arc::make_mut(&mut capture.index).manifest = manifest;
        capture.bytes = serde_json::to_vec(capture.index.as_ref())
            .map_err(|_| InspectError(503, "source_unavailable"))?
            .len() as u64
            + index.patch_bytes;
        capture.anchors = source_anchors(&capture.index, MAX_BYTES.saturating_sub(capture.bytes))?;
        capture.bytes += serde_json::to_vec(&capture.anchors)
            .map_err(|_| InspectError(503, "source_unavailable"))?
            .len() as u64;
        if capture.bytes > MAX_BYTES {
            return Err(InspectError(413, "snapshot_too_large"));
        }
        Ok(capture)
    }

    pub fn retain(&mut self, capture: Capture, now: u64) -> Arc<Capture> {
        self.prune(now);
        while self.captures.len() >= 8
            || self.captures.iter().map(|c| c.bytes).sum::<u64>() + capture.bytes > MAX_BYTES
        {
            self.captures.pop_front();
        }
        let capture = Arc::new(capture);
        self.captures.push_back(capture.clone());
        capture
    }

    #[cfg(test)]
    fn capture(&mut self, index: &Arc<DiffIndex>, now: u64) -> Result<Arc<Capture>> {
        Ok(self.retain(Self::prepare(index, now)?, now))
    }

    fn prune(&mut self, now: u64) {
        self.captures.retain(|capture| capture.expires_at > now);
    }

    pub fn get(&mut self, id: &str, now: u64) -> Result<Arc<Capture>> {
        self.prune(now);
        self.captures
            .iter()
            .find(|capture| capture.id == id)
            .cloned()
            .ok_or(InspectError(410, "snapshot_expired"))
    }

    pub fn encode(
        &self,
        capture: &Capture,
        operation: &str,
        query: BTreeMap<String, String>,
    ) -> String {
        let value = Continuation {
            version: 1,
            owner: self.owner.clone(),
            snapshot: capture.id.clone(),
            operation: operation.to_owned(),
            query,
        };
        let payload =
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&value).expect("serializing continuation"));
        format!(
            "{payload}.{}",
            URL_SAFE_NO_PAD.encode(mac(&self.key, payload.as_bytes()))
        )
    }

    pub fn resume(
        &mut self,
        token: &str,
        operation: &str,
        now: u64,
    ) -> Result<(Arc<Capture>, BTreeMap<String, String>)> {
        let invalid = || InspectError(400, "invalid_continuation");
        if token.len() > 16 * 1024 {
            return Err(invalid());
        }
        let (payload, signature) = token.split_once('.').ok_or_else(invalid)?;
        let bytes = URL_SAFE_NO_PAD.decode(payload).map_err(|_| invalid())?;
        let value: Continuation = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        if value.version != 1 {
            return Err(invalid());
        }
        if value.owner != self.owner {
            return Err(InspectError(410, "snapshot_expired"));
        }
        let signature = URL_SAFE_NO_PAD.decode(signature).map_err(|_| invalid())?;
        let expected = mac(&self.key, payload.as_bytes());
        if signature.len() != expected.len()
            || signature
                .iter()
                .zip(&expected)
                .fold(0u8, |difference, (a, b)| difference | (a ^ b))
                != 0
            || value.operation != operation
        {
            return Err(invalid());
        }
        Ok((self.get(&value.snapshot, now)?, value.query))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_section_digests_and_anchors_preserve_occurrences_and_side_ranges() {
        let directory = tempfile::tempdir().unwrap();
        let first = "diff --git a/é.txt b/é.txt\n--- a/é.txt\n+++ b/é.txt\n@@ -1,2 +1,2 @@\n context\r\n-old\r\n+new\r\n@@ -9 +9 @@\n-last\n+next";
        let second = "diff --git a/é.txt b/é.txt\nold mode 100644\nnew mode 100755";
        let patch = format!("{first}\n\n{second}\n\n");
        let mut index = diffing_core::index::build_index_from_reader(
            std::io::Cursor::new(patch),
            &directory.path().join("patch"),
            1,
            |_| {},
        )
        .unwrap();
        assert_eq!(
            file_digests(&index).unwrap(),
            [first, second].map(|section| format!("{:x}", Sha256::digest(section.as_bytes())))
        );
        // A raw/partial renderer index never receives a validated source anchor.
        assert!(source_anchors(&index, MAX_BYTES).unwrap().is_empty());
        let sha = "a".repeat(64);
        index.manifest = Some(serde_json::from_value(json!({
            "version": 1, "snapshotId": "f0e355e3-e8a2-4934-a179-3b8f07593cad",
            "repositoryId": sha, "workspaceId": sha, "head": null,
            "indexDigest": sha, "resolvedRevisions": [], "scopeDigest": sha,
            "sourceDigest": sha, "capturedAt": 0, "consistency": "optimistic-validated",
            "complete": true, "options": {},
            "layers": [{"id": sha, "kind": "working", "sourceDigest": sha, "firstFile": 0, "fileCount": 2}],
        })).unwrap());
        assert!(source_anchors(&index, MAX_BYTES).unwrap().is_empty());
        index.complete = true;
        let anchors = source_anchors(&index, MAX_BYTES).unwrap();
        let required = serde_json::to_vec(&anchors).unwrap().len() as u64;
        assert_eq!(source_anchors(&index, required).unwrap(), anchors);
        assert!(matches!(
            source_anchors(&index, required - 1),
            Err(InspectError(413, "snapshot_too_large"))
        ));
        assert_eq!(anchors[0]["file"]["occurrence"], 0);
        assert_eq!(anchors[1]["file"]["occurrence"], 1);
        assert_ne!(
            anchors[0]["file"]["contentDigest"],
            anchors[1]["file"]["contentDigest"]
        );
        let capture = Capture {
            id: "test".into(),
            index: Arc::new(index),
            anchors,
            expires_at: 100,
            bytes: 0,
            owns_spool: false,
        };
        assert!(capture.anchor(0, "deletions", 1, 2).is_ok()); // Includes context.
        assert!(capture.anchor(0, "additions", 1, 2).is_ok());
        assert!(capture.anchor(1, "additions", 0, 0).is_ok()); // Mode-only file.
        for (file, side, start, end) in [
            (0, "additions", 2, 9),
            (0, "additions", 0, 1),
            (0, "additions", 9, 2),
            (0, "other", 1, 1),
            (1, "additions", 1, 1),
            (2, "additions", 0, 0),
            (0, "additions", 1, 1002),
        ] {
            assert!(matches!(
                capture.anchor(file, side, start, end),
                Err(InspectError(400, "invalid_anchor"))
            ));
        }
    }

    #[test]
    fn hmac_matches_rfc_4231_vector() {
        let mut key = [0; 32];
        key[..20].fill(0x0b);
        assert_eq!(
            mac(&key, b"Hi There")
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }
    #[test]
    fn retention_expires_evicts_and_binds_operation_and_session() {
        let mut cache = InspectSnapshots::new().unwrap();
        let index = Arc::new(DiffIndex::empty(1, "unused".into(), true));
        let first = cache.capture(&index, 0).unwrap();
        let token = cache.encode(
            &first,
            "files",
            BTreeMap::from([("cursor".into(), "1".into())]),
        );
        assert_eq!(cache.resume(&token, "files", 1).unwrap().1["cursor"], "1");
        assert!(matches!(
            cache.resume(&token, "hunks", 1),
            Err(InspectError(400, "invalid_continuation"))
        ));
        assert!(matches!(
            InspectSnapshots::new().unwrap().resume(&token, "files", 1),
            Err(InspectError(410, "snapshot_expired"))
        ));
        for _ in 0..8 {
            cache.capture(&index, 1).unwrap();
        }
        assert!(matches!(
            cache.get(&first.id, 1),
            Err(InspectError(410, "snapshot_expired"))
        ));
        let last = cache.capture(&index, 2).unwrap();
        assert!(cache.get(&last.id, 2 + TTL_MS - 1).is_ok());
        assert!(matches!(
            cache.get(&last.id, 2 + TTL_MS),
            Err(InspectError(410, "snapshot_expired"))
        ));
    }

    #[test]
    fn authenticated_unknown_protocol_versions_are_rejected() {
        let mut cache = InspectSnapshots::new().unwrap();
        let index = Arc::new(DiffIndex::empty(1, "unused".into(), true));
        let capture = cache.capture(&index, 0).unwrap();
        let token = cache.encode(&capture, "files", BTreeMap::new());
        let (payload, _) = token.split_once('.').unwrap();
        let mut value: Continuation =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
        for version in [0, 2] {
            value.version = version;
            let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&value).unwrap());
            // A valid signature isolates protocol validation from tamper rejection.
            let token = format!(
                "{payload}.{}",
                URL_SAFE_NO_PAD.encode(mac(&cache.key, payload.as_bytes()))
            );
            assert!(matches!(
                cache.resume(&token, "files", 1),
                Err(InspectError(400, "invalid_continuation"))
            ));
        }
    }

    #[test]
    fn copied_spools_are_independent_and_removed_after_last_reader() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("live");
        std::fs::write(&source, b"kept-appended-later").unwrap();
        let mut index = DiffIndex::empty(1, source.clone(), false);
        index.patch_bytes = 4;
        let mut cache = InspectSnapshots::new().unwrap();
        let capture = cache.capture(&Arc::new(index), 0).unwrap();
        let retained = capture.index.spool_path.clone();
        std::fs::remove_file(source).unwrap();
        assert_eq!(std::fs::read(&retained).unwrap(), b"kept");
        drop(cache);
        assert!(retained.exists());
        drop(capture);
        assert!(!retained.exists());
    }

    #[test]
    fn tokens_cannot_be_tampered_with_and_oversized_captures_fail_before_io() {
        let mut cache = InspectSnapshots::new().unwrap();
        let mut index = DiffIndex::empty(1, "missing".into(), true);
        index.patch_bytes = MAX_BYTES;
        assert!(matches!(
            cache.capture(&Arc::new(index), 0),
            Err(InspectError(413, "snapshot_too_large"))
        ));
        let capture = cache
            .capture(&Arc::new(DiffIndex::empty(2, "unused".into(), true)), 0)
            .unwrap();
        let token = cache.encode(&capture, "files", BTreeMap::new());
        let (payload, signature) = token.split_once('.').unwrap();
        let mut value: Continuation =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
        value.query.insert("path".into(), "changed".into());
        let changed = format!(
            "{}.{signature}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&value).unwrap())
        );
        assert!(matches!(
            cache.resume(&changed, "files", 1),
            Err(InspectError(400, "invalid_continuation"))
        ));
    }
}
