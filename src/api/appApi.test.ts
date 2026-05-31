import { beforeEach, describe, expect, it } from "vitest";
import {
  createDownload,
  getAppStatus,
  listDownloads,
  openDownloadDir,
  openDownloadFile,
  pauseDownload,
  removeDownload,
  resetFallbackDownloadsForTest,
  retryDownload,
  resumeDownload,
} from "./appApi";

describe("appApi", () => {
  beforeEach(() => {
    resetFallbackDownloadsForTest();
  });

  it("returns bundled aria2 fallback outside Tauri", async () => {
    await expect(getAppStatus()).resolves.toEqual({
      appName: "IDM Desktop",
      aria2Engine: "bundled",
      defaultSplit: 16,
    });
  });

  it("uses safe browser fallbacks outside Tauri", async () => {
    await expect(listDownloads()).resolves.toEqual([]);
    await expect(pauseDownload("gid")).resolves.toBeUndefined();

    const task = await createDownload({
      url: "https://example.com/file.zip",
      saveDir: "D:\\Downloads",
      split: 8,
    });

    expect(task.fileName).toBe("file.zip");
    expect(task.options.split).toBe(8);
    expect(task.status).toBe("waiting");
  });

  it("keeps fallback downloads in memory for browser previews", async () => {
    const task = await createDownload({
      url: "https://example.com/preview.zip",
      saveDir: "D:\\Downloads",
      split: 12,
    });

    await expect(listDownloads()).resolves.toEqual([task]);

    await pauseDownload(task.gid!);
    await expect(listDownloads()).resolves.toMatchObject([{ status: "paused" }]);

    await resumeDownload(task.gid!);
    await expect(listDownloads()).resolves.toMatchObject([{ status: "active" }]);

    await openDownloadFile(task.gid!);
    await openDownloadDir(task.gid!);

    await removeDownload(task.gid!, { deleteFile: true });
    await expect(listDownloads()).resolves.toEqual([]);
  });

  it("retries fallback downloads by cloning their saved metadata", async () => {
    const failedTask = await createDownload({
      url: "https://example.com/retry.zip",
      saveDir: "D:\\Downloads",
      fileName: "retry.zip",
      split: 10,
    });
    await pauseDownload(failedTask.gid!);

    const retriedTask = await retryDownload(failedTask.gid!);

    expect(retriedTask.id).not.toBe(failedTask.id);
    expect(retriedTask.url).toBe(failedTask.url);
    expect(retriedTask.fileName).toBe(failedTask.fileName);
    expect(retriedTask.saveDir).toBe(failedTask.saveDir);
    expect(retriedTask.options.split).toBe(10);
    expect(retriedTask.status).toBe("waiting");
  });
});
