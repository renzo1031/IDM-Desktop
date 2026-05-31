import {
  FolderOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./App.css";
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
import type { AppStatus, EngineStatus } from "./types/appStatus";
import type { DownloadTask, TaskCategory } from "./types/download";
import {
  filterTasks,
  formatBytes,
  formatRemainingTime,
  formatSpeed,
  getTaskCounts,
} from "./utils/downloadUtils";

const now = "2026-05-31T00:00:00.000Z";

const sampleTasks: DownloadTask[] = [
  {
    id: "1",
    gid: "9bfa1a",
    url: "https://releases.ubuntu.com/26.04/ubuntu-26.04-desktop-amd64.iso",
    fileName: "ubuntu-26.04-desktop-amd64.iso",
    saveDir: "D:\\Downloads",
    totalBytes: 5.8 * 1024 * 1024 * 1024,
    completedBytes: 3.65 * 1024 * 1024 * 1024,
    downloadSpeed: 8.4 * 1024 * 1024,
    connections: 16,
    status: "active",
    resumable: true,
    createdAt: now,
    updatedAt: now,
    options: { split: 16, maxConnectionPerServer: 16, speedLimit: 0 },
  },
  {
    id: "2",
    gid: "de72cc",
    url: "https://cdn.example.com/course-video-final.mp4",
    fileName: "course-video-final.mp4",
    saveDir: "D:\\Downloads\\Video",
    totalBytes: 2.4 * 1024 * 1024 * 1024,
    completedBytes: 0.74 * 1024 * 1024 * 1024,
    downloadSpeed: 3.1 * 1024 * 1024,
    connections: 8,
    status: "active",
    resumable: true,
    createdAt: now,
    updatedAt: now,
    options: { split: 8, maxConnectionPerServer: 8, speedLimit: 0 },
  },
  {
    id: "3",
    gid: "ff0c42",
    url: "https://example.com/installer.exe",
    fileName: "installer.exe",
    saveDir: "D:\\Downloads\\Apps",
    totalBytes: 128 * 1024 * 1024,
    completedBytes: 128 * 1024 * 1024,
    downloadSpeed: 0,
    connections: 0,
    status: "complete",
    resumable: true,
    createdAt: now,
    updatedAt: now,
    options: { split: 16, maxConnectionPerServer: 16, speedLimit: 0 },
  },
  {
    id: "4",
    gid: null,
    url: "https://example.com/dataset-archive-2026.zip",
    fileName: "dataset-archive-2026.zip",
    saveDir: "D:\\Downloads",
    totalBytes: 810 * 1024 * 1024,
    completedBytes: 112 * 1024 * 1024,
    downloadSpeed: 0,
    connections: 0,
    status: "error",
    resumable: false,
    errorMessage: "服务器不支持断点续传，等待重试",
    createdAt: now,
    updatedAt: now,
    options: { split: 16, maxConnectionPerServer: 16, speedLimit: 0 },
  },
];

const categories: Array<{ key: TaskCategory; label: string }> = [
  { key: "all", label: "全部" },
  { key: "active", label: "下载中" },
  { key: "waiting", label: "等待" },
  { key: "complete", label: "完成" },
  { key: "error", label: "失败" },
];

const initialAppStatus: AppStatus = {
  appName: "IDM Desktop",
  aria2Engine: "bundled",
  defaultSplit: 16,
};

const engineStatusLabel: Record<EngineStatus, string> = {
  bundled: "内置 aria2",
  starting: "aria2 启动中",
  connected: "aria2 已连接",
  error: "aria2 异常",
};

function progressOf(task: DownloadTask): number {
  if (task.totalBytes <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((task.completedBytes / task.totalBytes) * 100));
}

interface AppProps {
  initialTasks?: DownloadTask[];
  pollIntervalMs?: number;
}

function App({ initialTasks = sampleTasks, pollIntervalMs = 1500 }: AppProps) {
  const [category, setCategory] = useState<TaskCategory>("all");
  const [url, setUrl] = useState("");
  const [tasksState, setTasksState] = useState<DownloadTask[]>(initialTasks);
  const [selectedTaskId, setSelectedTaskId] = useState(initialTasks[0]?.id ?? "");
  const [appStatus, setAppStatus] = useState<AppStatus>(initialAppStatus);
  const [errorMessage, setErrorMessage] = useState("");
  const counts = useMemo(() => getTaskCounts(tasksState), [tasksState]);
  const tasks = useMemo(() => filterTasks(tasksState, category), [category, tasksState]);
  const totalSpeed = useMemo(
    () => tasksState.reduce((sum, task) => sum + task.downloadSpeed, 0),
    [tasksState],
  );
  const selectedTask = tasksState.find((task) => task.id === selectedTaskId) ?? tasksState[0];
  const remainingBytes = selectedTask
    ? selectedTask.totalBytes - selectedTask.completedBytes
    : 0;

  useEffect(() => {
    let alive = true;

    getAppStatus()
      .then((status) => {
        if (alive) {
          setAppStatus(status);
        }
      })
      .catch(() => {
        if (alive) {
          setAppStatus((status) => ({ ...status, aria2Engine: "error" }));
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  function applyDownloads(downloads: DownloadTask[]) {
    setTasksState(downloads);
    setSelectedTaskId((currentSelectedId) => {
      if (downloads.some((task) => task.id === currentSelectedId)) {
        return currentSelectedId;
      }

      return downloads[0]?.id ?? "";
    });
  }

  async function refreshDownloads() {
    const downloads = await listDownloads();
    applyDownloads(downloads);
  }

  useEffect(() => {
    let alive = true;

    async function syncDownloads() {
      try {
        const downloads = await listDownloads();
        if (alive) {
          applyDownloads(downloads);
        }
      } catch (error) {
        if (alive) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }

    syncDownloads();
    const intervalId = window.setInterval(syncDownloads, pollIntervalMs);

    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [pollIntervalMs]);

  async function handleCreateDownload() {
    const nextUrl = url.trim();
    if (!nextUrl) {
      setErrorMessage("请先输入下载链接");
      return;
    }

    setErrorMessage("");
    try {
      const task = await createDownload({
        url: nextUrl,
        saveDir: "D:\\Downloads",
        split: appStatus.defaultSplit,
      });
      setTasksState((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSelectedTaskId(task.id);
      setUrl("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handlePauseTask(task: DownloadTask) {
    if (!task.gid) {
      return;
    }

    try {
      if (task.status === "paused") {
        await resumeDownload(task.gid);
      } else {
        await pauseDownload(task.gid);
      }
      await refreshDownloads();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRemoveTask(task: DownloadTask) {
    if (!task.gid) {
      return;
    }

    try {
      await removeDownload(task.gid);
      setTasksState((current) => {
        const nextTasks = current.filter((item) => item.id !== task.id);
        if (selectedTaskId === task.id) {
          setSelectedTaskId(nextTasks[0]?.id ?? "");
        }
        return nextTasks;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRemoveTaskWithFile(task: DownloadTask) {
    if (!task.gid) {
      return;
    }

    try {
      await removeDownload(task.gid, { deleteFile: true });
      setTasksState((current) => {
        const nextTasks = current.filter((item) => item.id !== task.id);
        if (selectedTaskId === task.id) {
          setSelectedTaskId(nextTasks[0]?.id ?? "");
        }
        return nextTasks;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenTaskFile(task: DownloadTask) {
    if (!task.gid) {
      return;
    }

    try {
      await openDownloadFile(task.gid);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenTaskDir(task: DownloadTask) {
    if (!task.gid) {
      return;
    }

    try {
      await openDownloadDir(task.gid);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRetryTask(task: DownloadTask) {
    if (!task.gid) {
      return;
    }

    try {
      const retriedTask = await retryDownload(task.gid);
      setTasksState((current) => [
        retriedTask,
        ...current.filter((item) => item.id !== retriedTask.id),
      ]);
      setSelectedTaskId(retriedTask.id);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="app-shell">
      <section className="download-window" aria-label="下载管理器主窗口">
        <header className="toolbar">
          <div className="brand">
            <span className="brand-mark">ID</span>
            <span>IDM Desktop</span>
          </div>
          <div className="url-entry">
            <input
              aria-label="下载链接"
              onChange={(event) => setUrl(event.target.value)}
              placeholder="粘贴下载链接..."
              value={url}
            />
            <button className="primary-action" onClick={handleCreateDownload} type="button">
              <Plus size={16} />
              新建
            </button>
            <button type="button">
              <Play size={15} />
              开始
            </button>
            <button type="button">
              <Pause size={15} />
              暂停
            </button>
          </div>
          <div className="speed-meter">{formatSpeed(totalSpeed)}</div>
        </header>

        <div className="content-grid">
          <aside className="sidebar">
            <p className="section-label">分类</p>
            <nav className="category-list" aria-label="任务分类">
              {categories.map((item) => (
                <button
                  className={category === item.key ? "category active" : "category"}
                  key={item.key}
                  onClick={() => setCategory(item.key)}
                  type="button"
                >
                  <span>{item.label}</span>
                  <span>{counts[item.key]}</span>
                </button>
              ))}
            </nav>

            <p className="section-label section-gap">类型</p>
            <div className="type-list">
              <span>视频</span>
              <span>压缩包</span>
              <span>应用</span>
              <span>文档</span>
            </div>
          </aside>

          <section className="task-panel" aria-label="下载任务列表">
            <div className="task-header">
              <span>文件名</span>
              <span>进度</span>
              <span>速度</span>
              <span>剩余</span>
              <span>操作</span>
            </div>
            <div className="task-list">
              {errorMessage ? <div className="inline-error">{errorMessage}</div> : null}
              {tasks.length === 0 ? <div className="empty-state">暂无任务</div> : null}
              {tasks.map((task) => {
                const progress = progressOf(task);
                const remaining = task.totalBytes - task.completedBytes;

                return (
                  <button
                    className={
                      selectedTask.id === task.id ? "task-row selected" : "task-row"
                    }
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    type="button"
                  >
                    <span className="task-name">
                      <strong>{task.fileName}</strong>
                      <small>{task.errorMessage ?? task.url}</small>
                    </span>
                    <span>{progress}%</span>
                    <span>{formatSpeed(task.downloadSpeed)}</span>
                    <span>{formatRemainingTime(remaining, task.downloadSpeed)}</span>
                    <span className="row-actions">
                      {task.status === "complete"
                        ? "打开"
                        : task.status === "paused"
                          ? "继续"
                          : "暂停"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="details-panel" aria-label="任务详情面板">
            <p className="section-label">任务详情</p>
            {selectedTask ? (
              <>
                <h2>{selectedTask.fileName}</h2>
            <div className="progress-track">
              <span style={{ width: `${progressOf(selectedTask)}%` }} />
            </div>
            <div className="detail-grid">
              <span>
                <strong>大小</strong>
                {formatBytes(selectedTask.totalBytes)}
              </span>
              <span>
                <strong>已下</strong>
                {formatBytes(selectedTask.completedBytes)}
              </span>
              <span>
                <strong>连接</strong>
                {selectedTask.connections}
              </span>
              <span>
                <strong>限速</strong>
                不限
              </span>
            </div>

            <p className="section-label section-gap">保存目录</p>
            <p className="path-text">{selectedTask.saveDir}</p>

            <p className="section-label section-gap">下载引擎</p>
            <div className="engine-card">
              <span>内置 aria2</span>
              <strong>{selectedTask.resumable ? "支持断点续传" : "普通下载"}</strong>
            </div>

            <p className="section-label section-gap">本任务设置</p>
            <label>
              线程数
              <input readOnly value={selectedTask.options.split} />
            </label>
            <label>
              剩余
              <input readOnly value={formatBytes(Math.max(0, remainingBytes))} />
            </label>

            <div className="detail-actions">
              {selectedTask.status === "complete" ? (
                <button onClick={() => handleOpenTaskFile(selectedTask)} type="button">
                  <FolderOpen size={15} />
                  打开
                </button>
              ) : null}
              <button onClick={() => handlePauseTask(selectedTask)} type="button">
                <Pause size={15} />
                {selectedTask.status === "paused" ? "继续" : "暂停"}
              </button>
              <button onClick={() => handleRetryTask(selectedTask)} type="button">
                <RefreshCw size={15} />
                重试
              </button>
              <button onClick={() => handleOpenTaskDir(selectedTask)} type="button">
                <FolderOpen size={15} />
                目录
              </button>
              <button onClick={() => handleRemoveTask(selectedTask)} type="button">
                <Trash2 size={15} />
                删除
              </button>
              <button
                className="danger-action"
                onClick={() => handleRemoveTaskWithFile(selectedTask)}
                type="button"
              >
                <Trash2 size={15} />
                删文件
              </button>
            </div>
              </>
            ) : (
              <div className="details-empty">
                <h2>等待新建下载任务</h2>
                <p>输入 HTTP/HTTPS 链接后，任务会显示在这里。</p>
              </div>
            )}
          </aside>
        </div>

        <footer className="statusbar">
          <span>
            {engineStatusLabel[appStatus.aria2Engine]} · RPC 6800 · 默认{" "}
            {appStatus.defaultSplit} 线程
          </span>
          <span>D:\Downloads · 剩余 428 GB</span>
          <button aria-label="设置" type="button">
            <Settings size={15} />
          </button>
          <button aria-label="删除任务" type="button">
            <Trash2 size={15} />
          </button>
        </footer>
      </section>
    </main>
  );
}

export default App;
