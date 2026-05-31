use crate::aria2::{
    build_add_uri_payload, build_change_global_option_payload, build_pause_all_payload,
    build_pause_payload, build_purge_download_result_payload,
    build_remove_download_result_payload, build_remove_payload, build_resume_all_payload,
    build_resume_payload, build_shutdown_payload, build_tell_status_payload,
    build_tell_version_payload,
    normalize_error_text, prepare_launch_plan, AddUriOptions, Aria2Config, Aria2TaskStatus,
};
use crate::models::{DownloadStatus, DownloadTask, DownloadTaskOptions};
use crate::store::TaskStore;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

#[derive(Clone)]
pub struct DownloadService {
    inner: Arc<DownloadServiceInner>,
}

struct DownloadServiceInner {
    client: Client,
    config: Aria2Config,
    child: Mutex<Option<Child>>,
    resource_dir: PathBuf,
    app_data_dir: PathBuf,
    default_download_dir: PathBuf,
    store: TaskStore,
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    message: String,
}

impl DownloadService {
    pub fn new(resource_dir: PathBuf, app_data_dir: PathBuf, default_download_dir: PathBuf) -> Self {
        let store = TaskStore::new(app_data_dir.join("tasks.json"));
        Self {
            inner: Arc::new(DownloadServiceInner {
                client: Client::new(),
                config: Aria2Config::default(),
                child: Mutex::new(None),
                resource_dir,
                app_data_dir,
                default_download_dir,
                store,
            }),
        }
    }

