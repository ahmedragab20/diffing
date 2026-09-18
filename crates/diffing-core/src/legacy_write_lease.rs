//! Cooperative classic-writer exclusion shared with the TypeScript server.
//! The immutable owner record names an exclusive loopback listener. A slow
//! process keeps ownership; only closing the listener or process death releases
//! it. No age-based lock deletion is permitted. This is local-host coordination,
//! not a data durability boundary or a distributed-filesystem lock.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener};
use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum LegacyWriteError {
    #[error("legacy_store_busy")]
    Busy,
    #[error("review_core_required")]
    CoreRequired,
    #[error("invalid_owner")]
    InvalidOwner,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OwnerRecord {
    version: u8,
    port: u16,
}

pub fn assert_classic_authority(directory: &Path) -> Result<()> {
    for name in [
        "review-authority.json",
        "review.sqlite",
        "review.initialized",
        "review.sqlite-journal",
        "review.sqlite-wal",
        "review.sqlite-shm",
    ] {
        match fs::symlink_metadata(directory.join(name)) {
            Ok(_) => return Err(LegacyWriteError::CoreRequired.into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub struct LegacyWriteLease {
    _listener: TcpListener,
}

impl LegacyWriteLease {
    pub fn acquire(directory: &Path, timeout: Duration) -> Result<Self> {
        let directory = directory.join("legacy-write-lease");
        fs::create_dir_all(&directory)?;
        let deadline = Instant::now() + timeout;
        loop {
            match Self::try_acquire(&directory) {
                Ok(lease) => return Ok(lease),
                Err(error) if matches!(error.downcast_ref(), Some(LegacyWriteError::Busy)) => {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        return Err(error);
                    }
                    std::thread::sleep(remaining.min(Duration::from_millis(25)));
                }
                Err(error) => return Err(error),
            }
        }
    }

    fn try_acquire(directory: &Path) -> Result<Self> {
        let record_path = directory.join("owner.json");
        match fs::File::open(&record_path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(4097).read_to_end(&mut bytes)?;
                if bytes.len() > 4096 {
                    return Err(LegacyWriteError::InvalidOwner.into());
                }
                let record: OwnerRecord =
                    serde_json::from_slice(&bytes).map_err(|_| LegacyWriteError::InvalidOwner)?;
                if record.version != 1 || record.port == 0 {
                    return Err(LegacyWriteError::InvalidOwner.into());
                }
                let listener =
                    TcpListener::bind((Ipv4Addr::LOCALHOST, record.port)).map_err(|error| {
                        match error.kind() {
                            std::io::ErrorKind::AddrInUse => {
                                anyhow::Error::from(LegacyWriteError::Busy)
                            }
                            _ => error.into(),
                        }
                    })?;
                return Ok(Self {
                    _listener: listener,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }

        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let record = OwnerRecord {
            version: 1,
            port: listener.local_addr()?.port(),
        };
        let mut random = [0u8; 16];
        getrandom::getrandom(&mut random)
            .map_err(|_| anyhow::anyhow!("lease randomness unavailable"))?;
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let temporary = directory.join(format!(".owner-{suffix}"));
        let published = (|| -> Result<bool> {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(&serde_json::to_vec(&record)?)?;
            file.sync_all()?;
            drop(file);
            match fs::hard_link(&temporary, &record_path) {
                Ok(()) => Ok(true),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
                Err(error) => Err(error).context("publishing classic writer ownership"),
            }
        })();
        let _ = fs::remove_file(&temporary);
        if published? {
            Ok(Self {
                _listener: listener,
            })
        } else {
            drop(listener);
            Self::try_acquire(directory)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Invoked by scripts/legacy-lease-qualification.test.ts to exercise actual
    // Rust/Node exclusion and process death without timing-based assertions.
    #[test]
    fn process_child() {
        let Ok(directory) = std::env::var("DIFFING_LEGACY_LEASE_CHILD") else {
            return;
        };
        let lease = LegacyWriteLease::acquire(Path::new(&directory), Duration::ZERO);
        if std::env::var_os("DIFFING_LEGACY_LEASE_PROBE").is_some() {
            match lease {
                Ok(_) => println!("LEGACY_ACQUIRED"),
                Err(error) if matches!(error.downcast_ref(), Some(LegacyWriteError::Busy)) => {
                    println!("LEGACY_BUSY")
                }
                Err(error) => panic!("{error}"),
            }
            std::io::stdout().flush().unwrap();
            return;
        }
        let _lease = lease.unwrap();
        println!("LEGACY_READY");
        std::io::stdout().flush().unwrap();
        loop {
            std::thread::park();
        }
    }

    #[test]
    fn ownership_lasts_until_drop_and_unknown_records_are_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let lease = LegacyWriteLease::acquire(directory.path(), Duration::ZERO).unwrap();
        let record = directory.path().join("legacy-write-lease/owner.json");
        let before = fs::read(&record).unwrap();
        assert!(matches!(
            LegacyWriteLease::acquire(directory.path(), Duration::ZERO)
                .err()
                .unwrap()
                .downcast_ref(),
            Some(LegacyWriteError::Busy)
        ));
        drop(lease);
        // Port availability can race another test's ephemeral listener after
        // release. Use the production bounded acquisition, not a zero-time probe.
        drop(LegacyWriteLease::acquire(directory.path(), Duration::from_secs(5)).unwrap());
        assert_eq!(fs::read(&record).unwrap(), before);
        fs::write(&record, br#"{"version":2,"port":1}"#).unwrap();
        assert!(matches!(
            LegacyWriteLease::acquire(directory.path(), Duration::ZERO)
                .err()
                .unwrap()
                .downcast_ref(),
            Some(LegacyWriteError::InvalidOwner)
        ));
        assert_eq!(fs::read(&record).unwrap(), br#"{"version":2,"port":1}"#);
    }

    #[test]
    fn any_authority_marker_fences_classic_access() {
        let directory = tempfile::tempdir().unwrap();
        assert_classic_authority(directory.path()).unwrap();
        for name in [
            "review-authority.json",
            "review.sqlite",
            "review.initialized",
            "review.sqlite-journal",
            "review.sqlite-wal",
            "review.sqlite-shm",
        ] {
            let path = directory.path().join(name);
            fs::write(&path, "unknown version").unwrap();
            assert!(matches!(
                assert_classic_authority(directory.path())
                    .err()
                    .unwrap()
                    .downcast_ref(),
                Some(LegacyWriteError::CoreRequired)
            ));
            fs::remove_file(path).unwrap();
        }
    }
}
