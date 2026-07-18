//! File-tree sidebar using ratatui's built-in `Block` + `List` widgets.

use diffing_core::diff::FileDiff;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, List, ListItem, StatefulWidget, Widget};

use crate::themes::Palette;
use crate::ui::file_tree::{FileNodeKind, FileTree};

const FILE_TREE_TITLE: &str = " files ";

pub fn render_file_tree(
    tree: &FileTree,
    area: Rect,
    focused: bool,
    scroll: usize,
    palette: &Palette,
    _files: &[FileDiff],
    buf: &mut Buffer,
) {
    let border_color = if focused {
        palette.border_focused
    } else {
        palette.border
    };
    let title_style = Style::default().fg(palette.fg).add_modifier(Modifier::BOLD);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .style(Style::default().bg(palette.panel))
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(FILE_TREE_TITLE, title_style));
    let inner = block.inner(area);
    block.render(area, buf);

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
    ListItem::new(Line::from(spans))
}
