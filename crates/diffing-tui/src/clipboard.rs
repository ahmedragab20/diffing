//! Clipboard helpers run off the input loop with bounded writes and lifetime.
use std::io::{self, Seek, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

fn terminate(child: &mut Child) {
    // Stop descendants holding the stdin pipe as well as the helper itself.
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Own the worker until its process has exited, including when the TUI quits.
pub(crate) struct ClipboardJob {
    result: mpsc::Receiver<Result<(), String>>,
    cancel: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl ClipboardJob {
    pub(crate) fn start(
        operation: impl FnOnce(&AtomicBool) -> io::Result<()> + Send + 'static,
    ) -> io::Result<Self> {
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_cancel = cancel.clone();
        let (tx, result) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("diffing-clipboard".into())
            .spawn(move || {
                let _ = tx.send(operation(&worker_cancel).map_err(|error| error.to_string()));
            })?;
        Ok(Self {
            result,
            cancel,
            worker: Some(worker),
        })
    }

    pub(crate) fn try_result(&self) -> Option<Result<(), String>> {
        match self.result.try_recv() {
            Ok(result) => Some(result),
            Err(mpsc::TryRecvError::Empty) => None,
            Err(mpsc::TryRecvError::Disconnected) => Some(Err("clipboard worker stopped".into())),
        }
    }
}

impl Drop for ClipboardJob {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub(crate) fn run_helper(
    command: &mut Command,
    payload: Vec<u8>,
    timeout: Duration,
    cancel: &AtomicBool,
) -> io::Result<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "clipboard cancelled",
        ));
    }
    // A private anonymous file avoids pipe write deadlocks and detached writer
    // threads when a helper never reads stdin. It is removed automatically.
    let mut input = tempfile::tempfile()?;
    input.write_all(&payload)?;
    input.rewind()?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .stdin(Stdio::from(input))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                terminate(&mut child);
                return Err(io::Error::other(format!(
                    "clipboard helper exited with {status}"
                )));
            }
            Ok(None) => {}
            Err(error) => {
                terminate(&mut child);
                return Err(error);
            }
        }
        let cancelled = cancel.load(Ordering::Acquire);
        if cancelled || Instant::now() >= deadline {
            terminate(&mut child);
            let kind = if cancelled {
                io::ErrorKind::Interrupted
            } else {
                io::ErrorKind::TimedOut
            };
            return Err(io::Error::new(
                kind,
                "clipboard helper cancelled or timed out",
            ));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn dropping_clipboard_job_cancels_and_reaps_the_helper() {
        let dir = tempfile::tempdir().unwrap();
        let pid_path = dir.path().join("helper.pid");
        let worker_pid_path = pid_path.clone();
        let job = ClipboardJob::start(move |cancel| {
            let mut command = Command::new("sh");
            command
                .args([
                    "-c",
                    "printf '%s' \"$$\" > \"$1\"; exec sleep 30",
                    "clipboard-test",
                ])
                .arg(&worker_pid_path);
            run_helper(
                &mut command,
                b"review".to_vec(),
                Duration::from_secs(30),
                cancel,
            )
        })
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let pid = loop {
            if let Some(pid) = std::fs::read_to_string(&pid_path)
                .ok()
                .and_then(|value| value.parse::<i32>().ok())
            {
                break pid;
            }
            assert!(
                Instant::now() < deadline,
                "clipboard helper did not publish its PID"
            );
            thread::sleep(Duration::from_millis(10));
        };
        assert!(
            job.try_result().is_none(),
            "helper must still be running before cancellation"
        );
        drop(job);
        assert_eq!(
            unsafe { libc::kill(pid, 0) },
            -1,
            "clipboard helper survived job drop"
        );
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
    }

    #[test]
    fn helper_receives_the_complete_payload() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("clipboard");
        let mut command = Command::new("sh");
        command
            .args(["-c", "cat > \"$1\"", "clipboard-test"])
            .arg(&output);
        run_helper(
            &mut command,
            "review e\u{301} 👩‍💻".as_bytes().to_vec(),
            Duration::from_secs(2),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(output).unwrap(),
            "review e\u{301} 👩‍💻"
        );
    }

    #[test]
    fn stalled_reader_and_non_exiting_helper_have_deadlines() {
        for script in ["sleep 30", "cat >/dev/null; sleep 30"] {
            let mut command = Command::new("sh");
            command.args(["-c", script]);
            let started = Instant::now();
            let error = run_helper(
                &mut command,
                vec![b'x'; 1024 * 1024],
                Duration::from_millis(100),
                &AtomicBool::new(false),
            )
            .unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::TimedOut);
            assert!(started.elapsed() < Duration::from_secs(3));
        }
    }

    #[test]
    fn failing_helper_does_not_report_success() {
        let mut command = Command::new("sh");
        command.args(["-c", "dd bs=1 count=1 of=/dev/null 2>/dev/null; exit 1"]);
        assert!(run_helper(
            &mut command,
            vec![b'x'; 1024 * 1024],
            Duration::from_secs(2),
            &AtomicBool::new(false),
        )
        .is_err());
    }
}
