/**
 * 事件流
 *
 * 服务本身不内置任何推送渠道：所有状态变化写进内存环形缓冲，
 * 由外部通过 GET /events?since=N 增量拉取。
 */
import { nowCN } from './logger.mjs';
import { S, P, saveState } from './store.mjs';

const MAX_EVENTS = 300;

// 日志由入口注入，避免 events ↔ logger 循环依赖
let sink = () => { };
export function setEventSink(fn) { sink = fn; }

export function pushEvent(level, type, message) {
  const ev = { seq: ++S.seq, ts: Date.now(), time: nowCN(), level, type, message };
  S.events.push(ev);
  if (S.events.length > MAX_EVENTS) S.events.shift();
  try { sink(level, message); } catch { }
  return ev;
}

/**
 * 事件去重：同一 key 在 minutes 内只记录一次。
 * 巡检每 10 秒一轮，不去重会把用户刷屏。
 */
export function eventOnce(key, minutes, level, type, message) {
  const now = Date.now();
  const last = P.notified[key] || 0;
  if (now - last < minutes * 60000) return false;
  P.notified[key] = now;
  for (const k of Object.keys(P.notified)) {
    if (now - P.notified[k] > 30 * 86400000) delete P.notified[k];
  }
  saveState();
  pushEvent(level, type, message);
  return true;
}

export function eventsSince(since) {
  return S.events.filter((e) => e.seq > since).slice(-100);
}
