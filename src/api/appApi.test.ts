import { beforeEach, describe, expect, it } from "vitest";
import {
  createDownload,
  getAppStatus,
  listDownloads,
  openDownloadDir,
  openDownloadFile,
  pauseDownload,
  pauseAllDownloads,
  previewDownload,
  purgeStoppedDownloads,
  removeDownload,
  resetFallbackDownloadsForTest,
  retryDownload,
  resumeDownload,
  resumeAllDownloads,
  updateQueueSettings,
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
      maxActiveDownloads: 3,
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

  it("accepts proxy settings in fallback download creation", async () => {
    const task = await createDownload({
      url: "https://example.com/proxy.zip",
      saveDir: "D:\\Downloads",
      split: 6,
      proxyUrl: "http://127.0.0.1:7890",
    });

    expect(task.url).toBe("https://example.com/proxy.zip");
    expect(task.options.split).toBe(6);
    expect(task.options.proxyUrl).toBe("http://127.0.0.1:7890");
  });

  it("accepts per-task speed limits in fallback download creation", async () => {
    const task = await createDownload({
      url: "https://example.com/limited.zip",
      saveDir: "D:\\Downloads",
      split: 4,
      speedLimit: 512 * 1024,
    });

    expect(task.options.split).toBe(4);
    expect(task.options.maxConnectionPerServer).toBe(4);
    expect(task.options.speedLimit).toBe(512 * 1024);
  });

  it("stores fallback queue settings and exposes batch controls", async () => {
    const first = await createDownload({
      url: "https://example.com/first.zip",
      saveDir: "D:\\Downloads",
    });
    const second = await createDownload({
      url: "https://example.com/second.zip",
      saveDir: "D:\\Downloads",
    });

    await updateQueueSettings({ maxActiveDownloads: 1 });
    await resumeAllDownloads();
    await expect(listDownloads()).resolves.toMatchObject([
      { id: second.id, status: "active" },
      { id: first.id, status: "waiting" },
    ]);

    await pauseAllDownloads();
    await expect(listDownloads()).resolves.toMatchObject([
      { status: "paused" },
      { status: "paused" },
    ]);

    await createDownload({
      url: "https://example.com/done.zip",
      saveDir: "D:\\Downloads",
    });
    const downloads = await listDownloads();
    downloads[0].status = "complete";

    await purgeStoppedDownloads();
    await expect(listDownloads()).resolves.toMatchObject([
      { status: "paused" },
      { status: "paused" },
    ]);
  });

  it("previews fallback download metadata from the URL", async () => {
    await expect(
      previewDownload({ url: "https://example.com/releases/app.zip?token=abc" }),
    ).resolves.toEqual({
      url: "https://example.com/releases/app.zip?token=abc",
      fileName: "app.zip",
      totalBytes: null,
      resumable: true,
    });
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
      proxyUrl: "http://127.0.0.1:7890",
    });
    await pauseDownload(failedTask.gid!);

    const retriedTask = await retryDownload(failedTask.gid!);

    expect(retriedTask.id).not.toBe(failedTask.id);
    expect(retriedTask.url).toBe(failedTask.url);
    expect(retriedTask.fileName).toBe(failedTask.fileName);
    expect(retriedTask.saveDir).toBe(failedTask.saveDir);
    expect(retriedTask.options.split).toBe(10);
    expect(retriedTask.options.proxyUrl).toBe("http://127.0.0.1:7890");
    expect(retriedTask.status).toBe("waiting");
  });
});
