use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use async_trait::async_trait;

pub trait IntoPassphrase {
    fn into_passphrase(self) -> Option<String>;
}

impl IntoPassphrase for &str {
    fn into_passphrase(self) -> Option<String> {
        if self.is_empty() {
            None
        } else {
            Some(self.to_string())
        }
    }
}

impl IntoPassphrase for String {
    fn into_passphrase(self) -> Option<String> {
        if self.is_empty() {
            None
        } else {
            Some(self)
        }
    }
}

impl IntoPassphrase for Option<&str> {
    fn into_passphrase(self) -> Option<String> {
        self.map(|s| s.to_string())
    }
}

impl IntoPassphrase for Option<String> {
    fn into_passphrase(self) -> Option<String> {
        self
    }
}

impl IntoPassphrase for Option<&String> {
    fn into_passphrase(self) -> Option<String> {
        self.cloned()
    }
}

pub struct ClientHandler {
    pub server_fingerprint: Arc<Mutex<Option<String>>>,
}

#[async_trait]
impl russh::client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fp = format!("SHA256:{}", server_public_key.fingerprint());
        if let Ok(mut lock) = self.server_fingerprint.lock() {
            *lock = Some(fp);
        }
        Ok(true)
    }
}

pub struct SshSession {
    pub handle: russh::client::Handle<ClientHandler>,
    pub host_key_fingerprint: String,
}

impl std::fmt::Debug for SshSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SshSession")
            .field("host_key_fingerprint", &self.host_key_fingerprint)
            .finish()
    }
}

impl SshSession {
    pub async fn exec(&self, command: &str) -> Result<(u32, String, String), String> {
        exec(self, command).await
    }
}

type SessionMap = Arc<Mutex<HashMap<String, Arc<SshSession>>>>;
type CredentialsMap = Arc<Mutex<HashMap<String, (String, Option<String>)>>>;

#[derive(Clone, Default)]
pub struct SessionRegistry {
    sessions: SessionMap,
    credentials: CredentialsMap,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn store(&self, role: &str, session: Arc<SshSession>) {
        let mut map = self.sessions.lock().unwrap();
        map.insert(role.to_string(), session);
    }

    pub fn get(&self, role: &str) -> Option<Arc<SshSession>> {
        let map = self.sessions.lock().unwrap();
        map.get(role).cloned()
    }

    pub fn remove(&self, role: &str) {
        let mut map = self.sessions.lock().unwrap();
        map.remove(role);
        let mut creds = self.credentials.lock().unwrap();
        creds.remove(role);
    }

    pub fn clear(&self) {
        let mut map = self.sessions.lock().unwrap();
        map.clear();
        let mut creds = self.credentials.lock().unwrap();
        creds.clear();
    }

    pub fn store_credentials(&self, role: &str, key_path: &str, passphrase: Option<String>) {
        let mut creds = self.credentials.lock().unwrap();
        creds.insert(role.to_string(), (key_path.to_string(), passphrase));
    }

    pub fn get_cached_passphrase(&self, key_path: &str) -> Option<String> {
        let creds = self.credentials.lock().unwrap();
        for (cached_key, cached_pass) in creds.values() {
            if cached_key == key_path {
                return cached_pass.clone();
            }
        }
        None
    }
}

pub fn client_config() -> russh::client::Config {
    let mut config = russh::client::Config::default();
    config.window_size = 16 * 1024 * 1024; // 16 MB window for large volume transfers
    // Must stay well under russh's 256 KiB incoming packet limit: the server may
    // fill this with channel data and framing goes on top, and an oversized
    // packet kills the whole session mid-transfer.
    config.maximum_packet_size = 32 * 1024;
    config
}

pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    key_path: &str,
    passphrase: impl IntoPassphrase,
) -> Result<SshSession, String> {
    let key_content = tokio::fs::read_to_string(key_path)
        .await
        .map_err(|_| format!("SSH key file not found: {}", key_path))?;

    let passphrase_opt = passphrase.into_passphrase();

    let key_pair = match russh_keys::decode_secret_key(&key_content, passphrase_opt.as_deref()) {
        Ok(kp) => kp,
        Err(_) if passphrase_opt.is_some() => {
            // Key might be unencrypted, try without passphrase
            match russh_keys::decode_secret_key(&key_content, None) {
                Ok(kp) => kp,
                Err(_) => return Err("Invalid passphrase for SSH key".to_string()),
            }
        }
        Err(russh_keys::Error::KeyIsEncrypted) => {
            return Err("Invalid passphrase for SSH key".to_string());
        }
        Err(e) => {
            let err_str = e.to_string().to_lowercase();
            if err_str.contains("corrupt")
                || err_str.contains("password")
                || err_str.contains("decrypt")
                || err_str.contains("could not read key")
            {
                return Err("Invalid passphrase for SSH key".to_string());
            }
            return Err(format!("Failed to parse SSH key: {}", e));
        }
    };

    let config = Arc::new(client_config());
    let server_fingerprint = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        server_fingerprint: Arc::clone(&server_fingerprint),
    };

    let connect_future = russh::client::connect(config, (host, port), handler);
    let mut handle = match tokio::time::timeout(Duration::from_secs(10), connect_future).await {
        Ok(Ok(h)) => h,
        _ => {
            return Err(format!(
                "Cannot connect to {}:{} — server unreachable",
                host, port
            ))
        }
    };

    let auth_res = handle
        .authenticate_publickey(username, Arc::new(key_pair))
        .await;

    match auth_res {
        Ok(true) => {}
        _ => return Err(format!("Authentication failed for user {}", username)),
    }

    let fingerprint = server_fingerprint
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default();

    Ok(SshSession {
        handle,
        host_key_fingerprint: fingerprint,
    })
}

