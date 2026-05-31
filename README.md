<p align="center">
  <br />
  <h1 align="center">IDM Desktop</h1>
  <p align="center">
    一个内置 aria2 的紧凑型桌面下载管理器。
  </p>
  <p align="center">
    <strong>粘贴链接。选择目录。开始下载。</strong>
  </p>
  <p align="center">
    <a href="#快速开始">快速开始</a>
    ·
    <a href="#功能特性">功能特性</a>
    ·
    <a href="#路线图">路线图</a>
    ·
    <a href="#开发">开发</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/status-preview-2569D6?style=flat-square" alt="状态" />
    <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square" alt="平台" />
    <img src="https://img.shields.io/badge/Tauri-2.x-24C8DB?style=flat-square" alt="Tauri" />
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square" alt="React" />
    <img src="https://img.shields.io/badge/Rust-backend-000000?style=flat-square" alt="Rust" />
    <img src="https://img.shields.io/badge/aria2-bundled-2569D6?style=flat-square" alt="aria2" />
    <img src="https://img.shields.io/badge/QQ-1852568062-12B7F5?style=flat-square&logo=tencentqq&logoColor=white" alt="QQ" />
    <a href="mailto:1852568062@qq.com">
      <img src="https://img.shields.io/badge/1852568062%40qq.com-D14836?style=flat-square&logo=gmail&logoColor=white" alt="QQ 邮箱" />
    </a>
  </p>
</p>

---

## 预览

IDM Desktop 正在进行界面重设计。当前版本已经具备核心下载流程，等下一轮 UI 稳定后会在这里补充正式产品截图。

```text
新建任务 -> 链接预解析 -> 多线程下载 -> 队列管理 -> 文件操作
```

## 为什么做这个项目

很多下载工具要么过于技术化，要么界面过重。IDM Desktop 希望做一个更小、更直接的桌面下载器：

- 不需要单独安装 aria2
- 不做全屏仪表盘式界面
- 不把高级设置分散到各个角落
- 不让删除任务和删除文件混在一起
- 保留传统下载软件熟悉的窗口体验

## 功能特性

- 内置 aria2 下载引擎
- 支持 HTTP/HTTPS 下载任务
- 支持多线程下载配置
- 支持断点续传
- 新建任务前预解析文件名、大小和续传能力
- 支持单任务保存目录
- 支持默认下载目录
- 支持 HTTP/HTTPS 代理设置
- 支持最大同时下载数和任务队列
- 支持全部开始、全部暂停、清理完成/失败任务
- 支持任务属性弹窗
- 支持打开文件和打开所在目录
- 删除任务时可选择“仅删除任务”或“删除任务和文件”

## 快速开始

```powershell
git clone https://github.com/renzo1031/idm-desktop.git
cd idm-desktop
npm install
npm run tauri dev
```

> 当前项目仍处于预览阶段，正式安装包会在后续版本补充。

## 使用方式

1. 点击“新建任务”。
2. 粘贴 HTTP/HTTPS 下载链接。
3. 等待文件信息预解析。
4. 选择保存目录和线程数。
5. 开始下载。

任务创建后，可以暂停、继续、打开、查看属性或从任务列表中删除。

## 路线图

- [x] 内置 aria2 引擎
- [x] HTTP/HTTPS 下载
- [x] 多线程下载选项
- [x] 断点续传
- [x] 下载队列与批量控制
- [x] 新建任务前文件信息预解析
- [x] 代理设置
- [ ] 剪贴板链接监听
- [ ] 浏览器下载接管
- [ ] BT 与磁力链任务
- [ ] 下载计划、限速时段和队列优先级
- [ ] 全新的 UI 视觉系统
- [ ] 正式发布安装包

## 开发

```powershell
npm run dev
npm test
npm run build
npm run tauri dev
```

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Rust
- aria2 RPC
- Vitest

## 内置 aria2

Windows 版本的 aria2 二进制位于：

```text
src-tauri/resources/aria2/aria2c.exe
```

更新 aria2 时，替换该文件后检查版本：

```powershell
.\src-tauri\resources\aria2\aria2c.exe --version
```

## 联系

- QQ：1852568062
- QQ 邮箱：<a href="mailto:1852568062@qq.com">1852568062@qq.com</a>

## 项目状态

本项目正在持续开发中。当前目标是先把核心下载管理能力做稳定，再逐步扩展浏览器接管、媒体解析和更多下载协议支持。
