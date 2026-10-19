import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  SkipForward,
  XCircle,
} from "lucide-react";
import { formatBytes } from "../wizard/wizardUtils";
import {
  calculateClampedProgress,
  formatSpeed,
  formatEta,
} from "./transferUtils";
import type { TransferVolume, TransferEvent } from "../../types";

export interface VolumeProgressCardProps {
  volume: TransferVolume;
  event?: TransferEvent;
}

export function VolumeProgressCard({ volume, event }: VolumeProgressCardProps) {
  const rawStatus = (
    event?.status || (volume.action === "skip" ? "skipped" : "pending")
  ).toLowerCase();

  const isComplete = rawStatus === "complete";
  const isInProgress = rawStatus === "in_progress" || rawStatus === "inprogress";
  const isFailed = rawStatus === "failed";
  const isSkipped = rawStatus === "skipped" || volume.action === "skip";
  const isCancelled = rawStatus === "cancelled";
  const isPending = !isComplete && !isInProgress && !isFailed && !isSkipped && !isCancelled;

  const totalBytes = event?.total_bytes ?? volume.size_bytes ?? 0;
  const bytesTransferred = event?.bytes_transferred ?? 0;
  const speedBps = event?.speed_bps ?? 0;
  const remainingBytes = Math.max(0, totalBytes - bytesTransferred);
  const percent = calculateClampedProgress(bytesTransferred, totalBytes, isComplete);

  // Border & background styling based on status
  let cardClasses = "border-slate-700/80 bg-slate-800/40";
  if (isComplete) {
    cardClasses = "border-emerald-500/50 bg-emerald-950/20";
  } else if (isInProgress) {
    cardClasses = "border-blue-500/60 bg-blue-950/20 shadow-lg shadow-blue-950/20";
  } else if (isFailed) {
    cardClasses = "border-red-500/50 bg-red-950/20";
  } else if (isSkipped) {
    cardClasses = "border-slate-800 bg-slate-900/40 opacity-60";
  } else if (isCancelled) {
    cardClasses = "border-slate-800 bg-slate-900/50 opacity-70";
  }

  return (
    <div
      className={`rounded-xl border p-4 transition-all duration-200 ${cardClasses}`}
      data-testid={`volume-card-${volume.name}`}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        {/* Left: icon + volume name + action tag */}
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="flex-shrink-0">
            {isComplete && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
            {isInProgress && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
            {isFailed && <AlertCircle className="w-5 h-5 text-red-400" />}
            {isSkipped && <SkipForward className="w-5 h-5 text-slate-500" />}
            {isCancelled && <XCircle className="w-5 h-5 text-slate-500" />}
            {isPending && <Clock className="w-5 h-5 text-slate-400" />}
          </div>
          <span
            className={`font-mono text-sm font-semibold truncate ${
              isSkipped ? "line-through text-slate-500" : "text-slate-100"
            }`}
            title={volume.name}
          >
            {volume.name}
          </span>
          {volume.action === "overwrite" && (
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Overwrite
            </span>
          )}
        </div>

        {/* Right: status badge & percent / size */}
        <div className="flex items-center space-x-2 flex-shrink-0 text-xs">
          {isComplete && (
            <span className="px-2 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Complete
            </span>
          )}
          {isInProgress && (
            <span className="px-2 py-0.5 rounded-full font-mono font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {percent}%
            </span>
          )}
          {isFailed && (
            <span className="px-2 py-0.5 rounded-full font-medium bg-red-500/20 text-red-300 border border-red-500/30">
              Failed
            </span>
          )}
          {isSkipped && (
            <span className="px-2 py-0.5 rounded-full font-medium bg-slate-800 text-slate-500 border border-slate-700/60">
              Skipped
            </span>
          )}
          {isCancelled && (
            <span className="px-2 py-0.5 rounded-full font-medium bg-slate-800 text-slate-400 border border-slate-700/60">
              Cancelled
            </span>
          )}
          {isPending && (
            <span className="px-2 py-0.5 rounded-full font-medium bg-slate-800 text-slate-400 border border-slate-700">
              Waiting
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {!isSkipped && (
        <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden my-2 border border-slate-700/40">
          <div
            className={`h-full transition-all duration-300 ease-out rounded-full ${
              isComplete
                ? "bg-emerald-500 w-full"
                : isInProgress
                ? "bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400"
                : isFailed
                ? "bg-red-500"
                : "bg-slate-700"
            }`}
            style={{ width: isComplete ? "100%" : `${percent}%` }}
          />
        </div>
      )}

      {/* Details footer */}
      <div className="flex items-center justify-between text-xs text-slate-400 mt-1.5 font-mono">
        <div>
          {isComplete && (
            <span className="text-emerald-300">
              Transferred {formatBytes(bytesTransferred || totalBytes)}
            </span>
          )}
          {isInProgress && (
            <span>
              {formatBytes(bytesTransferred)} / {formatBytes(totalBytes)}
            </span>
          )}
          {isPending && <span>Size: {formatBytes(totalBytes)}</span>}
          {isSkipped && <span className="text-slate-500">Excluded from transfer</span>}
          {isFailed && (
            <span className="text-red-400">
              Stopped at {formatBytes(bytesTransferred)}
            </span>
          )}
          {isCancelled && (
            <span className="text-slate-500">
              Stopped at {formatBytes(bytesTransferred)}
            </span>
          )}
        </div>

        {isInProgress && (
          <div className="flex items-center space-x-3 text-slate-300">
            <span>{formatSpeed(speedBps)}</span>
            <span className="text-slate-600">•</span>
            <span>ETA {formatEta(remainingBytes, speedBps)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default VolumeProgressCard;
