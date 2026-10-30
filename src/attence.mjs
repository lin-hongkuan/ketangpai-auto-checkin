/**
 * 考勤领域逻辑（纯函数，不联网、不读写状态）
 *
 * 这里集中了所有"怎么判断一条考勤"的知识，是整个项目最容易出错的地方：
 *
 *  1. state 字段不可全信。课堂派对未签到的记录 nosign 也可能是 "0"；
 *     而 GPS 考勤用零坐标提交时，服务端会记 state=0 + signTime，但老师端不认。
 *  2. 签入签出（type=4）一条记录要提交两次，签入后 state 就从 100 变 0，
 *     会从"待签到"列表里消失，必须单独盯签出阶段。
 */

export const ATTEND_TYPE = {
  '0': '传统考勤',
  '1': '数字考勤',
  '2': 'GPS考勤',
  '3': '扫码考勤',
  '4': '签入签出',
};

export const CHECKINOUT_TYPE = '4';
export const GPS_TYPE = '2';
export const DIGIT_TYPE = '1';
export const SCAN_TYPE = '3';

export const STATE_LABEL = {
  '0': '出勤', '1': '缺勤', '2': '迟到', '3': '请假', '4': '事假',
  '5': '病假', '6': '公假', '7': '早退', '100': '待签到', '-2': '已结束',
};

/** 服务端认为"签上了"的状态 */
export const SIGNED_STATES = new Set(['0', '2', '7']);

export const typeName = (t) => ATTEND_TYPE[String(t)] || String(t);

export const doneKey = (course, item) => `${course.id}:${item.id}`;
/** 签入签出的「签出」阶段是同一 attenceid 的第二笔，必须和签入分开记状态 */
export const checkoutKey = (course, rec) => `${course.id}:${rec.id}:out`;

// ============================================================================
// 判定
// ============================================================================

/**
 * 判定一条 SummaryApi/attence 记录是否真的签上了。
 *
 * 判据：signTime > 0 且 state ∈ {0,2,7}。
 * 只有 state 是不够的 —— 见文件头说明。
 */
export function evaluateSignRecord(rec) {
  if (!rec) return { signed: false, reason: 'no-record' };
  const state = String(rec.state);
  const signTime = Number(rec.signTime || 0);
  if (!SIGNED_STATES.has(state)) return { signed: false, reason: `state=${state}(${STATE_LABEL[state] || '?'})` };
  if (signTime <= 0) return { signed: false, reason: 'state 像签上了但 signTime=0，判定未签到' };
  return { signed: true, reason: `state=${state}(${STATE_LABEL[state]}) signTime=${signTime}` };
}

/**
 * GPS 考勤的额外体检：坐标是零说明提交的是"零坐标兜底"，
 * 服务端会收下，但老师端统计通常不认（异常签到）。
 */
export function inspectGpsCoords(checkInResult) {
  if (!checkInResult) return { zeroCoords: false, unknown: true };
  const lat = Number(checkInResult.latitude || 0);
  const lng = Number(checkInResult.longitude || 0);
  if (checkInResult.latitude === null && checkInResult.longitude === null) {
    return { zeroCoords: false, unknown: true };
  }
  return { zeroCoords: lat === 0 && lng === 0, unknown: false };
}

/**
 * 一条考勤记录的可读状态（「签入签出」要区分两段，不能只看 state）
 * @param {object} r SummaryApi 记录
 * @param {object} [opts] { gpsSuspicious } 由调用方补充的 GPS 体检结果
 */
export function describeAttence(r, opts = {}) {
  const type = String(r.type);
  const state = String(r.state);
  const signTime = Number(r.signTime || 0);

  if (type === CHECKINOUT_TYPE) {
    const inT = Number(r.resultCheckinTime || 0);
    const outT = Number(r.resultCheckoutTime || 0);
    const overtime = Number(r.overtime || 0);
    const now = Math.floor(Date.now() / 1000);
    if (outT > 0) return { label: '已签入·已签出', phase: 'done', cls: 'ok' };
    if (inT > 0) {
      if (overtime && now > overtime) return { label: '已签入·未签出（已超时）', phase: 'miss', cls: 'err' };
      return { label: '已签入·待签出', phase: 'out', cls: 'warn' };
    }
    if (state === '100') return { label: '待签入', phase: 'in', cls: 'warn' };
    if (state === '-2') return { label: '已结束', phase: 'ended', cls: 'dim' };
    return { label: STATE_LABEL[state] || `状态${state}`, phase: 'other', cls: 'dim' };
  }

  if (state === '100') return { label: '待签到', phase: 'in', cls: 'warn' };

  if (SIGNED_STATES.has(state)) {
    if (signTime <= 0) return { label: '未确认（state 异常）', phase: 'other', cls: 'err' };
    if (opts.gpsSuspicious) return { label: `${STATE_LABEL[state] || '已签'}（坐标异常）`, phase: 'suspect', cls: 'warn' };
    return { label: STATE_LABEL[state] || '已签到', phase: 'done', cls: 'ok' };
  }

  if (state === '1') return { label: '缺勤', phase: 'miss', cls: 'err' };
  if (state === '3') return { label: '请假', phase: 'leave', cls: 'dim' };
  if (state === '-2') return { label: '已结束', phase: 'ended', cls: 'dim' };
  return { label: STATE_LABEL[state] || `状态${state}`, phase: 'other', cls: 'dim' };
}

