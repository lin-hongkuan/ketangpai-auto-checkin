/**
 * 配置：环境变量 + data/config.json（热加载）
 *
 * 关键规则：config.json 里的空值不能覆盖环境变量。
 * 典型场景 —— 先无 token 启动生成了 token:"" 的 config.json，
 * 之后在 .env 里补上 KTP_TOKEN，空字符串不能把 env 顶掉。
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV = process.env;

export const API_BASE = 'https://openapiv5.ketangpai.com';
export const VERSION = '1.4.0';

export const PORT = Number(ENV.PORT || 8080);
export const DATA_DIR = ENV.DATA_DIR || '/data';
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'service.log');

export const POLL_INTERVAL = Math.max(3, Number(ENV.POLL_INTERVAL || 10));
// 课程列表刷新间隔。这个接口只返回课程 id/名称，一次请求，成本极低 ——
// 没必要为了省它而让新课程等一分钟才纳入巡检（老师可能刚发完考勤）。
export const COURSE_REFRESH_SEC = Math.max(10, Number(ENV.COURSE_REFRESH_SEC || 15));
export const DASHBOARD_TOKEN = ENV.DASHBOARD_TOKEN || '';
export const DAILY_REPORT_HOUR = Number(ENV.DAILY_REPORT_HOUR ?? 21);
// 并发扫描的课程数：课程多时调高能缩短单轮耗时，但别太高（对服务端不友好，也容易触发风控）
export const POOL_SIZE = Math.max(1, Math.min(8, Number(ENV.POOL_SIZE || 4)));
// 最近考勤记录缓存时长：冷课程没必要每轮都查一遍历史
export const RECENT_TTL = Math.max(60000, POLL_INTERVAL * 3000);

export function defaultConfig() {
  return {
    token: ENV.KTP_TOKEN || '',
    courseIds: [],
    excludeCourseIds: [],
    digitCode: '',
    latitude: '',
    longitude: '',
    coordsAreWgs84: true,
    // GPS 考勤的坐标策略：优先用配置坐标，没配则用空坐标，最后才用零坐标兜底。
    // 设为 true = 严格模式：GPS 考勤没有坐标时直接放弃，绝不制造假成功。
    requireGpsCoords: false,
    courseRefreshSec: COURSE_REFRESH_SEC,
    dailyReportHour: DAILY_REPORT_HOUR,
  };
}

export function mergeConfig(fileCfg) {
  const merged = { ...defaultConfig(), ...(fileCfg || {}) };
  if (!String(merged.token || '').trim()) merged.token = ENV.KTP_TOKEN || '';
  if (!Array.isArray(merged.courseIds)) merged.courseIds = [];
  if (!Array.isArray(merged.excludeCourseIds)) merged.excludeCourseIds = [];
  if (merged.requireGpsCoords === undefined) merged.requireGpsCoords = true;
  return merged;
}

export function ensureDirs() {
  for (const d of [DATA_DIR, LOG_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { }
  }
}

export function loadFileConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}

export function writeConfigFile(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8'); } catch { }
}

/** 解析坐标配置，返回 {lat, lng} 或 null */
export function parseCoords(cfg) {
  const lat = parseFloat(cfg.latitude);
  const lng = parseFloat(cfg.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
