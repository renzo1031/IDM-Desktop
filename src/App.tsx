import {
  FolderOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  X,
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
  pauseAllDownloads,
  previewDownload,
  purgeStoppedDownloads,
  removeDownload,
  retryDownload,
  resumeDownload,
  resumeAllDownloads,
  updateQueueSettings,
  type DownloadPreview,
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
  maxActiveDownloads: 3,
};

const settingsStorageKey = "idm-desktop-settings";

const engineStatusLabel: Record<EngineStatus, string> = {
  bundled: "内置 aria2",
  starting: "aria2 启动中",
  connected: "aria2 已连接",
  error: "aria2 异常",
};

type SettingsSection = "download" | "connection" | "proxy" | "file" | "advanced";

const settingsTabs: Array<{ key: SettingsSection; label: string }> = [
  { key: "download", label: "下载" },
  { key: "connection", label: "连接" },
  { key: "proxy", label: "代理" },
  { key: "file", label: "文件" },
  { key: "advanced", label: "高级" },
];

function progressOf(task: DownloadTask): number {
  if (task.totalBytes <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((task.completedBytes / task.totalBytes) * 100));
}

function clampSplit(value: number): number {
  if (!Number.isFinite(value)) {
    return initialAppStatus.defaultSplit;
  }

  return Math.min(64, Math.max(1, Math.round(value)));
}

function clampMaxActiveDownloads(value: number): number {
  if (!Number.isFinite(value)) {
    return initialAppStatus.maxActiveDownloads;
  }

  return Math.min(64, Math.max(1, Math.round(value)));
}

const quickSplitOptions = [8, 16, 32, 64] as const;

function nearestQuickSplit(value: number): number {
  if (!Number.isFinite(value)) {
    return initialAppStatus.defaultSplit;
  }

  return quickSplitOptions.reduce((nearest, option) =>
    Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest,
  );
}

function loadSavedSettings() {
  try {
    const savedSettings = window.localStorage.getItem(settingsStorageKey);
    if (!savedSettings) {
      return {
        defaultSaveDir: "D:\\Downloads",
        defaultSplit: initialAppStatus.defaultSplit,
        maxActiveDownloads: initialAppStatus.maxActiveDownloads,
        proxyUrl: "",
      };
    }

    const parsed = JSON.parse(savedSettings) as {
      defaultSaveDir?: string;
      defaultSplit?: number;
      maxActiveDownloads?: number;
      proxyUrl?: string;
    };

    return {
      defaultSaveDir: parsed.defaultSaveDir?.trim() || "D:\\Downloads",
      defaultSplit: clampSplit(parsed.defaultSplit ?? initialAppStatus.defaultSplit),
      maxActiveDownloads: clampMaxActiveDownloads(
        parsed.maxActiveDownloads ?? initialAppStatus.maxActiveDownloads,
      ),
      proxyUrl: parsed.proxyUrl?.trim() || "",
    };
  } catch {
    return {
      defaultSaveDir: "D:\\Downloads",
      defaultSplit: initialAppStatus.defaultSplit,
      maxActiveDownloads: initialAppStatus.maxActiveDownloads,
      proxyUrl: "",
    };
  }
}

interface AppProps {
  initialTasks?: DownloadTask[];
  pollIntervalMs?: number;
}

