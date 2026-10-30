#!/usr/bin/env bash
# 体检：一条命令看清服务哪里不对
#
#   bash scripts/doctor.sh
set -uo pipefail

DIR="${KTP_APP:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$DIR" 2>/dev/null || { echo "找不到项目目录：$DIR"; exit 1; }

PORT="$(grep '^BIND_PORT=' .env 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-18080}"
DASH="$(grep '^DASHBOARD_TOKEN=' .env 2>/dev/null | cut -d= -f2)"
BASE="http://127.0.0.1:${PORT}"
Q=""; [[ -n "$DASH" ]] && Q="?token=${DASH}"

hr() { printf '%.0s─' {1..58}; echo; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

echo; echo "课堂派自动签到 · 体检"; hr

echo "[1/6] 容器"
if docker inspect ktp-checkin >/dev/null 2>&1; then
  ST="$(docker inspect -f '{{.State.Status}} / {{.State.Health.Status}}' ktp-checkin 2>/dev/null)"
  echo "  状态：$ST"
  [[ "$ST" == *healthy* ]] && ok "容器健康" || bad "容器不健康，看下面的日志"
else
  bad "找不到容器 ktp-checkin（没启动？）"
fi

echo "[2/6] 健康检查"
H="$(curl -fsS --max-time 5 "${BASE}/healthz" 2>/dev/null)"
if [[ -n "$H" ]]; then
  echo "  $H"
  [[ "$H" == *'"ok":true'* ]] && ok "/healthz 正常" || bad "/healthz 返回不 ok"
  [[ "$H" == *'"tokenMissing":true'* ]] && bad "没配 token → 改 .env 的 KTP_TOKEN"
  [[ "$H" == *'"tokenExpired":true'* ]] && bad "token 过期 → 重新拿一个，改 .env 后 docker compose up -d"
else
  bad "连不上 ${BASE}（端口不对？容器没起？）"
fi

echo "[3/6] 课程与巡检"
S="$(curl -fsS --max-time 5 "${BASE}/status${Q}" 2>/dev/null)"
if [[ -n "$S" ]]; then
  echo "$S" | grep -o '"coursesCount":[0-9]*' | head -1 | sed 's/^/  /'
  echo "$S" | grep -o '"lastError":"[^"]*"' | head -1 | sed 's/^/  /'
  echo "$S" | grep -o '"lastMs":[0-9]*' | head -1 | sed 's/^/  单轮耗时 /'
  ok "/status 可读"
else
  bad "/status 读不到（看板令牌不对？）"
fi

echo "[4/6] 自检"
if docker exec ktp-checkin node /app/src/index.mjs --self-test >/tmp/ktp-selftest.log 2>&1; then
  tail -3 /tmp/ktp-selftest.log | sed 's/^/  /'
  ok "自检通过"
else
  tail -8 /tmp/ktp-selftest.log | sed 's/^/  /'
  bad "自检失败"
fi

echo "[5/6] 最近日志"
docker logs --tail 8 ktp-checkin 2>&1 | sed 's/^/  /'

echo "[6/6] 磁盘"
du -sh data 2>/dev/null | sed 's/^/  data 目录 /'
ls -la data/*.json 2>/dev/null | awk '{print "  "$5" B  "$9}'

hr
echo "看板：${BASE}/${Q}"
echo
