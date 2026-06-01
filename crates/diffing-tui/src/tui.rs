use std::io::stdout;
use std::time::Duration;

use anyhow::{Context, Result};
use crossterm::event::{DisableMouseCapture, Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use crate::app::App;

pub fn run(_repo_root: &str, app: &mut App) -> Result<()> {
    let mut stdout = stdout();
    enable_raw_mode().context("enabling raw mode")?;
    execute!(stdout, EnterAlternateScreen, DisableMouseCapture)
        .context("entering alternate screen")?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).context("creating ratatui terminal")?;

    let result = event_loop(&mut terminal, app);

    disable_raw_mode().ok();
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture,
    )
    .ok();
    terminal.show_cursor().ok();

    result
}

fn event_loop<B: ratatui::backend::Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
) -> Result<()> {
    let tick = Duration::from_millis(80);
    loop {
        let size = terminal.size().context("reading terminal size")?;
        let rect = ratatui::layout::Rect::new(0, 0, size.width, size.height);
        terminal.draw(|frame| {
            app.render(rect, frame.buffer_mut());
        })?;
        if crossterm::event::poll(tick).context("polling input")? {
            if let Event::Key(key) = crossterm::event::read().context("reading input")? {
                if is_global_quit(&key) {
                    return Ok(());
                }
                app.handle_key(key);
            }
        }
        if app.quit {
            return Ok(());
        }
    }
}

fn is_global_quit(key: &KeyEvent) -> bool {
    if key.code == KeyCode::Esc {
        return true;
    }
    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
        return true;
    }
    if key.code == KeyCode::Char('q') && !key.modifiers.contains(KeyModifiers::CONTROL) {
        return true;
    }
    false
}
