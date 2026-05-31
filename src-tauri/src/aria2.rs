use crate::models::{DownloadStatus, DownloadTask, DownloadTaskOptions};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aria2Config {
    pub rpc_url: String,
    pub secret: String,
    pub default_split: u32,
    pub max_connection_per_server: u32,
    pub min_split_size: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aria2LaunchPlan {
    pub binary_path: PathBuf,
    pub args: Vec<String>,
    pub session_file: PathBuf,
}

impl Default for Aria2Config {
    fn default() -> Self {
        Self {
            rpc_url: "http://127.0.0.1:6800/jsonrpc".to_string(),
            secret: "idm-local-secret".to_string(),
            default_split: 16,
            max_connection_per_server: 16,
            min_split_size: "1M".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddUriOptions {
    pub dir: String,
    pub out: Option<String>,
    pub split: String,
    pub max_connection_per_server: String,
    pub min_split_size: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_download_limit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub all_proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pause: Option<String>,
    #[serde(rename = "continue")]
    pub continue_download: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Aria2Uri {
    pub uri: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Aria2File {
    pub path: String,
    #[serde(default)]
    pub uris: Vec<Aria2Uri>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Aria2TaskStatus {
    pub gid: String,
    pub status: String,
    #[serde(default)]
    pub total_length: String,
    #[serde(default)]
    pub completed_length: String,
    #[serde(default)]
    pub download_speed: String,
    #[serde(default)]
    pub connections: String,
    #[serde(default)]
    pub dir: String,
    #[serde(default)]
    pub files: Vec<Aria2File>,
    #[serde(default)]
    pub error_message: Option<String>,
}

pub fn bundled_binary_path(resource_dir: &Path) -> PathBuf {
    let file_name = if cfg!(windows) { "aria2c.exe" } else { "aria2c" };
    resource_dir.join("aria2").join(file_name)
}

pub fn resolve_bundled_binary(resource_dir: &Path) -> Result<PathBuf, String> {
    let path = bundled_binary_path(resource_dir);

    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("未找到内置 aria2：{}", path.display()))
    }
}

fn rpc_port(config: &Aria2Config) -> u16 {
    config
        .rpc_url
        .split(':')
        .nth(2)
        .and_then(|tail| tail.split('/').next())
        .and_then(|port| port.parse::<u16>().ok())
        .unwrap_or(6800)
}

pub fn build_daemon_args(
    config: &Aria2Config,
    default_download_dir: &Path,
    session_file: &Path,
) -> Vec<String> {
    vec![
        "--enable-rpc=true".to_string(),
        "--rpc-listen-all=false".to_string(),
        format!("--rpc-listen-port={}", rpc_port(config)),
        format!("--rpc-secret={}", config.secret),
        "--continue=true".to_string(),
        format!("--split={}", config.default_split),
        format!(
            "--max-connection-per-server={}",
            config.max_connection_per_server
        ),
        format!("--min-split-size={}", config.min_split_size),
        format!("--dir={}", default_download_dir.display()),
        format!("--input-file={}", session_file.display()),
        format!("--save-session={}", session_file.display()),
        "--save-session-interval=5".to_string(),
        "--force-save=true".to_string(),
    ]
}

pub fn prepare_launch_plan(
    resource_dir: &Path,
    app_data_dir: &Path,
    default_download_dir: &Path,
    config: &Aria2Config,
) -> Result<Aria2LaunchPlan, String> {
    let binary_path = resolve_bundled_binary(resource_dir)?;
    std::fs::create_dir_all(app_data_dir)
        .map_err(|err| format!("无法创建 aria2 会话目录：{err}"))?;

    let session_file = app_data_dir.join("aria2.session");
    let args = build_daemon_args(config, default_download_dir, &session_file);

    Ok(Aria2LaunchPlan {
        binary_path,
        args,
        session_file,
    })
}

pub fn add_uri_options(
    save_dir: impl Into<String>,
    file_name: Option<String>,
    split: u32,
    speed_limit: u64,
    proxy_url: Option<String>,
    config: &Aria2Config,
) -> AddUriOptions {
    let safe_split = split.clamp(1, 32);

    AddUriOptions {
        dir: save_dir.into(),
        out: file_name,
        split: safe_split.to_string(),
        max_connection_per_server: config.max_connection_per_server.to_string(),
        min_split_size: config.min_split_size.clone(),
        max_download_limit: (speed_limit > 0).then(|| speed_limit.to_string()),
        all_proxy: proxy_url,
        pause: None,
        continue_download: "true".to_string(),
    }
}

pub fn build_add_uri_payload(
    url: &str,
    options: &AddUriOptions,
    config: &Aria2Config,
) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": "add-uri",
        "method": "aria2.addUri",
        "params": [
            format!("token:{}", config.secret),
            [url],
            options
        ]
    })
}

pub fn build_tell_version_payload(config: &Aria2Config) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": "get-version",
        "method": "aria2.getVersion",
        "params": [
            format!("token:{}", config.secret)
        ]
    })
}

