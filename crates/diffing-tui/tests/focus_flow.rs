use std::fs;
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use diffing_tui::app::{App, Experience, Focus, Mode};
use diffing_tui::diff_context::DiffContext;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

const INDEX_TIMEOUT: Duration = Duration::from_secs(30);

#[test]
fn focus_mode_preserves_review_preferences_and_navigation() {
    let repo = tempfile::tempdir().expect("create temporary repo");
    let storage = tempfile::tempdir().expect("create isolated storage");
    let config = tempfile::tempdir().expect("create isolated config");
    std::env::set_var("DIFFING_STORAGE_ROOT", storage.path());
    std::env::set_var("DIFFING_CONFIG_DIR", config.path());
    write_fixture(repo.path());

    let mut app = App::new(
        repo.path().to_path_buf(),
        Vec::new(),
        Experience::Review,
        DiffContext::from_env_or_args(&[]),
        None,
    )
    .unwrap_or_else(|error| panic!("startup error: {error:#}"));
    let started = Instant::now();
    while !app.index.complete {
        app.tick_index();
        assert!(
            started.elapsed() < INDEX_TIMEOUT,
            "index did not complete within 30s"
        );
        thread::sleep(Duration::from_millis(1));
    }

    let area = Rect::new(0, 0, 140, 30);
    let initial = render(&mut app, area);
    let initial_text = buffer_text(&initial);
    assert!(initial_text.contains("Changes"));
    assert!(initial_text.contains("0/2 viewed"));

    let sidebar_before = app.sidebar_visible;
    let comments_before = app.comments_visible;
    press(&mut app, KeyCode::Char('z'), KeyModifiers::NONE);
    press(&mut app, KeyCode::Char('f'), KeyModifiers::NONE);
    assert!(app.focus_mode);
    assert_eq!(app.focus, Focus::Diff);
    assert_eq!(app.sidebar_visible, sidebar_before);
    assert_eq!(app.comments_visible, comments_before);
    let focused_text = buffer_text(&render(&mut app, area));
    assert!(focused_text.contains("Focus mode"));
    assert!(focused_text.contains("focus_alpha"));
    assert!(!focused_text.contains("Changes"));

    press(&mut app, KeyCode::Char('z'), KeyModifiers::NONE);
    press(&mut app, KeyCode::Char('f'), KeyModifiers::NONE);
    assert!(!app.focus_mode);
    assert_eq!(app.sidebar_visible, sidebar_before);
    assert_eq!(app.comments_visible, comments_before);
    assert!(buffer_text(&render(&mut app, area)).contains("Changes"));

    press(&mut app, KeyCode::Char('z'), KeyModifiers::NONE);
    press(&mut app, KeyCode::Char('f'), KeyModifiers::NONE);
    press(&mut app, KeyCode::Tab, KeyModifiers::NONE);
    assert!(!app.focus_mode);
    assert_eq!(app.focus, Focus::FileTree);
    assert!(buffer_text(&render(&mut app, area)).contains("Changes"));
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert_eq!(app.focus, Focus::Diff);

    press(&mut app, KeyCode::Char('v'), KeyModifiers::NONE);
    let viewed_text = buffer_text(&render(&mut app, area));
    assert!(viewed_text.contains("1/2 viewed"));
    assert!(viewed_text.contains("✓ Viewed"));
    let buffer = render(&mut app, area);
    let (column, row) = (0..area.height)
        .find_map(|y| {
            let row = (0..area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>();
            row.find("v ✓ Viewed")
                .map(|byte| (row[..byte].chars().count() as u16, y))
        })
        .expect("visible viewed action");
    app.handle_mouse(MouseEvent {
        kind: MouseEventKind::Down(MouseButton::Left),
        column,
        row,
        modifiers: KeyModifiers::NONE,
    });
    assert!(
        buffer_text(&render(&mut app, area)).contains("0/2 viewed"),
        "pointer action should unmark the file"
    );

    press(&mut app, KeyCode::Char('p'), KeyModifiers::CONTROL);
    type_keys(&mut app, "focused reading");
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert_eq!(app.mode, Mode::Normal);
    assert!(app.focus_mode);
}

fn write_fixture(root: &Path) {
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(root)
        .status()
        .expect("git init")
        .success());
    fs::create_dir_all(root.join("src")).expect("create src");
    fs::write(root.join("src/alpha.rs"), "pub fn alpha() {\n    1\n}\n").expect("write alpha base");
    fs::write(root.join("src/beta.rs"), "pub fn beta() {\n    2\n}\n").expect("write beta base");
    assert!(Command::new("git")
        .args(["add", "."])
        .current_dir(root)
        .status()
        .expect("git add")
        .success());
    fs::write(
        root.join("src/alpha.rs"),
        "pub fn alpha() {\n    focus_alpha();\n}\n",
    )
    .expect("modify alpha");
    fs::write(
        root.join("src/beta.rs"),
        "pub fn beta() {\n    focus_beta();\n}\n",
    )
    .expect("modify beta");
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

fn buffer_text(buffer: &Buffer) -> String {
    buffer.content().iter().map(|cell| cell.symbol()).collect()
}
