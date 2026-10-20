import { useEffect, useState } from "react";
import { ArrowRight, Ban, Loader2, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import { VolumeProgressCard } from "../transfer/VolumeProgressCard";
import {
  calculateOverallProgress,
  formatSpeed,
} from "../transfer/transferUtils";
import { formatBytes } from "./wizardUtils";

export function TransferProgress() {
  const {
    sourceServer,
    destServer,
    selectedVolumes,
    transferEvents,
    transferActive,
    setTransferActive,
  } = useAppStore();

  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string>("");

  // Start transfer once when component mounts and no transfer is already running
  useEffect(() => {
    if (transferActive) return; // already running (e.g. came back from History view)

    let cancelled = false;

    (async () => {
      try {
        setTransferActive(true);
        await invoke("start_transfer", {
          sourceServerName: sourceServer?.name || "",
          source_server_name: sourceServer?.name || "",
          destServerName: destServer?.name || "",
          dest_server_name: destServer?.name || "",
          volumes: selectedVolumes,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Failed to start volume transfer";
        setError(msg);
        setTransferActive(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  const handleCancel = async () => {
    const confirmed = window.confirm(
      "Cancel transfer? Volumes already transferred will remain on destination."
    );
    if (!confirmed) return;

    setIsCancelling(true);
    try {
      await invoke("cancel_transfer");
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Failed to cancel transfer";
      setError(msg);
      setIsCancelling(false);
    }
  };

  const overall = calculateOverallProgress(selectedVolumes, transferEvents);

  return (
    <div className="flex-1 flex flex-col py-6 space-y-6">
      {/* Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100 flex items-center space-x-2">
            <span>Transferring Volumes</span>
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          </h2>
          <div className="flex items-center space-x-2 text-sm text-slate-400 mt-1">
            <span className="font-mono text-slate-300">
              {sourceServer?.name || "Source"}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-mono text-slate-300">
              {destServer?.name || "Destination"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCancel}
          disabled={isCancelling}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
            isCancelling
              ? "bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed"
              : "bg-red-500/10 hover:bg-red-500/20 text-red-300 border-red-500/30"
          }`}
        >
          {isCancelling ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          ) : (
            <Ban className="w-4 h-4" />
          )}
          <span>{isCancelling ? "Cancelling..." : "Cancel Transfer"}</span>
        </button>
      </div>

      {/* Error banner if start or cancel fails */}
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-sm text-red-300 flex items-start space-x-2.5">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Overall Progress Banner */}
      <div className="p-5 bg-slate-800/60 border border-slate-700/80 rounded-xl shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-slate-200">
            {overall.activeVolumeName ? (
              <span>
                Transferring{" "}
                <span className="font-mono font-semibold text-blue-400">
                  {overall.activeVolumeName}
                </span>
              </span>
            ) : (
              <span>Overall Progress</span>
            )}
          </div>
          <div className="font-mono text-sm font-semibold text-blue-400">
            {overall.percent}%
          </div>
        </div>

        {/* Overall progress bar */}
        <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-700/60">
          <div
            className="h-full bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${overall.percent}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400 mt-2 font-mono">
          <span>
            {formatBytes(overall.transferredBytes)} / {formatBytes(overall.totalBytes)}
          </span>
          {overall.currentSpeedBps > 0 && (
            <span className="text-slate-300">{formatSpeed(overall.currentSpeedBps)}</span>
          )}
        </div>
      </div>

      {/* Volume Progress Cards List */}
      <div className="space-y-3 flex-1 overflow-y-auto">
        <div className="text-xs uppercase font-bold tracking-wider text-slate-400 px-1">
          Volumes ({selectedVolumes.length})
        </div>
        {selectedVolumes.map((vol) => (
          <VolumeProgressCard
            key={vol.name}
            volume={vol}
            event={transferEvents.get(vol.name)}
          />
        ))}
      </div>
    </div>
  );
}

export default TransferProgress;
