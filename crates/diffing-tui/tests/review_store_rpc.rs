//! Process-level coverage for the private SQLite review-store protocol.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;

const REQUEST_HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_HASH: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CHECKSUM: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const OTHER_CHECKSUM: &str = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const WRONG_PREVIOUS: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

fn record(result: &str, checksum: &str) -> Value {
    json!({
        "version": 1,
        "sequence": 1,
        "previous": null,
        "key": "request",
        "requestHash": REQUEST_HASH,
        "events": [{"type": "sample", "data": {"body": "kept"}}],
        "result": {"id": result},
        "checksum": checksum,
    })
}

fn request(id: u64, op: Value) -> String {
    format!("{}\n", json!({"id": id, "op": op}))
}

struct RpcChild {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Option<String>>,
}

impl RpcChild {
    fn spawn(directory: &std::path::Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_diffing-tui"))
            .arg("--review-store-rpc")
            .arg(directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn diffing-tui review-store RPC");
        let stdout = child.stdout.take().expect("child stdout");
        let stdin = child.stdin.take().expect("child stdin");
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if tx.send(Some(line.expect("RPC stdout is UTF-8"))).is_err() {
                    return;
                }
            }
            let _ = tx.send(None);
        });
        Self {
            child,
            stdin,
            lines: rx,
        }
    }

    fn start(directory: &std::path::Path, expected_version: u64) -> Self {
        let rpc = Self::spawn(directory);
        let startup = rpc.read_line();
        assert_eq!(startup["protocol"], 1);
        assert_eq!(startup["ok"], true, "startup failed: {startup}");
        assert_eq!(startup["version"], expected_version);
        assert!(startup["sqliteVersion"].is_string());
        rpc
    }

    fn start_expect_error(directory: &std::path::Path, code: &str) {
        let mut rpc = Self::spawn(directory);
        let startup = rpc.read_line();
        assert_eq!(startup["protocol"], 1);
        assert_eq!(startup["ok"], false);
        assert_eq!(startup["error"]["code"], code);
        let status = rpc.child.wait().expect("wait startup-error child");
        assert!(
            !status.success(),
            "owner-busy child must exit unsuccessfully"
        );
    }

    fn read_line(&self) -> Value {
        let line = self
            .lines
            .recv_timeout(Duration::from_secs(3))
            .expect("bounded RPC stdout timeout")
            .expect("RPC child closed stdout");
        serde_json::from_str(&line).expect("RPC JSON line")
    }

    fn send(&mut self, id: u64, op: Value) -> Value {
        self.stdin
            .write_all(request(id, op).as_bytes())
            .expect("write RPC request");
        self.stdin.flush().expect("flush RPC request");
        self.read_line()
    }
}

