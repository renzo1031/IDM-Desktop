import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const targetDir =
  process.env.CARGO_TARGET_DIR ||
  join(process.cwd(), "src-tauri", "target");
const releaseDir = join(targetDir, "release");
const nsisScript = join(releaseDir, "nsis", "x64", "installer.nsi");
const loaderDll = join(releaseDir, "WebView2Loader.dll");

const hookFile = join(process.cwd(), "src-tauri", "nsis-hooks.nsh");
const failures = [];

if (!existsSync(loaderDll)) {
  failures.push(`未找到构建输出中的 WebView2Loader.dll: ${loaderDll}`);
}

if (!existsSync(nsisScript)) {
  failures.push(`未找到 NSIS 脚本: ${nsisScript}`);
} else {
  const script = readFileSync(nsisScript, "utf8");
  if (!script.includes("nsis-hooks.nsh")) {
    failures.push("NSIS 脚本未包含 nsis-hooks.nsh");
  }

  if (!script.includes('!define INSTALLERICON "')) {
    failures.push("NSIS 脚本未配置安装包图标");
  }
}

if (!existsSync(hookFile)) {
  failures.push(`未找到 NSIS hook 文件: ${hookFile}`);
} else {
  const hook = readFileSync(hookFile, "utf8");
  if (!hook.includes("WebView2Loader.dll")) {
    failures.push("NSIS hook 未包含 WebView2Loader.dll 复制/清理逻辑");
  }

  if (!hook.includes("NSIS_HOOK_POSTINSTALL")) {
    failures.push("NSIS hook 未定义安装后复制宏");
  }

  if (!hook.includes("NSIS_HOOK_PREUNINSTALL")) {
    failures.push("NSIS hook 未定义卸载前清理宏");
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Tauri bundle verification passed.");
