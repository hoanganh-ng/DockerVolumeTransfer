# Docker Volume Transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri v2 desktop app (Rust + React) that transfers Docker volumes between servers via SSH, with a guided wizard UI and saved server management.

**Architecture:** Tauri v2 backend in Rust handles SSH connections (`russh`), Docker commands, volume streaming, and SQLite persistence. SSH sessions are cached in-memory after initial passphrase entry — all subsequent commands reuse the live connection. React + TypeScript frontend renders a 5-step wizard (select source → select volumes → select destination → transfer → summary) with server management and transfer history. Communication via Tauri IPC commands.

**Tech Stack:** Tauri v2, Rust, tokio, russh, russh-keys, sqlx + SQLite, serde; React 18, TypeScript, Tailwind CSS, Zustand.

**Spec:** `docs/superpowers/specs/2025-07-18-docker-volume-transfer-design.md`

## Global Constraints

- Ubuntu 24 primary target, AppImage packaging
- Tauri v2 (not v1)
- SSH key auth with passphrase only — no password auth, no passphrase storage on disk
- Passphrase held in Rust memory only, never passed over IPC after initial connection
- Docker must be installed on both source and destination servers
- Dark theme UI
- All Docker commands must shell-escape volume names (single-quote wrapping with inner quote escaping)
- Transfer containers use deterministic names (`dvt_src_<uuid>`, `dvt_dst_<uuid>`) for cleanup on cancel/error
- Uncompressed `tar cf -` (not `tar czf -`) for accurate byte-for-byte progress tracking

## Review Focus

1. **SSH connection with wrong passphrase** — should show clear error, not hang or crash; allow retry
2. **Transfer of empty volume** — should complete without error, show 0 bytes transferred
3. **Network drop mid-transfer** — should detect, stop cleanly, kill remote containers (`docker rm -f`), report which volumes succeeded/failed
4. **Destination server has no Docker** — should fail at connection test with clear message ("Docker is not installed or not accessible"), not at transfer time
5. **Volume name with special characters** (spaces, dots, single quotes) — shell escaping must produce correct commands; test with `vol'quote`, `vol with spaces`, `my-vol.v2`

---

## File Structure

### Rust Backend (`src-tauri/`)

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── src/
│   ├── main.rs                  # Tauri app entry, register commands
│   ├── db.rs                    # SQLite init, migrations, connection pool
│   ├── models.rs                # Shared structs: Server, Volume, TransferRecord, TransferStatus
│   ├── ssh.rs                   # SSH session management: connect, exec, stream, session registry
│   ├── util.rs                  # shell_escape, human-readable size formatting
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── server.rs            # add_server, list_servers, update_server, delete_server, test_connection, ping_server
│   │   ├── volume.rs            # list_volumes, get_volume_size, check_volumes_on_dest, check_volumes_in_use
│   │   └── transfer.rs          # start_transfer, cancel_transfer (with progress events)
```

### React Frontend (`src/`)

```
src/
├── main.tsx                     # React entry
├── App.tsx                      # Layout, wizard router
├── store.ts                     # Zustand store: wizard state, servers, volumes, transfer progress
├── types.ts                     # TypeScript types mirroring Rust models
├── components/
│   ├── wizard/
│   │   ├── StepIndicator.tsx    # 4-step progress dots
│   │   ├── SelectSource.tsx     # Step 1: server card grid
│   │   ├── SelectVolumes.tsx    # Step 2: volume checklist
│   │   ├── SelectDestination.tsx# Step 3: server card grid + summary
│   │   ├── TransferProgress.tsx # Step 4: per-volume progress
│   │   └── TransferComplete.tsx # Step 5: summary
│   ├── servers/
│   │   ├── ServerCard.tsx       # Single server card
│   │   ├── AddServerModal.tsx   # Add/edit server form
│   │   └── PassphraseModal.tsx  # Passphrase prompt dialog
│   ├── transfer/
│   │   ├── ConflictModal.tsx    # Overwrite/skip per volume (with sizes)
│   │   └── VolumeProgressCard.tsx # Single volume progress
│   └── history/
│       └── TransferHistory.tsx  # History table with filters
├── styles/
│   └── index.css                # Tailwind imports + custom styles
```

---

### Task 1: Project Scaffold & Build Verification

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`
- Create: `src/main.tsx`, `src/App.tsx`, `src/styles/index.css`
- Create: `index.html`

**Interfaces:**
- Consumes: nothing
- Produces: working Tauri v2 + React + Tailwind app that builds and opens a window with "Docker Volume Transfer" heading

- [ ] **Step 1: Initialize Tauri v2 project**

