# Docker Volume Transfer — Design Document

## Intent & Why

Server migration is a recurring pain point. Docker volumes hold persistent data (databases, configs, uploads) that must move intact when migrating apps between servers. Current workflow is manual: SSH in, tar the volume, scp it, extract on the other side. Error-prone, tedious, no visibility into progress.

This tool makes it a guided, visual, repeatable process.

## Goals

- **One-click volume transfer** between any two servers via SSH
- **Saved server connections** — configure once, reuse forever
- **Guided wizard flow** — hard to mess up, clear at every step
- **Real-time progress** — per-volume and overall, with speed and ETA
- **Conflict handling** — prompt user per volume when name exists on destination (overwrite or skip)
- **Transfer history** — searchable log of past transfers
- **Completion summary** — what moved, sizes, time taken

## Non-Goals

- No Docker Compose or container migration (volumes only)
- No scheduling or automation (manual transfers only)
- No cloud provider APIs (SSH only)
- No volume content inspection or editing

## Anti-Goals (would make this a failure)

- Silently overwriting existing volumes on destination
- Losing data during transfer with no indication
- Requiring CLI knowledge to operate
- Storing SSH credentials insecurely
- Corrupting destination volumes via partial overwrites (merging files instead of replacing)
- Tarring actively-written volumes without warning

## Constraints

- **Platform:** Linux, Ubuntu 24 primary target
- **Auth:** SSH keys with passphrase (no password auth)
- **Prerequisites:** Docker installed on both source and destination servers; `alpine` image available (pre-pulled if missing)
- **Desktop only:** Not a web app, not a CLI

## Architecture

### Tech Stack

- **Framework:** Tauri v2 (Rust backend + web frontend via system WebKitGTK)
- **Frontend:** React + TypeScript
- **Styling:** Tailwind CSS
- **Backend (Rust):**
  - `russh` — SSH connections, key auth with passphrase
  - `sqlx` + SQLite — server configs, transfer history
  - `tokio` — async runtime
  - `serde` — serialization

### SSH Session Management

SSH sessions are established once per server selection (when user enters passphrase) and held in-memory in the Rust backend as a session registry (`Mutex<HashMap<ServerRole, Arc<SshSession>>>`). All subsequent commands (list volumes, get sizes, check conflicts, transfer) open lightweight SSH channels on the existing connection. No passphrase is passed over IPC after initial connection. Sessions are dropped on wizard reset or app close.

During `connect_server`, after SSH authentication: verify Docker daemon is available (`docker info`), then pre-warm `alpine:latest` image. This ensures all saved servers fail fast if Docker is missing or stopped.

### How Volume Transfer Works

1. SSH into source server (passphrase prompted at server selection, session cached; passphrase cached in Rust `SessionRegistry` for same-key reuse — never returned to frontend)
2. Pre-warm: ensure `alpine:latest` is cached on the host (`docker image inspect alpine:latest >/dev/null 2>&1 || docker pull -q alpine:latest`) — runs during `connect_server`, before any `docker run` commands
3. List volumes via `docker volume ls --format '{{json .}}'` (returns name, driver, scope)
4. Determine in-use status: single `docker ps --format '{{json .}}'` command, match mounted volumes across all running containers (not per-volume N+1 loop)
5. User selects volumes; fetch size per selected volume via `docker run --rm -v '<vol>':/data alpine du -sb /data` (exact bytes, single volume)
6. SSH into destination server (passphrase prompted; if same SSH key path as source, Rust backend reuses cached passphrase internally — no IPC round-trip)
7. Pre-warm `alpine:latest` on destination (same as step 2)
8. Check for conflicts: batch `docker volume inspect <name1> <name2> ...` on destination — returns which exist and their sizes
9. Per volume transfer:
   - Source: `docker run --rm --name dvt_src_<uuid> -v '<volume_name>':/data alpine tar cf - -C /data .` (uncompressed — enables exact byte-for-byte progress tracking)
   - Stream tar bytes over SSH channel (stdout only; stderr isolated)
   - Destination (overwrite): `docker run --rm --name dvt_dst_<uuid> -i -v '<volume_name>':/data alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* && tar xf - -C /data'`
   - Destination (new): `docker run --rm --name dvt_dst_<uuid> -i -v '<volume_name>':/data alpine tar xf - -C /data`
10. SSH channel lifecycle per volume:
    a. Stream `ChannelMsg::Data` chunks from `src_channel` into `dest_channel.data()`
    b. On `src_channel` EOF, await `ChannelMsg::ExitStatus` from `src_channel` — verify `exit_status == 0` (if non-zero, abort, collect stderr)
    c. Call `dest_channel.eof().await` to signal end-of-input to destination `tar xf -`
    d. Await `ChannelMsg::ExitStatus` from `dest_channel` — verify `exit_status == 0` before marking Complete
