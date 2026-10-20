# Transfer Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make volume transfers actually succeed, then fix the reliability and UX issues found in review of the uncommitted transfer changes.

**Architecture:** Root cause is in `run_transfer`'s exit-status collection: the destination channel's queued `Success` / `WindowAdjusted` messages hit a catch-all `_ => break` before `ExitStatus` arrives, so every volume is reported as "exited with code 1". Fix by extracting one pure message-folding function used by both exit-wait loops. Remaining tasks harden pre-flight error reporting, the in-progress flag, completion ordering, the frontend start guard, cancellation, and debug logging.

**Tech Stack:** Rust 2021, Tauri v2, russh 0.45, tokio; React 18 + TypeScript + Zustand; Node test runner.

## Global Constraints

- Container names stay `dvt_src_<uuid>_<idx>` / `dvt_dst_<uuid>_<idx>`; volume names always via `util::shell_escape()`.
- Containers removed with `docker rm -f` on every exit path (happy, cancel, error).
- Tar stays uncompressed, streamed host-to-host; no local temp files.
- Never log or persist SSH passphrases.
- Tauri command errors are `Result<T, String>`.
- Verify before every commit (env from AGENTS.md §1):
  ```bash
  export PATH="$HOME/.cargo/bin:$PATH"
  export PKG_CONFIG_PATH="/tmp/local-dev/usr/lib/x86_64-linux-gnu/pkgconfig:/tmp/local-dev/usr/share/pkgconfig:$PKG_CONFIG_PATH"
  export RUSTFLAGS="-L /tmp/local-dev/usr/lib/x86_64-linux-gnu"
  npm test && npm run build && (cd src-tauri && cargo test -p docker-volume-transfer)
  ```

## Background: why transfers never succeed

russh 0.45 delivers every channel event into an unbounded per-channel queue (`Channel::wait()`), including `ChannelMsg::Success` (reply to `exec(true, ..)`) and `ChannelMsg::WindowAdjusted` (each time the server grants more window while we send tar data). Nobody reads `dest_channel` while streaming, so by Stage 4 its queue starts with `Success, WindowAdjusted, WindowAdjusted, ...`. Stage 4's `_ => break` exits on the first one, `dest_exit_status` stays `None`, `unwrap_or(1)` turns it into exit code 1, and the volume is marked failed with `Destination container exited with code 1` — even when the destination `tar` succeeded. This code is identical in commit `26b6e79`, so it has failed every transfer since it was written.

Side effect: destination data may actually have landed. Check the destination volume after the next failed attempt to confirm.

---

### Task 1: Fix exit-status collection (root cause)

**Files:**
- Modify: `src-tauri/src/commands/transfer.rs` (new fn after `compute_overall_status`, ~line 106; Stage 2 loop ~484-498; Stage 4 loop ~533-551; tests module ~720)

**Interfaces:**
- Produces: `pub fn absorb_exit_msg(msg: &russh::ChannelMsg, exit_status: &mut Option<u32>, stderr: &mut String) -> bool` — folds one message into state; returns `true` when waiting must stop (channel closed).

- [ ] **Step 1: Write the failing tests** (append inside `mod tests`)

```rust
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd src-tauri && cargo test -p docker-volume-transfer absorb_exit_msg`
Expected: compile error `cannot find function `absorb_exit_msg``.

- [ ] **Step 3: Implement** (insert after `compute_overall_status`)

```rust
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
```

Replace the Stage 2 loop body with:

```rust
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
```

Replace the Stage 4 loop body with:

```rust
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
```

- [ ] **Step 4: Run full verification** (Global Constraints command). Expected: 41 frontend + 27 Rust tests pass, build OK.

- [ ] **Step 5: Manual smoke test on real hosts (user runs)**

On the source host, create a throwaway volume:
```bash
docker volume create dvt_smoke
docker run --rm -v dvt_smoke:/d alpine sh -c 'echo hello > /d/a.txt; mkdir /d/sub; head -c 5000000 /dev/urandom > /d/sub/blob'
```
Run `npx tauri dev`, transfer `dvt_smoke` (action: transfer). Expected: volume card `complete`, history row `success`. On destination:
```bash
docker run --rm -v dvt_smoke:/d alpine sh -c 'cat /d/a.txt; ls -l /d/sub'
```
Expected: `hello` and a 5000000-byte `blob`. If it fails, capture the `[DVT]` terminal lines and the error on the Complete screen before continuing.

