import React, { useState, useEffect } from "react";
import { X, Loader2, FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { Server } from "../../types";
import { PassphraseModal } from "./PassphraseModal";
import { validateServerInput } from "./serverValidation";

export interface AddServerModalProps {
  open: boolean;
  onClose: () => void;
  server?: Server;
  onSaved: () => void;
}

export function AddServerModal({
  open,
  onClose,
  server,
  onSaved,
}: AddServerModalProps) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState<number | string>(22);
  const [sshKeyPath, setSshKeyPath] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState("");

  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [passphraseError, setPassphraseError] = useState("");

  // Populate or reset form when modal opens or server changes
  useEffect(() => {
    if (open) {
      if (server) {
        setName(server.name);
        setHost(server.host);
        setUsername(server.username);
        setPort(server.port);
        setSshKeyPath(server.ssh_key_path);
      } else {
        setName("");
        setHost("");
        setUsername("");
        setPort(22);
        setSshKeyPath("");
      }
      setErrors({});
      setGeneralError("");
      setShowPassphraseModal(false);
      setPassphraseError("");
      setIsTesting(false);
    }
  }, [open, server]);

  if (!open) return null;

  const handleBrowseKey = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
      });

      if (selected && typeof selected === "string") {
        setSshKeyPath(selected);
        if (errors.ssh_key_path) {
          setErrors((prev) => {
            const next = { ...prev };
            delete next.ssh_key_path;
            return next;
          });
        }
      }
    } catch (err) {
      console.warn("Failed to open file picker:", err);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError("");

    const validation = validateServerInput({
      name,
      host,
      username,
      port,
      ssh_key_path: sshKeyPath,
    });

    if (!validation.valid) {
      setErrors(validation.errors as Record<string, string>);
      return;
    }

    setErrors({});
    setPassphraseError("");
    setShowPassphraseModal(true);
  };

  const handlePassphraseSubmit = async (passphrase: string) => {
    setIsTesting(true);
    setPassphraseError("");

    const portNumber = Number(port);

    try {
      // Step 1: test connection with SSH key + passphrase
      await invoke("test_connection", {
        host: host.trim(),
        port: portNumber,
        username: username.trim(),
        sshKeyPath: sshKeyPath.trim(),
        ssh_key_path: sshKeyPath.trim(),
        passphrase: passphrase ? passphrase : null,
      });

      // Step 2: save or update server in SQLite database
      if (server?.id) {
        await invoke("update_server", {
          id: server.id,
          name: name.trim(),
          host: host.trim(),
          username: username.trim(),
          port: portNumber,
          sshKeyPath: sshKeyPath.trim(),
          ssh_key_path: sshKeyPath.trim(),
        });
      } else {
        await invoke("add_server", {
          name: name.trim(),
          host: host.trim(),
          username: username.trim(),
          port: portNumber,
          sshKeyPath: sshKeyPath.trim(),
          ssh_key_path: sshKeyPath.trim(),
        });
      }

      setShowPassphraseModal(false);
      onSaved();
      onClose();
    } catch (err: unknown) {
      const message =
        typeof err === "string"
          ? err
          : err instanceof Error
          ? err.message
          : "Failed to connect to server";

      setPassphraseError(message);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-server-modal-title"
      >
        <div className="w-full max-w-lg bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-2xl text-slate-100 relative animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-700">
            <h3
              id="add-server-modal-title"
              className="text-lg font-semibold text-slate-100"
            >
              {server ? "Edit Server" : "Add Server"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-700/60 transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleFormSubmit} className="mt-4 space-y-4">
            {/* Server Name */}
            <div>
              <label
                htmlFor="server-name-input"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Server Name
              </label>
              <input
                id="server-name-input"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) {
                    setErrors((prev) => ({ ...prev, name: "" }));
                  }
                }}
                placeholder="e.g. Production Web"
                className={`w-full px-3.5 py-2 bg-slate-900/90 border rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                  errors.name ? "border-red-500 focus:ring-red-500" : "border-slate-600"
                }`}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-400">{errors.name}</p>
              )}
            </div>

            {/* Host/IP & Port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label
                  htmlFor="server-host-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Host / IP
                </label>
                <input
                  id="server-host-input"
                  type="text"
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value);
                    if (errors.host) {
                      setErrors((prev) => ({ ...prev, host: "" }));
                    }
                  }}
                  placeholder="192.168.1.10 or server.example.com"
                  className={`w-full px-3.5 py-2 bg-slate-900/90 border rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                    errors.host ? "border-red-500 focus:ring-red-500" : "border-slate-600"
                  }`}
                />
                {errors.host && (
                  <p className="mt-1 text-xs text-red-400">{errors.host}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="server-port-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Port
                </label>
                <input
                  id="server-port-input"
                  type="number"
                  min="1"
                  max="65535"
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value);
                    if (errors.port) {
                      setErrors((prev) => ({ ...prev, port: "" }));
                    }
                  }}
                  className={`w-full px-3.5 py-2 bg-slate-900/90 border rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                    errors.port ? "border-red-500 focus:ring-red-500" : "border-slate-600"
                  }`}
                />
                {errors.port && (
                  <p className="mt-1 text-xs text-red-400">{errors.port}</p>
                )}
              </div>
            </div>

            {/* Username */}
            <div>
              <label
                htmlFor="server-username-input"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Username
              </label>
              <input
                id="server-username-input"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (errors.username) {
                    setErrors((prev) => ({ ...prev, username: "" }));
                  }
                }}
                placeholder="e.g. root or ubuntu"
                className={`w-full px-3.5 py-2 bg-slate-900/90 border rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                  errors.username ? "border-red-500 focus:ring-red-500" : "border-slate-600"
                }`}
              />
              {errors.username && (
                <p className="mt-1 text-xs text-red-400">{errors.username}</p>
              )}
            </div>

            {/* SSH Key Path with Browse button */}
            <div>
              <label
                htmlFor="server-ssh-key-input"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                SSH Private Key Path
              </label>
              <div className="flex space-x-2">
                <input
                  id="server-ssh-key-input"
                  type="text"
                  value={sshKeyPath}
                  onChange={(e) => {
                    setSshKeyPath(e.target.value);
                    if (errors.ssh_key_path) {
                      setErrors((prev) => ({ ...prev, ssh_key_path: "" }));
                    }
                  }}
                  placeholder="/home/user/.ssh/id_ed25519"
                  className={`flex-1 px-3.5 py-2 bg-slate-900/90 border rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                    errors.ssh_key_path
                      ? "border-red-500 focus:ring-red-500"
                      : "border-slate-600"
                  }`}
                />
                <button
                  type="button"
                  onClick={handleBrowseKey}
                  className="px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-lg border border-slate-600 transition-colors flex items-center space-x-1.5 shrink-0"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>Browse</span>
                </button>
              </div>
              {errors.ssh_key_path && (
                <p className="mt-1 text-xs text-red-400">{errors.ssh_key_path}</p>
              )}
            </div>

            {/* General form error if any */}
            {generalError && (
              <div className="text-xs text-red-400 bg-red-950/40 border border-red-800/60 rounded-lg p-2.5">
                {generalError}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-700">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-lg transition-colors border border-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isTesting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center space-x-2 shadow-sm shadow-blue-900/30"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <span>Test &amp; Save</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Passphrase prompt modal */}
      <PassphraseModal
        open={showPassphraseModal}
        serverName={name || host || "Server"}
        onSubmit={handlePassphraseSubmit}
        onCancel={() => {
          setShowPassphraseModal(false);
          setPassphraseError("");
        }}
        error={passphraseError}
        isLoading={isTesting}
      />
    </>
  );
}

export default AddServerModal;
