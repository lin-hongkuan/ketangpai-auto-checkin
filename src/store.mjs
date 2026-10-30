/**
 * 运行时状态 + 持久化（去重记录、统计、事件限流）
 *
 * 写盘做了节流：一轮巡检里 markDone / eventOnce 可能连着调好几次，
 * 每次都同步写整个 state.json 是纯浪费，合并成 1.5 秒一次。
 */
import fs from 'node:fs';
import { STATE_FILE } from './config.mjs';

const TZ = process.env.TZ || 'Asia/Shanghai';

export const S = {
  startedAt: Date.now(),
  config: null,
  configMtime: 0,
  configFp: '',
  courses: [],
  coursesAt: 0,
  coursesLoadedAt: '',
  pending: [],
  recent: [],
  lastPollAt: 0,
  lastPollOk: false,
  lastPollMs: 0,
  pollRounds: 0,
  tokenExpired: false,
  lastError: '',
  events: [],
  seq: 0,
  stats: emptyStats(),
  dailyReportedDate: '',
  handlers: { rerunPoll: null },
};

export const P = { done: {}, notified: {} };

export function emptyStats() {
  return { date: '', rounds: 0, detected: 0, signed: 0, signedOut: 0, checkoutMissed: 0, failed: 0, notified: 0 };
}

export function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** 取今日统计，跨天自动清零 */
export function bumpStats() {
  const d = todayStr();
  if (S.stats.date !== d) S.stats = { ...emptyStats(), date: d };
  return S.stats;
}

export function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function writeStateNow() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      done: P.done,
      notified: P.notified,
      stats: S.stats,
      dailyReportedDate: S.dailyReportedDate,
      savedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  } catch { }
}

let saveTimer = null;
let saveDirty = false;

export function saveState() {
  saveDirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!saveDirty) return;
    saveDirty = false;
    writeStateNow();
  }, 1500);
  if (saveTimer.unref) saveTimer.unref();
}

/** 退出前强制落盘，别把最近的去重记录丢了 */
export function flushState() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (saveDirty) { saveDirty = false; writeStateNow(); }
}

/** 从磁盘恢复（进程启动时调用一次） */
export function restoreState() {
  const st = loadState();
  if (st.done) P.done = st.done;
  if (st.notified) P.notified = st.notified;
  if (st.stats) S.stats = { ...emptyStats(), ...st.stats };
  if (st.dailyReportedDate) S.dailyReportedDate = st.dailyReportedDate;
  return st;
}

/** 清理 30 天前的去重记录 */
export function pruneDone(maxAgeMs = 30 * 86400000) {
  const now = Date.now();
  for (const k of Object.keys(P.done)) if (now - P.done[k] > maxAgeMs) delete P.done[k];
}
