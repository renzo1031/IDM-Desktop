import { describe, expect, it } from "vitest";
import {
  filterTasks,
  formatBytes,
  formatRemainingTime,
  formatSpeed,
  getTaskCounts,
  normalizeTask,
} from "./downloadUtils";
import type { DownloadTask } from "../types/download";

const tasks: DownloadTask[] = [
  {
    id: "1",
    gid: "gid-1",
    url: "https://example.com/ubuntu.iso",
    fileName: "ubuntu.iso",
    saveDir: "D:\\Downloads",
    totalBytes: 1024 * 1024 * 1024,
    completedBytes: 512 * 1024 * 1024,
    downloadSpeed: 4 * 1024 * 1024,
    connections: 16,
    status: "active",
    resumable: true,
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:01:00.000Z",
    options: { split: 16, maxConnectionPerServer: 16, speedLimit: 0 },
  },
  {
    id: "2",
    gid: "gid-2",
    url: "https://example.com/video.mp4",
    fileName: "video.mp4",
    saveDir: "D:\\Downloads",
    totalBytes: 100,
    completedBytes: 100,
    downloadSpeed: 0,
    connections: 0,
    status: "complete",
    resumable: true,
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:02:00.000Z",
    options: { split: 8, maxConnectionPerServer: 8, speedLimit: 0 },
  },
  {
    id: "3",
    gid: null,
    url: "https://example.com/archive.zip",
    fileName: "archive.zip",
    saveDir: "D:\\Downloads",
    totalBytes: 1000,
    completedBytes: 100,
    downloadSpeed: 0,
    connections: 0,
    status: "error",
    resumable: false,
    errorMessage: "服务器不支持断点续传",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:03:00.000Z",
    options: { split: 16, maxConnectionPerServer: 16, speedLimit: 0 },
  },
];

describe("downloadUtils", () => {
  it("formats byte and speed values for compact task rows", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatSpeed(8.4 * 1024 * 1024)).toBe("8.4M/s");
    expect(formatSpeed(0)).toBe("-");
  });

  it("formats remaining time from bytes and speed", () => {
    expect(formatRemainingTime(1024, 512)).toBe("2s");
    expect(formatRemainingTime(120 * 1024 * 1024, 1024 * 1024)).toBe("2m");
    expect(formatRemainingTime(0, 0)).toBe("-");
  });

  it("filters tasks by sidebar category", () => {
    expect(filterTasks(tasks, "all")).toHaveLength(3);
    expect(filterTasks(tasks, "active").map((task) => task.id)).toEqual(["1"]);
    expect(filterTasks(tasks, "complete").map((task) => task.id)).toEqual(["2"]);
    expect(filterTasks(tasks, "error").map((task) => task.id)).toEqual(["3"]);
  });

  it("counts tasks for sidebar badges", () => {
    expect(getTaskCounts(tasks)).toEqual({
      all: 3,
      active: 1,
      waiting: 0,
      paused: 0,
      complete: 1,
      error: 1,
    });
  });

  it("normalizes incoming task data with safe numeric bounds", () => {
    const task = normalizeTask({
      ...tasks[0],
      completedBytes: 2048,
      totalBytes: 1024,
      downloadSpeed: -1,
      connections: -3,
    });

    expect(task.completedBytes).toBe(1024);
    expect(task.downloadSpeed).toBe(0);
    expect(task.connections).toBe(0);
  });
});
