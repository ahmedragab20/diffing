#![cfg(unix)]

use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn viewer_starts_and_quits_cleanly_in_a_real_pty() {
    let repo = tempfile::tempdir().unwrap();
    let storage = tempfile::tempdir().unwrap();
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(repo.path())
        .status()
        .unwrap()
        .success());
    std::fs::write(repo.path().join("sample.rs"), "fn before() {}\n").unwrap();
    assert!(Command::new("git")
        .args(["add", "sample.rs"])
        .current_dir(repo.path())
        .status()
        .unwrap()
        .success());
    std::fs::write(
        repo.path().join("sample.rs"),
        "fn before() {}\npub fn render_search() {}\n",
    )
    .unwrap();

    let mut master = 0;
    let mut slave = 0;
    let mut size = libc::winsize {
        ws_row: 30,
        ws_col: 100,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let opened = unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    assert_eq!(opened, 0, "openpty failed");
    let mut master = unsafe { File::from_raw_fd(master) };
    unsafe {
        let flags = libc::fcntl(master.as_raw_fd(), libc::F_GETFL);
        assert!(flags >= 0);
        assert_eq!(
            libc::fcntl(master.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK),
            0
        );
    }
    let slave = unsafe { File::from_raw_fd(slave) };
    let mut command = Command::new(env!("CARGO_BIN_EXE_diffing-tui"));
    command
        .arg("--repo")
        .arg(repo.path())
        .arg("--view-only")
        .env("DIFFING_STORAGE_ROOT", storage.path())
        .stdin(Stdio::from(slave.try_clone().unwrap()))
        .stdout(Stdio::from(slave.try_clone().unwrap()))
        .stderr(Stdio::from(slave));
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 || libc::ioctl(0, libc::TIOCSCTTY.into(), 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command.spawn().unwrap();

    let _ = wait_for_output(&mut master, "sample.rs", Duration::from_secs(5));
    for key in [b"/".as_slice(), b"\t", b"\t", b"\t"] {
        master.write_all(key).unwrap();
        thread::sleep(Duration::from_millis(100));
    }
    let search_frame = wait_for_output(&mut master, "render_search", Duration::from_secs(5));
    assert!(
        search_frame.contains("Symbols"),
        "Symbols scope was not rendered"
    );
    assert!(
        search_frame.contains("render_search"),
        "changed-line symbol was not rendered"
    );
    master.write_all(b"\x1b").unwrap();
    let _ = wait_for_output(&mut master, "Working-tree", Duration::from_secs(5));
    master.write_all(b"q").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        let _ = drain(&mut master);
        if Instant::now() >= deadline {
            child.kill().ok();
            panic!("viewer did not restore the PTY and exit after q");
        }
        thread::sleep(Duration::from_millis(25));
    };
    assert!(status.success(), "viewer exited with {status}");
}

fn drain(master: &mut File) -> Vec<u8> {
    let mut buffer = [0_u8; 8192];
    let mut output = Vec::new();
    loop {
        match master.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => output.extend_from_slice(&buffer[..read]),
        }
    }
    output
}

fn wait_for_output(master: &mut File, needle: &str, timeout: Duration) -> String {
    let deadline = Instant::now() + timeout;
    let mut output = Vec::new();
    loop {
        output.extend(drain(master));
        let rendered = String::from_utf8_lossy(&output);
        if rendered.contains(needle) {
            return rendered.into_owned();
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {needle:?} in PTY output"
        );
        thread::sleep(Duration::from_millis(25));
    }
}
