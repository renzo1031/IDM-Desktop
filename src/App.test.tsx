import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createDownload,
  getAppStatus,
  listDownloads,
  pauseDownload,
} from "./api/appApi";
import type { DownloadTask } from "./types/download";

vi.mock("./api/appApi", () => ({
  createDownload: vi.fn(),
  getAppStatus: vi.fn(),
  listDownloads: vi.fn(),
  pauseDownload: vi.fn(),
  removeDownload: vi.fn(),
  resumeDownload: vi.fn(),
}));

const createdTask: DownloadTask = {
  id: "gid-1",
  gid: "gid-1",
  url: "https://example.com/file.zip",
  fileName: "file.zip",
  saveDir: "D:\\Downloads",
  totalBytes: 1024,
  completedBytes: 0,
  downloadSpeed: 0,
  connections: 0,
  status: "waiting",
  resumable: true,
  createdAt: "2026-05-31T00:00:00.000Z",
  updatedAt: "2026-05-31T00:00:00.000Z",
  options: { split: 16, maxConnectionPerServer: 16, speedLimit: 0 },
};

const pollingTask: DownloadTask = {
  ...createdTask,
  id: "polling-gid",
  gid: "polling-gid",
  url: "https://example.com/polling.zip",
  fileName: "polling.zip",
  totalBytes: 2048,
  completedBytes: 0,
  status: "active",
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppStatus).mockResolvedValue({
      appName: "IDM Desktop",
      aria2Engine: "connected",
      defaultSplit: 24,
    });
    vi.mocked(listDownloads).mockResolvedValue([]);
    vi.mocked(createDownload).mockResolvedValue(createdTask);
    vi.mocked(pauseDownload).mockResolvedValue();
  });

  it("renders the 980px three-column downloader shell", async () => {
    vi.mocked(listDownloads).mockResolvedValue([createdTask]);

    render(<App />);

    expect(await screen.findByText("IDM Desktop")).toBeInTheDocument();
    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);
    expect(screen.getByPlaceholderText("粘贴下载链接...")).toBeInTheDocument();
    expect(screen.getByText("全部")).toBeInTheDocument();
    expect(screen.getByText("下载中")).toBeInTheDocument();
    expect(screen.getByText("任务详情")).toBeInTheDocument();
    expect(screen.getByText("内置 aria2")).toBeInTheDocument();
    expect(await screen.findByText(/默认 24 线程/)).toBeInTheDocument();
    expect(screen.getByText(/aria2 已连接/)).toBeInTheDocument();
  });

  it("creates a download from the URL input", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByPlaceholderText("粘贴下载链接..."), createdTask.url);
    await user.click(screen.getByRole("button", { name: /新建/ }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "D:\\Downloads",
      split: 24,
    });
    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);
  });

  it("pauses the selected task through the backend command", async () => {
    const user = userEvent.setup();
    vi.mocked(listDownloads).mockResolvedValue([createdTask]);

    render(<App />);

    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);
    const detailsPanel = screen.getByLabelText("任务详情面板");
    await user.click(within(detailsPanel).getByRole("button", { name: /^暂停$/ }));

    expect(pauseDownload).toHaveBeenCalledWith("gid-1");
  });

  it("keeps the shell usable when there are no restored downloads", async () => {
    vi.mocked(listDownloads).mockResolvedValue([]);

    render(<App initialTasks={[]} />);

    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.getByText("等待新建下载任务")).toBeInTheDocument();
  });

  it("uses the backend download list as the source of truth even when it is empty", async () => {
    vi.mocked(listDownloads).mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.queryByText("ubuntu-26.04-desktop-amd64.iso")).not.toBeInTheDocument();
  });

  it("polls backend downloads and refreshes visible progress", async () => {
    vi.mocked(listDownloads)
      .mockResolvedValueOnce([pollingTask])
      .mockResolvedValue([
        {
          ...pollingTask,
          completedBytes: 1024,
          downloadSpeed: 512,
          connections: 4,
        },
      ]);

    render(<App initialTasks={[]} pollIntervalMs={20} />);

    const taskPanel = screen.getByLabelText("下载任务列表");
    expect(await within(taskPanel).findByText("polling.zip")).toBeInTheDocument();
    expect(within(taskPanel).getByText("0%")).toBeInTheDocument();
    expect(await within(taskPanel).findByText("50%")).toBeInTheDocument();
    expect(listDownloads).toHaveBeenCalledTimes(2);
  });
});
