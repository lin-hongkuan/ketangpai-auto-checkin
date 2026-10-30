/**
 * 日志桥
 *
 * signer / poller 等模块需要在任意位置打日志，但 logger 实例由入口创建。
 * 用一个极轻的桥把调用转发过去，避免循环依赖。
 */
let impl = () => { };

export function setLogLine(fn) { impl = fn; }

export function logLine(level, msg) {
  try { impl(level, msg); } catch { /* 日志失败不影响主流程 */ }
}
