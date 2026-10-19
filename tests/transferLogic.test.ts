import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateClampedProgress,
  formatSpeed,
  formatDuration,
  formatEta,
  canContinueConflict,
  resolveConflicts,
  calculateOverallProgress,
  summarizeTransferResults,
} from "../src/components/transfer/transferUtils.ts";
import type { TransferVolume, TransferEvent, VolumeResult } from "../src/types.ts";

test("calculateClampedProgress clamps progress correctly", () => {
  // 0 total bytes guard
  assert.equal(calculateClampedProgress(0, 0, false), 0);
  assert.equal(calculateClampedProgress(100, 0, false), 0);

  // InProgress: should never reach 100%, max 99%
  assert.equal(calculateClampedProgress(0, 1000, false), 0);
  assert.equal(calculateClampedProgress(500, 1000, false), 50);
  assert.equal(calculateClampedProgress(990, 1000, false), 99);
  assert.equal(calculateClampedProgress(1000, 1000, false), 99); // clamped to 99
  assert.equal(calculateClampedProgress(1500, 1000, false), 99); // overflow still 99

  // Complete: returns 100%
  assert.equal(calculateClampedProgress(1000, 1000, true), 100);
  assert.equal(calculateClampedProgress(0, 0, true), 100);
});

test("formatSpeed formats bytes per second as MB/s", () => {
  assert.equal(formatSpeed(0), "0.0 MB/s");
  assert.equal(formatSpeed(1024 * 1024), "1.0 MB/s");
  assert.equal(formatSpeed(1024 * 1024 * 2.5), "2.5 MB/s");
  assert.equal(formatSpeed(5242880), "5.0 MB/s");
});

test("formatDuration formats seconds to readable string", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(60), "1m 00s");
  assert.equal(formatDuration(83), "1m 23s");
  assert.equal(formatDuration(3665), "1h 01m 05s");
});

test("formatEta formats remaining seconds based on speed", () => {
  assert.equal(formatEta(1000, 0), "--");
  assert.equal(formatEta(0, 1000), "0s");
  assert.equal(formatEta(5000000, 2500000), "2s");
});

test("canContinueConflict validates conflict decisions and all-skip guard", () => {
  const volumes: TransferVolume[] = [
    { name: "v1", size_bytes: 1000, action: "transfer" },
    { name: "v2", size_bytes: 2000, action: "transfer" },
  ];
  const conflictNames = ["v1", "v2"];

  // Incomplete decisions: v2 not decided
  const incompleteDecisions: Record<string, "overwrite" | "skip"> = {
    v1: "overwrite",
  };
  const check1 = canContinueConflict(volumes, conflictNames, incompleteDecisions);
  assert.equal(check1.canContinue, false);
  assert.ok(check1.reason?.includes("Please resolve all conflicts"));

  // All volumes skipped -> all-skip guard fails
  const allSkipDecisions: Record<string, "overwrite" | "skip"> = {
    v1: "skip",
    v2: "skip",
  };
  const check2 = canContinueConflict(volumes, conflictNames, allSkipDecisions);
  assert.equal(check2.canContinue, false);
  assert.equal(check2.reason, "At least one volume must be selected to transfer.");

  // Partial skip, one overwrite -> valid
  const validDecisions: Record<string, "overwrite" | "skip"> = {
    v1: "skip",
    v2: "overwrite",
  };
  const check3 = canContinueConflict(volumes, conflictNames, validDecisions);
  assert.equal(check3.canContinue, true);
  assert.equal(check3.reason, undefined);

  // Non-conflicting volume remains transfer even if conflicting is skipped -> valid
  const nonConflictingVolumes: TransferVolume[] = [
    { name: "v1", size_bytes: 1000, action: "transfer" },
    { name: "v2", size_bytes: 2000, action: "transfer" },
  ];
  const singleConflict = ["v1"];
  const skipSingleConflict: Record<string, "overwrite" | "skip"> = {
    v1: "skip",
  };
  const check4 = canContinueConflict(nonConflictingVolumes, singleConflict, skipSingleConflict);
  assert.equal(check4.canContinue, true);
});

test("resolveConflicts produces updated volume array", () => {
  const volumes: TransferVolume[] = [
    { name: "v1", size_bytes: 1000, action: "transfer" },
    { name: "v2", size_bytes: 2000, action: "transfer" },
    { name: "v3", size_bytes: 3000, action: "transfer" },
  ];
  const decisions: Record<string, "overwrite" | "skip"> = {
    v1: "overwrite",
    v2: "skip",
  };

  const resolved = resolveConflicts(volumes, decisions);
  assert.deepEqual(resolved, [
    { name: "v1", size_bytes: 1000, action: "overwrite" },
    { name: "v2", size_bytes: 2000, action: "skip" },
    { name: "v3", size_bytes: 3000, action: "transfer" },
  ]);
});

