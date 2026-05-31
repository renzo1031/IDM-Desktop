use crate::aria2::{add_uri_options, resolve_bundled_binary, AddUriOptions, Aria2Config};
use crate::models::{AppStatus, DownloadTask, EngineStatus};
#[cfg(not(test))]
use crate::services::DownloadService;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
#[cfg(not(test))]
use tauri::State;
#[cfg(not(test))]
use tauri::Manager;

#[cfg(test)]
pub fn current_app_status() -> AppStatus {
    app_status_for_engine(EngineStatus::Bundled, &Aria2Config::default())
}

fn app_status_for_engine(aria2_engine: EngineStatus, config: &Aria2Config) -> AppStatus {
    AppStatus {
        app_name: "IDM Desktop".to_string(),
        aria2_engine,
        default_split: config.default_split,
        max_active_downloads: config.max_concurrent_downloads,
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
    pub total_bytes: Option<u64>,
    pub resumable: Option<bool>,
    pub split: Option<u32>,
    pub speed_limit: Option<u64>,
    pub proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateDownloadRequest {
    pub url: String,
    pub options: AddUriOptions,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueSettingsInput {
    pub max_active_downloads: u32,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDownloadInput {
    pub url: String,
    pub proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPreview {
    pub url: String,
    pub file_name: String,
    pub total_bytes: Option<u64>,
    pub resumable: bool,
}

fn validate_download_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持 HTTP/HTTPS 下载链接".to_string());
    }

    Ok(())
}

fn normalize_proxy_url(proxy_url: Option<&str>) -> Result<Option<String>, String> {
    let Some(proxy_url) = proxy_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    if !(proxy_url.starts_with("http://")
        || proxy_url.starts_with("https://")
        || proxy_url.starts_with("socks4://")
        || proxy_url.starts_with("socks5://"))
    {
        return Err("代理地址仅支持 HTTP/HTTPS/SOCKS4/SOCKS5".to_string());
    }

    Ok(Some(proxy_url.to_string()))
}

pub fn validate_create_download_input(input: &CreateDownloadInput) -> Result<(), String> {
    let url = input.url.trim();
    validate_download_url(url)?;

    if input.save_dir.trim().is_empty() {
        return Err("保存目录不能为空".to_string());
    }

    normalize_proxy_url(input.proxy_url.as_deref())?;

    Ok(())
}

pub fn validate_preview_download_input(input: &PreviewDownloadInput) -> Result<(), String> {
    validate_download_url(input.url.trim())?;
    normalize_proxy_url(input.proxy_url.as_deref())?;

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
        input.speed_limit.unwrap_or(0),
        normalize_proxy_url(input.proxy_url.as_deref())?,
        config,
    );

    Ok(CreateDownloadRequest {
        url: input.url.trim().to_string(),
        options,
    })
}

pub fn retry_input_from_task(task: &crate::models::DownloadTask) -> CreateDownloadInput {
    CreateDownloadInput {
        url: task.url.clone(),
        save_dir: task.save_dir.clone(),
        file_name: Some(task.file_name.clone()),
        total_bytes: Some(task.total_bytes),
        resumable: Some(task.resumable),
        split: Some(task.options.split),
        speed_limit: Some(task.options.speed_limit),
        proxy_url: task.options.proxy_url.clone(),
    }
}

pub fn normalize_max_active_downloads(value: u32) -> u32 {
    value.clamp(1, 64)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                decoded.push(hex);
                index += 3;
                continue;
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8(decoded).unwrap_or_else(|_| value.to_string())
}

fn sanitize_file_name(value: impl Into<Cow<'static, str>>) -> Option<String> {
    let file_name = value
        .into()
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");

    (!file_name.is_empty() && file_name != "." && file_name != "..").then_some(file_name)
}

pub fn file_name_from_download_url(url: &str) -> String {
    let path = url
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(url)
        .split_once('#')
        .map(|(path, _)| path)
        .unwrap_or_else(|| url.split_once('?').map(|(path, _)| path).unwrap_or(url));
    let decoded = percent_decode(path.rsplit('/').next().unwrap_or_default());

    sanitize_file_name(Cow::Owned(decoded)).unwrap_or_else(|| "download.bin".to_string())
}

pub fn file_name_from_content_disposition(value: &str) -> Option<String> {
    for segment in value.split(';').map(str::trim) {
        let lower = segment.to_ascii_lowercase();
        if lower.starts_with("filename*=") {
            let raw = segment.split_once('=')?.1.trim().trim_matches('"');
            let encoded = raw
                .split_once("''")
                .map(|(_, value)| value)
                .unwrap_or(raw);
            return sanitize_file_name(Cow::Owned(percent_decode(encoded)));
        }

        if lower.starts_with("filename=") {
            let raw = segment.split_once('=')?.1.trim();
            return sanitize_file_name(Cow::Owned(percent_decode(raw)));
        }
    }

    None
}

pub fn build_download_preview(
    url: &str,
    content_disposition: Option<&str>,
    content_length: Option<&str>,
    accept_ranges: Option<&str>,
    content_range: Option<&str>,
) -> DownloadPreview {
    let file_name = content_disposition
        .and_then(file_name_from_content_disposition)
        .unwrap_or_else(|| file_name_from_download_url(url));
    let total_bytes = content_length.and_then(|value| value.parse::<u64>().ok());
    let resumable = accept_ranges
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("bytes"))
        || content_range.is_some_and(|value| value.trim().to_ascii_lowercase().starts_with("bytes"));

    DownloadPreview {
        url: url.to_string(),
        file_name,
        total_bytes,
        resumable,
    }
}

fn build_preview_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
    let mut client_builder = reqwest::Client::builder();
    if let Some(proxy_url) = normalize_proxy_url(proxy_url)? {
        let proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|err| format!("无法使用代理地址：{err}"))?;
        client_builder = client_builder.proxy(proxy);
    }

    client_builder
        .build()
        .map_err(|err| format!("无法初始化预解析请求：{err}"))
}

