//! Private, directory-bound review storage. No SQL or paths come from RPC input.
//! SQLite owns cross-process exclusion and crash recovery; the connection keeps
//! its exclusive lock between transactions, including while TS computes effects.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const RECORD_BYTES: usize = 256 * 1024;
const FRAME_BYTES: usize = 512 * 1024;
const STORE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RECORDS: u64 = 50_000;
const APPLICATION_ID: i64 = 0x44465256;
type StoreResult<T> = Result<T, &'static str>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Event {
    r#type: String,
    data: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u64,
    sequence: u64,
    previous: Option<String>,
    key: String,
    request_hash: String,
    events: Vec<Event>,
    result: Value,
    checksum: String,
}

fn digest(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn record(value: &Value) -> StoreResult<Record> {
    let record: Record = serde_json::from_value(value.clone()).map_err(|_| "invalid_request")?;
    if record.version != 1 {
        return Err("unsupported_version");
    }
    if record.sequence == 0
        || record.sequence > MAX_RECORDS
        || record.key.is_empty()
        || record.key.chars().count() > 200
        || !is_digest(&record.request_hash)
        || !is_digest(&record.checksum)
        || record.previous.as_deref().is_some_and(|p| !is_digest(p))
        || record.events.len() > 100
        || record
            .events
            .iter()
            .any(|e| e.r#type.is_empty() || e.r#type.chars().count() > 100)
    {
        return Err("invalid_request");
    }
    // JSON payloads are opaque to storage; semantic validation belongs to ReviewCore.
    let _ = (&record.result, record.events.iter().map(|e| &e.data));
    Ok(record)
}

fn sql_error(error: rusqlite::Error) -> &'static str {
    match error.sqlite_error_code() {
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => {
            "owner_busy"
        }
        Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase) => {
            "corrupt_store"
        }
        Some(rusqlite::ErrorCode::DiskFull) => "store_limit",
        _ => "io_error",
    }
}

fn configure(connection: &Connection) -> StoreResult<()> {
    connection.busy_timeout(Duration::ZERO).map_err(sql_error)?;
    connection.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA; PRAGMA fullfsync=ON; PRAGMA temp_store=MEMORY;").map_err(sql_error)?;
    Ok(())
}

struct Store {
    connection: Connection,
    directory: PathBuf,
    version: u64,
    bytes: u64,
    previous: Option<String>,
    poisoned: bool,
}