    pub async fn ensure_started(&self) -> Result<(), String> {
        if self.rpc_ready().await {
            return Ok(());
        }

        let mut child_guard = self.inner.child.lock().await;
        if child_guard.is_none() {
            let plan = prepare_launch_plan(
                &self.inner.resource_dir,
                &self.inner.app_data_dir,
                &self.inner.default_download_dir,
                &self.inner.config,
            )?;
            let mut command = Command::new(plan.binary_path);
            command
                .args(plan.args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            *child_guard = Some(
                command
                    .spawn()
                    .map_err(|err| format!("无法启动内置 aria2：{err}"))?,
            );
        }
        drop(child_guard);

        for _ in 0..30 {
            if self.rpc_ready().await {
                return Ok(());
            }
            sleep(Duration::from_millis(150)).await;
        }

        Err("aria2 RPC 启动超时".to_string())
    }

    pub async fn add_uri(&self, url: &str, options: &AddUriOptions) -> Result<String, String> {
        self.ensure_started().await?;
        ensure_download_dir_ready(&options.dir)?;
        let payload = build_add_uri_payload(url, options, &self.inner.config);
        let gid = self.rpc::<String>(payload).await?;
        if let Ok(task) = self.tell_status(&gid).await {
            self.inner.store.upsert(with_request_options(task, options))?;
        }
        Ok(gid)
    }

    pub async fn list_downloads(&self) -> Result<Vec<DownloadTask>, String> {
        let stored_tasks = self.inner.store.load_all()?;
        if let Err(err) = self.ensure_started().await {
            if stored_tasks.is_empty() {
                return Err(err);
            }
            return Ok(stored_tasks);
        }

        let mut tasks = Vec::new();

        for payload in [
            self.list_payload("tell-active", "aria2.tellActive"),
            self.list_payload("tell-waiting", "aria2.tellWaiting"),
            self.list_payload("tell-stopped", "aria2.tellStopped"),
        ] {
            let statuses = self.rpc::<Vec<Aria2TaskStatus>>(payload).await?;
            tasks.extend(
                statuses
                    .into_iter()
                    .map(Aria2TaskStatus::into_download_task)
                    .map(|task| merge_stored_options(task, &stored_tasks)),
            );
        }

        let candidates = restore_candidates(&stored_tasks, &tasks);
        for stored_task in candidates {
            match self.restore_task(&stored_task).await {
                Ok(restored_task) => {
                    self.inner.store.upsert(restored_task.clone())?;
                    tasks.push(restored_task);
                }
                Err(err) => {
                    let mut failed_task = stored_task;
                    failed_task.status = DownloadStatus::Error;
                    failed_task.download_speed = 0;
                    failed_task.error_message = Some(normalize_error_text(&err));
                    self.inner.store.upsert(failed_task.clone())?;
                    tasks.push(failed_task);
                }
            }
        }

        for task in &tasks {
            self.inner.store.upsert(task.clone())?;
        }

        for stored_task in stored_tasks {
            if !tasks.iter().any(|task| task.id == stored_task.id) {
                tasks.push(stored_task);
            }
        }

        Ok(visible_tasks(tasks))
    }

    async fn restore_task(&self, stored_task: &DownloadTask) -> Result<DownloadTask, String> {
        let options = restore_options_from_task(stored_task, &self.inner.config);
        let payload = build_add_uri_payload(&stored_task.url, &options, &self.inner.config);
        let gid = self.rpc::<String>(payload).await?;
        let restored = self.tell_status(&gid).await?;
        Ok(rebind_restored_task(restored, stored_task))
    }

    pub async fn pause(&self, gid: &str) -> Result<(), String> {
        self.ensure_started().await?;
        self.rpc::<String>(build_pause_payload(gid, &self.inner.config))
            .await?;
        self.inner.store.update_status(gid, DownloadStatus::Paused, 0)
    }

    pub async fn resume(&self, gid: &str) -> Result<(), String> {
        self.ensure_started().await?;
        self.rpc::<String>(build_resume_payload(gid, &self.inner.config))
            .await?;
        self.inner.store.update_status(gid, DownloadStatus::Active, 0)
    }

    pub async fn update_queue_settings(&self, max_active_downloads: u32) -> Result<(), String> {
        self.ensure_started().await?;
        self.rpc::<String>(build_change_global_option_payload(
            max_active_downloads,
            &self.inner.config,
        ))
        .await?;
        Ok(())
    }

    pub async fn pause_all(&self) -> Result<(), String> {
        self.ensure_started().await?;
        self.rpc::<String>(build_pause_all_payload(&self.inner.config))
            .await?;

        let mut tasks = self.inner.store.load_all()?;
        for task in &mut tasks {
            if matches!(
                task.status,
                DownloadStatus::Active | DownloadStatus::Waiting | DownloadStatus::Paused
            ) {
                task.status = DownloadStatus::Paused;
                task.download_speed = 0;
            }
        }
        self.inner.store.save_all(&tasks)
    }

    pub async fn resume_all(&self) -> Result<(), String> {
        self.ensure_started().await?;
        self.rpc::<String>(build_resume_all_payload(&self.inner.config))
            .await?;

        let mut tasks = self.inner.store.load_all()?;
        for task in &mut tasks {
            if matches!(task.status, DownloadStatus::Paused | DownloadStatus::Waiting) {
                task.status = DownloadStatus::Waiting;
                task.download_speed = 0;
            }
        }
        self.inner.store.save_all(&tasks)
    }

    pub async fn purge_stopped(&self) -> Result<(), String> {
        self.ensure_started().await?;
        self.rpc::<String>(build_purge_download_result_payload(&self.inner.config))
            .await?;

        let tasks = self.inner.store.load_all()?;
        let clearable = clearable_tasks(&tasks);
        for task in clearable {
            self.inner.store.remove(&task.id)?;
        }
        Ok(())
    }

    pub async fn remove(&self, gid: &str) -> Result<(), String> {
        self.remove_with_file(gid, false).await
    }

    pub async fn remove_with_file(&self, gid: &str, delete_file: bool) -> Result<(), String> {
        self.ensure_started().await?;
        let remove_result = self
            .rpc::<String>(build_remove_payload(gid, &self.inner.config))
            .await;
        let remove_history_result = self
            .rpc::<String>(build_remove_download_result_payload(gid, &self.inner.config))
            .await;

        if let Err(err) = remove_result {
            if remove_history_result.is_err() {
                return Err(err);
            }
        }

        if delete_file {
            self.delete_download_file(gid)?;
        }
        self.inner.store.remove(gid)
    }

    pub fn download_file_path(&self, id: &str) -> Result<PathBuf, String> {
        let task = self.stored_task(id)?;
        Ok(download_file_path_from_task(&task))
    }

    pub fn download_dir_path(&self, id: &str) -> Result<PathBuf, String> {
        let task = self.stored_task(id)?;
        Ok(PathBuf::from(task.save_dir))
    }

    pub fn stored_task(&self, id: &str) -> Result<DownloadTask, String> {
        self.inner
            .store
            .find(id)?
            .ok_or_else(|| "任务不存在".to_string())
    }

    pub fn delete_download_file(&self, id: &str) -> Result<(), String> {
        let file_path = self.download_file_path(id)?;
        delete_file_if_present(&file_path)
    }

    pub async fn tell_status(&self, gid: &str) -> Result<DownloadTask, String> {
        self.ensure_started().await?;
        let status = self
            .rpc::<Aria2TaskStatus>(build_tell_status_payload(gid, &self.inner.config))
            .await?;
        let task = status.into_download_task();
        Ok(self
            .inner
            .store
            .find(gid)?
            .map(|stored| merge_task_options(task.clone(), &stored))
            .unwrap_or(task))
    }

    pub fn config(&self) -> &Aria2Config {
        &self.inner.config
    }

    pub async fn shutdown(&self) {
        let _ = self.rpc::<String>(build_shutdown_payload(&self.inner.config)).await;
        let mut child_guard = self.inner.child.lock().await;
        if let Some(child) = child_guard.as_mut() {
            let _ = child.start_kill();
        }
        *child_guard = None;
    }

    async fn rpc_ready(&self) -> bool {
        let payload = build_tell_version_payload(&self.inner.config);
        self.rpc::<Value>(payload).await.is_ok()
    }

    async fn rpc<T>(&self, payload: Value) -> Result<T, String>
    where
        T: for<'de> Deserialize<'de>,
    {
        let response = self
            .inner
            .client
            .post(&self.inner.config.rpc_url)
            .json(&payload)
            .send()
            .await
            .map_err(|err| normalize_error_text(&format!("aria2 RPC 请求失败：{err}")))?;
        let body = response
            .json::<RpcResponse<T>>()
            .await
            .map_err(|err| normalize_error_text(&format!("aria2 RPC 响应解析失败：{err}")))?;

        match (body.result, body.error) {
            (Some(result), _) => Ok(result),
            (_, Some(err)) => Err(normalize_error_text(&err.message)),
            _ => Err("aria2 RPC 响应缺少 result".to_string()),
        }
    }

    fn list_payload(&self, id: &str, method: &str) -> Value {
        let params = if method == "aria2.tellActive" {
            json!([
                format!("token:{}", self.inner.config.secret),
                [
                    "gid",
                    "status",
                    "totalLength",
                    "completedLength",
                    "downloadSpeed",
                    "connections",
                    "dir",
                    "files",
                    "errorMessage"
                ]
            ])
        } else {
            json!([
                format!("token:{}", self.inner.config.secret),
                0,
                100,
                [
                    "gid",
                    "status",
                    "totalLength",
                    "completedLength",
                    "downloadSpeed",
                    "connections",
                    "dir",
                    "files",
                    "errorMessage"
                ]
            ])
        };

        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        })
    }
}

