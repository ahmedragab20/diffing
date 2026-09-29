#![cfg(unix)]

use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use diffing_core::comments::comments_path;

const TIMEOUT: Duration = Duration::from_secs(5);

#[test]
fn review_starts_edits_persists_and_restores_a_real_pty() {
    let repo = tempfile::tempdir().expect("create repo");
    let storage = tempfile::tempdir().expect("create storage");
    std::env::set_var("DIFFING_STORAGE_ROOT", storage.path());
    let config = storage.path().join("config");
    fs::create_dir_all(&config).unwrap();
    fs::write(
        config.join("settings.json"),
        r#"{"lineWrap":false,"tuiLanguageIntelligence":"off"}"#,
    )
    .unwrap();
    let fake_bin = tempfile::tempdir().expect("create fake clipboard bin");
    let clipboard = storage.path().join("clipboard.txt");
    init_fixture(repo.path());
    install_clipboard_helper(fake_bin.path());

    let mut master_fd = 0;
    let mut slave_fd = 0;
    let mut size = winsize(100, 30);
    assert_eq!(
        unsafe {
            libc::openpty(
                &mut master_fd,
                &mut slave_fd,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            )
        },
        0
    );
    let mut master = unsafe { File::from_raw_fd(master_fd) };
    unsafe {
        let flags = libc::fcntl(master.as_raw_fd(), libc::F_GETFL);
        assert!(flags >= 0, "F_GETFL failed");
        assert_eq!(
            libc::fcntl(master.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK),
            0
        );
    }
    let slave = unsafe { File::from_raw_fd(slave_fd) };

    let mut command = if let Some(cli) = std::env::var_os("DIFFING_TUI_TEST_CLI") {
        let mut command = Command::new("node");
        command
            .arg(cli)
            .args(["--tui", "--new-session", "--skip-setup"])
            .current_dir(repo.path());
        command
    } else {
        let binary = std::env::var_os("DIFFING_TUI_TEST_BIN")
            .unwrap_or_else(|| env!("CARGO_BIN_EXE_diffing-tui").into());
        let mut command = Command::new(binary);
        command.arg("--repo").arg(repo.path());
        command
    };
    let inherited_path = std::env::var_os("PATH").unwrap_or_default();
    let path = format!(
        "{}:{}",
        fake_bin.path().display(),
        inherited_path.to_string_lossy()
    );
    command
        .env("DIFFING_STORAGE_ROOT", storage.path())
        .env("DIFFING_CONFIG_DIR", &config)
        .env("COLORTERM", "truecolor")
        .env_remove("NO_COLOR")
        .env("TERM", "xterm-256color")
        .env("PATH", path)
        .env("FAKE_CLIPBOARD", &clipboard)
        .stdin(Stdio::from(slave.try_clone().expect("clone slave stdin")))
        .stdout(Stdio::from(slave.try_clone().expect("clone slave stdout")))
        .stderr(Stdio::from(slave));
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 || libc::ioctl(0, libc::TIOCSCTTY.into(), 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let child = command.spawn().expect("spawn review TUI");
    let mut child = ChildGuard::new(child);

    let first_started = Instant::now();
    let initial = wait_for_output(&mut master, "review_target", TIMEOUT);
    eprintln!(
        "first_frame_ms={:.3}",
        first_started.elapsed().as_secs_f64() * 1000.0
    );
    assert!(
        initial.contains("\x1b[?2026h"),
        "initial frame lacked synchronized update escape"
    );

    write_all(&mut master, b"zf");
    wait_for_output(&mut master, "Focus mode", TIMEOUT);
    write_all(&mut master, b"zf");
    // Ratatui emits cell differences: an unchanged letter in "Changes" can
    // be omitted from the stream. The newly exposed sidebar footer and progress
    // are contiguous writes, and together prove that the workspace returned.
    let restored = wait_for_output(&mut master, "find file", TIMEOUT);
    assert!(
        restored.contains("0/1 viewed"),
        "review progress did not return after focus mode"
    );

    write_all(&mut master, b"\x10");
    wait_for_output(&mut master, "Actions", TIMEOUT);
    write_all(&mut master, b"line wrap\r");
    wait_until_file_contains(
        &mut master,
        &config.join("settings.json"),
        "\"lineWrap\": true",
        TIMEOUT,
    );
    write_all(&mut master, b"\x102\r");
    write_all(&mut master, b"c");
    write_paste(&mut master, "PTY review comment");
    write_all(&mut master, b"\x13");
    let comments_file = comments_path(
        repo.path()
            .canonicalize()
            .unwrap()
            .to_str()
            .expect("repo path is UTF-8"),
    );
    wait_until_file_contains(&mut master, &comments_file, "PTY review comment", TIMEOUT);
    let comments = fs::read_to_string(&comments_file).expect("read persisted comment");
    assert!(comments.contains("\"side\": \"additions\""));
    assert!(comments.contains("\"lineNumber\": 2"));

    write_all(&mut master, b"r");
    write_paste(&mut master, "PTY reply");
    write_all(&mut master, b"\x13");
    wait_until_file_contains(&mut master, &comments_file, "PTY reply", TIMEOUT);
    write_all(&mut master, b"x");
    wait_until_file_contains(
        &mut master,
        &comments_file,
        "\"status\": \"resolved\"",
        TIMEOUT,
    );

    resize(&mut master, child.child.id(), 42, 8);
    wait_for_output(&mut master, "\x1b[8;1H", TIMEOUT);
    write_all(&mut master, b"?");
    wait_for_output(&mut master, "Help", TIMEOUT);
    write_all(&mut master, b"\x1b");
    resize(&mut master, child.child.id(), 100, 30);
    wait_for_output(&mut master, "review_target", TIMEOUT);

    write_all(&mut master, b"v");
    write_all(&mut master, b"S");
    wait_for_output(&mut master, "Send to agent", TIMEOUT);
    write_all(&mut master, b"\x13");
    let pending = comments_file.parent().unwrap().join("pending-review.xml");
    wait_until_file_contains(&mut master, &pending, "decision=", TIMEOUT);
    let pending_xml = fs::read_to_string(&pending).expect("read pending review");
    assert!(
        pending_xml.contains("decision=\"changes-requested\"")
            || pending_xml.contains("decision=\"approved\"")
    );
    // The durable XML and the capability API are the same handoff. Round
    // identity belongs to the API envelope, not an invented XML attribute.
    let lock: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(comments_file.parent().unwrap().join("server.json")).unwrap(),
    )
    .unwrap();
    let mut stream =
        std::net::TcpStream::connect(("127.0.0.1", lock["port"].as_u64().unwrap() as u16)).unwrap();
    stream.set_read_timeout(Some(TIMEOUT)).unwrap();
    write!(stream, "GET /api/review/await?sinceRound=0&timeoutMs=1000 HTTP/1.1\r\nHost: 127.0.0.1\r\nx-diffing-capability: {}\r\nConnection: close\r\n\r\n", lock["capability"].as_str().unwrap()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    let response: serde_json::Value =
        serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(response["payload"]["round"], 1);
    assert_eq!(response["payload"]["commentXml"], pending_xml);
    assert!(
        !clipboard.exists(),
        "sending must not overwrite the clipboard"
    );
    write_all(&mut master, b"S");
    wait_for_output(&mut master, "Send to agent", TIMEOUT);
    write_all(&mut master, b"\x19");
    wait_until_file_contains(&mut master, &clipboard, "decision=", TIMEOUT);
    write_all(&mut master, b"\x1b");
    wait_for_output(&mut master, "draft kept", TIMEOUT);

    if let Some(cli) = std::env::var_os("DIFFING_TUI_TEST_CLI") {
        // Run the shipped CLI against the actual PTY-owned capability session.
        let cli_call = |args: &[&str]| {
            Command::new("node")
                .arg(&cli)
                .args(args)
                .current_dir(repo.path())
                .env("DIFFING_STORAGE_ROOT", storage.path())
                .env("DIFFING_CONFIG_DIR", &config)
                .output()
                .expect("run agent CLI")
        };
        let replay = cli_call(&["await-review", "--timeout", "1"]);
        assert!(
            replay.status.success(),
            "CLI replay failed: {}",
            String::from_utf8_lossy(&replay.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&replay.stdout).trim(), pending_xml);
        let started = Instant::now();
        let timeout = cli_call(&["await-review", "--since", "1", "--timeout", "1"]);
        assert_eq!(timeout.status.code(), Some(2));
        assert!(
            started.elapsed() < Duration::from_secs(4),
            "CLI ignored the short wait budget"
        );
        let progress = cli_call(&[
            "progress",
            "--message",
            "Checking agent feedback",
            "--model",
            "CLI agent",
            "--pct",
            "40",
        ]);
        assert!(
            progress.status.success(),
            "CLI progress failed: {}",
            String::from_utf8_lossy(&progress.stderr)
        );
        // Cell-diff output may omit unchanged letters in "agent". The new
        // model prefix is contiguous; workspace_flow asserts the full painted header.
        wait_for_output(&mut master, "CLI", TIMEOUT);

        // The real MCP client checks schema validation and session discovery,
        // then sends a reply and progress through the same native endpoint.
        let comment_id = response["payload"]["comments"][0]["id"].as_str().unwrap();
        let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let mcp = Command::new("node").args(["--input-type=module", "-e", r#"
            import assert from 'node:assert/strict';
            import { pathToFileURL } from 'node:url';
            const sdk = process.env.DIFFING_TEST_PROJECT + '/node_modules/@modelcontextprotocol/sdk/dist/esm/client/';
            const { Client } = await import(pathToFileURL(sdk + 'index.js'));
            const { StdioClientTransport } = await import(pathToFileURL(sdk + 'stdio.js'));
            const client = new Client({name:'tui-e2e',version:'1'});
            const transport = new StdioClientTransport({command:process.execPath,args:[process.env.DIFFING_TUI_TEST_CLI,'mcp','--repo',process.cwd()],env:process.env,stderr:'pipe'});
            const call = async (name, args = {}) => {
                const result = await client.callTool({name,arguments:args}, undefined, {timeout:5000});
                assert.ok(!result.isError, JSON.stringify(result));
                return result.structuredContent;
            };
            try {
                await client.connect(transport);
                const review = await call('await_review',{timeoutSeconds:1});
                assert.equal(review.status,'released');
                assert.equal(review.round,1);
                assert.equal(review.comments[0].id,process.env.DIFFING_TEST_COMMENT);
                assert.equal((await call('get_review_history')).rounds[0].round,1);
                await call('reply_to_comment',{commentId:process.env.DIFFING_TEST_COMMENT,body:'MCP reply received',model:'MCP agent'});
                await call('report_progress',{message:'Review response ready',model:'MCP agent',pct:100});
                console.log('MCP handoff, history, reply, and progress passed');
            } finally { await client.close(); }
        "#]).current_dir(repo.path()).env("DIFFING_TEST_PROJECT", project)
            .env("DIFFING_TUI_TEST_CLI", &cli).env("DIFFING_TEST_COMMENT", comment_id)
            .env("DIFFING_STORAGE_ROOT", storage.path()).env("DIFFING_CONFIG_DIR", &config)
            .output().expect("run MCP client");
        assert!(
            mcp.status.success(),
            "MCP flow failed: {}",
            String::from_utf8_lossy(&mcp.stderr)
        );
        eprintln!("{}", String::from_utf8_lossy(&mcp.stdout));
        wait_for_output(&mut master, "MCP", TIMEOUT);
        wait_until_file_contains(&mut master, &comments_file, "MCP reply received", TIMEOUT);
    }

    write_all(&mut master, b"q");
    let deadline = Instant::now() + TIMEOUT;
    let mut final_output = Vec::new();
    let status = loop {
        final_output.extend(drain(&mut master));
        if let Some(status) = child.child.try_wait().expect("poll child") {
            break status;
        }
        assert!(Instant::now() < deadline, "review TUI did not exit after q");
        thread::yield_now();
    };
    assert!(status.success(), "review TUI exited with {status}");
    final_output.extend(drain(&mut master));
    let final_text = String::from_utf8_lossy(&final_output);
    assert!(
        final_text.contains("\x1b[?1049l"),
        "final output lacked alternate-screen restore"
    );
    assert!(
        final_text.contains("\x1b[?7h"),
        "final output lacked wrap restoration evidence"
    );
    child.disarm();
}

struct ChildGuard {
    child: Child,
    armed: bool,
}

impl ChildGuard {
    fn new(child: Child) -> Self {
        Self { child, armed: true }
    }
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.armed {
            // The launcher and native viewer share the session created by
            // setsid. Stop both on failure. Do not block waiting while the PTY
            // master is still open: macOS can hold exit until it is closed.
            unsafe { libc::kill(-(self.child.id() as libc::pid_t), libc::SIGKILL) };
            let _ = self.child.try_wait();
        }
    }
}

fn init_fixture(root: &std::path::Path) {
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(root)
        .status()
        .expect("git init")
        .success());
    fs::write(root.join("sample.rs"), "fn before() {}\n").expect("write base fixture");
    assert!(Command::new("git")
        .args(["add", "sample.rs"])
        .current_dir(root)
        .status()
        .expect("git add")
        .success());
    fs::write(
        root.join("sample.rs"),
        "fn before() {}\npub fn review_target() {}\n",
    )
    .expect("write working fixture");
}

fn install_clipboard_helper(bin: &std::path::Path) {
    for helper in ["pbcopy", "wl-copy", "xclip", "xsel"] {
        let script = bin.join(helper);
        fs::write(&script, "#!/bin/sh\ncat > \"$FAKE_CLIPBOARD\"\n").expect("write fake pbcopy");
        let mut permissions = fs::metadata(&script)
            .expect("stat fake pbcopy")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(script, permissions).expect("chmod fake clipboard helper");
    }
}

fn winsize(columns: u16, rows: u16) -> libc::winsize {
    libc::winsize {
        ws_row: rows,
        ws_col: columns,
        ws_xpixel: 0,
        ws_ypixel: 0,
    }
}

fn resize(master: &mut File, pid: u32, columns: u16, rows: u16) {
    let size = winsize(columns, rows);
    assert_eq!(
        unsafe { libc::ioctl(master.as_raw_fd(), libc::TIOCSWINSZ.into(), &size) },
        0
    );
    assert_eq!(unsafe { libc::kill(pid as libc::pid_t, libc::SIGWINCH) }, 0);
}

fn write_all(master: &mut File, bytes: &[u8]) {
    master.write_all(bytes).expect("write PTY input");
}

fn write_paste(master: &mut File, text: &str) {
    write_all(master, b"\x1b[200~");
    write_all(master, text.as_bytes());
    write_all(master, b"\x1b[201~");
}

fn drain(master: &mut File) -> Vec<u8> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
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
            "timed out waiting for {needle:?}: {rendered:?}"
        );
        thread::yield_now();
    }
}

fn wait_until_file_contains(
    master: &mut File,
    path: &std::path::Path,
    needle: &str,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    let mut output = Vec::new();
    loop {
        output.extend(drain(master));
        if fs::read_to_string(path)
            .map(|contents| contents.contains(needle))
            .unwrap_or(false)
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {needle:?} in {}: {:?}",
            path.display(),
            String::from_utf8_lossy(&output)
        );
        thread::yield_now();
    }
}
