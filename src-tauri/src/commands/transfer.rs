use crate::models::{
    TransferEvent, TransferRecord, TransferSummary, TransferVolume, VolumeResult,
};
use crate::ssh::SessionRegistry;
use crate::util::shell_escape;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

#[derive(Clone, Default)]
pub struct CancellationToken(pub Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Default)]
pub struct ActiveContainers(pub Arc<Mutex<Vec<String>>>);

impl ActiveContainers {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Vec::new())))
    }

    pub fn add(&self, name: &str) {
        let mut list = self.0.lock().unwrap();
        if !list.contains(&name.to_string()) {
            list.push(name.to_string());
        }
    }

    pub fn remove(&self, name: &str) {
        let mut list = self.0.lock().unwrap();
        list.retain(|x| x != name);
    }

    pub fn drain_all(&self) -> Vec<String> {
        let mut list = self.0.lock().unwrap();
        list.drain(..).collect()
    }

    pub fn list(&self) -> Vec<String> {
        let list = self.0.lock().unwrap();
        list.clone()
    }
}

pub fn build_source_command(container_name: &str, volume_name: &str) -> String {
    format!(
        "docker run --rm --name {} -v {}:/data alpine tar cf - -C /data .",
        container_name,
        shell_escape(volume_name)
    )
}

pub fn build_dest_command(container_name: &str, volume_name: &str, action: &str) -> String {
    if action == "overwrite" {
        format!(
            "docker run --rm --name {} -i -v {}:/data alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* && tar xf - -C /data'",
            container_name,
            shell_escape(volume_name)
        )
    } else {
        format!(
            "docker run --rm --name {} -i -v {}:/data alpine tar xf - -C /data",
            container_name,
            shell_escape(volume_name)
        )
    }
}

pub fn compute_overall_status(results: &[VolumeResult]) -> &'static str {
    if results.iter().any(|r| r.status == "cancelled") {
        "cancelled"
    } else if results.iter().any(|r| r.status == "failed") {
        "failed"
    } else {
        "success"
    }
}

async fn cleanup_containers(
    src_session: &crate::ssh::SshSession,
    dst_session: &crate::ssh::SshSession,
    src_name: &str,
    dst_name: &str,
) {
    let cmd = format!("docker rm -f {} {}", src_name, dst_name);
    let _ = crate::ssh::exec(src_session, &cmd).await;
    let _ = crate::ssh::exec(dst_session, &cmd).await;
}

