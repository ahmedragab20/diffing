//! Recursive file tree built from a `Vec<FileDiff>`.
//!
//! Renders as a flat list of `FileNode`s with `depth` driving the indent.
//! Directories are auto-expanded by default; collapse is delegated to a
//! later phase. Each file node carries its index into the original
//! `files` vec so the main view can jump to the corresponding diff.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use diffing_core::diff::FileDiff;

#[derive(Debug, Clone)]
pub struct FileNode {
    pub name: String,
    #[allow(dead_code)]
    pub path: PathBuf,
    pub depth: usize,
    pub kind: FileNodeKind,
    pub file_diff_idx: Option<usize>,
    pub expanded: bool,
    pub viewed: bool,
    pub comment_count: u32,
    pub change_marker: char,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileNodeKind {
    Dir,
    File,
}

pub struct FileTree {
    pub nodes: Vec<FileNode>,
    pub cursor: usize,
    all_nodes: Vec<FileNode>,
    filtered_file_indices: Vec<usize>,
    file_positions: HashMap<usize, usize>,
    collapsed: std::collections::HashSet<PathBuf>,
}

impl FileTree {
    pub fn build(files: &[FileDiff]) -> Self {
        let mut nodes: Vec<FileNode> = Vec::new();
        // Group files by directory, preserving the order in which files
        // appear in the diff. This matches `git diff` output ordering.
        let mut dir_order: Vec<PathBuf> = Vec::new();
        let mut dir_files: Vec<Vec<usize>> = Vec::new();
        let mut dir_positions: HashMap<PathBuf, usize> = HashMap::new();
        for (i, f) in files.iter().enumerate() {
            let path = f.display_path().to_path_buf();
            let parent = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
            if let Some(pos) = dir_positions.get(&parent).copied() {
                dir_files[pos].push(i);
            } else {
                dir_positions.insert(parent.clone(), dir_order.len());
                dir_order.push(parent);
                dir_files.push(vec![i]);
            }
        }

        for (dir, file_idxs) in dir_order.iter().zip(dir_files.iter()) {
            if !dir.as_os_str().is_empty() {
                nodes.push(FileNode {
                    name: display_dir_name(dir),
                    path: dir.clone(),
                    depth: dir.components().count().saturating_sub(1),
                    kind: FileNodeKind::Dir,
                    file_diff_idx: None,
                    expanded: true,
                    viewed: false,
                    comment_count: 0,
                    change_marker: ' ',
                });
            }
            for &i in file_idxs {
                let f = &files[i];
                let path = f.display_path();
                let name = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let depth = path.components().count().saturating_sub(1);
                let change_marker = change_marker_for(f);
                nodes.push(FileNode {
                    name,
                    path: path.to_path_buf(),
                    depth,
                    kind: FileNodeKind::File,
                    file_diff_idx: Some(i),
                    expanded: false,
                    viewed: false,
                    comment_count: 0,
                    change_marker,
                });
            }
        }

        let cursor = nodes
            .iter()
            .position(|n| n.kind == FileNodeKind::File)
            .unwrap_or(0);
        let mut tree = Self {
            all_nodes: nodes.clone(),
            nodes,
            cursor,
            filtered_file_indices: (0..files.len()).collect(),
            file_positions: HashMap::new(),
            collapsed: std::collections::HashSet::new(),
        };
        tree.rebuild_positions();
        tree
    }

    pub fn selected_file_idx(&self) -> Option<usize> {
        self.nodes.get(self.cursor).and_then(|n| n.file_diff_idx)
    }

    pub fn move_cursor(&mut self, delta: isize) {
        if self.nodes.is_empty() {
            return;
        }
        let len = self.nodes.len() as isize;
        let mut next = self.cursor as isize + delta;
        if next < 0 {
            next = 0;
        }
        if next >= len {
            next = len - 1;
        }
        self.cursor = next as usize;
    }

    pub fn jump_to_file(&mut self, file_idx: usize) {
        if let Some(position) = self.file_positions.get(&file_idx) {
            self.cursor = *position;
        }
    }

