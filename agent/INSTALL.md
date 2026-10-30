# 给 AI Agent 的安装指令

> 你是被要求部署「课堂派自动签到」的 AI。本文档自包含，读完即可执行，不需要再问用户额外信息（除了 token）。
>
> 目标：在用户的服务器上把服务跑起来，验收通过，然后把访问方式和状态汇报给用户。

---

## 0. 你需要向用户确认的信息

只问这几项，一次问完：

1. **课堂派 token**（必需）
2. **服务器 SSH 地址与登录方式**（如果还没有权限）
3. （可选）**教室坐标** —— 用于 GPS 考勤。用户不知道就先跳过，服务会用零坐标兜底，但可能签不上。

如果用户已经给了 token，直接开工。

### token 怎么让用户拿

让用户在浏览器执行这三步，把结果发给你：

1. 打开 <https://w.ketangpai.com> 并登录
2. `F12` → **Console**
3. 粘贴并回车：

```js
copy(localStorage.getItem('token') || localStorage.getItem('token_for_login'))
```

token 已经复制到剪贴板，让用户粘给你。

> 如果用户打不开 F12（比如手机），退而求其次：让他在电脑浏览器登录后，从
> Application → Local Storage → `https://w.ketangpai.com` → `token` 里复制值。

---

## 1. 前置检查

在服务器上执行：

```bash
# Docker 是否可用
docker --version && docker compose version

# 端口占用情况（默认用 18080）
ss -lntp 2>/dev/null | grep -E ':(18080|8080) ' || echo "18080 空闲"
```

- 没有 Docker → 装：`curl -fsSL https://get.docker.com | sh`（Debian/Ubuntu）
- 当前用户没有 docker 权限 → `usermod -aG docker $USER && newgrp docker`
- 18080 被占用 → 换成 28080 / 38080，**后续所有命令里的端口保持一致**

---

## 2. 安装

```bash
git clone https://github.com/lin-hongkuan/ketangpai-auto-checkin.git /opt/ktp-autocheckin
cd /opt/ktp-autocheckin
cp .env.example .env
```

写入配置（把 `<TOKEN>` 换成用户给的 token，`<PORT>` 换成上一步选的端口）：

```bash
cat > /opt/ktp-autocheckin/.env <<'EOF'
KTP_TOKEN=<TOKEN>
DASHBOARD_TOKEN=<随机生成一个 24 位字符串>
POLL_INTERVAL=10
COURSE_REFRESH_SEC=300
DAILY_REPORT_HOUR=21
BIND_ADDR=127.0.0.1
BIND_PORT=<PORT>
EOF
```

生成随机看板令牌：

```bash
openssl rand -hex 12
```

> **不要把 token 写进任何会提交到 git 的文件**。`.env` 已经在 `.gitignore` 里。

启动：

```bash
cd /opt/ktp-autocheckin
docker compose up -d --build
```

首次构建约 30–60 秒。等 25 秒后检查：

```bash
docker ps --filter name=ktp-checkin --format '{{.Names}} {{.Status}}'
```

要看到 `(healthy)`。如果还是 `(health: starting)`，再等 20 秒。

---

## 3. 验收（必须逐条通过）

```bash
cd /opt/ktp-autocheckin
PORT=$(grep '^BIND_PORT=' .env | cut -d= -f2)
TOKEN=$(grep '^DASHBOARD_TOKEN=' .env | cut -d= -f2)
BASE="http://127.0.0.1:${PORT}"

# 1) 健康检查：ok 必须为 true
curl -s "${BASE}/healthz"

# 2) 版本号
curl -s "${BASE}/healthz" | grep -o '"version":"[^"]*"'

# 3) 课程数：应该等于用户账号下的课程数（不是 0）
curl -s "${BASE}/status?token=${TOKEN}" | grep -o '"coursesCount":[0-9]*'

# 4) 自检：最后一行必须是「自检全部通过」
docker exec ktp-checkin node /app/src/index.mjs --self-test | tail -20

# 5) 看板可访问
curl -s -o /dev/null -w '%{http_code}\n' "${BASE}/?token=${TOKEN}"
```

