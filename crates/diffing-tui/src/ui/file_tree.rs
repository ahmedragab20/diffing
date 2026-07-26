//! Recursive file tree built from a `Vec<FileDiff>`.
//!
//! Renders as a flat list of `FileNode`s with `depth` driving the indent.
//! Directories are auto-expanded by default; collapse is delegated to a
//! later phase. Each file node carries its index into the original
//! `files` vec so the main view can jump to the corresponding diff.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use diffing_core::diff::{FileDiff, LineKind};

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
    pub additions: u32,
    pub deletions: u32,
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
        let mut directories: HashMap<PathBuf, usize> = HashMap::new();
        for (file_index, file) in files.iter().enumerate() {
            let mut parent = file.display_path().parent();
            while let Some(directory) = parent {
                if directory.as_os_str().is_empty() {
                    break;
                }
                directories
                    .entry(directory.to_path_buf())
                    .and_modify(|first_seen| *first_seen = (*first_seen).min(file_index))
                    .or_insert(file_index);
                parent = directory.parent();
            }
        }
        flatten_directory(Path::new(""), 0, files, &directories, &mut nodes);

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

    pub fn navigable_file_indices(&self) -> &[usize] {
        &self.filtered_file_indices
    }

    pub fn filtered_file_count(&self) -> usize {
        self.filtered_file_indices.len()
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
            return;
        }
        if !self.filtered_file_indices.contains(&file_idx) {
            return;
        }
        let Some(path) = self
            .all_nodes
            .iter()
            .find(|node| node.file_diff_idx == Some(file_idx))
            .map(|node| node.path.clone())
        else {
            return;
        };
        let previous = self.collapsed.len();
        self.collapsed
            .retain(|directory| !path.starts_with(directory));
        if self.collapsed.len() != previous {
            self.rebuild_visible(Some(path));
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
        let filtered: HashSet<usize> = self.filtered_file_indices.iter().copied().collect();
        self.nodes =
            self.all_nodes
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
                    !self.collapsed.iter().any(|directory| {
                        node.path != *directory && node.path.starts_with(directory)
                    })
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

#[derive(Debug)]
enum TreeEntry {
    Directory(PathBuf),
    File(usize),
}

fn flatten_directory(
    parent: &Path,
    depth: usize,
    files: &[FileDiff],
    directories: &HashMap<PathBuf, usize>,
    nodes: &mut Vec<FileNode>,
) {
    let mut entries: Vec<(usize, u8, TreeEntry)> = directories
        .iter()
        .filter(|(path, _)| path.parent() == Some(parent))
        .map(|(path, first_seen)| (*first_seen, 0, TreeEntry::Directory(path.clone())))
        .chain(
            files
                .iter()
                .enumerate()
                .filter(|(_, file)| file.display_path().parent() == Some(parent))
                .map(|(index, _)| (index, 1, TreeEntry::File(index))),
        )
        .collect();
    entries.sort_by_key(|(first_seen, kind, _)| (*first_seen, *kind));

    for (_, _, entry) in entries {
        match entry {
            TreeEntry::File(index) => {
                let file = &files[index];
                let path = file.display_path();
                let (additions, deletions) = file.hunks.iter().flat_map(|hunk| &hunk.lines).fold(
                    (0, 0),
                    |(additions, deletions), line| match line.kind {
                        LineKind::Add => (additions + 1, deletions),
                        LineKind::Del => (additions, deletions + 1),
                        LineKind::Context => (additions, deletions),
                    },
                );
                nodes.push(FileNode {
                    name: path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("")
                        .to_string(),
                    path: path.to_path_buf(),
                    depth,
                    kind: FileNodeKind::File,
                    file_diff_idx: Some(index),
                    expanded: false,
                    viewed: false,
                    comment_count: 0,
                    change_marker: change_marker_for(file),
                    additions,
                    deletions,
                });
            }
            TreeEntry::Directory(directory) => {
                let (path, name) = compact_directory(directory, files, directories);
                nodes.push(FileNode {
                    name,
                    path: path.clone(),
                    depth,
                    kind: FileNodeKind::Dir,
                    file_diff_idx: None,
                    expanded: true,
                    viewed: false,
                    comment_count: 0,
                    change_marker: ' ',
                    additions: 0,
                    deletions: 0,
                });
                flatten_directory(&path, depth + 1, files, directories, nodes);
            }
        }
    }
}

fn compact_directory(
    mut directory: PathBuf,
    files: &[FileDiff],
    directories: &HashMap<PathBuf, usize>,
) -> (PathBuf, String) {
    let mut name = directory
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("")
        .to_string();
    loop {
        let has_direct_files = files
            .iter()
            .any(|file| file.display_path().parent() == Some(directory.as_path()));
        let children: Vec<&PathBuf> = directories
            .keys()
            .filter(|path| path.parent() == Some(directory.as_path()))
            .collect();
        if has_direct_files || children.len() != 1 {
            break;
        }
        let child = children[0];
        let child_name = child
            .file_name()
            .and_then(|part| part.to_str())
            .unwrap_or("");
        if !name.is_empty() && !child_name.is_empty() {
            name.push('/');
        }
        name.push_str(child_name);
        directory = child.clone();
    }
    (directory, name)
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
    fn nested_directories_are_hierarchical_and_single_child_chains_are_compact() {
        let files = vec![
            fd("crates/diffing/Cargo.toml", ChangeKind::Modified),
            fd("crates/diffing/src/app.rs", ChangeKind::Modified),
            fd("crates/diffing/src/ui/tree.rs", ChangeKind::Added),
        ];
        let tree = FileTree::build(&files);
        let labels: Vec<_> = tree
            .nodes
            .iter()
            .map(|node| (node.depth, node.kind, node.name.as_str()))
            .collect();
        assert_eq!(
            labels,
            vec![
                (0, FileNodeKind::Dir, "crates/diffing"),
                (1, FileNodeKind::File, "Cargo.toml"),
                (1, FileNodeKind::Dir, "src"),
                (2, FileNodeKind::File, "app.rs"),
                (2, FileNodeKind::Dir, "ui"),
                (3, FileNodeKind::File, "tree.rs"),
            ]
        );
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
        assert_eq!(tree.navigable_file_indices(), &[1]);
        assert_eq!(tree.filtered_file_count(), 1);
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

    #[test]
    fn collapsing_hides_nested_directories_and_file_jumps_reveal_them() {
        let files = vec![
            fd("src/core/a.rs", ChangeKind::Modified),
            fd("src/core/nested/b.rs", ChangeKind::Added),
            fd("README.md", ChangeKind::Modified),
        ];
        let mut tree = FileTree::build(&files);
        tree.cursor = 0;
        tree.collapse_selected();
        assert_eq!(
            tree.nodes
                .iter()
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>(),
            vec!["src/core", "README.md"]
        );
        assert_eq!(tree.navigable_file_indices(), &[0, 1, 2]);

        tree.jump_to_file(1);
        assert_eq!(tree.selected_file_idx(), Some(1));
        assert!(tree.nodes.iter().any(|node| node.name == "nested"));
    }
}
