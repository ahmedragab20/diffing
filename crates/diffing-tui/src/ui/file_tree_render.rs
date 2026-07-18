//! File-tree sidebar using ratatui's built-in `Block` + `List` widgets.

use diffing_core::diff::FileDiff;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, StatefulWidget};

use crate::themes::Palette;
use crate::ui::file_tree::{FileNodeKind, FileTree};
use crate::ui::gridline::{fill, focus_rail};

pub fn render_file_tree(
    tree: &FileTree,
    area: Rect,
    focused: bool,
    scroll: usize,
    palette: &Palette,
    files: &[FileDiff],
    buf: &mut Buffer,
) {
    fill(area, palette.panel, buf);
    focus_rail(area, focused, palette, buf);
    if area.width > 0 {
        for y in area.y..area.y.saturating_add(area.height) {
            buf[(area.x + area.width - 1, y)]
                .set_symbol("│")
                .set_style(Style::default().fg(palette.border).bg(palette.panel));
        }
    }
    buf.set_string(
        area.x + 2,
        area.y,
        "FILES",
        Style::default()
            .fg(palette.fg)
            .bg(palette.panel)
            .add_modifier(Modifier::BOLD),
    );
    let count = files.len().to_string();
    if count.len() as u16 + 3 < area.width {
        buf.set_string(
            area.x + area.width - count.len() as u16 - 2,
            area.y,
            count,
            Style::default().fg(palette.dim).bg(palette.panel),
        );
    }
    let inner = Rect::new(
        area.x.saturating_add(1),
        area.y.saturating_add(1),
        area.width.saturating_sub(2),
        area.height.saturating_sub(2),
    );

    let body_height = inner.height as usize;
    let items: Vec<ListItem> = tree
        .nodes
        .iter()
        .skip(scroll)
        .take(body_height)
        .map(|node| build_item(node, tree, focused, palette))
        .collect();
    let list = List::new(items).highlight_style(
        Style::default()
            .bg(palette.selection_bg)
            .add_modifier(Modifier::BOLD),
    );
    let mut state = ratatui::widgets::ListState::default();
    let visible_cursor = tree.cursor.saturating_sub(scroll);
    if visible_cursor < body_height {
        state.select(Some(visible_cursor));
    }
    StatefulWidget::render(&list, inner, buf, &mut state);
}

fn build_item<'a>(
    node: &'a crate::ui::file_tree::FileNode,
    tree: &FileTree,
    focused: bool,
    palette: &Palette,
) -> ListItem<'a> {
    let indent = "  ".repeat(node.depth);
    let (kind_str, kind_color) = match node.kind {
        FileNodeKind::Dir => (
            if node.expanded { "▼ " } else { "▶ " }.to_string(),
            palette.accent,
        ),
        FileNodeKind::File => {
            let marker_color = match node.change_marker {
                'M' => palette.accent,
                'A' => palette.added,
                'D' => palette.removed,
                'R' => palette.accent,
                'B' => palette.comment,
                _ => palette.dim,
            };
            (format!("{} ", node.change_marker), marker_color)
        }
    };
    let is_cursor = node.name.as_str()
        == tree.nodes[tree.cursor.min(tree.nodes.len().saturating_sub(1))]
            .name
            .as_str();
    let cursor_marker = if is_cursor { "▶ " } else { "  " };
    let cursor_color = if is_cursor && focused {
        palette.accent
    } else {
        palette.dim
    };
    let viewed_dot = if node.viewed { " ✓" } else { "" };

    let mut spans: Vec<Span<'a>> = vec![
        Span::styled(cursor_marker.to_string(), Style::default().fg(cursor_color)),
        Span::raw(indent),
        Span::styled(kind_str, Style::default().fg(kind_color)),
        Span::raw(node.name.clone()),
    ];
    if !viewed_dot.is_empty() {
        spans.push(Span::styled(
            viewed_dot.to_string(),
            Style::default().fg(palette.dim),
        ));
    }
    if node.comment_count > 0 {
        spans.push(Span::styled(
            format!("  [{}]", node.comment_count),
            Style::default().fg(palette.comment),
        ));
    }
    ListItem::new(Line::from(spans))
}
