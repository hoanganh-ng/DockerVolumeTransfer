import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { Server } from "../../types";

export interface ServerCardProps {
  server: Server;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
  online: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ServerCard({
  server,
  selected,
  disabled,
  disabledReason,
  online,
  onSelect,
  onEdit,
  onDelete,
}: ServerCardProps) {
  const handleClick = () => {
    if (!disabled) {
      onSelect();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Enter" || e.key === " ") && !disabled) {
      e.preventDefault();
      onSelect();
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete server "${server.name}"?`)) {
      onDelete();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={disabled ? disabledReason || "Server unavailable" : undefined}
      className={`group relative rounded-xl border p-4 transition-all select-none text-left flex flex-col justify-between ${
        disabled
          ? "opacity-30 cursor-not-allowed bg-slate-800/50 border-slate-700"
          : selected
          ? "bg-slate-800 border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/10 cursor-pointer"
          : "bg-slate-800/80 hover:bg-slate-800 border-slate-700 hover:border-slate-600 cursor-pointer"
      }`}
      data-testid={`server-card-${server.id}`}
    >
      <div>
        {/* Top row: Status dot + Server Name + Action Buttons */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2.5 min-w-0 flex-1">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                online
                  ? "bg-emerald-500 shadow-sm shadow-emerald-500/50"
                  : "bg-red-500 shadow-sm shadow-red-500/50"
              }`}
              title={online ? "Online" : "Offline"}
              aria-label={online ? "Online" : "Offline"}
            />
            <h3 className="font-bold text-slate-100 text-base truncate">
              {server.name}
            </h3>
          </div>

          <div className="flex items-center space-x-1 shrink-0">
            <button
              type="button"
              onClick={handleEdit}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 rounded-md transition-colors"
              title="Edit server"
              aria-label={`Edit ${server.name}`}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700/60 rounded-md transition-colors"
              title="Delete server"
              aria-label={`Delete ${server.name}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Server Host / IP */}
        <div className="mt-2 text-sm text-slate-300 font-mono truncate">
          {server.host}
        </div>

        {/* Username @ Port */}
        <div className="mt-0.5 text-xs text-slate-400 font-mono truncate">
          {server.username}@{server.port}
        </div>
      </div>

      {/* Disabled reason tag if disabled */}
      {disabled && disabledReason && (
        <div className="mt-3 pt-2 border-t border-slate-700/50 text-xs text-amber-400/90 truncate font-medium">
          {disabledReason}
        </div>
      )}
    </div>
  );
}

export default ServerCard;