pub fn apply_preview_metadata(task: &mut DownloadTask, input: &CreateDownloadInput) {
    if task.total_bytes == 0 {
        if let Some(total_bytes) = input.total_bytes {
            task.total_bytes = total_bytes;
        }
    }

    if let Some(resumable) = input.resumable {
        task.resumable = resumable;
    }
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
    let mut task = service.tell_status(&gid).await?;
    apply_preview_metadata(&mut task, &input);
    Ok(task)
}

#[cfg(not(test))]
#[tauri::command]
pub async fn retry_download(
    gid: String,
    service: State<'_, DownloadService>,
) -> Result<DownloadTask, String> {
    let task = service.stored_task(&gid)?;
    let input = retry_input_from_task(&task);
    let request = build_create_download_request(&input, service.config())?;
    let next_gid = service.add_uri(&request.url, &request.options).await?;
    service.tell_status(&next_gid).await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn preview_download(input: PreviewDownloadInput) -> Result<DownloadPreview, String> {
    validate_preview_download_input(&input)?;
    let url = input.url.trim();

    let client = build_preview_client(input.proxy_url.as_deref())?;
    let response = client
        .head(url)
        .send()
        .await
        .map_err(|err| format!("无法解析文件信息：{err}"))?;

    let headers = response.headers();
    Ok(build_download_preview(
        url,
        headers
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok()),
        headers
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok()),
        headers
            .get(reqwest::header::ACCEPT_RANGES)
            .and_then(|value| value.to_str().ok()),
        headers
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok()),
    ))
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
pub async fn update_queue_settings(
    input: QueueSettingsInput,
    service: State<'_, DownloadService>,
) -> Result<(), String> {
    service
        .update_queue_settings(normalize_max_active_downloads(input.max_active_downloads))
        .await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn pause_all_downloads(service: State<'_, DownloadService>) -> Result<(), String> {
    service.pause_all().await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn resume_all_downloads(service: State<'_, DownloadService>) -> Result<(), String> {
    service.resume_all().await
}

#[cfg(not(test))]
#[tauri::command]
pub async fn purge_stopped_downloads(service: State<'_, DownloadService>) -> Result<(), String> {
    service.purge_stopped().await
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
        assert_eq!(status.max_active_downloads, 3);
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
        assert_eq!(status.max_active_downloads, 3);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn app_status_from_resource_dir_reports_error_when_binary_is_missing() {
        let root = std::env::temp_dir().join(format!("idm-command-test-{}", uuid::Uuid::new_v4()));
        let status = app_status_from_resource_dir(&root, &Aria2Config::default());

        assert_eq!(status.aria2_engine, EngineStatus::Error);
        assert_eq!(status.default_split, 16);
        assert_eq!(status.max_active_downloads, 3);
    }

    #[test]
    fn create_download_input_rejects_non_http_url() {
        let input = CreateDownloadInput {
            url: "ftp://example.com/file.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            file_name: None,
            total_bytes: None,
            resumable: None,
            split: None,
            speed_limit: None,
            proxy_url: None,
        };

        let err = validate_create_download_input(&input).unwrap_err();

        assert!(err.contains("仅支持 HTTP/HTTPS"));
    }

    #[test]
    fn file_name_from_download_url_ignores_query_and_decodes_spaces() {
        assert_eq!(
            file_name_from_download_url("https://example.com/files/My%20App.zip?token=abc"),
            "My App.zip"
        );
        assert_eq!(file_name_from_download_url("https://example.com/"), "download.bin");
    }

    #[test]
    fn content_disposition_file_name_overrides_url_name() {
        assert_eq!(
            file_name_from_content_disposition("attachment; filename=\"setup.exe\""),
            Some("setup.exe".to_string())
        );
        assert_eq!(
            file_name_from_content_disposition("attachment; filename*=UTF-8''movie%20clip.mp4"),
            Some("movie clip.mp4".to_string())
        );
    }

    #[test]
    fn build_download_preview_uses_headers_for_size_and_resume_support() {
        let preview = build_download_preview(
            "https://example.com/files/fallback.zip",
            Some("attachment; filename=\"archive.zip\""),
            Some("1048576"),
            Some("bytes"),
            None,
        );

        assert_eq!(
            preview,
            DownloadPreview {
                url: "https://example.com/files/fallback.zip".to_string(),
                file_name: "archive.zip".to_string(),
                total_bytes: Some(1_048_576),
                resumable: true,
            }
        );

        let no_range = build_download_preview(
            "https://example.com/files/plain.bin",
            None,
            Some("not-a-number"),
            Some("none"),
            None,
        );

        assert_eq!(no_range.file_name, "plain.bin");
        assert_eq!(no_range.total_bytes, None);
        assert!(!no_range.resumable);
    }

    #[test]
    fn create_download_input_uses_default_split_when_missing() {
        let input = CreateDownloadInput {
            url: "https://example.com/file.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            file_name: None,
            total_bytes: None,
            resumable: None,
            split: None,
            speed_limit: None,
            proxy_url: None,
        };

        let request = build_create_download_request(&input, &Aria2Config::default()).unwrap();

        assert_eq!(request.url, "https://example.com/file.zip");
        assert_eq!(request.options.dir, "D:\\Downloads");
        assert_eq!(request.options.split, "16");
        assert_eq!(request.options.continue_download, "true");
    }

    #[test]
    fn create_download_input_passes_proxy_to_aria2_options() {
        let input = CreateDownloadInput {
            url: "https://example.com/file.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            file_name: None,
            total_bytes: None,
            resumable: None,
            split: Some(8),
            speed_limit: None,
            proxy_url: Some(" http://127.0.0.1:7890 ".to_string()),
        };

        let request = build_create_download_request(&input, &Aria2Config::default()).unwrap();

        assert_eq!(
            request.options.all_proxy,
            Some("http://127.0.0.1:7890".to_string())
        );
    }

    #[test]
    fn create_download_input_rejects_unsupported_proxy_scheme() {
        let input = CreateDownloadInput {
            url: "https://example.com/file.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            file_name: None,
            total_bytes: None,
            resumable: None,
            split: None,
            speed_limit: None,
            proxy_url: Some("ftp://127.0.0.1:7890".to_string()),
        };

        let err = validate_create_download_input(&input).unwrap_err();

        assert!(err.contains("代理地址仅支持"));
    }

    #[test]
    fn preview_download_input_rejects_unsupported_proxy_scheme() {
        let input = PreviewDownloadInput {
            url: "https://example.com/file.zip".to_string(),
            proxy_url: Some("ftp://127.0.0.1:7890".to_string()),
        };

        let err = validate_preview_download_input(&input).unwrap_err();

        assert!(err.contains("代理地址仅支持"));
    }

    #[test]
    fn preview_client_accepts_socks_proxy_urls() {
        let client = build_preview_client(Some("socks5://127.0.0.1:7890"));

        assert!(client.is_ok());
    }

    #[test]
    fn retry_download_input_reuses_existing_task_metadata() {
        let task = crate::models::DownloadTask {
            id: "gid-1".to_string(),
            gid: Some("gid-1".to_string()),
            url: "https://example.com/archive.zip".to_string(),
            file_name: "archive.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            total_bytes: 100,
            completed_bytes: 40,
            download_speed: 0,
            connections: 0,
            status: crate::models::DownloadStatus::Error,
            resumable: true,
            error_message: Some("网络中断".to_string()),
            created_at: "2026-05-31T00:00:00.000Z".to_string(),
            updated_at: "2026-05-31T00:00:00.000Z".to_string(),
            options: crate::models::DownloadTaskOptions {
                split: 8,
                max_connection_per_server: 8,
                speed_limit: 0,
                proxy_url: Some("http://127.0.0.1:7890".to_string()),
            },
        };

        let input = retry_input_from_task(&task);

        assert_eq!(input.url, "https://example.com/archive.zip");
        assert_eq!(input.save_dir, "D:\\Downloads");
        assert_eq!(input.file_name, Some("archive.zip".to_string()));
        assert_eq!(input.split, Some(8));
        assert_eq!(input.speed_limit, Some(0));
        assert_eq!(
            input.proxy_url,
            Some("http://127.0.0.1:7890".to_string())
        );
    }

    #[test]
    fn preview_metadata_overrides_empty_initial_task_status() {
        let mut task = crate::models::DownloadTask {
            id: "gid-1".to_string(),
            gid: Some("gid-1".to_string()),
            url: "https://example.com/archive.zip".to_string(),
            file_name: "archive.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            total_bytes: 0,
            completed_bytes: 0,
            download_speed: 0,
            connections: 0,
            status: crate::models::DownloadStatus::Waiting,
            resumable: true,
            error_message: None,
            created_at: "2026-05-31T00:00:00.000Z".to_string(),
            updated_at: "2026-05-31T00:00:00.000Z".to_string(),
            options: crate::models::DownloadTaskOptions {
                split: 16,
                max_connection_per_server: 16,
                speed_limit: 0,
                proxy_url: None,
            },
        };
        let input = CreateDownloadInput {
            url: "https://example.com/archive.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            file_name: Some("archive.zip".to_string()),
            split: None,
            speed_limit: None,
            proxy_url: None,
            total_bytes: Some(1_048_576),
            resumable: Some(false),
        };

        apply_preview_metadata(&mut task, &input);

        assert_eq!(task.total_bytes, 1_048_576);
        assert!(!task.resumable);
    }

    #[test]
    fn create_download_input_passes_speed_limit_to_aria2_options() {
        let input = CreateDownloadInput {
            url: "https://example.com/file.zip".to_string(),
            save_dir: "D:\\Downloads".to_string(),
            file_name: None,
            split: Some(4),
            speed_limit: Some(524_288),
            proxy_url: None,
            total_bytes: None,
            resumable: None,
        };

        let request = build_create_download_request(&input, &Aria2Config::default()).unwrap();

        assert_eq!(
            request.options.max_download_limit,
            Some("524288".to_string())
        );
    }
}
