export type DownloadStatus =
  | "waiting"
  | "active"
  | "paused"
  | "complete"
  | "error"
  | "removed";

export type TaskCategory =
  | "all"
  | "active"
  | "waiting"
  | "paused"
  | "complete"
  | "error";

export interface DownloadTaskOptions {
  split: number;
  maxConnectionPerServer: number;
  speedLimit: number;
  proxyUrl?: string | null;
}

export interface DownloadTask {
  id: string;
  gid: string | null;
  url: string;
  fileName: string;
  saveDir: string;
  totalBytes: number;
  completedBytes: number;
  downloadSpeed: number;
  connections: number;
  status: DownloadStatus;
  resumable: boolean;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  options: DownloadTaskOptions;
}

export interface TaskCounts {
  all: number;
  active: number;
  waiting: number;
  paused: number;
  complete: number;
  error: number;
}