pub async fn exec(session: &SshSession, command: &str) -> Result<(u32, String, String), String> {
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_status: u32 = 0;

    while let Some(msg) = channel.wait().await {
        match msg {
            russh::ChannelMsg::Data { data } => {
                stdout.push_str(&String::from_utf8_lossy(&data));
            }
            russh::ChannelMsg::ExtendedData { data, .. } => {
                stderr.push_str(&String::from_utf8_lossy(&data));
            }
            russh::ChannelMsg::ExitStatus {
                exit_status: code,
            } => {
                exit_status = code;
            }
            russh::ChannelMsg::ExitSignal {
                signal_name,
                error_message,
                ..
            } => {
                exit_status = 1;
                let details = if error_message.is_empty() {
                    format!("Process terminated by signal {:?}", signal_name)
                } else {
                    format!(
                        "Process terminated by signal {:?}: {}",
                        signal_name, error_message
                    )
                };
                if !stderr.is_empty() && !stderr.ends_with('\n') {
                    stderr.push('\n');
                }
                stderr.push_str(&details);
            }
            _ => {}
        }
    }

    Ok((exit_status, stdout, stderr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ssh_connect_invalid_key_fails() {
        let result = connect("localhost", 22, "user", "/nonexistent/key", "pass").await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("key") || err.contains("not found") || err.contains("No such file"));
    }

    #[tokio::test]
    async fn test_wrong_passphrase_error_message() {
        let temp_dir = std::env::temp_dir().join(format!("ssh_test_{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.unwrap();
        let key_path = temp_dir.join("id_test");

        let status = std::process::Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "correct_pass", "-f", key_path.to_str().unwrap(), "-C", "test"])
            .output()
            .unwrap();
        assert!(status.status.success());

        let result = connect("127.0.0.1", 22, "user", key_path.to_str().unwrap(), "wrong_pass").await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err, "Invalid passphrase for SSH key");

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_ssh_connect_invalid_passphrase() {
        let temp_dir = std::env::temp_dir().join(format!("ssh_test_{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.unwrap();
        let key_path = temp_dir.join("id_test");

        let status = std::process::Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "correct_pass", "-f", key_path.to_str().unwrap(), "-C", "test"])
            .output()
            .unwrap();
        assert!(status.status.success());

        let result = connect("127.0.0.1", 22, "user", key_path.to_str().unwrap(), "wrong_pass").await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err, "Invalid passphrase for SSH key");

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_ssh_connect_unreachable_server() {
        let temp_dir = std::env::temp_dir().join(format!("ssh_test_{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.unwrap();
        let key_path = temp_dir.join("id_test");

        let status = std::process::Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "", "-f", key_path.to_str().unwrap(), "-C", "test"])
            .output()
            .unwrap();
        assert!(status.status.success());

        // Bind port to find free port, then drop listener
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let result = connect("127.0.0.1", port, "user", key_path.to_str().unwrap(), "").await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err, format!("Cannot connect to 127.0.0.1:{} \u{2014} server unreachable", port));

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[test]
    fn test_client_config_packets_fit_russh_limit() {
        // russh 0.45 drops the session on any incoming packet over 256 KiB
        // (cipher::MAXIMUM_PACKET_LEN). The server may fill maximum_packet_size
        // with channel data, and SSH framing (headers, padding, MAC) adds to it.
        const RUSSH_MAX_PACKET_LEN: u32 = 256 * 1024;
        const FRAMING_HEADROOM: u32 = 1024;
        let config = client_config();
        assert!(config.maximum_packet_size + FRAMING_HEADROOM <= RUSSH_MAX_PACKET_LEN);
        assert_eq!(config.window_size, 16 * 1024 * 1024);
    }

    #[test]
    fn test_session_registry_crud_and_credential_cache() {
        let registry = SessionRegistry::new();
        assert!(registry.get("source").is_none());
        assert!(registry.get_cached_passphrase("/path/key").is_none());

        registry.store_credentials("source", "/path/key", Some("secret123".to_string()));
        assert_eq!(
            registry.get_cached_passphrase("/path/key"),
            Some("secret123".to_string())
        );
        assert_eq!(registry.get_cached_passphrase("/other/key"), None);

        registry.remove("source");
        assert!(registry.get_cached_passphrase("/path/key").is_none());

        registry.store_credentials("source", "/path/key", Some("secret123".to_string()));
        registry.clear();
        assert!(registry.get_cached_passphrase("/path/key").is_none());
    }
}