    pub fn collapse_selected(&mut self) {
        let Some(node) = self.nodes.get(self.cursor) else {
            return;
        };
        if node.kind != FileNodeKind::Dir {
            return;
        }
        self.collapsed.insert(node.path.clone());
        self.rebuild_visible(Some(node.path.clone()));
    }

    pub fn expand_selected(&mut self) {
        let Some(node) = self.nodes.get(self.cursor) else {
            return;
        };
        if node.kind != FileNodeKind::Dir {
            return;
        }
        self.collapsed.remove(&node.path);
        self.rebuild_visible(Some(node.path.clone()));
    }

    pub fn toggle_selected(&mut self) {
        let Some(node) = self.nodes.get(self.cursor) else {
            return;
        };
        if node.kind != FileNodeKind::Dir {
            return;
        }
        if self.collapsed.contains(&node.path) {
            self.expand_selected();
        } else {
            self.collapse_selected();
        }
    }

    pub fn set_viewed(&mut self, file_idx: usize, viewed: bool) {
        for node in self
            .nodes
            .iter_mut()
            .chain(self.all_nodes.iter_mut())
            .filter(|node| node.file_diff_idx == Some(file_idx))
        {
            node.viewed = viewed;
        }
    }

    pub fn set_comment_count(&mut self, file_idx: usize, count: u32) {
        for node in self
            .nodes
            .iter_mut()
            .chain(self.all_nodes.iter_mut())
            .filter(|node| node.file_diff_idx == Some(file_idx))
        {
            node.comment_count = count;
        }
    }

    pub fn apply_filter(&mut self, query: &str, unviewed_only: bool, comments_only: bool) {
        let query = query.trim().to_ascii_lowercase();
        let matching_files: Vec<usize> = self
            .all_nodes
            .iter()
            .filter(|node| node.kind == FileNodeKind::File)
            .filter(|node| {
                query.is_empty()
                    || node
                        .path
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .contains(&query)
            })
            .filter(|node| !unviewed_only || !node.viewed)
            .filter(|node| !comments_only || node.comment_count > 0)
            .filter_map(|node| node.file_diff_idx)
            .collect();
        let selected = self.nodes.get(self.cursor).map(|node| node.path.clone());
        self.filtered_file_indices = matching_files;
        self.rebuild_visible(selected);
    }

    fn rebuild_visible(&mut self, selected_path: Option<PathBuf>) {
        let filtered = &self.filtered_file_indices;
        self.nodes = self
            .all_nodes
            .iter()
            .filter(|node| match node.kind {
                FileNodeKind::File => node
                    .file_diff_idx
                    .is_some_and(|index| filtered.contains(&index)),
                FileNodeKind::Dir => self.all_nodes.iter().any(|file| {
                    file.file_diff_idx
                        .is_some_and(|index| filtered.contains(&index))
                        && file.path.starts_with(&node.path)
                }),
            })
            .filter(|node| {
                node.kind == FileNodeKind::Dir
                    || !self
                        .collapsed
                        .iter()
                        .any(|directory| node.path.starts_with(directory))
            })
            .cloned()
            .collect();
        for node in &mut self.nodes {
            if node.kind == FileNodeKind::Dir {
                node.expanded = !self.collapsed.contains(&node.path);
            }
        }
        self.cursor = selected_path
            .as_ref()
            .and_then(|path| self.nodes.iter().position(|node| &node.path == path))
            .or_else(|| {
                self.nodes
                    .iter()
                    .position(|node| node.kind == FileNodeKind::File)
            })
            .unwrap_or(0);
        self.rebuild_positions();
    }

    fn rebuild_positions(&mut self) {
        self.file_positions = self
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(position, node)| node.file_diff_idx.map(|index| (index, position)))
            .collect();
    }
}

fn display_dir_name(dir: &Path) -> String {
    let s = dir.to_string_lossy();
    if s.is_empty() {
        ".".to_string()
    } else {
        s.trim_end_matches('/').to_string()
    }
}

