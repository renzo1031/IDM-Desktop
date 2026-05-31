use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Waiting,
    Active,
    Paused,
    Complete,
    Error,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTaskOptions {
    pub split: u32,
    pub max_connection_per_server: u32,
    pub speed_limit: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub gid: Option<String>,
    pub url: String,
    pub file_name: String,
    pub save_dir: String,
    pub total_bytes: u64,
    pub completed_bytes: u64,
    pub download_speed: u64,
    pub connections: u32,
    pub status: DownloadStatus,
    pub resumable: bool,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub options: DownloadTaskOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub app_name: String,
    pub aria2_engine: EngineStatus,
    pub default_split: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EngineStatus {
    Bundled,
    Starting,
    Connected,
    Error,
}
