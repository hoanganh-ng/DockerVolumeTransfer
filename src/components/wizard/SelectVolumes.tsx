import { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  HardDrive,
  CheckSquare,
  Square,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import { formatBytes, calculateTotalSize } from "./wizardUtils";
import type { Volume } from "../../types";

export function SelectVolumes() {
  const {
    volumes,
    setVolumes,
    selectedVolumes,
    toggleVolume,
    selectAllVolumes,
    updateVolumeSize,
    setStep,
    sourceServer,
  } = useAppStore();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [loadingSizes, setLoadingSizes] = useState<Record<string, boolean>>({});

  const fetchVolumes = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const list = await invoke<Volume[]>("list_volumes", { role: "source" });
      setVolumes(list);
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Failed to list Docker volumes";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [setVolumes]);

  useEffect(() => {
    fetchVolumes();
  }, [fetchVolumes]);

  const fetchSizeForVolume = async (volumeName: string) => {
    setLoadingSizes((prev) => ({ ...prev, [volumeName]: true }));
    try {
      const size = await invoke<number>("get_volume_size", {
        role: "source",
        volumeName,
        volume_name: volumeName,
      });
      updateVolumeSize(volumeName, size);
    } catch (err: unknown) {
      console.error(`Failed to fetch size for ${volumeName}:`, err);
    } finally {
      setLoadingSizes((prev) => {
        const next = { ...prev };
        delete next[volumeName];
        return next;
      });
    }
  };

  const handleToggle = (vol: Volume) => {
    const isSelected = selectedVolumes.some((v) => v.name === vol.name);
    toggleVolume(vol);

    if (!isSelected) {
      // If selecting and size not fetched yet
      const existing = selectedVolumes.find((v) => v.name === vol.name);
      if (!existing || existing.size_bytes === 0) {
        fetchSizeForVolume(vol.name);
      }
    }
  };

  const allSelected =
    volumes.length > 0 && selectedVolumes.length === volumes.length;

  const handleSelectAllToggle = async () => {
    if (allSelected) {
      selectAllVolumes();
    } else {
      selectAllVolumes(volumes);

      // Fetch size in parallel for all not yet fetched
      const toFetch = volumes.filter((vol) => {
        const found = selectedVolumes.find((s) => s.name === vol.name);
        return !found || found.size_bytes === 0;
      });

      if (toFetch.length > 0) {
        setLoadingSizes((prev) => {
          const next = { ...prev };
          for (const v of toFetch) next[v.name] = true;
          return next;
        });

        await Promise.all(
          toFetch.map(async (vol) => {
            try {
              const size = await invoke<number>("get_volume_size", {
                role: "source",
                volumeName: vol.name,
                volume_name: vol.name,
              });
              updateVolumeSize(vol.name, size);
            } catch (err: unknown) {
              console.error(`Failed to fetch size for ${vol.name}:`, err);
            } finally {
              setLoadingSizes((prev) => {
                const next = { ...prev };
                delete next[vol.name];
                return next;
              });
            }
          })
        );
      }
    }
  };

  const totalSize = calculateTotalSize(selectedVolumes);

  return (
    <div className="flex-1 flex flex-col py-6 space-y-6">
      {/* Header with Selection Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">
            Select Volumes to Transfer
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Source:{" "}
            <span className="text-slate-200 font-medium font-mono">
              {sourceServer ? `${sourceServer.name} (${sourceServer.host})` : "Not connected"}
            </span>
          </p>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-right">
            <span className="text-sm font-semibold text-slate-200">
              {selectedVolumes.length} selected
            </span>
            <span className="text-sm text-slate-400"> · </span>
            <span className="text-sm font-medium text-blue-400">
              {formatBytes(totalSize)} total
            </span>
          </div>

          {volumes.length > 0 && (
            <button
              type="button"
              onClick={handleSelectAllToggle}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors font-medium"
            >
              {allSelected ? "Deselect All" : "Select All"}
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Content Area */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
          <p className="text-sm">Querying Docker volumes on source server...</p>
        </div>
      ) : volumes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-slate-400 border border-dashed border-slate-800 rounded-xl">
          <HardDrive className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-base font-medium text-slate-300">No volumes found</p>
          <p className="text-xs text-slate-500 mt-1">
            No Docker volumes were found on this server.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden border border-slate-800 rounded-xl bg-slate-800/40">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-200">
              <thead className="bg-slate-800/80 text-xs uppercase text-slate-400 border-b border-slate-700">
                <tr>
                  <th scope="col" className="p-4 w-12 text-center">
                    <span className="sr-only">Select</span>
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Volume Name
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Driver
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Status
                  </th>
                  <th scope="col" className="py-3 px-4 text-right">
                    Size
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {volumes.map((vol) => {
                  const selectedItem = selectedVolumes.find(
                    (s) => s.name === vol.name
                  );
                  const isSelected = Boolean(selectedItem);
                  const isFetchingSize = Boolean(loadingSizes[vol.name]);

                  return (
                    <tr
                      key={vol.name}
                      onClick={() => handleToggle(vol)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-blue-950/20 hover:bg-blue-950/30"
                          : "hover:bg-slate-800/50"
                      }`}
                    >
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          className="text-slate-400 hover:text-slate-200"
                          aria-label={
                            isSelected
                              ? `Deselect volume ${vol.name}`
                              : `Select volume ${vol.name}`
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(vol);
                          }}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-blue-500" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-600" />
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-4 font-mono font-medium text-slate-100">
                        {vol.name}
                      </td>

                      <td className="py-3 px-4">
                        <span className="text-xs font-mono bg-slate-700/60 text-slate-300 px-2 py-0.5 rounded border border-slate-600/40">
                          {vol.driver}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {vol.in_use ? (
                          <span
                            className="inline-flex items-center space-x-1.5 text-xs text-amber-300 bg-amber-950/50 border border-amber-800/60 px-2.5 py-0.5 rounded-full"
                            title="Volume is currently mounted by one or more running containers"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>In use — backup may be inconsistent</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Ready</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right font-mono text-xs">
                        {isFetchingSize ? (
                          <span className="inline-flex items-center justify-end space-x-1 text-slate-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Calculating...</span>
                          </span>
                        ) : isSelected && selectedItem ? (
                          <span className="text-slate-200 font-medium">
                            {selectedItem.size_bytes > 0
                              ? formatBytes(selectedItem.size_bytes)
                              : "0 B"}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={() => setStep(1)}
          className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <button
          type="button"
          onClick={() => setStep(3)}
          disabled={selectedVolumes.length === 0}
          className="flex items-center space-x-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border-slate-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg border border-transparent shadow-sm transition-colors"
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default SelectVolumes;
