use std::io::stdout;
use std::time::Duration;

use anyhow::{Context, Result};
use crossterm::event::{
    DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyModifiers,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use crate::app::App;

struct TerminalGuard;

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        disable_raw_mode().ok();
        execute!(stdout(), LeaveAlternateScreen, DisableMouseCapture).ok();
    }
}

pub fn run(_repo_root: &str, app: &mut App) -> Result<()> {
    let mut stdout = stdout();
    enable_raw_mode().context("enabling raw mode")?;
    let _guard = TerminalGuard;
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)
        .context("entering alternate screen")?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).context("creating ratatui terminal")?;

    let result = event_loop(&mut terminal, app);

    terminal.show_cursor().ok();

    result
}

fn event_loop<B: ratatui::backend::Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
) -> Result<()> {
    let poll_interval = Duration::from_millis(40);
    let mut dirty = true;
    loop {
        if dirty {
            let size = terminal.size().context("reading terminal size")?;
            let rect = ratatui::layout::Rect::new(0, 0, size.width, size.height);
            terminal.draw(|frame| {
                app.render(rect, frame.buffer_mut());
            })?;
            dirty = false;
        }
        if crossterm::event::poll(poll_interval).context("polling input")? {
            match crossterm::event::read().context("reading input")? {
                Event::Key(key) => {
                    if is_global_quit(&key) {
                        return Ok(());
                    }
                    app.handle_key(key);
                    dirty = true;
                }
                Event::Resize(_, _) => dirty = true,
                Event::Mouse(mouse) => {
                    app.handle_mouse(mouse);
                    dirty = true;
                }
                _ => {}
            }
        }
        dirty |= app.poll_background();
        dirty |= app.has_animations();
        if app.quit {
            return Ok(());
        }
    }
}

fn is_global_quit(key: &KeyEvent) -> bool {
    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
        return true;
    }
    false
}
