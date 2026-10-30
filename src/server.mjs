/**
 * HTTP 服务：健康检查 / 状态快照 / 事件流 / 看板 / 手动补签
 */
import http from 'node:http';
import { DASHBOARD_TOKEN, POLL_INTERVAL, COURSE_REFRESH_SEC, VERSION } from './config.mjs';
import { S, bumpStats } from './store.mjs';
import { ATTEND_TYPE, describeAttence } from './attence.mjs';
import { eventsSince } from './events.mjs';
import { pollRound, manualSign } from './poller.mjs';
import { getCourses } from './scanner.mjs';
import { dashboardHtml } from './dashboard.mjs';
import { logLine } from './log-bridge.mjs';

export function authOk(headers, reqUrl) {
  if (!DASHBOARD_TOKEN) return true;
  try {
    const u = new URL(reqUrl, 'http://x');
    const t = u.searchParams.get('token') || '';
    const h = (headers && headers['x-dashboard-token']) || '';
    return t === DASHBOARD_TOKEN || h === DASHBOARD_TOKEN;
  } catch { return false; }
}

export function healthPayload() {
  const intervalMs = POLL_INTERVAL * 1000;
  const fresh = S.lastPollAt && Date.now() - S.lastPollAt < Math.max(intervalMs * 3, 5 * 60000);
  const tokenMissing = !String(S.config.token || '').trim();
  const ok = !tokenMissing && !S.tokenExpired && S.lastPollOk && fresh;
  return {
    ok,
    tokenMissing,
    uptimeSec: Math.round((Date.now() - S.startedAt) / 1000),
    lastPollAt: S.lastPollAt ? new Date(S.lastPollAt).toISOString() : null,
    lastPollOk: S.lastPollOk,
    lastPollMs: S.lastPollMs,
    pollRounds: S.pollRounds,
    tokenExpired: S.tokenExpired,
    pending: S.pending.length,
    lastError: S.lastError || null,
    version: VERSION,
  };
}

export function statusPayload() {
  const st = bumpStats();
  return {
    now: new Date().toISOString(),
    version: VERSION,
    uptimeSec: Math.round((Date.now() - S.startedAt) / 1000),
    pollIntervalSec: POLL_INTERVAL,
    poll: {
      rounds: S.pollRounds,
      lastAt: S.lastPollAt ? new Date(S.lastPollAt).toISOString() : null,
      lastOk: S.lastPollOk,
      lastMs: S.lastPollMs,
      lastError: S.lastError || null,
    },
    token: { expired: S.tokenExpired, missing: !String(S.config.token || '').trim() },
    courses: S.courses.map((c) => ({ id: c.id, name: c.name, semester: c.semester, term: c.term })),
    coursesCount: S.courses.length,
    courseRefreshSec: Math.max(15, Number(S.config.courseRefreshSec || COURSE_REFRESH_SEC)),
    coursesUpdatedAt: S.coursesLoadedAt || null,
    config: {
      courseIds: S.config.courseIds || [],
      excludeCourseIds: S.config.excludeCourseIds || [],
      courseRefreshSec: Math.max(15, Number(S.config.courseRefreshSec || COURSE_REFRESH_SEC)),
      hasCoords: !!(String(S.config.latitude || '').trim() && String(S.config.longitude || '').trim()),
      requireGpsCoords: S.config.requireGpsCoords === true,
      tokenTail: String(S.config.token || '').slice(-6),
    },
    pending: S.pending.map(({ course, item }) => {
      const d = describeAttence(item);
      return {
        courseId: course.id, course: course.name, id: item.id,
        title: item.title || item.attenceTitle || '',
        type: String(item.type), typeName: ATTEND_TYPE[String(item.type)] || String(item.type),
        status: d.label, phase: d.phase,
      };
    }),
    // 最近考勤：跨课程按时间倒序，但每门课最多 3 条 —— 否则一门课连发 5 次考勤
    // 会把整个列表刷满，看不到别的课。
    recent: (() => {
      const out = [];
      const perCourse = new Map();
      for (const { course, item } of S.recent || []) {
        const n = perCourse.get(course.id) || 0;
        if (n >= 3) continue;
        perCourse.set(course.id, n + 1);
        const d = describeAttence(item);
        out.push({
          courseId: course.id, course: course.name, id: item.id,
          title: item.title || item.attenceTitle || '',
          type: String(item.type), typeName: ATTEND_TYPE[String(item.type)] || String(item.type),
          state: String(item.state), status: d.label, phase: d.phase, cls: d.cls,
          createtime: Number(item.createtime || 0),
          signTime: Number(item.signTime || 0),
          checkouttime: Number(item.checkouttime || 0),
          overtime: Number(item.overtime || 0),
          checkinAt: Number(item.resultCheckinTime || 0),
          checkoutAt: Number(item.resultCheckoutTime || 0),
        });
        if (out.length >= 20) break;
      }
      return out;
    })(),
    today: {
      date: st.date, rounds: st.rounds, detected: st.detected,
      signed: st.signed, signedOut: st.signedOut || 0,
      checkoutMissed: st.checkoutMissed || 0, failed: st.failed,
    },
    events: S.events.slice(-30).reverse(),
    lastSeq: S.seq,
  };
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > limit) { reject(new Error('请求体过大')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function handleHttp(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const send = (code, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  if (p === '/healthz') {
    const h = healthPayload();
    return send(h.ok ? 200 : 503, h);
  }

  if (!authOk(req.headers, req.url)) return send(401, { ok: false, message: 'unauthorized' });

  if (p === '/' || p === '/index.html') return send(200, dashboardHtml(DASHBOARD_TOKEN), 'text/html; charset=utf-8');
  if (p === '/status') return send(200, statusPayload());

  if (p === '/events') {
    const since = Number(u.searchParams.get('since') || 0);
    return send(200, { ok: true, events: eventsSince(since), lastSeq: S.seq });
  }

  if (p === '/code' && req.method === 'POST') {
    let code;
    try {
      code = JSON.parse((await readBody(req)) || '{}').code;
    } catch {
      return send(400, { ok: false, message: '请求体不是合法 JSON，应为 {"code":"1234"}' });
    }
    if (!/^\d{4}$/.test(String(code))) return send(400, { ok: false, message: '需要 4 位数字' });
    const hit = S.pending.find(({ item }) => String(item.type) === '1');
    if (!hit) return send(409, { ok: false, message: '当前没有进行中的数字考勤' });
    try {
      const r = await manualSign(hit.course, hit.item, String(code));
      return send(200, r);
    } catch (e) {
      return send(500, { ok: false, message: e.message });
    }
  }

  if (p === '/poll' && req.method === 'POST') {
    const force = u.searchParams.get('refresh') === '1';
    (force ? getCourses(true).then(() => pollRound()) : pollRound()).catch(() => { });
    return send(200, { ok: true, message: force ? '已刷新课程列表并触发巡检' : '已触发一轮巡检' });
  }

  return send(404, { ok: false, message: 'not found' });
}

export function startHttp(port) {
  const server = http.createServer((req, res) => {
    handleHttp(req, res).catch((e) => {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: e.message }));
      } catch { }
    });
  });
  server.listen(port, '0.0.0.0', () => {
    logLine('INFO', `HTTP 状态服务已启动：http://0.0.0.0:${port}（healthz/status/events/看板）`);
  });
  return server;
}
