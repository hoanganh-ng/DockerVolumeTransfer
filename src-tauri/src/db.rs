use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use crate::models::TransferRecord;

pub async fn init_db_with_path(path: &Path) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .connect_with(opts)
        .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            username TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22,
            ssh_key_path TEXT NOT NULL,
            host_key_fingerprint TEXT
        );",
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS transfer_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_server_name TEXT NOT NULL,
            dest_server_name TEXT NOT NULL,
            volume_names TEXT NOT NULL,
            total_size_bytes INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            duration_seconds INTEGER,
            status TEXT NOT NULL
        );",
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

pub async fn init_db(_app_handle: &tauri::AppHandle) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let config_dir = dirs::config_dir()
        .ok_or("Could not determine config directory")?
        .join("docker-volume-transfer");
    let db_path = config_dir.join("data.db");
    init_db_with_path(&db_path).await
}

pub async fn save_transfer_record(
    pool: &SqlitePool,
    source_server_name: &str,
    dest_server_name: &str,
    volume_names: &[impl AsRef<str>],
    total_size_bytes: u64,
    duration_seconds: u64,
    status: &str,
) -> Result<TransferRecord, Box<dyn std::error::Error + Send + Sync>> {
    let volume_names_vec: Vec<String> = volume_names.iter().map(|v| v.as_ref().to_string()).collect();
    let volume_names_json = serde_json::to_string(&volume_names_vec)?;

    let row = sqlx::query(
        "INSERT INTO transfer_history (
            source_server_name, dest_server_name, volume_names, total_size_bytes,
            started_at, completed_at, duration_seconds, status
        ) VALUES (
            ?, ?, ?, ?,
            datetime('now', '-' || ? || ' seconds'),
            datetime('now'),
            ?, ?
        )
        RETURNING id, started_at, completed_at",
    )
    .bind(source_server_name)
    .bind(dest_server_name)
    .bind(&volume_names_json)
    .bind(total_size_bytes as i64)
    .bind(duration_seconds as i64)
    .bind(duration_seconds as i64)
    .bind(status)
    .fetch_one(pool)
    .await?;

    let id: i64 = row.get("id");
    let started_at: String = row.get("started_at");
    let completed_at: Option<String> = row.get("completed_at");

    Ok(TransferRecord {
        id,
        source_server_name: source_server_name.to_string(),
        dest_server_name: dest_server_name.to_string(),
        volume_names: volume_names_vec,
        total_size_bytes,
        started_at,
        completed_at,
        duration_seconds: Some(duration_seconds),
        status: status.to_string(),
    })
}

pub async fn list_transfer_history(
    pool: &SqlitePool,
) -> Result<Vec<TransferRecord>, Box<dyn std::error::Error + Send + Sync>> {
    let rows = sqlx::query(
        "SELECT id, source_server_name, dest_server_name, volume_names, total_size_bytes, started_at, completed_at, duration_seconds, status
         FROM transfer_history
         ORDER BY started_at DESC, id DESC",
    )
    .fetch_all(pool)
    .await?;

    let mut records = Vec::with_capacity(rows.len());
    for row in rows {
        let id: i64 = row.get("id");
        let source_server_name: String = row.get("source_server_name");
        let dest_server_name: String = row.get("dest_server_name");
        let volume_names_json: String = row.get("volume_names");
        let volume_names: Vec<String> = serde_json::from_str(&volume_names_json).unwrap_or_default();
        let total_size_bytes_i64: i64 = row.get("total_size_bytes");
        let started_at: String = row.get("started_at");
        let completed_at: Option<String> = row.get("completed_at");
        let duration_seconds_i64: Option<i64> = row.get("duration_seconds");
        let status: String = row.get("status");

        records.push(TransferRecord {
            id,
            source_server_name,
            dest_server_name,
            volume_names,
            total_size_bytes: total_size_bytes_i64 as u64,
            started_at,
            completed_at,
            duration_seconds: duration_seconds_i64.map(|d| d as u64),
            status,
        });
    }

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_init_db_creates_tables() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_dvt_{}.db", uuid::Uuid::new_v4()));
        let pool = init_db_with_path(&db_path).await.unwrap();
        let servers = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' AND name='servers'")
            .fetch_one(&pool).await;
        let history = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' AND name='transfer_history'")
            .fetch_one(&pool).await;
        assert!(servers.is_ok());
        assert!(history.is_ok());
        let _ = std::fs::remove_file(&db_path);
    }

    #[tokio::test]
    async fn test_save_and_list_transfer_history() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_hist_{}.db", uuid::Uuid::new_v4()));
        let pool = init_db_with_path(&db_path).await.unwrap();
        let record = save_transfer_record(&pool, "prod-web", "prod-db", &["vol_a", "vol_b"], 1024, 30, "success").await.unwrap();
        assert_eq!(record.status, "success");
        assert_eq!(record.source_server_name, "prod-web");
        let history = list_transfer_history(&pool).await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].volume_names, vec!["vol_a".to_string(), "vol_b".to_string()]);
        let _ = std::fs::remove_file(&db_path);
    }
}
