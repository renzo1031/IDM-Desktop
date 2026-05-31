import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
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
  retryDownload,
  resumeDownload,
  resumeAllDownloads,
  updateQueueSettings,
  selectDirectory,
} from "./api/appApi";
import type { DownloadTask } from "./types/download";

const appCss = readFileSync("src/App.css", "utf8");

vi.mock("./api/appApi", () => ({
  createDownload: vi.fn(),
  getAppStatus: vi.fn(),
  listDownloads: vi.fn(),
  openDownloadDir: vi.fn(),
  openDownloadFile: vi.fn(),
  pauseDownload: vi.fn(),
  pauseAllDownloads: vi.fn(),
  previewDownload: vi.fn(),
  purgeStoppedDownloads: vi.fn(),
  removeDownload: vi.fn(),
  retryDownload: vi.fn(),
  resumeDownload: vi.fn(),
  resumeAllDownloads: vi.fn(),
  updateQueueSettings: vi.fn(),
  selectDirectory: vi.fn(),
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
      maxActiveDownloads: 3,
    });
    vi.mocked(listDownloads).mockResolvedValue([]);
    vi.mocked(createDownload).mockResolvedValue(createdTask);
    vi.mocked(pauseDownload).mockResolvedValue();
    vi.mocked(pauseAllDownloads).mockResolvedValue();
    vi.mocked(previewDownload).mockResolvedValue({
      url: createdTask.url,
      fileName: "file.zip",
      totalBytes: 1048576,
      resumable: true,
    });
    vi.mocked(openDownloadFile).mockResolvedValue();
    vi.mocked(openDownloadDir).mockResolvedValue();
    vi.mocked(purgeStoppedDownloads).mockResolvedValue();
    vi.mocked(removeDownload).mockResolvedValue();
    vi.mocked(retryDownload).mockResolvedValue(createdTask);
    vi.mocked(resumeAllDownloads).mockResolvedValue();
    vi.mocked(updateQueueSettings).mockResolvedValue();
    vi.mocked(selectDirectory).mockResolvedValue(null);
  });

  it("renders the 980px three-column downloader shell", async () => {
    vi.mocked(listDownloads).mockResolvedValue([createdTask]);

    render(<App initialTasks={[]} />);

    expect(await screen.findByText("IDM Desktop")).toBeInTheDocument();
    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "新建任务" })).toBeInTheDocument();
    expect(screen.getByText("全部")).toBeInTheDocument();
    expect(screen.getByText("下载中")).toBeInTheDocument();
    expect(screen.getByText("任务详情")).toBeInTheDocument();
    expect(screen.getByText("内置 aria2")).toBeInTheDocument();
    expect(await screen.findByText(/默认 24 线程/)).toBeInTheDocument();
    expect(screen.getByText(/aria2 已连接/)).toBeInTheDocument();
  });

  it("uses the desktop window itself as the app frame without outer gutters", () => {
    render(<App initialTasks={[]} />);

    const shell = document.querySelector(".app-shell");
    const windowFrame = document.querySelector(".download-window");

    expect(shell).toBeInstanceOf(HTMLElement);
    expect(windowFrame).toBeInstanceOf(HTMLElement);

    const shellStyle = getComputedStyle(shell as HTMLElement);
    const frameStyle = getComputedStyle(windowFrame as HTMLElement);

    expect(parseFloat(shellStyle.paddingLeft || "0")).toBe(0);
    expect(parseFloat(shellStyle.paddingTop || "0")).toBe(0);
    expect(parseFloat(shellStyle.paddingRight || "0")).toBe(0);
    expect(parseFloat(shellStyle.paddingBottom || "0")).toBe(0);
    expect(parseFloat(frameStyle.borderRadius || "0")).toBe(0);
    expect(["", "none"]).toContain(frameStyle.boxShadow);
  });

  it("keeps the three toolbar actions aligned to the right", () => {
    render(<App initialTasks={[]} />);

    const toolbarActions = document.querySelector(".toolbar-actions");

    expect(toolbarActions).toBeInstanceOf(HTMLElement);
    expect(appCss).toMatch(
      /\.toolbar-actions\s*\{[^}]*justify-content:\s*flex-end;[^}]*justify-self:\s*end;/s,
    );
    expect(appCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.toolbar-actions\s*\{[\s\S]*?justify-content:\s*flex-end;/,
    );
  });

  it("creates a download from the URL input", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    await user.type(within(dialog).getByLabelText("下载链接"), createdTask.url);
    await user.click(within(dialog).getByRole("button", { name: "开始下载" }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "D:\\Downloads",
      split: 16,
    });
    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);
  });

  it("saves default download settings and uses them for new tasks", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    const settingsDialog = screen.getByRole("dialog", { name: "设置" });
    expect(within(settingsDialog).getByRole("tab", { name: "下载" })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("tab", { name: "连接" })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("tab", { name: "代理" })).toBeInTheDocument();

    await user.clear(within(settingsDialog).getByLabelText("默认下载目录"));
    await user.type(within(settingsDialog).getByLabelText("默认下载目录"), "E:\\Media");
    await user.click(within(settingsDialog).getByRole("tab", { name: "连接" }));
    await user.clear(within(settingsDialog).getByLabelText("默认线程数"));
    await user.type(within(settingsDialog).getByLabelText("默认线程数"), "32");
    await user.click(within(settingsDialog).getByRole("button", { name: "保存设置" }));

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    await user.type(within(dialog).getByLabelText("下载链接"), createdTask.url);
    await user.click(within(dialog).getByRole("button", { name: "开始下载" }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "E:\\Media",
      split: 32,
    });
    expect(screen.getByText(/E:\\Media/)).toBeInTheDocument();
  });

  it("selects a default download directory from settings", async () => {
    const user = userEvent.setup();
    vi.mocked(selectDirectory).mockResolvedValue("E:\\Picked");
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    const settingsDialog = screen.getByRole("dialog", { name: "设置" });

    await user.click(within(settingsDialog).getByRole("button", { name: "选择默认下载目录" }));

    expect(selectDirectory).toHaveBeenCalledTimes(1);
    expect(within(settingsDialog).getByLabelText("默认下载目录")).toHaveValue("E:\\Picked");
  });

  it("saves max active downloads from the queue settings", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    const settingsDialog = screen.getByRole("dialog", { name: "设置" });
    await user.click(within(settingsDialog).getByRole("tab", { name: "连接" }));
    await user.clear(within(settingsDialog).getByLabelText("最大同时下载数"));
    await user.type(within(settingsDialog).getByLabelText("最大同时下载数"), "5");
    await user.click(within(settingsDialog).getByRole("button", { name: "保存设置" }));

    expect(updateQueueSettings).toHaveBeenCalledWith({ maxActiveDownloads: 5 });
    expect(screen.getByText(/并发 5/)).toBeInTheDocument();
  });

  it("saves proxy settings and sends them when creating downloads", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    const settingsDialog = screen.getByRole("dialog", { name: "设置" });
    await user.click(within(settingsDialog).getByRole("tab", { name: "代理" }));
    await user.click(within(settingsDialog).getByLabelText("使用代理"));
    await user.type(
      within(settingsDialog).getByLabelText("HTTP/HTTPS 代理"),
      "http://127.0.0.1:7890",
    );
    await user.click(within(settingsDialog).getByRole("button", { name: "保存设置" }));

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    await user.type(within(dialog).getByLabelText("下载链接"), createdTask.url);
    await user.click(within(dialog).getByRole("button", { name: "开始下载" }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "D:\\Downloads",
      split: 16,
      proxyUrl: "http://127.0.0.1:7890",
    });
    expect(screen.getByText(/代理已启用/)).toBeInTheDocument();
  });

  it("uses saved proxy settings when previewing a new download", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    const settingsDialog = screen.getByRole("dialog", { name: "设置" });
    await user.click(within(settingsDialog).getByRole("tab", { name: "代理" }));
    await user.click(within(settingsDialog).getByLabelText("使用代理"));
    await user.type(
      within(settingsDialog).getByLabelText("HTTP/HTTPS 代理"),
      "http://127.0.0.1:7890",
    );
    await user.click(within(settingsDialog).getByRole("button", { name: "保存设置" }));

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    await user.type(within(dialog).getByLabelText("下载链接"), createdTask.url);

    expect(await within(dialog).findByText("file.zip")).toBeInTheDocument();
    expect(previewDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      proxyUrl: "http://127.0.0.1:7890",
    });
  });

  it("uses per-task save directory, split, and speed limit when provided", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    await user.type(within(dialog).getByLabelText("下载链接"), createdTask.url);
    await user.clear(within(dialog).getByLabelText("保存目录"));
    await user.type(within(dialog).getByLabelText("保存目录"), "F:\\Downloads\\Single");
    await user.click(within(dialog).getByRole("radio", { name: "64" }));
    await user.type(within(dialog).getByLabelText("限速 KB/s"), "512");

    await user.click(within(dialog).getByRole("button", { name: "开始下载" }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "F:\\Downloads\\Single",
      fileName: "file.zip",
      totalBytes: 1048576,
      resumable: true,
      split: 64,
      speedLimit: 524288,
    });
  });

  it("selects a per-task save directory from the new task dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(selectDirectory).mockResolvedValue("F:\\Picked\\Task");
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });

    await user.click(within(dialog).getByRole("button", { name: "选择保存目录" }));

    expect(selectDirectory).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByLabelText("保存目录")).toHaveValue("F:\\Picked\\Task");
  });

  it("uses compact radio buttons instead of a thread count input", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    await user.type(within(dialog).getByLabelText("下载链接"), createdTask.url);
    expect(within(dialog).queryByLabelText("线程数")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "16" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "32" }));
    await user.click(within(dialog).getByRole("button", { name: "开始下载" }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "D:\\Downloads",
      split: 32,
    });
  });

  it("previews file metadata before creating a new download", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    await user.type(within(dialog).getByLabelText("下载链接"), createdTask.url);

    expect(await within(dialog).findByText("file.zip")).toBeInTheDocument();
    expect(within(dialog).getByText("1 MB", { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByText("支持断点续传", { exact: false })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "开始下载" }));

    expect(previewDownload).toHaveBeenCalledWith({ url: createdTask.url });
    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "D:\\Downloads",
      fileName: "file.zip",
      totalBytes: 1048576,
      resumable: true,
      split: 16,
    });
  });

  it("does not render a custom clear button in the download URL field", async () => {
    const user = userEvent.setup();
    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    const urlInput = within(dialog).getByLabelText("下载链接");
    await user.type(urlInput, createdTask.url);

    expect(await within(dialog).findByText("file.zip")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "清除下载链接" }),
    ).not.toBeInTheDocument();
  });

  it("allows creating a download when preview fails", async () => {
    const user = userEvent.setup();
    vi.mocked(previewDownload).mockRejectedValue(new Error("无法解析文件信息"));

    render(<App initialTasks={[]} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建下载任务" });
    await user.type(within(dialog).getByLabelText("下载链接"), createdTask.url);

    expect(await within(dialog).findByText("无法解析文件信息")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "开始下载" }));

    expect(createDownload).toHaveBeenCalledWith({
      url: createdTask.url,
      saveDir: "D:\\Downloads",
      split: 16,
    });
  });

  it("makes the details panel scroll internally without a visible scrollbar", async () => {
    vi.mocked(listDownloads).mockResolvedValue([createdTask]);

    render(<App initialTasks={[]} />);

    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);
    const detailsPanel = screen.getByLabelText("任务详情面板");
    const detailsStyle = getComputedStyle(detailsPanel);

    expect(detailsStyle.overflowY).toBe("auto");
    expect(detailsStyle.scrollbarWidth).toBe("none");
  });

  it("lets the frontend compress to the desktop minimum height without hiding the status bar", () => {
    render(<App initialTasks={[]} />);

    const windowFrame = document.querySelector(".download-window");
    const contentGrid = document.querySelector(".content-grid");
    const taskPanel = document.querySelector(".task-panel");
    const taskList = document.querySelector(".task-list");
    const statusbar = document.querySelector(".statusbar");

    expect(windowFrame).toBeInstanceOf(HTMLElement);
    expect(contentGrid).toBeInstanceOf(HTMLElement);
    expect(taskPanel).toBeInstanceOf(HTMLElement);
    expect(taskList).toBeInstanceOf(HTMLElement);
    expect(statusbar).toBeInstanceOf(HTMLElement);

    expect(appCss).toMatch(
      /\.download-window\s*\{[^}]*min-height:\s*0;[^}]*grid-template-rows:\s*50px minmax\(0, 1fr\) 28px;/s,
    );
    expect(appCss).not.toMatch(/min-height:\s*620px;/);
    expect(appCss).toMatch(/\.content-grid\s*\{[^}]*min-height:\s*0;/s);
    expect(appCss).toMatch(/\.task-panel\s*\{[^}]*min-height:\s*0;/s);
    expect(appCss).toMatch(/\.task-list\s*\{[^}]*overflow:\s*hidden auto;/s);
    expect(appCss).toMatch(/\.statusbar\s*\{[^}]*min-height:\s*28px;/s);
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
    expect(screen.getByRole("dialog", { name: "删除下载任务" })).toBeInTheDocument();
  });

  it("opens a task context menu from a row right click", async () => {
    const user = userEvent.setup();
    vi.mocked(listDownloads).mockResolvedValue([createdTask]);

    render(<App initialTasks={[]} />);

    const taskPanel = screen.getByLabelText("下载任务列表");
    expect(await within(taskPanel).findByText("file.zip")).toBeInTheDocument();

    await user.pointer({
      keys: "[MouseRight]",
      target: within(taskPanel).getByRole("button", { name: /file\.zip/ }),
    });

    const menu = screen.getByRole("menu", { name: "任务右键菜单" });
    expect(within(menu).getByRole("menuitem", { name: "开始" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "暂停" })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "打开所在目录" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "复制下载链接" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "删除..." })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "任务属性" })).toBeInTheDocument();

    await user.click(within(menu).getByRole("menuitem", { name: "开始" }));
    expect(resumeDownload).toHaveBeenCalledWith("gid-1");
  });

  it("opens compact queue actions from the empty task list context menu", async () => {
    const user = userEvent.setup();
    vi.mocked(listDownloads).mockResolvedValue([]);

    render(<App initialTasks={[]} />);

    const taskPanel = screen.getByLabelText("下载任务列表");
    expect(await within(taskPanel).findByText("暂无任务")).toBeInTheDocument();

    await user.pointer({
      keys: "[MouseRight]",
      target: taskPanel,
    });

    const menu = screen.getByRole("menu", { name: "列表右键菜单" });
    expect(within(menu).getByRole("menuitem", { name: "新建任务" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "全部开始" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "全部暂停" })).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "清理完成/失败" }),
    ).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "打开文件" })).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("menuitem", { name: "新建任务" }));
    expect(screen.getByRole("dialog", { name: "新建下载任务" })).toBeInTheDocument();
  });

  it("uses sidebar queue controls for all downloads", async () => {
    const user = userEvent.setup();
    vi.mocked(listDownloads).mockResolvedValue([
      { ...createdTask, status: "active" },
      {
        ...createdTask,
        id: "done-gid",
        gid: "done-gid",
        fileName: "done.zip",
        status: "complete",
        completedBytes: createdTask.totalBytes,
      },
    ]);

    render(<App initialTasks={[]} />);

    expect(await screen.findAllByText("file.zip")).not.toHaveLength(0);
    const queueControls = screen.getByLabelText("批量任务控制");

    expect(document.querySelector(".batch-toolbar")).not.toBeInTheDocument();
    expect(queueControls).toHaveClass("queue-controls");

    await user.click(within(queueControls).getByRole("button", { name: "全部开始" }));
    expect(resumeAllDownloads).toHaveBeenCalledTimes(1);

    await user.click(within(queueControls).getByRole("button", { name: "全部暂停" }));
    expect(pauseAllDownloads).toHaveBeenCalledTimes(1);

    await user.click(within(queueControls).getByRole("button", { name: "清理完成/失败" }));
    expect(purgeStoppedDownloads).toHaveBeenCalledTimes(1);
  });

  it("keeps the shell usable when there are no restored downloads", async () => {
    vi.mocked(listDownloads).mockResolvedValue([]);

    render(<App initialTasks={[]} />);

    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.getByText("等待新建下载任务")).toBeInTheDocument();
  });

  it("starts with an empty real download list instead of sample tasks", async () => {
    vi.mocked(listDownloads).mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.queryByText("ubuntu-26.04-desktop-amd64.iso")).not.toBeInTheDocument();
    expect(screen.queryByText("course-video-final.mp4")).not.toBeInTheDocument();
    expect(screen.queryByText("installer.exe")).not.toBeInTheDocument();
    expect(screen.queryByText("dataset-archive-2026.zip")).not.toBeInTheDocument();
  });

  it("keeps footer action buttons grouped together", () => {
    render(<App initialTasks={[]} />);

    const footerActions = screen.getByLabelText("底部操作");

    expect(footerActions).toContainElement(screen.getByRole("button", { name: "设置" }));
    expect(footerActions).toContainElement(
      screen.getByRole("button", { name: "删除任务" }),
    );
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

  it("opens files, opens folders, and merges delete actions into one confirmation", async () => {
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

    expect(within(detailsPanel).getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(
      within(detailsPanel).queryByRole("button", { name: "删文件" }),
    ).not.toBeInTheDocument();

    await user.click(within(detailsPanel).getByRole("button", { name: "删除" }));
    const deleteDialog = screen.getByRole("dialog", { name: "删除下载任务" });
    expect(within(deleteDialog).getByText("file.zip")).toBeInTheDocument();
    expect(
      within(deleteDialog).getByRole("button", { name: "仅删除任务" }),
    ).toBeInTheDocument();

    await user.click(within(deleteDialog).getByRole("button", { name: "删除任务和文件" }));
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