test("calculateOverallProgress calculates active volumes progress and clamps", () => {
  const volumes: TransferVolume[] = [
    { name: "v1", size_bytes: 1000, action: "transfer" },
    { name: "v2", size_bytes: 2000, action: "skip" },
    { name: "v3", size_bytes: 3000, action: "overwrite" },
  ];

  // Active volumes are v1 (1000) and v3 (3000). Total active = 4000 bytes.
  const events = new Map<string, TransferEvent>();
  events.set("v1", {
    volume_name: "v1",
    status: "complete",
    bytes_transferred: 1000,
    total_bytes: 1000,
    speed_bps: 0,
  });
  events.set("v3", {
    volume_name: "v3",
    status: "in_progress",
    bytes_transferred: 1000,
    total_bytes: 3000,
    speed_bps: 2097152, // 2 MB/s
  });

  const progress = calculateOverallProgress(volumes, events);
  assert.equal(progress.totalBytes, 4000);
  assert.equal(progress.transferredBytes, 2000);
  assert.equal(progress.percent, 50); // 2000 / 4000 = 50%
  assert.equal(progress.activeVolumeName, "v3");
  assert.equal(progress.currentSpeedBps, 2097152);

  // Even if transferred reaches total while still in_progress, clamp to 99
  events.set("v3", {
    volume_name: "v3",
    status: "in_progress",
    bytes_transferred: 3000,
    total_bytes: 3000,
    speed_bps: 1048576,
  });
  const clampedProgress = calculateOverallProgress(volumes, events);
  assert.equal(clampedProgress.percent, 99);

  // When all active are complete, 100%
  events.set("v3", {
    volume_name: "v3",
    status: "complete",
    bytes_transferred: 3000,
    total_bytes: 3000,
    speed_bps: 0,
  });
  const finishedProgress = calculateOverallProgress(volumes, events);
  assert.equal(finishedProgress.percent, 100);

  // Empty volumes guard
  const empty = calculateOverallProgress([], new Map());
  assert.equal(empty.percent, 0);
  assert.equal(empty.totalBytes, 0);
  assert.equal(empty.transferredBytes, 0);
});

test("summarizeTransferResults categorizes results properly", () => {
  const results: VolumeResult[] = [
    {
      name: "vol1",
      size_bytes: 1024,
      duration_seconds: 5,
      status: "complete",
      error: null,
    },
    {
      name: "vol2",
      size_bytes: 0,
      duration_seconds: 2,
      status: "failed",
      error: "Connection lost",
    },
    {
      name: "vol3",
      size_bytes: 0,
      duration_seconds: 0,
      status: "skipped",
      error: null,
    },
  ];

  const summary = summarizeTransferResults(results, 1024, 7);
  assert.equal(summary.completed.length, 1);
  assert.equal(summary.completed[0].name, "vol1");
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].name, "vol2");
  assert.equal(summary.failed[0].error, "Connection lost");
  assert.equal(summary.skipped.length, 1);
  assert.equal(summary.skipped[0].name, "vol3");
  assert.equal(summary.totalBytes, 1024);
  assert.equal(summary.durationSeconds, 7);
  assert.equal(summary.hasFailures, true);
  assert.equal(summary.allSucceeded, false);
});

test("summarizeTransferResults handles all-success and all-failure edge cases", () => {
  const successResults: VolumeResult[] = [
    { name: "v1", size_bytes: 500, duration_seconds: 3, status: "complete", error: null },
    { name: "v2", size_bytes: 1500, duration_seconds: 5, status: "complete", error: null },
  ];
  const summarySuccess = summarizeTransferResults(successResults, 2000, 8);
  assert.equal(summarySuccess.allSucceeded, true);
  assert.equal(summarySuccess.hasFailures, false);
  assert.equal(summarySuccess.completed.length, 2);

  const failResults: VolumeResult[] = [
    { name: "v1", size_bytes: 0, duration_seconds: 1, status: "failed", error: "fail" },
  ];
  const summaryFail = summarizeTransferResults(failResults);
  assert.equal(summaryFail.allSucceeded, false);
  assert.equal(summaryFail.hasFailures, true);
  assert.equal(summaryFail.failed.length, 1);

  const emptySummary = summarizeTransferResults([]);
  assert.equal(emptySummary.allSucceeded, false);
  assert.equal(emptySummary.hasFailures, false);
  assert.equal(emptySummary.totalBytes, 0);
  assert.equal(emptySummary.durationSeconds, 0);
});

test("calculateClampedProgress handles negative and NaN numbers safely", () => {
  assert.equal(calculateClampedProgress(-50, 100, false), 0);
  assert.equal(calculateClampedProgress(NaN, 100, false), 0);
  assert.equal(calculateClampedProgress(50, NaN, false), 0);
  assert.equal(calculateClampedProgress(50, -100, false), 0);
});


