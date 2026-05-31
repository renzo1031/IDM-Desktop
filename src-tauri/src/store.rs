use crate::models::DownloadTask;
use std::path::PathBuf;

#[derive(Clone)]
pub struct TaskStore {
    path: PathBuf,
}

impl TaskStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load_all(&self) -> Result<Vec<DownloadTask>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let content = std::fs::read_to_string(&self.path)
            .map_err(|err| format!("无法读取任务记录：{err}"))?;
        serde_json::from_str::<Vec<DownloadTask>>(&content)
            .map_err(|err| format!("任务记录格式损坏：{err}"))
    }

    pub fn save_all(&self, tasks: &[DownloadTask]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| format!("无法创建任务目录：{err}"))?;
        }

        let content = serde_json::to_string_pretty(tasks)
            .map_err(|err| format!("无法序列化任务记录：{err}"))?;
        std::fs::write(&self.path, content).map_err(|err| format!("无法写入任务记录：{err}"))
    }

    pub fn upsert(&self, task: DownloadTask) -> Result<(), String> {
        let mut tasks = self.load_all()?;
        if let Some(existing) = tasks.iter_mut().find(|item| item.id == task.id) {
            *existing = task;
        } else {
            tasks.insert(0, task);
        }
        self.save_all(&tasks)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let tasks = self
            .load_all()?
            .into_iter()
            .filter(|task| task.id != id && task.gid.as_deref() != Some(id))
            .collect::<Vec<_>>();
        self.save_all(&tasks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DownloadStatus, DownloadTaskOptions};

    fn sample_task(id: &str) -> DownloadTask {
        DownloadTask {
            id: id.to_string(),
            gid: Some(id.to_string()),
            url: "https://example.com/file.zip".to_string(),
            file_name: "file.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            total_bytes: 100,
            completed_bytes: 10,
            download_speed: 0,
            connections: 0,
            status: DownloadStatus::Waiting,
            resumable: true,
            error_message: None,
            created_at: "2026-05-31T00:00:00.000Z".to_string(),
            updated_at: "2026-05-31T00:00:00.000Z".to_string(),
            options: DownloadTaskOptions {
                split: 16,
                max_connection_per_server: 16,
                speed_limit: 0,
            },
        }
    }

    #[test]
    fn store_saves_loads_and_removes_tasks() {
        let root = std::env::temp_dir().join(format!("idm-store-test-{}", uuid::Uuid::new_v4()));
        let store = TaskStore::new(root.join("tasks.json"));
        let task = sample_task("gid-1");

        store.upsert(task.clone()).unwrap();
        assert_eq!(store.load_all().unwrap(), vec![task.clone()]);

        store.remove("gid-1").unwrap();
        assert!(store.load_all().unwrap().is_empty());

        std::fs::remove_dir_all(root).unwrap();
    }
}
