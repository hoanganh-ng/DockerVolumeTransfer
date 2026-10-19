import type { TransferVolume, DestVolumeInfo } from "../../types";

export function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  if (i === 0) return `${bytes} B`;
  const val = bytes / Math.pow(1024, i);
  // If integer or single decimal
  const formatted = val % 1 === 0 ? val.toFixed(1) : (Math.round(val * 10) / 10).toFixed(1);
  return `${formatted} ${units[i]}`;
}

export function calculateTotalSize(volumes: { size_bytes?: number }[]): number {
  return volumes.reduce((sum, v) => sum + (v.size_bytes || 0), 0);
}

export function isSameSshKey(
  serverA: { ssh_key_path: string } | null,
  serverB: { ssh_key_path: string } | null
): boolean {
  if (!serverA || !serverB) return false;
  return (
    Boolean(serverA.ssh_key_path) &&
    serverA.ssh_key_path.trim() === serverB.ssh_key_path.trim()
  );
}

export function resolveConflictActions(
  volumes: TransferVolume[],
  conflicts: DestVolumeInfo,
  resolution: "overwrite" | "skip"
): TransferVolume[] {
  return volumes.map((v) => {
    if (Object.prototype.hasOwnProperty.call(conflicts, v.name)) {
      return {
        ...v,
        action: resolution,
      };
    }
    return v;
  });
}
