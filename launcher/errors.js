'use strict';

class LauncherError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// Only authored messages may reach the UI. OS/IPC/server exceptions can contain
// English diagnostics, paths, command lines or credentials.
function chineseError(error, fallback = '操作失败，请稍后重试。') {
  if (error instanceof LauncherError) return error.message.slice(0, 300);
  const messages = {
    ENOENT: '找不到所需文件，请检查客户端和启动器是否完整。',
    EACCES: '访问被拒绝，请检查文件权限及程序的兼容性设置。',
    EPERM: '系统不允许此操作，请检查文件权限或文件是否被占用。',
    EBUSY: '文件正在被占用，请关闭相关程序后重试。',
    ENOSPC: '磁盘空间不足，请清理空间后重试。',
    ENOEXEC: '程序格式不正确或文件已损坏，请重新解压客户端。',
    UNKNOWN: 'Windows 未能创建游戏进程，请检查客户端完整性和兼容性设置。',
    ECONNREFUSED: '服务器未开放连接，请检查地址和端口。',
    ECONNRESET: '服务器连接中断，请稍后重试。',
    ETIMEDOUT: '连接超时，请检查网络后重试。'
  };
  return messages[error?.code] || fallback;
}

function serverError(message) {
  // Both supported servers use Chinese, but older builds may return English.
  const text = typeof message === 'string' ? message : '';
  const invalidCredentials = /账号或密码错误|invalid credentials|incorrect password|invalid password/i.test(text);
  if (invalidCredentials) return new LauncherError('账号或密码错误，请重新登录。', 'AUTH_INVALID');
  if (/already exists/i.test(text)) return new LauncherError('该账号已存在，请更换账号或直接登录。');
  if (/too many|rate limit/i.test(text)) return new LauncherError('操作过于频繁，请稍后重试。');
  if (/^[\u3000-\u303f\u3400-\u9fff\uff00-\uffef\d\s，。！：、（）–—…\-]+$/.test(text)) return new LauncherError(text.slice(0, 180));
  return new LauncherError('服务器未能完成账号操作，请稍后重试。');
}

module.exports = {LauncherError, chineseError, serverError};