Run `npm create tauri-app@latest` with React + TypeScript template, or manually scaffold. Configure `Cargo.toml` with dependencies: `tauri` (v2), `tokio` (full features), `serde` + `serde_json`, `russh`, `russh-keys`, `sqlx` (sqlite, runtime-tokio), `dirs`, `uuid`. Configure `package.json` with `react`, `react-dom`, `@tauri-apps/api` (v2), `@tauri-apps/plugin-dialog`, `tailwindcss`, `postcss`, `autoprefixer`, `zustand`, `vite`, `@vitejs/plugin-react`.

- [ ] **Step 2: Create minimal `main.rs`**

Tauri builder with no commands yet — just opens a window.

- [ ] **Step 3: Create minimal React app**

`App.tsx` renders a centered heading "Docker Volume Transfer". `index.css` imports Tailwind with dark theme defaults (dark background, light text).

- [ ] **Step 4: Verify build**

Run: `npm run tauri dev`
Expected: Window opens with heading visible, no build errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri v2 + React + Tailwind project"
```

---

### Task 2: Database Layer, Models & Server CRUD

**Files:**
- Create: `src-tauri/src/db.rs`
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/util.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/server.rs`
- Modify: `src-tauri/src/main.rs` (register commands, init DB)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Server { id: i64, name: String, host: String, username: String, port: u16, ssh_key_path: String, host_key_fingerprint: Option<String> }`
  - Tauri commands: `add_server(name, host, username, port, ssh_key_path) -> Server`, `list_servers() -> Vec<Server>`, `update_server(id, name, host, username, port, ssh_key_path) -> Server`, `delete_server(id) -> ()`
  - Tauri command: `ping_server(host: String, port: u16) -> bool` — TCP connect with 2-second timeout, no passphrase needed
  - `db::init_db(app_handle) -> SqlitePool` — creates DB at `~/.config/docker-volume-transfer/data.db`, runs migrations
  - `util::shell_escape(s: &str) -> String` — single-quote wrapping with inner quote escaping

- [ ] **Step 1: Write test for `shell_escape`**

```rust
#[test]
fn test_shell_escape_volume_name() {
    assert_eq!(shell_escape("my-vol.v2"), "'my-vol.v2'");
    assert_eq!(shell_escape("vol with spaces"), "'vol with spaces'");
    assert_eq!(shell_escape("vol'quote"), "'vol'\\''quote'");
    assert_eq!(shell_escape("simple"), "'simple'");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p docker-volume-transfer test_shell_escape`
Expected: FAIL — `shell_escape` not defined

- [ ] **Step 3: Implement `util.rs` with `shell_escape`**

Wrap in single quotes. Replace inner `'` with `'\''`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p docker-volume-transfer test_shell_escape`
Expected: PASS

- [ ] **Step 5: Write test for DB initialization**

```rust
#[tokio::test]
async fn test_init_db_creates_tables() {
    let pool = init_db_with_path(temp_path).await.unwrap();
    let servers = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' AND name='servers'")
        .fetch_one(&pool).await;
    let history = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' AND name='transfer_history'")
        .fetch_one(&pool).await;
    assert!(servers.is_ok());
    assert!(history.is_ok());
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cargo test -p docker-volume-transfer test_init_db`
Expected: FAIL

- [ ] **Step 7: Implement `db.rs`**

`init_db_with_path(path: &Path) -> Result<SqlitePool>` — creates parent dirs, connects SQLite, runs CREATE TABLE for:
- `servers` (id INTEGER PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22, ssh_key_path TEXT NOT NULL, host_key_fingerprint TEXT)
- `transfer_history` (id INTEGER PRIMARY KEY, source_server_name TEXT NOT NULL, dest_server_name TEXT NOT NULL, volume_names TEXT NOT NULL, total_size_bytes INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, duration_seconds INTEGER, status TEXT NOT NULL)

`init_db(app_handle) -> Result<SqlitePool>` wraps with `~/.config/docker-volume-transfer/data.db`.

- [ ] **Step 8: Run test to verify it passes**

Run: `cargo test -p docker-volume-transfer test_init_db`
Expected: PASS

- [ ] **Step 9: Write test for server CRUD**

```rust
#[tokio::test]
async fn test_server_crud() {
    let pool = init_db_with_path(temp_path).await.unwrap();
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
}
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cargo test -p docker-volume-transfer test_server_crud`
Expected: FAIL

- [ ] **Step 11: Implement `models.rs` and `commands/server.rs`**

`models.rs`: `Server` struct with serde Serialize/Deserialize. `Volume { name: String, driver: String, in_use: bool }`. `TransferRecord { id: i64, source_server_name: String, dest_server_name: String, volume_names: Vec<String>, total_size_bytes: u64, started_at: String, completed_at: Option<String>, duration_seconds: Option<u64>, status: String }`.

`commands/server.rs`: DB functions `add_server_db`, `list_servers_db`, `update_server_db` (clears `host_key_fingerprint = NULL` if `host` or `port` changed from stored values), `delete_server_db`, `update_host_key_db` using sqlx queries. Tauri command wrappers. `ping_server(host, port) -> bool`: `tokio::net::TcpStream::connect_timeout` with 2-second deadline.

- [ ] **Step 12: Run test to verify it passes**

Run: `cargo test -p docker-volume-transfer test_server_crud`
Expected: PASS

- [ ] **Step 13: Register commands in `main.rs`**

Add `manage(tauri::State<SqlitePool>)`, register all server commands with invoke handler. Init DB in `setup` hook, store pool in app state.

- [ ] **Step 14: Verify build**

Run: `cargo build -p docker-volume-transfer`
Expected: compiles

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: database layer, models, shell_escape, and server CRUD commands"
```

---

### Task 3: SSH Session Management & Docker Volume Commands

**Files:**
- Create: `src-tauri/src/ssh.rs`
- Create: `src-tauri/src/commands/volume.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs` (register volume commands, add session registry to state)

**Interfaces:**
- Consumes: `Server`, `Volume` from Task 2; `shell_escape` from Task 2
- Produces:
  - `SshSession` — wrapper around russh client session
  - `SessionRegistry` — `Mutex<HashMap<String, Arc<SshSession>>>` keyed by role string ("source" / "destination"). Also caches `(ssh_key_path, passphrase)` per role for same-key reuse.
  - `ssh::connect(host, port, username, key_path, passphrase) -> Result<SshSession>` — 10s timeout, returns user-friendly errors for wrong passphrase / unreachable / key not found
  - `ssh::exec(session, command) -> Result<(u32, String, String)>` — returns (exit_status, stdout, stderr). Returns `Err` if channel fails; callers check `exit_status` for command-level success.
  - `ssh::check_server_key` — TOFU: store fingerprint on first connect, error if changed
  - Tauri commands:
    - `connect_server(server_id: i64, passphrase: Option<String>, role: String) -> Result<(), String>` — connects using provided passphrase or reuses cached passphrase from registry if `None` and same `ssh_key_path` as existing role. Caches session + (key_path, passphrase) in registry. Updates host key fingerprint in DB. Pre-warms `alpine:latest` on the host after connect (`docker image inspect alpine:latest >/dev/null 2>&1 || docker pull -q alpine:latest`).
    - `disconnect_server(role: String) -> ()` — drops session from registry
    - `test_connection(host, port, username, ssh_key_path, passphrase) -> Result<(), String>` — connect + `docker info`, returns error if Docker not available
    - `list_volumes(role: String) -> Result<Vec<Volume>, String>` — uses cached session, runs `docker volume ls --format '{{json .}}'`, then `docker ps --format '{{json .}}'` to determine `in_use` per volume
    - `get_volume_size(role: String, volume_name: String) -> Result<u64, String>` — uses cached session, runs `docker run --rm -v '<escaped_name>':/data alpine du -sb /data`, parses byte count
    - `check_volumes_on_dest(volume_names: Vec<String>) -> Result<HashMap<String, u64>, String>` — uses destination session, batch `docker volume inspect <names>`, for each existing volume runs `du -sb` to get size. Returns map of name → size_bytes for volumes that exist.

- [ ] **Step 1: Write test for SSH connect with invalid key path**

```rust
#[tokio::test]
async fn test_ssh_connect_invalid_key_fails() {
    let result = connect("localhost", 22, "user", "/nonexistent/key", "pass").await;
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("key") || err.contains("not found") || err.contains("No such file"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p docker-volume-transfer test_ssh_connect_invalid`
Expected: FAIL — `connect` not defined

- [ ] **Step 3: Implement `ssh.rs`**

`connect(host, port, username, key_path, passphrase) -> Result<SshSession>`: read private key file, decrypt with passphrase via `russh_keys::decode_secret_key`, connect via `russh::client` with 10s timeout. Implement `russh::client::Handler` with `check_server_key` that returns the server's public key fingerprint. `exec(session, cmd) -> Result<(u32, String, String)>`: open channel, exec command, collect stdout and stderr into separate buffers, await `ChannelMsg::ExitStatus` for exit code, return `(exit_status, stdout, stderr)`. `SshSession` holds the russh handle.

`SessionRegistry`: `Arc<Mutex<HashMap<String, Arc<SshSession>>>>`. Methods: `store(role, session)`, `get(role) -> Option<Arc<SshSession>>`, `remove(role)`, `clear()`.

Wrap russh errors into user-friendly messages:
- Wrong passphrase: "Invalid passphrase for SSH key"
- Unreachable: "Cannot connect to {host}:{port} — server unreachable"
- Auth failed: "Authentication failed for user {username}"
- Key not found: "SSH key file not found: {path}"

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p docker-volume-transfer test_ssh_connect_invalid`
Expected: PASS (returns descriptive Err)

- [ ] **Step 5: Implement `commands/volume.rs`**

`connect_server`: look up server by ID. If `passphrase` is `None`, check registry for existing role with matching `ssh_key_path` — if found, reuse cached passphrase. Call `ssh::connect`, store session + `(key_path, passphrase)` in registry, update `host_key_fingerprint` in DB via `update_host_key_db`. If host key changed from stored value, return error: "Server host key has changed — possible security risk." After successful connect, verify Docker: run `docker info` via `ssh::exec`, check `exit_status == 0`. If non-zero, return error: "Docker is not installed or not accessible on this server." Then pre-warm alpine: run `docker image inspect alpine:latest >/dev/null 2>&1 || docker pull -q alpine:latest`.

`test_connection`: connect, run `docker info` via `ssh::exec`. If exit error, return "Docker is not installed or not accessible on this server." Disconnect after test.

`list_volumes`: get session from registry. Run `docker volume ls --format '{{json .}}'` — parse JSON lines into name + driver. Run single command to get all mounted volume names: `docker ps -q | xargs -r docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}'` — outputs exact newline-delimited volume names. Match against volume list to set `in_use: bool` (single SSH call, no per-volume loop, no comma-split ambiguity).

`get_volume_size`: get session from registry. Run `docker run --rm -v '<shell_escape(name)>':/data alpine du -sb /data`. Parse first field as `u64`.

`check_volumes_on_dest`: get destination session. For each name, run `docker volume inspect '<name>'` — if exists, run `du -sb` to get size. Return `HashMap<String, u64>` of existing volumes with their sizes.

- [ ] **Step 6: Register commands in `main.rs`**

Add `SessionRegistry` to Tauri managed state. Register `connect_server`, `disconnect_server`, `test_connection`, `list_volumes`, `get_volume_size`, `check_volumes_on_dest`.

- [ ] **Step 7: Verify build**

Run: `cargo build -p docker-volume-transfer`
Expected: compiles

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: SSH session registry, TOFU host keys, and Docker volume commands"
```

---

### Task 4: Volume Transfer Engine with Progress Events

**Files:**
- Create: `src-tauri/src/commands/transfer.rs`
- Modify: `src-tauri/src/models.rs` (add `TransferStatus`, `TransferEvent`, `TransferVolume`)
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs` (register transfer commands)
- Modify: `src-tauri/src/db.rs` (add transfer history queries)

**Interfaces:**
- Consumes: `ssh::exec`, `SshSession`, `SessionRegistry` from Task 3; `SqlitePool`, `shell_escape` from Task 2
- Produces:
  - Tauri command: `start_transfer(source_server_name: String, dest_server_name: String, volumes: Vec<TransferVolume>) -> Result<(), String>` where `TransferVolume { name: String, size_bytes: u64, action: String }` (action: "transfer" | "overwrite" | "skip")
  - Tauri command: `cancel_transfer() -> ()`
  - Tauri event `transfer-progress`: `TransferEvent { volume_name: String, status: String, bytes_transferred: u64, total_bytes: u64, speed_bps: u64 }`
  - Tauri event `transfer-complete`: `TransferSummary { volumes: Vec<VolumeResult>, total_bytes: u64, duration_seconds: u64 }`
  - `TransferStatus` enum: `Pending`, `InProgress`, `Complete`, `Failed(String)`, `Skipped`, `Cancelled`
  - DB functions: `save_transfer_record(pool, record) -> Result<TransferRecord>`, `list_transfer_history(pool) -> Result<Vec<TransferRecord>>`

- [ ] **Step 1: Write test for transfer record persistence**

```rust
#[tokio::test]
async fn test_save_and_list_transfer_history() {
    let pool = init_db_with_path(temp_path).await.unwrap();
    let record = save_transfer_record(&pool, "prod-web", "prod-db", &["vol_a", "vol_b"], 1024, 30, "success").await.unwrap();
    assert_eq!(record.status, "success");
    assert_eq!(record.source_server_name, "prod-web");
    let history = list_transfer_history(&pool).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].volume_names, vec!["vol_a", "vol_b"]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p docker-volume-transfer test_save_and_list_transfer`
Expected: FAIL

- [ ] **Step 3: Implement transfer history DB functions in `db.rs`**

`save_transfer_record`: INSERT into `transfer_history`, volume_names stored as JSON array text via `serde_json::to_string`. `list_transfer_history`: SELECT ordered by started_at DESC, deserialize volume_names from JSON.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p docker-volume-transfer test_save_and_list_transfer`
Expected: PASS

- [ ] **Step 5: Implement `commands/transfer.rs`**

`start_transfer`: spawns tokio task. Generate a UUID for this transfer batch.

For each volume where action != "skip":
- Generate container names: `dvt_src_{uuid}_{index}`, `dvt_dst_{uuid}_{index}`
- Source command: `docker run --rm --name {src_name} -v {shell_escape(vol)}:/data alpine tar cf - -C /data .`
- Destination command (overwrite): `docker run --rm --name {dst_name} -i -v {shell_escape(vol)}:/data alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* && tar xf - -C /data'`
- Destination command (new/transfer): `docker run --rm --name {dst_name} -i -v {shell_escape(vol)}:/data alpine tar xf - -C /data`
- Open SSH exec channels for both commands. 4-stage channel lifecycle per volume:
  1. Stream `ChannelMsg::Data` chunks from `src_channel` into `dest_channel.data()`. Count bytes. Emit `transfer-progress` every 500ms.
  2. On `src_channel` EOF, await `ChannelMsg::ExitStatus` from `src_channel` — verify `exit_status == 0`. If non-zero, collect stderr, emit Failed, attempt `docker rm -f` cleanup, continue to next volume.
  3. Call `dest_channel.eof().await` to signal end-of-input to destination `tar xf -`.
  4. Await `ChannelMsg::ExitStatus` from `dest_channel` — verify `exit_status == 0` before emitting `TransferStatus::Complete`. If non-zero, emit Failed with stderr.
- On error: emit Failed status with error message, attempt `docker rm -f {src_name} {dst_name}` via control exec.

After all volumes: emit `transfer-complete` with summary. Save record to DB.

`cancel_transfer`: sets `AtomicBool` flag. Transfer loop checks flag between byte reads. On cancel: for each active container name, run `docker rm -f {name}` on both source and destination via fresh SSH exec channels. Mark remaining volumes as Cancelled.

Store `CancellationToken` (Arc<AtomicBool>) and `ActiveContainers` (Arc<Mutex<Vec<String>>>) in Tauri state.

- [ ] **Step 6: Register transfer commands in `main.rs`**

Add `start_transfer`, `cancel_transfer`, `list_transfer_history` to invoke handler. Add `CancellationToken` and `ActiveContainers` to managed state.

- [ ] **Step 7: Verify build**

Run: `cargo build -p docker-volume-transfer`
Expected: compiles

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: volume transfer engine with progress events, container cleanup, and history"
```

---

### Task 5: Frontend — Types, Store & App Shell

**Files:**
- Create: `src/types.ts`
- Create: `src/store.ts`
- Modify: `src/App.tsx` (wizard layout with step routing)
- Create: `src/components/wizard/StepIndicator.tsx`

**Interfaces:**
- Consumes: Tauri command signatures from Tasks 2-4
- Produces:
  - TypeScript types: `Server`, `Volume`, `TransferVolume`, `TransferEvent`, `TransferStatus`, `TransferSummary`, `VolumeResult`, `TransferRecord`, `DestVolumeInfo`
  - Zustand store: `useAppStore` with state: `step` (1-5), `servers: Server[]`, `sourceServer: Server | null`, `destServer: Server | null`, `volumes: Volume[]`, `selectedVolumes: TransferVolume[]`, `transferEvents: Map<string, TransferEvent>`, `transferSummary: TransferSummary | null`, `history: TransferRecord[]`, `showHistory: boolean`. Actions: `setStep`, `setSourceServer`, `setDestServer`, `toggleVolume`, `selectAllVolumes`, `reset`, `setShowHistory`, `fetchHistory`. No passphrase stored in frontend — passphrase caching handled entirely in Rust `SessionRegistry`.
  - `StepIndicator` component: props `currentStep: number`, renders 4 step circles with connectors
  - `App.tsx`: renders StepIndicator + current step component based on store's `step`, or TransferHistory if `showHistory`

- [ ] **Step 1: Create `types.ts`**

`Server { id: number, name: string, host: string, username: string, port: number, ssh_key_path: string, host_key_fingerprint: string | null }`. `Volume { name: string, driver: string, in_use: boolean }`. `TransferVolume { name: string, size_bytes: number, action: "transfer" | "overwrite" | "skip" }`. `TransferEvent { volume_name: string, status: string, bytes_transferred: number, total_bytes: number, speed_bps: number }`. `TransferSummary { volumes: VolumeResult[], total_bytes: number, duration_seconds: number }`. `VolumeResult { name: string, size_bytes: number, duration_seconds: number, status: string, error: string | null }`. `TransferRecord { id: number, source_server_name: string, dest_server_name: string, volume_names: string[], total_size_bytes: number, started_at: string, completed_at: string | null, duration_seconds: number | null, status: string }`. `DestVolumeInfo = Record<string, number>` (name → size_bytes for existing volumes).

- [ ] **Step 2: Create `store.ts`**

Zustand store with all state fields and actions listed above. No passphrase fields — passphrase never touches frontend store. Default step: 1.

- [ ] **Step 3: Create `StepIndicator.tsx`**

Accepts `currentStep`. Renders 4 circles (1-4) with connecting lines. Completed steps show checkmark with blue background. Current step shows number with blue background. Future steps grey. Step 5 (summary) reuses step 4 position.

- [ ] **Step 4: Update `App.tsx`**

Dark background full-height layout. History icon button in top-right. Renders `StepIndicator` at top. Below, conditionally renders step components or `TransferHistory`.

- [ ] **Step 5: Verify**

Run: `npm run tauri dev`
Expected: App shows step indicator with step 1 active, dark theme, history icon.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: frontend types, Zustand store, and app shell with step indicator"
```

---

### Task 6: Frontend — Server Management (Cards, Add/Edit Modal, Passphrase)

**Files:**
- Create: `src/components/servers/ServerCard.tsx`
- Create: `src/components/servers/AddServerModal.tsx`
- Create: `src/components/servers/PassphraseModal.tsx`

**Interfaces:**
- Consumes: `Server` type, `useAppStore`, Tauri commands `list_servers`, `add_server`, `update_server`, `delete_server`, `test_connection`, `ping_server`
- Produces:
  - `ServerCard` — props: `server: Server`, `selected: boolean`, `disabled: boolean`, `disabledReason?: string`, `online: boolean`, `onSelect`, `onEdit`, `onDelete`. Renders card with name, host, status dot, selection border.
  - `AddServerModal` — props: `open: boolean`, `onClose`, `server?: Server` (for edit), `onSaved`. Form fields, calls `test_connection` then `add_server`/`update_server`.
  - `PassphraseModal` — props: `open: boolean`, `serverName: string`, `onSubmit(passphrase: string)`, `onCancel`, `error?: string`. Simple dialog with passphrase input and submit.

- [ ] **Step 1: Implement `ServerCard.tsx`**

Rounded card with border. Shows server name (bold), host/IP, username@port. `online` prop controls green (online) / red (offline) dot. When `selected`, blue border + highlight background. When `disabled`, 30% opacity, cursor not-allowed, tooltip with `disabledReason`. Edit (pencil) and delete (trash) icon buttons in top-right corner. Delete confirms with window confirm dialog.

- [ ] **Step 2: Implement `AddServerModal.tsx`**

Modal overlay with form: Server Name, Host/IP, Username, Port (default 22), SSH Key Path with "Browse" button (uses Tauri dialog plugin `open()` for file picker). "Test & Save" button: opens PassphraseModal to get passphrase, then invokes `test_connection`. On success, calls `add_server` (or `update_server` if editing). Shows error on failure with retry. "Cancel" button closes.

- [ ] **Step 3: Implement `PassphraseModal.tsx`**

Modal overlay with: "Enter passphrase for {serverName}" label, password input field (type=password), error message area, "Connect" and "Cancel" buttons. Auto-focuses input on open. Submits on Enter key. Shows `error` prop if previous attempt failed.

- [ ] **Step 4: Verify**

Run: `npm run tauri dev`
Expected: Components render correctly when wired in.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: server card, add/edit modal, and passphrase prompt components"
```

---

### Task 7: Frontend — Wizard Steps 1-3 (Source, Volumes, Destination)

**Files:**
- Create: `src/components/wizard/SelectSource.tsx`
- Create: `src/components/wizard/SelectVolumes.tsx`
- Create: `src/components/wizard/SelectDestination.tsx`

**Interfaces:**
- Consumes: `ServerCard`, `AddServerModal`, `PassphraseModal` from Task 6; `useAppStore` from Task 5; Tauri commands `list_servers`, `ping_server`, `connect_server`, `list_volumes`, `get_volume_size`, `check_volumes_on_dest` from Tasks 2-3
- Produces:
  - `SelectSource` — Step 1: grid of ServerCards + Add Server card. On card click: prompt passphrase, connect, advance to step 2.
  - `SelectVolumes` — Step 2: fetches `list_volumes`, renders checkbox list with in-use warnings. On select, calls `get_volume_size` per volume.
  - `SelectDestination` — Step 3: same card grid, source greyed out. On select: prompt passphrase (skip if same key), connect, check for conflicts.

- [ ] **Step 1: Implement `SelectSource.tsx`**

On mount: invoke `list_servers`, then `ping_server` for each (parallel, 2s timeout). Populate grid of `ServerCard` components with `online` status. "+ Add Server" card (dashed border, plus icon). Clicking an online card opens `PassphraseModal`. On passphrase submit: invoke `connect_server(server.id, passphrase, "source")`. Success: store `sourceServer` in Zustand, call `setStep(2)`. Failure: show error in PassphraseModal, allow retry. Offline cards not clickable.

- [ ] **Step 2: Implement `SelectVolumes.tsx`**

On mount: invoke `list_volumes("source")`. Render list items: checkbox, volume name, driver. Volumes with `in_use: true` show orange warning badge: "In use — backup may be inconsistent". Size column shows "—" until fetched. On checkbox toggle: if selecting, invoke `get_volume_size("source", name)`, show result. On deselect, remove from selectedVolumes. "Select All" link toggles all (triggers size fetch for each not yet fetched — calls are parallel). Header shows "{N} selected · {size} total". Back button: `setStep(1)`. Next button: `setStep(3)`, disabled if none selected.

- [ ] **Step 3: Implement `SelectDestination.tsx`**

On mount: invoke `list_servers`, `ping_server` for each. Same grid as SelectSource. Source server card shown with `disabled=true`, `disabledReason="Source server"`. Offline cards disabled.

**Selecting destination (card click):** If `server.ssh_key_path === sourceServer.ssh_key_path`, try `connect_server(server.id, null, "destination")` (Rust reuses cached passphrase internally). If fails or different key: open PassphraseModal, then `connect_server(server.id, passphrase, "destination")`. On connect success: set `destServer` in Zustand store. Show transfer summary panel below the grid: source → dest names, volume count, total size.

**Starting transfer ("Start Transfer" button click):** Invoke `check_volumes_on_dest(selectedVolumeNames)`. If conflicts found (non-empty map returned), show ConflictModal (Task 8). ConflictModal's `onResolved` sets volume actions, then calls `setStep(4)`. If no conflicts, set all actions to "transfer" and call `setStep(4)`. Button disabled until `destServer` is set.

- [ ] **Step 4: Wire steps into `App.tsx`**

Import and render `SelectSource` (step 1), `SelectVolumes` (step 2), `SelectDestination` (step 3).

- [ ] **Step 5: Verify**

Run: `npm run tauri dev`
Expected: Wizard navigates between steps 1-3, forms render correctly.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wizard steps 1-3 — source, volumes, destination selection"
```

---

### Task 8: Frontend — Conflict Resolution, Transfer Progress & Completion

**Files:**
- Create: `src/components/transfer/ConflictModal.tsx`
- Create: `src/components/transfer/VolumeProgressCard.tsx`
- Create: `src/components/wizard/TransferProgress.tsx`
- Create: `src/components/wizard/TransferComplete.tsx`
- Modify: `src/App.tsx` (add steps 4-5)

**Interfaces:**
- Consumes: `useAppStore` from Task 5; Tauri commands `start_transfer`, `cancel_transfer` from Task 4; Tauri events `transfer-progress`, `transfer-complete`
- Produces:
  - `ConflictModal` — props: `conflicts: Map<string, {sourceSize: number, destSize: number}>`, `onResolved(decisions: TransferVolume[])`. Shows each conflicting volume with sizes and Overwrite/Skip buttons.
  - `VolumeProgressCard` — props: `volume: TransferVolume`, `event?: TransferEvent`. Renders single volume with status-dependent display.
  - `TransferProgress` — Step 4: starts transfer, listens to events, renders progress.
  - `TransferComplete` — Step 5: summary.

- [ ] **Step 1: Implement `ConflictModal.tsx`**

Modal listing each conflicting volume: name, "Existing on destination: {destSize}", "Incoming: {sourceSize}". Two buttons per volume: "Overwrite" and "Skip". As user decides each, mark it visually (strikethrough for skip, highlight for overwrite). "Continue" button enabled when all conflicts decided **and at least one volume has action != "skip"**. If all volumes set to "skip", disable "Continue" with note: "At least one volume must be selected to transfer." Calls `onResolved` with merged array: non-conflicting volumes get action "transfer", conflicting get "overwrite" or "skip".

- [ ] **Step 2: Implement `VolumeProgressCard.tsx`**

Rounded card with border color based on status string. "Complete": green check, full green bar, size + duration. "InProgress": spinner, clamped percentage text (`total_bytes > 0 ? Math.min(99, Math.floor(bytes_transferred / total_bytes * 100)) : 0` — never shows 100% while InProgress; 100% only on Complete), partially filled blue gradient bar, speed (format as MB/s) + ETA. "Pending": grey border, "Waiting" text. "Failed": red border, error message. "Skipped": grey, "Skipped" text. "Cancelled": grey, "Cancelled" text.

- [ ] **Step 3: Implement `TransferProgress.tsx`**

On mount: invoke `start_transfer(sourceServer.name, destServer.name, selectedVolumes)`. Listen to Tauri event `transfer-progress` via `listen()` from `@tauri-apps/api/event` — update store's `transferEvents` map keyed by volume_name. Listen to `transfer-complete` — store summary, move to step 5. Render list of `VolumeProgressCard` for each selected volume (skip action="skip"). Overall progress bar: `totalActiveBytes > 0 ? Math.min(99, Math.floor(sumTransferred / totalActiveBytes * 100)) : 0` — guarded against 0/0 division, clamped to 99% while any volume is InProgress. Cancel button: confirms with dialog ("Cancel transfer? Volumes already transferred will remain on destination."), invokes `cancel_transfer`.

- [ ] **Step 4: Implement `TransferComplete.tsx`**

Reads `transferSummary` from store. Table/list of volumes: name, size (human-readable), duration, status (color-coded badge). Total row: total size, total time. Skipped volumes listed separately. Failed volumes show error. "New Transfer" button: invokes `disconnect_server("source")` and `disconnect_server("destination")`, calls `store.reset()`. "View History" button: `setShowHistory(true)`.

- [ ] **Step 5: Wire steps 4-5 into `App.tsx`**

Render `TransferProgress` (step 4), `TransferComplete` (step 5).

- [ ] **Step 6: Verify**

Run: `npm run tauri dev`
Expected: Full wizard flow renders end-to-end.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: conflict resolution, transfer progress, and completion summary"
```

---

### Task 9: Transfer History View

**Files:**
- Create: `src/components/history/TransferHistory.tsx`
- Modify: `src/App.tsx` (history view rendering)

**Interfaces:**
- Consumes: Tauri command `list_transfer_history` from Task 4; `useAppStore` from Task 5
- Produces:
  - `TransferHistory` — table with columns: date, source → destination, volumes, total size, duration, status. Filterable, sortable. Close button returns to wizard.

- [ ] **Step 1: Implement `TransferHistory.tsx`**

On mount: invoke `list_transfer_history`, populate table. Columns: Date (formatted locale string), Source → Destination (server names with arrow), Volumes (comma-separated, truncated if >3 with "+N more" tooltip), Size (human-readable: KB/MB/GB), Duration (formatted: Xs, Xm Xs), Status (colored badge: green "Success", red "Failed", yellow "Cancelled"). Filter input: filters by server name or volume name (client-side, case-insensitive). Sort by date column header (toggle asc/desc, default desc). Empty state: "No transfers yet." "Close" button / X: `setShowHistory(false)`.

- [ ] **Step 2: Wire into `App.tsx`**

When `showHistory` true, render `TransferHistory` fullscreen instead of wizard.

- [ ] **Step 3: Verify**

Run: `npm run tauri dev`
Expected: History icon opens history view, close returns to wizard.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: transfer history view with filtering and sorting"
```

---

### Task 10: Edge Case Hardening & Review Focus Tests

**Files:**
- Modify: `src-tauri/src/ssh.rs` (error messages)
- Modify: `src-tauri/src/commands/transfer.rs` (empty volume, network drop)
- Modify: `src-tauri/src/commands/volume.rs` (Docker check)
- Modify: `src-tauri/src/util.rs` (if needed)

**Interfaces:**
- Consumes: all prior tasks
- Produces: hardened error handling covering Review Focus items

- [ ] **Step 1: Write test — wrong passphrase returns clear error**

```rust
#[tokio::test]
async fn test_wrong_passphrase_error_message() {
    let result = connect("localhost", 22, "user", valid_key_path, "wrong-passphrase").await;
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.to_lowercase().contains("passphrase") || err.to_lowercase().contains("decrypt"));
}
```

- [ ] **Step 2: Verify error message is user-friendly, fix if not**

Ensure `ssh.rs` wraps russh/russh-keys errors. "Invalid passphrase for SSH key" not raw library error.

- [ ] **Step 3: Write test — empty volume size returns 0**

```rust
#[test]
fn test_parse_du_output_zero() {
    let output = "0\t/data\n";
    let size = parse_du_output(output).unwrap();
    assert_eq!(size, 0);
}
```

- [ ] **Step 4: Verify transfer logic handles 0-byte stream**

Ensure `start_transfer` doesn't divide by zero in progress calculation when `total_bytes == 0`. Progress should show 100% immediately for empty volumes. Verify `VolumeProgressCard` clamps InProgress to max 99% (`Math.min(99, ...)`), never shows >100%.

- [ ] **Step 5: Write test — shell_escape covers all Review Focus cases**

```rust
#[test]
fn test_shell_escape_review_focus() {
    assert_eq!(shell_escape("vol'quote"), "'vol'\\''quote'");
    assert_eq!(shell_escape("vol with spaces"), "'vol with spaces'");
    assert_eq!(shell_escape("my-vol.v2"), "'my-vol.v2'");
    assert_eq!(shell_escape(""), "''");
    assert_eq!(shell_escape("a'b'c"), "'a'\\''b'\\''c'");
}
```

- [ ] **Step 6: Verify container cleanup on cancel**

Review `cancel_transfer` implementation: confirm it iterates `ActiveContainers` and runs `docker rm -f` for each on both source and destination sessions. Confirm `--name` flag is set on all `docker run` commands in transfer.

- [ ] **Step 7: Verify Docker availability check in `test_connection`**

Confirm `test_connection` runs `docker info` after SSH connect and returns "Docker is not installed or not accessible on this server" on failure.

- [ ] **Step 8: Run all tests**

Run: `cargo test -p docker-volume-transfer`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: edge case hardening — error messages, empty volumes, shell escaping, container cleanup"
```

---
