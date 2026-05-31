use crate::aria2::{
    build_add_uri_payload, build_pause_payload, build_remove_payload, build_resume_payload,
    build_shutdown_payload, build_tell_status_payload, prepare_launch_plan, AddUriOptions,
    Aria2Config, Aria2TaskStatus,
};
use crate::models::{DownloadStatus, DownloadTask};
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
        let payload = build_add_uri_payload(url, options, &self.inner.config);
        let gid = self.rpc::<String>(payload).await?;
        if let Ok(task) = self.tell_status(&gid).await {
            self.inner.store.upsert(task)?;
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
            tasks.extend(statuses.into_iter().map(Aria2TaskStatus::into_download_task));
        }

        for task in &tasks {
            self.inner.store.upsert(task.clone())?;
        }

        for stored_task in stored_tasks {
            if !tasks.iter().any(|task| task.id == stored_task.id) {
                tasks.push(stored_task);
            }
        }

        Ok(tasks)
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

    pub async fn remove(&self, gid: &str) -> Result<(), String> {
        self.remove_with_file(gid, false).await
    }

    pub async fn remove_with_file(&self, gid: &str, delete_file: bool) -> Result<(), String> {
        self.ensure_started().await?;
        self.rpc::<String>(build_remove_payload(gid, &self.inner.config))
            .await?;
        if delete_file {
            self.delete_download_file(gid)?;
        }
        self.inner.store.remove(gid)
    }

    pub fn download_file_path(&self, id: &str) -> Result<PathBuf, String> {
        let task = self
            .inner
            .store
            .find(id)?
            .ok_or_else(|| "任务不存在".to_string())?;
        Ok(download_file_path_from_task(&task))
    }

    pub fn download_dir_path(&self, id: &str) -> Result<PathBuf, String> {
        let task = self
            .inner
            .store
            .find(id)?
            .ok_or_else(|| "任务不存在".to_string())?;
        Ok(PathBuf::from(task.save_dir))
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
        Ok(status.into_download_task())
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
        let payload = json!({
            "jsonrpc": "2.0",
            "id": "get-version",
            "method": "aria2.getVersion",
            "params": [format!("token:{}", self.inner.config.secret)]
        });
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
            .map_err(|err| format!("aria2 RPC 请求失败：{err}"))?;
        let body = response
            .json::<RpcResponse<T>>()
            .await
            .map_err(|err| format!("aria2 RPC 响应解析失败：{err}"))?;

        match (body.result, body.error) {
            (Some(result), _) => Ok(result),
            (_, Some(err)) => Err(format!("aria2 RPC 错误：{}", err.message)),
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

pub fn download_file_path_from_task(task: &DownloadTask) -> PathBuf {
    PathBuf::from(&task.save_dir).join(&task.file_name)
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
}
