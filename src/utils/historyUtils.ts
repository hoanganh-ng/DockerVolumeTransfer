import type { TransferRecord } from "../types";

export type SortDirection = "asc" | "desc";

export interface TruncatedVolumes {
  visible: string[];
  hidden: string[];
  hasMore: boolean;
  remainingCount: number;
}

export interface StatusBadgeConfig {
  label: string;
  className: string;
}

/**
 * Filters transfer records client-side by source server, destination server, or volume names.
 * Matching is case-insensitive.
 */
export function filterTransferHistory(
  records: TransferRecord[],
  query: string
): TransferRecord[] {
  if (!query || !query.trim()) {
    return [...records];
  }

  const q = query.trim().toLowerCase();

  return records.filter((record) => {
    const srcMatch = (record.source_server_name || "")
      .toLowerCase()
      .includes(q);
    const destMatch = (record.dest_server_name || "")
      .toLowerCase()
      .includes(q);
    const volMatch = (record.volume_names || []).some((vol) =>
      (vol || "").toLowerCase().includes(q)
    );
    return srcMatch || destMatch || volMatch;
  });
}

/**
 * Sorts transfer records by `started_at` date timestamp.
 * Defaults to descending order (newest first).
 */
export function sortTransferHistoryByDate(
  records: TransferRecord[],
  direction: SortDirection = "desc"
): TransferRecord[] {
  const parseTimestamp = (dateStr: string | null | undefined): number => {
    if (!dateStr || !dateStr.trim()) return 0;
    const normalized = dateStr.includes("T")
      ? dateStr
      : dateStr.replace(" ", "T") + (dateStr.endsWith("Z") ? "" : "Z");
    const ts = Date.parse(normalized);
    if (!isNaN(ts)) return ts;
    const rawTs = Date.parse(dateStr);
    return isNaN(rawTs) ? 0 : rawTs;
  };

  return [...records].sort((a, b) => {
    const timeA = parseTimestamp(a.started_at);
    const timeB = parseTimestamp(b.started_at);
    if (timeA !== timeB) {
      return direction === "asc" ? timeA - timeB : timeB - timeA;
    }
    return direction === "asc" ? a.id - b.id : b.id - a.id;
  });
}

/**
 * Formats date/time string using locale formatting.
 * Handles ISO strings and SQLite datetime strings.
 */
export function formatHistoryDate(dateStr: string | null | undefined): string {
  if (!dateStr || !dateStr.trim()) return "-";

  const normalized = dateStr.includes("T")
    ? dateStr
    : dateStr.replace(" ", "T") + (dateStr.endsWith("Z") ? "" : "Z");
  const date = new Date(normalized);

  if (isNaN(date.getTime())) {
    const rawDate = new Date(dateStr);
    if (isNaN(rawDate.getTime())) {
      return "-";
    }
    return rawDate.toLocaleString();
  }

  return date.toLocaleString();
}

/**
 * Formats transfer duration into human-readable representation:
 * Xs, Xm Xs, Xh Xm Xs, or "-" if null/undefined.
 */
export function formatHistoryDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) {
    return "-";
  }

  const s = Math.floor(seconds);
  if (s === 0) return "0s";

  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Truncates an array of volume names if it exceeds the limit (default 3),
 * returning visible volumes and hidden remainder.
 */
export function truncateVolumes(
  volumes: string[] | null | undefined,
  limit: number = 3
): TruncatedVolumes {
  if (!volumes || volumes.length === 0) {
    return {
      visible: [],
      hidden: [],
      hasMore: false,
      remainingCount: 0,
    };
  }

  if (volumes.length <= limit) {
    return {
      visible: [...volumes],
      hidden: [],
      hasMore: false,
      remainingCount: 0,
    };
  }

  return {
    visible: volumes.slice(0, limit),
    hidden: volumes.slice(limit),
    hasMore: true,
    remainingCount: volumes.length - limit,
  };
}

/**
 * Returns label and Tailwind badge classes for transfer statuses.
 */
export function getStatusBadgeConfig(status: string): StatusBadgeConfig {
  const s = (status || "").trim().toLowerCase();

  if (s === "success" || s === "completed") {
    return {
      label: s === "completed" ? "Completed" : "Success",
      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    };
  }

  if (s === "failed") {
    return {
      label: "Failed",
      className: "bg-red-500/10 text-red-400 border-red-500/20",
    };
  }

  if (s === "cancelled" || s === "canceled") {
    return {
      label: "Cancelled",
      className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    };
  }

  return {
    label: status || "Unknown",
    className: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  };
}
