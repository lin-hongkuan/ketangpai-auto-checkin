/**
 * 巡检主循环
 *
 * 每轮：拉课程 → 并发扫描 → 处理待签到 → 处理待签出 → 每日汇总
 */
import { DAILY_REPORT_HOUR, POOL_SIZE, POLL_INTERVAL } from './config.mjs';
import { S, P, bumpStats, saveState, pruneDone } from './store.mjs';
import { getCourses, scanCourse, invalidateRecent } from './scanner.mjs';
import { submitCheckin, submitCheckout } from './signer.mjs';
import { ATTEND_TYPE, CHECKINOUT_TYPE, DIGIT_TYPE, SCAN_TYPE, doneKey, checkoutKey } from './attence.mjs';
import { pushEvent, eventOnce } from './events.mjs';
import { logLine } from './log-bridge.mjs';
import { fmtTs } from './logger.mjs';
import { TokenExpiredError } from './api.mjs';

/** 受限并发：课程多的时候别一次性打出去 */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    for (; ;) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await worker(items[idx]); } catch (e) { out[idx] = { __error: e }; }
    }
  });
  await Promise.all(runners);
  return out;
}

/** 扫描全部课程，汇总待签到 / 待签出 / 最近记录 */
async function scanAll(courses) {
  const res = await pool(courses, POOL_SIZE, async (course) => ({ course, scan: await scanCourse(course.id) }));
  const hits = [];
  const checkoutHits = [];
  const recent = [];
  let tokenErr = null;

  for (const r of res) {
    if (r.__error) {
      if (r.__error instanceof TokenExpiredError) tokenErr = r.__error;
      continue;
    }
    for (const item of r.scan.pending || []) hits.push({ course: r.course, item });
    for (const rec of r.scan.checkouts || []) checkoutHits.push({ course: r.course, item: rec });
    for (const rec of r.scan.recent || []) recent.push({ course: r.course, item: rec });
  }
  if (tokenErr) throw tokenErr;

  recent.sort((a, b) => Number(b.item.createtime || 0) - Number(a.item.createtime || 0));
  return { hits, checkoutHits, recent };
}

const isDone = (course, item) => !!P.done[doneKey(course, item)];
const isCheckoutDone = (course, rec) => !!P.done[checkoutKey(course, rec)];

// 连续失败计数（内存即可，重启后从头算）
const failCount = new Map();
// 记录被服务端拒绝过的数字考勤码，避免用同一个错码反复提交
const badCode = new Map();
// 签出窗口的时钟容差：本地时钟可能比服务端慢几秒，提前几秒开始尝试
const CLOCK_SKEW_SEC = 3;

function markDone(course, item) {
  P.done[doneKey(course, item)] = Date.now();
  failCount.delete(doneKey(course, item));
  pruneDone();
  saveState();
}

function markCheckoutDone(course, rec) {
  P.done[checkoutKey(course, rec)] = Date.now();
  pruneDone();
  saveState();
}

