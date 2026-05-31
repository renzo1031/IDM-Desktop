import { invoke } from "@tauri-apps/api/core";
import type { AppStatus } from "../types/appStatus";
import type { DownloadTask } from "../types/download";

const fallbackStatus: AppStatus = {
  appName: "IDM Desktop",
  aria2Engine: "bundled",
  defaultSplit: 16,
};

export async function getAppStatus(): Promise<AppStatus> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return fallbackStatus;
  }

  return invoke<AppStatus>("app_status");
}

export interface CreateDownloadInput {
  url: string;
  saveDir: string;
  fileName?: string;
  split?: number;
}

export async function listDownloads(): Promise<DownloadTask[]> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return [];
  }

  return invoke<DownloadTask[]>("list_downloads");
}

export async function createDownload(input: CreateDownloadInput): Promise<DownloadTask> {
  if (!("__TAURI_INTERNALS__" in window)) {
    const now = new Date().toISOString();
    const urlParts = input.url.split("/").filter(Boolean);
    const fallbackName = input.fileName ?? urlParts[urlParts.length - 1] ?? "download.bin";

    return {
      id: `mock-${Date.now()}`,
      gid: `mock-${Date.now()}`,
      url: input.url,
      fileName: fallbackName,
      saveDir: input.saveDir,
      totalBytes: 0,
      completedBytes: 0,
      downloadSpeed: 0,
      connections: 0,
      status: "waiting",
      resumable: true,
      createdAt: now,
      updatedAt: now,
      options: {
        split: input.split ?? 16,
        maxConnectionPerServer: input.split ?? 16,
        speedLimit: 0,
      },
    };
  }

  return invoke<DownloadTask>("create_download", { input });
}

export async function pauseDownload(gid: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  return invoke<void>("pause_download", { gid });
}

export async function resumeDownload(gid: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  return invoke<void>("resume_download", { gid });
}

export async function removeDownload(gid: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  return invoke<void>("remove_download", { gid });
}
