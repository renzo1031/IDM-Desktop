import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createDownload,
  getAppStatus,
  listDownloads,
  openDownloadDir,
  openDownloadFile,
  pauseDownload,
  removeDownload,
  retryDownload,
  resumeDownload,
} from "./api/appApi";
import type { DownloadTask } from "./types/download";

vi.mock("./api/appApi", () => ({
  createDownload: vi.fn(),
  getAppStatus: vi.fn(),
  listDownloads: vi.fn(),
  openDownloadDir: vi.fn(),
  openDownloadFile: vi.fn(),
  pauseDownload: vi.fn(),
  removeDownload: vi.fn(),
  retryDownload: vi.fn(),
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
    vi.useRealTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(getAppStatus).mockResolvedValue({
      appName: "IDM Desktop",
      aria2Engine: "connected",
      defaultSplit: 24,
    });
    vi.mocked(listDownloads).mockResolvedValue([]);
    vi.mocked(createDownload).mockResolvedValue(createdTask);
    vi.mocked(pauseDownload).mockResolvedValue();
    vi.mocked(openDownloadFile).mockResolvedValue();
    vi.mocked(openDownloadDir).mockResolvedValue();
    vi.mocked(removeDownload).mockResolvedValue();
    vi.mocked(retryDownload).mockResolvedValue(createdTask);
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

  it("saves default download settings and uses them for new tasks", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.clear(screen.getByLabelText("默认下载目录"));
    await user.type(screen.getByLabelText("默认下载目录"), "E:\\Media");
    await user.clear(screen.getByLabelText("默认线程数"));
    await user.type(screen.getByLabelText("默认线程数"), "12");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await user.type(screen.getByPlaceholderText("粘贴下载链接..."), createdTask.url);
    await user.click(screen.getByRole("button", { name: /新建/ }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "E:\\Media",
      split: 12,
    });
    expect(screen.getByText(/E:\\Media/)).toBeInTheDocument();
  });

  it("saves proxy settings and sends them when creating downloads", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.type(screen.getByLabelText("HTTP/HTTPS 代理"), "http://127.0.0.1:7890");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await user.type(screen.getByPlaceholderText("粘贴下载链接..."), createdTask.url);
    await user.click(screen.getByRole("button", { name: /新建/ }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "D:\\Downloads",
      split: 24,
      proxyUrl: "http://127.0.0.1:7890",
    });
    expect(screen.getByText(/代理已启用/)).toBeInTheDocument();
  });

  it("uses per-task save directory, split, and speed limit when provided", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "任务参数" }));
    await user.type(screen.getByLabelText("本任务保存目录"), "F:\\Downloads\\Single");
    await user.clear(screen.getByLabelText("本任务线程数"));
    await user.type(screen.getByLabelText("本任务线程数"), "6");
    await user.type(screen.getByLabelText("本任务限速 KB/s"), "512");

    await user.type(screen.getByPlaceholderText("粘贴下载链接..."), createdTask.url);
    await user.click(screen.getByRole("button", { name: /新建/ }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "F:\\Downloads\\Single",
      split: 6,
      speedLimit: 524288,
    });
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

  it("uses toolbar controls for the selected task", async () => {
    const user = userEvent.setup();
    const pausedTask: DownloadTask = {
      ...createdTask,
      status: "paused",
    };
    vi.mocked(listDownloads).mockResolvedValue([pausedTask]);

    render(<App initialTasks={[]} />);

    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "开始" }));
    expect(resumeDownload).toHaveBeenCalledWith("gid-1");

    await user.click(screen.getByRole("button", { name: "暂停" }));
    expect(pauseDownload).toHaveBeenCalledWith("gid-1");

    await user.click(screen.getByRole("button", { name: "删除任务" }));
    expect(removeDownload).toHaveBeenCalledWith("gid-1");
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
    vi.useFakeTimers();
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
    await act(async () => {});
    expect(within(taskPanel).getByText("polling.zip")).toBeInTheDocument();
    expect(within(taskPanel).getByText("0%")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(within(taskPanel).getByText("50%")).toBeInTheDocument();
    expect(listDownloads).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("marks aria2 as offline when polling downloads fails", async () => {
    vi.mocked(listDownloads).mockRejectedValue(new Error("aria2 RPC 请求失败"));

    render(<App initialTasks={[]} pollIntervalMs={20} />);

    expect(await screen.findByText("aria2 RPC 请求失败")).toBeInTheDocument();
    expect(await screen.findByText(/aria2 异常/)).toBeInTheDocument();
  });

  it("opens files, opens folders, and supports deleting local files", async () => {
    const user = userEvent.setup();
    const completeTask: DownloadTask = {
      ...createdTask,
      status: "complete",
      completedBytes: createdTask.totalBytes,
    };
    vi.mocked(listDownloads).mockResolvedValue([completeTask]);

    render(<App initialTasks={[]} />);

    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);
    const detailsPanel = screen.getByLabelText("任务详情面板");

    await user.click(within(detailsPanel).getByRole("button", { name: "打开" }));
    expect(openDownloadFile).toHaveBeenCalledWith("gid-1");

    await user.click(within(detailsPanel).getByRole("button", { name: "目录" }));
    expect(openDownloadDir).toHaveBeenCalledWith("gid-1");

    await user.click(within(detailsPanel).getByRole("button", { name: "删文件" }));
    expect(removeDownload).toHaveBeenCalledWith("gid-1", { deleteFile: true });
  });

  it("retries an errored task and selects the recreated download", async () => {
    const user = userEvent.setup();
    const failedTask: DownloadTask = {
      ...createdTask,
      id: "failed-gid",
      gid: "failed-gid",
      status: "error",
      completedBytes: 512,
      errorMessage: "网络中断",
    };
    const retriedTask: DownloadTask = {
      ...createdTask,
      id: "retry-gid",
      gid: "retry-gid",
      fileName: "retried-file.zip",
      status: "waiting",
    };
    vi.mocked(listDownloads).mockResolvedValue([failedTask]);
    vi.mocked(retryDownload).mockResolvedValue(retriedTask);

    render(<App initialTasks={[]} />);

    expect(await screen.findByText("网络中断")).toBeInTheDocument();
    const detailsPanel = screen.getByLabelText("任务详情面板");

    await user.click(within(detailsPanel).getByRole("button", { name: "重试" }));

    expect(retryDownload).toHaveBeenCalledWith("failed-gid");
    expect(await screen.findAllByText("retried-file.zip")).not.toHaveLength(0);
  });
});
