import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  HardDrive,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import { ServerCard, AddServerModal, PassphraseModal } from "../servers";
import { ConflictModal } from "./ConflictModal";
import { formatBytes, calculateTotalSize, isSameSshKey } from "./wizardUtils";
import type { Server, DestVolumeInfo, TransferVolume } from "../../types";

export function SelectDestination() {
  const {
    servers,
    setServers,
    sourceServer,
    destServer,
    setDestServer,
    selectedVolumes,
    setSelectedVolumes,
    setStep,
  } = useAppStore();

  const [onlineMap, setOnlineMap] = useState<Record<number, boolean>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [conflictError, setConflictError] = useState<string>("");

  // Add/Edit server modal
  const [serverModalOpen, setServerModalOpen] = useState<boolean>(false);
  const [serverToEdit, setServerToEdit] = useState<Server | undefined>(undefined);

  // Passphrase modal
  const [activeServerForPassphrase, setActiveServerForPassphrase] =
    useState<Server | null>(null);
  const [passphraseLoading, setPassphraseLoading] = useState<boolean>(false);
  const [passphraseError, setPassphraseError] = useState<string>("");

  // Connecting state (e.g. when trying cached passphrase)
  const [isConnectingDest, setIsConnectingDest] = useState<boolean>(false);

  // Conflict state
  const [isCheckingConflicts, setIsCheckingConflicts] = useState<boolean>(false);
  const [showConflictModal, setShowConflictModal] = useState<boolean>(false);
  const [destVolumeConflicts, setDestVolumeConflicts] =
    useState<DestVolumeInfo>({});

  const fetchAndPingServers = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const serverList = await invoke<Server[]>("list_servers");
      setServers(serverList);

      const pingResults = await Promise.all(
        serverList.map(async (server) => {
          try {
            const online = await invoke<boolean>("ping_server", {
              host: server.host,
              port: server.port,
            });
            return { id: server.id, online: Boolean(online) };
          } catch {
            return { id: server.id, online: false };
          }
        })
      );

      const map: Record<number, boolean> = {};
      for (const res of pingResults) {
        map[res.id] = res.online;
      }
      setOnlineMap(map);
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Failed to load servers";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [setServers]);

  useEffect(() => {
    fetchAndPingServers();
  }, [fetchAndPingServers]);

  const handleSelectServer = async (server: Server) => {
    if (sourceServer && server.id === sourceServer.id) return;
    const isOnline = onlineMap[server.id];
    if (!isOnline) return;

    if (isSameSshKey(sourceServer, server)) {
      setIsConnectingDest(true);
      setError("");
      try {
        await invoke("connect_server", {
          serverId: server.id,
          server_id: server.id,
          passphrase: null,
          role: "destination",
        });
        setDestServer(server);
      } catch {
        // Cached passphrase failed; ask user
        setActiveServerForPassphrase(server);
        setPassphraseError("");
      } finally {
        setIsConnectingDest(false);
      }
    } else {
      setActiveServerForPassphrase(server);
      setPassphraseError("");
    }
  };

  const handlePassphraseSubmit = async (passphrase: string) => {
    if (!activeServerForPassphrase) return;

    setPassphraseLoading(true);
    setPassphraseError("");

    try {
      await invoke("connect_server", {
        serverId: activeServerForPassphrase.id,
        server_id: activeServerForPassphrase.id,
        passphrase: passphrase.trim() ? passphrase : null,
        role: "destination",
      });

      setDestServer(activeServerForPassphrase);
      setActiveServerForPassphrase(null);
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Failed to connect to destination server";
      setPassphraseError(msg);
    } finally {
      setPassphraseLoading(false);
    }
  };

  const handleStartTransfer = async () => {
    if (!destServer || selectedVolumes.length === 0) return;

    setIsCheckingConflicts(true);
    setConflictError("");

    try {
      const volumeNames = selectedVolumes.map((v) => v.name);
      const conflicts = await invoke<DestVolumeInfo>("check_volumes_on_dest", {
        volumeNames,
        volume_names: volumeNames,
      });

      if (conflicts && Object.keys(conflicts).length > 0) {
        setDestVolumeConflicts(conflicts);
        setShowConflictModal(true);
      } else {
        setSelectedVolumes(
          selectedVolumes.map((v) => ({ ...v, action: "transfer" }))
        );
        setStep(4);
      }
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Failed to inspect destination volumes";
      setConflictError(msg);
    } finally {
      setIsCheckingConflicts(false);
    }
  };

  const handleConflictResolved = (resolvedVolumes: TransferVolume[]) => {
    setSelectedVolumes(resolvedVolumes);
    setShowConflictModal(false);
    setStep(4);
  };

  const handleAddServer = () => {
    setServerToEdit(undefined);
    setServerModalOpen(true);
  };

  const handleEditServer = (server: Server) => {
    setServerToEdit(server);
    setServerModalOpen(true);
  };

  const handleDeleteServer = async (server: Server) => {
    try {
      await invoke("delete_server", { id: server.id });
      if (destServer?.id === server.id) {
        setDestServer(null);
      }
      await fetchAndPingServers();
    } catch (err: unknown) {
      console.error("Failed to delete server:", err);
    }
  };

  const totalBytes = calculateTotalSize(selectedVolumes);

  return (
    <div className="flex-1 flex flex-col py-6 space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-xl font-semibold text-slate-100">
          Select Destination Server
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Choose target Docker server. Volumes will be transferred here.
        </p>
      </div>

      {/* Error Banners */}
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-sm text-red-300">
          {error}
        </div>
      )}
      {conflictError && (
        <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-sm text-red-300">
          {conflictError}
        </div>
      )}

      {/* Grid of Servers + Add Card */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
          <p className="text-sm">Scanning servers...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server) => {
            const isSource = Boolean(sourceServer && server.id === sourceServer.id);
            const isOnline = Boolean(onlineMap[server.id]);
            const isSelected = destServer?.id === server.id;
            const disabled = isSource || !isOnline;
            const disabledReason = isSource
              ? "Source server"
              : !isOnline
              ? "Server unreachable"
              : undefined;

            return (
              <ServerCard
                key={server.id}
                server={server}
                selected={isSelected}
                disabled={disabled}
                disabledReason={disabledReason}
                online={isOnline}
                onSelect={() => handleSelectServer(server)}
                onEdit={() => handleEditServer(server)}
                onDelete={() => handleDeleteServer(server)}
              />
            );
          })}

          {/* Add Server Card */}
          <button
            type="button"
            onClick={handleAddServer}
            className="group min-h-[140px] rounded-xl border border-dashed border-slate-700 hover:border-blue-500/80 bg-slate-800/30 hover:bg-slate-800/60 p-6 flex flex-col items-center justify-center text-center transition-all cursor-pointer"
          >
            <div className="w-10 h-10 rounded-full bg-slate-800 group-hover:bg-blue-600/20 text-slate-400 group-hover:text-blue-400 flex items-center justify-center mb-3 transition-colors border border-slate-700 group-hover:border-blue-500/40">
              <Plus className="w-5 h-5" />
            </div>
            <span className="text-sm font-medium text-slate-300 group-hover:text-blue-400 transition-colors">
              Add New Server
            </span>
            <span className="text-xs text-slate-500 mt-1">
              Configure SSH connection
            </span>
          </button>
        </div>
      )}

      {/* Connecting Destination Indicator */}
      {isConnectingDest && (
        <div className="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl flex items-center space-x-2 text-sm text-blue-300">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Connecting to destination with cached SSH credentials...</span>
        </div>
      )}

      {/* Transfer Summary Panel */}
      {destServer && (
        <div className="p-5 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Transfer Summary
          </h3>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center space-x-3 text-sm">
              <span className="font-mono font-medium text-slate-200 bg-slate-900/80 px-2.5 py-1 rounded border border-slate-700">
                {sourceServer?.name || "Source"}
              </span>
              <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="font-mono font-medium text-blue-300 bg-blue-950/40 px-2.5 py-1 rounded border border-blue-800/60">
                {destServer.name}
              </span>
            </div>

            <div className="flex items-center space-x-3 text-sm text-slate-300">
              <span className="flex items-center space-x-1">
                <HardDrive className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-100">
                  {selectedVolumes.length}
                </span>
                <span>{selectedVolumes.length === 1 ? "volume" : "volumes"}</span>
              </span>
              <span className="text-slate-600">·</span>
              <span className="font-mono font-medium text-blue-400">
                {formatBytes(totalBytes)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={() => setStep(2)}
          className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <button
          type="button"
          onClick={handleStartTransfer}
          disabled={
            !destServer ||
            selectedVolumes.length === 0 ||
            isCheckingConflicts ||
            isConnectingDest
          }
          className="flex items-center space-x-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border-slate-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg border border-transparent shadow-sm transition-colors"
        >
          {isCheckingConflicts ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Checking conflicts...</span>
            </>
          ) : (
            <>
              <span>Start Transfer</span>
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>

      {/* Add / Edit Server Modal */}
      <AddServerModal
        open={serverModalOpen}
        server={serverToEdit}
        onClose={() => setServerModalOpen(false)}
        onSaved={async () => {
          setServerModalOpen(false);
          await fetchAndPingServers();
        }}
      />

      {/* Passphrase Modal */}
      <PassphraseModal
        open={Boolean(activeServerForPassphrase)}
        serverName={activeServerForPassphrase?.name || ""}
        onSubmit={handlePassphraseSubmit}
        onCancel={() => {
          setActiveServerForPassphrase(null);
          setPassphraseError("");
        }}
        error={passphraseError}
        isLoading={passphraseLoading}
      />

      {/* Conflict Modal */}
      <ConflictModal
        open={showConflictModal}
        volumes={selectedVolumes}
        destVolumes={destVolumeConflicts}
        onResolved={handleConflictResolved}
        onCancel={() => setShowConflictModal(false)}
      />
    </div>
  );
}

export default SelectDestination;
