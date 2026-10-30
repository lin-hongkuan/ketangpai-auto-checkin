<div align="center">

<img src="docs/banner.svg" width="900" alt="课堂派自动签到"/>

<br/>

<a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-3ddc84?style=flat-square"></a>
<img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2018-339933?style=flat-square&logo=node.js&logoColor=white">
<img alt="docker" src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white">
<img alt="dependencies" src="https://img.shields.io/badge/dependencies-0-4da3ff?style=flat-square">
<a href="agent/INSTALL.md"><img alt="agent" src="https://img.shields.io/badge/agent--ready-INSTALL.md-c084fc?style=flat-square"></a>
<a href="README.en.md"><img alt="english" src="https://img.shields.io/badge/README-English-8b93a7?style=flat-square"></a>

<br/><br/>

<b>每 10 秒巡检你账号下的全部课程，任何一门出现考勤就自动签上</b><br/>
GPS · 传统 · 数字 · 扫码提醒 · <b>签入签出两段全自动</b>

<br/><br/>

<a href="#-三分钟部署">部署</a> ·
<a href="agent/INSTALL.md">丢给 AI 装</a> ·
<a href="#-事件流">接入通知</a> ·
<a href="#-faq">FAQ</a>

</div>

---

## 为什么又一个

同类项目不少，这个的取舍不太一样：

| | 本项目 | 常见做法 |
| --- | --- | --- |
| **签入签出考勤** | 签入、签出**两段都自动做** | 只签入，签出靠人（一节课白签） |
| **部署** | 模块化但**零依赖**，`node` 直接跑，无 npm install | 一堆 npm 包 + Python 环境 + 配置文件 |
| **通知** | HTTP 事件流，**任何东西都能接** | 写死 Telegram / 企业微信机器人 |
| **交给 AI** | 有专门的 [安装指令](agent/INSTALL.md)，AI 能自己读完装好 | 只能人照着 README 一步步敲 |
| **数字考勤** | 看板填 4 位码即补签 | 需要另外写脚本 |

> 「签入签出」是课堂派最容易漏的一种考勤：上课签入、下课签出，**同一条考勤要提交两次**。
> 签入成功后它就从「待签到」列表里消失了，绝大多数工具到这一步就收工 —— 于是你只有签入记录，没有签出记录。
> 本项目单独盯着签出阶段（窗口通常只有几十秒），两段都补上。

---

## 它能做什么

- 🔁 **全课程巡检** —— 每 10 秒扫一遍账号下所有课程，新加入的课 5 分钟内自动纳入
- ✅ **自动签到** —— GPS / 传统 / 签入签出，多层兜底策略 + 提交后强制复核，不轻信接口返回的"成功"
- 🔢 **数字考勤** —— 看板填 4 位码即可补签，也可以调 `/code` 接口让 AI 代填
- 📱 **扫码考勤** —— 只能提醒（需要本人微信扫码），但会立刻告诉你哪门课
- 📊 **状态看板** —— 每条考勤的签入/签出状态、时间、结果一目了然
- 📡 **事件流** —— `GET /events` 增量拉取，交给任意 agent / webhook / 脚本消费
- 🪶 **零依赖** —— 只有 Node 标准库，没有 `node_modules`

<div align="center">
  <img src="docs/dashboard.png" width="880" alt="状态看板"/>
  <br/>
  <sub>看板：待办区分「待签入 / 待签出」，最近考勤逐条显示两段状态</sub>
</div>

---

## 🚀 三分钟部署

### 方式一：丢给你的 AI（最省事）

把下面这段话发给任何一个**能操作服务器**的 AI —— Claude Code、Cursor、Hermes、OpenClaw、通义灵码都行：

```text
帮我部署课堂派自动签到。
请阅读 https://github.com/lin-hongkuan/ketangpai-auto-checkin/blob/main/agent/INSTALL.md
按里面的步骤在服务器上装好并验收。

我的课堂派 token 是：<在这里粘贴你的 token>
服务器信息：<用户>@<IP>，端口 <SSH 端口>
```

AI 会自己完成：环境检查 → 选端口 → 拉代码 → 配置 → 启动 → 验收 → 把看板地址告诉你。

**token 怎么拿**（30 秒）：

1. 浏览器打开 <https://w.ketangpai.com> 并登录
2. 按 `F12` → 切到 **Console**
3. 粘贴执行：

   ```js
   copy(localStorage.getItem('token') || localStorage.getItem('token_for_login'))
   ```

4. token 已经在剪贴板里了，直接粘给 AI

