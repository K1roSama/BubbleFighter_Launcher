'use strict';
// 开发入口（npm run dev）：Tailwind 持续重建 + Electron 自动刷新/重启。该文件与 dev-watch.js 不进入打包产物。
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {RESTART_EXIT_CODE} = require('./dev-watch');
const dir = __dirname;
const tailwindCli = path.join(dir, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
const electronBin = require('electron');
const tailwindArgs = ['-i', './tailwind.css', '-o', './dist-css/app.css'];
if (!fs.existsSync(path.join(dir, 'dist-css', 'app.css'))) execFileSync(process.execPath, [tailwindCli, ...tailwindArgs], {cwd: dir, stdio: 'inherit'});
const tailwind = spawn(process.execPath, [tailwindCli, ...tailwindArgs, '--watch'], {cwd: dir, stdio: 'inherit'});
let electron = null, stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  if (electron && electron.exitCode === null) electron.kill();
  tailwind.kill();
  process.exit(code);
}
function launch() {
  const env = {...process.env, BF_DEV_WATCH: '1'};
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(electronBin, ['.'], {cwd: dir, stdio: 'inherit', env});
  electron.on('exit', code => {
    if (stopping) return;
    if (code === RESTART_EXIT_CODE) { console.log('[dev] 主进程文件已变更，正在重启应用…'); launch(); return; }
    console.log('[dev] 启动器已退出，开发会话结束。');
    shutdown(code === null ? 0 : code);
  });
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
console.log('[dev] Tailwind 监听已启动；修改 launcher 内文件即可热更新。');
launch();
