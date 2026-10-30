#!/usr/bin/env bash
# 课堂派自动签到 · 一键安装
#
#   bash scripts/install.sh --token <KTP_TOKEN> [--port 18080] [--dir /opt/ktp-autocheckin]
#
# 装完会打印看板地址。重复执行等于「更新 + 重启」。
set -euo pipefail

REPO="https://github.com/lin-hongkuan/ketangpai-auto-checkin.git"
TOKEN=""
PORT="18080"
DIR="/opt/ktp-autocheckin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --port)  PORT="$2";  shift 2 ;;
    --dir)   DIR="$2";   shift 2 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
done

say() { printf '\033[1;36m%s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

# ── 环境检查 ────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "没装 Docker。先执行：curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || die "Docker Compose 插件不可用（需要 docker compose v2）"

if ! docker info >/dev/null 2>&1; then
  die "当前用户没有 docker 权限。执行：sudo usermod -aG docker \$USER && newgrp docker"
fi

if ss -lntp 2>/dev/null | grep -q ":${PORT} "; then
  die "端口 ${PORT} 已被占用，换一个：--port 28080"
fi

# ── 取代码 ──────────────────────────────────────────────────────────────────
if [[ -d "$DIR/.git" ]]; then
  say "更新已有代码：$DIR"
  git -C "$DIR" pull --ff-only
else
  say "克隆到 $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

# ── 配置 ────────────────────────────────────────────────────────────────────
if [[ -z "$TOKEN" ]]; then
  if [[ -f .env ]] && grep -q '^KTP_TOKEN=.\+' .env; then
    say "沿用已有 .env 里的 token"
  else
    die "缺少 token。用法：bash scripts/install.sh --token <你的token>"
  fi
else
  DASH="$(openssl rand -hex 12 2>/dev/null || head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > .env <<EOF
KTP_TOKEN=${TOKEN}
DASHBOARD_TOKEN=${DASH}
POLL_INTERVAL=10
COURSE_REFRESH_SEC=60
DAILY_REPORT_HOUR=21
BIND_ADDR=127.0.0.1
BIND_PORT=${PORT}
EOF
  chmod 600 .env
  say "已写入 .env（权限 600）"
fi

# ── 启动 ────────────────────────────────────────────────────────────────────
say "构建并启动…"
docker compose up -d --build

say "等待健康检查…"
for i in $(seq 1 30); do
  sleep 3
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' ktp-checkin 2>/dev/null || echo unknown)"
  [[ "$STATUS" == "healthy" ]] && break
done

PORT_NOW="$(grep '^BIND_PORT=' .env | cut -d= -f2)"
DASH_NOW="$(grep '^DASHBOARD_TOKEN=' .env | cut -d= -f2)"
BASE="http://127.0.0.1:${PORT_NOW}"

if curl -fsS "${BASE}/healthz" | grep -q '"ok":true'; then
  say "✅ 部署成功"
  echo
  echo "  看板：${BASE}/?token=${DASH_NOW}"
  echo "  远程访问：ssh -L ${PORT_NOW}:127.0.0.1:${PORT_NOW} <用户>@<服务器>"
  echo
  echo "  常用命令："
  echo "    docker compose logs -f --tail=100"
  echo "    docker exec ktp-checkin node /app/src/index.mjs --status"
  echo "    docker exec ktp-checkin node /app/src/index.mjs --self-test"
else
  echo
  die "❌ 健康检查未通过，执行 bash scripts/doctor.sh 排查"
fi
