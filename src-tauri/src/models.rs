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
