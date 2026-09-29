use std::fs;
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use diffing_core::comments::{CommentStatus, FileCommentStore};
use diffing_core::index::IndexedLineKind;
use diffing_tui::app::{App, Experience, Mode};
use diffing_tui::diff_context::DiffContext;
use diffing_tui::themes::{Palette, ThemeName};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

const INDEX_TIMEOUT: Duration = Duration::from_secs(30);

#[test]
fn workspace_flow_exercises_real_app_surfaces_and_persistence() {
    let repo = tempfile::tempdir().expect("create temporary workspace");
    let storage = tempfile::tempdir().expect("create isolated storage");
    std::env::set_var("DIFFING_STORAGE_ROOT", storage.path());
    std::env::set_var("DIFFING_CONFIG_DIR", storage.path().join("config"));
    fs::create_dir_all(storage.path().join("config")).unwrap();
    fs::write(
        storage.path().join("config/settings.json"),
        r#"{"requireViewAllBeforeSend":true}"#,
    )
    .unwrap();
    std::env::set_var("COLORTERM", "truecolor");
    std::env::set_var("TERM", "xterm-256color");
    std::env::remove_var("NO_COLOR");
    write_fixture(repo.path());

    // Match the CLI's canonical root; macOS notifications use /private/var.
    let repo_path = repo.path().canonicalize().unwrap();
    let mut app = App::new(
        repo_path.clone(),
        Vec::new(),
        Experience::Review,
        DiffContext::from_env_or_args(&[]),
        None,
    )
    .unwrap_or_else(|error| panic!("startup error: {error:#}"));

    let indexing_started = Instant::now();
    while !app.index.complete {
        app.tick_index();
        assert!(
            indexing_started.elapsed() < INDEX_TIMEOUT,
            "index did not complete within {INDEX_TIMEOUT:?}"
        );
        thread::sleep(Duration::from_millis(1));
    }
    assert_eq!(
        app.files.len(),
        2,
        "fixture should expose both changed files"
    );

    app.palette = Palette::for_theme(app.theme);
    let areas = [
        Rect::new(0, 0, 160, 48),
        Rect::new(0, 0, 100, 30),
        Rect::new(0, 0, 80, 24),
        Rect::new(0, 0, 42, 8),
    ];
    for area in areas {
        let mut buffer = Buffer::empty(area);
        app.render(area, &mut buffer);
        capture(
            &format!("workspace-{}x{}", area.width, area.height),
            &buffer,
        );
        if area.width >= 100 {
            let text = buffer_text(&buffer);
            assert!(
                text.contains("alpha.rs"),
                "startup render omitted alpha.rs at {area:?}"
            );
        }
    }
    let mut resized = Buffer::empty(areas[0]);
    app.render(areas[0], &mut resized);
    let startup_text = buffer_text(&resized);
    assert!(startup_text.contains("alpha.rs"));
    assert!(startup_text.contains("new alpha"));

    for theme in ThemeName::all()
        .iter()
        .copied()
        .filter(|theme| theme.is_light())
        .chain(
            ThemeName::all()
                .iter()
                .copied()
                .filter(|theme| !theme.is_light())
                .take(1),
        )
    {
        app.theme = theme;
        app.palette = Palette::for_theme(theme);
        let mut buffer = Buffer::empty(areas[0]);
        app.render(areas[0], &mut buffer);
        assert!(
            buffer_text(&buffer).contains("new alpha"),
            "source text hidden in {}",
            theme.label()
        );
        if theme.label() == "github-light" {
            capture("workspace-light", &buffer);
        }
    }

    // Command palette: wrap, numeric line jump, no-match persistence, and close.
    app.theme = ThemeName::default();
    app.palette = Palette::for_terminal(app.theme);
    let initial_wrap = app.wrap;
    press(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
    assert_eq!(render_mode(&mut app), Some(Mode::Command));
    capture("actions", &render(&mut app, areas[1]));
    type_keys(&mut app, "line wrap");
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert_ne!(app.wrap, initial_wrap);
    press(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
    type_keys(&mut app, "42");
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    let alpha_index = app
        .file_tree
        .active_file_idx()
        .expect("alpha remains the active file after the line jump");
    let expected_row = app
        .index
        .find_line_row(alpha_index, IndexedLineKind::Add, 42)
        .expect("find changed alpha line 42")
        .expect("alpha line 42 is in the diff");
    assert_eq!(app.cursor_row, expected_row);
    press(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
    type_keys(&mut app, "no such command");
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert_eq!(render_mode(&mut app), Some(Mode::Command));
    press(&mut app, KeyCode::Esc, KeyModifiers::NONE);
    assert_eq!(render_mode(&mut app), Some(Mode::Normal));

    // Intermediate widths must not let keyboard focus disappear into a hidden rail.
    for width in [88, 92, 95] {
        press(&mut app, KeyCode::Tab, KeyModifiers::NONE);
        let buffer = render(&mut app, Rect::new(0, 0, width, 24));
        assert!(
            buffer_text(&buffer).contains("Changes"),
            "file focus invisible at {width} columns"
        );
        press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
        assert_eq!(app.focus, diffing_tui::app::Focus::Diff);
    }

    // File-tree focus and selection return to the diff.
    press(&mut app, KeyCode::Tab, KeyModifiers::NONE);
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert!(buffer_text(&render(&mut app, areas[0])).contains("alpha.rs"));

    // Add, reply to, resolve, and read back a real persisted comment.
    for _ in 0..3 {
        press(&mut app, KeyCode::Char('j'), KeyModifiers::NONE);
    }
    press(&mut app, KeyCode::Char('c'), KeyModifiers::NONE);
    assert_eq!(render_mode(&mut app), Some(Mode::CommentForm));
    app.handle_paste("workspace comment");
    press(&mut app, KeyCode::Char('s'), KeyModifiers::CONTROL);
    let store = FileCommentStore::new(repo_path.to_str().expect("repo path is UTF-8"));
    let comments = store.load().expect("load saved comment");
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].body, "workspace comment");

    press(&mut app, KeyCode::Char('r'), KeyModifiers::NONE);
    assert_eq!(render_mode(&mut app), Some(Mode::CommentForm));
    app.handle_paste("reply text");
    press(&mut app, KeyCode::Char('s'), KeyModifiers::CONTROL);
    let comments = store.load().expect("load replied comment");
    assert_eq!(comments[0].replies.len(), 1);
    assert_eq!(comments[0].replies[0].body, "reply text");
    press(&mut app, KeyCode::Char('x'), KeyModifiers::NONE);
    let comments = store.load().expect("load resolved comment");
    assert_eq!(comments[0].status, CommentStatus::Resolved);
    capture("comments", &render(&mut app, areas[0]));
    press(&mut app, KeyCode::Char('o'), KeyModifiers::NONE);
    assert_eq!(app.mode, Mode::CommentDetail);
    for area in [areas[1], areas[3]] {
        let buffer = render(&mut app, area);
        assert!(
            buffer_text(&buffer).contains("Esc Close"),
            "comment close missing at {area:?}"
        );
        if area == areas[1] {
            capture("thread", &buffer);
        }
    }
    press(&mut app, KeyCode::Esc, KeyModifiers::NONE);

    for area in areas {
        let _ = render(&mut app, area);
        for key in [
            KeyCode::Char('?'),
            KeyCode::Char(','),
            KeyCode::Char('t'),
            KeyCode::Char('p'),
        ] {
            press(
                &mut app,
                key,
                if key == KeyCode::Char('p') {
                    KeyModifiers::CONTROL
                } else {
                    KeyModifiers::NONE
                },
            );
            let buffer = render(&mut app, area);
            if area == areas[1] {
                let name = match key {
                    KeyCode::Char('?') => "help",
                    KeyCode::Char(',') => "settings",
                    KeyCode::Char('t') => "themes",
                    _ => "actions",
                };
                capture(name, &buffer);
            }
            press(&mut app, KeyCode::Esc, KeyModifiers::NONE);
        }
    }
    app.split = true;
    capture("split", &render(&mut app, areas[0]));
    app.split = false;
    std::env::remove_var("COLORTERM");
    app.palette = Palette::for_terminal(app.theme);
    capture("ansi-256", &render(&mut app, areas[1]));
    std::env::set_var("NO_COLOR", "1");
    app.palette = Palette::for_terminal(app.theme);
    let monochrome = render(&mut app, areas[1]);
    assert!(
        monochrome
            .content
            .iter()
            .all(|cell| cell.fg == ratatui::style::Color::Reset
                && cell.bg == ratatui::style::Color::Reset),
        "cached source retained colors in monochrome mode: {:?}",
        monochrome
            .content
            .iter()
            .enumerate()
            .filter(|(_, cell)| cell.fg != ratatui::style::Color::Reset
                || cell.bg != ratatui::style::Color::Reset)
            .take(5)
            .collect::<Vec<_>>()
    );
    capture("monochrome", &monochrome);
    std::env::remove_var("NO_COLOR");
    std::env::set_var("COLORTERM", "truecolor");
    app.palette = Palette::for_terminal(app.theme);
    press(&mut app, KeyCode::Char(','), KeyModifiers::NONE);
    capture("settings", &render(&mut app, areas[1]));
    press(&mut app, KeyCode::Esc, KeyModifiers::NONE);

    // Search is opened, polled, and activated through the public API.
    press(&mut app, KeyCode::Char('b'), KeyModifiers::NONE);
    press(&mut app, KeyCode::Char('/'), KeyModifiers::NONE);
    app.handle_paste("unicode");
    let search_deadline = Instant::now() + Duration::from_secs(5);
    let mut saw_beta_result = false;
    while Instant::now() < search_deadline {
        app.poll_background();
        let search_text = buffer_text(&render(&mut app, areas[0]));
        if search_text.contains("beta.rs") {
            saw_beta_result = true;
            break;
        }
        thread::yield_now();
    }
    assert!(
        saw_beta_result,
        "search result for unicode did not render beta.rs"
    );
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert_eq!(app.mode, Mode::Normal);
    let active_path = app
        .file_tree
        .active_file_idx()
        .and_then(|index| app.files.get(index))
        .map(|file| file.display_path().to_string_lossy().into_owned());
    assert_eq!(active_path.as_deref(), Some("src/beta.rs"));

    // Real filesystem notifications refresh the active diff after a save burst.
    let beta = repo.path().join("src/beta.rs");
    for value in ["first save", "second save", "live_refresh_final"] {
        fs::write(
            &beta,
            format!("pub fn beta() {{ println!(\"{value}\"); }}\n"),
        )
        .unwrap();
    }
    let refresh_deadline = Instant::now() + Duration::from_secs(10);
    loop {
        app.poll_background();
        if buffer_text(&render(&mut app, areas[0])).contains("live_refresh_final") {
            break;
        }
        assert!(
            Instant::now() < refresh_deadline,
            "save burst did not refresh the visible diff: {}",
            buffer_text(&render(&mut app, areas[0]))
        );
        thread::sleep(Duration::from_millis(5));
    }

    press(&mut app, KeyCode::Char('S'), KeyModifiers::NONE);
    assert_eq!(render_mode(&mut app), Some(Mode::SendReview));
    app.handle_paste("Discuss this approach before editing.");
    press(&mut app, KeyCode::Esc, KeyModifiers::NONE);
    assert_eq!(render_mode(&mut app), Some(Mode::Normal));
    press(&mut app, KeyCode::Char('S'), KeyModifiers::NONE);
    assert_eq!(
        app.send_review.as_ref().unwrap().body(),
        "Discuss this approach before editing."
    );
    // Leave the note field and choose Comment only with normal terminal keys.
    press(&mut app, KeyCode::Tab, KeyModifiers::NONE);
    press(&mut app, KeyCode::Down, KeyModifiers::NONE);
    press(&mut app, KeyCode::Down, KeyModifiers::NONE);
    assert_eq!(
        app.send_review.as_ref().unwrap().verdict,
        diffing_tui::handoff::review::ReviewDecision::CommentOnly
    );
    for area in [areas[1], areas[2], areas[3]] {
        let buffer = render(&mut app, area);
        assert!(buffer_text(&buffer).contains("Comment only"));
        assert!(buffer_text(&buffer).contains("^S Send"));
        capture(
            &format!("send-agent-{}x{}", area.width, area.height),
            &buffer,
        );
    }
    // A reply arrives after the modal opened and before its watcher reloads.
    let id = app.comments[0].id.clone();
    agent_request(
        &app,
        "POST",
        &format!("/api/comments/{id}/replies"),
        serde_json::json!({ "body": "Late agent reply", "role": "agent", "model": "Review agent" }),
    );
    assert!(!app.comments[0]
        .replies
        .iter()
        .any(|reply| reply.body == "Late agent reply"));
    // A failed atomic replacement must preserve the draft and leave round zero.
    let pending =
        diffing_tui::ui::send_review_popover::pending_review_path(repo_path.to_str().unwrap());
    fs::create_dir(&pending).unwrap();
    press(&mut app, KeyCode::Char('s'), KeyModifiers::CONTROL);
    press(&mut app, KeyCode::Char('s'), KeyModifiers::CONTROL);
    assert_eq!(app.mode, Mode::SendReview);
    assert_eq!(app.review_round, 0);
    assert!(app
        .send_review
        .as_ref()
        .unwrap()
        .feedback
        .as_deref()
        .unwrap()
        .contains("Could not save review"));
    fs::remove_dir(&pending).unwrap();
    press(&mut app, KeyCode::Char('s'), KeyModifiers::CONTROL);
    assert_eq!(app.mode, Mode::Normal);
    let release = agent_request(
        &app,
        "GET",
        "/api/review/await?sinceRound=0&timeoutMs=1",
        serde_json::Value::Null,
    );
    assert_eq!(release["status"], "released");
    assert_eq!(release["payload"]["mode"], "comment-only");
    assert_eq!(release["payload"]["decision"], "comment-only");
    assert_eq!(
        release["payload"]["comments"][0]["replies"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["body"],
        "Late agent reply"
    );
    let xml = fs::read_to_string(&pending).unwrap();
    assert_eq!(release["payload"]["commentXml"], xml);
    assert!(xml.contains("MUST NOT edit any files"));
    assert!(xml.contains("Discuss this approach before editing."));
    let history = agent_request(&app, "GET", "/api/review/history", serde_json::Value::Null);
    assert_eq!(history["rounds"][0]["round"], 1);
    agent_request(
        &app,
        "POST",
        "/api/agent/progress",
        serde_json::json!({ "message": "Checking replies", "model": "Reviewer", "pct": 50 }),
    );
    assert!(
        app.poll_background(),
        "incoming progress must invalidate the idle screen"
    );
    app.status_message = None;
    capture("agent-progress", &render(&mut app, areas[0]));
    assert!(buffer_text(&render(&mut app, areas[0])).contains("Reviewer 50%"));
    assert!(buffer_text(&render(&mut app, areas[3])).contains("Reviewer 50%"));
    assert!(app.comments[0]
        .replies
        .iter()
        .any(|reply| reply.body == "Late agent reply"));
    press(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
    type_keys(&mut app, "agent reply");
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert_eq!(app.mode, Mode::CommentDetail);
    let response_thread = render(&mut app, areas[1]);
    assert!(buffer_text(&response_thread).contains("Late agent reply"));
    capture("agent-reply-thread", &response_thread);
    drop(app);
    capture_working_tree();

    // A worker failure must paint a recoverable error, not an endless spinner.
    let mut failed = App::new(
        repo_path,
        vec!["--invalid-diff-option".into()],
        Experience::Viewer,
        DiffContext::from_env_or_args(&[]),
        None,
    )
    .unwrap();
    let failure_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let dirty = failed.tick_index();
        if buffer_text(&render(&mut failed, areas[0])).contains("Unable to load changes") {
            assert!(dirty, "failure did not request a repaint");
            break;
        }
        assert!(
            Instant::now() < failure_deadline,
            "index failure stayed in loading state"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

fn agent_request(
    app: &App,
    method: &str,
    path: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    use std::io::{Read, Write};
    let api = app.agent_api.as_ref().unwrap();
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", api.port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let body = serde_json::to_string(&body).unwrap();
    write!(stream, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Diffing-Capability: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", api.capability, body.len()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap()
}

// Optional visual qualification against a real checkout. Storage and settings
// remain isolated by the parent test; the target checkout is only read.
fn capture_working_tree() {
    let Ok(root) = std::env::var("DIFFING_TUI_CAPTURE_REPO") else {
        return;
    };
    if std::env::var_os("DIFFING_TUI_CAPTURE_DIR").is_none() {
        return;
    }
    let mut app = App::new(
        Path::new(&root).canonicalize().unwrap(),
        Vec::new(),
        Experience::Review,
        DiffContext::from_env_or_args(&[]),
        None,
    )
    .unwrap();
    let deadline = Instant::now() + INDEX_TIMEOUT;
    while !app.index.complete {
        app.tick_index();
        assert!(
            Instant::now() < deadline,
            "visual checkout indexing timed out"
        );
        thread::sleep(Duration::from_millis(1));
    }
    app.sidebar_visible = true;
    app.wrap = false;
    app.theme = ThemeName::default();
    app.palette = Palette::for_terminal(app.theme);
    if let Some(index) = app
        .files
        .iter()
        .position(|file| file.display_path().ends_with("ui/command_palette.rs"))
    {
        app.file_tree.jump_to_file(index);
    }
    let area = Rect::new(0, 0, 140, 38);
    capture("working-tree", &render(&mut app, area));
    press(&mut app, KeyCode::Char('z'), KeyModifiers::NONE);
    press(&mut app, KeyCode::Char('f'), KeyModifiers::NONE);
    capture("working-tree-focus", &render(&mut app, area));
    press(&mut app, KeyCode::Char('z'), KeyModifiers::NONE);
    press(&mut app, KeyCode::Char('f'), KeyModifiers::NONE);
    press(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
    capture("working-tree-actions", &render(&mut app, area));
    press(&mut app, KeyCode::Esc, KeyModifiers::NONE);
    press(&mut app, KeyCode::Char(','), KeyModifiers::NONE);
    capture("working-tree-settings", &render(&mut app, area));
}

fn write_fixture(root: &Path) {
    run_git(root, &["init", "-q"]);
    run_git(
        root,
        &["config", "user.email", "workspace-flow@example.invalid"],
    );
    run_git(root, &["config", "user.name", "workspace flow"]);
    let src = root.join("src");
    fs::create_dir_all(&src).expect("create src");

    let alpha = (1..=64)
        .map(|line| {
            format!("pub fn alpha_line_{line}() -> &'static str {{ \"alpha-line-{line}\" }}\n")
        })
        .collect::<String>();
    let beta = "pub fn beta() {\n\tlet unicode = \"مرحبا世界\";\n\tlet long = \"beta source with a deliberately long line for wrapping coverage 0123456789\";\n\tprintln!(\"{unicode} {long}\");\n}\n";
    fs::write(src.join("alpha.rs"), alpha).expect("write alpha base");
    fs::write(src.join("beta.rs"), beta).expect("write beta base");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-qm", "workspace fixture"]);

    let changed_alpha = (1..=64)
        .map(|line| {
            if line == 3 {
                "pub fn alpha_line_3() -> &'static str { \"new alpha\" }\n".to_string()
            } else if line == 42 {
                "pub fn alpha_line_42() -> &'static str { \"alpha-line-42 updated\" }\n".to_string()
            } else {
                format!("pub fn alpha_line_{line}() -> &'static str {{ \"alpha-line-{line}\" }}\n")
            }
        })
        .collect::<String>();
    let changed_beta = beta
        .replace("مرحبا世界", "تغيير世界")
        .replace("0123456789", "9876543210");
    fs::write(src.join("alpha.rs"), changed_alpha).expect("modify alpha");
    fs::write(src.join("beta.rs"), changed_beta).expect("modify beta");
}

fn run_git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .expect("run git fixture command");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn press(app: &mut App, code: KeyCode, modifiers: KeyModifiers) {
    app.handle_key(KeyEvent::new(code, modifiers));
}

fn type_keys(app: &mut App, text: &str) {
    for character in text.chars() {
        press(app, KeyCode::Char(character), KeyModifiers::NONE);
    }
}

fn render(app: &mut App, area: Rect) -> Buffer {
    let mut buffer = Buffer::empty(area);
    app.render(area, &mut buffer);
    buffer
}

fn render_mode(app: &mut App) -> Option<Mode> {
    let _ = render(app, Rect::new(0, 0, 160, 48));
    Some(app.mode)
}

fn buffer_text(buffer: &Buffer) -> String {
    buffer
        .content()
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>()
}

/// Opt-in captures contain the actual rendered cells, not a separate mockup.
fn capture(name: &str, buffer: &Buffer) {
    use ratatui::style::{Color, Modifier};
    use std::fmt::Write;
    let Ok(directory) = std::env::var("DIFFING_TUI_CAPTURE_DIR") else {
        return;
    };
    fs::create_dir_all(&directory).unwrap();
    let width = buffer.area.width as usize * 10;
    let height = buffer.area.height as usize * 20;
    let mut svg = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\"><style>text{{font-family:Menlo,monospace;font-size:16.5px;white-space:pre}}</style>");
    let color = |value: Color, fallback: &str| match value {
        Color::Rgb(r, g, b) => format!("#{r:02x}{g:02x}{b:02x}"),
        Color::Indexed(index @ 16..=231) => {
            let levels = [0, 95, 135, 175, 215, 255];
            let index = (index - 16) as usize;
            format!(
                "#{:02x}{:02x}{:02x}",
                levels[index / 36],
                levels[index / 6 % 6],
                levels[index % 6]
            )
        }
        Color::Indexed(index @ 232..=255) => {
            let gray = 8 + (index - 232) * 10;
            format!("#{gray:02x}{gray:02x}{gray:02x}")
        }
        Color::Reset => fallback.to_string(),
        _ => fallback.to_string(),
    };
    for y in 0..buffer.area.height {
        for x in 0..buffer.area.width {
            let cell = &buffer[(x, y)];
            let px = x as usize * 10;
            let py = y as usize * 20;
            write!(
                svg,
                "<rect x=\"{px}\" y=\"{py}\" width=\"10\" height=\"20\" fill=\"{}\"/>",
                color(cell.bg, "#0d1117")
            )
            .unwrap();
        }
    }
    for y in 0..buffer.area.height {
        for x in 0..buffer.area.width {
            let cell = &buffer[(x, y)];
            if cell.symbol().trim().is_empty() {
                continue;
            }
            let px = x as usize * 10;
            let py = y as usize * 20 + 15;
            let text = cell
                .symbol()
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            write!(
                svg,
                "<text x=\"{px}\" y=\"{py}\" fill=\"{}\" font-family=\"Menlo\" font-size=\"16.5\" opacity=\"{}\" font-weight=\"{}\">{text}</text>",
                color(cell.fg, "#e6edf3"),
                if cell.modifier.contains(Modifier::DIM) { "0.55" } else { "1" },
                if cell.modifier.contains(Modifier::BOLD) {
                    "bold"
                } else {
                    "normal"
                }
            )
            .unwrap();
        }
    }
    svg.push_str("</svg>");
    fs::write(Path::new(&directory).join(format!("{name}.svg")), svg).unwrap();
}
