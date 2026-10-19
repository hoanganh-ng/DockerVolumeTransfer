use crate::models::{Server, Volume};
use crate::ssh::SessionRegistry;
use serde::Deserialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

#[derive(Deserialize)]
struct DockerVolumeJson {
    #[serde(alias = "name", alias = "Name")]
    name: String,
    #[serde(alias = "driver", alias = "Driver", default = "default_driver")]
    driver: String,
}

fn default_driver() -> String {
    "local".to_string()
}

pub fn parse_volume_ls_output(ls_output: &str, in_use_output: &str) -> Vec<Volume> {
    let mounted_volumes: HashSet<&str> = in_use_output
        .lines()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut volumes = Vec::new();
    for line in ls_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(item) = serde_json::from_str::<DockerVolumeJson>(trimmed) {
            let in_use = mounted_volumes.contains(item.name.as_str());
            volumes.push(Volume {
                name: item.name,
                driver: item.driver,
                in_use,
            });
        }
    }
    volumes
}

pub fn parse_du_output(du_output: &str) -> Result<u64, String> {
    du_output
        .split_whitespace()
        .next()
        .ok_or_else(|| "Empty output from du command".to_string())
        .and_then(|first| {
            first
                .parse::<u64>()
                .map_err(|e| format!("Failed to parse size from du: {}", e))
        })
}

pub fn resolve_passphrase(
    passphrase: Option<String>,
    key_path: &str,
    registry: &SessionRegistry,
) -> Option<String> {
    passphrase.or_else(|| registry.get_cached_passphrase(key_path))
}