- [ ] **Step 6: Commit** (includes the existing uncommitted working-tree changes this fix builds on)

```bash
git add src-tauri/src/commands/transfer.rs src-tauri/src/main.rs src-tauri/src/ssh.rs src/App.tsx src/components/wizard/TransferProgress.tsx src/store.ts docs/superpowers/plans/2026-10-20-transfer-fixes.md
git commit -m "fix: read destination exit status past queued Success/WindowAdjusted messages"
```

---

### Task 2: Panic-safe in-progress guard

**Files:**
- Modify: `src-tauri/src/commands/transfer.rs` (`TransferInProgress` ~line 12; `run_transfer` params ~146 and final `store(false)` ~617; pre-flight `store(false)` calls ~170/184; `start_transfer` ~645-680; tests)

**Interfaces:**
- Produces: `pub struct InProgressGuard` with `pub fn acquire(flag: &TransferInProgress) -> Option<InProgressGuard>`; `Drop` clears the flag. `run_transfer` takes `_guard: InProgressGuard` instead of `transfer_in_progress: TransferInProgress`.

- [ ] **Step 1: Write the failing tests** (in `mod tests`)

```rust
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
```

- [ ] **Step 2: Run, verify fail** — `cargo test -p docker-volume-transfer in_progress_guard`. Expected: `cannot find type `InProgressGuard``.

- [ ] **Step 3: Implement** (below `impl TransferInProgress`)

```rust
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
```

In `run_transfer`: change parameter `transfer_in_progress: TransferInProgress,` to `_guard: InProgressGuard,` and delete all three `transfer_in_progress.0.store(false, Ordering::SeqCst);` lines (two in pre-flight, one after `transfer-complete`). Keep the name `_guard` (not `_`) so it lives until the function returns.

In `start_transfer`, replace the swap check and both session lookups with:

```rust
    let guard = InProgressGuard::acquire(transfer_in_progress.inner())
        .ok_or_else(|| "A transfer is already in progress".to_string())?;

    let src_session = registry
        .get("source")
        .ok_or_else(|| "No active SSH session for role: source".to_string())?;
    let dst_session = registry
        .get("destination")
        .ok_or_else(|| "No active SSH session for role: destination".to_string())?;
```

Delete `let in_progress = transfer_in_progress.inner().clone();` and pass `guard` in its place to `run_transfer(...)`.

