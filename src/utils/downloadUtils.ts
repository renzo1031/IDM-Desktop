import type { DownloadTask, TaskCategory, TaskCounts } from "../types/download";

const byteUnits = ["B", "KB", "MB", "GB", "TB"];

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes === 0) {
    return "0 B";
  }

  const unitIndex = Math.min(
    Math.floor(Math.log(safeBytes) / Math.log(1024)),
    byteUnits.length - 1,
  );
  const value = safeBytes / 1024 ** unitIndex;

  return `${trimNumber(value)} ${byteUnits[unitIndex]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) {
    return "-";
  }

  const formatted = formatBytes(bytesPerSecond).replace(" ", "");
  return `${formatted.replace("MB", "M").replace("KB", "K").replace("GB", "G")}/s`;
}

export function formatRemainingTime(remainingBytes: number, bytesPerSecond: number): string {
  if (remainingBytes <= 0 || bytesPerSecond <= 0) {
    return "-";
  }

  const seconds = Math.ceil(remainingBytes / bytesPerSecond);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.ceil(minutes / 60);
  return `${hours}h`;
}

export function normalizeTask(task: DownloadTask): DownloadTask {
  const totalBytes = Math.max(0, task.totalBytes);

  return {
    ...task,
    totalBytes,
    completedBytes: Math.min(Math.max(0, task.completedBytes), totalBytes),
    downloadSpeed: Math.max(0, task.downloadSpeed),
    connections: Math.max(0, task.connections),
  };
}

export function filterTasks(tasks: DownloadTask[], category: TaskCategory): DownloadTask[] {
  if (category === "all") {
    return tasks;
  }

  return tasks.filter((task) => task.status === category);
}

export function getTaskCounts(tasks: DownloadTask[]): TaskCounts {
  return tasks.reduce<TaskCounts>(
    (counts, task) => {
      counts.all += 1;
      if (task.status !== "removed") {
        counts[task.status] += 1;
      }
      return counts;
    },
    {
      all: 0,
      active: 0,
      waiting: 0,
      paused: 0,
      complete: 0,
      error: 0,
    },
  );
}