impl Store {
    fn open(directory: &Path) -> StoreResult<Self> {
        let mut directories = std::fs::DirBuilder::new();
        directories.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directories.mode(0o700);
        }
        directories.create(directory).map_err(|_| "io_error")?;
        let directory = std::fs::canonicalize(directory).map_err(|_| "io_error")?;
        // Refuse implicit conversion from the earlier experimental journal.
        if directory.join("review.jsonl").exists() || directory.join("store.json").exists() {
            return Err("migration_required");
        }
        for name in [
            "review.sqlite",
            "review.sqlite-journal",
            "review.sqlite-wal",
            "review.sqlite-shm",
        ] {
            match std::fs::symlink_metadata(directory.join(name)) {
                Ok(meta) if !meta.file_type().is_file() => return Err("invalid_request"),
                Ok(meta) if meta.len() > 128 * 1024 * 1024 => return Err("store_limit"),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("io_error"),
            }
        }
        let path = directory.join("review.sqlite");
        let empty = std::fs::metadata(&path)
            .map(|m| m.len() == 0)
            .unwrap_or(true);
        let connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(sql_error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "io_error")?;
        }
        configure(&connection)?;
        connection
            .execute_batch("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;")
            .map_err(sql_error)?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(sql_error)?;
        let app: i64 = connection
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .map_err(sql_error)?;
        if version > 1 {
            return Err("unsupported_version");
        }
        if version == 0 && empty {
            let objects: i64 = connection
                .query_row("SELECT count(*) FROM sqlite_schema", [], |r| r.get(0))
                .map_err(sql_error)?;
            if app != 0 || objects != 0 {
                return Err("corrupt_store");
            }
            connection.execute_batch(&format!("CREATE TABLE transactions(sequence INTEGER PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, record TEXT NOT NULL, record_sha256 TEXT NOT NULL); PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version=1;")).map_err(sql_error)?;
        } else if version != 1 || app != APPLICATION_ID {
            return Err("corrupt_store");
        }
        let mode: String = connection
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .map_err(sql_error)?;
        if mode != "delete" {
            return Err("unsupported_version");
        }
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(sql_error)?;
        if integrity != "ok" {
            return Err("corrupt_store");
        }
        let mut store = Self {
            connection,
            directory,
            version: 0,
            bytes: 0,
            previous: None,
            poisoned: false,
        };
        {
            let mut statement = store.connection.prepare("SELECT sequence, request_key, request_hash, record, record_sha256 FROM transactions ORDER BY sequence").map_err(|_| "corrupt_store")?;
            let mut rows = statement.query([]).map_err(sql_error)?;
            while let Some(row) = rows.next().map_err(sql_error)? {
                let raw: String = row.get(3).map_err(|_| "corrupt_store")?;
                let checksum: String = row.get(4).map_err(|_| "corrupt_store")?;
                if raw.len() + 1 > RECORD_BYTES {
                    return Err("store_limit");
                }
                let value = serde_json::from_str(&raw).map_err(|_| "corrupt_store")?;
                let parsed = record(&value).map_err(|e| {
                    if e == "unsupported_version" {
                        e
                    } else {
                        "corrupt_store"
                    }
                })?;
                if checksum != digest(raw.as_bytes())
                    || parsed.sequence != store.version + 1
                    || parsed.previous != store.previous
                    || row.get::<_, i64>(0).map_err(|_| "corrupt_store")? != parsed.sequence as i64
                    || row.get::<_, String>(1).map_err(|_| "corrupt_store")? != parsed.key
                    || row.get::<_, String>(2).map_err(|_| "corrupt_store")? != parsed.request_hash
                {
                    return Err("corrupt_store");
                }
                store.version += 1;
                store.bytes += raw.len() as u64 + 1;
                store.previous = Some(parsed.checksum);
                if store.version > MAX_RECORDS || store.bytes > STORE_BYTES {
                    return Err("store_limit");
                }
            }
        }
        store
            .connection
            .execute_batch("COMMIT; PRAGMA max_page_count=32768;")
            .map_err(sql_error)?;
        Ok(store)
    }

    fn append(&mut self, value: Value) -> StoreResult<Value> {
        self.append_with(value, || {}, || {})
    }

    fn append_with(
        &mut self,
        value: Value,
        before_commit: impl FnOnce(),
        after_commit: impl FnOnce(),
    ) -> StoreResult<Value> {
        if self.poisoned {
            return Err("outcome_unknown");
        }
        let parsed = record(&value)?;
        let raw = serde_json::to_string(&value).map_err(|_| "invalid_request")?;
        if raw.len() + 1 > RECORD_BYTES {
            return Err("store_limit");
        }
        let existing: Option<(String, String)> = self
            .connection
            .query_row(
                "SELECT request_hash, record FROM transactions WHERE request_key=?1",
                [&parsed.key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(sql_error)?;
        if let Some((request_hash, record)) = existing {
            if request_hash != parsed.request_hash {
                return Err("idempotency_conflict");
            }
            return serde_json::from_str(&record).map_err(|_| "corrupt_store");
        }
        if parsed.sequence != self.version + 1 || parsed.previous != self.previous {
            return Err("version_conflict");
        }
        if self.version >= MAX_RECORDS || self.bytes + raw.len() as u64 + 1 > STORE_BYTES {
            return Err("store_limit");
        }
        self.poisoned = true;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| "outcome_unknown")?;
        transaction
            .execute(
                "INSERT INTO transactions VALUES (?1,?2,?3,?4,?5)",
                params![
                    parsed.sequence as i64,
                    parsed.key,
                    parsed.request_hash,
                    raw,
                    digest(raw.as_bytes())
                ],
            )
            .map_err(|_| "outcome_unknown")?;
        before_commit();
        transaction.commit().map_err(|_| "outcome_unknown")?;
        after_commit();
        self.version += 1;
        self.bytes += raw.len() as u64 + 1;
        self.previous = Some(parsed.checksum);
        self.poisoned = false;
        Ok(value)
    }

    fn read(&self, after: u64, limit: u64) -> StoreResult<Value> {
        if self.poisoned {
            return Err("outcome_unknown");
        }
        if after > self.version || !(1..=1000).contains(&limit) {
            return Err("invalid_request");
        }
        let mut statement = self
            .connection
            .prepare("SELECT record FROM transactions WHERE sequence>?1 ORDER BY sequence LIMIT ?2")
            .map_err(sql_error)?;
        let mut rows = statement
            .query(params![after as i64, limit as i64])
            .map_err(sql_error)?;
        let mut records = Vec::<Value>::new();
        let mut bytes = 0;
        while let Some(row) = rows.next().map_err(sql_error)? {
            let raw: String = row.get(0).map_err(sql_error)?;
            if bytes + raw.len() + 1 > FRAME_BYTES - 1024 {
                break;
            }
            bytes += raw.len() + 1;
            records.push(serde_json::from_str(&raw).map_err(|_| "corrupt_store")?);
        }
        let end = after + records.len() as u64;
        Ok(
            json!({"records":records,"latest":self.version,"next":if end < self.version { Some(end) } else { None }}),
        )
    }

    fn compact(&mut self) -> StoreResult<Value> {
        if self.poisoned {
            return Err("outcome_unknown");
        }
        let mut random = [0u8; 16];
        getrandom::getrandom(&mut random).map_err(|_| "io_error")?;
        let name = format!("review.backup-{}.sqlite", digest(&random));
        let path = self.directory.join(&name);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(&path).map_err(|_| "io_error")?;
        let mut destination = Connection::open(&path).map_err(sql_error)?;
        configure(&destination)?;
        // SQLite's backup API commits the destination through its VFS. A failed
        // backup never changes the authoritative database and is never returned.
        rusqlite::backup::Backup::new(&self.connection, &mut destination)
            .map_err(sql_error)?
            .run_to_completion(128, Duration::ZERO, None)
            .map_err(sql_error)?;
        drop(destination);
        self.poisoned = true;
        self.connection
            .execute_batch("VACUUM")
            .map_err(|_| "outcome_unknown")?;
        self.poisoned = false;
        Ok(json!({"backup":name}))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: u64,
    op: Operation,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Operation {
    Read { after: u64, limit: u64 },
    Append { record: Value },
    Compact,
}

fn send(output: &mut impl Write, value: Value) -> anyhow::Result<()> {
    serde_json::to_writer(&mut *output, &value)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

pub fn run(directory: &Path) -> anyhow::Result<()> {
    let mut output = std::io::stdout().lock();
    let mut store = match Store::open(directory) {
        Ok(store) => store,
        Err(code) => {
            send(
                &mut output,
                json!({"protocol":1,"ok":false,"error":{"code":code}}),
            )?;
            anyhow::bail!("review-store open failed: {code}");
        }
    };
    send(
        &mut output,
        json!({"protocol":1,"ok":true,"version":store.version,"sqliteVersion":rusqlite::version()}),
    )?;
    let mut input = std::io::stdin().lock();
    loop {
        let mut line = Vec::new();
        // Bounded even when a caller never supplies a newline.
        let n = std::io::Read::take(&mut input, (FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)?;
        if n == 0 {
            break;
        }
        if n > FRAME_BYTES || line.last() != Some(&b'\n') {
            anyhow::bail!("invalid review-store frame");
        }
        let value: Value = serde_json::from_slice(&line)?;
        let id = value
            .get("id")
            .and_then(Value::as_u64)
            .filter(|n| *n <= 9_007_199_254_740_991)
            .context("invalid request id")?;
        let result = match serde_json::from_value::<Request>(value) {
            Ok(request) if request.id == id => match request.op {
                Operation::Read { after, limit } => store.read(after, limit),
                Operation::Append { record } => store.append(record),
                Operation::Compact => store.compact(),
            },
            _ => Err("invalid_request"),
        };
        send(
            &mut output,
            match result {
                Ok(result) => json!({"protocol":1,"id":id,"ok":true,"result":result}),
                Err(code) => json!({"protocol":1,"id":id,"ok":false,"error":{"code":code}}),
            },
        )?;
    }
    Ok(())
}

use anyhow::Context;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufReader;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;

    fn sample() -> Value {
        json!({"version":1,"sequence":1,"previous":null,"key":"request","requestHash":"a".repeat(64),"events":[{"type":"sample","data":{"body":"kept"}}],"result":{"id":"kept"},"checksum":"b".repeat(64)})
    }

    #[test]
    fn crash_child() {
        let Ok(directory) = std::env::var("DIFFING_SQLITE_CRASH_TEST_DIRECTORY") else {
            return;
        };
        let boundary = std::env::var("DIFFING_SQLITE_CRASH_TEST_BOUNDARY").unwrap();
        let mut store = Store::open(Path::new(&directory)).unwrap();
        let pause = || {
            println!("COMMIT_BOUNDARY_REACHED");
            std::io::stdout().flush().unwrap();
            loop {
                std::thread::park();
            }
        };
        store
            .append_with(
                sample(),
                || {
                    if boundary == "before" {
                        pause();
                    }
                },
                || {
                    if boundary == "after" {
                        pause();
                    }
                },
            )
            .unwrap();
    }

    #[test]
    fn owner_death_before_and_after_commit_recovers_exactly_once() {
        struct Child(std::process::Child);
        impl Drop for Child {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        for boundary in ["before", "after"] {
            let directory = tempfile::tempdir().unwrap();
            let mut child = Child(
                Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "review_store::tests::crash_child", "--nocapture"])
                    .env("DIFFING_SQLITE_CRASH_TEST_DIRECTORY", directory.path())
                    .env("DIFFING_SQLITE_CRASH_TEST_BOUNDARY", boundary)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap(),
            );
            let output = child.0.stdout.take().unwrap();
            let (sender, receiver) = mpsc::channel();
            std::thread::spawn(move || {
                for line in BufReader::new(output).lines() {
                    if line.unwrap().contains("COMMIT_BOUNDARY_REACHED") {
                        let _ = sender.send(());
                        break;
                    }
                }
            });
            receiver
                .recv_timeout(Duration::from_secs(5))
                .expect("commit boundary");
            assert!(matches!(Store::open(directory.path()), Err("owner_busy")));
            drop(child);
            let mut recovered = Store::open(directory.path()).unwrap();
            assert_eq!(recovered.version, if boundary == "before" { 0 } else { 1 });
            assert_eq!(recovered.append(sample()).unwrap(), sample());
            assert_eq!(recovered.append(sample()).unwrap(), sample());
            assert_eq!(
                recovered.read(0, 100).unwrap()["records"],
                json!([sample()])
            );
        }
    }

    #[test]
    fn newer_schema_and_corruption_are_refused_without_rewriting_database() {
        for corrupt in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let mut store = Store::open(directory.path()).unwrap();
            store.append(sample()).unwrap();
            drop(store);
            let path = directory.path().join("review.sqlite");
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(if corrupt {
                    "UPDATE transactions SET record='{}'"
                } else {
                    "PRAGMA user_version=99"
                })
                .unwrap();
            drop(connection);
            let before = std::fs::read(&path).unwrap();
            assert!(
                matches!(Store::open(directory.path()), Err(code) if code == if corrupt { "corrupt_store" } else { "unsupported_version" })
            );
            assert_eq!(std::fs::read(path).unwrap(), before);
        }
    }

    #[test]
    fn legacy_journal_requires_explicit_migration() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("review.jsonl");
        std::fs::write(&path, b"original").unwrap();
        assert!(matches!(
            Store::open(directory.path()),
            Err("migration_required")
        ));
        assert_eq!(std::fs::read(path).unwrap(), b"original");
        assert!(!directory.path().join("review.sqlite").exists());
    }
}
