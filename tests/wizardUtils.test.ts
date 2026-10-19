import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBytes,
  calculateTotalSize,
  isSameSshKey,
  resolveConflictActions,
} from "../src/components/wizard/wizardUtils.ts";
import type { TransferVolume, DestVolumeInfo } from "../src/types.ts";

test("formatBytes formats byte numbers to readable strings", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(1073741824), "1.0 GB");
  assert.equal(formatBytes(2684354560), "2.5 GB");
});

test("calculateTotalSize sums sizes of all volumes", () => {
  const volumes = [
    { name: "v1", size_bytes: 1000 },
    { name: "v2", size_bytes: 2500 },
    { name: "v3" }, // missing size_bytes
  ];
  assert.equal(calculateTotalSize(volumes), 3500);
  assert.equal(calculateTotalSize([]), 0);
});

test("isSameSshKey checks whether two servers share identical key paths", () => {
  const server1 = { ssh_key_path: "/home/user/.ssh/id_rsa" };
  const server2 = { ssh_key_path: "/home/user/.ssh/id_rsa" };
  const server3 = { ssh_key_path: "/home/user/.ssh/id_ed25519" };

  assert.equal(isSameSshKey(server1, server2), true);
  assert.equal(isSameSshKey(server1, server3), false);
  assert.equal(isSameSshKey(server1, null), false);
  assert.equal(isSameSshKey(null, server2), false);
  assert.equal(isSameSshKey(null, null), false);
});

test("resolveConflictActions marks conflicting volumes with chosen action", () => {
  const volumes: TransferVolume[] = [
    { name: "vol1", size_bytes: 100, action: "transfer" },
    { name: "vol2", size_bytes: 200, action: "transfer" },
    { name: "vol3", size_bytes: 300, action: "transfer" },
  ];

  const conflicts: DestVolumeInfo = {
    vol2: 150,
  };

  const overwriteResolved = resolveConflictActions(volumes, conflicts, "overwrite");
  assert.deepEqual(overwriteResolved, [
    { name: "vol1", size_bytes: 100, action: "transfer" },
    { name: "vol2", size_bytes: 200, action: "overwrite" },
    { name: "vol3", size_bytes: 300, action: "transfer" },
  ]);

  const skipResolved = resolveConflictActions(volumes, conflicts, "skip");
  assert.deepEqual(skipResolved, [
    { name: "vol1", size_bytes: 100, action: "transfer" },
    { name: "vol2", size_bytes: 200, action: "skip" },
    { name: "vol3", size_bytes: 300, action: "transfer" },
  ]);
});
