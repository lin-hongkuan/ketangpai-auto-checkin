#!/usr/bin/env node
/**
 * 通用 Webhook 转发器
 *
 * 轮询服务的 /events，把新事件推到 Telegram / 飞书 / 钉钉 / 企业微信 / 任意 URL。
 * 零依赖，只用 Node 内置模块。
 *
 * 用法：
 *   KTP_WEBHOOK_TYPE=feishu \
 *   KTP_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx \
 *   node integrations/webhook.mjs
 *
 * 环境变量：
 *   KTP_BASE          服务地址，默认 http://127.0.0.1:18080
 *   KTP_DASHBOARD_TOKEN  看板令牌（服务设了就要填）
 *   KTP_WEBHOOK_TYPE  telegram | feishu | dingtalk | wecom | generic
 *   KTP_WEBHOOK_URL   目标地址（telegram 不用填，用下面两个）
 *   KTP_TG_BOT_TOKEN  Telegram bot token
 *   KTP_TG_CHAT_ID    Telegram chat id
 *   KTP_INTERVAL      轮询秒数，默认 60
 *   KTP_CURSOR_FILE   游标文件，默认 ./data/.webhook-cursor
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.KTP_BASE || 'http://127.0.0.1:18080';
const DASH = process.env.KTP_DASHBOARD_TOKEN || '';
const TYPE = process.env.KTP_WEBHOOK_TYPE || 'generic';
const URL_TARGET = process.env.KTP_WEBHOOK_URL || '';
const TG_TOKEN = process.env.KTP_TG_BOT_TOKEN || '';
const TG_CHAT = process.env.KTP_TG_CHAT_ID || '';
const INTERVAL = Math.max(10, Number(process.env.KTP_INTERVAL || 60));
const CURSOR_FILE = process.env.KTP_CURSOR_FILE || path.join(process.cwd(), 'data', '.webhook-cursor');

// 只转发这些类型（其余是过程噪音）
const FORWARD = new Set([
  'signed', 'checkout_signed', 'checkout_missed', 'checkout_failed',
  'failed', 'sign_stuck', 'need_code', 'need_scan', 'need_gps',
  'token_expired', 'daily_report', 'course_added', 'course_skipped',
]);
// 紧急：单独成条，加前缀
const URGENT = new Set(['token_expired', 'need_code', 'need_scan', 'need_gps', 'failed', 'sign_stuck', 'checkout_failed']);

function readCursor() {
  try { return Number(fs.readFileSync(CURSOR_FILE, 'utf8').trim()) || 0; } catch { return 0; }
}
function writeCursor(n) {
  try {
    fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
    fs.writeFileSync(CURSOR_FILE, String(n));
  } catch { }
}

async function getEvents(since) {
  const q = new URLSearchParams({ since: String(since) });
  if (DASH) q.set('token', DASH);
  const res = await fetch(`${BASE}/events?${q}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function send(text) {
  if (!text.trim()) return;

  if (TYPE === 'telegram') {
    if (!TG_TOKEN || !TG_CHAT) throw new Error('缺 KTP_TG_BOT_TOKEN / KTP_TG_CHAT_ID');
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
    });
    if (!r.ok) throw new Error('telegram ' + r.status);
    return;
  }

  if (!URL_TARGET) throw new Error('缺 KTP_WEBHOOK_URL');

  // 各家机器人 body 格式不一样
  let body;
  if (TYPE === 'feishu') body = { msg_type: 'text', content: { text } };
  else if (TYPE === 'dingtalk') body = { msgtype: 'text', text: { content: text } };
  else if (TYPE === 'wecom') body = { msgtype: 'text', text: { content: text } };
  else body = { text };

  const r = await fetch(URL_TARGET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`${TYPE} ${r.status}`);
}

async function tick() {
  let cursor = readCursor();
  let data;
  try {
    data = await getEvents(cursor);
  } catch (e) {
    console.error('[webhook] 拉取事件失败:', e.message);
    return;
  }

  // 服务重启后 seq 从 1 重计，必须回到 0 重读，否则永远收不到新事件
  const serverLast = Number(data.lastSeq || cursor);
  if (serverLast < cursor) {
    console.error(`[webhook] 检测到服务重启（seq ${serverLast} < 游标 ${cursor}），从 0 重读`);
    cursor = 0;
    try { data = await getEvents(0); } catch { return; }
  }

  const events = (data.events || []).filter((e) => FORWARD.has(e.type));
  if (events.length) {
    const urgent = events.filter((e) => URGENT.has(e.type));
    const normal = events.filter((e) => !URGENT.has(e.type));

    if (urgent.length) {
      await send('🔴 课堂派签到提醒\n' + urgent.map((e) => `${e.time} ${e.message}`).join('\n'));
    }
    if (normal.length) {
      await send('📋 课堂派签到\n' + normal.map((e) => `${e.time} ${e.message}`).join('\n'));
    }
  }

  writeCursor(Math.max(cursor, Number(data.lastSeq || cursor)));
}

console.log(`[webhook] 启动：${BASE} → ${TYPE}${URL_TARGET ? ' ' + URL_TARGET : ''}，每 ${INTERVAL}s 一次`);
tick();
setInterval(tick, INTERVAL * 1000);