pub fn request_options(options: &AddUriOptions) -> DownloadTaskOptions {
    let split = options.split.parse::<u32>().unwrap_or(16);
    DownloadTaskOptions {
        split,
        max_connection_per_server: options
            .max_connection_per_server
            .parse::<u32>()
            .unwrap_or(split),
        speed_limit: options
            .max_download_limit
            .as_deref()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0),
        proxy_url: options.all_proxy.clone(),
    }
}

pub fn with_request_options(mut task: DownloadTask, options: &AddUriOptions) -> DownloadTask {
    task.options = request_options(options);
    task
}

pub fn merge_task_options(mut task: DownloadTask, stored: &DownloadTask) -> DownloadTask {
    task.options = stored.options.clone();
    if task.total_bytes == 0 && stored.total_bytes > 0 {
        task.total_bytes = stored.total_bytes;
    }
    if task.completed_bytes == 0 {
        task.resumable = stored.resumable;
    }
    task
}

pub fn merge_stored_options(task: DownloadTask, stored_tasks: &[DownloadTask]) -> DownloadTask {
    stored_tasks
        .iter()
        .find(|stored| stored.id == task.id || stored.gid == task.gid)
        .map(|stored| merge_task_options(task.clone(), stored))
        .unwrap_or(task)
}

pub fn restore_options_from_task(task: &DownloadTask, config: &Aria2Config) -> AddUriOptions {
    let mut options = crate::aria2::add_uri_options(
        task.save_dir.clone(),
        Some(task.file_name.clone()),
        task.options.split,
        task.options.speed_limit,
        task.options.proxy_url.clone(),
        config,
    );
    options.max_connection_per_server = task.options.max_connection_per_server.to_string();
    if task.status == DownloadStatus::Paused {
        options.pause = Some("true".to_string());
    }
    options
}

