# 构建指南

## 环境准备

- Windows x64、Node.js 24 LTS 和 npm。
- .NET Framework 4.x：脚本调用 `%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe`。
- Visual Studio 2022 / 2026 或 Build Tools，安装“使用 C++ 的桌面开发”、MSVC x86/x64 工具及 Windows SDK。多开器针对 32 位客户端，必须使用 x86 编译器。

所有命令从仓库根目录执行。构建不需要数据库、Python 或游戏客户端。

```powershell
npm ci --prefix launcher
```

## 开发运行

```powershell
npm run dev --prefix launcher
```

开发模式会监听 Tailwind、刷新渲染页面，并在主进程文件改变后重启 Electron。只运行一次时：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start --prefix launcher
```

源码运行以仓库根目录作为游戏目录；也可在设置中选择外部客户端。请为开发连接配置自己的兼容服务器。

## 生成发布包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
```

脚本检查 JavaScript 语法，构建 Tailwind CSS、原生进程辅助程序、Electron 应用、根目录入口和 x86 多开器，再校验打包文件并生成：

```text
release/
├── BubbleFighterLauncher-v1.2.1-win32-x64.zip
├── SHA256SUMS.txt
└── staging/v1.2.1/                    # 与 ZIP 内容一致的展开目录
```

版本号取自 `launcher/package.json`。ZIP 中包含游戏根目录入口、完整 Electron 目录、多开器、许可证、文档和配置示例；不包含游戏客户端、用户设置、账号记录、依赖开发目录或测试文件。

仅构建 Electron 应用：

```powershell
npm run package --prefix launcher
```

此命令不生成根目录 `GameLauncher.exe`、多开器或最终 ZIP；完整分发应运行 `build-release.ps1`。

## CI 与 Release

`.github/workflows/ci.yml` 在推送到 `main`、Pull Request 和手动运行时，使用 Windows runner 与 Node.js 24 执行同一套构建。成功后上传 ZIP 与校验文件作为 Actions artifact，保留 14 天。

推送 `v*` 标签时，同一工作流先校验标签与包版本一致，完成构建后再创建 Release，上传 ZIP 与校验文件，并标记为最新版本。Release 内容取自 `CHANGELOG.md` 对应版本段落。

发布示例：

```powershell
# 先更新 package.json、package-lock.json 和 CHANGELOG.md，并提交到 main。
git push origin main
# 确认 main 的 CI 成功，再发布对应版本标签。
git tag -a v1.2.1 -m "BubbleFighter Launcher v1.2.1"
git push origin v1.2.1
```

发布权限只授予标签触发的发布 job。普通构建和 Pull Request 只需要仓库读取权限。

校验下载文件：

```powershell
Get-FileHash .\BubbleFighterLauncher-v1.2.1-win32-x64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

## 常见问题

- `npm ci` 失败：使用 Node.js 24，检查 npm registry 与 GitHub 下载网络。Electron 安装会下载 Windows 运行库。
- 找不到 `csc.exe`：安装或修复 .NET Framework 4.x。
- 找不到 MSVC：通过 Visual Studio Installer 安装 C++ x86/x64 工具与 Windows SDK。脚本使用 `vswhere.exe` 自动定位，也支持已配置好的 x86 Developer PowerShell。
- 出现 `ELECTRON_RUN_AS_NODE` 问题：开发启动前移除该环境变量；`GameLauncher.exe` 会在启动正式应用时移除它。
- 更改程序布局后无法启动：保持 README 中的分发目录结构，完整替换应用目录及 `app.asar.unpacked`。
