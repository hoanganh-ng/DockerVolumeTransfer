use crate::models::Server;
use sqlx::{Row, SqlitePool};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;

pub async fn add_server_db(
    pool: &SqlitePool,
    name: &str,
    host: &str,
    username: &str,
    port: u16,
    ssh_key_path: &str,
) -> Result<Server, Box<dyn std::error::Error + Send + Sync>> {
    let result = sqlx::query(
        "INSERT INTO servers (name, host, username, port, ssh_key_path) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(name)
    .bind(host)
    .bind(username)
    .bind(port as i64)
    .bind(ssh_key_path)
    .execute(pool)
    .await?;

    let id = result.last_insert_rowid();

    Ok(Server {
        id,
        name: name.to_string(),
        host: host.to_string(),
        username: username.to_string(),
        port,
        ssh_key_path: ssh_key_path.to_string(),
        host_key_fingerprint: None,
    })
}

pub async fn list_servers_db(
    pool: &SqlitePool,
) -> Result<Vec<Server>, Box<dyn std::error::Error + Send + Sync>> {
    let rows = sqlx::query(
        "SELECT id, name, host, username, port, ssh_key_path, host_key_fingerprint FROM servers ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await?;

    let mut servers = Vec::with_capacity(rows.len());
    for row in rows {
        let id: i64 = row.get("id");
        let name: String = row.get("name");
        let host: String = row.get("host");
        let username: String = row.get("username");
        let port_i64: i64 = row.get("port");
        let ssh_key_path: String = row.get("ssh_key_path");
        let host_key_fingerprint: Option<String> = row.get("host_key_fingerprint");

        servers.push(Server {
            id,
            name,
            host,
            username,
            port: port_i64 as u16,
            ssh_key_path,
            host_key_fingerprint,
        });
    }

    Ok(servers)
}

pub async fn update_host_key_db(
    pool: &SqlitePool,
    id: i64,
    fingerprint: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    sqlx::query("UPDATE servers SET host_key_fingerprint = ? WHERE id = ?")
        .bind(fingerprint)
        .bind(id)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn update_server_db(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    host: &str,
    username: &str,
    port: u16,
    ssh_key_path: &str,
) -> Result<Server, Box<dyn std::error::Error + Send + Sync>> {
    let row = sqlx::query("SELECT host, port, host_key_fingerprint FROM servers WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;

    let existing_host: String = row.get("host");
    let existing_port: i64 = row.get("port");
    let existing_fingerprint: Option<String> = row.get("host_key_fingerprint");

    let new_fingerprint = if existing_host == host && (existing_port as u16) == port {
        existing_fingerprint
    } else {
        None
    };

    sqlx::query(
        "UPDATE servers SET name = ?, host = ?, username = ?, port = ?, ssh_key_path = ?, host_key_fingerprint = ? WHERE id = ?",
    )
    .bind(name)
    .bind(host)
    .bind(username)
    .bind(port as i64)
    .bind(ssh_key_path)
    .bind(&new_fingerprint)
    .bind(id)
    .execute(pool)
    .await?;

    Ok(Server {
        id,
        name: name.to_string(),
        host: host.to_string(),
        username: username.to_string(),
        port,
        ssh_key_path: ssh_key_path.to_string(),
        host_key_fingerprint: new_fingerprint,
    })
}

pub async fn delete_server_db(
    pool: &SqlitePool,
    id: i64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(())
}

#[tauri::command]
pub async fn add_server(
    pool: tauri::State<'_, SqlitePool>,
    name: String,
    host: String,
    username: String,
    port: u16,
    ssh_key_path: String,
) -> Result<Server, String> {
    add_server_db(&pool, &name, &host, &username, port, &ssh_key_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_servers(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<Server>, String> {
    list_servers_db(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_server(
    pool: tauri::State<'_, SqlitePool>,
    id: i64,
    name: String,
    host: String,
    username: String,
    port: u16,
    ssh_key_path: String,
) -> Result<Server, String> {
    update_server_db(&pool, id, &name, &host, &username, port, &ssh_key_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_server(
    pool: tauri::State<'_, SqlitePool>,
    id: i64,
) -> Result<(), String> {
    delete_server_db(&pool, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ping_server(host: String, port: u16) -> bool {
    timeout(
        Duration::from_secs(2),
        TcpStream::connect((host.as_str(), port)),
    )
    .await
    .map(|res| res.is_ok())
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db_with_path;

    #[tokio::test]
    async fn test_server_crud() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_crud_{}.db", uuid::Uuid::new_v4()));
        let pool = init_db_with_path(&db_path).await.unwrap();

        let server = add_server_db(&pool, "prod", "1.2.3.4", "deploy", 22, "/home/.ssh/id_ed25519").await.unwrap();
        assert_eq!(server.name, "prod");
        assert!(server.host_key_fingerprint.is_none());

        let servers = list_servers_db(&pool).await.unwrap();
        assert_eq!(servers.len(), 1);

        // Simulate host key stored
        update_host_key_db(&pool, server.id, "SHA256:abc123").await.unwrap();

        // Update with same host/port — fingerprint preserved
        let updated = update_server_db(&pool, server.id, "prod-new", "1.2.3.4", "admin", 22, "/home/.ssh/id_ed25519").await.unwrap();
        assert_eq!(updated.name, "prod-new");
        assert_eq!(updated.host_key_fingerprint, Some("SHA256:abc123".to_string()));

        // Update with different host — fingerprint cleared
        let updated2 = update_server_db(&pool, server.id, "prod-new", "5.6.7.8", "admin", 22, "/home/.ssh/id_ed25519").await.unwrap();
        assert!(updated2.host_key_fingerprint.is_none());

        delete_server_db(&pool, server.id).await.unwrap();
        let servers = list_servers_db(&pool).await.unwrap();
        assert_eq!(servers.len(), 0);

        let _ = std::fs::remove_file(&db_path);
    }

    #[tokio::test]
    async fn test_ping_server() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let online = ping_server("127.0.0.1".to_string(), addr.port()).await;
        assert!(online);

        drop(listener);
        let offline = ping_server("127.0.0.1".to_string(), addr.port()).await;
        assert!(!offline);
    }
}
