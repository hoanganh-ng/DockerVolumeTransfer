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
pub struct TransferInProgress(pub Arc<AtomicBool>);

impl TransferInProgress {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

/// Holds the in-progress flag for one transfer; clears it on drop, including
/// when the transfer task panics or `start_transfer` returns early.
pub struct InProgressGuard(TransferInProgress);

impl InProgressGuard {
    /// Returns None if a transfer is already running.
    pub fn acquire(flag: &TransferInProgress) -> Option<Self> {
        if flag.0.swap(true, Ordering::SeqCst) {
            None
        } else {
            Some(Self(flag.clone()))
        }
    }
}

impl Drop for InProgressGuard {
    fn drop(&mut self) {
        self.0 .0.store(false, Ordering::SeqCst);
    }
}

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

/// Fold one channel message into exit-status/stderr state while waiting for a
/// remote command to finish. Returns true when waiting should stop.
/// Control messages (Success, WindowAdjusted, Eof, Data) are ignored: they are
/// queued on the channel during streaming and arrive before ExitStatus.
pub fn absorb_exit_msg(
    msg: &russh::ChannelMsg,
    exit_status: &mut Option<u32>,
    stderr: &mut String,
) -> bool {
    match msg {
        russh::ChannelMsg::ExitStatus { exit_status: code } => {
            *exit_status = Some(*code);
            false
        }
        russh::ChannelMsg::ExitSignal { error_message, .. } => {
            *exit_status = Some(1);
            stderr.push_str(error_message);
            false
        }
        russh::ChannelMsg::ExtendedData { data, .. } => {
            stderr.push_str(&String::from_utf8_lossy(data));
            false
        }
        russh::ChannelMsg::Close => true,
        _ => false,
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

/// Pull alpine image if not present. Returns Ok(()) or error string.
async fn ensure_alpine_image(
    session: &crate::ssh::SshSession,
    label: &str,
) -> Result<(), String> {
    // Check if alpine image exists
    let (code, _stdout, stderr) =
        crate::ssh::exec(session, "docker image inspect alpine:latest >/dev/null 2>&1 || docker pull alpine:latest")
            .await
            .map_err(|e| format!("{} host: failed to check/pull alpine image: {}", label, e))?;
    if code != 0 {
        return Err(format!(
            "{} host: alpine image not available and pull failed: {}",
            label,
            stderr.trim()
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_transfer(
    app_handle: tauri::AppHandle,
    pool: SqlitePool,
    src_session: Arc<crate::ssh::SshSession>,
    dst_session: Arc<crate::ssh::SshSession>,
    cancel_token: CancellationToken,
    active_containers: ActiveContainers,
    _guard: InProgressGuard,
    source_server_name: String,
    dest_server_name: String,
    volumes: Vec<TransferVolume>,
) {
    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut results: Vec<VolumeResult> = Vec::with_capacity(volumes.len());
    let mut total_transferred: u64 = 0;
    let start_time = Instant::now();
    let mut was_cancelled = false;

    // Pre-flight: ensure alpine image is available on both hosts
    eprintln!("[DVT] Pre-flight: ensuring alpine image on source host...");
    if let Err(e) = ensure_alpine_image(&src_session, "Source").await {
        eprintln!("[DVT] Pre-flight failed: {}", e);
        let _ = app_handle.emit(
            "transfer-complete",
            TransferSummary {
                total_bytes: 0,
                duration_seconds: 0,
                volumes: vec![],
            },
        );
        return;
    }
    eprintln!("[DVT] Pre-flight: ensuring alpine image on dest host...");
    if let Err(e) = ensure_alpine_image(&dst_session, "Destination").await {
        eprintln!("[DVT] Pre-flight failed: {}", e);
        let _ = app_handle.emit(
            "transfer-complete",
            TransferSummary {
                total_bytes: 0,
                duration_seconds: 0,
                volumes: vec![],
            },
        );
        return;
    }
    eprintln!("[DVT] Pre-flight: alpine image OK on both hosts");

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
        eprintln!("[DVT] Volume '{}': src_cmd = {}", vol.name, src_cmd);
        eprintln!("[DVT] Volume '{}': dst_cmd = {}", vol.name, dst_cmd);

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

        eprintln!("[DVT] Executing source command on source host...");
        if let Err(e) = src_channel.exec(true, src_cmd.as_str()).await {
            let err_msg = format!("Failed to exec source command: {} | cmd: {}", e, src_cmd);
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

        eprintln!("[DVT] Executing dest command on dest host...");
        if let Err(e) = dest_channel.exec(true, dst_cmd.as_str()).await {
            let err_msg = format!("Failed to exec destination command: {} | cmd: {}", e, dst_cmd);
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

            match src_channel.wait().await {
                Some(russh::ChannelMsg::Data { data }) => {
                    if bytes_transferred == 0 {
                        eprintln!("[DVT] First data chunk received: {} bytes", data.len());
                    }
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
                    let text = String::from_utf8_lossy(&data);
                    eprintln!("[DVT] Source stderr: {}", text.trim());
                    src_stderr.push_str(&text);
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                    src_exit_status = Some(exit_status);
                }
                Some(russh::ChannelMsg::ExitSignal { error_message, .. }) => {
                    src_exit_status = Some(1);
                    src_stderr.push_str(&error_message);
                }
                Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) => {
                    eprintln!("[DVT] Source channel EOF/Close after {} bytes", bytes_transferred);
                    break;
                }
                None => {
                    eprintln!("[DVT] Source channel returned None (disconnected)");
                    break;
                }
                _ => {}
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
                Ok(Some(msg)) => {
                    if absorb_exit_msg(&msg, &mut src_exit_status, &mut src_stderr) {
                        break;
                    }
                }
                _ => break,
            }
        }

        let src_code = src_exit_status.unwrap_or(1);
        eprintln!("[DVT] Source exit code: {}, stderr: '{}', bytes: {}", src_code, src_stderr.trim(), bytes_transferred);
        if src_code != 0 {
            let err_msg = if src_stderr.trim().is_empty() {
                format!("Source container exited with code {} | cmd: {}", src_code, src_cmd)
            } else {
                format!("{} (exit code {})", src_stderr.trim(), src_code)
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
        while dest_exit_status.is_none() {
            match tokio::time::timeout(Duration::from_secs(30), dest_channel.wait()).await {
                Ok(Some(msg)) => {
                    if absorb_exit_msg(&msg, &mut dest_exit_status, &mut dest_stderr) {
                        break;
                    }
                }
                _ => break,
            }
        }

        active_containers.remove(&src_name);
        active_containers.remove(&dst_name);

        let dest_code = dest_exit_status.unwrap_or(1);
        eprintln!("[DVT] Dest exit code: {}, stderr: '{}'", dest_code, dest_stderr.trim());
        if dest_code != 0 {
            let err_msg = if dest_stderr.trim().is_empty() {
                format!("Destination container exited with code {} | cmd: {}", dest_code, dst_cmd)
            } else {
                format!("{} (exit code {})", dest_stderr.trim(), dest_code)
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
    transfer_in_progress: tauri::State<'_, TransferInProgress>,
    source_server_name: String,
    dest_server_name: String,
    volumes: Vec<TransferVolume>,
) -> Result<(), String> {
    let guard = InProgressGuard::acquire(transfer_in_progress.inner())
        .ok_or_else(|| "A transfer is already in progress".to_string())?;

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
            guard,
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

    fn drain(msgs: Vec<russh::ChannelMsg>) -> (Option<u32>, String) {
        let mut status = None;
        let mut stderr = String::new();
        for msg in &msgs {
            if absorb_exit_msg(msg, &mut status, &mut stderr) || status.is_some() {
                break;
            }
        }
        (status, stderr)
    }

    #[test]
    fn test_absorb_exit_msg_skips_success_and_window_adjust() {
        let (status, _) = drain(vec![
            russh::ChannelMsg::Success,
            russh::ChannelMsg::WindowAdjusted { new_size: 1024 },
            russh::ChannelMsg::Eof,
            russh::ChannelMsg::ExitStatus { exit_status: 0 },
            russh::ChannelMsg::Close,
        ]);
        assert_eq!(status, Some(0));
    }

    #[test]
    fn test_absorb_exit_msg_collects_stderr() {
        let (status, stderr) = drain(vec![
            russh::ChannelMsg::ExtendedData {
                data: russh::CryptoVec::from_slice(b"tar: bad header"),
                ext: 1,
            },
            russh::ChannelMsg::ExitStatus { exit_status: 2 },
        ]);
        assert_eq!(status, Some(2));
        assert_eq!(stderr, "tar: bad header");
    }

    #[test]
    fn test_absorb_exit_msg_stops_on_close_without_status() {
        let (status, _) = drain(vec![
            russh::ChannelMsg::Success,
            russh::ChannelMsg::Close,
            russh::ChannelMsg::ExitStatus { exit_status: 0 },
        ]);
        assert_eq!(status, None);
    }

    #[test]
    fn test_absorb_exit_msg_exit_signal_is_failure() {
        let (status, stderr) = drain(vec![russh::ChannelMsg::ExitSignal {
            signal_name: russh::Sig::KILL,
            core_dumped: false,
            error_message: "killed".to_string(),
            lang_tag: String::new(),
        }]);
        assert_eq!(status, Some(1));
        assert_eq!(stderr, "killed");
    }

    #[test]
    fn test_in_progress_guard_exclusive_until_dropped() {
        let flag = TransferInProgress::new();
        let guard = InProgressGuard::acquire(&flag).expect("first acquire");
        assert!(InProgressGuard::acquire(&flag).is_none());
        drop(guard);
        assert!(InProgressGuard::acquire(&flag).is_some());
    }

    #[test]
    fn test_in_progress_guard_released_on_panic() {
        let flag = TransferInProgress::new();
        let inner = flag.clone();
        let _ = std::panic::catch_unwind(move || {
            let _guard = InProgressGuard::acquire(&inner).unwrap();
            panic!("transfer task panicked");
        });
        assert!(!flag.0.load(Ordering::SeqCst));
    }
}
