use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Server {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub username: String,
    pub port: u16,
    pub ssh_key_path: String,
    pub host_key_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Volume {
    pub name: String,
    pub driver: String,
    pub in_use: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub id: i64,
    pub source_server_name: String,
    pub dest_server_name: String,
    pub volume_names: Vec<String>,
    pub total_size_bytes: u64,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub duration_seconds: Option<u64>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Pending,
    InProgress,
    Complete,
    Failed(String),
    Skipped,
    Cancelled,
}

impl TransferStatus {
    pub fn as_str(&self) -> &str {
        match self {
            TransferStatus::Pending => "pending",
            TransferStatus::InProgress => "in_progress",
            TransferStatus::Complete => "complete",
            TransferStatus::Failed(_) => "failed",
            TransferStatus::Skipped => "skipped",
            TransferStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransferVolume {
    pub name: String,
    pub size_bytes: u64,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransferEvent {
    pub volume_name: String,
    pub status: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VolumeResult {
    pub name: String,
    pub size_bytes: u64,
    pub duration_seconds: u64,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransferSummary {
    pub volumes: Vec<VolumeResult>,
    pub total_bytes: u64,
    pub duration_seconds: u64,
}