- [ ] **Step 4: Run full verification.** Expected: all pass (29 Rust tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/transfer.rs
git commit -m "fix: release transfer in-progress flag via drop guard"
```

---

### Task 3: Surface pre-flight failures as command errors

**Files:**
- Modify: `src-tauri/src/commands/transfer.rs` (remove pre-flight block in `run_transfer` ~157-186; add check in `start_transfer` after session lookups; new helper + test)

**Interfaces:**
- Consumes: `InProgressGuard` (Task 2) — early `?` returns drop it and clear the flag.
- Produces: `pub fn needs_helper_image(volumes: &[TransferVolume]) -> bool`.

- [ ] **Step 1: Write failing test**

```rust
    #[test]
    fn test_needs_helper_image() {
        let vol = |action: &str| TransferVolume {
            name: "v".to_string(),
            size_bytes: 1,
            action: action.to_string(),
        };
        assert!(!needs_helper_image(&[]));
        assert!(!needs_helper_image(&[vol("skip"), vol("skip")]));
        assert!(needs_helper_image(&[vol("skip"), vol("overwrite")]));
        assert!(needs_helper_image(&[vol("transfer")]));
    }
```

- [ ] **Step 2: Run, verify fail** — `cargo test -p docker-volume-transfer needs_helper_image`. Expected: `cannot find function`.

- [ ] **Step 3: Implement**

Add next to `ensure_alpine_image`:

```rust
/// True when at least one volume will run helper containers.
pub fn needs_helper_image(volumes: &[TransferVolume]) -> bool {
    volumes.iter().any(|v| v.action != "skip")
}
```

Delete the whole `// Pre-flight: ensure alpine image ...` block from `run_transfer` (from the first `eprintln!("[DVT] Pre-flight...` through `eprintln!("[DVT] Pre-flight: alpine image OK on both hosts");`).

In `start_transfer`, after the session lookups and before `cancel_token.reset();`:

```rust
    // Pre-flight: pull the helper image up front so failures reach the UI as an error
    if needs_helper_image(&volumes) {
        ensure_alpine_image(&src_session, "Source").await?;
        ensure_alpine_image(&dst_session, "Destination").await?;
    }
```

The existing `TransferProgress` catch block shows this string via `setError`.

- [ ] **Step 4: Run full verification.** Expected: all pass.

- [ ] **Step 5: Manual check** — temporarily rename on one host: `docker tag alpine:latest alpine:keep && docker rmi alpine:latest`, block registry access (or skip if impractical), start a transfer. Expected: red error banner with `... host: alpine image not available and pull failed: ...`, and a second Start works afterwards. Restore with `docker tag alpine:keep alpine:latest`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/transfer.rs
git commit -m "fix: report alpine pre-flight failures from start_transfer"
```

---

### Task 4: Save history before emitting completion

**Files:**
- Modify: `src-tauri/src/commands/transfer.rs` (end of `run_transfer`, ~607-631)

- [ ] **Step 1: Reorder.** Replace the tail of `run_transfer` (from `let total_duration = ...` to the function's closing brace) with:

```rust
    let total_duration = start_time.elapsed().as_secs();
    let overall_status = compute_overall_status(&results);
    let volume_names: Vec<String> = results.iter().map(|r| r.name.clone()).collect();
    // Persist first so History is up to date when the UI reacts to transfer-complete
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

    let summary = TransferSummary {
        volumes: results,
        total_bytes: total_transferred,
        duration_seconds: total_duration,
    };
    let _ = app_handle.emit("transfer-complete", &summary);
}
```

(`results.clone()` is no longer needed; `_guard` drops after the emit.)

- [ ] **Step 2: Run full verification.** Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/transfer.rs
git commit -m "fix: persist transfer history before emitting transfer-complete"
```

---

### Task 5: Store-level start guard (StrictMode double start)

**Files:**
- Modify: `src/store.ts` (interface ~43, actions ~158)
- Modify: `src/components/wizard/TransferProgress.tsx` (store destructure ~12-20, start effect ~25-54)
- Test: `tests/store.test.ts`

**Interfaces:**
- Produces: `beginTransfer: () => boolean` on `AppState` — sets `transferActive` true and returns true only if it was false.

- [ ] **Step 1: Write failing test** (append to `tests/store.test.ts`)

```ts
test("beginTransfer succeeds once until transfer ends", () => {
  useAppStore.getState().reset();
  assert.equal(useAppStore.getState().beginTransfer(), true);
  assert.equal(useAppStore.getState().transferActive, true);
  assert.equal(useAppStore.getState().beginTransfer(), false);
  useAppStore.getState().setTransferActive(false);
  assert.equal(useAppStore.getState().beginTransfer(), true);
  useAppStore.getState().reset();
});
```

- [ ] **Step 2: Run, verify fail** — `npm test`. Expected: `TypeError: useAppStore.getState(...).beginTransfer is not a function`.

- [ ] **Step 3: Implement**

`src/store.ts` interface, after `setTransferActive`:
```ts
  beginTransfer: () => boolean;
```
Actions, after `setTransferActive`:
```ts
  beginTransfer: () => {
    if (get().transferActive) return false;
    set({ transferActive: true });
    return true;
  },
```

`TransferProgress.tsx`: add `beginTransfer` to the `useAppStore()` destructure, then replace the start effect with:

```tsx
  // Start transfer once. The store guard (not component state) survives
  // StrictMode's double effect run and navigating to History and back.
  useEffect(() => {
    if (!beginTransfer()) return;

    invoke("start_transfer", {
      sourceServerName: sourceServer?.name || "",
      source_server_name: sourceServer?.name || "",
      destServerName: destServer?.name || "",
      dest_server_name: destServer?.name || "",
      volumes: selectedVolumes,
    }).catch((err: unknown) => {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Failed to start volume transfer";
      setError(msg);
      setTransferActive(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only
```

