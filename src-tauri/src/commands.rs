use crate::aria2::{add_uri_options, resolve_bundled_binary, AddUriOptions, Aria2Config};
use crate::models::{AppStatus, EngineStatus};
#[cfg(not(test))]
use crate::{models::DownloadTask, services::DownloadService};
use serde::{Deserialize, Serialize};
#[cfg(not(test))]
use tauri::State;
#[cfg(not(test))]
use tauri::Manager;

pub fn current_app_status() -> AppStatus {
    app_status_for_engine(EngineStatus::Bundled, &Aria2Config::default())
}

fn app_status_for_engine(aria2_engine: EngineStatus, config: &Aria2Config) -> AppStatus {
    AppStatus {
        app_name: "IDM Desktop".to_string(),
        aria2_engine,
        default_split: config.default_split,
    }
}

pub fn app_status_from_resource_dir(resource_dir: &std::path::Path, config: &Aria2Config) -> AppStatus {
    let engine = if resolve_bundled_binary(resource_dir).is_ok() {
        EngineStatus::Bundled
    } else {
        EngineStatus::Error
    };

    app_status_for_engine(engine, config)
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateDownloadInput {
    pub url: String,
    pub save_dir: String,
    pub file_name: Option<String>,
    pub split: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateDownloadRequest {
    pub url: String,
    pub options: AddUriOptions,
}

pub fn validate_create_download_input(input: &CreateDownloadInput) -> Result<(), String> {
    let url = input.url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持 HTTP/HTTPS 下载链接".to_string());
    }

    if input.save_dir.trim().is_empty() {
        return Err("保存目录不能为空".to_string());
    }

    Ok(())
}

pub fn build_create_download_request(
    input: &CreateDownloadInput,
    config: &Aria2Config,
) -> Result<CreateDownloadRequest, String> {
    validate_create_download_input(input)?;
    let options = add_uri_options(
        input.save_dir.trim(),
        input
            .file_name
            .as_ref()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty()),
        input.split.unwrap_or(config.default_split),
        config,
    );

    Ok(CreateDownloadRequest {
        url: input.url.trim().to_string(),
        options,
    })
}

#[cfg_attr(not(test), tauri::command)]
#[cfg(not(test))]
pub fn app_status(app: tauri::AppHandle) -> AppStatus {
    let config = Aria2Config::default();
    match app.path().resource_dir() {
        Ok(resource_dir) => app_status_from_resource_dir(&resource_dir, &config),
        Err(_) => app_status_for_engine(EngineStatus::Error, &config),
    }
}

#[cfg(test)]
pub fn app_status() -> AppStatus {
    current_app_status()
}

#[cfg(not(test))]
#[tauri::command]
pub async fn list_downloads(service: State<'_, DownloadService>) -> Result<Vec<DownloadTask>, String> {
    service.list_downloads().await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn create_download(
    input: CreateDownloadInput,
    service: State<'_, DownloadService>,
) -> Result<DownloadTask, String> {
    let request = build_create_download_request(&input, service.config())?;
    let gid = service.add_uri(&request.url, &request.options).await?;
    service.tell_status(&gid).await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn pause_download(gid: String, service: State<'_, DownloadService>) -> Result<(), String> {
    service.pause(&gid).await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn resume_download(gid: String, service: State<'_, DownloadService>) -> Result<(), String> {
    service.resume(&gid).await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn remove_download(gid: String, service: State<'_, DownloadService>) -> Result<(), String> {
    service.remove(&gid).await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn remove_download_with_file(
    gid: String,
    delete_file: bool,
    service: State<'_, DownloadService>,
) -> Result<(), String> {
    service.remove_with_file(&gid, delete_file).await
}

#[cfg(not(test))]
#[tauri::command]
pub fn open_download_file(gid: String, service: State<'_, DownloadService>) -> Result<(), String> {
    let file_path = service.download_file_path(&gid)?;
    tauri_plugin_opener::open_path(&file_path, None::<&str>)
        .map_err(|err| format!("无法打开文件 {}：{err}", file_path.display()))
}

#[cfg(not(test))]
#[tauri::command]
pub fn open_download_dir(gid: String, service: State<'_, DownloadService>) -> Result<(), String> {
    let dir_path = service.download_dir_path(&gid)?;
    tauri_plugin_opener::open_path(&dir_path, None::<&str>)
        .map_err(|err| format!("无法打开目录 {}：{err}", dir_path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aria2::{bundled_binary_path, Aria2Config};

    #[test]
    fn current_app_status_uses_bundled_aria2_defaults() {
        let status = current_app_status();

        assert_eq!(status.app_name, "IDM Desktop");
        assert_eq!(status.aria2_engine, EngineStatus::Bundled);
        assert_eq!(status.default_split, 16);
    }

    #[test]
    fn app_status_from_resource_dir_reports_bundled_engine_when_binary_exists() {
        let root = std::env::temp_dir().join(format!("idm-command-test-{}", uuid::Uuid::new_v4()));
        let binary_path = bundled_binary_path(&root);

        std::fs::create_dir_all(binary_path.parent().unwrap()).unwrap();
        std::fs::write(&binary_path, "").unwrap();

        let status = app_status_from_resource_dir(&root, &Aria2Config::default());

        assert_eq!(status.aria2_engine, EngineStatus::Bundled);
        assert_eq!(status.default_split, 16);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn app_status_from_resource_dir_reports_error_when_binary_is_missing() {
        let root = std::env::temp_dir().join(format!("idm-command-test-{}", uuid::Uuid::new_v4()));
        let status = app_status_from_resource_dir(&root, &Aria2Config::default());

        assert_eq!(status.aria2_engine, EngineStatus::Error);
        assert_eq!(status.default_split, 16);
    }

    #[test]
    fn create_download_input_rejects_non_http_url() {
        let input = CreateDownloadInput {
            url: "ftp://example.com/file.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            file_name: None,
            split: None,
        };

        let err = validate_create_download_input(&input).unwrap_err();

        assert!(err.contains("仅支持 HTTP/HTTPS"));
    }

    #[test]
    fn create_download_input_uses_default_split_when_missing() {
        let input = CreateDownloadInput {
            url: "https://example.com/file.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            file_name: None,
            split: None,
        };

        let request = build_create_download_request(&input, &Aria2Config::default()).unwrap();

        assert_eq!(request.url, "https://example.com/file.zip");
        assert_eq!(request.options.dir, "D:\\Downloads");
        assert_eq!(request.options.split, "16");
        assert_eq!(request.options.continue_download, "true");
    }
}