function App({ initialTasks = [], pollIntervalMs = 1500 }: AppProps) {
  const [category, setCategory] = useState<TaskCategory>("all");
  const [tasksState, setTasksState] = useState<DownloadTask[]>(initialTasks);
  const [selectedTaskId, setSelectedTaskId] = useState(initialTasks[0]?.id ?? "");
  const [appStatus, setAppStatus] = useState<AppStatus>(initialAppStatus);
  const [errorMessage, setErrorMessage] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("download");
  const [downloadSettings, setDownloadSettings] = useState(loadSavedSettings);
  const [taskDraft, setTaskDraft] = useState(() => ({
    url: "",
    saveDir: downloadSettings.defaultSaveDir,
    split: String(nearestQuickSplit(downloadSettings.defaultSplit)),
    speedLimitKib: "",
  }));
  const [downloadPreview, setDownloadPreview] = useState<DownloadPreview | null>(null);
  const [previewStatus, setPreviewStatus] =
    useState<"idle" | "loading" | "success" | "error">("idle");
  const [previewError, setPreviewError] = useState("");
  const [settingsDraft, setSettingsDraft] = useState(() => ({
    defaultSaveDir: downloadSettings.defaultSaveDir,
    defaultSplit: String(downloadSettings.defaultSplit),
    maxActiveDownloads: String(downloadSettings.maxActiveDownloads),
    proxyEnabled: downloadSettings.proxyUrl.length > 0,
    proxyUrl: downloadSettings.proxyUrl,
  }));
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
          const savedSettings = window.localStorage.getItem(settingsStorageKey);
          setAppStatus(status);
          setDownloadSettings((current) => {
            if (savedSettings) {
              return current;
            }

            return {
              ...current,
              defaultSplit: status.defaultSplit,
              maxActiveDownloads: status.maxActiveDownloads,
            };
          });
          setSettingsDraft((current) => {
            if (savedSettings) {
              return current;
            }

            return {
              ...current,
              defaultSplit: String(status.defaultSplit),
              maxActiveDownloads: String(status.maxActiveDownloads),
            };
          });
          setTaskDraft((current) => {
            if (savedSettings) {
              return current;
            }

            return { ...current, split: String(status.defaultSplit) };
          });

          if (savedSettings) {
            void updateQueueSettings({
              maxActiveDownloads: downloadSettings.maxActiveDownloads,
            }).catch((error: unknown) => {
              if (alive) {
                setActionError(error);
              }
            });
          }
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
    setAppStatus((status) => ({ ...status, aria2Engine: "connected" }));
    setSelectedTaskId((currentSelectedId) => {
      if (downloads.some((task) => task.id === currentSelectedId)) {
        return currentSelectedId;
      }

      return downloads[0]?.id ?? "";
    });
  }

  function setActionError(error: unknown) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
    setAppStatus((status) => ({ ...status, aria2Engine: "error" }));
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
          setActionError(error);
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

  useEffect(() => {
    if (!newTaskOpen) {
      return;
    }

    const url = taskDraft.url.trim();
    if (!url) {
      setDownloadPreview(null);
      setPreviewStatus("idle");
      setPreviewError("");
      return;
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      setDownloadPreview(null);
      setPreviewStatus("error");
      setPreviewError("仅支持 HTTP/HTTPS 下载链接");
      return;
    }

    let alive = true;
    setPreviewStatus("loading");
    setPreviewError("");

    const timeoutId = window.setTimeout(() => {
      previewDownload({
        url,
        ...(downloadSettings.proxyUrl ? { proxyUrl: downloadSettings.proxyUrl } : {}),
      })
        .then((preview) => {
          if (!alive) {
            return;
          }

          setDownloadPreview(preview);
          setPreviewStatus("success");
          setPreviewError("");
        })
        .catch((error: unknown) => {
          if (!alive) {
            return;
          }

          setDownloadPreview(null);
          setPreviewStatus("error");
          setPreviewError(error instanceof Error ? error.message : String(error));
        });
    }, 300);

    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
    };
  }, [downloadSettings.proxyUrl, newTaskOpen, taskDraft.url]);

  async function handleCreateDownload() {
    const nextUrl = taskDraft.url.trim();
    if (!nextUrl) {
      setErrorMessage("请先输入下载链接");
      return;
    }

    setErrorMessage("");
    try {
      const taskSaveDir = taskDraft.saveDir.trim();
      const taskSplit = taskDraft.split.trim()
        ? clampSplit(Number(taskDraft.split))
        : downloadSettings.defaultSplit;
      const speedLimitKib = Number(taskDraft.speedLimitKib.trim());
      const speedLimit =
        Number.isFinite(speedLimitKib) && speedLimitKib > 0
          ? Math.round(speedLimitKib * 1024)
          : 0;
      const createInput = {
        url: nextUrl,
        saveDir: taskSaveDir || downloadSettings.defaultSaveDir,
        ...(downloadPreview?.url === nextUrl && downloadPreview.fileName
          ? { fileName: downloadPreview.fileName }
          : {}),
        ...(downloadPreview?.url === nextUrl && downloadPreview.totalBytes != null
          ? { totalBytes: downloadPreview.totalBytes }
          : {}),
        ...(downloadPreview?.url === nextUrl
          ? { resumable: downloadPreview.resumable }
          : {}),
        split: taskSplit,
        ...(speedLimit > 0 ? { speedLimit } : {}),
        ...(downloadSettings.proxyUrl ? { proxyUrl: downloadSettings.proxyUrl } : {}),
      };
      const task = await createDownload(createInput);
      setTasksState((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSelectedTaskId(task.id);
      setTaskDraft({
        url: "",
        saveDir: downloadSettings.defaultSaveDir,
        split: String(nearestQuickSplit(downloadSettings.defaultSplit)),
        speedLimitKib: "",
      });
      setDownloadPreview(null);
      setPreviewStatus("idle");
      setPreviewError("");
      setNewTaskOpen(false);
    } catch (error) {
      setActionError(error);
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
      setActionError(error);
    }
  }

  async function handleStartSelectedTask() {
    if (!selectedTask?.gid) {
      return;
    }

    try {
      await resumeDownload(selectedTask.gid);
      await refreshDownloads();
    } catch (error) {
      setActionError(error);
    }
  }

  async function handlePauseSelectedTask() {
    if (!selectedTask?.gid) {
      return;
    }

    try {
      await pauseDownload(selectedTask.gid);
      await refreshDownloads();
    } catch (error) {
      setActionError(error);
    }
  }

  async function handleResumeAllDownloads() {
    try {
      await resumeAllDownloads();
      await refreshDownloads();
    } catch (error) {
      setActionError(error);
    }
  }

  async function handlePauseAllDownloads() {
    try {
      await pauseAllDownloads();
      await refreshDownloads();
    } catch (error) {
      setActionError(error);
    }
  }

  async function handlePurgeStoppedDownloads() {
    try {
      await purgeStoppedDownloads();
      await refreshDownloads();
    } catch (error) {
      setActionError(error);
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
      setActionError(error);
    }
  }

  async function handleRemoveSelectedTask() {
    if (!selectedTask) {
      return;
    }

    await handleRemoveTask(selectedTask);
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
      setActionError(error);
    }
  }

  async function handleOpenTaskFile(task: DownloadTask) {
    if (!task.gid) {
      return;
    }

    try {
      await openDownloadFile(task.gid);
    } catch (error) {
      setActionError(error);
    }
  }

  async function handleOpenTaskDir(task: DownloadTask) {
    if (!task.gid) {
      return;
    }

    try {
      await openDownloadDir(task.gid);
    } catch (error) {
      setActionError(error);
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
      setActionError(error);
    }
  }

  function openSettingsDialog() {
    setSettingsDraft({
      defaultSaveDir: downloadSettings.defaultSaveDir,
      defaultSplit: String(downloadSettings.defaultSplit),
      maxActiveDownloads: String(downloadSettings.maxActiveDownloads),
      proxyEnabled: downloadSettings.proxyUrl.length > 0,
      proxyUrl: downloadSettings.proxyUrl,
    });
    setSettingsSection("download");
    setSettingsOpen(true);
  }

  async function handleSaveSettings() {
    const nextSettings = {
      defaultSaveDir: settingsDraft.defaultSaveDir.trim() || "D:\\Downloads",
      defaultSplit: clampSplit(Number(settingsDraft.defaultSplit)),
      maxActiveDownloads: clampMaxActiveDownloads(Number(settingsDraft.maxActiveDownloads)),
      proxyUrl: settingsDraft.proxyEnabled ? settingsDraft.proxyUrl.trim() : "",
    };

    try {
      await updateQueueSettings({ maxActiveDownloads: nextSettings.maxActiveDownloads });
      window.localStorage.setItem(settingsStorageKey, JSON.stringify(nextSettings));
      setDownloadSettings(nextSettings);
      setAppStatus((status) => ({
        ...status,
        maxActiveDownloads: nextSettings.maxActiveDownloads,
      }));
      setSettingsDraft({
        defaultSaveDir: nextSettings.defaultSaveDir,
        defaultSplit: String(nextSettings.defaultSplit),
        maxActiveDownloads: String(nextSettings.maxActiveDownloads),
        proxyEnabled: nextSettings.proxyUrl.length > 0,
        proxyUrl: nextSettings.proxyUrl,
      });
      setTaskDraft((current) => ({
        ...current,
        saveDir:
          current.saveDir.trim() === downloadSettings.defaultSaveDir
            ? nextSettings.defaultSaveDir
            : current.saveDir,
        split:
          current.split.trim() === String(downloadSettings.defaultSplit)
            ? String(nearestQuickSplit(nextSettings.defaultSplit))
            : current.split,
      }));
      setSettingsOpen(false);
    } catch (error) {
      setActionError(error);
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
          <div className="toolbar-actions">
            <button
              className="primary-action"
              onClick={() => {
                setTaskDraft({
                  url: "",
                  saveDir: downloadSettings.defaultSaveDir,
                  split: String(nearestQuickSplit(downloadSettings.defaultSplit)),
                  speedLimitKib: "",
                });
                setDownloadPreview(null);
                setPreviewStatus("idle");
                setPreviewError("");
                setNewTaskOpen(true);
              }}
              type="button"
            >
              <Plus size={16} />
              新建任务
            </button>
            <button
              disabled={!selectedTask?.gid}
              onClick={handleStartSelectedTask}
              type="button"
            >
              <Play size={15} />
              开始
            </button>
            <button
              disabled={!selectedTask?.gid}
              onClick={handlePauseSelectedTask}
              type="button"
            >
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
            <div className="batch-toolbar" aria-label="批量任务控制">
              <button onClick={handleResumeAllDownloads} type="button">
                <Play size={14} />
                全部开始
              </button>
              <button onClick={handlePauseAllDownloads} type="button">
                <Pause size={14} />
                全部暂停
              </button>
              <button onClick={handlePurgeStoppedDownloads} type="button">
                <Trash2 size={14} />
                清理完成/失败
              </button>
            </div>
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

          <aside
            className="details-panel"
            aria-label="任务详情面板"
            style={{ overflowY: "auto", scrollbarWidth: "none" }}
          >
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
                    <strong>剩余</strong>
                    {formatBytes(Math.max(0, remainingBytes))}
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
                <div className="readonly-list">
                  <span>
                    <strong>线程数</strong>
                    {selectedTask.options.split}
                  </span>
                  <span>
                    <strong>限速</strong>
                    {selectedTask.options.speedLimit > 0
                      ? formatSpeed(selectedTask.options.speedLimit)
                      : "不限"}
                  </span>
                  <span>
                    <strong>代理</strong>
                    {selectedTask.options.proxyUrl ?? "直连"}
                  </span>
                </div>

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
            {downloadSettings.defaultSplit} 线程 · 并发 {downloadSettings.maxActiveDownloads}
          </span>
          <span>
            {downloadSettings.defaultSaveDir} ·{" "}
            {downloadSettings.proxyUrl ? "代理已启用" : "直连"} · 剩余 428 GB
          </span>
          <div className="status-actions" aria-label="底部操作">
            <button
              aria-expanded={settingsOpen}
              aria-label="设置"
              onClick={() => {
                if (settingsOpen) {
                  setSettingsOpen(false);
                  return;
                }

                openSettingsDialog();
              }}
              type="button"
            >
              <Settings size={15} />
            </button>
            <button
              aria-label="删除任务"
              disabled={!selectedTask?.gid}
              onClick={handleRemoveSelectedTask}
              type="button"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </footer>
        {settingsOpen ? (
          <div className="modal-backdrop">
            <form
              aria-label="设置"
              className="settings-dialog"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveSettings();
              }}
              role="dialog"
            >
              <div className="dialog-title">
                <div>
                  <strong>设置</strong>
                  <span>下载、连接、代理与文件规则</span>
                </div>
                <button
                  aria-label="关闭设置"
                  onClick={() => setSettingsOpen(false)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="settings-layout">
                <nav
                  aria-label="设置分类"
                  className="settings-tabs"
                  role="tablist"
                >
                  {settingsTabs.map((tab) => (
                    <button
                      aria-selected={settingsSection === tab.key}
                      className={settingsSection === tab.key ? "active" : ""}
                      key={tab.key}
                      onClick={() => setSettingsSection(tab.key)}
                      role="tab"
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>

                <section
                  aria-label={`${settingsTabs.find((tab) => tab.key === settingsSection)?.label}设置`}
                  className="settings-content"
                  role="tabpanel"
                >
                  {settingsSection === "download" ? (
                    <div className="settings-page">
                      <label>
                        默认下载目录
                        <input
                          aria-label="默认下载目录"
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              defaultSaveDir: event.target.value,
                            }))
                          }
                          value={settingsDraft.defaultSaveDir}
                        />
                      </label>
                      <div className="setting-card">
                        <span>完成后</span>
                        <strong>保留任务记录</strong>
                      </div>
                    </div>
                  ) : null}

                  {settingsSection === "connection" ? (
                    <div className="settings-page">
                      <label>
                        默认线程数
                        <input
                          aria-label="默认线程数"
                          inputMode="numeric"
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              defaultSplit: event.target.value,
                            }))
                          }
                          value={settingsDraft.defaultSplit}
                        />
                      </label>
                      <div className="split-choices" aria-label="默认线程快捷选择">
                        {quickSplitOptions.map((split) => (
                          <button
                            className={
                              settingsDraft.defaultSplit === String(split) ? "active" : ""
                            }
                            key={split}
                            onClick={() =>
                              setSettingsDraft((current) => ({
                                ...current,
                                defaultSplit: String(split),
                              }))
                            }
                            type="button"
                          >
                            {split}
                          </button>
                        ))}
                      </div>
                      <label>
                        最大同时下载数
                        <input
                          aria-label="最大同时下载数"
                          inputMode="numeric"
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              maxActiveDownloads: event.target.value,
                            }))
                          }
                          value={settingsDraft.maxActiveDownloads}
                        />
                      </label>
                      <div className="split-choices" aria-label="最大同时下载快捷选择">
                        {[1, 3, 5, 10].map((count) => (
                          <button
                            className={
                              settingsDraft.maxActiveDownloads === String(count)
                                ? "active"
                                : ""
                            }
                            key={count}
                            onClick={() =>
                              setSettingsDraft((current) => ({
                                ...current,
                                maxActiveDownloads: String(count),
                              }))
                            }
                            type="button"
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {settingsSection === "proxy" ? (
                    <div className="settings-page">
                      <label className="switch-row">
                        <input
                          aria-label="使用代理"
                          checked={settingsDraft.proxyEnabled}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              proxyEnabled: event.target.checked,
                            }))
                          }
                          type="checkbox"
                        />
                        使用代理
                      </label>
                      <label>
                        HTTP/HTTPS 代理
                        <input
                          aria-label="HTTP/HTTPS 代理"
                          disabled={!settingsDraft.proxyEnabled}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              proxyUrl: event.target.value,
                            }))
                          }
                          placeholder="http://127.0.0.1:7890"
                          value={settingsDraft.proxyUrl}
                        />
                      </label>
                    </div>
                  ) : null}

                  {settingsSection === "file" ? (
                    <div className="settings-page">
                      <div className="setting-card">
                        <span>文件分类</span>
                        <strong>按扩展名识别</strong>
                      </div>
                      <div className="setting-card">
                        <span>重复文件</span>
                        <strong>自动重命名</strong>
                      </div>
                    </div>
                  ) : null}

                  {settingsSection === "advanced" ? (
                    <div className="settings-page">
                      <div className="setting-card">
                        <span>下载引擎</span>
                        <strong>内置 aria2</strong>
                      </div>
                      <div className="setting-card">
                        <span>RPC 端口</span>
                        <strong>6800</strong>
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>

              <div className="settings-footer">
                <button onClick={() => setSettingsOpen(false)} type="button">
                  取消
                </button>
                <button className="primary-action" type="submit">
                  保存设置
                </button>
              </div>
            </form>
          </div>
        ) : null}
        {newTaskOpen ? (
          <div className="modal-backdrop">
            <form
              aria-label="新建下载任务"
              className="new-task-dialog"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateDownload();
              }}
              role="dialog"
            >
              <div className="dialog-title">
                <div>
                  <strong>新建下载任务</strong>
                  <span>粘贴链接，确认目录，然后开始下载。</span>
                </div>
                <button
                  aria-label="关闭新建任务"
                  onClick={() => setNewTaskOpen(false)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
              <label className="wide-field">
                下载链接
                <input
                  aria-label="下载链接"
                  autoFocus
                  onChange={(event) =>
                    setTaskDraft((current) => ({ ...current, url: event.target.value }))
                  }
                  placeholder="https://example.com/file.zip"
                  value={taskDraft.url}
                />
              </label>
              <div className={`preview-card ${previewStatus}`} aria-live="polite">
                {previewStatus === "idle" ? (
                  <>
                    <span>文件信息</span>
                    <strong>输入链接后自动解析</strong>
                  </>
                ) : null}
                {previewStatus === "loading" ? (
                  <>
                    <span>文件信息</span>
                    <strong>正在解析...</strong>
                  </>
                ) : null}
                {previewStatus === "success" && downloadPreview ? (
                  <>
                    <span>文件信息</span>
                    <strong>{downloadPreview.fileName}</strong>
                    <small>
                      {downloadPreview.totalBytes != null
                        ? formatBytes(downloadPreview.totalBytes)
                        : "未知大小"}{" "}
                      · {downloadPreview.resumable ? "支持断点续传" : "普通下载"}
                    </small>
                  </>
                ) : null}
                {previewStatus === "error" ? (
                  <>
                    <span>文件信息</span>
                    <strong>{previewError}</strong>
                    <small>仍可手动创建下载任务</small>
                  </>
                ) : null}
              </div>
              <label className="wide-field">
                保存目录
                <input
                  aria-label="保存目录"
                  onChange={(event) =>
                    setTaskDraft((current) => ({ ...current, saveDir: event.target.value }))
                  }
                  value={taskDraft.saveDir}
                />
              </label>
              <div className="dialog-grid">
                <div className="thread-select-field">
                  <span>线程数</span>
                  <div className="quick-splits" aria-label="线程数选择" role="radiogroup">
                    {quickSplitOptions.map((split) => (
                      <button
                        aria-checked={taskDraft.split === String(split)}
                        className={taskDraft.split === String(split) ? "active" : ""}
                        key={split}
                        onClick={() =>
                          setTaskDraft((current) => ({ ...current, split: String(split) }))
                        }
                        role="radio"
                        type="button"
                      >
                        {split}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  限速 KB/s
                  <input
                    aria-label="限速 KB/s"
                    inputMode="numeric"
                    onChange={(event) =>
                      setTaskDraft((current) => ({
                        ...current,
                        speedLimitKib: event.target.value,
                      }))
                    }
                    placeholder="不限"
                    value={taskDraft.speedLimitKib}
                  />
                </label>
              </div>
              <div className="dialog-actions">
                <button onClick={() => setNewTaskOpen(false)} type="button">
                  取消
                </button>
                <button className="primary-action" type="submit">
                  开始下载
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default App;