/** 处理一条待签到记录；返回 0 成功 / 5 需数字码 / 6 需扫码 / 7 需坐标 / 1 失败 */
async function handleOne(course, item) {
  const title = item.title || item.attenceTitle || '考勤';
  const type = String(item.type);
  const tName = ATTEND_TYPE[type] || type;
  const key = doneKey(course, item);

  // 扫码考勤：只能提醒
  if (type === SCAN_TYPE) {
    eventOnce('scan:' + key, 30, 'warn', 'need_scan', `需要扫码签到：${course.name}｜${title}（需本人在微信扫老师大屏二维码）`);
    return 6;
  }

  // 数字考勤：有码就自动签，没码等待人工
  if (type === DIGIT_TYPE) {
    const code = S.config.digitCode || '';
    if (!code) {
      eventOnce('digit:' + key, 30, 'warn', 'need_code', `数字考勤待补签：${course.name}｜${title}（需要 4 位签到码，可在看板填写或通过 /code 接口提交）`);
      return 5;
    }
    // 同一个错码不要每轮都重试：既浪费请求，也可能触发风控
    if (badCode.get(key) === code) {
      eventOnce('digitbad:' + key, 30, 'warn', 'need_code',
        `数字考勤码无效：${course.name}｜${title}（当前配置的码被拒，请更新 digitCode）`);
      return 5;
    }
    const r = await submitCheckin(course, item, code);
    if (r.ok) {
      badCode.delete(key);
      markDone(course, item);
      invalidateRecent(course.id);
      bumpStats().signed++;
      pushEvent('success', 'signed', `签到成功：${course.name}｜${title}（数字考勤${r.verify ? '，' + r.verify : ''}）`);
      return 0;
    }
    if (r.fatal) {
      badCode.set(key, code);
      eventOnce('digitbad:' + key, 30, 'warn', 'need_code',
        `数字考勤码被拒：${course.name}｜${title}（${r.error}）—— 换一个码再试，同一个码不会重复提交`);
      return 5;
    }
    bumpStats().failed++;
    signFailure(course, item, '数字考勤', r);
    return r.blocked ? 7 : 1;
  }

  // GPS / 传统 / 签入签出
  const r = await submitCheckin(course, item, '');

  if (r.blocked === 'gps-no-coords') {
    eventOnce('gps:' + key, 30, 'warn', 'need_gps',
      `GPS 考勤缺少坐标：${course.name}｜${title}。请在 config.json 填教室坐标（latitude/longitude），或把 requireGpsCoords 设为 false 允许零坐标兜底`);
    return 7;
  }

  if (r.ok) {
    markDone(course, item);
    invalidateRecent(course.id);
    bumpStats().signed++;
    const extra = r.already ? '，复核确认已签到' : (r.ended ? '，考勤已结束' : '');
    const warn = r.suspicious ? '，⚠ 用的是零坐标（老师端可能不认，建议配置教室坐标）' : '';

    if (type === CHECKINOUT_TYPE) {
      pushEvent(r.suspicious ? 'warn' : 'success', 'signed',
        `签入成功：${course.name}｜${title}（签入签出${r.verify ? '，' + r.verify : ''}${extra}）${warn}，等待签出阶段`);
      // 签出窗口可能只有几十秒，签入后立刻看一眼，赶得上就马上签出
      await tryCheckoutNow(course, item);
    } else {
      pushEvent(r.suspicious ? 'warn' : 'success', 'signed',
        `签到成功：${course.name}｜${title}（${tName}${r.verify ? '，' + r.verify : ''}${extra}）${warn}`);
    }
    return 0;
  }

  bumpStats().failed++;
  signFailure(course, item, tName, r);
  return 1;
}

/** 签入成功后立即检查签出窗口（不等下一轮） */
async function tryCheckoutNow(course, item) {
  try {
    const rows = await scanCourse(course.id);
    const rec = (rows.recent || []).find((x) => String(x.id) === String(item.id));
    const now = Math.floor(Date.now() / 1000);
    const at = Number((rec && rec.checkouttime) || 0);
    const end = Number((rec && rec.overtime) || 0);
    if (rec && Number(rec.resultCheckoutTime || 0) === 0 && at && now >= at && (!end || now <= end)) {
      await handleCheckout(course, rec);
    }
  } catch (e) {
    if (e instanceof TokenExpiredError) throw e;
  }
}

function signFailure(course, item, tName, r) {
  const title = item.title || item.attenceTitle || '考勤';
  const key = doneKey(course, item);
  const attempts = (failCount.get(key) || 0) + 1;
  failCount.set(key, attempts);

  eventOnce('fail:' + key, 15, 'error', 'failed',
    `签到失败：${course.name}｜${title}（${tName}）：${r.error || '未知原因'}（已连续失败 ${attempts} 轮，自动重试中）`);
  if (attempts >= 3) {
    eventOnce('stuck:' + key, 20, 'error', 'sign_stuck',
      `签到持续失败：${course.name}｜${title}（${tName}）已重试 ${attempts} 轮仍失败：${r.error || '未知原因'}`);
  }
}

/** 处理一条待签出记录；返回 0 成功 / 4 等待 / 2 窗口已过 / 1 失败 */
async function handleCheckout(course, rec) {
  const title = rec.title || rec.attenceTitle || '考勤';
  const key = checkoutKey(course, rec);
  const now = Math.floor(Date.now() / 1000);
  const checkoutAt = Number(rec.checkouttime || 0);
  const overtime = Number(rec.overtime || 0);

  if (now < checkoutAt - CLOCK_SKEW_SEC) {
    eventOnce('co-wait:' + key, 60, 'info', 'checkout_waiting',
      `签入签出考勤已签入，等待签出：${course.name}｜${title}（${fmtTs(checkoutAt)} 开放签出${overtime ? '，' + fmtTs(overtime) + ' 截止' : ''}）`);
    return 4;
  }

  const r = await submitCheckout(course, rec);

  if (r.ok) {
    markCheckoutDone(course, rec);
    invalidateRecent(course.id);
    bumpStats().signedOut++;
    pushEvent('success', 'checkout_signed',
      `签出成功：${course.name}｜${title}（签入签出${r.verify ? '，' + r.verify : ''}${r.already ? '，复核确认已签出' : ''}）`);
    return 0;
  }

  if (r.ended) {
    markCheckoutDone(course, rec);
    bumpStats().checkoutMissed++;
    eventOnce('co-miss:' + key, 1440, 'warn', 'checkout_missed',
      `签出窗口已关闭，未能签出：${course.name}｜${title}（${r.error}）`);
    return 2;
  }

  if (r.early) {
    eventOnce('co-wait:' + key, 30, 'info', 'checkout_waiting',
      `签出时间未到，稍后自动重试：${course.name}｜${title}（${r.error}）`);
    return 4;
  }

  bumpStats().failed++;
  eventOnce('cofail:' + key, 15, 'error', 'checkout_failed',
    `签出失败：${course.name}｜${title}：${r.error}（自动重试中）`);
  return 1;
}

