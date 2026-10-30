#!/usr/bin/env node
/**
 * 课堂派自动签到 · 入口
 *
 * 用法：
 *   node src/index.mjs                常驻服务
 *   node src/index.mjs --once         只跑一轮巡检
 *   node src/index.mjs --status       跑一轮并打印状态 JSON
 *   node src/index.mjs --self-test    自检（不联网）
 *   node src/index.mjs --version      打印版本
 */
import fs from 'node:fs';
import {
  PORT, DATA_DIR, CONFIG_FILE, VERSION, POLL_INTERVAL,
  defaultConfig, ensureDirs, loadFileConfig, writeConfigFile, mergeConfig,
} from './config.mjs';
import { S, restoreState, flushState } from './store.mjs';
import { createLogger } from './logger.mjs';
import { setLogLine } from './log-bridge.mjs';
import { setEventSink } from './events.mjs';
import { pollRound } from './poller.mjs';
import { statusPayload, startHttp } from './server.mjs';
import {
  ATTEND_TYPE, buildSubmitPlans, describeAttence, evaluateSignRecord, pickCheckouts,
} from './attence.mjs';
import { coordsForSubmit } from './signer.mjs';

const logger = createLogger(`${DATA_DIR}/logs/service.log`);
setLogLine(logger.log);
setEventSink(logger.log);

// ============================================================================
// 初始化
// ============================================================================
function init() {
  ensureDirs();
  restoreState();

  let cfg = loadFileConfig();
  if (!cfg) {
    cfg = defaultConfig();
    writeConfigFile(cfg);
    logger.info('已生成默认配置 ' + CONFIG_FILE);
  }
  S.config = mergeConfig(cfg);
  S.configFp = JSON.stringify([S.config.courseIds, S.config.excludeCourseIds, S.config.courseRefreshSec]);
  try {
    S.configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
  } catch { }
}

/** 配置热加载：token / 课程范围改完 30 秒内生效 */
function reloadConfigIfChanged() {
  try {
    const m = fs.statSync(CONFIG_FILE).mtimeMs;
    if (m === S.configMtime) return;
    S.configMtime = m;
    const cfg = loadFileConfig();
    if (!cfg) return;
    const oldToken = S.config.token;
    S.config = mergeConfig(cfg);
    if (S.config.token !== oldToken) {
      S.tokenExpired = false;
      logger.info('检测到 config.json 更新，已热加载 token');
    }
    const fp = JSON.stringify([S.config.courseIds, S.config.excludeCourseIds, S.config.courseRefreshSec]);
    if (fp !== S.configFp) {
      S.configFp = fp;
      S.coursesAt = 0;
      logger.info('课程范围配置已更新，下一轮立即刷新课程列表');
    }
  } catch { }
}