通过标准：

- [ ] `/healthz` 返回 `"ok":true`
- [ ] `coursesCount` ≥ 1
- [ ] `--self-test` 输出「自检全部通过」
- [ ] 看板返回 `200`

任何一条不过，看第 5 节排查。

---

## 4. 汇报给用户

用这个结构，简洁：

```
部署完成 ✅

看板：http://127.0.0.1:18080/?token=<TOKEN>
（服务器在远端的话，先执行：ssh -L 18080:127.0.0.1:18080 <用户>@<IP>）

状态：容器 healthy，巡检到 11 门课程，每 10 秒一轮
自检：全部通过

接下来：
1. 数字考勤有 4 位码时，直接发给我，或者在看板上填
2. 扫码考勤需要你自己微信扫，我会提醒你
3. 如果遇到 GPS 考勤，建议在 config.json 里填一下教室坐标（见下）
```

### 关于教室坐标

GPS 考勤如果老师开了电子围栏，没有真实坐标就签不上（或者签成"异常签到"，老师端不认）。

问用户要坐标，或者告诉他怎么拿：

> 手机打开高德/腾讯地图，长按教室位置，看详情里的经纬度（格式 `23.069389, 113.389922`）。

拿到后写进 `data/config.json`：

```json
{
  "latitude": "23.069389",
  "longitude": "113.389922",
  "coordsAreWgs84": false
}
```

- `coordsAreWgs84`：高德/腾讯地图拿到的是 **GCJ02**，填 `false`；从 Google Maps 或 GPS 设备拿到的是 WGS84，填 `true`
- 改完 **30 秒热生效**，不用重启

---

## 5. 排查

| 现象 | 处理 |
| --- | --- |
| 容器反复重启 | `docker compose logs --tail=50`，多半是 `.env` 格式错（等号两边不能有空格） |
| `/healthz` 返回 `tokenMissing: true` | token 没写进去，检查 `.env` 的 `KTP_TOKEN` |
| `/healthz` 返回 `tokenExpired: true` | token 过期，让用户重新拿一个，改 `.env` 后 `docker compose up -d` |
| `coursesCount` 是 0 | token 无效或账号没有课程，先 `curl /status` 看 `lastError` |
| 端口冲突 | 改 `.env` 的 `BIND_PORT`，`docker compose up -d` |
| 看板 401 | URL 里的 `token=` 和 `.env` 的 `DASHBOARD_TOKEN` 不一致 |

---

## 6. 绝对不要做的事

- ❌ 不要把 `KTP_TOKEN` 写进 README、issue、聊天记录以外的地方
- ❌ 不要 `docker compose down -v`（`-v` 会删掉 `data/` 卷）
- ❌ 不要改 `BIND_ADDR` 为 `0.0.0.0` 裸奔到公网（看板能看到用户的课程和考勤）
- ❌ 不要为了提高成功率去并发刷接口，会触发风控
- ❌ 不要替用户签别人的考勤（本项目只支持本人账号）

---

## 7. 常用命令

```bash
cd /opt/ktp-autocheckin
docker compose logs -f --tail=100            # 实时日志
docker exec ktp-checkin node /app/src/index.mjs --status   # 状态快照
docker exec ktp-checkin node /app/src/index.mjs --once     # 立刻巡检一轮
docker compose restart                       # 重启
docker compose up -d --build                 # 更新后重建
```

---

## 8. 事件流（可选，如果用户要主动通知）

服务不内置推送。如果用户想要微信/飞书/Telegram 通知，让他挑一个：

```bash
# 每 60 秒拉一次事件，推到你配置的 webhook
node integrations/webhook.mjs --interval 60
```

配置见 [`integrations/README.md`](../integrations/README.md)。

> ⚠️ 事件序号 `seq` 存在内存里，**容器重启后会从 1 重新计数**。轮询逻辑必须处理：
> 发现 `lastSeq` 小于本地游标时，改用 `since=0` 重读，否则会永远收不到新事件。
