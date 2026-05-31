import { describe, expect, it } from "vitest";
import { createDownload, getAppStatus, listDownloads, pauseDownload } from "./appApi";

describe("appApi", () => {
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
});
