//! Quiet file rail shared by review and focused viewer modes.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, StatefulWidget};

use crate::themes::Palette;
use crate::ui::file_tree::{FileNodeKind, FileTree};
use crate::ui::gridline::{
    fill, safe_terminal_text, selected_row_style, selection_marker, GridlineTokens, METRICS,
};

#[derive(Debug, Clone, Copy)]
pub struct FileTreeRenderOptions {
    pub focused: bool,
    pub scroll: usize,
    pub minimal: bool,
    pub file_count: usize,
    pub visible_file_count: usize,
    pub filter_label: &'static str,
}

pub fn render_file_tree(
    tree: &FileTree,
    area: Rect,
    options: FileTreeRenderOptions,
    palette: &Palette,
    buf: &mut Buffer,
) {
    let FileTreeRenderOptions {
        focused,
        scroll,
        minimal,
        file_count,
        visible_file_count,
        filter_label,
    } = options;
    let tokens = GridlineTokens::from(palette);
    let surface = if minimal {
        tokens.canvas
    } else {
        tokens.surface
    };
    fill(area, surface, buf);
    if !minimal {
        buf.set_string(
            area.x + METRICS.inline_pad,
            area.y,
            if filter_label == "All" {
                "Changes".to_string()
            } else {
                format!("Changes · {filter_label}")
            },
            Style::default()
                .fg(tokens.text)
                .bg(surface)
                .add_modifier(Modifier::BOLD),
        );
        let count = if visible_file_count == file_count {
            file_count.to_string()
        } else {
            format!("{visible_file_count}/{file_count}")
        };
        if count.len() as u16 + 3 < area.width {
            buf.set_string(
                area.x + area.width - count.len() as u16 - METRICS.inline_pad,
                area.y,
                count,
                Style::default().fg(tokens.muted).bg(surface),
            );
        }
    }
    let inner = content_area(area, minimal);

    if tree.nodes.is_empty() && inner.width > 0 && inner.height > 0 {
        buf.set_stringn(
            inner.x + 1,
            inner.y,
            "No files match this filter",
            inner.width.saturating_sub(2) as usize,
            Style::default().fg(tokens.muted).bg(surface),
        );
        return;
    }

    let body_height = inner.height as usize;
    let items: Vec<ListItem> = tree
        .nodes
        .iter()
        .enumerate()
        .skip(scroll)
        .take(body_height)
        .map(|(index, node)| build_item(node, index == tree.cursor, focused, palette))
        .collect();
    let list = List::new(items).highlight_style(selected_row_style(true, palette));
    let mut state = ratatui::widgets::ListState::default();
    let visible_cursor = tree.cursor.saturating_sub(scroll);
    if visible_cursor < body_height {
        state.select(Some(visible_cursor));
    }
    StatefulWidget::render(&list, inner, buf, &mut state);
}

pub fn content_area(area: Rect, minimal: bool) -> Rect {
    Rect::new(
        area.x.saturating_add(METRICS.compact_pad),
        area.y.saturating_add(u16::from(!minimal)),
        area.width
            .saturating_sub(METRICS.compact_pad.saturating_mul(2)),
        area.height.saturating_sub(if minimal { 0 } else { 2 }),
    )
}

fn build_item<'a>(
    node: &'a crate::ui::file_tree::FileNode,
    is_cursor: bool,
    focused: bool,
    palette: &Palette,
) -> ListItem<'a> {
    let tokens = GridlineTokens::from(palette);
    let indent = "  ".repeat(node.depth);
    let (kind_str, kind_color) = match node.kind {
        FileNodeKind::Dir => (
            if node.expanded { "▾ " } else { "▸ " }.to_string(),
            if is_cursor {
                tokens.accent
            } else {
                tokens.muted
            },
        ),
        FileNodeKind::File => {
            let marker_color = match node.change_marker {
                'M' => tokens.accent,
                'A' => tokens.positive,
                'D' => tokens.negative,
                'R' => tokens.accent,
                'B' => tokens.info,
                _ => tokens.muted,
            };
            (format!("{} ", node.change_marker), marker_color)
        }
    };
    let viewed_dot = if node.viewed { " ✓" } else { "" };
    let name_color = if node.kind == FileNodeKind::Dir && !is_cursor {
        tokens.muted
    } else {
        tokens.text
    };

    let mut spans: Vec<Span<'a>> = vec![
        selection_marker(is_cursor, focused, palette),
        Span::raw(" "),
        Span::raw(indent),
        Span::styled(kind_str, Style::default().fg(kind_color)),
        Span::styled(
            safe_terminal_text(&node.name),
            Style::default().fg(name_color),
        ),
    ];
    if !viewed_dot.is_empty() {
        spans.push(Span::styled(
            viewed_dot.to_string(),
            Style::default().fg(tokens.muted),
        ));
    }
    if node.comment_count > 0 {
        spans.push(Span::styled(
            format!("  [{}]", node.comment_count),
            Style::default().fg(tokens.info),
        ));
    }
    if node.kind == FileNodeKind::File && (node.additions > 0 || node.deletions > 0) {
        spans.push(Span::raw("  "));
        if node.additions > 0 {
            spans.push(Span::styled(
                format!("+{}", node.additions),
                Style::default().fg(tokens.positive),
            ));
        }
        if node.additions > 0 && node.deletions > 0 {
            spans.push(Span::raw(" "));
        }
        if node.deletions > 0 {
            spans.push(Span::styled(
                format!("-{}", node.deletions),
                Style::default().fg(tokens.negative),
            ));
        }
    }
    ListItem::new(Line::from(spans))
}