(No `cancelled` flag: store updates are global and must happen even if this instance unmounted, otherwise a StrictMode re-run swallows real start errors and leaves `transferActive` stuck.)

- [ ] **Step 4: Run full verification.** Expected: 42 frontend tests pass, build OK.

- [ ] **Step 5: Manual check** — `npx tauri dev` (StrictMode active), start a transfer. Expected: no "A transfer is already in progress" banner; terminal shows one `[DVT] Volume ...` set per volume, not two.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/components/wizard/TransferProgress.tsx tests/store.test.ts
git commit -m "fix: guard transfer start in store to avoid StrictMode double invoke"
```

---

### Task 6: Restore cancel-responsive streaming loop

**Files:**
- Modify: `src-tauri/src/commands/transfer.rs` (Stage 1 loop, ~375-433)

Why: cancel currently relies on `cancel_transfer`'s `docker rm -f` closing the channel. If that SSH exec fails, the loop blocks in `src_channel.wait()` until data arrives. `mpsc::UnboundedReceiver::recv` is cancel-safe, so a `select!` with a tick loses no data.

- [ ] **Step 1: Wrap the match.** Replace

```rust
            match src_channel.wait().await {
```
with
```rust
            let msg = tokio::select! {
                msg = src_channel.wait() => msg,
                _ = tokio::time::sleep(Duration::from_millis(250)) => continue,
            };
            match msg {
```

The `continue` re-runs the `cancel_token.is_cancelled()` check at the loop top. All match arms stay unchanged.

- [ ] **Step 2: Run full verification.** Expected: all pass.

- [ ] **Step 3: Manual check** — transfer a large volume (e.g. `dvt_smoke` with `head -c 500000000 /dev/urandom`), click Cancel. Expected: card shows `cancelled` within ~1 s; `docker ps -a | grep dvt_` empty on both hosts.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/transfer.rs
git commit -m "fix: keep streaming loop responsive to cancellation"
```

---

### Task 7: Gate debug logging, trim user-facing errors

Do this last, after Task 1's smoke test passes — the logs are useful until then.

**Files:**
- Modify: `src-tauri/src/commands/transfer.rs`

- [ ] **Step 1: Add macro** at top of file, after the `use` lines:

```rust
/// Debug-build-only trace output; release builds stay quiet.
macro_rules! dvt_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DVT] {}", format_args!($($arg)*));
        }
    };
}
```

- [ ] **Step 2: Convert calls**

```bash
sed -i 's/eprintln!("\[DVT\] /dvt_debug!("/' src-tauri/src/commands/transfer.rs
grep -n 'eprintln!' src-tauri/src/commands/transfer.rs
```
Expected: only the one inside the macro remains.

- [ ] **Step 3: Remove commands from user-facing errors** (they are already logged by `dvt_debug!`):

- `format!("Failed to exec source command: {} | cmd: {}", e, src_cmd)` → `format!("Failed to exec source command: {}", e)`
- `format!("Failed to exec destination command: {} | cmd: {}", e, dst_cmd)` → `format!("Failed to exec destination command: {}", e)`
- `format!("Source container exited with code {} | cmd: {}", src_code, src_cmd)` → `format!("Source container exited with code {}", src_code)`
- `format!("Destination container exited with code {} | cmd: {}", dest_code, dst_cmd)` → `format!("Destination container exited with code {}", dest_code)`

Keep the `"{} (exit code {})"` stderr format.

- [ ] **Step 4: Run full verification**, plus `cd src-tauri && cargo build --release -p docker-volume-transfer` to confirm the macro compiles in release. Expected: no warnings about unused `src_cmd`/`dst_cmd` (both still used by `dvt_debug!`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/transfer.rs
git commit -m "chore: gate transfer debug logs to debug builds"
```

---

## Out of scope (noted, not planned)

- Destination channel not read during streaming: verified harmless — russh 0.45 uses an unbounded queue and tracks window via a shared mutex, so no deadlock.
- `TransferInProgress` has both `Default` and `new()`: matches `CancellationToken`; leave.
- `history` table has no per-volume error column, so failures can't be diagnosed after the fact. Worth a separate change.
