'use strict';
// 游戏进程运行状态监听（主进程唯一实例）：定期探测 + 状态变更回调。
// 启动按钮状态、设置锁定、启动防重复等功能都从这里取状态，避免多处各自判断。
// 探测失败时保持上一次已知状态，不做乐观翻转。
function createGameMonitor({probe, interval = 2000, onChange = () => {}}) {
  let running = false, timer = null, checking = false;
  async function check() {
    if (checking) return;
    checking = true;
    try {
      const next = Boolean(await probe());
      if (next !== running) { running = next; onChange(running); }
    } catch {} finally { checking = false; }
  }
  return {
    isRunning: () => running,
    // 启动成功后立即标记为运行中，无需等待下一次轮询；若进程实际已退出，后续轮询会自行纠正。
    markRunning() { if (!running) { running = true; onChange(true); } },
    check,
    start() { if (!timer) { timer = setInterval(check, interval); check(); } },
    stop() { if (timer) { clearInterval(timer); timer = null; } }
  };
}
module.exports = {createGameMonitor};
