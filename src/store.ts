import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  Server,
  Volume,
  TransferVolume,
  TransferEvent,
  TransferSummary,
  TransferRecord,
} from "./types";

export interface AppState {
  step: number;
  servers: Server[];
  sourceServer: Server | null;
  destServer: Server | null;
  volumes: Volume[];
  selectedVolumes: TransferVolume[];
  transferEvents: Map<string, TransferEvent>;
  transferSummary: TransferSummary | null;
  history: TransferRecord[];
  showHistory: boolean;

  setStep: (step: number) => void;
  setServers: (servers: Server[]) => void;
  setSourceServer: (server: Server | null) => void;
  setDestServer: (server: Server | null) => void;
  setVolumes: (volumes: Volume[]) => void;
  setSelectedVolumes: (volumes: TransferVolume[]) => void;
  toggleVolume: (
    volume: Volume | { name: string; size_bytes?: number },
    defaultAction?: "transfer" | "overwrite" | "skip"
  ) => void;
  selectAllVolumes: (volumes?: Volume[]) => void;
  updateVolumeSize: (volumeName: string, sizeBytes: number) => void;
  updateVolumeAction: (
    volumeName: string,
    action: "transfer" | "overwrite" | "skip"
  ) => void;
  setTransferEvent: (volumeName: string, event: TransferEvent) => void;
  setTransferSummary: (summary: TransferSummary | null) => void;
  setHistory: (history: TransferRecord[]) => void;
  setShowHistory: (show: boolean) => void;
  fetchHistory: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  step: 1,
  servers: [],
  sourceServer: null,
  destServer: null,
  volumes: [],
  selectedVolumes: [],
  transferEvents: new Map<string, TransferEvent>(),
  transferSummary: null,
  history: [],
  showHistory: false,
};

export const useAppStore = create<AppState>()((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  setServers: (servers) => set({ servers }),

  setSourceServer: (sourceServer) => set({ sourceServer }),

  setDestServer: (destServer) => set({ destServer }),

  setVolumes: (volumes) => set({ volumes }),

  setSelectedVolumes: (selectedVolumes) => set({ selectedVolumes }),

  toggleVolume: (volume, defaultAction = "transfer") => {
    const { selectedVolumes } = get();
    const exists = selectedVolumes.some((v) => v.name === volume.name);
    if (exists) {
      set({
        selectedVolumes: selectedVolumes.filter((v) => v.name !== volume.name),
      });
    } else {
      const size_bytes = "size_bytes" in volume && typeof volume.size_bytes === "number"
        ? volume.size_bytes
        : 0;
      set({
        selectedVolumes: [
          ...selectedVolumes,
          {
            name: volume.name,
            size_bytes,
            action: defaultAction,
          },
        ],
      });
    }
  },

  selectAllVolumes: (volumes) => {
    const { volumes: storeVolumes, selectedVolumes } = get();
    const targetVolumes = volumes ?? storeVolumes;
    if (targetVolumes.length === 0) return;

    const allSelected =
      targetVolumes.length === selectedVolumes.length &&
      targetVolumes.every((v) => selectedVolumes.some((sv) => sv.name === v.name));

    if (allSelected) {
      set({ selectedVolumes: [] });
    } else {
      const selectedMap = new Map(selectedVolumes.map((v) => [v.name, v]));
      const newSelected: TransferVolume[] = targetVolumes.map((v) => {
        const existing = selectedMap.get(v.name);
        if (existing) {
          return existing;
        }
        return {
          name: v.name,
          size_bytes: 0,
          action: "transfer",
        };
      });
      set({ selectedVolumes: newSelected });
    }
  },

  updateVolumeSize: (volumeName, sizeBytes) => {
    const { selectedVolumes } = get();
    set({
      selectedVolumes: selectedVolumes.map((v) =>
        v.name === volumeName ? { ...v, size_bytes: sizeBytes } : v
      ),
    });
  },

  updateVolumeAction: (volumeName, action) => {
    const { selectedVolumes } = get();
    set({
      selectedVolumes: selectedVolumes.map((v) =>
        v.name === volumeName ? { ...v, action } : v
      ),
    });
  },

  setTransferEvent: (volumeName, event) => {
    const { transferEvents } = get();
    const updated = new Map(transferEvents);
    updated.set(volumeName, event);
    set({ transferEvents: updated });
  },

  setTransferSummary: (transferSummary) => set({ transferSummary }),

  setHistory: (history) => set({ history }),

  setShowHistory: (showHistory) => set({ showHistory }),

  fetchHistory: async () => {
    try {
      const records = await invoke<TransferRecord[]>("list_transfer_history");
      set({ history: records });
    } catch (error) {
      console.error("Failed to fetch transfer history:", error);
    }
  },

  reset: () => {
    set({
      step: 1,
      sourceServer: null,
      destServer: null,
      volumes: [],
      selectedVolumes: [],
      transferEvents: new Map(),
      transferSummary: null,
      showHistory: false,
    });
  },
}));