11. Report progress: `bytes_transferred / total_bytes` (both uncompressed). UI clamps display to `min(99%, calculated)` while InProgress; shows 100% only on Complete status (avoids >100% on small volumes where tar overhead exceeds `du -sb` size)
12. On cancel or network error: issue `docker rm -f dvt_src_<uuid> dvt_dst_<uuid>` over a control channel to clean up orphaned containers

### Data Storage

- **Server configs:** SQLite database in `~/.config/docker-volume-transfer/`
  - name, host, username, port, SSH key path, host_key_fingerprint (nullable — populated on first connect, verified on subsequent)
  - passphrase: never stored. Prompted on each server connection.
- **Transfer history:** Same SQLite database
  - source_server_name, dest_server_name (denormalized strings — survives server deletion), volume_names (JSON array), total_size_bytes, started_at, completed_at, duration_seconds, status

## UI Flow

### Wizard Steps

**Step 1 — Select Source Server**
- Grid of saved server cards
- Each card: name, host/IP, username, port, online/offline status (green/red dot via TCP ping on port — no passphrase needed)
- "+ Add Server" card opens modal
- Offline servers shown but not selectable
- Click to select → passphrase prompt → connect → Next

**Step 2 — Select Volumes**
- Header shows connected server name and IP, volume count
- Volume list with checkboxes: name, driver
- In-use volumes marked with warning badge ("Attached to running container — backup may be inconsistent")
- Size fetched per volume when selected (via `du -sb` in container, not `docker system df`)
- "Select All" link, selected count and total size
- Back / Next buttons

**Step 3 — Select Destination Server**
- Same card grid as Step 1
- Source server greyed out / disabled
- Offline servers disabled
- Click to select → passphrase prompt (skipped if same SSH key as source, reuse cached passphrase) → connect
- Transfer summary panel: source → destination names, volume count, total size
- Back / Start Transfer button

**Conflict Resolution (between Step 3 and 4)**
- Batch check which selected volumes exist on destination (single SSH command returning names + sizes)
- Modal per conflicting volume: "Volume `postgres_data` already exists on destination (1.8 GB). Incoming: 2.3 GB. Overwrite or Skip?"
- Two buttons: Overwrite, Skip
- Shows existing size vs incoming size

**Pre-flight (between conflict resolution and transfer)**
- Verify Docker is still responsive on both hosts (already checked during `connect_server`)
- Show spinner: "Preparing transfer environment..."

**Step 4 — Transfer Progress**
- Per-volume progress cards:
  - Complete: green checkmark, 100% bar, size, duration
  - In progress: spinner, percentage, bytes transferred, speed (MB/s), ETA
  - Pending: greyed out, "Waiting"
  - Failed: red, error message
  - Skipped: grey, "Skipped"
- Overall progress bar with fraction and ETA
- Cancel Transfer button (confirms before cancelling; kills remote containers)

**Step 5 — Completion Summary**
- List of transferred volumes with sizes and individual durations
- Total size, total time
- Any skipped volumes noted
- Any failures noted with error message
- "New Transfer" button → back to Step 1
- "View History" link

### Server Management

**Add Server Modal**
- Fields: Server Name, Host/IP, Username, Port (default 22), SSH Key path (with Browse button)
- "Test & Save" button — prompts passphrase, tests SSH connection, verifies Docker is available (`docker info`), saves server + host key fingerprint
- "Cancel" button

**Edit/Delete**
- Edit and delete accessible from server cards (context menu or icons)
- Delete confirms before removing
- Deleting a server does not affect transfer history (history stores server names, not IDs)
- Editing a server's host or port clears stored `host_key_fingerprint` (new host = new key expected)

### Transfer History

- Accessible from main screen (icon/tab)
- Table/list: date, source → destination, volume names, total size, duration, status
- Filterable by server, status
- Sortable by date

## Security

- SSH key passphrase: never stored on disk, never passed over IPC after initial connection. Held in Rust `SessionRegistry` memory only for session duration. Frontend never caches or re-sends passphrases.
- Two passphrase prompts per transfer (source + destination); if same SSH key path, Rust backend reuses cached passphrase internally without frontend involvement
- SSH host key verification: trust on first use (TOFU). Fingerprint stored in `servers` table. On subsequent connects, verify against stored fingerprint. Warn and block if changed (possible MITM).

## Left to Builder

- Exact React component structure and state management (Context, Zustand, etc.)
- Tailwind theme specifics beyond the dark theme shown in mockups
- Error handling UX details (connection timeout, Docker not found on server, permission denied)
- Exact SQLite schema
- AppImage for first release
- SSH host key fingerprint format and comparison method