> 浏览器可能会提示"不要粘贴未知代码"。这是你自己输入的，确认即可。
> token 等同于你的登录态，**只发给你信任的 AI**。

### 方式二：Docker（自己动手）

```bash
git clone https://github.com/lin-hongkuan/ketangpai-auto-checkin.git
cd ketangpai-auto-checkin
cp .env.example .env
vi .env                      # 填 KTP_TOKEN，其它可不动
docker compose up -d --build
docker ps                    # 约 20 秒后 STATUS 显示 (healthy)
curl -s 127.0.0.1:18080/healthz
```

### 方式三：裸 Node（没有 Docker）

```bash
git clone https://github.com/lin-hongkuan/ketangpai-auto-checkin.git
cd ketangpai-auto-checkin
KTP_TOKEN=<你的token> DATA_DIR=./data PORT=18080 node src/index.mjs
```

只要有 Node 18+，不需要 `npm install`。

---

## 看板

默认只监听 `127.0.0.1`，从本机看：

```
http://127.0.0.1:18080/?token=<DASHBOARD_TOKEN>
```

服务器上的话用 SSH 隧道：

```bash
ssh -L 18080:127.0.0.1:18080 <用户>@<服务器>
# 然后本地浏览器打开 http://127.0.0.1:18080/?token=<DASHBOARD_TOKEN>
```

第一次打开如果还没配 token，看板会直接告诉你三步怎么配：

<div align="center">
  <img src="docs/setup-guide.png" width="760" alt="未配置 token 时的引导"/>
</div>

---

## 配置

### 环境变量（`.env`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KTP_TOKEN` | — | **必填**，课堂派登录 token |
| `DASHBOARD_TOKEN` | 空 | 看板访问令牌，留空则不校验。公网暴露时必须设 |
| `POLL_INTERVAL` | `10` | 巡检间隔（秒） |
| `COURSE_REFRESH_SEC` | `60` | 课程列表刷新间隔（秒），新加入的课最迟这么久后纳入 |
| `DAILY_REPORT_HOUR` | `21` | 每日汇总事件的整点，`0` 关闭 |
| `BIND_ADDR` / `BIND_PORT` | `127.0.0.1` / `18080` | 宿主机监听地址与端口 |

### `data/config.json`（热加载，改完 30 秒生效）

```json
{
  "token": "课堂派 token",
  "courseIds": [],
  "excludeCourseIds": [],
  "digitCode": "",
  "latitude": "23.069389",
  "longitude": "113.389922",
  "coordsAreWgs84": false,
  "requireGpsCoords": false,
  "courseRefreshSec": 300,
  "dailyReportHour": 21
}
```

| 字段 | 说明 |
| --- | --- |
| `courseIds` | 非空时**只**巡检这些课程；留空 = 全部课程 |
| `excludeCourseIds` | 排除已结课的课程 |
| `latitude` / `longitude` | 教室坐标，GPS 考勤用（见下） |
| `coordsAreWgs84` | 坐标是否为 WGS84。高德/腾讯地图拿到的是 **GCJ02**，填 `false`；Google Maps / GPS 设备是 WGS84，填 `true` |
| `requireGpsCoords` | `true` = 严格模式：GPS 考勤没有坐标就放弃，绝不制造假成功。默认 `false`（允许零坐标兜底） |
| `digitCode` | 数字考勤的 4 位码，填了会自动签，不用等人工 |

### GPS 考勤与坐标

课堂派的 GPS 考勤可能绑了电子围栏。**坐标填得对，签到才真的算数**。

提交优先级：

```
真实坐标（配置的） → 空坐标 → 零坐标 0.00000000
```

零坐标是最后的兜底。它在老师**没开围栏**时也能签上（老师端会显示"定位未开启"），但一旦开了围栏，就会出现「学生端显示出勤、老师端统计不认」的情况 —— 所以能配坐标就别省这一步。

**怎么拿坐标**：手机打开高德/腾讯地图，长按教室位置，详情里的经纬度就是，格式 `23.069389, 113.389922`。

填进去，`coordsAreWgs84` 填 `false`（因为高德/腾讯是 GCJ02），30 秒热生效。

> 如果你用 Chrome DevTools 的 Sensors 面板模拟过定位，那里显示的经纬度是 WGS84，直接填并设 `coordsAreWgs84: true` 即可。

> 改 `token` 不用重启，30 秒内热生效。

---

## HTTP 接口

