//! Recursive file tree built from a `Vec<FileDiff>`.
//!
//! Renders as a flat list of `FileNode`s with `depth` driving the indent.
//! Directories are auto-expanded by default; collapse is delegated to a
//! later phase. Each file node carries its index into the original
//! `files` vec so the main view can jump to the corresponding diff.

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
    #[allow(dead_code)]
    pub expanded: bool,
    pub viewed: bool,
    #[allow(dead_code)]
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
}

impl FileTree {
    pub fn build(files: &[FileDiff]) -> Self {
        let mut nodes: Vec<FileNode> = Vec::new();
        // Group files by directory, preserving the order in which files
        // appear in the diff. This matches `git diff` output ordering.
        let mut dir_order: Vec<PathBuf> = Vec::new();
        let mut dir_files: Vec<Vec<usize>> = Vec::new();
        for (i, f) in files.iter().enumerate() {
            let path = f.display_path().to_path_buf();
            let parent = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
            if let Some(pos) = dir_order.iter().position(|d| d == &parent) {
                dir_files[pos].push(i);
            } else {
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
        Self { nodes, cursor }
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
        if let Some(pos) = self
            .nodes
            .iter()
            .position(|n| n.file_diff_idx == Some(file_idx))
        {
            self.cursor = pos;
        }
    }

    /// Mark a file as viewed/unviewed. Affects only the file node, not dirs.
    pub fn toggle_viewed(&mut self) {
        if let Some(node) = self.nodes.get_mut(self.cursor) {
            if node.kind == FileNodeKind::File {
                node.viewed = !node.viewed;
            }
        }
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
}