/**
 * 从最近考勤记录里挑出「需要签出」的：
 * 签入签出考勤、已签入、未签出、且签出窗口还开着。
 */
export function pickCheckouts(rows, now = Math.floor(Date.now() / 1000)) {
  const out = [];
  for (const r of rows || []) {
    if (String(r.type) !== CHECKINOUT_TYPE) continue;
    const checkoutAt = Number(r.checkouttime || 0);
    if (!checkoutAt) continue;                            // 没有签出阶段
    if (Number(r.resultCheckinTime || 0) <= 0) continue;  // 还没签入
    if (Number(r.resultCheckoutTime || 0) > 0) continue;  // 已经签出
    const overtime = Number(r.overtime || 0);
    if (overtime && now > overtime) continue;             // 签出窗口已关闭
    out.push(r);
  }
  return out;
}

// ============================================================================
// 坐标
// ============================================================================

export function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0, ee = 0.00669342162296594323, pi = Math.PI;
  const out = (la, ln) => ln < 72.004 || ln > 137.8347 || la < 0.8293 || la > 55.8271;
  const tLat = (x, y) => {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
    r += (20 * Math.sin(y * pi) + 40 * Math.sin(y / 3 * pi)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * pi) + 320 * Math.sin(y * pi / 30)) * 2 / 3;
    return r;
  };
  const tLng = (x, y) => {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
    r += (20 * Math.sin(x * pi) + 40 * Math.sin(x / 3 * pi)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * pi) + 300 * Math.sin(x / 30 * pi)) * 2 / 3;
    return r;
  };
  if (out(lat, lng)) return { lat, lng };
  let dLat = tLat(lng - 105.0, lat - 35.0);
  let dLng = tLng(lng - 105.0, lat - 35.0);
  const rad = lat / 180.0 * pi;
  let magic = Math.sin(rad);
  magic = 1 - ee * magic * magic;
  const sq = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sq) * pi);
  dLng = (dLng * 180.0) / (a / sq * Math.cos(rad) * pi);
  return { lat: lat + dLat, lng: lng + dLng };
}

// ============================================================================
// 提交策略
// ============================================================================

/**
 * 构造提交策略（按顺序尝试，前一个复核不过才升级到下一个）。
 *
 * 优先级：**真实坐标 > 空坐标 > 零坐标**。
 * 零坐标是最后的兜底 —— 老师没开电子围栏时它也能签上（老师端显示"定位未开启"），
 * 但一旦老师绑了围栏，零坐标就会变成"学生端显示出勤、老师端统计不认"的假成功。
 * 所以只在前面都失败后才用，并且成功后会标记 suspicious 提醒用户。
 *
 * @param {object} item     考勤记录
 * @param {string} code     数字考勤的 4 位码
 * @param {object} coords   { latitude, longitude } 已转换好的坐标，没有则为空字符串
 * @param {object} opts     { requireGpsCoords } 严格模式：GPS 考勤没有坐标时直接放弃
 * @returns {{plans: Array, blocked: string|null}}
 */
export function buildSubmitPlans(item, code, coords, opts = {}) {
  const type = String(item.type);
  const base = { id: item.id, code: code || '', accuracy: '', appid: '', clienttype: '1' };
  const hasCoords = !!(coords && coords.latitude && coords.longitude);

  // 严格模式：宁可不签，也不制造假成功
  if (type === GPS_TYPE && !hasCoords && opts.requireGpsCoords === true) {
    return { plans: [], blocked: 'gps-no-coords' };
  }

  const lat = hasCoords ? coords.latitude : '';
  const lng = hasCoords ? coords.longitude : '';
  const zero = { latitude: '0.00000000', longitude: '0.00000000' };

  const combos = [
    { label: hasCoords ? 'normal' : 'normal(no-coords)', unusual: '', lat, lng },
    { label: 'exception-mark', unusual: '1', lat, lng },
    // 兜底：零坐标。历史成功记录就是这个形态，老师没开围栏时有效
    { label: 'zero-coords', unusual: '', lat: zero.latitude, lng: zero.longitude },
    { label: 'exception+zero', unusual: '2', lat: zero.latitude, lng: zero.longitude },
  ];

  const seen = new Set();
  const plans = [];
  for (const c of combos) {
    const payload = { ...base, unusual: c.unusual, latitude: c.lat, longitude: c.lng };
    const sig = JSON.stringify([payload.unusual, payload.latitude, payload.longitude]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    plans.push({ label: c.label, payload });
  }
  return { plans, blocked: null };
}