fn change_marker_for(f: &FileDiff) -> char {
    use diffing_core::diff::ChangeKind::*;
    match f.kind {
        Modified => 'M',
        Added => 'A',
        Deleted => 'D',
        Renamed => 'R',
        Untracked => 'U',
        Binary => 'B',
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diffing_core::diff::{ChangeKind, FileDiff};

    fn fd(name: &str, kind: ChangeKind) -> FileDiff {
        FileDiff {
            old_path: None,
            new_path: Some(PathBuf::from(name)),
            kind,
            is_binary: false,
            hunks: Vec::new(),
        }
    }

    #[test]
    fn groups_files_by_parent_directory() {
        let files = vec![
            fd("src/a.rs", ChangeKind::Modified),
            fd("src/b.rs", ChangeKind::Added),
            fd("README.md", ChangeKind::Modified),
        ];
        let tree = FileTree::build(&files);
        // 1 dir + 2 src files + 1 root file = 4 nodes
        assert_eq!(tree.nodes.len(), 4);
        assert_eq!(tree.nodes[0].kind, FileNodeKind::Dir);
        assert_eq!(tree.nodes[0].name, "src");
        assert_eq!(tree.nodes[1].file_diff_idx, Some(0));
        assert_eq!(tree.nodes[2].file_diff_idx, Some(1));
        assert_eq!(tree.nodes[3].kind, FileNodeKind::File);
        assert_eq!(tree.nodes[3].file_diff_idx, Some(2));
    }

    #[test]
    fn cursor_starts_on_first_file() {
        let files = vec![fd("a.rs", ChangeKind::Modified)];
        let tree = FileTree::build(&files);
        assert_eq!(tree.selected_file_idx(), Some(0));
    }

    #[test]
    fn cursor_moves_within_bounds() {
        let files = vec![
            fd("a.rs", ChangeKind::Modified),
            fd("b.rs", ChangeKind::Modified),
        ];
        let mut tree = FileTree::build(&files);
        // 1 file, so cursor can't go up to a dir
        tree.move_cursor(1);
        assert_eq!(tree.selected_file_idx(), Some(1));
        tree.move_cursor(5);
        assert_eq!(tree.selected_file_idx(), Some(1));
        tree.move_cursor(-10);
        assert_eq!(tree.selected_file_idx(), Some(0));
    }

    #[test]
    fn change_markers_match_kind() {
        assert_eq!(change_marker_for(&fd("x", ChangeKind::Modified)), 'M');
        assert_eq!(change_marker_for(&fd("x", ChangeKind::Added)), 'A');
        assert_eq!(change_marker_for(&fd("x", ChangeKind::Deleted)), 'D');
        assert_eq!(change_marker_for(&fd("x", ChangeKind::Renamed)), 'R');
    }

    #[test]
    fn filters_preserve_original_file_indices() {
        let files = vec![
            fd("src/alpha.rs", ChangeKind::Modified),
            fd("src/beta.rs", ChangeKind::Added),
        ];
        let mut tree = FileTree::build(&files);
        tree.apply_filter("beta", false, false);
        assert_eq!(tree.selected_file_idx(), Some(1));
    }

    #[test]
    fn filters_survive_directory_collapse_and_expand() {
        let files = vec![
            fd("src/alpha.rs", ChangeKind::Modified),
            fd("src/beta.rs", ChangeKind::Added),
            fd("docs/beta.md", ChangeKind::Modified),
        ];
        let mut tree = FileTree::build(&files);
        tree.apply_filter("alpha", false, false);
        tree.cursor = 0;
        tree.collapse_selected();
        tree.expand_selected();
        assert_eq!(
            tree.nodes
                .iter()
                .filter_map(|node| node.file_diff_idx)
                .collect::<Vec<_>>(),
            vec![0]
        );
    }

    #[test]
    fn directories_collapse_without_losing_file_positions() {
        let files = vec![
            fd("src/a.rs", ChangeKind::Modified),
            fd("src/b.rs", ChangeKind::Added),
            fd("README.md", ChangeKind::Modified),
        ];
        let mut tree = FileTree::build(&files);
        tree.cursor = 0;
        tree.collapse_selected();
        assert_eq!(tree.nodes.len(), 2);
        assert!(!tree.nodes[0].expanded);
        tree.expand_selected();
        assert_eq!(tree.nodes.len(), 4);
        tree.jump_to_file(1);
        assert_eq!(tree.selected_file_idx(), Some(1));
    }
}
