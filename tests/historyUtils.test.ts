import test from "node:test";
import assert from "node:assert/strict";
import {
  filterTransferHistory,
  sortTransferHistoryByDate,
  formatHistoryDate,
  formatHistoryDuration,
  truncateVolumes,
  getStatusBadgeConfig,
} from "../src/utils/historyUtils.ts";
import type { TransferRecord } from "../src/types.ts";

const mockRecords: TransferRecord[] = [
  {
    id: 1,
    source_server_name: "prod-web-01",
    dest_server_name: "backup-srv",
    volume_names: ["nginx_data", "certs_volume"],
    total_size_bytes: 1048576,
    started_at: "2025-07-18 10:00:00",
    completed_at: "2025-07-18 10:00:45",
    duration_seconds: 45,
    status: "success",
  },
  {
    id: 2,
    source_server_name: "staging-app",
    dest_server_name: "prod-web-01",
    volume_names: ["db_postgres", "redis_cache", "media_uploads", "extra_vol"],
    total_size_bytes: 52428800,
    started_at: "2025-07-18 12:30:00",
    completed_at: "2025-07-18 12:32:00",
    duration_seconds: 120,
    status: "failed",
  },
  {
    id: 3,
    source_server_name: "dev-local",
    dest_server_name: "staging-app",
    volume_names: ["dev_db"],
    total_size_bytes: 2048,
    started_at: "2025-07-17 08:00:00",
    completed_at: "2025-07-17 08:00:05",
    duration_seconds: 5,
    status: "cancelled",
  },
];

test("filterTransferHistory returns all records when query is empty or whitespace", () => {
  assert.equal(filterTransferHistory(mockRecords, "").length, 3);
  assert.equal(filterTransferHistory(mockRecords, "   ").length, 3);
});

test("filterTransferHistory filters by source server name case-insensitively", () => {
  const result = filterTransferHistory(mockRecords, "DEV-LOCAL");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 3);
});

test("filterTransferHistory filters by destination server name case-insensitively", () => {
  const result = filterTransferHistory(mockRecords, "BACKUP");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);

  const prodWebMatches = filterTransferHistory(mockRecords, "PROD-WEB");
  // Matches record 1 (source) and record 2 (dest)
  assert.equal(prodWebMatches.length, 2);
});

test("filterTransferHistory filters by volume name", () => {
  const result = filterTransferHistory(mockRecords, "redis_cache");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 2);

  const partial = filterTransferHistory(mockRecords, "db");
  // db_postgres (id 2) and dev_db (id 3)
  assert.equal(partial.length, 2);
});

test("filterTransferHistory returns empty array when nothing matches", () => {
  const result = filterTransferHistory(mockRecords, "nonexistent-server-or-vol");
  assert.equal(result.length, 0);
});

test("filterTransferHistory handles records with empty or null volume_names", () => {
  const recordWithEmptyVol: TransferRecord[] = [
    {
      id: 99,
      source_server_name: "srvA",
      dest_server_name: "srvB",
      volume_names: [],
      total_size_bytes: 0,
      started_at: "2025-07-18 10:00:00",
      completed_at: null,
      duration_seconds: null,
      status: "in_progress",
    },
  ];
  assert.equal(filterTransferHistory(recordWithEmptyVol, "srvA").length, 1);
  assert.equal(filterTransferHistory(recordWithEmptyVol, "vol").length, 0);
});

test("sortTransferHistoryByDate sorts descending by default", () => {
  const sorted = sortTransferHistoryByDate(mockRecords);
  // Expected order: id 2 (12:30), id 1 (10:00), id 3 (prev day 08:00)
  assert.equal(sorted[0].id, 2);
  assert.equal(sorted[1].id, 1);
  assert.equal(sorted[2].id, 3);
});

test("sortTransferHistoryByDate sorts ascending when requested", () => {
  const sorted = sortTransferHistoryByDate(mockRecords, "asc");
  // Expected order: id 3 (prev day 08:00), id 1 (10:00), id 2 (12:30)
  assert.equal(sorted[0].id, 3);
  assert.equal(sorted[1].id, 1);
  assert.equal(sorted[2].id, 2);
});

