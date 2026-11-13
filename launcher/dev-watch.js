'use strict';
const fs = require('node:fs');
const path = require('node:path');
// 渲染层文件变更只需刷新窗口；主进程与 preload 变更无法原地替换，由 dev.js 以 RESTART_EXIT_CODE 重启应用。
const RELOAD_FILES = new Set(['renderer.js', 'index.html', 'custom.css', 'app.css']);
const RESTART_FILES = new Set(['main.js', 'preload.js', 'client.js', 'errors.js', 'session.js']);
const RESTART_EXIT_CODE = 75;
const DEBOUNCE_MS = 250;
function classify(name) {
  const base = path.basename(String(name || ''));
  if (RELOAD_FILES.has(base)) return 'reload';
  if (RESTART_FILES.has(base)) return 'restart';
  return null;
}
function enableDevWatch({dir, reload, restart, debounceMs = DEBOUNCE_MS}) {
  const watchers = [];
  let timer = null, restartPending = false;
  const flush = () => {
    timer = null;
    if (restartPending) { restartPending = false; restart(); return; }
    reload();
  };
  const onChange = name => {
    const kind = classify(name);
    if (!kind) return;
    console.log(`[dev-watch] ${kind === 'restart' ? '重启应用' : '刷新窗口'} ← ${name}`);
    if (kind === 'restart') restartPending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };
  for (const target of [dir, path.join(dir, 'dist-css')]) {
    try { watchers.push(fs.watch(target, (_event, name) => onChange(name))); } catch {}
  }
  console.log('[dev-watch] 热重载已启用：渲染层变更刷新窗口，主进程变更重启应用。');
  return {close() { for (const watcher of watchers) watcher.close(); if (timer) clearTimeout(timer); }};
}
module.exports = {enableDevWatch, classify, RESTART_EXIT_CODE};
