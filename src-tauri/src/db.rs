use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::Path;

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
}
