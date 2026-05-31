import { invoke } from "@tauri-apps/api/core";
import type { AppStatus } from "../types/appStatus";
import type { DownloadTask } from "../types/download";

const fallbackStatus: AppStatus = {
  appName: "IDM Desktop",
  aria2Engine: "bundled",
  defaultSplit: 16,
  maxActiveDownloads: 3,
};

let fallbackDownloads: DownloadTask[] = [];
let fallbackDownloadId = 0;
let fallbackMaxActiveDownloads = fallbackStatus.maxActiveDownloads;

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function updateFallbackDownload(
  gid: string,
  update: (task: DownloadTask) => DownloadTask,
): void {
  fallbackDownloads = fallbackDownloads.map((task) =>
    task.gid === gid ? update(task) : task,
  );
}

export function resetFallbackDownloadsForTest(): void {
  fallbackDownloads = [];
  fallbackDownloadId = 0;
  fallbackMaxActiveDownloads = fallbackStatus.maxActiveDownloads;
}

export async function getAppStatus(): Promise<AppStatus> {
  if (!isTauriRuntime()) {
    return {
      ...fallbackStatus,
      maxActiveDownloads: fallbackMaxActiveDownloads,
    };
  }

  return invoke<AppStatus>("app_status");
}

export interface CreateDownloadInput {
  url: string;
  saveDir: string;
  fileName?: string;
  totalBytes?: number | null;
  resumable?: boolean;
  split?: number;
  speedLimit?: number;
  proxyUrl?: string;
}

export interface PreviewDownloadInput {
  url: string;
  proxyUrl?: string;
}

export interface DownloadPreview {
  url: string;
  fileName: string;
  totalBytes: number | null;
  resumable: boolean;
}

function fallbackFileNameFromUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const rawName = parsedUrl.pathname.split("/").filter(Boolean).pop();
    return rawName ? decodeURIComponent(rawName) : "download.bin";
  } catch {
    const rawName = url.split(/[?#]/)[0].split("/").filter(Boolean).pop();
    return rawName ? decodeURIComponent(rawName) : "download.bin";
  }
}

export async function previewDownload(input: PreviewDownloadInput): Promise<DownloadPreview> {
  const url = input.url.trim();
  const proxyUrl = input.proxyUrl?.trim();
  if (!isTauriRuntime()) {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("仅支持 HTTP/HTTPS 下载链接");
    }

    return {
      url,
      fileName: fallbackFileNameFromUrl(url),
      totalBytes: null,
      resumable: true,
    };
  }

  return invoke<DownloadPreview>("preview_download", {
    input: { url, ...(proxyUrl ? { proxyUrl } : {}) },
  });
}

export async function listDownloads(): Promise<DownloadTask[]> {
  if (!isTauriRuntime()) {
    return [...fallbackDownloads];
  }

  return invoke<DownloadTask[]>("list_downloads");
}

export async function createDownload(input: CreateDownloadInput): Promise<DownloadTask> {
  if (!isTauriRuntime()) {
    const now = new Date().toISOString();
    const urlParts = input.url.split("/").filter(Boolean);
    const fallbackName = input.fileName ?? urlParts[urlParts.length - 1] ?? "download.bin";
    fallbackDownloadId += 1;
    const gid = `mock-${fallbackDownloadId}`;

    const task: DownloadTask = {
      id: gid,
      gid,
      url: input.url,
      fileName: fallbackName,
      saveDir: input.saveDir,
      totalBytes: input.totalBytes ?? 0,
      completedBytes: 0,
      downloadSpeed: 0,
      connections: 0,
      status: "waiting",
      resumable: input.resumable ?? true,
      createdAt: now,
      updatedAt: now,
      options: {
        split: input.split ?? 16,
        maxConnectionPerServer: input.split ?? 16,
        speedLimit: input.speedLimit ?? 0,
        proxyUrl: input.proxyUrl?.trim() || null,
      },
    };
    fallbackDownloads = [task, ...fallbackDownloads];

    return task;
  }

  return invoke<DownloadTask>("create_download", { input });
}

