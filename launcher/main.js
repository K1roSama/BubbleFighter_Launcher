'use strict';
const {app, BrowserWindow, ipcMain, safeStorage, dialog, nativeTheme} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const client = require('./client');
const {createGameMonitor} = require('./game-state');
const {LauncherError, chineseError} = require('./errors');
const {LoginSession} = require('./session');
const {createHash} = require('node:crypto');
const LIGHT_BACKGROUND = '#f6f8fd';
const DEFAULT_CLIENT = 'BubbleFighterU.exe';
// 内置服务器仅官方区服：恒定存在且不可删除；"本地"等测试服务器由用户以自定义条目添加。
const DEFAULT_SERVERS = [
  {label: '泡泡一区', host: '127.0.0.1', port: 7100}
];
const DEFAULT_ENDPOINT = {host: DEFAULT_SERVERS[0].host, port: DEFAULT_SERVERS[0].port};
function isBuiltinServer(server) { return DEFAULT_SERVERS.some(item => item.host === server.host && item.port === server.port); }
const DARK_BACKGROUND = '#101a30';
function backgroundForTheme(theme) { return theme === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND; }
const splitProfile = process.env.BF_LAUNCHER_PROFILE === 'split';
if (splitProfile) app.setPath('userData', path.join(app.getPath('appData'), 'BubbleFighterLauncherSplit'));
const root = app.isPackaged ? path.resolve(path.dirname(process.execPath), '../../..') : path.resolve(__dirname, '..');
const settingsFile = path.join(root, splitProfile ? 'launcher/settings.split.json' : 'launcher/settings.json');
let initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
try {
  const savedTheme = JSON.parse(require('node:fs').readFileSync(settingsFile, 'utf8')).theme;
  if (savedTheme === 'dark' || savedTheme === 'light') initialTheme = savedTheme;
} catch {}
const multiClient = process.env.BF_LAUNCHER_MULTI === '1';
let configuredEndpoint = null;
try {
  if (process.env.BF_LAUNCHER_SERVER_HOST || process.env.BF_LAUNCHER_SERVER_PORT) {
    configuredEndpoint = client.endpoint(process.env.BF_LAUNCHER_SERVER_HOST, process.env.BF_LAUNCHER_SERVER_PORT);
  }
} catch {}
const sessionKey = createHash('sha256').update(root.toLowerCase() + (multiClient ? ':multi' : ':normal')).digest('hex').slice(0, 24);
const session = new LoginSession(path.join(app.getPath('userData'), 'sessions', sessionKey + '.bin'), safeStorage, client.authenticate);
let window, splashWindow, busy = false, restored = false, currentTheme = initialTheme, currentClientExecutable = DEFAULT_CLIENT, currentCustomServers = [], currentEndpoint = {...DEFAULT_ENDPOINT};
// 唯一的进程监听实例：轮询游戏进程，状态变化时向渲染层广播 game:state（启动按钮与设置锁定共用同一状态源）。
const gameMonitor = createGameMonitor({
  probe: client.runningGame,
  onChange: running => { if (window && !window.isDestroyed()) window.webContents.send('game:state', {running}); }
});
function closeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) { splashWindow = null; return; }
  splashWindow.close(); splashWindow = null;
}
function createSplash() {
  splashWindow = new BrowserWindow({width: 360, height: 240, frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, resizable: false, skipTaskbar: true, show: false,
    webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true}});
  splashWindow.setMenu(null);
  splashWindow.once('ready-to-show', () => splashWindow.show());
  splashWindow.loadFile(path.join(__dirname, 'splash.html')).catch(closeSplash);
}
if (!multiClient && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(() => {
    createSplash();
    window = new BrowserWindow({width: 1000, height: 625, resizable: false, maximizable: false, frame: false,
      backgroundColor: backgroundForTheme(initialTheme), show: false, title: multiClient ? '泡泡战士 · 第二客户端' : '泡泡战士',
      webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.once('ready-to-show', () => { window.show(); closeSplash(); });
    window.on('closed', () => { session.account = null; window = null; closeSplash(); });
    gameMonitor.start();
    // Dev-only hot reload: refresh the window on renderer changes; dev.js restarts the app on main-process changes.
    if (!app.isPackaged && process.env.BF_DEV_WATCH === '1') {
      const {enableDevWatch, RESTART_EXIT_CODE} = require('./dev-watch');
      enableDevWatch({
        dir: __dirname,
        reload: () => { if (window && !window.isDestroyed()) window.webContents.reloadIgnoringCache(); },
        restart: () => app.exit(RESTART_EXIT_CODE)
      });
    }
    return window.loadFile(path.join(__dirname, 'index.html'));
  }).catch(() => { closeSplash(); dialog.showErrorBox('启动器错误', '启动器无法打开，请检查程序文件是否完整，并重新启动。'); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => gameMonitor.stop());
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, input) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return {ok: false, message: '无效请求。'};
    try { return {ok: true, ...(await callback(input))}; }
    catch (error) { return {ok: false, message: chineseError(error), authenticated: Boolean(session.publicState())}; }
  });
}
handle('settings:read', async () => {
  let settings = {...(configuredEndpoint || DEFAULT_ENDPOINT), name: '', theme: initialTheme,
    customServers: DEFAULT_SERVERS, clientExecutable: DEFAULT_CLIENT};
  try {
    const data = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    const theme = data.theme === 'dark' || data.theme === 'light' ? data.theme : initialTheme;
    currentTheme = theme;
    const customServers = client.cleanServers(data.customServers || []).filter(item => !isBuiltinServer(item));
    settings = {...(configuredEndpoint || client.endpoint(data.host, data.port)), name: String(data.name || '').slice(0, 24), theme,
      customServers: [...DEFAULT_SERVERS, ...customServers], clientExecutable: String(data.clientExecutable || DEFAULT_CLIENT).slice(0, 520)};
  } catch {}
  currentEndpoint = {host: settings.host, port: settings.port};
  currentClientExecutable = settings.clientExecutable;
  currentCustomServers = settings.customServers.filter(item => !isBuiltinServer(item));
  const executable = await client.findClientPath(root, settings.clientExecutable);
  let warning = '';
  if (!restored) {
    restored = true;
    try { await session.restore(settings); } catch (error) { warning = chineseError(error); }
  }
  return {client: executable, multiClient, gameRunning: gameMonitor.isRunning(), settings, builtinServers: DEFAULT_SERVERS, session: session.publicState(), warning};
});
handle('settings:save', async values => {
  if (!values || typeof values !== 'object') throw new LauncherError('设置无效。');
  if (values.theme !== undefined && values.theme !== 'light' && values.theme !== 'dark') throw new LauncherError('主题设置无效。');
  if (busy) throw new LauncherError('请等待当前操作完成。');
  if (values.theme === 'light' || values.theme === 'dark') currentTheme = values.theme;
  const target = client.endpoint(values.host, values.port);
  // 游戏运行期间锁定服务器与客户端：界面已禁用对应控件，此处兜底防止竞态或绕过（主题等其余设置不受影响）。
  if (gameMonitor.isRunning()) {
    if (target.host !== currentEndpoint.host || target.port !== currentEndpoint.port) throw new LauncherError('游戏运行中，无法更改服务器。');
    if (values.clientExecutable !== undefined && values.clientExecutable !== currentClientExecutable) throw new LauncherError('游戏运行中，无法更改游戏客户端。');
  }
  const current = session.publicState();
  if (current && (current.host !== target.host || current.port !== target.port)) await session.logout();
  if (values.clientExecutable !== undefined && (!values.clientExecutable || typeof values.clientExecutable !== 'string' || values.clientExecutable.length > 520 || values.clientExecutable.includes('\0'))) {
    throw new LauncherError('所选游戏客户端无效，请选择 EXE 文件。');
  }
  if (values.clientExecutable !== undefined && values.clientExecutable !== DEFAULT_CLIENT && !await client.validateClientExecutable(root, values.clientExecutable)) {
    throw new LauncherError('所选游戏客户端无效，请选择存在的 EXE 文件。');
  }
  if (values.clientExecutable !== undefined) currentClientExecutable = values.clientExecutable;
  if (values.customServers !== undefined) currentCustomServers = client.cleanServers(values.customServers);
  const saved = await client.saveSettings(settingsFile, {...values, customServers: values.customServers || currentCustomServers, clientExecutable: values.clientExecutable || currentClientExecutable});
  currentEndpoint = {host: saved.host, port: saved.port};
  return {settings: saved};
});
handle('client:selectExecutable', async () => {
  const result = await dialog.showOpenDialog(window, {properties: ['openFile'], filters: [{name: '游戏客户端', extensions: ['exe']}]});
  if (result.canceled || !result.filePaths[0]) return {canceled: true};
  const selected = result.filePaths[0];
  if (!await client.validateClientExecutable(root, selected)) throw new LauncherError('所选游戏客户端无效，请选择存在的 EXE 文件。');
  return {clientExecutable: selected};
});
handle('client:status', async input => {
  const configured = input && typeof input.clientExecutable === 'string' ? input.clientExecutable : DEFAULT_CLIENT;
  const resolved = await client.validateClientExecutable(root, configured);
  return {clientExecutable: configured, exists: Boolean(resolved), path: resolved || path.resolve(root, configured)};
});
handle('window:setBackground', async input => {
  if (!input || typeof input.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.color)) throw new LauncherError('窗口背景颜色无效。');
  window.setBackgroundColor(input.color);
  return {};
});
handle('account:authenticate', async input => {
  if (busy) throw new LauncherError('请等待当前操作完成。');
  busy = true;
  try {
    const target = client.endpoint(input.host, input.port);
    if (input.action === 'register' && input.password !== input.confirm) throw new LauncherError('两次输入的密码不一致。');
    const result = await client.authenticate({...input, ...target});
    let warning = '';
    if (input.action === 'login') warning = await session.remember({...input, ...target}, result);
    try { await client.saveSettings(settingsFile, {...input, ...target, name: result.name, theme: currentTheme, customServers: currentCustomServers, clientExecutable: currentClientExecutable}); }
    catch { warning = '账号操作成功，但无法保存设置，请检查启动器目录的写入权限。'; }
    return {name: result.name, warning};
  } finally { busy = false; }
});
handle('account:logout', async () => {
  if (busy) throw new LauncherError('请等待当前操作完成。');
  busy = true;
  try { await session.logout(); return {}; } finally { busy = false; }
});
handle('game:launch', async () => {
  if (busy) throw new LauncherError('请等待当前操作完成。');
  busy = true;
  try {
    // Do not replace a pending ticket when an existing game is starting/running.
    if (!multiClient && await client.runningGame()) throw new LauncherError('游戏已在运行，请先关闭游戏。');
    const identity = await session.ticket();
    const result = await client.launchGame(root, identity, {multi: multiClient, executable: currentClientExecutable});
    gameMonitor.markRunning();
    return result;
  }
  finally { busy = false; }
});
handle('window:minimize', async () => { window.minimize(); return {}; });
handle('window:close', async () => { if (busy) throw new LauncherError('正在处理，请稍候。'); window.close(); return {}; });
