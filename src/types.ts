export interface Server {
  id: number;
  name: string;
  host: string;
  username: string;
  port: number;
  ssh_key_path: string;
  host_key_fingerprint: string | null;
}

export interface Volume {
  name: string;
  driver: string;
  in_use: boolean;
}

export interface TransferVolume {
  name: string;
  size_bytes: number;
  action: "transfer" | "overwrite" | "skip";
}

export interface TransferEvent {
  volume_name: string;
  status: string;
  bytes_transferred: number;
  total_bytes: number;
  speed_bps: number;
}

export type TransferStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "failed"
  | "skipped"
  | "cancelled";

export interface VolumeResult {
  name: string;
  size_bytes: number;
  duration_seconds: number;
  status: string;
  error: string | null;
}

export interface TransferSummary {
  volumes: VolumeResult[];
  total_bytes: number;
  duration_seconds: number;
}

export interface TransferRecord {
  id: number;
  source_server_name: string;
  dest_server_name: string;
  volume_names: string[];
  total_size_bytes: number;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  status: string;
}

export type DestVolumeInfo = Record<string, number>;