pub fn should_restore_task(task: &DownloadTask) -> bool {
    matches!(
        task.status,
        DownloadStatus::Waiting | DownloadStatus::Active | DownloadStatus::Paused | DownloadStatus::Error
    ) && !task.url.trim().is_empty()
}

pub fn restore_candidates(
    stored_tasks: &[DownloadTask],
    live_tasks: &[DownloadTask],
) -> Vec<DownloadTask> {
    stored_tasks
        .iter()
        .filter(|task| should_restore_task(task))
        .filter(|stored| {
            !live_tasks.iter().any(|live| {
                live.id == stored.id
                    || stored
                        .gid
                        .as_ref()
                        .is_some_and(|stored_gid| live.gid.as_deref() == Some(stored_gid))
            })
        })
        .cloned()
        .collect()
}

pub fn visible_tasks(tasks: Vec<DownloadTask>) -> Vec<DownloadTask> {
    tasks
        .into_iter()
        .filter(|task| task.status != DownloadStatus::Removed)
        .collect()
}

pub fn clearable_tasks(tasks: &[DownloadTask]) -> Vec<DownloadTask> {
    tasks
        .iter()
        .filter(|task| matches!(task.status, DownloadStatus::Complete | DownloadStatus::Error))
        .cloned()
        .collect()
}

pub fn rebind_restored_task(mut restored: DownloadTask, stored: &DownloadTask) -> DownloadTask {
    restored.id = stored.id.clone();
    restored.created_at = stored.created_at.clone();
    restored.options = stored.options.clone();
    restored
}

pub fn download_file_path_from_task(task: &DownloadTask) -> PathBuf {
    PathBuf::from(&task.save_dir).join(&task.file_name)
}

pub fn ensure_download_dir_ready(save_dir: &str) -> Result<(), String> {
    let path = std::path::Path::new(save_dir);

    if path.exists() && !path.is_dir() {
        return Err(format!("保存目录路径指向文件：{}", path.display()));
    }

    std::fs::create_dir_all(path).map_err(|err| {
        normalize_error_text(&format!("无法创建保存目录 {}：{err}", path.display()))
    })
}

