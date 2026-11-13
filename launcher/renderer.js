'use strict';
const $ = id => document.getElementById(id);
let page = 'login', returnPage = 'login', busy = false, detected = false, currentTheme = 'light', multiClient = false;
let clientExecutable = 'BubbleFighterU.exe', clientExists = false, gameRunning = false;
// 内置服务器只有官方区服（不可删除）；"本地"等其它服务器由用户以自定义条目管理。
let servers = [{id: 'paopao-1', label: '泡泡一区', host: '127.0.0.1', port: 7100, source: 'builtin'}];
function status(message = '', kind = '') { $('status').textContent = message; $('status').className = kind; }
function applyTheme(theme) {
  currentTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = currentTheme;
  $('theme-toggle').setAttribute('aria-pressed', String(currentTheme === 'dark'));
  $('settings-theme-toggle').textContent = currentTheme === 'dark' ? '浅色' : '深色';
}
function markInvalid(ids) {
  for (const id of ids) {
    const field = $(id);
    if (!field) continue;
    field.classList.remove('invalid'); void field.offsetWidth; field.classList.add('invalid');
    window.setTimeout(() => field.classList.remove('invalid'), 550);
  }
}
function values() { return {host: $('host').value.trim(), port: $('port').value.trim(), name: $('login-name').value.trim()}; }
function settingsValues(extra = {}) {
  const value = {...values(), theme: currentTheme, customServers: servers.filter(item => item.source !== 'builtin').map(({label, host, port}) => ({label, host, port})), clientExecutable, ...extra};
  return value;
}
async function savePreferences(extra = {}) {
  let result;
  try { result = await window.launcher.save(settingsValues(extra)); }
  catch { result = {ok: false, message: '设置保存失败，请重试。'}; }
  if (!result.ok) status(result.message, 'error');
  return result;
}
function route(next, options = {}) {
  page = next;
  for (const name of ['login', 'register', 'ready', 'settings']) $(name + '-page').hidden = name !== next;
  document.body.classList.toggle('authenticated', next === 'ready');
  for (const id of ['login-password', 'register-password', 'register-confirm']) $(id).value = '';
  $('server-state').textContent = next === 'ready' ? '已登录' : '';
  status();
  if (next === 'login') $('login-name').focus();
  else if (next === 'register') $('register-name').focus();
  else if (next === 'settings' && options.focusClient) focusClientSetting();
  else if (next === 'settings' && options.serverList) openServerListDialog();
  else if (next === 'ready') $('launch').focus();
}
function openSettings(options = {}) { returnPage = page === 'settings' ? returnPage : page; route('settings', options); }
function closeSettings() { route(returnPage === 'settings' ? 'login' : returnPage); }
function focusClientSetting() {
  const row = $('client-setting-row');
  row.scrollIntoView({block: 'nearest'}); row.classList.remove('attention'); void row.offsetWidth; row.classList.add('attention');
  window.setTimeout(() => row.classList.remove('attention'), 650);
  $('select-client').focus();
}
function setClientState(exists, configured = clientExecutable, selectedPath = '') {
  clientExists = Boolean(exists); clientExecutable = configured || 'BubbleFighterU.exe';
  $('client-file').textContent = selectedPath || clientExecutable;
  // 已设置客户端时悬停展示完整路径；未设置/未找到时不提示。
  $('client-file').title = selectedPath || '';
  $('client-warning').hidden = clientExists;
  $('client-setting-row').classList.toggle('missing', !clientExists);
  renderGameState();
}
// 游戏运行状态（主进程进程监听经 onGameState 推送）统一驱动启动按钮与运行期锁定（重新登录、设置项），避免多处状态漂移。
function renderGameState() {
  const button = $('launch');
  button.classList.toggle('needs-client', !clientExists);
  button.classList.toggle('running', gameRunning);
  button.disabled = gameRunning;
  button.textContent = !clientExists ? '未找到游戏客户端' : gameRunning ? '游戏运行中' : multiClient ? '启动第二客户端' : '启动游戏';
  for (const id of ['logout', 'custom-server', 'select-client', 'go-add-server']) $(id).disabled = gameRunning || busy;
  for (const card of document.querySelectorAll('.server-card')) card.disabled = gameRunning || busy;
}
// 启动页服务器网格：bordered 单选卡片（Element-plus 风格：左侧圆点指示器 + 名称）；
// 出于安全考虑不展示服务器 IP/端口，点击切换端点（已登录时主进程会注销旧端点会话并要求重新登录）。
function renderServerGrid() {
  const grid = $('server-grid'); grid.textContent = '';
  grid.hidden = servers.length === 0;
  $('go-add-server').hidden = servers.length > 0;
  const host = $('host').value, port = Number($('port').value);
  for (const server of servers) {
    const selected = server.host === host && server.port === port;
    const card = document.createElement('button'); card.type = 'button'; card.className = 'server-card'; card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(selected)); card.disabled = gameRunning || busy;
    if (selected) card.classList.add('selected');
    const dot = document.createElement('i'); dot.className = 'server-card-dot'; dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'server-card-name'; name.textContent = server.label;
    card.append(dot, name);
    card.addEventListener('click', () => selectServer(server));
    grid.append(card);
  }
}
// 服务器设置列表（一层 dialog）：官方条目只读（不可编辑/删除），自定义条目点击进入二层编辑、× 删除；不展示 IP（编辑时可预填看到）。
function renderServerList() {
  const list = $('server-list'); list.textContent = '';
  for (const server of servers) {
    const editable = server.source !== 'builtin';
    const item = document.createElement('div'); item.className = 'server-item';
    const main = document.createElement(editable ? 'button' : 'div'); main.className = 'server-item-main';
    const title = document.createElement('span'); title.className = 'server-item-title';
    const name = document.createElement('span'); name.className = 'server-item-name'; name.textContent = server.label;
    title.append(name);
    if (!editable) { const tag = document.createElement('span'); tag.className = 'server-tag'; tag.textContent = '官方'; title.append(tag); }
    main.append(title); item.append(main);
    if (editable) {
      main.type = 'button'; main.addEventListener('click', () => openServerDialog(server));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'server-item-delete'; remove.setAttribute('aria-label', '删除 ' + server.label); remove.textContent = '×';
      remove.addEventListener('click', () => deleteServer(server));
      item.append(remove);
    }
    list.append(item);
  }
}
function openServerListDialog() {
  if (busy || gameRunning) return;
  renderServerList();
  $('server-list-dialog').hidden = false; $('server-list-dialog').classList.add('open');
}
function closeServerListDialog() { $('server-list-dialog').classList.remove('open'); window.setTimeout(() => { $('server-list-dialog').hidden = true; }, 250); }
async function selectServer(server) {
  if (busy) return;
  if (server.host === $('host').value && server.port === Number($('port').value)) return;
  $('host').value = server.host; $('port').value = String(server.port); renderServerGrid(); renderServerList();
  if (page === 'ready' || (page === 'settings' && returnPage === 'ready')) { await logout('服务器已更改，请重新登录。'); returnPage = 'login'; }
  await savePreferences();
}
// dialog 内改动（添加/编辑/删除）统一走这里：更新端点并保存；若返回目标是启动页则改为回登录页（主进程会注销旧端点会话）。
async function applyServerFromDialog(server) {
  $('host').value = server.host; $('port').value = String(server.port);
  if (returnPage === 'ready') returnPage = 'login';
  renderServerGrid(); renderServerList();
  await savePreferences();
}
async function deleteServer(server) {
  if (busy) return;
  const index = servers.indexOf(server); if (index < 0) return;
  servers.splice(index, 1);
  const stillSelected = servers.some(item => item.host === $('host').value && item.port === Number($('port').value));
  if (stillSelected) { renderServerGrid(); renderServerList(); await savePreferences(); }
  else await applyServerFromDialog(servers[0]);
}
let serverDialogEditId = null;
function openServerDialog(edit = null) {
  serverDialogEditId = edit && edit.source !== 'builtin' ? edit.id : null;
  $('server-form').reset();
  $('server-dialog-title').textContent = serverDialogEditId ? '编辑服务器' : '添加服务器';
  const confirmLabel = $('server-form').querySelector('.dialog-confirm span');
  if (confirmLabel) confirmLabel.textContent = serverDialogEditId ? '保存' : '确认';
  if (serverDialogEditId) {
    const entry = servers.find(item => item.id === serverDialogEditId);
    if (entry) {
      // 编辑模式：端点只读展示（安全考虑不暴露可改的地址），仅名称可修改。
      $('custom-name').value = entry.label;
      $('custom-host').value = entry.host; $('custom-host').disabled = true;
      $('custom-port').value = String(entry.port); $('custom-port').disabled = true;
    }
  } else {
    $('custom-name').value = '';
    $('custom-host').disabled = false; $('custom-port').disabled = false;
  }
  updateNameCounter();
  $('server-dialog').hidden = false; $('server-dialog').classList.add('open');
  if (serverDialogEditId) $('custom-name').focus(); else $('custom-host').focus();
}
function closeServerDialog() { serverDialogEditId = null; $('server-dialog').classList.remove('open'); window.setTimeout(() => { $('server-dialog').hidden = true; }, 250); }
function updateNameCounter() { const counter = $('custom-name').nextElementSibling; if (counter && counter.classList.contains('char-counter')) counter.textContent = $('custom-name').value.length + '/5'; }
async function authenticate(event, action) {
  event.preventDefault(); if (busy) return;
  const prefix = action === 'register' ? 'register' : 'login';
  const input = {...values(), action, name: $(prefix + '-name').value.trim(), password: $(prefix + '-password').value,
    confirm: action === 'register' ? $('register-confirm').value : undefined};
  if (!/^[A-Za-z0-9_]{3,24}$/.test(input.name)) { markInvalid([prefix + '-name']); return status('账号须为 3–24 位字母、数字或下划线。', 'error'); }
  if ([...input.password].length < 8 || [...input.password].length > 64) { markInvalid([prefix + '-password']); return status('密码须为 8–64 个字符。', 'error'); }
  if (action === 'register' && input.password !== input.confirm) { markInvalid(['register-confirm']); return status('两次输入的密码不一致。', 'error'); }
  setBusy(true); status();
  try {
    const result = await window.launcher.authenticate(input);
    if (!result.ok) return status(result.message, 'error');
    $('login-name').value = result.name || input.name;
    if (action === 'register') { route('login'); status('注册成功，请使用新账号登录。', 'success'); $('login-password').focus(); }
    else route('ready');
    if (result.warning) status(result.warning, 'error');
  } catch { status('登录失败，请重试或者联系服务器团队。', 'error'); }
  finally { for (const button of document.querySelectorAll('.primary')) button.classList.remove('loading'); setBusy(false); }
}
function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('main input,main button,#close')) element.disabled = value;
  $('launch').disabled = gameRunning;
  const button = page === 'ready' ? $('launch') : page === 'login' ? $('login-form').querySelector('.primary') : page === 'register' ? $('register-form').querySelector('.primary') : null;
  if (button) button.classList.toggle('loading', value);
  if (!value) renderGameState();
}
async function logout(message = '') {
  if (busy) return;
  setBusy(true);
  try { const result = await window.launcher.logout(); if (!result.ok) return status(result.message, 'error'); route('login'); status(message); }
  catch { status('退出登录失败，请重试。', 'error'); }
  finally { setBusy(false); }
}
$('login-form').addEventListener('submit', event => authenticate(event, 'login'));
$('register-form').addEventListener('submit', event => authenticate(event, 'register'));
$('go-register').addEventListener('click', () => { $('register-name').value = $('login-name').value; route('register'); });
$('go-login').addEventListener('click', () => route('login'));
$('open-settings').addEventListener('click', () => openSettings());
$('ready-settings').addEventListener('click', () => openSettings());
$('settings-back').addEventListener('click', closeSettings);
$('logout').addEventListener('click', () => logout());
$('go-add-server').addEventListener('click', () => openSettings({serverList: true}));
$('custom-server').addEventListener('click', openServerListDialog);
$('add-server').addEventListener('click', () => openServerDialog());
$('close-server-list').addEventListener('click', closeServerListDialog);
$('custom-name').addEventListener('input', updateNameCounter);
$('cancel-server').addEventListener('click', closeServerDialog);
$('server-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const name = $('custom-name').value.trim();
  const host = $('custom-host').value.trim(), port = $('custom-port').value.trim();
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    markInvalid(['custom-host', 'custom-port']); return;
  }
  const label = name || host + ':' + port;
  if (serverDialogEditId) {
    // 编辑模式：IP/端口输入框已禁用，端点保持不变，仅更新名称（留空回退为地址）。
    const entry = servers.find(item => item.id === serverDialogEditId);
    if (!entry) return closeServerDialog();
    if (servers.some(item => item !== entry && item.label === label)) return status('该名称已存在。', 'error');
    const wasSelected = entry.host === $('host').value && entry.port === Number($('port').value);
    entry.label = label;
    closeServerDialog();
    if (wasSelected) await applyServerFromDialog(entry);
    else { renderServerGrid(); renderServerList(); await savePreferences(); }
    return;
  }
  if (servers.some(item => item.label === label)) return status('该名称已存在。', 'error');
  const existing = servers.find(item => item.host === host && item.port === Number(port));
  if (existing) { closeServerDialog(); return applyServerFromDialog(existing); }
  if (servers.filter(item => item.source === 'custom').length >= 10) return status('最多保存 10 个自定义服务器。', 'error');
  const server = {id: 'custom-' + host + '-' + port, label, host, port: Number(port), source: 'custom'};
  servers.push(server);
  closeServerDialog();
  await applyServerFromDialog(server);
});
$('select-client').addEventListener('click', async () => {
  if (busy) return;
  const result = await window.launcher.selectClientExecutable();
  if (!result.ok) return status(result.message, 'error');
  if (result.canceled) return;
  clientExecutable = result.clientExecutable; clientExists = true; setClientState(true, clientExecutable, clientExecutable);
  await savePreferences({clientExecutable});
});
for (const button of document.querySelectorAll('.eye')) button.addEventListener('click', () => {
  const field = $(button.dataset.password), showing = field.type === 'password';
  field.type = showing ? 'text' : 'password'; button.setAttribute('aria-label', showing ? '隐藏密码' : '显示密码'); button.setAttribute('aria-pressed', String(showing));
});
$('theme-toggle').addEventListener('click', async () => { if (busy) return; const next = currentTheme === 'dark' ? 'light' : 'dark'; applyTheme(next); await savePreferences(); await window.launcher.setBackground(next === 'dark' ? '#101a30' : '#f6f8fd'); });
$('settings-theme-toggle').addEventListener('click', () => $('theme-toggle').click());
$('launch').addEventListener('click', async () => {
  if (busy || gameRunning) return;
  if (!clientExists) return openSettings({focusClient: true});
  setBusy(true); status();
  try { const result = await window.launcher.launch(); if (result.authenticated === false) route('login'); if (!result.ok) status(result.message, 'error'); }
  catch { status('启动失败，请重试。', 'error'); }
  finally { for (const button of document.querySelectorAll('.primary')) button.classList.remove('loading'); setBusy(false); }
});
// 订阅主进程进程监听：游戏启动/结束均经此更新按钮与设置锁定（单状态源，无需等待启动响应）。
window.launcher.onGameState(running => { gameRunning = running; renderGameState(); });
$('minimize').addEventListener('click', () => window.launcher.minimize().catch(() => status('窗口最小化失败，请重试。', 'error')));
$('close').addEventListener('click', async () => { try { const result = await window.launcher.close(); if (!result.ok) status(result.message, 'error'); } catch { status('关闭窗口失败，请重试。', 'error'); } });
setBusy(true);
window.launcher.settings().then(result => {
  if (!result.ok) return status(result.message, 'error');
  multiClient = Boolean(result.multiClient);
  gameRunning = Boolean(result.gameRunning);
  $('host').value = result.settings.host; $('port').value = String(result.settings.port); $('login-name').value = result.settings.name;
  applyTheme(result.settings.theme || currentTheme);
  const builtinServers = result.builtinServers || servers.filter(item => item.source === 'builtin');
  servers = (result.settings.customServers || servers).map((item, index) => ({...item, id: item.id || 'server-' + index,
    source: builtinServers.some(server => server.host === item.host && server.port === item.port) ? 'builtin' : 'custom'}));
  if (!servers.some(item => item.host === result.settings.host && item.port === Number(result.settings.port))) {
    servers.push({id: 'selected-custom', label: result.settings.host + ':' + result.settings.port,
      host: result.settings.host, port: Number(result.settings.port), source: 'custom'});
  }
  clientExecutable = result.settings.clientExecutable || 'BubbleFighterU.exe';
  detected = Boolean(result.client); setClientState(detected, clientExecutable, result.client || clientExecutable); renderServerGrid();
  if (result.session) { $('login-name').value = result.session.name; route('ready'); } else route('login');
  if (result.warning) status(result.warning, 'error');
}).catch(() => status('启动器初始化失败，请关闭后重新打开。', 'error')).finally(() => setBusy(false));
