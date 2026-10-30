/**
 * 课堂派 API 客户端
 *
 * - 统一注入 token / Origin / UA
 * - 网络错误、超时、5xx、429 自动重试
 * - 把业务错误区分为 TokenExpiredError / BusinessError，便于上层分别处理
 */
import { API_BASE } from './config.mjs';
import { S } from './store.mjs';

export class TokenExpiredError extends Error { }
export class BusinessError extends Error {
  constructor(m, code, data) { super(m); this.code = code; this.data = data; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} apiPath 形如 '/AttenceApi/checkin'
 * @param {object} body    请求体（自动附加 reqtimestamp）
 * @param {object} opts    { retries, timeout }
 */
export async function api(apiPath, body = {}, opts = {}) {
  const retries = opts.retries ?? 4;
  const timeout = opts.timeout ?? 20000;
  const cfg = S.config;
  let lastErr = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    let res;
    try {
      res = await fetch(API_BASE + apiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token: cfg.token,
          Origin: 'https://w.ketangpai.com',
          Referer: 'https://w.ketangpai.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({ ...body, reqtimestamp: Date.now() }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1) await sleep(400 * (attempt + 1));
      continue;
    }

    // 5xx / 429 视为可重试的服务端错误
    if (!res.ok && (res.status >= 500 || res.status === 429)) {
      lastErr = new Error('HTTP ' + res.status);
      if (attempt < retries - 1) { await sleep(500 * (attempt + 1)); continue; }
      throw new BusinessError('服务端错误 HTTP ' + res.status, -3);
    }

    let json = null;
    try { json = await res.json(); } catch { throw new BusinessError(`接口返回非 JSON（HTTP ${res.status}）`, -2); }

    if (json.status === 1) { S.tokenExpired = false; return json.data; }
    if (json.code === 20003) { S.tokenExpired = true; throw new TokenExpiredError(json.message || '登录已过期'); }
    throw new BusinessError(json.message || '接口错误', json.code, json.data);
  }

  throw new BusinessError('网络请求失败：' + (lastErr && lastErr.message), -1);
}

// ============================================================================
// 具体接口
// ============================================================================

export async function fetchCourses() {
  const d = await api('/courseApi/simpleLists', {});
  return (d && d.lists) || [];
}

/** 服务端算好的待签到列表 */
export async function fetchPendingList(courseId) {
  try {
    const d = await api('/AttenceApi/getNotFinishAttenceStudent', { courseid: courseId });
    return (d && Array.isArray(d.lists)) ? d.lists : [];
  } catch (e) {
    if (e instanceof TokenExpiredError) throw e;
    return [];
  }
}

/**
 * 某课程最近的考勤记录。
 * 返回结构是 {status:1, data:{data:[...], total:n}} —— 少取一层 data 会拿到 undefined，
 * v1.2.x 的兜底查询就踩过这个坑（一直返回空数组）。
 */
export async function fetchRecentAttence(courseId, size = 10) {
  try {
    const d = await api('/SummaryApi/attence', { courseid: courseId, page: 1, size });
    if (d && d.data && Array.isArray(d.data.data)) return d.data.data;
    if (d && Array.isArray(d.data)) return d.data; // 兼容扁平结构
    return [];
  } catch (e) {
    if (e instanceof TokenExpiredError) throw e;
    return [];
  }
}

/** 单条考勤的签到结果（注意：这里的 state 不可靠，详见 attence.mjs） */
export async function fetchCheckInResult(attenceId) {
  try {
    return await api('/AttenceApi/getCheckInResult', { attenceid: attenceId });
  } catch (e) {
    if (e instanceof TokenExpiredError) throw e;
    return null;
  }
}

export async function submitCheckinPayload(payload) {
  return api('/AttenceApi/checkin', payload);
}
