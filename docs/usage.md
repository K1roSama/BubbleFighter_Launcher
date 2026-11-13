# 使用说明

## 安装与启动

将 Release ZIP 的全部内容解压到游戏目录，再运行 `GameLauncher.exe`。普通启动器为 Windows x64 程序，游戏客户端仍可为 32 位。不要单独移动 `GameLauncher.exe` 或 Electron EXE。

默认选择 `BubbleFighterU.exe`；在设置中可选择其他现有 EXE。实际客户端是否支持登录票据取决于其登录适配器。

## 账号与服务器

账号为 3 至 24 位字母、数字或下划线，密码为 8 至 64 个字符。注册、密码验证和登录票据均由目标服务端处理。

默认内置“泡泡一区”`127.0.0.1:7100`。在设置的服务器窗口中添加自定义服务器，地址必须为 IPv4，端口范围为 1 至 65535。内置条目始终保留；自定义条目可删除。切换到不同服务器会退出当前账号，需在目标服务端重新登录。

游戏运行时不能更换服务器或客户端；主题仍可切换。普通模式检测到 `BubbleFighter.exe` 或 `BubbleFighterU.exe` 已运行时会阻止重复启动。

## 配置与登录记录

- `launcher/settings.json`：安装目录内的服务器、账号名、主题、自定义服务器和客户端路径。
- `launcher/settings.split.json`：独立登录配置模式的设置。
- `%APPDATA%/bubblefighter-launcher/sessions/`：普通模式的加密登录记录；独立登录模式使用 `%APPDATA%/BubbleFighterLauncherSplit/sessions/`。实际应用数据目录可受 Electron 环境配置影响。

登录密码使用 Windows DPAPI 加密，只能由对应 Windows 用户解密。临时断网会保留记录；主动退出、更换服务器或服务端明确拒绝凭据时会清理。系统无法提供加密保存时，仅保持当前会话登录并显示提示。

每次启动游戏前重新申请一次性票据，启动成功或失败不会直接清除已登录账号。票据通过 `BF_LOGIN_TICKET`、账号名通过 `BF_LOCAL_NAME` 传给游戏进程。

启动器会更新客户端目录内 `login.ini` 的游戏与家族服务器字段。若原文件存在内容，第一次更新会创建 `login.ini.launcher-backup`。请确保游戏目录可写。

## 独立登录服务

登录服务可在成功响应中返回 `game` 对象：`host`、`port`、`clan_host`、`clan_port` 与正整数 `region_id`。启动器仍保存登录服务地址，启动游戏时使用返回的游戏与家族地址；未返回 `game` 时沿用登录地址，并使用相邻的家族端口。此兼容路径的游戏端口不能为 65535。

通过环境变量启动独立配置会话：

```powershell
$env:BF_LAUNCHER_PROFILE = 'split'
$env:BF_LAUNCHER_SERVER_HOST = '127.0.0.1'
$env:BF_LAUNCHER_SERVER_PORT = '7190'
.\GameLauncher.exe
Remove-Item Env:BF_LAUNCHER_PROFILE,Env:BF_LAUNCHER_SERVER_HOST,Env:BF_LAUNCHER_SERVER_PORT
```

地址环境变量用于覆盖此次会话的登录入口。普通模式不设置这些变量即可。

## 多开

发布包保留原生多开器及 `BF_LAUNCHER_MULTI` 入口。已有一个客户端时，在 PowerShell 中运行：

```powershell
$env:BF_LAUNCHER_MULTI = '1'
.\GameLauncher.exe
Remove-Item Env:BF_LAUNCHER_MULTI
```

第二个会话使用独立登录记录，建议使用不同账号。多开器只支持源码中匹配的 x86 镜像：时间戳 `0x595CE881`、镜像大小 `0x01783000`、互斥量地址与原始字符串均必须校验通过；校验失败会关闭刚创建的子进程。

此能力依赖具体客户端布局，不保证当前其他客户端兼容，也不保证实际联机服务允许同时登录。

## 网络与兼容性

服务端需要实现本项目 TCP 握手、注册／登录操作与一次性票据协议。当前传输没有 TLS，不能把本地 DPAPI 加密视作网络加密。

启动器不会自动启动服务端、安装客户端补丁或安装运行库。无法进入游戏时应同时核对服务端协议、客户端登录适配器与客户端自身运行环境。