// ============================================================================
// 常驻
// ============================================================================
async function runDaemon() {
  logger.info(`课堂派自动签到 v${VERSION} 启动，轮询间隔 ${POLL_INTERVAL}s，数据目录 ${DATA_DIR}`);
  logger.info(`课程范围：${(S.config.courseIds || []).length ? S.config.courseIds.length + ' 门指定课程' : '账号下全部课程'}`);
  if (!String(S.config.token || '').trim()) {
    logger.warn('尚未配置 token —— 打开看板会看到配置指引');
  }
  if (!String(S.config.latitude || '').trim()) {
    logger.info('未配置教室坐标：GPS 考勤会先试空坐标，最后用零坐标兜底（建议在 config.json 填 latitude/longitude）');
  }

  const server = startHttp(PORT);

  const loop = async () => {
    reloadConfigIfChanged();
    await pollRound();
    setTimeout(loop, POLL_INTERVAL * 1000);
  };
  loop();

  const shutdown = (sig) => {
    logger.info(`收到 ${sig}，正在退出…`);
    try { server.close(); } catch { }
    flushState();
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ============================================================================
// 自检
// ============================================================================
function selfTest() {
  let pass = true;
  const check = (name, got, expect) => {
    const ok = got === expect;
    if (!ok) pass = false;
    console.log(`  ${name} → ${got} ${ok ? '✓' : '✗ 期望 ' + expect}`);
  };

  console.log('坐标配置：', JSON.stringify({ latitude: S.config.latitude, longitude: S.config.longitude, coordsAreWgs84: S.config.coordsAreWgs84, requireGpsCoords: S.config.requireGpsCoords }));

  const coords = coordsForSubmit();
  console.log('实际提交坐标：', JSON.stringify(coords));

  console.log('\n提交策略自检（GPS 考勤）：');
  const gpsItem = { id: 'X', type: '2', title: 'GPS' };
  const noCoord = buildSubmitPlans(gpsItem, '', { latitude: '', longitude: '' }, { requireGpsCoords: false });
  check('无坐标·宽松模式 → 策略数', noCoord.plans.length, 4);
  check('无坐标·宽松模式 → 首策略坐标为空', noCoord.plans[0].payload.latitude, '');
  check('无坐标·宽松模式 → 末策略为零坐标', noCoord.plans[3].payload.latitude, '0.00000000');
  const strict = buildSubmitPlans(gpsItem, '', { latitude: '', longitude: '' }, { requireGpsCoords: true });
  check('无坐标·严格模式 → 直接放弃', strict.blocked, 'gps-no-coords');
  const withCoord = buildSubmitPlans(gpsItem, '', { latitude: '23.1', longitude: '113.3' }, { requireGpsCoords: true });
  check('有坐标 → 首策略用真实坐标', withCoord.plans[0].payload.latitude, '23.1');
  check('有坐标 → 仍保留零坐标兜底', withCoord.plans.some((p) => p.payload.latitude === '0.00000000'), true);

  console.log('\n已签到判定自检：');
  const signedCases = [
    ['state=100（待签到）', { state: '100', signTime: 0 }, false],
    ['state=100 但 signTime 有值', { state: '100', signTime: 1793281889 }, false],
    ['state=0 + signTime（真签到）', { state: '0', signTime: 1793281889 }, true],
    ['state=0 但 signTime=0（假成功）', { state: '0', signTime: 0 }, false],
    ['state=2（迟到）', { state: '2', signTime: 1793281889 }, true],
    ['state=3（请假）', { state: '3', signTime: 0 }, false],
  ];
  for (const [name, rec, expect] of signedCases) check(name, evaluateSignRecord(rec).signed, expect);

  console.log('\n签入签出状态自检：');
  const ioCases = [
    ['待签入', { type: '4', state: '100', resultCheckinTime: 0, resultCheckoutTime: 0 }, '待签入'],
    ['已签入·待签出', { type: '4', state: '0', resultCheckinTime: '1793344479', resultCheckoutTime: 0 }, '已签入·待签出'],
    ['已签入·已签出', { type: '4', state: '0', resultCheckinTime: '1793344479', resultCheckoutTime: '1793344600' }, '已签入·已签出'],
    ['传统考勤出勤', { type: '2', state: '0', signTime: '1793344479' }, '出勤'],
  ];
  for (const [name, rec, expect] of ioCases) check(name, describeAttence(rec).label, expect);

  console.log('\n待签出识别自检：');
  const now = 1793344600;
  const coCases = [
    ['已签入·未签出·窗口内', { type: '4', checkouttime: 1793344583, overtime: 1793344643, resultCheckinTime: '1793344479', resultCheckoutTime: 0 }, 1],
    ['窗口未开（提前发现）', { type: '4', checkouttime: 1793344700, overtime: 1793344760, resultCheckinTime: '1793344479', resultCheckoutTime: 0 }, 1],
    ['窗口已关', { type: '4', checkouttime: 1793344583, overtime: 1793344643, resultCheckinTime: '1793344479', resultCheckoutTime: 0, _now: 1793344700 }, 0],
    ['未签入', { type: '4', checkouttime: 1793344583, overtime: 1793344643, resultCheckinTime: 0, resultCheckoutTime: 0 }, 0],
    ['已签出', { type: '4', checkouttime: 1793344583, overtime: 1793344643, resultCheckinTime: '1793344479', resultCheckoutTime: '1793344600' }, 0],
    ['非签入签出', { type: '2', checkouttime: 1793344583, resultCheckinTime: '1793344479', resultCheckoutTime: 0 }, 0],
  ];
  for (const [name, rec, expect] of coCases) {
    check(name, pickCheckouts([rec], rec._now ?? now).length, expect);
  }

  console.log(pass ? '\n自检全部通过' : '\n自检存在失败项');
  return pass;
}

// ============================================================================
// CLI
// ============================================================================
async function cli() {
  const args = process.argv.slice(2);
  init();

  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    return;
  }
  if (args.includes('--self-test')) {
    const ok = selfTest();
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (args.includes('--status')) {
    await pollRound().catch(() => { });
    flushState();
    console.log(JSON.stringify(statusPayload(), null, 2));
    return;
  }
  if (args.includes('--once')) {
    await pollRound();
    flushState();
    console.log(`本轮巡检完成：待签到 ${S.pending.length} 条，最近考勤 ${(S.recent || []).length} 条`);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log('用法：node src/index.mjs [--status|--once|--self-test|--version]');
    return;
  }
  await runDaemon();
}

cli().catch((e) => {
  logger.error('启动失败：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
