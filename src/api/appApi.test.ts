import { beforeEach, describe, expect, it } from "vitest";
import {
  createDownload,
  getAppStatus,
  listDownloads,
  pauseDownload,
  removeDownload,
  resetFallbackDownloadsForTest,
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

    await removeDownload(task.gid!);
    await expect(listDownloads()).resolves.toEqual([]);
  });
});
