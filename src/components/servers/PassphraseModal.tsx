import React, { useState, useEffect, useRef } from "react";
import { X, Loader2, Eye, EyeOff } from "lucide-react";

export interface PassphraseModalProps {
  open: boolean;
  serverName: string;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
  error?: string;
  isLoading?: boolean;
}

export function PassphraseModal({
  open,
  serverName,
  onSubmit,
  onCancel,
  error,
  isLoading = false,
}: PassphraseModalProps) {
  const [passphrase, setPassphrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassphrase("");
      setShowPassword(false);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setPassphrase("");
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !isLoading) {
        handleCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isLoading]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    const value = passphrase;
    setPassphrase("");
    onSubmit(value);
  };

  const handleCancel = () => {
    setPassphrase("");
    onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="passphrase-modal-title"
    >
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-2xl text-slate-100 relative animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-700">
          <div>
            <h3
              id="passphrase-modal-title"
              className="text-lg font-semibold text-slate-100"
            >
              SSH Key Passphrase
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Enter passphrase for <span className="text-slate-200 font-medium">{serverName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-700/60 transition-colors disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="ssh-passphrase-input"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Passphrase
            </label>
            <div className="relative">
              <input
                id="ssh-passphrase-input"
                ref={inputRef}
                type={showPassword ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Leave empty if key has no passphrase"
                disabled={isLoading}
                autoComplete="current-password"
                className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-600 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                aria-label={showPassword ? "Hide passphrase" : "Show passphrase"}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Error message area */}
            {error && (
              <div className="mt-2 text-xs text-red-400 bg-red-950/40 border border-red-800/60 rounded-lg p-2.5">
                {error}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isLoading}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-lg transition-colors border border-slate-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center space-x-2 shadow-sm shadow-blue-900/30"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <span>Connect</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PassphraseModal;