export async function pauseDownload(gid: string): Promise<void> {
  if (!isTauriRuntime()) {
    updateFallbackDownload(gid, (task) => ({
      ...task,
      downloadSpeed: 0,
      status: "paused",
      updatedAt: new Date().toISOString(),
    }));
    return;
  }

  return invoke<void>("pause_download", { gid });
}

export async function resumeDownload(gid: string): Promise<void> {
  if (!isTauriRuntime()) {
    updateFallbackDownload(gid, (task) => ({
      ...task,
      status: "active",
      updatedAt: new Date().toISOString(),
    }));
    return;
  }

  return invoke<void>("resume_download", { gid });
}

export interface QueueSettingsInput {
  maxActiveDownloads: number;
}

function clampMaxActiveDownloads(value: number): number {
  if (!Number.isFinite(value)) {
    return fallbackStatus.maxActiveDownloads;
  }

  return Math.min(64, Math.max(1, Math.round(value)));
}

export async function updateQueueSettings(input: QueueSettingsInput): Promise<void> {
  const maxActiveDownloads = clampMaxActiveDownloads(input.maxActiveDownloads);
  if (!isTauriRuntime()) {
    fallbackMaxActiveDownloads = maxActiveDownloads;
    return;
  }

  return invoke<void>("update_queue_settings", {
    input: { maxActiveDownloads },
  });
}

export async function pauseAllDownloads(): Promise<void> {
  if (!isTauriRuntime()) {
    const now = new Date().toISOString();
    fallbackDownloads = fallbackDownloads.map((task) => {
      if (!["active", "waiting", "paused"].includes(task.status)) {
        return task;
      }

      return {
        ...task,
        downloadSpeed: 0,
        status: "paused",
        updatedAt: now,
      };
    });
    return;
  }

  return invoke<void>("pause_all_downloads");
}

export async function resumeAllDownloads(): Promise<void> {
  if (!isTauriRuntime()) {
    const now = new Date().toISOString();
    let activeCount = 0;
    fallbackDownloads = fallbackDownloads.map((task) => {
      if (!["paused", "waiting", "active"].includes(task.status)) {
        return task;
      }

      activeCount += 1;
      return {
        ...task,
        status: activeCount <= fallbackMaxActiveDownloads ? "active" : "waiting",
        updatedAt: now,
      };
    });
    return;
  }

  return invoke<void>("resume_all_downloads");
}

export async function purgeStoppedDownloads(): Promise<void> {
  if (!isTauriRuntime()) {
    fallbackDownloads = fallbackDownloads.filter(
      (task) => task.status !== "complete" && task.status !== "error",
    );
    return;
  }

  return invoke<void>("purge_stopped_downloads");
}

export interface RemoveDownloadOptions {
  deleteFile?: boolean;
}

export async function removeDownload(
  gid: string,
  options: RemoveDownloadOptions = {},
): Promise<void> {
  if (!isTauriRuntime()) {
    fallbackDownloads = fallbackDownloads.filter((task) => task.gid !== gid);
    return;
  }

  if (options.deleteFile) {
    return invoke<void>("remove_download_with_file", { gid, deleteFile: true });
  }

  return invoke<void>("remove_download_with_file", { gid, deleteFile: false });
}

export async function openDownloadFile(gid: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  return invoke<void>("open_download_file", { gid });
}

export async function openDownloadDir(gid: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  return invoke<void>("open_download_dir", { gid });
}

export async function retryDownload(gid: string): Promise<DownloadTask> {
  if (!isTauriRuntime()) {
    const task = fallbackDownloads.find((item) => item.gid === gid || item.id === gid);
    if (!task) {
      throw new Error("任务不存在");
    }

    return createDownload({
      url: task.url,
      saveDir: task.saveDir,
      fileName: task.fileName,
      split: task.options.split,
      proxyUrl: task.options.proxyUrl ?? undefined,
    });
  }

  return invoke<DownloadTask>("retry_download", { gid });
}
