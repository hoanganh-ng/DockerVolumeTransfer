import test from "node:test";
import assert from "node:assert/strict";
import { useAppStore } from "../src/store.ts";
import {
  formatBytes,
  calculateTotalSize,
  isSameSshKey,
  resolveConflictActions,
} from "../src/components/wizard/wizardUtils.ts";
import type { Server, Volume, DestVolumeInfo } from "../src/types.ts";

test("wizard selection flow from step 1 to step 4", () => {
  useAppStore.getState().reset();
  const store = useAppStore.getState();

  const sourceServer: Server = {
    id: 1,
    name: "source-prod",
    host: "10.0.0.1",
    username: "admin",
    port: 22,
    ssh_key_path: "/keys/id_rsa",
    host_key_fingerprint: "SHA256:source",
  };

  const destServer: Server = {
    id: 2,
    name: "dest-backup",
    host: "10.0.0.2",
    username: "admin",
    port: 22,
    ssh_key_path: "/keys/id_rsa", // same ssh key
    host_key_fingerprint: "SHA256:dest",
  };

  // Step 1: Select Source Server
  assert.equal(useAppStore.getState().step, 1);
  store.setSourceServer(sourceServer);
  store.setStep(2);
  assert.equal(useAppStore.getState().sourceServer?.name, "source-prod");
  assert.equal(useAppStore.getState().step, 2);

  // Step 2: Select Volumes
  const dummyVolumes: Volume[] = [
    { name: "mysql_data", driver: "local", in_use: true },
    { name: "redis_data", driver: "local", in_use: false },
    { name: "logs_vol", driver: "local", in_use: false },
  ];
  store.setVolumes(dummyVolumes);

  // Select mysql_data and redis_data
  store.toggleVolume(dummyVolumes[0]);
  store.toggleVolume(dummyVolumes[1]);
  assert.equal(useAppStore.getState().selectedVolumes.length, 2);

  // Update sizes as fetched
  store.updateVolumeSize("mysql_data", 524288000); // ~500 MB
  store.updateVolumeSize("redis_data", 52428800); // ~50 MB

  const totalBytes = calculateTotalSize(useAppStore.getState().selectedVolumes);
  assert.equal(totalBytes, 576716800);
  assert.equal(formatBytes(totalBytes), "550.0 MB");

  // Advance to Step 3: Select Destination
  store.setStep(3);
  assert.equal(useAppStore.getState().step, 3);

  // Destination uses same key optimization
  assert.equal(isSameSshKey(sourceServer, destServer), true);
  store.setDestServer(destServer);

  // Destination check finds conflict on "mysql_data"
  const conflicts: DestVolumeInfo = {
    mysql_data: 400000000,
  };

  // Overwrite conflict resolution
  const resolved = resolveConflictActions(
    useAppStore.getState().selectedVolumes,
    conflicts,
    "overwrite"
  );
  store.setSelectedVolumes(resolved);

  const updatedVolumes = useAppStore.getState().selectedVolumes;
  assert.equal(updatedVolumes.find((v) => v.name === "mysql_data")?.action, "overwrite");
  assert.equal(updatedVolumes.find((v) => v.name === "redis_data")?.action, "transfer");

  // Advance to Step 4
  store.setStep(4);
  assert.equal(useAppStore.getState().step, 4);
});

test("formatBytes edge cases", () => {
  assert.equal(formatBytes(-10), "0 B");
  assert.equal(formatBytes(NaN), "0 B");
  assert.equal(formatBytes(1), "1 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1099511627776), "1.0 TB");
});