pub fn delete_file_if_present(file_path: &std::path::Path) -> Result<(), String> {
    if !file_path.exists() {
        return Ok(());
    }

    if file_path.is_dir() {
        return Err("下载文件路径指向目录，已取消删除".to_string());
    }

    std::fs::remove_file(file_path)
        .map_err(|err| format!("无法删除本地文件 {}：{err}", file_path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DownloadTaskOptions;

    fn sample_task(save_dir: PathBuf, file_name: &str) -> DownloadTask {
        DownloadTask {
            id: "gid-1".to_string(),
            gid: Some("gid-1".to_string()),
            url: "https://example.com/file.zip".to_string(),
            file_name: file_name.to_string(),
            save_dir: save_dir.display().to_string(),
            total_bytes: 100,
            completed_bytes: 100,
            download_speed: 0,
            connections: 0,
            status: DownloadStatus::Complete,
            resumable: true,
            error_message: None,
            created_at: "2026-05-31T00:00:00.000Z".to_string(),
            updated_at: "2026-05-31T00:00:00.000Z".to_string(),
            options: DownloadTaskOptions {
                split: 16,
                max_connection_per_server: 16,
                speed_limit: 0,
                proxy_url: None,
            },
        }
    }

    #[test]
    fn download_file_path_joins_save_dir_and_file_name() {
        let save_dir = PathBuf::from("D:\\Downloads");
        let task = sample_task(save_dir.clone(), "archive.zip");

        assert_eq!(
            download_file_path_from_task(&task),
            save_dir.join("archive.zip")
        );
    }

    #[test]
    fn delete_file_if_present_removes_files_but_not_directories() {
        let root =
            std::env::temp_dir().join(format!("idm-delete-file-test-{}", uuid::Uuid::new_v4()));
        let file_path = root.join("archive.zip");

        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&file_path, "download").unwrap();

        delete_file_if_present(&file_path).unwrap();
        assert!(!file_path.exists());

        let err = delete_file_if_present(&root).unwrap_err();
        assert!(err.contains("指向目录"));

        delete_file_if_present(&file_path).unwrap();

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ensure_download_dir_ready_creates_missing_directories() {
        let root =
            std::env::temp_dir().join(format!("idm-download-dir-test-{}", uuid::Uuid::new_v4()));
        let download_dir = root.join("nested").join("downloads");

        ensure_download_dir_ready(&download_dir.display().to_string()).unwrap();

        assert!(download_dir.is_dir());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ensure_download_dir_ready_rejects_file_paths() {
        let root =
            std::env::temp_dir().join(format!("idm-download-dir-test-{}", uuid::Uuid::new_v4()));
        let file_path = root.join("download-target");

        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&file_path, "not a directory").unwrap();

        let err = ensure_download_dir_ready(&file_path.display().to_string()).unwrap_err();

        assert!(err.contains("保存目录路径指向文件"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn request_options_preserve_split_and_proxy_metadata() {
        let options = AddUriOptions {
            dir: "D:\\Downloads".to_string(),
            out: None,
            split: "12".to_string(),
            max_connection_per_server: "12".to_string(),
            min_split_size: "1M".to_string(),
            max_download_limit: Some("524288".to_string()),
            all_proxy: Some("http://127.0.0.1:7890".to_string()),
            pause: None,
            continue_download: "true".to_string(),
        };

        let task_options = request_options(&options);

        assert_eq!(task_options.split, 12);
        assert_eq!(task_options.max_connection_per_server, 12);
        assert_eq!(task_options.speed_limit, 524_288);
        assert_eq!(
            task_options.proxy_url,
            Some("http://127.0.0.1:7890".to_string())
        );
    }

    #[test]
    fn merge_stored_options_keeps_user_download_settings() {
        let stored = sample_task(PathBuf::from("D:\\Downloads"), "archive.zip");
        let mut live = stored.clone();
        live.options = DownloadTaskOptions {
            split: 16,
            max_connection_per_server: 16,
            speed_limit: 0,
            proxy_url: None,
        };
        let mut stored_with_options = stored.clone();
        stored_with_options.options = DownloadTaskOptions {
            split: 6,
            max_connection_per_server: 6,
            speed_limit: 0,
            proxy_url: Some("http://127.0.0.1:7890".to_string()),
        };

        let merged = merge_stored_options(live, &[stored_with_options]);

        assert_eq!(merged.options.split, 6);
        assert_eq!(
            merged.options.proxy_url,
            Some("http://127.0.0.1:7890".to_string())
        );
    }

    #[test]
    fn merge_stored_options_keeps_preview_metadata_when_live_status_is_empty() {
        let stored = sample_task(PathBuf::from("D:\\Downloads"), "archive.zip");
        let mut live = stored.clone();
        live.total_bytes = 0;
        live.completed_bytes = 0;
        live.resumable = true;

        let mut stored_with_preview = stored.clone();
        stored_with_preview.total_bytes = 1_048_576;
        stored_with_preview.resumable = false;

        let merged = merge_stored_options(live, &[stored_with_preview]);

        assert_eq!(merged.total_bytes, 1_048_576);
        assert!(!merged.resumable);
    }

    #[test]
    fn restore_options_from_task_preserve_saved_metadata_and_pause_state() {
        let mut task = sample_task(PathBuf::from("E:\\Media"), "movie.iso");
        task.status = DownloadStatus::Paused;
        task.url = "https://example.com/movie.iso".to_string();
        task.options = DownloadTaskOptions {
            split: 12,
            max_connection_per_server: 12,
            speed_limit: 524_288,
            proxy_url: Some("http://127.0.0.1:7890".to_string()),
        };

        let options = restore_options_from_task(&task, &Aria2Config::default());

        assert_eq!(options.dir, "E:\\Media");
        assert_eq!(options.out, Some("movie.iso".to_string()));
        assert_eq!(options.split, "12");
        assert_eq!(options.max_download_limit, Some("524288".to_string()));
        assert_eq!(options.all_proxy, Some("http://127.0.0.1:7890".to_string()));
        assert_eq!(options.pause, Some("true".to_string()));
        assert_eq!(options.continue_download, "true");
    }

    #[test]
    fn restore_candidates_include_missing_incomplete_tasks_only() {
        let mut waiting = sample_task(PathBuf::from("D:\\Downloads"), "waiting.zip");
        waiting.id = "waiting-id".to_string();
        waiting.gid = Some("waiting-gid".to_string());
        waiting.status = DownloadStatus::Waiting;

        let mut complete = sample_task(PathBuf::from("D:\\Downloads"), "done.zip");
        complete.id = "complete-id".to_string();
        complete.status = DownloadStatus::Complete;

        let mut live = waiting.clone();
        live.id = "live-id".to_string();
        live.gid = Some("live-gid".to_string());

        let candidates = restore_candidates(&[waiting.clone(), complete], &[live]);

        assert_eq!(candidates, vec![waiting]);
    }

    #[test]
    fn visible_tasks_drop_removed_aria2_results() {
        let mut active = sample_task(PathBuf::from("D:\\Downloads"), "active.zip");
        active.id = "active-id".to_string();
        active.gid = Some("active-gid".to_string());
        active.status = DownloadStatus::Active;

        let mut removed = sample_task(PathBuf::from("D:\\Downloads"), "removed.zip");
        removed.id = "removed-id".to_string();
        removed.gid = Some("removed-gid".to_string());
        removed.status = DownloadStatus::Removed;

        let visible = visible_tasks(vec![active.clone(), removed]);

        assert_eq!(visible, vec![active]);
    }

    #[test]
    fn clearable_tasks_include_complete_and_error_only() {
        let mut complete = sample_task(PathBuf::from("D:\\Downloads"), "complete.zip");
        complete.id = "complete-id".to_string();
        complete.status = DownloadStatus::Complete;

        let mut error = sample_task(PathBuf::from("D:\\Downloads"), "error.zip");
        error.id = "error-id".to_string();
        error.status = DownloadStatus::Error;

        let mut active = sample_task(PathBuf::from("D:\\Downloads"), "active.zip");
        active.id = "active-id".to_string();
        active.status = DownloadStatus::Active;

        let clearable = clearable_tasks(&[complete.clone(), error.clone(), active]);

        assert_eq!(clearable, vec![complete, error]);
    }

    #[test]
    fn rebind_restored_task_keeps_app_id_and_updates_aria2_gid() {
        let mut stored = sample_task(PathBuf::from("D:\\Downloads"), "archive.zip");
        stored.id = "stored-id".to_string();
        stored.gid = Some("old-gid".to_string());
        stored.created_at = "2026-05-31T00:00:00.000Z".to_string();
        stored.options = DownloadTaskOptions {
            split: 6,
            max_connection_per_server: 6,
            speed_limit: 0,
            proxy_url: Some("http://127.0.0.1:7890".to_string()),
        };
        let mut restored = sample_task(PathBuf::from("D:\\Downloads"), "archive.zip");
        restored.id = "new-gid".to_string();
        restored.gid = Some("new-gid".to_string());
        restored.status = DownloadStatus::Active;

        let rebound = rebind_restored_task(restored, &stored);

        assert_eq!(rebound.id, "stored-id");
        assert_eq!(rebound.gid, Some("new-gid".to_string()));
        assert_eq!(rebound.created_at, "2026-05-31T00:00:00.000Z");
        assert_eq!(rebound.options.split, 6);
        assert_eq!(
            rebound.options.proxy_url,
            Some("http://127.0.0.1:7890".to_string())
        );
    }
}