impl Drop for RpcChild {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn append_op(record: Value) -> Value {
    json!({"kind": "append", "record": record})
}

fn read_op(after: u64, limit: u64) -> Value {
    json!({"kind": "read", "after": after, "limit": limit})
}

fn assert_ok(reply: &Value, id: u64) {
    assert_eq!(reply["protocol"], 1);
    assert_eq!(reply["id"], id);
    assert_eq!(reply["ok"], true, "expected success: {reply}");
}

fn assert_error(reply: &Value, id: u64, code: &str) {
    assert_eq!(reply["protocol"], 1);
    assert_eq!(reply["id"], id);
    assert_eq!(reply["ok"], false, "expected error: {reply}");
    assert_eq!(reply["error"]["code"], code);
}

#[test]
fn append_read_restart_and_idempotent_retry_preserve_original() {
    let directory = TempDir::new().expect("review store directory");
    let original = record("kept", CHECKSUM);
    let mut rpc = RpcChild::start(directory.path(), 0);

    let appended = rpc.send(1, append_op(original.clone()));
    assert_ok(&appended, 1);
    assert_eq!(appended["result"], original);
    let read = rpc.send(2, read_op(0, 100));
    assert_ok(&read, 2);
    assert_eq!(read["result"]["records"], json!([original.clone()]));
    assert_eq!(read["result"]["latest"], 1);
    assert!(read["result"]["next"].is_null());
    drop(rpc);

    let mut restarted = RpcChild::start(directory.path(), 1);
    let retry = restarted.send(3, append_op(record("changed", OTHER_CHECKSUM)));
    assert_ok(&retry, 3);
    assert_eq!(retry["result"], original);
    let conflict = restarted.send(
        4,
        append_op(json!({
            "version": 1, "sequence": 1, "previous": null, "key": "request",
            "requestHash": OTHER_HASH, "events": [], "result": {"id": "changed"},
            "checksum": OTHER_CHECKSUM,
        })),
    );
    assert_error(&conflict, 4, "idempotency_conflict");
    let sequence = restarted.send(
        5,
        append_op(json!({
            "version": 1, "sequence": 3, "previous": WRONG_PREVIOUS, "key": "other",
            "requestHash": OTHER_HASH, "events": [], "result": {"id": "other"},
            "checksum": OTHER_CHECKSUM,
        })),
    );
    assert_error(&sequence, 5, "version_conflict");
}

#[test]
fn missing_or_truncated_initialized_database_is_never_recreated() {
    for truncate in [false, true] {
        let directory = TempDir::new().unwrap();
        let mut rpc = RpcChild::start(directory.path(), 0);
        assert_ok(&rpc.send(1, append_op(record("kept", CHECKSUM))), 1);
        drop(rpc);
        let path = directory.path().join("review.sqlite");
        if truncate {
            std::fs::write(&path, []).unwrap();
        } else {
            std::fs::remove_file(&path).unwrap();
        }
        RpcChild::start_expect_error(directory.path(), "missing_store");
        if truncate {
            assert_eq!(std::fs::metadata(path).unwrap().len(), 0);
        } else {
            assert!(!path.exists());
        }
    }
}

#[test]
fn ownership_is_exclusive_and_acknowledged_records_survive_kill() {
    let directory = TempDir::new().expect("review store directory");
    let mut first = RpcChild::start(directory.path(), 0);
    let original = record("kept", CHECKSUM);
    let appended = first.send(1, append_op(original.clone()));
    assert_ok(&appended, 1);
    assert_eq!(appended["result"], original);
    RpcChild::start_expect_error(directory.path(), "owner_busy");
    let independent = TempDir::new().expect("independent review store directory");
    let _second_directory = RpcChild::start(independent.path(), 0);
    drop(first);

    let mut reopened = RpcChild::start(directory.path(), 1);
    let read = reopened.send(2, read_op(0, 100));
    assert_ok(&read, 2);
    assert_eq!(read["result"]["records"], json!([original]));
}

#[test]
fn compact_backup_can_be_reopened_as_review_sqlite() {
    let directory = TempDir::new().expect("review store directory");
    let original = record("kept", CHECKSUM);
    let mut rpc = RpcChild::start(directory.path(), 0);
    assert_ok(&rpc.send(1, append_op(original.clone())), 1);
    let compacted = rpc.send(2, json!({"kind": "compact"}));
    assert_ok(&compacted, 2);
    RpcChild::start_expect_error(directory.path(), "owner_busy");
    let backup_name = compacted["result"]["backup"]
        .as_str()
        .expect("compact backup basename");
    assert_eq!(
        std::path::Path::new(backup_name)
            .file_name()
            .and_then(|n| n.to_str()),
        Some(backup_name)
    );
    let backup = directory.path().join(backup_name);
    assert!(
        backup.is_file(),
        "compact backup should exist: {}",
        backup.display()
    );
    drop(rpc);

    let restored = TempDir::new().expect("restored review store directory");
    std::fs::copy(&backup, restored.path().join("review.sqlite")).expect("copy compact backup");
    let mut reopened = RpcChild::start(restored.path(), 1);
    let read = reopened.send(3, read_op(0, 100));
    assert_ok(&read, 3);
    assert_eq!(read["result"]["records"], json!([original]));
}

#[test]
fn unknown_operations_and_extra_fields_are_rejected_without_writes() {
    let directory = TempDir::new().expect("review store directory");
    let mut rpc = RpcChild::start(directory.path(), 0);
    let unknown = rpc.send(1, json!({"kind": "unknown"}));
    assert_error(&unknown, 1, "invalid_request");
    let extra = rpc.send(
        2,
        json!({"kind": "read", "after": 0, "limit": 100, "extra": true}),
    );
    assert_error(&extra, 2, "invalid_request");
    let read = rpc.send(3, read_op(0, 100));
    assert_ok(&read, 3);
    assert_eq!(read["result"]["records"], json!([]));
    assert_eq!(read["result"]["latest"], 0);
    assert!(read["result"]["next"].is_null());
}

#[cfg(unix)]
#[test]
fn paused_owner_is_not_replaced() {
    let directory = TempDir::new().expect("review directory");
    let owner = RpcChild::start(directory.path(), 0);
    // Ownership is established before pausing; it must never depend on a lease.
    assert_eq!(
        unsafe { libc::kill(owner.child.id() as i32, libc::SIGSTOP) },
        0
    );
    RpcChild::start_expect_error(directory.path(), "owner_busy");
    drop(owner);
    let _replacement = RpcChild::start(directory.path(), 0);
}