| 路径 | 说明 |
| --- | --- |
| `GET /` | 状态看板（HTML，5 秒自动刷新） |
| `GET /healthz` | `200` 正常；`503` = token 未配置/失效，或轮询停滞（Docker HEALTHCHECK 依据） |
| `GET /status` | 完整 JSON 快照：课程、待办、最近 20 条考勤、今日统计 |
| `GET /events?since=N` | 增量事件流，`seq` 单调递增 |
| `POST /code` | `{"code":"1234"}` 给当前数字考勤补签 |
| `POST /poll` | 立即触发一轮巡检（`?refresh=1` 同时刷新课程列表） |

---

## 📡 事件流

服务**不内置任何推送渠道**。所有状态变化写进 `/events`，你用自己的方式消费：

```bash
curl -s 'http://127.0.0.1:18080/events?since=0&token=xxx'
```

```json
{
  "ok": true,
  "events": [
    { "seq": 12, "time": "2026-10-30 15:14:39", "level": "success",
      "type": "signed", "message": "签入成功：数据结构｜2026.10.30（签入签出），等待签出阶段" }
  ],
  "lastSeq": 12
}
```

把 `lastSeq` 存下来，下次作为 `since` 传回去。

### 事件类型

| type | level | 含义 |
| --- | --- | --- |
| `detected` | info | 检测到考勤（同一考勤 10 分钟内只记一次） |
| `signed` | success | 签入成功 |
| `checkout_signed` | success | 签出成功（签入签出的第二段） |
| `checkout_waiting` | info | 已签入，等签出窗口开放（正常过程，一般不用转发） |
| `checkout_failed` | error | 签出失败，会自动重试 |
| `checkout_missed` | warn | 签出窗口已关仍未签出，需要人工 |
| `failed` | error | 签到失败 |
| `need_code` | warn | 数字考勤缺码 |
| `need_scan` | warn | 扫码考勤，需本人扫码 |
| `token_expired` | error | token 失效 |
| `sign_stuck` | error | 同一考勤连续失败 ≥3 轮，需要人工介入 |
| `daily_report` | info | 每日汇总 |
| `poll_error` | warn | 巡检异常 |
| `course_added` / `course_removed` | info | 课程纳入/退出巡检 |

### 现成的接法

| 场景 | 用什么 |
| --- | --- |
| 有 Hermes / 定时任务 | [`integrations/hermes.py`](integrations/hermes.py) —— 带重启安全游标和失败重试 |
| 想推到 Telegram / 飞书 / 钉钉 / 企业微信 | [`integrations/webhook.mjs`](integrations/webhook.mjs) —— 填一个 webhook 地址就行 |
| 自己写 | 见上面的接口，60 秒轮询一次即可 |

> ⚠️ 服务的事件序号 `seq` 存在内存里，**容器重启后会从 1 重新计数**。
> 你的轮询逻辑必须处理这种情况：发现返回的 `lastSeq` 小于本地游标时，改用 `since=0` 重读，否则会永远收不到新事件。
> 仓库里的两个集成脚本都已经处理了这一点。

---

## 代码结构

```
src/
├─ index.mjs      入口：CLI、初始化、自检
├─ config.mjs     配置加载与合并（环境变量 + config.json 热加载）
├─ store.mjs      运行时状态与持久化（写盘节流）
├─ logger.mjs     日志（异步写盘，不阻塞事件循环）
├─ api.mjs        课堂派接口封装（重试、错误分类）
├─ attence.mjs    考勤判定与提交策略（纯函数，可自检）
├─ scanner.mjs    课程扫描（带缓存，控制请求量）
├─ signer.mjs     提交与复核
├─ poller.mjs     巡检主循环
├─ events.mjs     事件流与限流
├─ server.mjs     HTTP 路由
└─ dashboard.mjs  看板页面
```

几个刻意的取舍：

| 决策 | 原因 |
| --- | --- |
| 判定逻辑全放 `attence.mjs`，纯函数 | 不联网就能测，`--self-test` 覆盖 20+ 用例 |
| 冷课程的历史记录走 60 秒缓存 | 11 门课从 22 请求/轮降到约 12 请求/轮 |
| `state.json` 写盘节流 1.5 秒 | 一轮巡检里可能连着标记好几次，合并成一次 |
| 日志用 `createWriteStream` 异步写 | `appendFileSync` 在高频巡检时会阻塞事件循环 |
| 零依赖，只用 Node 标准库 | 镜像 ~50MB，内存约 60MB，树莓派也能跑 |

---

## 架构

