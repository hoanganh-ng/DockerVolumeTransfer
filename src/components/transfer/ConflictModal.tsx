import { useState, useEffect } from "react";
import { AlertTriangle, X, Check, SkipForward } from "lucide-react";
import { formatBytes } from "../wizard/wizardUtils";
import { canContinueConflict, resolveConflicts } from "./transferUtils";
import type { TransferVolume, DestVolumeInfo } from "../../types";

export interface ConflictModalProps {
  open: boolean;
  volumes: TransferVolume[];
  destVolumes?: DestVolumeInfo;
  conflicts?: Map<string, { sourceSize: number; destSize: number }>;
  onResolved: (volumes: TransferVolume[]) => void;
  onCancel: () => void;
}

export function ConflictModal({
  open,
  volumes,
  destVolumes = {},
  conflicts,
  onResolved,
  onCancel,
}: ConflictModalProps) {
  const [decisions, setDecisions] = useState<Record<string, "overwrite" | "skip">>({});

  const conflictNames = conflicts
    ? Array.from(conflicts.keys())
    : Object.keys(destVolumes);

  // Reset or initialize decisions when modal opens
  useEffect(() => {
    if (open) {
      const initial: Record<string, "overwrite" | "skip"> = {};
      for (const name of conflictNames) {
        const matchingVol = volumes.find((v) => v.name === name);
        if (matchingVol && (matchingVol.action === "overwrite" || matchingVol.action === "skip")) {
          initial[name] = matchingVol.action;
        }
      }
      setDecisions(initial);
    }
  }, [open, conflictNames.join(",")]);

  if (!open) return null;

  const getConflictSizes = (name: string) => {
    if (conflicts && conflicts.has(name)) {
      const c = conflicts.get(name)!;
      return { destSize: c.destSize, sourceSize: c.sourceSize };
    }
    const matchingVol = volumes.find((v) => v.name === name);
    const destSize = destVolumes[name] ?? 0;
    const sourceSize = matchingVol?.size_bytes ?? 0;
    return { destSize, sourceSize };
  };

  const handleSelectDecision = (name: string, decision: "overwrite" | "skip") => {
    setDecisions((prev) => ({
      ...prev,
      [name]: decision,
    }));
  };

  const handleOverwriteAll = () => {
    const allOverwrite: Record<string, "overwrite" | "skip"> = {};
    for (const name of conflictNames) {
      allOverwrite[name] = "overwrite";
    }
    setDecisions(allOverwrite);
  };

  const handleSkipAll = () => {
    const allSkip: Record<string, "overwrite" | "skip"> = {};
    for (const name of conflictNames) {
      allSkip[name] = "skip";
    }
    setDecisions(allSkip);
  };

  const { canContinue, reason } = canContinueConflict(volumes, conflictNames, decisions);

  const handleContinue = () => {
    if (!canContinue) return;
    const resolved = resolveConflicts(volumes, decisions);
    onResolved(resolved);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
    >
      <div className="w-full max-w-xl bg-slate-800 border border-amber-500/40 rounded-xl p-6 shadow-2xl text-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 id="conflict-modal-title" className="text-lg font-semibold text-slate-100">
                Volume Conflicts Detected
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {conflictNames.length} {conflictNames.length === 1 ? "volume already exists" : "volumes already exist"} on destination server.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-700/60 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Batch Actions */}
        <div className="py-2.5 flex items-center justify-between text-xs text-slate-400 border-b border-slate-700/60 flex-shrink-0">
          <span>Choose an action for each conflicting volume:</span>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleOverwriteAll}
              className="text-xs text-amber-400 hover:text-amber-300 font-medium px-2 py-0.5 rounded hover:bg-amber-400/10 transition-colors"
            >
              Overwrite All
            </button>
            <span className="text-slate-600">•</span>
            <button
              type="button"
              onClick={handleSkipAll}
              className="text-xs text-slate-300 hover:text-white font-medium px-2 py-0.5 rounded hover:bg-slate-700 transition-colors"
            >
              Skip All
            </button>
          </div>
        </div>

        {/* Conflicting Volumes List */}
        <div className="py-3 space-y-2.5 overflow-y-auto flex-1 pr-1 my-1">
          {conflictNames.map((name) => {
            const { destSize, sourceSize } = getConflictSizes(name);
            const decision = decisions[name];
            const isSkipped = decision === "skip";
            const isOverwrite = decision === "overwrite";

            return (
              <div
                key={name}
                className={`p-3 rounded-lg border transition-colors flex items-center justify-between gap-3 ${
                  isOverwrite
                    ? "bg-amber-950/20 border-amber-500/50"
                    : isSkipped
                    ? "bg-slate-900/40 border-slate-800 opacity-60"
                    : "bg-slate-900/60 border-slate-700/80"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={`font-mono text-sm font-medium truncate ${
                      isSkipped ? "line-through text-slate-500" : "text-slate-200"
                    }`}
                    title={name}
                  >
                    {name}
                  </div>
                  <div className="flex items-center space-x-3 text-xs text-slate-400 mt-1">
                    <span>
                      Existing on destination:{" "}
                      <span className="font-mono text-slate-300">{formatBytes(destSize)}</span>
                    </span>
                    <span className="text-slate-600">|</span>
                    <span>
                      Incoming:{" "}
                      <span className="font-mono text-slate-300">{formatBytes(sourceSize)}</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSelectDecision(name, "overwrite")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center space-x-1.5 border ${
                      isOverwrite
                        ? "bg-amber-600 text-white border-amber-500 shadow-sm"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                    }`}
                  >
                    {isOverwrite && <Check className="w-3.5 h-3.5" />}
                    <span>Overwrite</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectDecision(name, "skip")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center space-x-1.5 border ${
                      isSkipped
                        ? "bg-slate-600 text-slate-100 border-slate-500 shadow-sm"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                    }`}
                  >
                    {isSkipped && <SkipForward className="w-3.5 h-3.5" />}
                    <span>Skip</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Warning Note if needed */}
        {reason && (
          <div className="mt-2 p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-300 flex-shrink-0">
            {reason}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-700 flex-shrink-0 mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-lg transition-colors border border-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center space-x-1.5 ${
              canContinue
                ? "bg-blue-600 hover:bg-blue-500 text-white shadow-sm"
                : "bg-slate-700/50 text-slate-500 border border-slate-700 cursor-not-allowed"
            }`}
          >
            <span>Continue</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConflictModal;
