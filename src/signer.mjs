/**
 * 提交与复核
 *
 * 这个模块的原则：**绝不轻信接口返回的"成功"**。
 *
 * 课堂派的 /AttenceApi/checkin 只要参数格式对就返回 status=1，
 * 但"服务端收下了"和"真的签上了"是两回事：
 *   - GPS 考勤用零坐标提交 → 学生端 state=0、signTime 有值，老师端统计不认
 *   - 提交成功但响应丢失 → 下一轮会重复提交
 *
 * 所以每次提交后都回查 SummaryApi/attence 的 signTime，拿不到证据就不算成功。
 */
import { GPS_TYPE, buildSubmitPlans, evaluateSignRecord, inspectGpsCoords, wgs84ToGcj02 } from './attence.mjs';
import { parseCoords } from './config.mjs';
import { S } from './store.mjs';
import { fetchCheckInResult, fetchRecentAttence, submitCheckinPayload } from './api.mjs';
import { sleep } from './api.mjs';
import { logLine } from './log-bridge.mjs';

/** 按配置算出要提交的坐标（WGS84 自动转 GCJ02） */
export function coordsForSubmit() {
  const p = parseCoords(S.config);
  if (!p) return { latitude: '', longitude: '' };
  const out = S.config.coordsAreWgs84 ? wgs84ToGcj02(p.lat, p.lng) : { lat: p.lat, lng: p.lng };
  return { latitude: String(out.lat), longitude: String(out.lng) };
}

/** 在最近记录里找指定考勤 */
async function findRecord(courseId, attenceId) {
  const rows = await fetchRecentAttence(courseId, 10);
  return rows.find((x) => String(x.id) === String(attenceId)) || null;
}

/**
 * 复核是否真的签上了。
 * 判据：SummaryApi 的 signTime > 0 且 state ∈ {0,2,7}。
 * GPS 考勤再加一道体检：提交上去的坐标不能是零。
 */
async function verifySigned(courseId, attenceId, type) {
  let lastRec = null;
  for (let v = 0; v < 4; v++) {
    if (v) await sleep(700);
    const rec = await findRecord(courseId, attenceId);
    if (!rec) continue;
    lastRec = rec;
    const ev = evaluateSignRecord(rec);
    if (!ev.signed) continue;

    // GPS 考勤：看提交上去的坐标是不是零（零坐标 = 老师端可能不认的异常签到）
    if (String(type) === GPS_TYPE) {
      const cr = await fetchCheckInResult(attenceId);
      const gps = inspectGpsCoords(cr);
      if (gps.zeroCoords) {
        return { ok: true, suspicious: true, reason: `${ev.reason}，但坐标为零（老师端可能不认）` };
      }
    }
    return { ok: true, suspicious: false, reason: ev.reason };
  }
  return {
    ok: false,
    reason: lastRec
      ? `复核未通过（state=${lastRec.state}, signTime=${lastRec.signTime || 0}）`
      : '复核未查到该考勤记录',
  };
}

/**
 * 签入提交（多层策略 + 提交后强制复核）
 * @returns {{ok:boolean, already?:boolean, ended?:boolean, blocked?:string, suspicious?:boolean, verify?:string, error?:string, strategy?:string}}
 */
export async function submitCheckin(course, item, code) {
  // 0) 先看是不是已经签上了（防止"上次提交成功但响应丢失"）
  const before = await findRecord(course.id, item.id);
  const pre = evaluateSignRecord(before);
  if (pre.signed) return { ok: true, already: true, verify: pre.reason };

  const coords = coordsForSubmit();
  const { plans, blocked } = buildSubmitPlans(item, code, coords, {
    requireGpsCoords: S.config.requireGpsCoords !== false,
  });
  if (blocked === 'gps-no-coords') {
    return { ok: false, blocked, error: 'GPS 考勤需要教室坐标，当前未配置' };
  }

  let lastErr = '';
  for (const plan of plans) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await submitCheckinPayload(plan.payload);
        const verdict = await verifySigned(course.id, item.id, item.type);
        if (verdict.ok) {
          return {
            ok: true,
            suspicious: verdict.suspicious,
            verify: verdict.reason,
            strategy: plan.label,
            retried: plan !== plans[0] || attempt > 1,
          };
        }
        lastErr = verdict.reason;
        logLine('WARN', `签到复核未通过（策略 ${plan.label} 第 ${attempt} 次）：${course.name}｜${item.title || '考勤'} → ${lastErr}`);
        break; // 换下一种兜底策略
      } catch (e) {
        if (e && e.name === 'TokenExpiredError') throw e;
        const msg = String((e && e.message) || '');
        if (/已经签到|重复签到|已签到/.test(msg)) return { ok: true, already: true, verify: '接口提示已签到' };
        if (/已经结束|已结束/.test(msg)) return { ok: true, ended: true, verify: '考勤已结束' };
        if (/签到码|验证码|口令/.test(msg)) return { ok: false, fatal: true, error: msg };
        lastErr = msg || '未知错误';
        logLine('WARN', `签到失败（策略 ${plan.label} 第 ${attempt} 次）：${course.name}｜${item.title || '考勤'} → ${lastErr}`);
        await sleep(500 + attempt * 500);
      }
    }
  }
  return { ok: false, error: lastErr };
}

/**
 * 签出提交（「签入签出」考勤的第二阶段）
 *
 * 课堂派没有独立的签出接口，仍然是 /AttenceApi/checkin：
 * 服务端按当前时间是否落在 [checkouttime, overtime] 内判定这一笔是签出。
 * 复核不能用 signTime —— 签入时它就 > 0 了，要看 resultCheckoutTime。
 */
export async function submitCheckout(course, rec) {
  const coords = coordsForSubmit();
  const { plans, blocked } = buildSubmitPlans(rec, '', coords, {
    requireGpsCoords: S.config.requireGpsCoords !== false,
  });
  if (blocked) return { ok: false, blocked, error: '签出需要坐标，当前未配置' };

  let lastErr = '';
  for (const plan of plans) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await submitCheckinPayload(plan.payload);

        let last = null;
        for (let v = 0; v < 4; v++) {
          if (v) await sleep(700);
          last = await findRecord(course.id, rec.id);
          if (last && Number(last.resultCheckoutTime || 0) > 0) {
            return {
              ok: true,
              verify: `签出时间 ${new Date(Number(last.resultCheckoutTime) * 1000).toLocaleString('zh-CN', { hour12: false })}`,
              strategy: plan.label,
            };
          }
        }
        lastErr = `提交接口返回成功，但复核未签出（resultCheckoutTime=${last ? last.resultCheckoutTime : '未查到记录'}）`;
        logLine('WARN', `签出复核未通过（策略 ${plan.label} 第 ${attempt} 次）：${course.name}｜${rec.title || '考勤'} → ${lastErr}`);
        break;
      } catch (e) {
        if (e && e.name === 'TokenExpiredError') throw e;
        const msg = String((e && e.message) || '');
        if (/未到签出时间|还未到签出时间/.test(msg)) return { ok: false, early: true, error: msg };
        if (/已经签出|重复签出|已签出/.test(msg)) return { ok: true, already: true, verify: '接口提示已签出' };
        if (/考勤已经结束|已结束/.test(msg)) return { ok: false, ended: true, error: msg };
        lastErr = msg || '未知错误';
        logLine('WARN', `签出失败（策略 ${plan.label} 第 ${attempt} 次）：${course.name}｜${rec.title || '考勤'} → ${lastErr}`);
        await sleep(500 + attempt * 500);
      }
    }
  }
  return { ok: false, error: lastErr };
}
