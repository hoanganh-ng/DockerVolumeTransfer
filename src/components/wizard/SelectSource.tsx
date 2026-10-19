import { useEffect, useState, useCallback } from "react";
import { Plus, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import { ServerCard, AddServerModal, PassphraseModal } from "../servers";
import type { Server } from "../../types";

export function SelectSource() {
  const {
    servers,
    setServers,
    sourceServer,
    setSourceServer,
    destServer,
    setDestServer,
    setSelectedVolumes,
    setStep,
  } = useAppStore();

  const [onlineMap, setOnlineMap] = useState<Record<number, boolean>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // Add/Edit server modal
  const [serverModalOpen, setServerModalOpen] = useState<boolean>(false);
  const [serverToEdit, setServerToEdit] = useState<Server | undefined>(undefined);

  // Passphrase modal
  const [activeServerForPassphrase, setActiveServerForPassphrase] =
    useState<Server | null>(null);
  const [passphraseLoading, setPassphraseLoading] = useState<boolean>(false);
  const [passphraseError, setPassphraseError] = useState<string>("");

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
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Failed to load servers";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [setServers]);

  useEffect(() => {
    fetchAndPingServers();
  }, [fetchAndPingServers]);

  const handleSelectServer = (server: Server) => {
    const isOnline = onlineMap[server.id];
    if (!isOnline) return;

    setActiveServerForPassphrase(server);
    setPassphraseError("");
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
        role: "source",
      });

      if (sourceServer?.id !== activeServerForPassphrase.id) {
        setSelectedVolumes([]);
        if (destServer?.id === activeServerForPassphrase.id) {
          setDestServer(null);
        }
      }

      setSourceServer(activeServerForPassphrase);
      setActiveServerForPassphrase(null);
      setStep(2);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Failed to connect to server";
      setPassphraseError(msg);
    } finally {
      setPassphraseLoading(false);
    }
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
      if (sourceServer?.id === server.id) {
        setSourceServer(null);
      }
      await fetchAndPingServers();
    } catch (err: unknown) {
      console.error("Failed to delete server:", err);
    }
  };

  return (
    <div className="flex-1 flex flex-col py-6 space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-xl font-semibold text-slate-100">
          Select Source Server
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Choose the online Docker server where the source volumes are located.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-sm text-red-300">
          {error}
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
            const isOnline = Boolean(onlineMap[server.id]);
            const isSelected = sourceServer?.id === server.id;

            return (
              <ServerCard
                key={server.id}
                server={server}
                selected={isSelected}
                disabled={!isOnline}
                disabledReason={!isOnline ? "Server unreachable" : undefined}
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
    </div>
  );
}

export default SelectSource;