```
  每 10 秒
     │
     ▼
┌─────────────┐   课程列表    ┌──────────────┐   待签到    ┌─────────────┐
│   poller    │──────────────▶│  课堂派 API  │────────────▶│  提交签到   │
│ (src/*.mjs) │               │ openapiv5    │             │ 多层兜底    │
└──────┬──────┘               └──────────────┘             └──────┬──────┘
       │                            ▲                            │
       │  待签出（已签入未签出）      │  复核 resultCheckoutTime    │
       └────────────────────────────┴────────────────────────────┘
       │
       ▼
┌──────────────────────────────┐        ┌──────────────────────┐
│  HTTP :8080                  │        │  你的集成             │
│  /  /healthz  /status        │◀───────│  轮询 /events         │
│  /events  /code  /poll       │        │  → 消息 / 告警        │
└──────────────────────────────┘        └──────────────────────┘
```

---

## 运维

```bash
docker compose ps
docker compose logs -f --tail=100
docker exec ktp-checkin node /app/src/index.mjs --status     # 打印状态 JSON
docker exec ktp-checkin node /app/src/index.mjs --once       # 立刻跑一轮
docker exec ktp-checkin node /app/src/index.mjs --self-test  # 自检（不联网）
docker compose restart
```

**token 过期了**：重新按[上面的步骤](#方式一丢给你的-ai最省事)拿一个，写进 `data/config.json` 的 `token`，30 秒热生效，不用重启。

---

## FAQ

<details>
<summary><b>token 多久过期？</b></summary>

课堂派的 token 没有固定有效期，通常几周到几个月，退出登录会立即失效。
失效时 `/healthz` 返回 503 并产生 `token_expired` 事件，换一个就行。
</details>

<details>
<summary><b>会被学校发现吗？</b></summary>

服务调用的是课堂派官方 Web 端接口，与你自己点「签到」没有本质区别，不会伪造位置之外的任何身份信息。
但**自动化操作可能违反学校规定**，风险由你自行承担。项目不做多账号代签、不绕过身份验证。
</details>

<details>
<summary><b>需要一直开着电脑吗？</b></summary>

需要一台一直在线的机器。最省事的是云服务器（1 核 1G 足够，占用约 60MB 内存），
也可以树莓派、家里的小主机、NAS。
</details>

<details>
<summary><b>支持多账号吗？</b></summary>

不支持，也**不打算支持**。这是给本人用的工具，不是代签服务。
需要多个账号就起多个容器，改 `BIND_PORT` 和 `DATA_DIR` 即可。
</details>

<details>
<summary><b>数字考勤的码怎么自动填？</b></summary>

两个办法：看板上直接填（4 位数字），或者把码发给你的 AI 让它调
`POST /code {"code":"1234"}`。
也可以在 `config.json` 的 `digitCode` 里预先填好 —— 但考勤码每次都不一样，一般用不上。
</details>

<details>
<summary><b>扫码考勤为什么不能自动签？</b></summary>

二维码在老师的大屏上，且带时效签名，必须本人微信扫码。服务会立刻发 `need_scan` 事件提醒你。
</details>

<details>
<summary><b>看板能不能公网访问？</b></summary>

可以，但**必须**：反向代理 + HTTPS + 设置 `DASHBOARD_TOKEN`。
不要直接把 `BIND_ADDR` 改成 `0.0.0.0` 裸奔 —— 看板能看到你的课程和考勤记录。
</details>

<details>
<summary><b>为什么不做成网页版 / 小程序？</b></summary>

签到需要在服务端持续轮询，网页关掉就停了。这个项目的定位是「装一次，忘掉它」。
</details>

---

## 参与

- 遇到问题先看 [FAQ](#-faq) 和 [Issues](https://github.com/lin-hongkuan/ketangpai-auto-checkin/issues)
- 提 Bug 请附上 `node src/index.mjs --self-test` 输出和 `/status` 的脱敏片段
- 接口变动导致签到失败，欢迎直接提 PR

如果这个项目帮你省下了几次课间狂奔，点个 ⭐ 就是最好的支持。

---

## 免责声明

本项目仅供**学习与技术研究**，用于自动化操作**你本人的账号**。

- 不提供、不鼓励任何形式的代签、多账号签到、绕过身份验证
- 使用前请确认所在学校与课程允许此类自动化
- 因使用本项目导致的考勤异常、账号风控、纪律处分等后果，由使用者自行承担
- 项目作者不对课堂派接口的可用性、稳定性作任何保证

如果你不希望自己的考勤被自动化，请不要使用本项目。

---

<div align="center">
<sub>MIT License · 用 Node 写的一个小工具</sub>
</div>