#[cfg(test)]
pub fn build_global_stat_payload(config: &Aria2Config) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": "get-global-stat",
        "method": "aria2.getGlobalStat",
        "params": [
            format!("token:{}", config.secret)
        ]
    })
}

fn token(config: &Aria2Config) -> String {
    format!("token:{}", config.secret)
}

fn build_gid_payload(id: &str, method: &str, gid: &str, config: &Aria2Config) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": [
            token(config),
            gid
        ]
    })
}

pub fn build_pause_payload(gid: &str, config: &Aria2Config) -> Value {
    build_gid_payload("pause", "aria2.pause", gid, config)
}

pub fn build_resume_payload(gid: &str, config: &Aria2Config) -> Value {
    build_gid_payload("resume", "aria2.unpause", gid, config)
}

pub fn build_remove_payload(gid: &str, config: &Aria2Config) -> Value {
    build_gid_payload("remove", "aria2.remove", gid, config)
}

pub fn build_shutdown_payload(config: &Aria2Config) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": "shutdown",
        "method": "aria2.shutdown",
        "params": [
            token(config)
        ]
    })
}

pub fn build_tell_status_payload(gid: &str, config: &Aria2Config) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": "tell-status",
        "method": "aria2.tellStatus",
        "params": [
            token(config),
            gid,
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
        ]
    })
}

fn parse_u64(value: &str) -> u64 {
    value.parse::<u64>().unwrap_or(0)
}

fn parse_u32(value: &str) -> u32 {
    value.parse::<u32>().unwrap_or(0)
}

fn file_name_from_path(path: &str, fallback_gid: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback_gid)
        .to_string()
}

fn first_uri(files: &[Aria2File]) -> String {
    files
        .iter()
        .flat_map(|file| file.uris.iter())
        .find(|uri| uri.status.as_deref() == Some("used"))
        .or_else(|| files.iter().flat_map(|file| file.uris.iter()).next())
        .map(|uri| uri.uri.clone())
        .unwrap_or_default()
}

fn map_status(status: &str) -> DownloadStatus {
    match status {
        "active" => DownloadStatus::Active,
        "waiting" => DownloadStatus::Waiting,
        "paused" => DownloadStatus::Paused,
        "complete" => DownloadStatus::Complete,
        "removed" => DownloadStatus::Removed,
        _ => DownloadStatus::Error,
    }
}

