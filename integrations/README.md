# 集成

服务本身**不内置任何推送渠道**。所有状态变化都在 `GET /events` 里，你用下面的方式消费。

## 现成的两个

### 1. `webhook.mjs` —— 推到 IM（推荐）

零依赖，支持 Telegram / 飞书 / 钉钉 / 企业微信 / 任意 HTTP 端点。

```bash
# 飞书
KTP_WEBHOOK_TYPE=feishu \
KTP_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/xxxx' \
node integrations/webhook.mjs

# Telegram
KTP_WEBHOOK_TYPE=telegram \
KTP_TG_BOT_TOKEN='123:ABC' \
KTP_TG_CHAT_ID='12345678' \
node integrations/webhook.mjs
```

| 变量 | 说明 |
| --- | --- |
| `KTP_BASE` | 服务地址，默认 `http://127.0.0.1:18080` |
| `KTP_DASHBOARD_TOKEN` | 服务设了看板令牌就填 |
| `KTP_WEBHOOK_TYPE` | `telegram` / `feishu` / `dingtalk` / `wecom` / `generic` |
| `KTP_WEBHOOK_URL` | 机器人地址（telegram 不用） |
| `KTP_INTERVAL` | 轮询秒数，默认 60 |
| `KTP_CURSOR_FILE` | 游标文件，默认 `./data/.webhook-cursor` |

紧急事件（`need_code` / `failed` / `sign_stuck` 等）单独成条并带 🔴 前缀，普通事件合并成一条。

### 2. `hermes.py` —— Hermes / 定时任务

带**重启安全的游标**和**失败重试的 outbox**：消息没送达会留在 pending 里，下次继续发。

```bash
KTP_APP=/opt/ktp-autocheckin python3 integrations/hermes.py
```

适合挂 cron：

```cron
* * * * * KTP_APP=/opt/ktp-autocheckin /usr/bin/python3 /opt/ktp-autocheckin/integrations/hermes.py
```

## 自己写

```bash
curl -s 'http://127.0.0.1:18080/events?since=0&token=xxx'
```

```json
{ "ok": true, "events": [ ... ], "lastSeq": 12 }
```

把 `lastSeq` 存下来，下次作为 `since` 传回去。

### ⚠️ 必须处理的一个坑

服务的 `seq` 存在内存里，**容器重启后会从 1 重新计数**。

如果你拿旧游标（比如 137）去请求，而新进程的 `lastSeq` 只有 5，你会**永远收不到任何新事件** —— 表现是"签到成功了但没通知"，而且不报错。

正确处理：

```js
const data = await get(`/events?since=${cursor}`);
if (data.lastSeq < cursor) {      // 服务重启过，序号回退了
  cursor = 0;
  data = await get('/events?since=0');
}
```

仓库里的两个脚本都已经处理了这一点。

### 事件类型

| type | level | 建议 |
| --- | --- | --- |
| `signed` | success | 汇总转发「已自动签到：课程A、课程B」 |
| `checkout_signed` | success | 并入上一条：「已签入并签出：课程A」 |
| `need_code` | warn | **立即**转告：哪门课要 4 位码 |
| `need_scan` | warn | **立即**转告：需要本人微信扫码 |
| `need_gps` | warn | **立即**转告：GPS 考勤缺坐标，需要配教室位置 |
| `failed` | error | **立即**转告：签到失败 + 原因 |
| `checkout_failed` | error | **立即**转告：签出失败（会自动重试） |
| `checkout_missed` | warn | 转告一次：签出窗口关了，可能要找老师补录 |
| `sign_stuck` | error | **立即**：连续 3 轮失败，需要人工介入 |
| `token_expired` | error | **立即**：token 失效，教用户换一个 |
| `checkout_waiting` | info | **忽略**（已签入、等签出，正常过程） |
| `detected` | info | **忽略**（后面会跟 signed/failed） |
| `daily_report` | info | 每天转发一次 |
| `poll_error` | warn | 连续出现才提醒 |
| `course_added` / `course_removed` / `course_skipped` | info | 汇总或忽略 |