let polling = false;

export async function pollRound() {
  if (polling) return;
  polling = true;
  const t0 = Date.now();

  try {
    if (!String(S.config.token || '').trim()) {
      S.lastPollAt = Date.now();
      S.lastPollOk = false;
      S.lastError = '未配置 token：设置环境变量 KTP_TOKEN，或写入 data/config.json 的 token 字段';
      return;
    }

    const courses = await getCourses();
    const { hits, checkoutHits, recent } = await scanAll(courses);

    S.pending = hits;
    S.recent = recent.slice(0, 20);
    S.pollRounds++;
    bumpStats().rounds++;
    S.lastPollAt = Date.now();
    S.lastPollOk = true;
    S.lastError = '';

    for (const { course, item } of hits) {
      if (isDone(course, item)) continue;
      const key = doneKey(course, item);
      eventOnce('detect:' + key, 10, 'info', 'detected',
        `检测到考勤：${course.name}｜${item.title || '考勤'}（${ATTEND_TYPE[String(item.type)] || item.type}）`);
      bumpStats().detected++;
      await handleOne(course, item);
    }

    // 签入签出：签入成功后会从"待签到"里消失，必须单独盯签出阶段
    for (const { course, item } of checkoutHits) {
      if (isCheckoutDone(course, item)) continue;
      const key = checkoutKey(course, item);
      eventOnce('co-detect:' + key, 10, 'info', 'detected',
        `检测到待签出：${course.name}｜${item.title || '考勤'}（签入签出，${fmtTs(item.checkouttime)} 起可签出）`);
      await handleCheckout(course, item);
    }

    maybeDailyReport();
  } catch (e) {
    S.lastPollAt = Date.now();
    S.lastPollOk = false;
    S.lastError = e && e.message ? e.message : String(e);
    if (e instanceof TokenExpiredError) {
      eventOnce('token-expired', 60, 'error', 'token_expired',
        'token 已失效（20003），请更新 data/config.json 里的 token（30 秒热生效）');
    } else {
      pushEvent('warn', 'poll_error', '巡检失败：' + S.lastError);
    }
  } finally {
    S.lastPollMs = Date.now() - t0;
    polling = false;
    // 单轮耗时接近轮询间隔时给出提示：课程多或网络慢，建议调大 POLL_INTERVAL
    // 前两轮是冷启动（课程列表 + 全部课程缓存都是空的），不告警
    if (S.pollRounds > 2 && S.lastPollMs > POLL_INTERVAL * 1000 * 0.9) {
      eventOnce('slowpoll', 30, 'warn', 'poll_error',
        '单轮巡检耗时 ' + S.lastPollMs + 'ms，接近轮询间隔 ' + POLL_INTERVAL + 's，建议调大 POLL_INTERVAL 或调小 POOL_SIZE');
    }
  }
}

function maybeDailyReport() {
  const hour = Number(S.config.dailyReportHour ?? DAILY_REPORT_HOUR);
  if (!hour) return;
  const d = new Date().toLocaleDateString('sv-SE', { timeZone: process.env.TZ || 'Asia/Shanghai' });
  if (S.dailyReportedDate === d) return;
  const hh = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: process.env.TZ || 'Asia/Shanghai' }));
  if (hh < hour) return;
  S.dailyReportedDate = d;
  saveState();
  const st = bumpStats();
  pushEvent('info', 'daily_report',
    `巡检日报（${d}）：巡检 ${st.rounds} 轮，检测到考勤 ${st.detected} 次，签入成功 ${st.signed} 次，签出成功 ${st.signedOut || 0} 次，失败 ${st.failed} 次，待人工 ${S.pending.length} 条`);
}

/** 手动补签（看板 / POST /code 用） */
export async function manualSign(course, item, code) {
  const r = await submitCheckin(course, item, code);
  if (r.ok) {
    markDone(course, item);
    invalidateRecent(course.id);
    bumpStats().signed++;
    pushEvent('success', 'signed', `手动补签成功：${course.name}｜${item.title || '考勤'}${r.verify ? '（' + r.verify + '）' : ''}`);
    return { ok: true, message: '补签成功' };
  }
  pushEvent('error', 'failed', `手动补签失败：${course.name}：${r.error || '未知原因'}`);
  return { ok: false, message: r.error || '签到失败' };
}

export { logLine };
