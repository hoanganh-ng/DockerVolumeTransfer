import type { TransferVolume, TransferEvent, VolumeResult } from "../../types";

/**
 * Calculates progress percentage clamped between 0 and 99 while in-progress,
 * or exactly 100 on complete.
 */
export function calculateClampedProgress(
  bytesTransferred: number,
  totalBytes: number,
  isComplete: boolean
): number {
  if (isComplete) return 100;
  if (!totalBytes || totalBytes <= 0 || isNaN(totalBytes)) return 0;
  const transferred = Math.max(0, bytesTransferred || 0);
  const ratio = (transferred / totalBytes) * 100;
  return Math.min(99, Math.floor(ratio));
}

/**
 * Formats bytes per second into MB/s with 1 decimal place.
 */
export function formatSpeed(speedBps: number): string {
  if (!speedBps || speedBps <= 0 || isNaN(speedBps)) {
    return "0.0 MB/s";
  }
  const mbps = speedBps / (1024 * 1024);
  return `${mbps.toFixed(1)} MB/s`;
}

/**
 * Formats duration in seconds to human-readable format.
 * Examples: "0s", "45s", "1m 23s", "1h 05m 12s"
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0 || isNaN(seconds)) return "0s";
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hrs > 0) {
    const paddedMins = mins.toString().padStart(2, "0");
    const paddedSecs = secs.toString().padStart(2, "0");
    return `${hrs}h ${paddedMins}m ${paddedSecs}s`;
  }
  if (mins > 0) {
    const paddedSecs = secs.toString().padStart(2, "0");
    return `${mins}m ${paddedSecs}s`;
  }
  return `${secs}s`;
}

/**
 * Formats estimated time remaining based on remaining bytes and speed.
 */
export function formatEta(bytesRemaining: number, speedBps: number): string {
  if (!speedBps || speedBps <= 0 || isNaN(speedBps)) return "--";
  if (bytesRemaining <= 0) return "0s";
  const seconds = Math.ceil(bytesRemaining / speedBps);
  return formatDuration(seconds);
}

/**
 * Validates whether all conflicting volumes have decisions and
 * at least one volume in the transfer set is not skipped.
 */
export function canContinueConflict(
  volumes: TransferVolume[],
  conflictNames: string[],
  decisions: Record<string, "overwrite" | "skip">
): { canContinue: boolean; reason?: string } {
  // Check if all conflicting volumes have a decision
  for (const name of conflictNames) {
    if (!decisions[name]) {
      return {
        canContinue: false,
        reason: "Please resolve all conflicts before continuing.",
      };
    }
  }

  // Check that at least one volume has action != "skip"
  const willTransfer = volumes.some((v) => {
    const action = decisions[v.name] ?? v.action;
    return action !== "skip";
  });

  if (!willTransfer) {
    return {
      canContinue: false,
      reason: "At least one volume must be selected to transfer.",
    };
  }

  return { canContinue: true };
}

/**
 * Applies decisions to volumes array.
 */
export function resolveConflicts(
  volumes: TransferVolume[],
  decisions: Record<string, "overwrite" | "skip">
): TransferVolume[] {
  return volumes.map((v) => {
    if (decisions[v.name] !== undefined) {
      return {
        ...v,
        action: decisions[v.name],
      };
    }
    return v;
  });
}

export interface OverallProgressResult {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  activeVolumeName: string | null;
  currentSpeedBps: number;
}

/**
 * Computes overall progress across active volumes.
 */
export function calculateOverallProgress(
  volumes: TransferVolume[],
  events: Map<string, TransferEvent> | Record<string, TransferEvent>,
  allCompleted?: boolean
): OverallProgressResult {
  const activeVolumes = volumes.filter((v) => v.action !== "skip");
  if (activeVolumes.length === 0) {
    return {
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      activeVolumeName: null,
      currentSpeedBps: 0,
    };
  }

  const getEvent = (name: string): TransferEvent | undefined => {
    if (events instanceof Map) {
      return events.get(name);
    }
    return (events as Record<string, TransferEvent>)[name];
  };

  let totalBytes = 0;
  let transferredBytes = 0;
  let activeVolumeName: string | null = null;
  let currentSpeedBps = 0;
  let anyInProgress = false;
  let allDone = true;

  for (const vol of activeVolumes) {
    const ev = getEvent(vol.name);
    const volTotal = ev?.total_bytes ?? vol.size_bytes ?? 0;
    totalBytes += volTotal;

    const volTransferred = ev?.bytes_transferred ?? 0;
    transferredBytes += volTransferred;

    const status = ev?.status?.toLowerCase();
    if (status === "in_progress" || status === "inprogress") {
      anyInProgress = true;
      allDone = false;
      activeVolumeName = vol.name;
      currentSpeedBps = ev?.speed_bps ?? 0;
    } else if (status !== "complete") {
      allDone = false;
    }
  }

  if (allCompleted || (allDone && activeVolumes.length > 0)) {
    return {
      percent: 100,
      transferredBytes,
      totalBytes,
      activeVolumeName: null,
      currentSpeedBps: 0,
    };
  }

  if (totalBytes <= 0) {
    return {
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      activeVolumeName,
      currentSpeedBps,
    };
  }

  const rawPercent = Math.floor((transferredBytes / totalBytes) * 100);
  const percent = anyInProgress ? Math.min(99, rawPercent) : Math.min(100, rawPercent);

  return {
    percent: Math.max(0, percent),
    transferredBytes,
    totalBytes,
    activeVolumeName,
    currentSpeedBps,
  };
}

export interface CategorizedSummary {
  completed: VolumeResult[];
  failed: VolumeResult[];
  skipped: VolumeResult[];
  totalBytes: number;
  durationSeconds: number;
  hasFailures: boolean;
  allSucceeded: boolean;
}

/**
 * Categorizes volume results from a transfer summary.
 */
export function summarizeTransferResults(
  results: VolumeResult[],
  totalBytes?: number,
  durationSeconds?: number
): CategorizedSummary {
  const completed: VolumeResult[] = [];
  const failed: VolumeResult[] = [];
  const skipped: VolumeResult[] = [];

  let calculatedBytes = 0;
  let calculatedDuration = 0;

  for (const item of results) {
    const status = item.status?.toLowerCase();
    calculatedDuration += item.duration_seconds || 0;

    if (status === "complete") {
      completed.push(item);
      calculatedBytes += item.size_bytes || 0;
    } else if (status === "failed") {
      failed.push(item);
    } else if (status === "skipped") {
      skipped.push(item);
    } else {
      // Any other status treated according to error presence
      if (item.error) {
        failed.push(item);
      } else {
        completed.push(item);
        calculatedBytes += item.size_bytes || 0;
      }
    }
  }

  const finalTotalBytes = totalBytes !== undefined ? totalBytes : calculatedBytes;
  const finalDuration = durationSeconds !== undefined ? durationSeconds : calculatedDuration;

  return {
    completed,
    failed,
    skipped,
    totalBytes: finalTotalBytes,
    durationSeconds: finalDuration,
    hasFailures: failed.length > 0,
    allSucceeded: failed.length === 0 && completed.length > 0,
  };
}