test("sortTransferHistoryByDate does not mutate input array", () => {
  const original = [...mockRecords];
  sortTransferHistoryByDate(original, "asc");
  assert.equal(original[0].id, mockRecords[0].id);
});

test("sortTransferHistoryByDate handles ISO string format and invalid dates safely", () => {
  const recordsWithMixedDates: TransferRecord[] = [
    {
      ...mockRecords[0],
      id: 10,
      started_at: "2025-07-18T15:00:00Z",
    },
    {
      ...mockRecords[1],
      id: 11,
      started_at: "invalid-date",
    },
    {
      ...mockRecords[2],
      id: 12,
      started_at: "2025-07-18T16:00:00Z",
    },
  ];
  const sortedDesc = sortTransferHistoryByDate(recordsWithMixedDates, "desc");
  assert.equal(sortedDesc[0].id, 12);
  assert.equal(sortedDesc[1].id, 10);
  assert.equal(sortedDesc[2].id, 11);
});

test("formatHistoryDuration formats seconds properly", () => {
  assert.equal(formatHistoryDuration(0), "0s");
  assert.equal(formatHistoryDuration(45), "45s");
  assert.equal(formatHistoryDuration(65), "1m 5s");
  assert.equal(formatHistoryDuration(120), "2m 0s");
  assert.equal(formatHistoryDuration(3665), "1h 1m 5s");
  assert.equal(formatHistoryDuration(null), "-");
  assert.equal(formatHistoryDuration(undefined), "-");
});

test("truncateVolumes splits list exceeding limit", () => {
  const shortList = ["vol1", "vol2"];
  const resShort = truncateVolumes(shortList, 3);
  assert.equal(resShort.hasMore, false);
  assert.deepEqual(resShort.visible, ["vol1", "vol2"]);
  assert.deepEqual(resShort.hidden, []);
  assert.equal(resShort.remainingCount, 0);

  const longList = ["vol1", "vol2", "vol3", "vol4", "vol5"];
  const resLong = truncateVolumes(longList, 3);
  assert.equal(resLong.hasMore, true);
  assert.deepEqual(resLong.visible, ["vol1", "vol2", "vol3"]);
  assert.deepEqual(resLong.hidden, ["vol4", "vol5"]);
  assert.equal(resLong.remainingCount, 2);

  const emptyRes = truncateVolumes([], 3);
  assert.equal(emptyRes.hasMore, false);
  assert.deepEqual(emptyRes.visible, []);
});

test("getStatusBadgeConfig returns correct badge styling and label", () => {
  const successBadge = getStatusBadgeConfig("success");
  assert.equal(successBadge.label, "Success");
  assert.ok(successBadge.className.includes("emerald"));

  const completedBadge = getStatusBadgeConfig("Completed");
  assert.equal(completedBadge.label, "Completed");
  assert.ok(completedBadge.className.includes("emerald"));

  const failedBadge = getStatusBadgeConfig("failed");
  assert.equal(failedBadge.label, "Failed");
  assert.ok(failedBadge.className.includes("red"));

  const cancelledBadge = getStatusBadgeConfig("cancelled");
  assert.equal(cancelledBadge.label, "Cancelled");
  assert.ok(cancelledBadge.className.includes("amber"));

  const canceledBadge = getStatusBadgeConfig("canceled");
  assert.equal(canceledBadge.label, "Cancelled");
  assert.ok(canceledBadge.className.includes("amber"));

  const unknownBadge = getStatusBadgeConfig("other_status");
  assert.equal(unknownBadge.label, "other_status");
  assert.ok(unknownBadge.className.includes("slate"));
});

test("formatHistoryDate formats date string or returns fallback", () => {
  assert.equal(formatHistoryDate(null), "-");
  assert.equal(formatHistoryDate(""), "-");
  assert.equal(formatHistoryDate("invalid"), "-");

  const formatted = formatHistoryDate("2025-07-18 10:00:00");
  assert.notEqual(formatted, "-");
  assert.ok(formatted.length > 5);
});
