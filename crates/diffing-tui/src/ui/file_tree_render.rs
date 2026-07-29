//! Quiet file rail shared by review and focused viewer modes.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, StatefulWidget};
use unicode_width::UnicodeWidthStr;

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
        .map(|(index, node)| build_item(node, index == tree.cursor, focused, inner.width, palette))
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

fn build_item(
    node: &crate::ui::file_tree::FileNode,
    is_cursor: bool,
    focused: bool,
    width: u16,
    palette: &Palette,
) -> ListItem<'static> {
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
    let name_color = if node.kind == FileNodeKind::Dir && !is_cursor {
        tokens.muted
    } else {
        tokens.text
    };

    let mut spans: Vec<Span<'static>> = vec![
        selection_marker(is_cursor, focused, palette),
        Span::raw(" "),
        Span::raw(indent.clone()),
        Span::styled(kind_str, Style::default().fg(kind_color)),
    ];

    let prefix_width = 4usize
        .saturating_add(UnicodeWidthStr::width(indent.as_str()))
        .min(width as usize);
    let mut stats: Vec<Span<'static>> = Vec::new();
    if node.kind == FileNodeKind::File {
        if node.comment_count > 0 {
            stats.push(Span::styled(
                format!("  [{}]", node.comment_count),
                Style::default().fg(tokens.info),
            ));
        }
        if node.additions > 0 {
            stats.push(Span::styled(
                format!("  +{}", node.additions),
                Style::default().fg(tokens.positive),
            ));
        }
        if node.deletions > 0 {
            stats.push(Span::styled(
                format!("  -{}", node.deletions),
                Style::default().fg(tokens.negative),
            ));
        }
    }

    let available = (width as usize).saturating_sub(prefix_width);
    // On narrow rails, keep review state before diff counts; the active-file
    // header still owns the complete count summary.
    if spans_width(&stats).saturating_add(4) > available {
        stats.retain(|span| span.content.contains('['));
    }
    if spans_width(&stats).saturating_add(4) > available {
        stats.clear();
    }

    let stats_width = spans_width(&stats);
    let gap_width = usize::from(!stats.is_empty());
    let name_budget = available
        .saturating_sub(stats_width)
        .saturating_sub(gap_width);
    let mut name = safe_terminal_text(&node.name);
    if node.viewed {
        name.push_str(" ✓");
    }
    let name = ellipsize(&name, name_budget);
    let name_width = UnicodeWidthStr::width(name.as_str());
    spans.push(Span::styled(name, Style::default().fg(name_color)));
    if !stats.is_empty() {
        let gap = available
            .saturating_sub(name_width)
            .saturating_sub(stats_width)
            .max(1);
        spans.push(Span::raw(" ".repeat(gap)));
        spans.extend(stats);
    }
    ListItem::new(Line::from(spans))
}

fn spans_width(spans: &[Span<'_>]) -> usize {
    spans
        .iter()
        .map(|span| UnicodeWidthStr::width(span.content.as_ref()))
        .sum()
}

fn ellipsize(value: &str, max_width: usize) -> String {
    if UnicodeWidthStr::width(value) <= max_width {
        return value.to_string();
    }
    if max_width == 0 {
        return String::new();
    }
    let mut shortened = String::new();
    let mut used = 0usize;
    for character in value.chars() {
        let character_width = unicode_width::UnicodeWidthChar::width(character).unwrap_or(0);
        if used.saturating_add(character_width) > max_width.saturating_sub(1) {
            break;
        }
        shortened.push(character);
        used = used.saturating_add(character_width);
    }
    shortened.push('…');
    shortened
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    use ratatui::widgets::Widget;

    use crate::ui::file_tree::FileNode;

    fn file_node() -> FileNode {
        FileNode {
            name: "long-renderer-name.rs".to_string(),
            path: PathBuf::from("src/long-renderer-name.rs"),
            depth: 1,
            kind: FileNodeKind::File,
            file_diff_idx: Some(0),
            expanded: false,
            viewed: false,
            comment_count: 2,
            change_marker: 'M',
            additions: 12,
            deletions: 3,
        }
    }

    fn render_row(width: u16) -> String {
        let area = Rect::new(0, 0, width, 1);
        let mut buffer = Buffer::empty(area);
        Widget::render(
            List::new(vec![build_item(
                &file_node(),
                true,
                true,
                width,
                &Palette::default(),
            )]),
            area,
            &mut buffer,
        );
        (0..width)
            .map(|x| buffer[(x, 0)].symbol())
            .collect::<String>()
    }

    #[test]
    fn file_rows_align_review_and_change_metadata_to_the_right() {
        let rendered = render_row(40);
        assert!(rendered.contains("long-renderer-name…"));
        assert!(rendered.ends_with("[2]  +12  -3"));
    }

    #[test]
    fn narrow_file_rows_preserve_name_and_review_count() {
        let rendered = render_row(20);
        assert!(rendered.contains("long-re…"));
        assert!(rendered.ends_with("[2]"));
        assert!(!rendered.contains("+12"));
    }

    #[test]
    fn ellipsis_respects_wide_terminal_cells() {
        assert!(UnicodeWidthStr::width(ellipsize("界面renderer", 7).as_str()) <= 7);
    }
}
