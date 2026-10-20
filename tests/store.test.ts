import test from "node:test";
import assert from "node:assert/strict";
import { useAppStore } from "../src/store.ts";
import type { Server, Volume, TransferEvent } from "../src/types.ts";

test("useAppStore initial state", () => {
  useAppStore.getState().reset();
  const state = useAppStore.getState();

  assert.equal(state.step, 1);
  assert.equal(state.sourceServer, null);
  assert.equal(state.destServer, null);
  assert.deepEqual(state.volumes, []);
  assert.deepEqual(state.selectedVolumes, []);
  assert.equal(state.transferEvents.size, 0);
  assert.equal(state.transferSummary, null);
  assert.equal(state.showHistory, false);
});

test("useAppStore step navigation", () => {
  const store = useAppStore.getState();
  store.setStep(2);
  assert.equal(useAppStore.getState().step, 2);
  store.setStep(3);
  assert.equal(useAppStore.getState().step, 3);
  store.setStep(4);
  assert.equal(useAppStore.getState().step, 4);
  store.setStep(5);
  assert.equal(useAppStore.getState().step, 5);
});

test("useAppStore server state", () => {
  const dummyServer: Server = {
    id: 1,
    name: "prod-server",
    host: "192.168.1.10",
    username: "ubuntu",
    port: 22,
    ssh_key_path: "/home/user/.ssh/id_rsa",
    host_key_fingerprint: "SHA256:abc123xyz",
  };

  const store = useAppStore.getState();
  store.setServers([dummyServer]);
  assert.deepEqual(useAppStore.getState().servers, [dummyServer]);

  store.setSourceServer(dummyServer);
  assert.deepEqual(useAppStore.getState().sourceServer, dummyServer);

  const destServer: Server = {
    id: 2,
    name: "backup-server",
    host: "192.168.1.20",
    username: "ubuntu",
    port: 22,
    ssh_key_path: "/home/user/.ssh/id_rsa",
    host_key_fingerprint: "SHA256:def456xyz",
  };

  store.setDestServer(destServer);
  assert.deepEqual(useAppStore.getState().destServer, destServer);

  // Ensure no passphrase property on server
  assert.equal("passphrase" in dummyServer, false);
});

test("useAppStore volume toggling and manipulation", () => {
  useAppStore.getState().reset();
  const store = useAppStore.getState();

  const vol1: Volume = { name: "db_data", driver: "local", in_use: true };
  const vol2: Volume = { name: "web_assets", driver: "local", in_use: false };

  store.setVolumes([vol1, vol2]);
  assert.equal(useAppStore.getState().volumes.length, 2);

  // Toggle vol1 on
  store.toggleVolume(vol1);
  assert.deepEqual(useAppStore.getState().selectedVolumes, [
    { name: "db_data", size_bytes: 0, action: "transfer" },
  ]);

  // Update size
  store.updateVolumeSize("db_data", 1048576);
  assert.deepEqual(useAppStore.getState().selectedVolumes, [
    { name: "db_data", size_bytes: 1048576, action: "transfer" },
  ]);

  // Update action
  store.updateVolumeAction("db_data", "overwrite");
  assert.deepEqual(useAppStore.getState().selectedVolumes, [
    { name: "db_data", size_bytes: 1048576, action: "overwrite" },
  ]);

  // Toggle vol1 off
  store.toggleVolume(vol1);
  assert.deepEqual(useAppStore.getState().selectedVolumes, []);

  // Select all volumes
  store.selectAllVolumes();
  assert.equal(useAppStore.getState().selectedVolumes.length, 2);
  assert.equal(useAppStore.getState().selectedVolumes[0].name, "db_data");
  assert.equal(useAppStore.getState().selectedVolumes[1].name, "web_assets");

  // Select all volumes again when all selected -> deselects all
  store.selectAllVolumes();
  assert.deepEqual(useAppStore.getState().selectedVolumes, []);
});

test("useAppStore transfer events and summary", () => {
  useAppStore.getState().reset();
  const store = useAppStore.getState();

  const event1: TransferEvent = {
    volume_name: "db_data",
    status: "in_progress",
    bytes_transferred: 5000,
    total_bytes: 10000,
    speed_bps: 1024,
  };

  store.setTransferEvent("db_data", event1);
  const events = useAppStore.getState().transferEvents;
  assert.equal(events.size, 1);
  assert.deepEqual(events.get("db_data"), event1);

  const summary = {
    volumes: [
      {
        name: "db_data",
        size_bytes: 10000,
        duration_seconds: 5,
        status: "complete",
        error: null,
      },
    ],
    total_bytes: 10000,
    duration_seconds: 5,
  };

  store.setTransferSummary(summary);
  assert.deepEqual(useAppStore.getState().transferSummary, summary);
});

test("useAppStore history toggle and reset", () => {
  const store = useAppStore.getState();
  store.setShowHistory(true);
  assert.equal(useAppStore.getState().showHistory, true);

  store.setStep(4);
  assert.equal(useAppStore.getState().step, 4);

  store.reset();
  const resetState = useAppStore.getState();
  assert.equal(resetState.step, 1);
  assert.equal(resetState.showHistory, false);
  assert.equal(resetState.sourceServer, null);
  assert.equal(resetState.destServer, null);
  assert.deepEqual(resetState.selectedVolumes, []);
  assert.equal(resetState.transferEvents.size, 0);
  assert.equal(resetState.transferSummary, null);
});

test("beginTransfer succeeds once until transfer ends", () => {
  useAppStore.getState().reset();
  assert.equal(useAppStore.getState().beginTransfer(), true);
  assert.equal(useAppStore.getState().transferActive, true);
  assert.equal(useAppStore.getState().beginTransfer(), false);
  useAppStore.getState().setTransferActive(false);
  assert.equal(useAppStore.getState().beginTransfer(), true);
  useAppStore.getState().reset();
});
