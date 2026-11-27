//! Folders a new task's prompt may belong to, for "Open there" (see `src/project-hint.ts`).
//! Local and read-only: names of nearby folders that look like projects, no model, no file contents.
use crate::{storage::Project, Result};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

const MARKERS: &[&str] = &[
    ".git", "package.json", "Cargo.toml", "pyproject.toml", "go.mod", "pom.xml", "CLAUDE.md", "AGENTS.md",
];
const MARKER_EXTENSIONS: &[&str] = &["sln", "slnx", "csproj"];
const MAX_ROOTS: usize = 12;
const MAX_ENTRIES: usize = 400;
const MAX_CONTAINERS: usize = 40;
const WIDE_AT: usize = 3;

#[derive(Debug, Serialize, PartialEq)]
pub(crate) struct Folder {
    name: String,
    path: String,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hint {
    /// The current project is a drive root or a folder holding several projects.
    wide: bool,
    folders: Vec<Folder>,
}

fn is_project(dir: &Path) -> bool {
    MARKERS.iter().any(|marker| dir.join(marker).exists())
        || fs::read_dir(dir).is_ok_and(|entries| {
            entries.take(MAX_ENTRIES).flatten().any(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|ext| MARKER_EXTENSIONS.iter().any(|m| ext.eq_ignore_ascii_case(m)))
            })
        })
}

fn subfolders(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .take(MAX_ENTRIES)
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            !name.starts_with(['.', '$']) && name != "node_modules"
        })
        .map(|entry| entry.path())
        .collect()
}

/// Project-looking folders directly under `root`, and under its folders that are not projects
/// themselves (a `Clients` folder of client folders).
fn scan(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut containers = 0;
    for dir in subfolders(root) {
        if is_project(&dir) {
            found.push(dir);
        } else if containers < MAX_CONTAINERS {
            containers += 1;
            found.extend(subfolders(&dir).into_iter().filter(|child| is_project(child)));
        }
    }
    found
}

pub(crate) fn folders(projects: &[Project], current: &str) -> Result<Hint> {
    let current = projects.iter().find(|p| p.id == current).ok_or("Unknown project.")?;
    let current_path = PathBuf::from(&current.path);
    let mut roots = vec![current_path.clone()];
    for project in projects {
        if crate::chats::is_chat_folder(Path::new(&project.path)) {
            continue;
        }
        if let Some(parent) = Path::new(&project.path).parent() {
            if !roots.iter().any(|root| root == parent) {
                roots.push(parent.to_path_buf());
            }
        }
    }
    roots.truncate(MAX_ROOTS);
    let own = scan(&current_path);
    let wide = current_path.parent().is_none()
        || (own.len() >= WIDE_AT && !current_path.join(".git").exists());
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for root in &roots {
        for dir in if root == &current_path { own.clone() } else { scan(root) } {
            let Some(name) = dir.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
            if seen.insert(dir.clone()) {
                found.push(Folder { name, path: dir.to_string_lossy().into_owned() });
            }
        }
    }
    Ok(Hint { wide, folders: found })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: &str, path: &Path) -> Project {
        Project { id: id.into(), name: id.into(), path: path.to_string_lossy().into_owned(), added_order: 1 }
    }
    struct Tree(PathBuf);
    impl Tree {
        fn path(&self) -> &Path { &self.0 }
    }
    impl Drop for Tree {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }
    fn tree() -> Tree {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let unique = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let root = Tree(std::env::temp_dir().join(format!("pandacode-hint-{}-{unique}", std::process::id())));
        fs::create_dir_all(root.path()).unwrap();
        let make = |sub: &str, marker: Option<&str>| {
            let dir = root.path().join(sub);
            fs::create_dir_all(&dir).unwrap();
            if let Some(marker) = marker {
                if marker == ".git" { fs::create_dir_all(dir.join(marker)).unwrap(); } else { fs::write(dir.join(marker), "").unwrap(); }
            }
        };
        make("BAMemory", Some(".git"));
        make("Tibia", Some("package.json"));
        make("Clients/Roberto Carlos", Some("CLAUDE.md"));
        make("Clients/Notes only", None);
        make("Temp", None);
        make("Suite/App", Some("App.sln"));
        fs::write(root.path().join("loose.txt"), "x").unwrap();
        root
    }
    fn names(hint: &Hint) -> Vec<&str> {
        let mut names: Vec<&str> = hint.folders.iter().map(|f| f.name.as_str()).collect();
        names.sort();
        names
    }

    #[test]
    fn finds_project_looking_folders_and_one_level_inside_client_folders() {
        let root = tree();
        let hint = folders(&[project("p", root.path())], "p").unwrap();
        assert_eq!(names(&hint), ["App", "BAMemory", "Roberto Carlos", "Tibia"]);
        assert!(hint.wide, "four projects under the current folder");
        assert!(hint.folders.iter().all(|f| Path::new(&f.path).is_dir()));
    }

    #[test]
    fn a_checkout_with_a_few_packages_is_not_wide_and_siblings_are_still_offered() {
        let root = tree();
        let repo = root.path().join("BAMemory");
        for package in ["a", "b", "c"] {
            fs::create_dir_all(repo.join(package)).unwrap();
            fs::write(repo.join(package).join("package.json"), "{}").unwrap();
        }
        let hint = folders(&[project("p", &repo)], "p").unwrap();
        assert!(!hint.wide);
        assert!(names(&hint).contains(&"Tibia"), "a sibling of a registered project is a candidate");
    }

    #[test]
    fn unknown_project_is_an_error() {
        assert!(folders(&[], "missing").is_err());
    }
}
