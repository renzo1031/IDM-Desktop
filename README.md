# IDM Desktop

万能下载管理器桌面应用。当前技术栈为 Tauri + React + TypeScript + Rust，下载引擎使用随软件打包的 aria2。

## 当前能力

- 默认 980×680 下载器窗口。
- 三栏任务管理界面，支持 980px、900px、820px 关键宽度响应式布局。
- 内置 `aria2c.exe`，无需用户单独安装 aria2。
- Rust 后端可启动 aria2 RPC，并构造多线程、断点续传下载任务。
- 前端支持输入 HTTP/HTTPS 链接创建任务，并调用暂停、继续、删除命令。

## 开发命令

```powershell
npm install
npm run dev
npm test
npm run build
```

Rust 在当前 Windows 环境使用 GNU 工具链验证：

```powershell
$env:CARGO_TARGET_DIR='E:\idm-cargo-target'
cargo +stable-x86_64-pc-windows-gnu test --lib
cargo +stable-x86_64-pc-windows-gnu check --lib
```

## 内置 aria2

Windows 版本的 aria2 二进制位于：

```text
src-tauri/resources/aria2/aria2c.exe
```

更新 aria2 时，将新的 `aria2c.exe` 替换到该目录，并执行：

```powershell
.\src-tauri\resources\aria2\aria2c.exe --version
```
