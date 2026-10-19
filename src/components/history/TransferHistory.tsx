import { useEffect, useState, useCallback, useMemo } from "react";
import {
  History,
  Search,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Loader2,
  AlertCircle,
  X,
  ArrowLeft,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import type { TransferRecord } from "../../types";
import {
  filterTransferHistory,
  sortTransferHistoryByDate,
  formatHistoryDate,
  formatHistoryDuration,
  truncateVolumes,
  getStatusBadgeConfig,
  type SortDirection,
} from "../../utils/historyUtils";
import { formatBytes } from "../wizard/wizardUtils";

export function TransferHistory() {
  const { setShowHistory, setHistory } = useAppStore();

  const [records, setRecords] = useState<TransferRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const data = await invoke<TransferRecord[]>("list_transfer_history");
      setRecords(data || []);
      setHistory(data || []);
    } catch (err: unknown) {
      const message =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Failed to load transfer history";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [setHistory]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
  };

  const filteredAndSortedRecords = useMemo(() => {
    const filtered = filterTransferHistory(records, searchQuery);
    return sortTransferHistoryByDate(filtered, sortDirection);
  }, [records, searchQuery, sortDirection]);

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-6 flex flex-col space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <History className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-slate-100 tracking-tight">
                Transfer History
              </h2>
              {!isLoading && !error && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                  {records.length}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Review and audit all past volume migrations
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowHistory(false)}
            className="flex items-center space-x-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 transition-colors shadow-sm"
            title="Return to Migration Wizard"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Wizard</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-24 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
          <p className="text-sm font-medium">Loading transfer history...</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 bg-slate-800/30 rounded-xl border border-slate-800 p-8 text-center">
          <div className="p-3 bg-red-500/10 rounded-full border border-red-500/20 text-red-400 mb-3">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-slate-200 mb-1">
            Failed to Load Transfer History
          </h3>
          <p className="text-sm text-slate-400 max-w-md mb-5">{error}</p>
          <button
            onClick={fetchHistory}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Retry</span>
          </button>
        </div>
      ) : records.length === 0 ? (
        /* Empty State: No records at all */
        <div className="flex-1 flex flex-col items-center justify-center py-24 bg-slate-800/20 rounded-xl border border-slate-800/80 p-8 text-center">
          <div className="p-4 bg-slate-800/80 rounded-2xl border border-slate-700 text-slate-500 mb-4">
            <History className="w-10 h-10" />
          </div>
          <h3 className="text-lg font-semibold text-slate-200 mb-1">
            No transfers yet
          </h3>
          <p className="text-sm text-slate-400 max-w-sm mb-6">
            Completed server-to-server Docker volume migrations will be recorded
            here.
          </p>
          <button
            onClick={() => setShowHistory(false)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
          >
            Start First Migration
          </button>
        </div>
      ) : (
        /* Records exist */
        <div className="flex flex-col space-y-4">
          {/* Controls: Search & Record Counter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by server or volume name..."
                className="w-full pl-9 pr-9 py-2 bg-slate-800/80 hover:bg-slate-800 focus:bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5 rounded transition-colors"
                  title="Clear filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <span>
                Showing {filteredAndSortedRecords.length} of {records.length}{" "}
                transfers
              </span>
            </div>
          </div>

          {/* Table or Filter Empty State */}
          {filteredAndSortedRecords.length === 0 ? (
            <div className="py-20 bg-slate-800/20 rounded-xl border border-slate-800/80 flex flex-col items-center justify-center text-center p-8">
              <div className="p-3 bg-slate-800 rounded-full border border-slate-700 text-slate-500 mb-3">
                <Search className="w-6 h-6" />
              </div>
              <h4 className="text-base font-semibold text-slate-200 mb-1">
                No matching transfers found
              </h4>
              <p className="text-sm text-slate-400 max-w-sm mb-4">
                No transfers matched your search query &quot;{searchQuery}&quot;.
              </p>
              <button
                onClick={() => setSearchQuery("")}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
              >
                Clear Filter
              </button>
            </div>
          ) : (
            <div className="bg-slate-800/40 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="bg-slate-800/80 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-700">
                    <tr>
                      <th
                        scope="col"
                        onClick={toggleSortDirection}
                        className="px-5 py-3.5 cursor-pointer select-none hover:text-slate-200 transition-colors group"
                        title="Click to toggle date sort order"
                      >
                        <div className="flex items-center space-x-1.5">
                          <span>Date</span>
                          {sortDirection === "desc" ? (
                            <ArrowDown className="w-3.5 h-3.5 text-blue-400" />
                          ) : (
                            <ArrowUp className="w-3.5 h-3.5 text-blue-400" />
                          )}
                        </div>
                      </th>
                      <th scope="col" className="px-5 py-3.5">
                        Source → Destination
                      </th>
                      <th scope="col" className="px-5 py-3.5">
                        Volumes
                      </th>
                      <th scope="col" className="px-5 py-3.5">
                        Total Size
                      </th>
                      <th scope="col" className="px-5 py-3.5">
                        Duration
                      </th>
                      <th scope="col" className="px-5 py-3.5">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredAndSortedRecords.map((record) => {
                      const statusConfig = getStatusBadgeConfig(record.status);
                      const volumesInfo = truncateVolumes(record.volume_names, 3);

                      return (
                        <tr
                          key={record.id}
                          className="hover:bg-slate-800/50 transition-colors"
                        >
                          {/* Date */}
                          <td className="px-5 py-4 whitespace-nowrap text-slate-300 font-mono text-xs">
                            {formatHistoryDate(record.started_at)}
                          </td>

                          {/* Source -> Destination */}
                          <td className="px-5 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-2 text-sm">
                              <span
                                className="font-medium text-slate-200"
                                title={record.source_server_name}
                              >
                                {record.source_server_name}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span
                                className="font-medium text-slate-200"
                                title={record.dest_server_name}
                              >
                                {record.dest_server_name}
                              </span>
                            </div>
                          </td>

                          {/* Volumes */}
                          <td className="px-5 py-4">
                            {volumesInfo.hasMore ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-slate-300 font-mono text-xs">
                                  {volumesInfo.visible.join(", ")}
                                </span>
                                <span
                                  className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-700/80 text-blue-300 border border-slate-600/80 cursor-help"
                                  title={record.volume_names.join(", ")}
                                >
                                  +{volumesInfo.remainingCount} more
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-300 font-mono text-xs">
                                {record.volume_names &&
                                record.volume_names.length > 0
                                  ? record.volume_names.join(", ")
                                  : "-"}
                              </span>
                            )}
                          </td>

                          {/* Total Size */}
                          <td className="px-5 py-4 whitespace-nowrap text-slate-300 font-mono text-xs">
                            {formatBytes(record.total_size_bytes)}
                          </td>

                          {/* Duration */}
                          <td className="px-5 py-4 whitespace-nowrap text-slate-300 font-mono text-xs">
                            {formatHistoryDuration(record.duration_seconds)}
                          </td>

                          {/* Status */}
                          <td className="px-5 py-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusConfig.className}`}
                            >
                              {statusConfig.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
