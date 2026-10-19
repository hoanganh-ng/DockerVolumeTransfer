import { useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  History,
  RotateCcw,
  Loader2,
  Clock,
  HardDrive,
  FileCheck,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import { formatBytes } from "./wizardUtils";
import {
  formatDuration,
  summarizeTransferResults,
} from "../transfer/transferUtils";

export function TransferComplete() {
  const {
    sourceServer,
    destServer,
    selectedVolumes,
    transferSummary,
    reset,
    setShowHistory,
  } = useAppStore();

  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const rawResults = transferSummary?.volumes || selectedVolumes.map((v) => ({
    name: v.name,
    size_bytes: v.size_bytes,
    duration_seconds: 0,
    status: v.action === "skip" ? "skipped" : "complete",
    error: null,
  }));

  const summary = summarizeTransferResults(
    rawResults,
    transferSummary?.total_bytes,
    transferSummary?.duration_seconds
  );

  const handleNewTransfer = async () => {
    setIsDisconnecting(true);
    try {
      await invoke("disconnect_server", { role: "source" });
    } catch (e) {
      console.warn("Failed to disconnect source:", e);
    }
    try {
      await invoke("disconnect_server", { role: "destination" });
    } catch (e) {
      console.warn("Failed to disconnect destination:", e);
    }
    reset();
  };

  const handleViewHistory = () => {
    setShowHistory(true);
  };

  return (
    <div className="flex-1 flex flex-col py-6 space-y-6">
      {/* Header Banner */}
      <div className="p-6 bg-slate-800/80 border border-slate-700 rounded-xl shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-700/60">
            {summary.allSucceeded ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            ) : summary.hasFailures && summary.completed.length > 0 ? (
              <AlertTriangle className="w-8 h-8 text-amber-400" />
            ) : (
              <AlertCircle className="w-8 h-8 text-red-400" />
            )}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">
              {summary.allSucceeded
                ? "Transfer Complete!"
                : summary.hasFailures && summary.completed.length > 0
                ? "Transfer Completed with Warnings"
                : "Transfer Failed"}
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
        </div>

        {/* Action Buttons in header */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={handleViewHistory}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition-colors border border-slate-700"
          >
            <History className="w-4 h-4 text-slate-400" />
            <span>View History</span>
          </button>
          <button
            type="button"
            onClick={handleNewTransfer}
            disabled={isDisconnecting}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {isDisconnecting ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            <span>New Transfer</span>
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-slate-800/50 border border-slate-800 rounded-xl flex items-center space-x-3.5">
          <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Total Size</div>
            <div className="text-lg font-mono font-semibold text-slate-100">
              {formatBytes(summary.totalBytes)}
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-800/50 border border-slate-800 rounded-xl flex items-center space-x-3.5">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Total Duration</div>
            <div className="text-lg font-mono font-semibold text-slate-100">
              {formatDuration(summary.durationSeconds)}
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-800/50 border border-slate-800 rounded-xl flex items-center space-x-3.5">
          <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <FileCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Volumes</div>
            <div className="text-sm font-semibold text-slate-200">
              <span className="text-emerald-400">{summary.completed.length} ok</span>
              {summary.failed.length > 0 && (
                <span className="text-red-400 ml-1.5">• {summary.failed.length} failed</span>
              )}
              {summary.skipped.length > 0 && (
                <span className="text-slate-400 ml-1.5">• {summary.skipped.length} skipped</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Completed Volumes Table */}
      {summary.completed.length > 0 && (
        <div className="p-5 bg-slate-800/60 border border-slate-700/80 rounded-xl">
          <div className="text-sm font-semibold text-slate-200 mb-3 flex items-center justify-between">
            <span>Transferred Volumes ({summary.completed.length})</span>
          </div>
          <div className="divide-y divide-slate-700/60">
            {summary.completed.map((vol) => (
              <div
                key={vol.name}
                className="py-3 flex items-center justify-between gap-4 text-sm"
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span className="font-mono text-slate-200 font-medium truncate">
                    {vol.name}
                  </span>
                </div>
                <div className="flex items-center space-x-4 text-xs font-mono text-slate-400 flex-shrink-0">
                  <span>{formatBytes(vol.size_bytes)}</span>
                  <span className="text-slate-600">•</span>
                  <span>{formatDuration(vol.duration_seconds)}</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Complete
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failed Volumes Section */}
      {summary.failed.length > 0 && (
        <div className="p-5 bg-red-950/20 border border-red-500/40 rounded-xl">
          <div className="text-sm font-semibold text-red-300 mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span>Failed Volumes ({summary.failed.length})</span>
          </div>
          <div className="space-y-2.5">
            {summary.failed.map((vol) => (
              <div
                key={vol.name}
                className="p-3 rounded-lg bg-red-950/30 border border-red-800/60 text-xs font-mono"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-red-200">{vol.name}</span>
                  <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                    Failed
                  </span>
                </div>
                {vol.error && (
                  <div className="text-red-300/90 text-xs mt-1 bg-red-950/50 p-2 rounded border border-red-900/40">
                    {vol.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skipped Volumes Section */}
      {summary.skipped.length > 0 && (
        <div className="p-5 bg-slate-800/40 border border-slate-800 rounded-xl">
          <div className="text-sm font-semibold text-slate-400 mb-2">
            Skipped Volumes ({summary.skipped.length})
          </div>
          <div className="divide-y divide-slate-800">
            {summary.skipped.map((vol) => (
              <div
                key={vol.name}
                className="py-2.5 flex items-center justify-between text-xs text-slate-500"
              >
                <span className="font-mono line-through">{vol.name}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700/60">
                  Skipped
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TransferComplete;
