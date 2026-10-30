/**
 * 日志：控制台 + 异步写盘
 *
 * 用 createWriteStream 而不是 appendFileSync —— 高频巡检时同步写会阻塞事件循环。
 */
import fs from 'node:fs';
import path from 'node:path';

export const TZ = process.env.TZ || 'Asia/Shanghai';

export function nowCN() {
  return new Date().toLocaleString('zh-CN', { hour12: false, timeZone: TZ });
}

/** 秒级时间戳 → 本地 HH:mm:ss */
export function fmtTs(ts) {
  const n = Number(ts);
  if (!n) return '-';
  try {
    return new Date(n * 1000).toLocaleTimeString('zh-CN', { hour12: false, timeZone: TZ });
  } catch {
    return '-';
  }
}

export function createLogger(logFile) {
  let stream = null;

  function getStream() {
    if (stream) return stream;
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      stream = fs.createWriteStream(logFile, { flags: 'a' });
      stream.on('error', () => { stream = null; });
    } catch {
      stream = null;
    }
    return stream;
  }

  function log(level, msg) {
    const line = `[${nowCN()}] [${level}] ${msg}`;
    console.log(line);
    try {
      const s = getStream();
      if (s) s.write(line + '\n');
    } catch { /* 日志失败不能影响主流程 */ }
  }

  return {
    info: (m) => log('INFO', m),
    warn: (m) => log('WARN', m),
    error: (m) => log('ERROR', m),
    success: (m) => log('SUCCESS', m),
    log,
    close: () => { try { if (stream) stream.end(); } catch { } },
  };
}