#[allow(clippy::too_many_arguments)]
async fn run_transfer(
    app_handle: tauri::AppHandle,
    pool: SqlitePool,
    src_session: Arc<crate::ssh::SshSession>,
    dst_session: Arc<crate::ssh::SshSession>,
    cancel_token: CancellationToken,
    active_containers: ActiveContainers,
    source_server_name: String,
    dest_server_name: String,
    volumes: Vec<TransferVolume>,
) {
    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut results: Vec<VolumeResult> = Vec::with_capacity(volumes.len());
    let mut total_transferred: u64 = 0;
    let start_time = Instant::now();
    let mut was_cancelled = false;

    for (index, vol) in volumes.iter().enumerate() {
        if was_cancelled || cancel_token.is_cancelled() {
            was_cancelled = true;
            let _ = app_handle.emit(
                "transfer-progress",
                TransferEvent {
                    volume_name: vol.name.clone(),
                    status: "cancelled".to_string(),
                    bytes_transferred: 0,
                    total_bytes: vol.size_bytes,
                    speed_bps: 0,
                },
            );
            results.push(VolumeResult {
                name: vol.name.clone(),
                size_bytes: 0,
                duration_seconds: 0,
                status: "cancelled".to_string(),
                error: None,
            });
            continue;
        }

        if vol.action == "skip" {
            let _ = app_handle.emit(
                "transfer-progress",
                TransferEvent {
                    volume_name: vol.name.clone(),
                    status: "skipped".to_string(),
                    bytes_transferred: 0,
                    total_bytes: vol.size_bytes,
                    speed_bps: 0,
                },
            );
            results.push(VolumeResult {
                name: vol.name.clone(),
                size_bytes: 0,
                duration_seconds: 0,
                status: "skipped".to_string(),
                error: None,
            });
            continue;
        }

        let src_name = format!("dvt_src_{}_{}", batch_id, index);
        let dst_name = format!("dvt_dst_{}_{}", batch_id, index);

        active_containers.add(&src_name);
        active_containers.add(&dst_name);

        let src_cmd = build_source_command(&src_name, &vol.name);
        let dst_cmd = build_dest_command(&dst_name, &vol.name, &vol.action);

        let _ = app_handle.emit(
            "transfer-progress",
            TransferEvent {
                volume_name: vol.name.clone(),
                status: "in_progress".to_string(),
                bytes_transferred: 0,
                total_bytes: vol.size_bytes,
                speed_bps: 0,
            },
        );

        let vol_start = Instant::now();
        let mut bytes_transferred: u64 = 0;

        // Open SSH channels
        let mut src_channel = match src_session.handle.channel_open_session().await {
            Ok(ch) => ch,
            Err(e) => {
                let err_msg = format!("Failed to open source SSH channel: {}", e);
                cleanup_containers(&src_session, &dst_session, &src_name, &dst_name).await;
                active_containers.remove(&src_name);
                active_containers.remove(&dst_name);
                let _ = app_handle.emit(
                    "transfer-progress",
                    TransferEvent {
                        volume_name: vol.name.clone(),
                        status: "failed".to_string(),
                        bytes_transferred: 0,
                        total_bytes: vol.size_bytes,
                        speed_bps: 0,
                    },
                );
                results.push(VolumeResult {
                    name: vol.name.clone(),
                    size_bytes: 0,
                    duration_seconds: vol_start.elapsed().as_secs(),
                    status: "failed".to_string(),
                    error: Some(err_msg),
                });
                continue;
            }
        };

        let mut dest_channel = match dst_session.handle.channel_open_session().await {
            Ok(ch) => ch,
            Err(e) => {
                let err_msg = format!("Failed to open destination SSH channel: {}", e);
                cleanup_containers(&src_session, &dst_session, &src_name, &dst_name).await;
                active_containers.remove(&src_name);
                active_containers.remove(&dst_name);
                let _ = app_handle.emit(
                    "transfer-progress",
                    TransferEvent {
                        volume_name: vol.name.clone(),
                        status: "failed".to_string(),
                        bytes_transferred: 0,
                        total_bytes: vol.size_bytes,
                        speed_bps: 0,
                    },
                );
                results.push(VolumeResult {
                    name: vol.name.clone(),
                    size_bytes: 0,
                    duration_seconds: vol_start.elapsed().as_secs(),
                    status: "failed".to_string(),
                    error: Some(err_msg),
                });
                continue;
            }
        };

        if let Err(e) = src_channel.exec(true, src_cmd.as_str()).await {
            let err_msg = format!("Failed to exec source command: {}", e);
            cleanup_containers(&src_session, &dst_session, &src_name, &dst_name).await;
            active_containers.remove(&src_name);
            active_containers.remove(&dst_name);
            let _ = app_handle.emit(
                "transfer-progress",
                TransferEvent {
                    volume_name: vol.name.clone(),
                    status: "failed".to_string(),
                    bytes_transferred: 0,
                    total_bytes: vol.size_bytes,
                    speed_bps: 0,
                },
            );
            results.push(VolumeResult {
                name: vol.name.clone(),
                size_bytes: 0,
                duration_seconds: vol_start.elapsed().as_secs(),
                status: "failed".to_string(),
                error: Some(err_msg),
            });
            continue;
        }

        if let Err(e) = dest_channel.exec(true, dst_cmd.as_str()).await {
            let err_msg = format!("Failed to exec destination command: {}", e);
            cleanup_containers(&src_session, &dst_session, &src_name, &dst_name).await;
            active_containers.remove(&src_name);
            active_containers.remove(&dst_name);
            let _ = app_handle.emit(
                "transfer-progress",
                TransferEvent {
                    volume_name: vol.name.clone(),
                    status: "failed".to_string(),
                    bytes_transferred: 0,
                    total_bytes: vol.size_bytes,
                    speed_bps: 0,
                },
            );
            results.push(VolumeResult {
                name: vol.name.clone(),
                size_bytes: 0,
                duration_seconds: vol_start.elapsed().as_secs(),
                status: "failed".to_string(),
                error: Some(err_msg),
            });
            continue;
        }

        // Stage 1: Stream data from src_channel into dest_channel
        let mut last_progress_time = Instant::now();
        let mut last_progress_bytes: u64 = 0;
        let mut src_stderr = String::new();
        let mut src_exit_status: Option<u32> = None;
        let mut dest_stderr = String::new();
        let mut dest_exit_status: Option<u32> = None;
        let mut stream_err: Option<String> = None;

        loop {
            if cancel_token.is_cancelled() {
                was_cancelled = true;
                break;
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    if cancel_token.is_cancelled() {
                        was_cancelled = true;
                        break;
                    }
                }
                msg = src_channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { data }) => {
                            if let Err(e) = dest_channel.data(&data[..]).await {
                                stream_err = Some(format!("Failed to write to destination channel: {}", e));
                                break;
                            }
                            bytes_transferred += data.len() as u64;

                            let now = Instant::now();
                            let elapsed = now.duration_since(last_progress_time);
                            if elapsed >= Duration::from_millis(500) {
                                let delta_bytes = bytes_transferred.saturating_sub(last_progress_bytes);
                                let millis = elapsed.as_millis().max(1);
                                let speed_bps = ((delta_bytes as u128 * 1000) / millis) as u64;
                                let _ = app_handle.emit(
                                    "transfer-progress",
                                    TransferEvent {
                                        volume_name: vol.name.clone(),
                                        status: "in_progress".to_string(),
                                        bytes_transferred,
                                        total_bytes: vol.size_bytes,
                                        speed_bps,
                                    },
                                );
                                last_progress_time = now;
                                last_progress_bytes = bytes_transferred;
                            }
                        }
                        Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                            src_stderr.push_str(&String::from_utf8_lossy(&data));
                        }
                        Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                            src_exit_status = Some(exit_status);
                        }
                        Some(russh::ChannelMsg::ExitSignal { error_message, .. }) => {
                            src_exit_status = Some(1);
                            src_stderr.push_str(&error_message);
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) => {
                            break;
                        }
                        None => {
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        if was_cancelled {
            cleanup_containers(&src_session, &dst_session, &src_name, &dst_name).await;
            active_containers.remove(&src_name);
            active_containers.remove(&dst_name);
            let _ = app_handle.emit(
                "transfer-progress",
                TransferEvent {
                    volume_name: vol.name.clone(),
                    status: "cancelled".to_string(),
                    bytes_transferred,
                    total_bytes: vol.size_bytes,
                    speed_bps: 0,
                },
            );
            results.push(VolumeResult {
                name: vol.name.clone(),
                size_bytes: bytes_transferred,
                duration_seconds: vol_start.elapsed().as_secs(),
                status: "cancelled".to_string(),
                error: None,
            });
            continue;
        }

        if let Some(err) = stream_err {
            cleanup_containers(&src_session, &dst_session, &src_name, &dst_name).await;
            active_containers.remove(&src_name);
            active_containers.remove(&dst_name);
            let _ = app_handle.emit(
                "transfer-progress",
                TransferEvent {
                    volume_name: vol.name.clone(),
                    status: "failed".to_string(),
                    bytes_transferred,
                    total_bytes: vol.size_bytes,
                    speed_bps: 0,
                },
            );
            results.push(VolumeResult {
                name: vol.name.clone(),
                size_bytes: bytes_transferred,
                duration_seconds: vol_start.elapsed().as_secs(),
                status: "failed".to_string(),
                error: Some(err),
            });
            continue;
        }

        // Stage 2: Check src exit
        while src_exit_status.is_none() {
            match tokio::time::timeout(Duration::from_secs(5), src_channel.wait()).await {
                Ok(Some(russh::ChannelMsg::ExitStatus { exit_status })) => {
                    src_exit_status = Some(exit_status);
                }
                Ok(Some(russh::ChannelMsg::ExitSignal { error_message, .. })) => {
                    src_exit_status = Some(1);
                    src_stderr.push_str(&error_message);
                }
                Ok(Some(russh::ChannelMsg::ExtendedData { data, .. })) => {
                    src_stderr.push_str(&String::from_utf8_lossy(&data));
                }
                _ => break,
            }
        }

        let src_code = src_exit_status.unwrap_or(0);
        if src_code != 0 {
            let err_msg = if src_stderr.trim().is_empty() {
                format!("Source container exited with code {}", src_code)
            } else {
                src_stderr.trim().to_string()
            };
            cleanup_containers(&src_session, &dst_session, &src_name, &dst_name).await;
            active_containers.remove(&src_name);
            active_containers.remove(&dst_name);
            let _ = app_handle.emit(
                "transfer-progress",
                TransferEvent {
                    volume_name: vol.name.clone(),
                    status: "failed".to_string(),
                    bytes_transferred,
                    total_bytes: vol.size_bytes,
                    speed_bps: 0,
                },
            );
            results.push(VolumeResult {
                name: vol.name.clone(),
                size_bytes: bytes_transferred,
                duration_seconds: vol_start.elapsed().as_secs(),
                status: "failed".to_string(),
                error: Some(err_msg),
            });
            continue;
        }

        // Stage 3: Signal dest eof
        let _ = dest_channel.eof().await;

        // Stage 4: Check dest exit
        while let Some(msg) = dest_channel.wait().await {
            match msg {
                russh::ChannelMsg::ExtendedData { data, .. } => {
                    dest_stderr.push_str(&String::from_utf8_lossy(&data));
                }
                russh::ChannelMsg::ExitStatus { exit_status } => {
                    dest_exit_status = Some(exit_status);
                }
                russh::ChannelMsg::ExitSignal { error_message, .. } => {
                    dest_exit_status = Some(1);
                    dest_stderr.push_str(&error_message);
                }
                russh::ChannelMsg::Close => {
                    break;
                }
                _ => {}
            }
        }

        active_containers.remove(&src_name);
        active_containers.remove(&dst_name);

        let dest_code = dest_exit_status.unwrap_or(0);
        if dest_code != 0 {
            let err_msg = if dest_stderr.trim().is_empty() {
                format!("Destination container exited with code {}", dest_code)
            } else {
                dest_stderr.trim().to_string()
            };
            cleanup_containers(&src_session, &dst_session, &src_name, &dst_name).await;
            let _ = app_handle.emit(
                "transfer-progress",
                TransferEvent {
                    volume_name: vol.name.clone(),
                    status: "failed".to_string(),
                    bytes_transferred,
                    total_bytes: vol.size_bytes,
                    speed_bps: 0,
                },
            );
            results.push(VolumeResult {
                name: vol.name.clone(),
                size_bytes: bytes_transferred,
                duration_seconds: vol_start.elapsed().as_secs(),
                status: "failed".to_string(),
                error: Some(err_msg),
            });
            continue;
        }

        // Complete!
        total_transferred += bytes_transferred;
        let _ = app_handle.emit(
            "transfer-progress",
            TransferEvent {
                volume_name: vol.name.clone(),
                status: "complete".to_string(),
                bytes_transferred,
                total_bytes: vol.size_bytes,
                speed_bps: 0,
            },
        );
        results.push(VolumeResult {
            name: vol.name.clone(),
            size_bytes: bytes_transferred,
            duration_seconds: vol_start.elapsed().as_secs(),
            status: "complete".to_string(),
            error: None,
        });
    }

    let total_duration = start_time.elapsed().as_secs();
    let summary = TransferSummary {
        volumes: results.clone(),
        total_bytes: total_transferred,
        duration_seconds: total_duration,
    };
    let _ = app_handle.emit("transfer-complete", &summary);

    let overall_status = compute_overall_status(&results);
    let volume_names: Vec<String> = results.iter().map(|r| r.name.clone()).collect();
    let _ = crate::db::save_transfer_record(
        &pool,
        &source_server_name,
        &dest_server_name,
        &volume_names,
        total_transferred,
        total_duration,
        overall_status,
    )
    .await;
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_transfer(
    app_handle: tauri::AppHandle,
    pool: tauri::State<'_, SqlitePool>,
    registry: tauri::State<'_, SessionRegistry>,
    cancel_token: tauri::State<'_, CancellationToken>,
    active_containers: tauri::State<'_, ActiveContainers>,
    source_server_name: String,
    dest_server_name: String,
    volumes: Vec<TransferVolume>,
) -> Result<(), String> {
    let src_session = registry
        .get("source")
        .ok_or_else(|| "No active SSH session for role: source".to_string())?;
    let dst_session = registry
        .get("destination")
        .ok_or_else(|| "No active SSH session for role: destination".to_string())?;

    cancel_token.reset();

    let pool = (*pool).clone();
    let cancel = cancel_token.inner().clone();
    let containers = active_containers.inner().clone();

    tokio::spawn(async move {
        run_transfer(
            app_handle,
            pool,
            src_session,
            dst_session,
            cancel,
            containers,
            source_server_name,
            dest_server_name,
            volumes,
        )
        .await;
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_transfer(
    cancel_token: tauri::State<'_, CancellationToken>,
    active_containers: tauri::State<'_, ActiveContainers>,
    registry: tauri::State<'_, SessionRegistry>,
) -> Result<(), String> {
    cancel_token.cancel();
    let containers = active_containers.drain_all();
    if !containers.is_empty() {
        let rm_cmd = format!("docker rm -f {}", containers.join(" "));
        if let Some(src) = registry.get("source") {
            let _ = crate::ssh::exec(&src, &rm_cmd).await;
        }
        if let Some(dst) = registry.get("destination") {
            let _ = crate::ssh::exec(&dst, &rm_cmd).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_transfer_history(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<TransferRecord>, String> {
    crate::db::list_transfer_history(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cancellation_token() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
        token.reset();
        assert!(!token.is_cancelled());
    }

    #[test]
    fn test_active_containers() {
        let containers = ActiveContainers::new();
        assert_eq!(containers.list().len(), 0);
        containers.add("c1");
        containers.add("c2");
        assert_eq!(containers.list(), vec!["c1", "c2"]);
        containers.remove("c1");
        assert_eq!(containers.list(), vec!["c2"]);
        let drained = containers.drain_all();
        assert_eq!(drained, vec!["c2"]);
        assert_eq!(containers.list().len(), 0);
    }

    #[test]
    fn test_build_source_command() {
        let cmd = build_source_command("dvt_src_123_0", "my_volume");
        assert_eq!(
            cmd,
            "docker run --rm --name dvt_src_123_0 -v 'my_volume':/data alpine tar cf - -C /data ."
        );

        let cmd_quotes = build_source_command("dvt_src_123_0", "vol'with'quotes");
        assert_eq!(
            cmd_quotes,
            "docker run --rm --name dvt_src_123_0 -v 'vol'\\''with'\\''quotes':/data alpine tar cf - -C /data ."
        );
    }

    #[test]
    fn test_build_dest_command_transfer() {
        let cmd = build_dest_command("dvt_dst_123_0", "dest_volume", "transfer");
        assert_eq!(
            cmd,
            "docker run --rm --name dvt_dst_123_0 -i -v 'dest_volume':/data alpine tar xf - -C /data"
        );
    }

    #[test]
    fn test_build_dest_command_overwrite() {
        let cmd = build_dest_command("dvt_dst_123_0", "dest_volume", "overwrite");
        assert_eq!(
            cmd,
            "docker run --rm --name dvt_dst_123_0 -i -v 'dest_volume':/data alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* && tar xf - -C /data'"
        );
    }

    #[test]
    fn test_compute_overall_status() {
        let success_results = vec![
            VolumeResult {
                name: "v1".to_string(),
                size_bytes: 100,
                duration_seconds: 5,
                status: "complete".to_string(),
                error: None,
            },
            VolumeResult {
                name: "v2".to_string(),
                size_bytes: 0,
                duration_seconds: 0,
                status: "skipped".to_string(),
                error: None,
            },
        ];
        assert_eq!(compute_overall_status(&success_results), "success");

        let failed_results = vec![
            VolumeResult {
                name: "v1".to_string(),
                size_bytes: 100,
                duration_seconds: 5,
                status: "complete".to_string(),
                error: None,
            },
            VolumeResult {
                name: "v2".to_string(),
                size_bytes: 50,
                duration_seconds: 2,
                status: "failed".to_string(),
                error: Some("error".to_string()),
            },
        ];
        assert_eq!(compute_overall_status(&failed_results), "failed");

        let cancelled_results = vec![
            VolumeResult {
                name: "v1".to_string(),
                size_bytes: 100,
                duration_seconds: 5,
                status: "complete".to_string(),
                error: None,
            },
            VolumeResult {
                name: "v2".to_string(),
                size_bytes: 0,
                duration_seconds: 1,
                status: "cancelled".to_string(),
                error: None,
            },
        ];
        assert_eq!(compute_overall_status(&cancelled_results), "cancelled");
    }

    #[test]
    fn test_transfer_status_serialization() {
        use crate::models::TransferStatus;
        assert_eq!(TransferStatus::Pending.as_str(), "pending");
        assert_eq!(TransferStatus::InProgress.as_str(), "in_progress");
        assert_eq!(TransferStatus::Complete.as_str(), "complete");
        assert_eq!(TransferStatus::Failed("err".to_string()).as_str(), "failed");
        assert_eq!(TransferStatus::Skipped.as_str(), "skipped");
        assert_eq!(TransferStatus::Cancelled.as_str(), "cancelled");
    }
}
