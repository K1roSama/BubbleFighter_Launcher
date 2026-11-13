'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const {LauncherError, chineseError, serverError} = require('./errors');
// The native renderer uses pixel coordinates. Set this before process/window
// creation; the login adapter loads only after the D3D device already exists.
const GAME_COMPAT_LAYER = 'RunAsInvoker HighDpiAware';
const A = Buffer.from('5f3e3272c11846875d2e294e6879866cb58d56f138c148425f0ccd80e8e2fef0425ff7597e5fa58d3d76e711416267597f', 'hex');
const B = Buffer.from('230024002500730065007200740033003400250077006500', 'hex');
const HELLO = Buffer.alloc(258); HELLO[0] = 2;

function endpoint(host, port) {
  host = typeof host === 'string' ? host.trim() : '';
  const p = String(port);
  if (net.isIP(host) !== 4 || host === '0.0.0.0' || host === '255.255.255.255' || Number(host.split('.')[0]) >= 224 ||
      !/^\d{1,5}$/.test(p) || Number(p) < 1 || Number(p) > 65535) {
    throw new LauncherError('请输入有效的 IPv4 地址和端口（1–65535）。');
  }
  return {host, port: Number(p)};
}
// The saved endpoint identifies the login service. A validated server response
// may advertise a different game endpoint; never overwrite the saved login address.
function gameEndpoint(result, fallback) {
  if (result.game === undefined) return endpoint(fallback.host, fallback.port);
  const value = result.game;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isInteger(value.region_id) || value.region_id < 1 || value.region_id > 2147483647 ||
      !Number.isInteger(value.port) || !Number.isInteger(value.clan_port)) {
    throw new LauncherError('登录服务返回了无效的大区入口。');
  }
  const game = endpoint(value.host, value.port);
  const clan = endpoint(value.clan_host, value.clan_port);
  if (game.host === clan.host && game.port === clan.port) throw new LauncherError('游戏与家族端口不能相同。');
  return {...game, clanHost: clan.host, clanPort: clan.port, regionId: value.region_id};
}
function transform(bytes, state, decrypt = false) {
  return Buffer.from(bytes.map(value => {
    const result = (value + (decrypt ? -1 : 1) * (A[state.a] + B[state.b])) & 255;
    state.a = (state.a + 1) % 49; state.b = (state.b + 1) % 24;
    return result;
  }));
}
function frame(op, body) {
  const header = Buffer.alloc(5);
  header.writeUInt16LE(body.length); header.writeUInt16LE(op, 2);
  header[4] = body.reduce((sum, byte) => sum ^ byte, 0);
  return Buffer.concat([header, body]);
}
function credentials(action, name, password) {
  if (!['login', 'register'].includes(action)) throw new LauncherError('无效操作。');
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{3,24}$/.test(name)) throw new LauncherError('账号须为 3–24 位字母、数字或下划线。');
  if (typeof password !== 'string' || [...password].length < 8 || [...password].length > 64) throw new LauncherError('密码须为 8–64 个字符。');
}
async function authenticate(input) {
  const {host, port} = endpoint(input.host, input.port);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const {action, password} = input;
  credentials(action, name, password);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host, port});
    let buffer = Buffer.alloc(0), greeted = false, finished = false;
    const state = {a: 5, b: 3};
    const timer = setTimeout(() => done(new LauncherError('连接超时，请检查服务器地址或稍后重试。')), 8000);
    function done(error, value) {
      if (finished) return; finished = true;
      clearTimeout(timer); socket.destroy();
      error ? reject(error) : resolve(value);
    }
    socket.on('error', error => done(new LauncherError(error.code === 'ECONNREFUSED'
      ? '服务器未开放连接，请检查地址和端口。' : '无法连接服务器，请检查网络后重试。')));
    socket.on('end', () => done(new LauncherError('服务器断开连接，请联系服务器团队。')));
    socket.on('data', bytes => {
      try {
        buffer = Buffer.concat([buffer, greeted ? transform(bytes, state, true) : bytes]);
        if (buffer.length > 65540) throw new LauncherError('服务器响应过大。');
        if (!greeted) {
          if (buffer.length < HELLO.length) return;
          if (!buffer.subarray(0, 258).equals(HELLO)) throw new LauncherError('该端口不是兼容的游戏服务器。');
          buffer = transform(buffer.subarray(258), state, true); greeted = true;
          const body = Buffer.from(JSON.stringify({action, name, password}), 'utf8');
          socket.write(transform(frame(65020, body), {a: 0, b: 1}));
        }
        if (buffer.length < 5) return;
        const size = buffer.readUInt16LE(0);
        if (buffer.length < size + 5) return;
        const body = buffer.subarray(5, size + 5);
        if (buffer.readUInt16LE(2) !== 65021 || body.reduce((a, b) => a ^ b, 0) !== buffer[4]) throw new LauncherError('服务器响应不兼容。');
        const result = JSON.parse(body.toString('utf8'));
        if (result?.ok !== true) throw serverError(result?.message);
        if (action === 'login' && (!/^launcher-v2:[a-f0-9]{32}$/.test(result.token) ||
            !/^[A-Za-z0-9_]{3,24}$/.test(result.name) || !Number.isFinite(result.expires))) throw new LauncherError('服务器返回了无效的登录凭证。');
        if (action === 'login') gameEndpoint(result, {host, port});
        done(null, result);
      } catch (error) { done(error instanceof SyntaxError ? new LauncherError('服务器返回了无效数据。') : error); }
    });
  });
}
async function writeConnection(root, host, port, clanTarget) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (!clanTarget && port === 65535)) {
    throw new LauncherError('游戏网关端口须为 1–65534，以便使用相邻的战队端口。');
  }
  const game = endpoint(host, port);
  const clan = clanTarget ? endpoint(clanTarget.host, clanTarget.port) : endpoint(host, port + 1);
  const file = path.join(root, 'login.ini');
  let original;
  try { original = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; original = ''; }
  const replacements = {serverAddr: game.host, serverPort: String(game.port), clanServerAddr: clan.host, clanServerPort: String(clan.port)};
  let text = original;
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp('^' + key + '=[^\\r\\n]*', 'm');
    text = pattern.test(text) ? text.replace(pattern, key + '=' + value) : key + '=' + value + '\r\n' + text;
  }
  if (text === original) return;
  if (original) await fs.writeFile(file + '.launcher-backup', original, {flag: 'wx'}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const staging = file + '.' + process.pid + '.tmp';
  await fs.writeFile(staging, text, 'utf8');
  await fs.rename(staging, file);
}
async function runningGame() {
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const outputs = await Promise.all(['BubbleFighterU.exe', 'BubbleFighter.exe'].map(name =>
    run(path.join(system, 'tasklist.exe'), ['/FI', 'IMAGENAME eq ' + name, '/FO', 'CSV', '/NH'],
      {windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024, encoding: 'utf8'})));
  return outputs.some(({stdout}) => /^"BubbleFighter(?:U)?\.exe","\d+"/im.test(stdout));
}
async function launchGame(root, identity, options = {}) {
  if (!identity || identity.expires <= Date.now() / 1000) throw new LauncherError('登录已过期，请重新登录。');
  const {host, port} = endpoint(identity.host, identity.port);
  const executable = await findClientPath(root, options.executable);
  if (!executable) throw new LauncherError('当前目录未找到游戏客户端。');
  const gameRoot = path.dirname(executable);
  if (!/^[A-Za-z0-9_]{3,24}$/.test(identity.name) || !/^launcher-v2:[a-f0-9]{32}$/.test(identity.token)) throw new LauncherError('登录凭证无效，请重新登录。');
  const multi = options.multi === true;
  if (!multi && await runningGame()) throw new LauncherError('游戏已在运行，请先关闭游戏。');
  await writeConnection(gameRoot, host, port, identity.clanPort !== undefined ? {host: identity.clanHost, port: identity.clanPort} : undefined);
  const args = ['--ip=' + host, '--port=' + port, '--areaid=1_1', '--groupid=1'];
  try {
    if (multi) {
      const launcher = path.join(root, 'local_server', 'native', 'build', 'multi_client.exe');
      try { if (!(await fs.stat(launcher)).isFile()) throw new LauncherError(); }
      catch { throw new LauncherError('缺少已构建的多开器 local_server\\native\\build\\multi_client.exe。'); }
      const executableRoot = path.dirname(executable);
      const {stdout} = await run(launcher, [executableRoot, host, String(port), path.basename(executable)], {
        cwd: gameRoot, windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024, encoding: 'utf8',
        env: {...process.env, BF_LOGIN_TICKET: identity.token, BF_LOCAL_NAME: identity.name, __COMPAT_LAYER: GAME_COMPAT_LAYER}
      });
      const match = /Local multi-client started: PID (\d+)/.exec(stdout);
      if (!match) throw new LauncherError('多开器未返回新客户端进程号。');
      return {pid: Number(match[1])};
    }
    try { return await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {cwd: gameRoot, detached: true, stdio: 'ignore',
        env: {...process.env, BF_LOGIN_TICKET: identity.token, BF_LOCAL_NAME: identity.name, __COMPAT_LAYER: GAME_COMPAT_LAYER}});
      let timer;
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new LauncherError('游戏进程已退出（' + code + '），请检查客户端文件。')); });
      child.once('spawn', () => { timer = setTimeout(() => { child.unref(); resolve({pid: child.pid}); }, 1200); });
    }); } catch (error) {
      // These failures occur before a child exists. Never retry an early exit:
      // it could already have consumed the single-use login ticket.
      if (!['UNKNOWN', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      return await launchWithWindows(gameRoot, path.basename(executable), identity);
    }
  } catch (error) {
    throw new LauncherError('游戏启动失败：' + chineseError(error, '无法创建游戏进程，请检查客户端文件。'));
  }
}
async function launchWithWindows(root, executable, identity) {
  const helper = path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked'), 'native', 'GameProcess.exe');
  const {stdout} = await run(helper, [root, executable, identity.host, String(identity.port)], {
    cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 4096, encoding: 'utf8',
    env: {...process.env, BF_LOGIN_TICKET: identity.token, BF_LOCAL_NAME: identity.name, __COMPAT_LAYER: GAME_COMPAT_LAYER}
  });
  let result;
  try { result = JSON.parse(stdout); }
  catch { throw new LauncherError('启动辅助程序返回异常，请重新安装启动器。'); }
  if (Number.isInteger(result.pid) && result.pid > 0) return {pid: result.pid};
  if (Number.isInteger(result.exitCode)) throw new LauncherError('游戏进程已退出（' + result.exitCode + '），请检查客户端文件。');
  const messages = {
    2: '找不到游戏程序，请重新解压客户端。', 3: '找不到游戏目录，请检查安装位置。',
    5: '系统拒绝访问游戏程序，请检查文件权限或程序的兼容性设置。',
    32: '游戏文件被其他程序占用，请关闭相关程序后重试。',
    87: '游戏启动参数无效，请检查服务器地址和端口。',
    193: '游戏程序格式不正确或文件已损坏，请重新解压客户端。',
    216: '游戏程序与当前 Windows 系统不兼容。',
    225: 'Windows 安全软件阻止了游戏程序，请检查安全中心的处理记录。',
    577: 'Windows 无法验证程序签名，请检查客户端来源和文件完整性。',
    740: 'Windows 要求管理员权限，请检查游戏程序的兼容性设置。',
    1223: '启动操作已取消，请重试。',
    1260: '系统策略阻止了游戏启动，请联系此电脑的管理员。',
    14001: '游戏运行库配置不完整，请安装客户端所需的运行库。'
  };
  throw new LauncherError(messages[result.error] || 'Windows 无法启动游戏（系统错误码：' + (Number.isInteger(result.error) ? result.error : 0) + '）。');
}
async function findClient(root) {
  for (const name of ['BubbleFighterU.exe', 'BubbleFighter.exe']) {
    try { if ((await fs.stat(path.join(root, name))).isFile()) return name; } catch {}
  }
  return null;
}
async function validateClientExecutable(root, value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 520 || value.includes('\0')) return null;
  const resolved = path.resolve(root, value);
  if (path.extname(resolved).toLowerCase() !== '.exe') return null;
  try { if ((await fs.stat(resolved)).isFile()) return resolved; } catch {}
  return null;
}
async function findClientPath(root, configured) {
  if (configured !== undefined && configured !== null && configured !== '') return validateClientExecutable(root, configured);
  const found = await findClient(root);
  return found ? path.join(root, found) : null;
}
function cleanServers(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) throw new LauncherError('服务器列表无效。');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.label !== 'string' || item.label.length < 1 || item.label.length > 32) throw new LauncherError('服务器列表无效。');
    const target = endpoint(item.host, item.port);
    return {label: item.label, host: target.host, port: target.port};
  });
}
async function saveSettings(file, values) {
  const {host, port} = endpoint(values.host, values.port);
  const clean = {host, port, name: typeof values.name === 'string' ? values.name.trim().slice(0, 24) : ''};
  if (values.theme === 'light' || values.theme === 'dark') clean.theme = values.theme;
  if (values.customServers !== undefined) clean.customServers = cleanServers(values.customServers);
  if (typeof values.clientExecutable === 'string' && values.clientExecutable.length > 0) clean.clientExecutable = values.clientExecutable.slice(0, 520);
  await fs.mkdir(path.dirname(file), {recursive: true});
  const staging = file + '.' + process.pid + '.tmp';
  await fs.writeFile(staging, JSON.stringify(clean, null, 2));
  await fs.rename(staging, file);
  return clean;
}
module.exports = {endpoint, gameEndpoint, transform, frame, authenticate, launchGame, saveSettings, findClient, findClientPath, validateClientExecutable, cleanServers, writeConnection, runningGame, HELLO};
