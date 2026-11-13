'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {LauncherError} = require('./errors');
const {gameEndpoint} = require('./client');

// Game tickets expire and are single-use. Keep the authenticated account
// separately and request a fresh ticket on every launch. Persist only DPAPI
// ciphertext, scoped to this installation and normal/multi-client window.
class LoginSession {
  constructor(file, safeStorage, authenticate) {
    this.file = file; this.storage = safeStorage; this.authenticate = authenticate;
    this.account = null;
  }
  publicState() { return this.account ? {name: this.account.name, host: this.account.host, port: this.account.port} : null; }
  async restore(target) {
    try {
      if (!this.storage.isEncryptionAvailable()) return null;
      const saved = JSON.parse(this.storage.decryptString(await fs.readFile(this.file)));
      if (saved.version !== 1 || saved.host !== target.host || saved.port !== target.port ||
          !/^[A-Za-z0-9_]{3,24}$/.test(saved.name) || typeof saved.password !== 'string' ||
          [...saved.password].length < 8 || [...saved.password].length > 64) {
        await this.logout(); return null;
      }
      this.account = {host: saved.host, port: saved.port, name: saved.name, password: saved.password};
      return this.publicState();
    } catch (error) {
      this.account = null;
      if (error.code === 'ENOENT') return null;
      throw new LauncherError('无法读取已保存的登录信息，请重新登录。');
    }
  }
  async remember(input, result) {
    this.account = {host: input.host, port: input.port, name: result.name, password: input.password};
    // Remove an older account before attempting to replace it; failed writes
    // must not restore the previous user's identity next time.
    try {
      await fs.rm(this.file, {force: true});
      if (!this.storage.isEncryptionAvailable()) throw new Error();
      const encrypted = this.storage.encryptString(JSON.stringify({version: 1, ...this.account}));
      await fs.mkdir(path.dirname(this.file), {recursive: true});
      const staging = this.file + '.' + process.pid + '.tmp';
      try { await fs.writeFile(staging, encrypted); await fs.rename(staging, this.file); }
      finally { await fs.rm(staging, {force: true}).catch(() => {}); }
      return '';
    } catch {
      return '已登录，但无法加密保存登录信息；关闭启动器后需要重新登录。';
    }
  }
  async ticket() {
    if (!this.account) throw new LauncherError('请先登录账号。', 'AUTH_REQUIRED');
    try {
      const result = await this.authenticate({...this.account, action: 'login'});
      return {...result, ...gameEndpoint(result, this.account)};
    } catch (error) {
      if (error.code === 'AUTH_INVALID') await this.logout();
      throw error;
    }
  }
  async logout() {
    this.account = null;
    await fs.rm(this.file, {force: true});
  }
}
module.exports = {LoginSession};
