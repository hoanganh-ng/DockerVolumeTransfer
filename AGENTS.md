# AGENTS.md — Developer & AI Agent Guidelines

This document provides operational context, invariants, coding conventions, and verification workflows for agents (AI or human) working on the **Docker Volume Transfer** codebase.

---

## 1. System & Environment Setup

When executing cargo or build commands in environments where dev libraries are isolated (e.g. without root access):

```bash
export PATH="$HOME/.cargo/bin:$PATH"
export PKG_CONFIG_PATH="/tmp/local-dev/usr/lib/x86_64-linux-gnu/pkgconfig:/tmp/local-dev/usr/share/pkgconfig:$PKG_CONFIG_PATH"
export RUSTFLAGS="-L /tmp/local-dev/usr/lib/x86_64-linux-gnu"
```

Verify build dependencies:
- Node.js 18+ (`node -v`, `npm -v`)
- Rust 1.77+ (`cargo --version`, `rustc --version`)

---

## 2. Architecture & File Layout

```
.
├── src/                               # Frontend (React 18 + TypeScript + Tailwind)
│   ├── App.tsx                        # Main application shell & top-level view router
│   ├── store.ts                       # Zustand central application state store
│   ├── types.ts                       # TypeScript interfaces matching backend models & IPC events
│   ├── components/
│   │   ├── servers/                   # Server management (Cards, Add/Edit modal, Passphrase modal)
│   │   ├── wizard/                    # 4-Step migration wizard (Source, Volumes, Dest, Progress)
│   │   └── history/                   # Transfer history audit view & filtering
│   └── utils/                         # Helper utilities (formatting, date, validation)
├── src-tauri/                         # Backend (Rust 2021 + Tauri v2)
│   ├── src/
│   │   ├── main.rs                    # Tauri entrypoint, plugin initialization, IPC handler registration
│   │   ├── db.rs                      # SQLite connection, schema creation, server & history CRUD
│   │   ├── ssh.rs                     # Russh client implementation, SessionRegistry, TOFU host keys
│   │   ├── models.rs                  # Data structs (Server, VolumeInfo, TransferRequest, etc.)
│   │   ├── util.rs                    # Safe shell escaping and helper utilities
│   │   └── commands/
│   │       ├── server.rs              # Server CRUD & connectivity test commands
│   │       ├── volume.rs              # Volume listing, size inspection, Docker readiness checks
│   │       └── transfer.rs            # Streaming engine, container management, progress emitter
│   ├── capabilities/
│   │   └── default.json               # Tauri v2 capability configuration (ACL permissions)
│   ├── tauri.conf.json                # Tauri v2 desktop window & bundle configuration
│   └── Cargo.toml                     # Rust backend dependencies
└── tests/                             # Frontend unit tests executed via Node test runner
```

---

## 3. Critical Security & Engineering Invariants

### 1. SSH Passphrase Ephemeral Lifecycle
- **NEVER** write SSH passphrases to SQLite, configuration files, disk, logs, or local storage.
- Passphrases must reside exclusively in Rust volatile memory (`ssh::SessionRegistry`) for the active session duration.
- Frontend state (`src/store.ts`, `src/types.ts`) must never store or retain private key passphrases. Passphrases are passed directly from `PassphraseModal` into the backend `connect_server` invocation.

### 2. Shell Injection Immunity
- **NEVER** concatenate unsanitized user inputs or remote identifiers directly into remote SSH shell strings.
- Always wrap volume names, container names, and paths with `util::shell_escape()`.
- Container names must strictly follow the deterministic format: `dvt_src_<uuid>_<idx>` and `dvt_dst_<uuid>_<idx>`.

### 3. Container Cleanup Guarantee
- Transfer containers must always be removed with `docker rm -f <container_name>` upon completion, cancellation, or error.
- Cleanup calls must execute in both the happy path and early error exit blocks.

### 4. Tar Streaming Pipeline
- Volume transfers stream directly from the source host's helper container (`tar cf -`) into the destination host's helper container (`tar xf -`) over SSH channels.
- Never write intermediate archive files to the local desktop disk.
- Archives must be uncompressed `tar` to maintain accurate 1:1 byte-counter progress against pre-calculated volume sizes (`du -sb`).

### 5. Tauri v2 Capability System
- Any new Tauri plugin (e.g. `dialog`, `fs`) requires its permissions declared in `src-tauri/capabilities/default.json`.
- The main window is labeled `"main"` in `tauri.conf.json` and must match `"windows": ["main"]` in capability definitions.

---

## 4. Verification Workflow

Always verify both frontend and backend before committing any changes:

```bash
# 1. Run frontend test suite (41 tests)
npm test

# 2. Run TypeScript check & Vite production build
npm run build

# 3. Run backend Rust unit & integration test suite (23 tests)
cargo test -p docker-volume-transfer

# 4. (Optional / Pre-release) Build AppImage bundle
npx tauri build --bundles appimage -c '{"bundle":{"active":true,"icon":["icons/32x32.png","icons/128x128.png","icons/128x128@2x.png","icons/icon.icns","icons/icon.ico"]}}'
```

---

## 5. Coding Conventions

- **Frontend**:
  - React 18 functional components with strict TypeScript types.
  - Tailwind utility classes conforming to dark theme palette (`bg-slate-900`, `border-slate-700`, `text-slate-100`).
  - Icons sourced from `lucide-react`.
  - State transitions handled through actions in `useAppStore`.
- **Backend**:
  - Pure Rust async operations driven by `tokio`.
  - Error handling using standard `Result<T, String>` across Tauri `#[tauri::command]` boundaries.
  - SQL queries parameterized using `sqlx::query!`, `sqlx::query()`, or `sqlx::query_as()`.