pub fn normalize_error_text(message: &str) -> String {
    let lower = message.to_ascii_lowercase();

    if lower.contains("invalid range header") {
        return "服务器不支持断点续传，请降低线程数或重新下载".to_string();
    }

    if lower.contains("name resolution")
        || lower.contains("could not resolve")
        || lower.contains("dns")
        || lower.contains("resolve host")
    {
        return "DNS 解析失败，请检查链接域名或网络连接".to_string();
    }

    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection timeout")
    {
        return "网络连接超时，请检查网络或稍后重试".to_string();
    }

    if lower.contains("status=403") || lower.contains("status 403") || lower.contains("403") {
        return "服务器拒绝访问（403），请检查链接权限、Cookie 或代理设置".to_string();
    }

    if lower.contains("status=404") || lower.contains("status 404") || lower.contains("404") {
        return "下载地址不存在（404），请确认链接是否有效".to_string();
    }

    if lower.contains("status=5")
        || lower.contains("status 5")
        || lower.contains(" 5xx")
        || lower.contains("503")
        || lower.contains("502")
        || lower.contains("500")
    {
        let code = ["500", "502", "503", "504"]
            .iter()
            .find(|code| lower.contains(**code))
            .copied()
            .unwrap_or("5xx");
        return format!("服务器暂时不可用（{code}），请稍后重试");
    }

    if lower.contains("no space left") || lower.contains("disk full") {
        return "磁盘空间不足，请清理空间或更换下载目录".to_string();
    }

    if lower.contains("permission denied")
        || lower.contains("access is denied")
        || lower.contains("denied")
    {
        return "没有写入权限，请更换下载目录或以管理员权限运行".to_string();
    }

    if lower.contains("gid") && lower.contains("not found") {
        return "任务已不在 aria2 队列中，请刷新列表或重新下载".to_string();
    }

    message.to_string()
}

fn normalize_error_message(error_message: Option<String>) -> (Option<String>, bool) {
    match error_message {
        Some(message) => {
            let normalized = normalize_error_text(&message);
            let resumable = !message.to_ascii_lowercase().contains("invalid range header");
            (Some(normalized), resumable)
        }
        None => (None, true),
    }
}

