#!/usr/bin/env python3
"""
Hermes 事件桥：重启安全的游标 + 失败重试的通知 outbox。

这是给 Hermes 用的参考实现。核心是两件事：
  1. 服务重启后 seq 会从 1 重计，必须检测到 lastSeq < cursor 时回到 0 重读
  2. 消息发送失败要留在 pending 里，下次继续尝试，不能丢
"""
import datetime as dt
import json
import os
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

APP = Path(os.environ.get('KTP_APP', '/opt/ktp-autocheckin'))
ENV = APP / '.env'
CURSOR = APP / '.hermes-cursor'
STATE = APP / '.hermes-notify-state.json'
JOBS = Path('/root/.hermes/cron/jobs.json')
JOB_ID = os.environ.get('HERMES_JOB_ID', '94cd31251052')
ACTIONABLE = {'token_expired', 'need_code', 'need_scan', 'failed', 'sign_stuck',
              'signed', 'sign_retry', 'course_added', 'course_removed',
              'course_skipped', 'daily_report', 'poll_error',
              # v1.3.0：签入签出考勤的第二段（checkout_waiting 属正常过程，不转发）
              'checkout_signed', 'checkout_failed', 'checkout_missed'}


def env_value(name):
    try:
        prefix = name + '='
        for line in ENV.read_text().splitlines():
            if line.startswith(prefix):
                return line[len(prefix):].strip().strip('"').strip("'")
    except OSError:
        pass
    return ''


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def atomic_json(path, value):
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, separators=(',', ':'))
            stream.write('\n')
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def parse_time(value):
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (AttributeError, ValueError, TypeError):
        return 0.0


def previous_job():
    try:
        jobs = json.loads(JOBS.read_text()).get('jobs', [])
        return next(item for item in jobs if item.get('id') == JOB_ID)
    except (OSError, ValueError, StopIteration):
        return {}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


port = env_value('BIND_PORT') or '18080'
token = env_value('DASHBOARD_TOKEN')
if not token:
    raise SystemExit(0)

state = load_json(STATE, {})
try:
    cursor = int(state.get('cursor', CURSOR.read_text().strip() or 0))
except (OSError, ValueError, TypeError):
    cursor = 0
pending = state.get('pending') or []
emitted_at = state.get('emitted_at')
job = previous_job()

# Retire an emitted batch only after a newer scheduled run confirms successful
# delivery. A failed or stale delivery record keeps the events queued.
if pending and emitted_at:
    if parse_time(job.get('last_run_at')) > parse_time(emitted_at) and not job.get('last_delivery_error'):
        pending = []
        emitted_at = None

try:
    query = urllib.parse.urlencode({'since': cursor, 'token': token})
    endpoint = f'http://127.0.0.1:{port}/events?{query}'
    with urllib.request.urlopen(endpoint, timeout=5) as response:
        data = json.loads(response.read())
    server_last = int(data.get('lastSeq', cursor))
    # The app uses an in-memory seq that resets at container restart. Detect a
    # lower server seq and replay the new process's event history from zero.
    if server_last < cursor:
        query = urllib.parse.urlencode({'since': 0, 'token': token})
        endpoint = f'http://127.0.0.1:{port}/events?{query}'
        with urllib.request.urlopen(endpoint, timeout=5) as response:
            data = json.loads(response.read())
        cursor = 0
except Exception:
    raise SystemExit(0)

known = {int(event.get('seq', -1)) for event in pending}
for event in data.get('events') or []:
    seq = int(event.get('seq', -1))
    if seq not in known and event.get('type') in ACTIONABLE:
        pending.append(event)
        known.add(seq)

last_seq = max(cursor, int(data.get('lastSeq', cursor)))
CURSOR.write_text(str(last_seq))

urgent, routine, other = [], [], []
for event in pending:
    kind = event.get('type', '')
    message = f"{event.get('time', '')} {event.get('message', '')}".strip()
    if kind in {'token_expired', 'need_code', 'need_scan', 'failed', 'sign_stuck', 'checkout_failed'}:
        urgent.append(message)
    elif kind in {'signed', 'sign_retry', 'checkout_signed'}:
        routine.append(message)
    else:
        other.append(message)

lines = []
if job.get('last_delivery_error'):
    lines.append('课堂派签到通知补发：上一次消息未成功送达，正在重试。')
if urgent:
    lines.append('课堂派签到紧急通知：')
    lines.extend(urgent[-10:])
if routine:
    lines.append('课堂派自动签到：' + '；'.join(routine[-10:]))
if other:
    lines.append('课堂派签到状态：')
    lines.extend(other[-10:])

if lines:
    emitted_at = now_iso()
atomic_json(STATE, {'cursor': last_seq, 'pending': pending[-50:], 'emitted_at': emitted_at})
if lines:
    print('\n'.join(lines))
