import { AlertTriangle, X } from "lucide-react";
import type { TransferVolume, DestVolumeInfo } from "../../types";

export interface ConflictModalProps {
  open: boolean;
  volumes: TransferVolume[];
  destVolumes: DestVolumeInfo;
  onResolved: (volumes: TransferVolume[]) => void;
  onCancel: () => void;
}

export function ConflictModal({
  open,
  volumes,
  destVolumes,
  onResolved,
  onCancel,
}: ConflictModalProps) {
  if (!open) return null;

  const conflictCount = Object.keys(destVolumes).length;

  const handleOverwriteAll = () => {
    const resolved = volumes.map((v) =>
      destVolumes[v.name] !== undefined
        ? { ...v, action: "overwrite" as const }
        : v
    );
    onResolved(resolved);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
    >
      <div className="w-full max-w-md bg-slate-800 border border-amber-500/50 rounded-xl p-6 shadow-2xl text-slate-100">
        <div className="flex items-start justify-between pb-3 border-b border-slate-700">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h3 id="conflict-modal-title" className="text-lg font-semibold text-slate-100">
              Volume Conflicts Detected
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-700 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-4 text-sm text-slate-300 space-y-2">
          <p>
            {conflictCount} {conflictCount === 1 ? "volume already exists" : "volumes already exist"} on destination server:
          </p>
          <ul className="list-disc list-inside bg-slate-900/60 p-3 rounded-lg border border-slate-700/60 font-mono text-xs text-amber-300">
            {Object.keys(destVolumes).map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="text-xs text-slate-400">
            Placeholder modal for Task 7. Proceeding will overwrite conflicting volumes.
          </p>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-700">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-lg transition-colors border border-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleOverwriteAll}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Overwrite & Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConflictModal;