pub async fn verify_or_update_host_key(
    pool: &SqlitePool,
    server_id: i64,
    stored_fingerprint: Option<&str>,
    session_fingerprint: &str,
) -> Result<(), String> {
    if let Some(stored) = stored_fingerprint {
        if stored != session_fingerprint {
            return Err("Server host key has changed \u{2014} possible security risk.".to_string());
        }
    } else {
        crate::commands::server::update_host_key_db(pool, server_id, session_fingerprint)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn connect_server(
    pool: tauri::State<'_, SqlitePool>,
    registry: tauri::State<'_, SessionRegistry>,
    server_id: i64,
    passphrase: Option<String>,
    role: String,
) -> Result<(), String> {
    let server = sqlx::query_as::<_, Server>(
        "SELECT id, name, host, username, port, ssh_key_path, host_key_fingerprint FROM servers WHERE id = ?",
    )
    .bind(server_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Server with ID {} not found", server_id))?;

    let resolved_passphrase = resolve_passphrase(passphrase, &server.ssh_key_path, &registry);

    let session = crate::ssh::connect(
        &server.host,
        server.port,
        &server.username,
        &server.ssh_key_path,
        resolved_passphrase.clone(),
    )
    .await?;

    verify_or_update_host_key(
        &pool,
        server.id,
        server.host_key_fingerprint.as_deref(),
        &session.host_key_fingerprint,
    )
    .await?;

    let (docker_info_code, _, _) = crate::ssh::exec(&session, "docker info").await?;
    if docker_info_code != 0 {
        return Err("Docker is not installed or not accessible on this server.".to_string());
    }

    let _ = crate::ssh::exec(
        &session,
        "docker image inspect alpine:latest >/dev/null 2>&1 || docker pull -q alpine:latest",
    )
    .await;

    registry.store(&role, Arc::new(session));
    registry.store_credentials(&role, &server.ssh_key_path, resolved_passphrase);

    Ok(())
}

#[tauri::command]
pub fn disconnect_server(
    registry: tauri::State<'_, SessionRegistry>,
    role: String,
) {
    registry.remove(&role);
}

#[tauri::command]
pub async fn test_connection(
    host: String,
    port: u16,
    username: String,
    ssh_key_path: String,
    passphrase: Option<String>,
) -> Result<(), String> {
    let session = crate::ssh::connect(&host, port, &username, &ssh_key_path, passphrase).await?;
    let (exit_code, _, _) = crate::ssh::exec(&session, "docker info").await?;
    if exit_code != 0 {
        return Err("Docker is not installed or not accessible on this server.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_volumes(
    registry: tauri::State<'_, SessionRegistry>,
    role: String,
) -> Result<Vec<Volume>, String> {
    let session = registry
        .get(&role)
        .ok_or_else(|| format!("No active SSH session for role: {}", role))?;

    let (ls_code, ls_stdout, ls_stderr) =
        crate::ssh::exec(&session, "docker volume ls --format '{{json .}}'").await?;
    if ls_code != 0 {
        return Err(format!("Failed to list docker volumes: {}", ls_stderr));
    }

    let (_, in_use_stdout, _) = crate::ssh::exec(
        &session,
        r#"docker ps -q | xargs -r docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}'"#,
    )
    .await?;

    Ok(parse_volume_ls_output(&ls_stdout, &in_use_stdout))
}

#[tauri::command]
pub async fn get_volume_size(
    registry: tauri::State<'_, SessionRegistry>,
    role: String,
    volume_name: String,
) -> Result<u64, String> {
    let session = registry
        .get(&role)
        .ok_or_else(|| format!("No active SSH session for role: {}", role))?;

    let cmd = format!(
        "docker run --rm -v {}:/data alpine du -sb /data",
        crate::util::shell_escape(&volume_name)
    );
    let (code, stdout, stderr) = crate::ssh::exec(&session, &cmd).await?;
    if code != 0 {
        return Err(format!("Failed to get volume size: {}", stderr));
    }

    parse_du_output(&stdout)
}

#[tauri::command]
pub async fn check_volumes_on_dest(
    registry: tauri::State<'_, SessionRegistry>,
    volume_names: Vec<String>,
) -> Result<HashMap<String, u64>, String> {
    let session = registry
        .get("destination")
        .ok_or_else(|| "No active SSH session for role: destination".to_string())?;

    let mut results = HashMap::new();
    for name in volume_names {
        let inspect_cmd = format!("docker volume inspect {}", crate::util::shell_escape(&name));
        let (inspect_code, _, _) = crate::ssh::exec(&session, &inspect_cmd).await?;
        if inspect_code == 0 {
            let du_cmd = format!(
                "docker run --rm -v {}:/data alpine du -sb /data",
                crate::util::shell_escape(&name)
            );
            let (du_code, du_stdout, _) = crate::ssh::exec(&session, &du_cmd).await?;
            let size = if du_code == 0 {
                parse_du_output(&du_stdout).unwrap_or(0)
            } else {
                0
            };
            results.insert(name, size);
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_volume_ls_and_in_use() {
        let ls_output = r#"{"Driver":"local","Name":"app_data"}
{"Driver":"local","Name":"db_data"}
{"Driver":"local","Name":"cache_vol"}"#;
        let in_use_output = "app_data\ndb_data\n";

        let volumes = parse_volume_ls_output(ls_output, in_use_output);
        assert_eq!(volumes.len(), 3);
        assert_eq!(volumes[0].name, "app_data");
        assert_eq!(volumes[0].driver, "local");
        assert!(volumes[0].in_use);

        assert_eq!(volumes[1].name, "db_data");
        assert_eq!(volumes[1].driver, "local");
        assert!(volumes[1].in_use);

        assert_eq!(volumes[2].name, "cache_vol");
        assert_eq!(volumes[2].driver, "local");
        assert!(!volumes[2].in_use);
    }

    #[test]
    fn test_parse_du_output_zero() {
        let output = "0\t/data\n";
        let size = parse_du_output(output).unwrap();
        assert_eq!(size, 0);
    }

    #[test]
    fn test_parse_du_output() {
        assert_eq!(parse_du_output("104857600\t/data\n").unwrap(), 104857600);
        assert_eq!(parse_du_output("0\t/data\n").unwrap(), 0);
        assert!(parse_du_output("").is_err());
        assert!(parse_du_output("not_a_number /data").is_err());
    }

    #[test]
    fn test_resolve_passphrase() {
        let registry = SessionRegistry::new();
        registry.store_credentials("source", "/id_rsa", Some("cached_pass".to_string()));

        let p1 = resolve_passphrase(Some("explicit".to_string()), "/id_rsa", &registry);
        assert_eq!(p1, Some("explicit".to_string()));

        let p2 = resolve_passphrase(None, "/id_rsa", &registry);
        assert_eq!(p2, Some("cached_pass".to_string()));

        let p3 = resolve_passphrase(None, "/id_ed25519", &registry);
        assert_eq!(p3, None);
    }

    #[tokio::test]
    async fn test_verify_host_key_check() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_tofu_{}.db", uuid::Uuid::new_v4()));
        let pool = crate::db::init_db_with_path(&db_path).await.unwrap();

        let server = crate::commands::server::add_server_db(
            &pool, "srv", "1.2.3.4", "root", 22, "/key",
        )
        .await
        .unwrap();

        // First connect: stored is None -> updates DB, succeeds
        let res1 = verify_or_update_host_key(
            &pool,
            server.id,
            server.host_key_fingerprint.as_deref(),
            "SHA256:fp1",
        )
        .await;
        assert!(res1.is_ok());

        // Same fingerprint: succeeds
        let res2 =
            verify_or_update_host_key(&pool, server.id, Some("SHA256:fp1"), "SHA256:fp1").await;
        assert!(res2.is_ok());

        // Changed fingerprint: fails with security warning
        let res3 =
            verify_or_update_host_key(&pool, server.id, Some("SHA256:fp1"), "SHA256:fp2").await;
        assert!(res3.is_err());
        assert_eq!(
            res3.unwrap_err(),
            "Server host key has changed \u{2014} possible security risk."
        );

        let _ = tokio::fs::remove_file(&db_path).await;
    }
}
