# Docker Volume Transfer (DVT)

A fast, secure, cross-platform desktop application built with **Tauri v2**, **Rust**, and **React** for migrating Docker volumes directly between remote servers over SSH without writing data to your local machine.

---

## Highlights

- **Direct Host-to-Host Streaming**: Streams volume contents directly over SSH (`tar cf -` into `tar xf -`) through an in-memory buffer. No local disk space required.
- **Guided 4-Step Wizard**:
  1. **Select Source Server**: Connects to the source machine and pre-checks Docker daemon and helper image.
  2. **Select Volumes**: Lists all Docker volumes with byte sizes and active container attachments.
  3. **Select Destination Server**: Connects to the target machine and scans for volume name collisions.
  4. **Transfer & Monitor**: Live progress tracking per volume and overall, with throughput (MB/s) and ETA.
- **Conflict Handling**: Resolves target volume collisions via **Overwrite**, **Rename**, or **Skip** actions before streaming begins.
- **Zero Passphrase Persistence**: SSH private key passphrases remain strictly in volatile Rust memory for the active session. Never stored in SQLite or passed across persistent storage.
- **TOFU Host Key Verification**: Trust-On-First-Use SSH host key fingerprint pinning protects against Man-In-The-Middle (MITM) attacks.
- **Automatic Container Lifecycle & Cleanup**: Helper containers (`dvt_src_<uuid>_<idx>` and `dvt_dst_<uuid>_<idx>`) run with read-only/read-write mounts and are cleanly removed even upon cancellation or failure.
- **Transfer History Audit Log**: Persists completion status, transferred bytes, transfer duration, and volume lists in local SQLite.

---

## Architecture Overview

```
 ┌─────────────────────────────────────────────────────────────┐
 │               Docker Volume Transfer Desktop App            │
 │                                                             │
 │  ┌───────────────────────┐        ┌──────────────────────┐  │
 │  │  React 18 + Tailwind  │  IPC   │ Tauri v2 + Tokio     │  │
 │  │  Zustand App Store    │◄──────►│ Russh SSH Engine     │  │
 │  │  Wizard & Modals UI   │        │ SQLite (SQLx)        │  │
 │  └───────────────────────┘        └──────────┬───────────┘  │
 └──────────────────────────────────────────────┼──────────────┘
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 │                                                             │
         SSH Stream (tar cf -)                                         SSH Stream (tar xf -)
                 │                                                             │
                 ▼                                                             ▼
     ┌───────────────────────┐                                     ┌───────────────────────┐
     │     Source Host       │                                     │   Destination Host    │
     │  ┌─────────────────┐  │                                     │  ┌─────────────────┐  │
     │  │ dvt_src_...     │  │                                     │  │ dvt_dst_...     │  │
     │  │ (Alpine helper) │  │                                     │  │ (Alpine helper) │  │
     │  └────────┬────────┘  │                                     │  └────────┬────────┘  │
     │           │ read-only │                                     │           │ read-write│
     │  ┌────────▼────────┐  │                                     │  ┌────────▼────────┐  │
     │  │  Docker Volume  │  │                                     │  │  Docker Volume  │  │
     │  └─────────────────┘  │                                     │  └─────────────────┘  │
     └───────────────────────┘                                     └───────────────────────┘
```

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Zustand, Lucide React, Vite
- **Desktop Runtime**: Tauri v2 (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`)
- **Backend**: Rust 2021, Tokio async runtime
- **SSH Engine**: `russh` 0.45, `russh-keys` 0.45
- **Database**: SQLite embedded via `sqlx` 0.8
- **Packaging**: AppImage (Linux x86_64)

---

## Quick Start (Run AppImage)

Download the release AppImage or locate the locally built binary:

```bash
chmod +x "Docker Volume Transfer_0.1.0_amd64.AppImage"
./"Docker\ Volume\ Transfer_0.1.0_amd64.AppImage"
```

---

## Building from Source

### Prerequisites

- **Node.js**: v18+ and `npm`
- **Rust**: 1.77+ and `cargo`
- **Linux Dev Libraries**:
  ```bash
  sudo apt-get update && sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
  ```

### Build Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/hoanganh-ng/DockerVolumeTransfer.git
   cd DockerVolumeTransfer
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Run tests**:
   ```bash
   # Run frontend unit tests (Node test runner)
   npm test

   # Run backend Rust unit tests
   cargo test -p docker-volume-transfer
   ```

4. **Run in development mode**:
   ```bash
   npm run tauri dev
   ```

5. **Build release AppImage**:
   ```bash
   npx tauri build --bundles appimage -c '{"bundle":{"active":true,"icon":["icons/32x32.png","icons/128x128.png","icons/128x128@2x.png","icons/icon.icns","icons/icon.ico"]}}'
   ```
   The bundled executable will be generated at:
   `target/release/bundle/appimage/Docker Volume Transfer_0.1.0_amd64.AppImage`

---

## Server & Network Requirements

Both remote servers must meet the following criteria:

1. **SSH Access**: Key-based authentication (OpenSSH, ED25519, or RSA). Password-based authentication is intentionally unsupported for security.
2. **Docker Daemon Running**: The SSH user must have permission to execute `docker` commands without sudo (e.g. member of the `docker` group) or have passwordless sudo configured.
3. **Alpine Helper Image**: DVT automatically checks for and pre-pulls `alpine:latest` upon server connection.

---

## Usage Guide

### 1. Adding a Server
- Click **"Add Server"** in the top navigation or server selection screen.
- Provide:
  - **Server Label**: Friendly name (e.g., `Prod-US-East`).
  - **Host / IP**: Hostname or IPv4/IPv6 address.
  - **Port**: SSH port (default `22`).
  - **Username**: Remote SSH user (e.g., `ubuntu` or `root`).
  - **Private Key**: Local path to your private key file (use **Browse** to pick).
- Click **"Test Connection"** to verify reachability and Docker availability.

### 2. Migrating Volumes
1. **Source Server**: Choose a configured server. Enter private key passphrase if prompted.
2. **Select Volumes**: Check one or more volumes to migrate. Review active containers using each volume.
3. **Destination Server**: Select target host. DVT verifies Docker status and detects if any selected volumes already exist on destination.
4. **Resolve Conflicts**: If volumes collide, choose an action:
   - **Skip**: Skip transferring this volume.
   - **Overwrite**: Delete destination volume contents and replace with source.
   - **Rename**: Assign a new name to the volume on destination host.
5. **Start Transfer**: Real-time progress bars, byte counts, transfer rate (MB/s), and ETA are displayed.
6. **Completion**: Review summary with succeeded/failed volume details. Results are saved to **Transfer History**.

---

## Security Model

- **No Passphrase Disk Storage**: SSH key passphrases are requested via modal and stored exclusively in a Rust `SessionRegistry` memory hashmap during application runtime. They are cleared when sessions terminate and never saved to SQLite.
- **Safe Command Formatting**: Volume and container names are sanitized via `util::shell_escape` to eliminate remote shell injection risks.
- **Isolated Helper Containers**: Docker transfers mount volumes into ephemeral scratch containers (`dvt_src_*` as `:ro`, `dvt_dst_*` as `:rw`). Cleanup runs unconditionally on finish or abort.
- **Strict Tauri Capabilities**: Tauri v2 capability ACLs (`src-tauri/capabilities/default.json`) grant only minimal needed permissions (`core:default`, `dialog:default`, `dialog:allow-open`).

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
