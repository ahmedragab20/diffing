use std::io::{stdout, Stdout, Write};
use std::path::Path;
use std::process::Command;
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

use crate::app::{App, EditorTarget};

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
    execute!(stdout, EnterAlternateScreen).context("entering alternate screen")?;
    let mut mouse_capture_enabled = false;
    sync_mouse_capture(&mut stdout, &mut mouse_capture_enabled, app.mouse_enabled)
        .context("configuring mouse capture")?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).context("creating ratatui terminal")?;

    let result = event_loop(&mut terminal, app, mouse_capture_enabled);

    terminal.show_cursor().ok();

    result
}

fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    app: &mut App,
    mut mouse_capture_enabled: bool,
) -> Result<()> {
    let poll_interval = Duration::from_millis(40);
    const MAX_EVENTS_PER_FRAME: usize = 256;
    let mut dirty = true;
    loop {
        if mouse_capture_enabled != app.mouse_enabled {
            sync_mouse_capture(&mut stdout(), &mut mouse_capture_enabled, app.mouse_enabled)
                .context("updating mouse capture")?;
            dirty = true;
        }
        if dirty {
            let size = terminal.size().context("reading terminal size")?;
            let rect = ratatui::layout::Rect::new(0, 0, size.width, size.height);
            terminal.draw(|frame| {
                app.render(rect, frame.buffer_mut());
            })?;
            dirty = false;
        }
        if crossterm::event::poll(poll_interval).context("polling input")? {
            // Terminals can enqueue wheel events much faster than a complex
            // diff frame can be painted. Apply a bounded burst and render its
            // final state once, preventing stale frames from backing up in the
            // terminal output stream while keeping key input responsive.
            for event_index in 0..MAX_EVENTS_PER_FRAME {
                match crossterm::event::read().context("reading input")? {
                    Event::Key(key) => {
                        if is_global_quit(&key) {
                            return Ok(());
                        }
                        app.handle_key(key);
                        if let Some(target) = app.take_editor_target() {
                            open_editor(terminal, &target, &mut mouse_capture_enabled)?;
                        }
                        dirty = true;
                    }
                    Event::Resize(_, _) => dirty = true,
                    Event::Mouse(mouse) => {
                        dirty |= app.handle_mouse(mouse);
                    }
                    _ => {}
                }
                if event_index + 1 == MAX_EVENTS_PER_FRAME
                    || !crossterm::event::poll(Duration::ZERO).context("checking queued input")?
                {
                    break;
                }
            }
        }
        dirty |= app.poll_background();
        dirty |= app.has_animations();
        if app.quit {
            return Ok(());
        }
    }
}

fn open_editor(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    target: &EditorTarget,
    mouse_capture_enabled: &mut bool,
) -> Result<()> {
    terminal.show_cursor().ok();
    disable_raw_mode().context("leaving raw mode for editor")?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )
    .context("suspending diff viewer")?;
    *mouse_capture_enabled = false;

    let result = run_editor(target);

    execute!(terminal.backend_mut(), EnterAlternateScreen)
        .context("restoring diff viewer screen")?;
    enable_raw_mode().context("restoring raw mode after editor")?;
    terminal.clear().context("redrawing after editor")?;
    result
}

fn run_editor(target: &EditorTarget) -> Result<()> {
    let configured = std::env::var("VISUAL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("EDITOR")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| "vi".to_string());
    let argv =
        split_command_line(&configured).context("$VISUAL/$EDITOR contains invalid quoting")?;
    let (program, preset) = argv.split_first().context("$VISUAL/$EDITOR is empty")?;
    let mut command = Command::new(program);
    command.args(preset);
    let name = Path::new(program)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(program.as_str());
    match name {
        "code" | "codium" | "zed" | "subl" => {
            command.arg("--goto").arg(format!(
                "{}:{}:{}",
                target.path.display(),
                target.line,
                target.column
            ));
        }
        "emacs" | "emacsclient" => {
            command
                .arg(format!("+{}:{}", target.line, target.column))
                .arg(&target.path);
        }
        _ => {
            command.arg(format!("+{}", target.line)).arg(&target.path);
        }
    }
    let status = command
        .status()
        .with_context(|| format!("starting editor `{program}`"))?;
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("editor `{program}` exited with {status}")
    }
}

fn split_command_line(value: &str) -> Option<Vec<String>> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if matches!(character, '\'' | '"') {
            if quote == Some(character) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(character);
            } else {
                current.push(character);
            }
            continue;
        }
        if character.is_whitespace() && quote.is_none() {
            if !current.is_empty() {
                args.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if escaped || quote.is_some() {
        return None;
    }
    if !current.is_empty() {
        args.push(current);
    }
    Some(args)
}

fn sync_mouse_capture(
    writer: &mut impl Write,
    enabled: &mut bool,
    desired: bool,
) -> std::io::Result<()> {
    if *enabled == desired {
        return Ok(());
    }
    if desired {
        execute!(writer, EnableMouseCapture)?;
    } else {
        execute!(writer, DisableMouseCapture)?;
    }
    *enabled = desired;
    Ok(())
}

fn is_global_quit(key: &KeyEvent) -> bool {
    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_command_parser_preserves_quoted_arguments() {
        assert_eq!(
            split_command_line("code --profile 'Diff Review'"),
            Some(vec![
                "code".into(),
                "--profile".into(),
                "Diff Review".into()
            ])
        );
        assert_eq!(split_command_line("code 'unfinished"), None);
    }

    #[test]
    fn mouse_capture_only_emits_when_the_setting_changes() {
        let mut output = Vec::new();
        let mut enabled = false;

        sync_mouse_capture(&mut output, &mut enabled, false).unwrap();
        assert!(output.is_empty());

        sync_mouse_capture(&mut output, &mut enabled, true).unwrap();
        assert!(enabled);
        let enabled_bytes = output.len();
        assert!(enabled_bytes > 0);

        sync_mouse_capture(&mut output, &mut enabled, true).unwrap();
        assert_eq!(output.len(), enabled_bytes);

        sync_mouse_capture(&mut output, &mut enabled, false).unwrap();
        assert!(!enabled);
        assert!(output.len() > enabled_bytes);
    }
}
