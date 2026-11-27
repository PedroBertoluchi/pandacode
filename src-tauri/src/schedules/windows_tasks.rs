//! Read-only view of the Windows Task Scheduler list that a local script writes as JSON.
//! Only the one file saved in the scheduler settings is ever read: the webview never
//! passes a path, and a missing, oversized or malformed file becomes a warning, not an error.

use serde::{Deserialize, Serialize};
use std::io::Read;

const MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Document {
    gerado: String,
    tarefas: Option<Vec<Entry>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Entry {
    nome: String,
    faz: String,
    ia: String,
    marca: String,
    quando: String,
    proxima: String,
    ultima: String,
    resultado: String,
    comando: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowsTask {
    pub name: String,
    pub does: String,
    pub ai: String,
    pub mark: String,
    pub when: String,
    pub next: String,
    pub last: String,
    pub result: String,
    pub command: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowsSchedules {
    pub configured: bool,
    pub generated: String,
    pub tasks: Vec<WindowsTask>,
    pub warning: Option<String>,
}

impl From<Entry> for WindowsTask {
    fn from(entry: Entry) -> Self {
        Self { name: entry.nome, does: entry.faz, ai: entry.ia, mark: entry.marca, when: entry.quando, next: entry.proxima, last: entry.ultima, result: entry.resultado, command: entry.comando }
    }
}

fn warn(warning: impl Into<String>) -> WindowsSchedules {
    WindowsSchedules { configured: true, warning: Some(warning.into()), ..Default::default() }
}

pub(crate) fn read(path: &str) -> WindowsSchedules {
    let path = path.trim();
    if path.is_empty() {
        return WindowsSchedules::default();
    }
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return warn(format!("The Windows schedules file was not found: {path}")),
        Err(error) => return warn(format!("The Windows schedules file could not be opened: {error}")),
    };
    let mut bytes = Vec::new();
    if let Err(error) = file.take(MAX_BYTES + 1).read_to_end(&mut bytes) {
        return warn(format!("The Windows schedules file could not be read: {error}"));
    }
    if bytes.len() as u64 > MAX_BYTES {
        return warn("The Windows schedules file is larger than 4 MB.");
    }
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let document: Document = match serde_json::from_slice(body) {
        Ok(document) => document,
        Err(error) => return warn(format!("The Windows schedules file is not valid: {error}")),
    };
    let Some(entries) = document.tarefas else {
        return warn("The Windows schedules file has no \"tarefas\" list.");
    };
    WindowsSchedules { configured: true, generated: document.gerado, tasks: entries.into_iter().map(WindowsTask::from).collect(), warning: None }
}

pub(crate) fn validate_path(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(String::new());
    }
    if path.len() > 520 || path.contains('\0') {
        return Err("The Windows schedules path is too long.".into());
    }
    let candidate = std::path::Path::new(path);
    if !candidate.is_absolute() {
        return Err("The Windows schedules path must be an absolute path.".into());
    }
    if !candidate.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("json")) {
        return Err("The Windows schedules file must be a .json file.".into());
    }
    Ok(path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, content: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("pandacode-windows-schedules-{}-{name}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, content).unwrap();
        path
    }

    fn read_file(path: &std::path::Path) -> WindowsSchedules {
        let report = read(path.to_str().unwrap());
        let _ = std::fs::remove_file(path);
        report
    }

    #[test]
    fn an_empty_path_is_not_configured() {
        assert_eq!(read(""), WindowsSchedules::default());
        assert_eq!(read("   "), WindowsSchedules::default());
        assert!(!read("").configured);
    }

    #[test]
    fn a_valid_file_lists_every_task() {
        let json = r#"{"gerado":"2026-11-26T15:46:10","tarefas":[
            {"nome":"AudioGuard","faz":"Checks the headset.","ia":"script","marca":"","quando":"todo dia 03:30","proxima":"2026-11-27 03:30","ultima":"2026-11-26 03:30","resultado":"ok","comando":"pwsh.exe -File a.ps1"},
            {"nome":"Old","faz":"","ia":"abre IA","marca":"quebrado","quando":"no login","proxima":"","ultima":"","resultado":"erro 2","comando":""}]}"#;
        let report = read_file(&file("valid", json.as_bytes()));
        assert!(report.configured);
        assert_eq!(report.warning, None);
        assert_eq!(report.generated, "2026-11-26T15:46:10");
        assert_eq!(report.tasks.len(), 2);
        assert_eq!(report.tasks[0].name, "AudioGuard");
        assert_eq!(report.tasks[0].next, "2026-11-27 03:30");
        assert_eq!(report.tasks[0].command, "pwsh.exe -File a.ps1");
        assert_eq!(report.tasks[1].mark, "quebrado");
        assert_eq!(report.tasks[1].result, "erro 2");
    }

    #[test]
    fn a_byte_order_mark_and_missing_fields_are_tolerated() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(br#"{"tarefas":[{"nome":"Only a name"}]}"#);
        let report = read_file(&file("bom", &bytes));
        assert_eq!(report.warning, None);
        assert_eq!(report.generated, "");
        assert_eq!(report.tasks.len(), 1);
        assert_eq!(report.tasks[0].name, "Only a name");
        assert_eq!(report.tasks[0].result, "");
    }

    #[test]
    fn a_missing_file_warns_and_lists_nothing() {
        let path = std::env::temp_dir().join(format!("pandacode-windows-schedules-{}-absent.json", uuid::Uuid::new_v4()));
        let report = read(path.to_str().unwrap());
        assert!(report.configured);
        assert!(report.tasks.is_empty());
        assert!(report.warning.unwrap().contains("not found"));
    }

    #[test]
    fn an_invalid_file_warns_and_lists_nothing() {
        for (name, content) in [("garbage", "{not json"), ("empty", ""), ("array", "[1,2]"), ("wrong-type", r#"{"tarefas":"x"}"#), ("bad-task", r#"{"tarefas":[{"nome":5}]}"#)] {
            let report = read_file(&file(name, content.as_bytes()));
            assert!(report.configured, "{name}");
            assert!(report.tasks.is_empty(), "{name}");
            assert!(report.warning.unwrap().contains("not valid"), "{name}");
        }
    }

    #[test]
    fn a_file_without_a_task_list_warns() {
        let report = read_file(&file("no-list", br#"{"gerado":"2026-11-26T15:46:10"}"#));
        assert!(report.tasks.is_empty());
        assert!(report.warning.unwrap().contains("tarefas"));
    }

    #[test]
    fn a_directory_or_an_oversized_file_warns() {
        let report = read(std::env::temp_dir().to_str().unwrap());
        assert!(report.configured);
        assert!(report.warning.is_some());
        let big = vec![b' '; (MAX_BYTES + 1) as usize];
        let report = read_file(&file("big", &big));
        assert!(report.warning.unwrap().contains("larger than 4 MB"));
    }

    #[test]
    fn the_saved_path_is_empty_or_an_absolute_json_file() {
        assert_eq!(validate_path("  "), Ok(String::new()));
        let absolute = if cfg!(windows) { "C:/schedules/windows-tasks.json" } else { "/tmp/windows-tasks.json" };
        assert_eq!(validate_path(absolute), Ok(absolute.to_string()));
        assert!(validate_path("agendamentos.json").is_err());
        let text = if cfg!(windows) { "C:/schedules/notes.txt" } else { "/tmp/notes.txt" };
        assert!(validate_path(text).is_err());
        assert!(validate_path(&"a".repeat(600)).is_err());
    }
}