impl Aria2TaskStatus {
    pub fn into_download_task(self) -> DownloadTask {
        let file_path = self
            .files
            .first()
            .map(|file| file.path.as_str())
            .unwrap_or_default();
        let file_name = file_name_from_path(file_path, &self.gid);
        let url = first_uri(&self.files);
        let status = map_status(&self.status);
        let now = "1970-01-01T00:00:00.000Z".to_string();
        let (error_message, resumable) = normalize_error_message(self.error_message);

        DownloadTask {
            id: self.gid.clone(),
            gid: Some(self.gid),
            url,
            file_name,
            save_dir: self.dir,
            total_bytes: parse_u64(&self.total_length),
            completed_bytes: parse_u64(&self.completed_length),
            download_speed: parse_u64(&self.download_speed),
            connections: parse_u32(&self.connections),
            status,
            resumable,
            error_message,
            created_at: now.clone(),
            updated_at: now,
            options: DownloadTaskOptions {
                split: 16,
                max_connection_per_server: 16,
                speed_limit: 0,
                proxy_url: None,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_binary_path_points_to_resource_aria2c() {
        let path = bundled_binary_path(Path::new("resources"));

        assert!(path.ends_with(Path::new("aria2").join("aria2c.exe")));
    }

    #[test]
    fn add_uri_options_enable_resume_and_clamp_split() {
        let config = Aria2Config::default();
        let options = add_uri_options(
            "D:\\Downloads",
            Some("file.iso".to_string()),
            64,
            0,
            None,
            &config,
        );

        assert_eq!(options.dir, "D:\\Downloads");
        assert_eq!(options.out, Some("file.iso".to_string()));
        assert_eq!(options.split, "32");
        assert_eq!(options.max_connection_per_server, "16");
        assert_eq!(options.continue_download, "true");
    }

    #[test]
    fn add_uri_options_include_proxy_when_configured() {
        let config = Aria2Config::default();
        let options = add_uri_options(
            "D:\\Downloads",
            None,
            8,
            0,
            Some("http://127.0.0.1:7890".to_string()),
            &config,
        );

        let value = serde_json::to_value(options).unwrap();

        assert_eq!(value["allProxy"], "http://127.0.0.1:7890");
        assert_eq!(value["continue"], "true");
    }

    #[test]
    fn add_uri_options_include_speed_limit_when_configured() {
        let config = Aria2Config::default();
        let options = add_uri_options("D:\\Downloads", None, 8, 524_288, None, &config);

        let value = serde_json::to_value(options).unwrap();

        assert_eq!(value["maxDownloadLimit"], "524288");
    }

    #[test]
    fn add_uri_payload_uses_token_and_aria2_method() {
        let config = Aria2Config::default();
        let options = add_uri_options("D:\\Downloads", None, 16, 0, None, &config);
        let payload = build_add_uri_payload("https://example.com/file.zip", &options, &config);

        assert_eq!(payload["method"], "aria2.addUri");
        assert_eq!(payload["params"][0], "token:idm-local-secret");
        assert_eq!(payload["params"][1][0], "https://example.com/file.zip");
        assert_eq!(payload["params"][2]["continue"], "true");
    }

    #[test]
    fn resolve_bundled_binary_reports_clear_missing_error() {
        let err = resolve_bundled_binary(Path::new("Z:\\missing-idm-resources")).unwrap_err();

        assert!(err.to_string().contains("未找到内置 aria2"));
        assert!(err
            .to_string()
            .contains("Z:\\missing-idm-resources\\aria2\\aria2c.exe"));
    }

    #[test]
    fn daemon_args_enable_rpc_resume_and_session_restore() {
        let config = Aria2Config::default();
        let args = build_daemon_args(
            &config,
            Path::new("D:\\Downloads"),
            Path::new("D:\\IDM\\aria2.session"),
        );

        assert!(args.contains(&"--enable-rpc=true".to_string()));
        assert!(args.contains(&"--rpc-listen-all=false".to_string()));
        assert!(args.contains(&"--rpc-listen-port=6800".to_string()));
        assert!(args.contains(&"--rpc-secret=idm-local-secret".to_string()));
        assert!(args.contains(&"--continue=true".to_string()));
        assert!(args.contains(&"--split=16".to_string()));
        assert!(args.contains(&"--max-connection-per-server=16".to_string()));
        assert!(args.contains(&"--min-split-size=1M".to_string()));
        assert!(args.contains(&"--dir=D:\\Downloads".to_string()));
        assert!(args.contains(&"--input-file=D:\\IDM\\aria2.session".to_string()));
        assert!(args.contains(&"--save-session=D:\\IDM\\aria2.session".to_string()));
    }

    #[test]
    fn status_payloads_use_token_authenticated_aria2_methods() {
        let config = Aria2Config::default();
        let version_payload = build_tell_version_payload(&config);
        let stat_payload = build_global_stat_payload(&config);

        assert_eq!(version_payload["method"], "aria2.getVersion");
        assert_eq!(version_payload["params"][0], "token:idm-local-secret");
        assert_eq!(stat_payload["method"], "aria2.getGlobalStat");
        assert_eq!(stat_payload["params"][0], "token:idm-local-secret");
    }

    #[test]
    fn prepare_launch_plan_uses_bundled_binary_and_app_session_file() {
        let root = std::env::temp_dir().join(format!("idm-aria2-test-{}", uuid::Uuid::new_v4()));
        let resource_dir = root.join("resources");
        let app_data_dir = root.join("data");
        let default_download_dir = root.join("downloads");
        let binary_path = bundled_binary_path(&resource_dir);

        std::fs::create_dir_all(binary_path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&default_download_dir).unwrap();
        std::fs::write(&binary_path, "").unwrap();

        let plan = prepare_launch_plan(
            &resource_dir,
            &app_data_dir,
            &default_download_dir,
            &Aria2Config::default(),
        )
        .unwrap();

        assert_eq!(plan.binary_path, binary_path);
        assert_eq!(plan.session_file, app_data_dir.join("aria2.session"));
        assert!(plan.args.contains(&format!(
            "--save-session={}",
            app_data_dir.join("aria2.session").display()
        )));
        assert!(app_data_dir.exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn task_control_payloads_use_gid_and_token() {
        let config = Aria2Config::default();
        let pause_payload = build_pause_payload("abc123", &config);
        let resume_payload = build_resume_payload("abc123", &config);
        let remove_payload = build_remove_payload("abc123", &config);
        let status_payload = build_tell_status_payload("abc123", &config);

        assert_eq!(pause_payload["method"], "aria2.pause");
        assert_eq!(resume_payload["method"], "aria2.unpause");
        assert_eq!(remove_payload["method"], "aria2.remove");
        assert_eq!(status_payload["method"], "aria2.tellStatus");
        assert_eq!(pause_payload["params"][0], "token:idm-local-secret");
        assert_eq!(pause_payload["params"][1], "abc123");
        assert_eq!(status_payload["params"][2][0], "gid");
        assert_eq!(status_payload["params"][2][1], "status");
    }

    #[test]
    fn shutdown_payload_uses_token_authenticated_method() {
        let payload = build_shutdown_payload(&Aria2Config::default());

        assert_eq!(payload["method"], "aria2.shutdown");
        assert_eq!(payload["params"][0], "token:idm-local-secret");
    }

    #[test]
    fn aria2_status_maps_to_download_task() {
        let status: Aria2TaskStatus = serde_json::from_value(json!({
            "gid": "abc123",
            "status": "active",
            "totalLength": "1048576",
            "completedLength": "524288",
            "downloadSpeed": "262144",
            "connections": "8",
            "dir": "D:\\Downloads",
            "files": [{
                "path": "D:\\Downloads\\archive.zip",
                "uris": [{
                    "uri": "https://example.com/archive.zip",
                    "status": "used"
                }]
            }]
        }))
        .unwrap();

        let task = status.into_download_task();

        assert_eq!(task.id, "abc123");
        assert_eq!(task.gid, Some("abc123".to_string()));
        assert_eq!(task.file_name, "archive.zip");
        assert_eq!(task.url, "https://example.com/archive.zip");
        assert_eq!(task.total_bytes, 1_048_576);
        assert_eq!(task.completed_bytes, 524_288);
        assert_eq!(task.download_speed, 262_144);
        assert_eq!(task.connections, 8);
        assert_eq!(task.status, crate::models::DownloadStatus::Active);
        assert!(task.resumable);
    }

    #[test]
    fn invalid_range_error_marks_task_as_not_resumable() {
        let status: Aria2TaskStatus = serde_json::from_value(json!({
            "gid": "range-error",
            "status": "error",
            "totalLength": "4194304",
            "completedLength": "294912",
            "downloadSpeed": "0",
            "connections": "0",
            "dir": "D:\\Downloads",
            "errorMessage": "Invalid range header. Request: 294912-4194303/4194304, Response: 0-4194303/4194304",
            "files": [{
                "path": "D:\\Downloads\\big.bin",
                "uris": [{
                    "uri": "http://127.0.0.1/big.bin",
                    "status": "used"
                }]
            }]
        }))
        .unwrap();

        let task = status.into_download_task();

        assert_eq!(task.status, crate::models::DownloadStatus::Error);
        assert!(!task.resumable);
        assert_eq!(
            task.error_message,
            Some("服务器不支持断点续传，请降低线程数或重新下载".to_string())
        );
    }

    #[test]
    fn normalizes_common_network_and_http_errors() {
        assert_eq!(
            normalize_error_text("Name resolution for example.invalid failed"),
            "DNS 解析失败，请检查链接域名或网络连接"
        );
        assert_eq!(
            normalize_error_text("Timeout while connecting to server"),
            "网络连接超时，请检查网络或稍后重试"
        );
        assert_eq!(
            normalize_error_text("The response status is not successful. status=403"),
            "服务器拒绝访问（403），请检查链接权限、Cookie 或代理设置"
        );
        assert_eq!(
            normalize_error_text("The response status is not successful. status=404"),
            "下载地址不存在（404），请确认链接是否有效"
        );
        assert_eq!(
            normalize_error_text("The response status is not successful. status=503"),
            "服务器暂时不可用（503），请稍后重试"
        );
    }

    #[test]
    fn normalizes_storage_and_task_errors() {
        assert_eq!(
            normalize_error_text("No space left on device"),
            "磁盘空间不足，请清理空间或更换下载目录"
        );
        assert_eq!(
            normalize_error_text("Permission denied: C:\\Downloads"),
            "没有写入权限，请更换下载目录或以管理员权限运行"
        );
        assert_eq!(
            normalize_error_text("GID abc is not found"),
            "任务已不在 aria2 队列中，请刷新列表或重新下载"
        );
    }
}
