/**
 * 课程扫描
 *
 * 每轮巡检对每门课做两件事：
 *   1. 问服务端「这门课有什么待签到」—— 每轮都问
 *   2. 取「最近 10 条考勤记录」—— 只对热课程每轮取，其余走缓存
 *
 * 请求量控制：冷课程（2 小时内没考勤）每 60 秒才查一次历史，
 * 11 门课的账号从 22 请求/轮降到约 12 请求/轮。
 */
import { COURSE_REFRESH_SEC, RECENT_TTL } from './config.mjs';
import { S } from './store.mjs';
import { fetchCourses, fetchPendingList, fetchRecentAttence } from './api.mjs';
import { pickCheckouts } from './attence.mjs';
import { pushEvent, eventOnce } from './events.mjs';

// 最近记录缓存：courseId -> { at, rows }
const recentCache = new Map();

/** 该课程最近 2 小时内有过考勤活动（含刚签入、待签出的情况） */
export function hasRecentActivity(rows) {
  const last = rows && rows[0];
  if (!last) return false;
  const ct = Number(last.createtime || 0);
  return !!ct && Date.now() / 1000 - ct < 7200;
}

export async function fetchRecentCached(courseId, force = false) {
  const hit = recentCache.get(courseId);
  if (!force && hit && Date.now() - hit.at < RECENT_TTL) return hit.rows;
  const rows = await fetchRecentAttence(courseId, 10);
  recentCache.set(courseId, { at: Date.now(), rows });
  return rows;
}

/** 让某门课的缓存立即失效（签完立刻要看到新状态） */
export function invalidateRecent(courseId) {
  recentCache.delete(courseId);
}

/**
 * 课程列表（带缓存 + 增减侦测）
 * 新加入的课程最迟 COURSE_REFRESH_SEC 后纳入巡检。
 */
export async function getCourses(force = false) {
  const cfg = S.config;
  const ttl = Math.max(15, Number(cfg.courseRefreshSec || COURSE_REFRESH_SEC)) * 1000;
  if (!force && S.courses.length && Date.now() - S.coursesAt < ttl) return S.courses;

  const all = await fetchCourses();
  const allowList = Array.isArray(cfg.courseIds) && cfg.courseIds.length ? new Set(cfg.courseIds) : null;
  const exclude = new Set(cfg.excludeCourseIds || []);
  const kept = all.filter((c) => (!allowList || allowList.has(c.id)) && !exclude.has(c.id));
  const next = kept.map((c) => ({ id: c.id, name: c.coursename, semester: c.semester, term: c.term, classname: c.classname }));

  // 课程增减侦测（新加入的课程会在这里被纳入，并产生事件）
  const prevIds = new Set(S.courses.map((c) => c.id));
  const nextIds = new Set(next.map((c) => c.id));
  if (S.courses.length) {
    for (const c of next) if (!prevIds.has(c.id)) pushEvent('info', 'course_added', `新课程已纳入巡检：${c.name}`);
    for (const c of S.courses) if (!nextIds.has(c.id)) pushEvent('info', 'course_removed', `课程已退出巡检：${c.name}`);
  }

  // 被配置排除的课程：每天汇总提示一次，避免"加了课却不在巡检范围"无人察觉
  const skipped = [...new Set([
    ...all.filter((c) => allowList && !allowList.has(c.id)),
    ...all.filter((c) => exclude.has(c.id)),
  ].map((c) => c.coursename))];
  if (skipped.length) {
    eventOnce('skipped-courses', 1440, 'info', 'course_skipped',
      `有 ${skipped.length} 门课程未纳入巡检：${skipped.join('、')}（检查 config.json 的 courseIds / excludeCourseIds）`);
  }

  S.courses = next;
  S.coursesAt = Date.now();
  S.coursesLoadedAt = new Date().toISOString();
  return S.courses;
}

/**
 * 扫描一门课程：
 *   pending   待签到（服务端专门接口 + 最近记录里 state=100 的补充）
 *   checkouts 待签出（签入签出考勤：已签入但未签出）
 *   recent    最近记录（给看板用）
 */
export async function scanCourse(courseId) {
  const pending = await fetchPendingList(courseId);

  const cached = recentCache.get(courseId);
  const hot = pending.length > 0 || (cached ? hasRecentActivity(cached.rows) : false);
  const recent = await fetchRecentCached(courseId, hot);

  // 补充：服务端待签到接口有时不含刚发布的考勤，用最近记录里的 state=100 兜底
  const seen = new Set(pending.map((x) => String(x.id)));
  for (const r of recent) {
    if (String(r.state) === '100' && !seen.has(String(r.id))) {
      pending.push(r);
      seen.add(String(r.id));
    }
  }

  return { pending, checkouts: pickCheckouts(recent), recent };
}
