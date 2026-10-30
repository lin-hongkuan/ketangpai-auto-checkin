/**
 * 状态看板（单页 HTML，5 秒轮询 /status，倒计时每秒刷新）
 *
 * 纯手写 HTML/CSS/JS，无外部依赖、无 CDN、无字体文件 —— 断网也能正常显示。
 */

const CSS = `
:root{
  --bg:#080b11;--card:#11151e;--card-hi:#161b26;
  --line:rgba(255,255,255,.065);--line-hi:rgba(255,255,255,.11);
  --txt:#e9edf5;--txt2:#9aa4b8;--txt3:#5d6678;
  --ok:#3ddc84;--warn:#ffb020;--err:#ff5d5d;--info:#4d9fff;--purple:#b07cff;
  --ok-bg:rgba(61,220,132,.12);--warn-bg:rgba(255,176,32,.12);
  --err-bg:rgba(255,93,93,.12);--info-bg:rgba(77,159,255,.12);
  --r:14px;
}
*{box-sizing:border-box;-webkit-font-smoothing:antialiased}
html,body{margin:0;padding:0}
body{
  background:
    radial-gradient(900px 420px at 12% -8%,rgba(77,159,255,.10),transparent 62%),
    radial-gradient(760px 380px at 92% 0%,rgba(176,124,255,.075),transparent 60%),
    var(--bg);
  color:var(--txt);
  font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  min-height:100vh;
}
.wrap{max-width:1080px;margin:0 auto;padding:34px 22px 60px}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:26px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:38px;height:38px;border-radius:11px;flex:0 0 38px;background:linear-gradient(140deg,#4d9fff,#3ddc84);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px -6px rgba(77,159,255,.55)}
h1{font-size:17px;font-weight:650;margin:0;letter-spacing:.2px}
.meta{font-size:12.5px;color:var(--txt3);margin-top:2px;font-variant-numeric:tabular-nums}
.meta b{color:var(--txt2);font-weight:500}
.pill{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:600;border:1px solid var(--line-hi);background:var(--card)}
.dot{width:7px;height:7px;border-radius:50%;flex:0 0 7px}
.dot.live{background:var(--ok);animation:pulse 2.4s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(61,220,132,.45)}70%{box-shadow:0 0 0 7px rgba(61,220,132,0)}100%{box-shadow:0 0 0 0 rgba(61,220,132,0)}}
.pill.ok{color:var(--ok);border-color:rgba(61,220,132,.3);background:var(--ok-bg)}
.pill.warn{color:var(--warn);border-color:rgba(255,176,32,.3);background:var(--warn-bg)}
.pill.err{color:var(--err);border-color:rgba(255,93,93,.3);background:var(--err-bg)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:26px}
@media(max-width:720px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{position:relative;overflow:hidden;background:linear-gradient(180deg,var(--card-hi),var(--card));border:1px solid var(--line);border-radius:var(--r);padding:15px 16px 14px;transition:border-color .18s ease,transform .18s ease}
.stat:hover{border-color:var(--line-hi);transform:translateY(-1px)}
.stat .k{font-size:12px;color:var(--txt3);letter-spacing:.3px}
.stat .v{font-size:30px;font-weight:680;line-height:1.15;margin-top:5px;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.stat .s{font-size:11.5px;color:var(--txt3);margin-top:3px;font-variant-numeric:tabular-nums}
.stat.accent-warn .v{color:var(--warn)}
.stat.accent-ok .v{color:var(--ok)}
.stat.accent-info .v{color:var(--info)}
section{margin-bottom:26px}
.sec-head{display:flex;align-items:center;gap:9px;margin:0 0 11px 2px}
.sec-head h2{font-size:13px;font-weight:600;color:var(--txt2);margin:0;letter-spacing:.6px}
.count{font-size:11px;font-weight:600;padding:1px 7px;border-radius:6px;background:var(--card-hi);color:var(--txt3);border:1px solid var(--line)}
.sec-head .right{margin-left:auto;font-size:12px;color:var(--txt3)}
.todo{display:flex;align-items:center;gap:14px;background:linear-gradient(180deg,var(--card-hi),var(--card));border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:var(--r);padding:13px 16px;margin-bottom:9px;transition:border-color .18s ease}
.todo:hover{border-color:var(--line-hi)}
.todo.out{border-left-color:var(--info)}
.todo .body{flex:1;min-width:0}
.todo .t1{font-weight:600;font-size:13.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.todo .t2{font-size:12px;color:var(--txt3);margin-top:3px;font-variant-numeric:tabular-nums}
.badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;border:1px solid transparent;white-space:nowrap}
.b-warn{background:var(--warn-bg);color:var(--warn);border-color:rgba(255,176,32,.22)}
.b-ok{background:var(--ok-bg);color:var(--ok);border-color:rgba(61,220,132,.22)}
.b-err{background:var(--err-bg);color:var(--err);border-color:rgba(255,93,93,.22)}
.b-info{background:var(--info-bg);color:var(--info);border-color:rgba(77,159,255,.22)}
.b-dim{background:var(--card-hi);color:var(--txt3);border-color:var(--line)}
.timer{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.tablewrap{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:var(--card)}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11.5px;font-weight:600;color:var(--txt3);padding:10px 14px;background:rgba(255,255,255,.018);border-bottom:1px solid var(--line);letter-spacing:.4px;white-space:nowrap}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid var(--line);vertical-align:middle}
tr:last-child td{border-bottom:0}
tbody tr{transition:background .15s ease}
tbody tr:hover{background:rgba(255,255,255,.022)}
td.course{font-weight:500;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
td.time{color:var(--txt3);font-variant-numeric:tabular-nums;font-size:12.5px;white-space:nowrap}
.st{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:550;white-space:nowrap}
.st i{width:6px;height:6px;border-radius:50%;flex:0 0 6px;display:block}
.st-ok{color:var(--ok)}.st-ok i{background:var(--ok)}
.st-warn{color:var(--warn)}.st-warn i{background:var(--warn)}
.st-err{color:var(--err)}.st-err i{background:var(--err)}
.st-dim{color:var(--txt3)}.st-dim i{background:var(--txt3)}
.tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11.5px;background:var(--card-hi);color:var(--txt2);border:1px solid var(--line);white-space:nowrap}
.tag.gps{color:#6fb4ff;border-color:rgba(77,159,255,.22);background:var(--info-bg)}
.tag.digit{color:var(--warn);border-color:rgba(255,176,32,.22);background:var(--warn-bg)}
.tag.qr{color:var(--purple);border-color:rgba(176,124,255,.22);background:rgba(176,124,255,.1)}
.tag.io{color:#5ee0c8;border-color:rgba(94,224,200,.22);background:rgba(94,224,200,.1)}
.events{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:6px 16px;max-height:330px;overflow-y:auto}
.events::-webkit-scrollbar{width:6px}
.events::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px}
.ev{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px}
.ev:last-child{border-bottom:0}
.ev .t{color:var(--txt3);white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px;padding-top:1px}
.ev .m{color:var(--txt2);min-width:0}
.ev.success .m{color:#c9f5dd}
.ev.error .m{color:#ffc9c9}
.ev.warn .m{color:#ffe0a8}
.empty{text-align:center;padding:18px 20px;color:var(--txt3);font-size:13px;background:var(--card);border:1px dashed var(--line);border-radius:var(--r)}
.empty-line{display:flex;align-items:center;gap:9px;padding:13px 17px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);color:var(--txt3);font-size:13px}
.empty-line b{color:var(--ok);font-weight:600}
.empty .ico{font-size:22px;opacity:.45;display:block;margin-bottom:8px}
.setup{border:1px solid rgba(255,176,32,.28);background:var(--warn-bg);border-radius:var(--r);padding:16px 18px;margin-bottom:22px}
.setup h3{margin:0 0 8px;font-size:13.5px;color:var(--warn);font-weight:650}
.setup ol{margin:0;padding-left:19px;color:var(--txt2);font-size:13px;line-height:1.95}
.setup code{background:#0a0d13;border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:12px;color:#9ecbff}
.setup kbd{background:var(--card-hi);border:1px solid var(--line-hi);border-radius:5px;padding:0 6px;font-size:12px}
.codebar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--card);border:1px solid rgba(255,176,32,.25);border-radius:var(--r);padding:12px 16px;margin-top:10px}
.codebar .label{font-size:13px;color:var(--txt2)}
input.code{width:112px;padding:9px 12px;border-radius:9px;border:1px solid var(--line-hi);background:#0a0d13;color:var(--txt);letter-spacing:6px;text-align:center;font-size:16px;font-weight:600;outline:none;transition:border-color .15s}
input.code:focus{border-color:var(--warn)}
button{padding:9px 18px;border-radius:9px;border:1px solid rgba(255,176,32,.3);background:rgba(255,176,32,.14);color:var(--warn);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
button:hover{background:rgba(255,176,32,.22)}
button:active{transform:scale(.98)}
.msg{font-size:12.5px;color:var(--txt3)}
.msg.ok{color:var(--ok)}.msg.err{color:var(--err)}
footer{margin-top:34px;text-align:center;color:var(--txt3);font-size:11.5px;line-height:1.9}
footer a{color:var(--txt3);text-decoration:none;border-bottom:1px dotted var(--line-hi)}
`;

const JS = `
const TOKEN = __TOKEN__;
const q = TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '';
const TYPE_CLS = {'GPS考勤':'gps','数字考勤':'digit','扫码考勤':'qr','签入签出':'io'};
let S = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = (id) => document.getElementById(id);

function fmtClock(ts){
  if(!ts) return '—';
  try{ return new Date(ts*1000).toLocaleTimeString('zh-CN',{hour12:false}); }catch(e){ return '—'; }
}
function relTime(sec){
  const s = Math.abs(sec);
  if(s < 60) return s + ' 秒';
  if(s < 3600) return Math.floor(s/60) + ' 分';
  return Math.floor(s/3600) + ' 小时 ' + Math.floor((s%3600)/60) + ' 分';
}
async function jget(p){
  const r = await fetch(p + q, {cache:'no-store'});
  if(!r.ok) throw new Error(r.status);
  return r.json();
}

function renderStats(s){
  const st = s.today, list = s.pending || [];
  const waitIn = list.filter(p => p.phase === 'in').length;
  const waitOut = list.filter(p => p.phase === 'out').length;
  $('s-pending').textContent = list.length;
  $('s-pending-sub').textContent = list.length ? ('待签入 ' + waitIn + ' · 待签出 ' + waitOut) : '没有待办';
  $('s-signed').textContent = st.signed;
  $('s-out').textContent = st.signedOut || 0;
  $('s-out-sub').textContent = (st.checkoutMissed || 0) > 0 ? ('错过 ' + st.checkoutMissed + ' 次') : '今日签出';
  $('s-signed-card').className = 'stat' + (st.signed > 0 ? ' accent-ok' : '');
  $('s-out-card').className = 'stat' + ((st.signedOut || 0) > 0 ? ' accent-info' : '');
  $('s-rounds').textContent = st.rounds;
  $('s-rounds-sub').textContent = '单轮 ' + (s.poll.lastMs == null ? '-' : s.poll.lastMs) + ' ms';
  $('s-pending-card').className = 'stat' + (list.length ? ' accent-warn' : '');
}

function renderTodo(s){
  const box = $('todo-list');
  const list = s.pending || [];
  $('todo-count').textContent = list.length;
  if(!list.length){
    box.innerHTML = '<div class="empty-line"><b>✓</b> 当前没有待办，一切正常</div>';
  } else {
    box.innerHTML = list.map(function(p){
      const cls = TYPE_CLS[p.typeName] || '';
      const isOut = p.phase === 'out';
      const badge = isOut ? 'b-info' : (p.typeName === '数字考勤' ? 'b-warn' : (p.typeName === '扫码考勤' ? 'b-err' : 'b-warn'));
      const hint = isOut ? '等待签出窗口' : (p.typeName === '数字考勤' ? '需要 4 位签到码' : (p.typeName === '扫码考勤' ? '需要本人微信扫码' : '自动处理中'));
      return '<div class="todo' + (isOut ? ' out' : '') + '">' +
        '<div class="body">' +
          '<div class="t1">' + esc(p.course) + '<span class="tag ' + cls + '">' + esc(p.typeName) + '</span></div>' +
          '<div class="t2">' + esc(p.title || '考勤') + ' · ' + hint + '</div>' +
        '</div>' +
        '<span class="badge ' + badge + '">' + esc(p.status) + '</span>' +
      '</div>';
    }).join('');
  }
  const digit = list.find(function(p){ return p.typeName === '数字考勤'; });
  $('codebar').innerHTML = digit
    ? '<div class="codebar"><span class="label">' + esc(digit.course) + ' 签到码</span>' +
      '<input class="code" id="code" maxlength="4" inputmode="numeric" placeholder="0000" autocomplete="off"/>' +
      '<button type="button" onclick="submitCode()">提交</button><span class="msg" id="codeMsg"></span></div>'
    : '';
}

function renderRecent(s){
  const tb = $('recent-body');
  const list = s.recent || [];
  $('recent-count').textContent = list.length;
  if(!list.length){
    tb.innerHTML = '<tr><td colspan="5" class="empty" style="border:0">暂无记录</td></tr>';
    return;
  }
  tb.innerHTML = list.map(function(r){
    const cls = TYPE_CLS[r.typeName] || '';
    const io = r.typeName === '签入签出'
      ? ('入 ' + (r.checkinAt ? fmtClock(r.checkinAt) : '—') + ' / 出 ' + (r.checkoutAt ? fmtClock(r.checkoutAt) : '—'))
      : (r.signTime ? fmtClock(r.signTime) : '—');
    return '<tr>' +
      '<td class="course" title="' + esc(r.course) + '">' + esc(r.course) + '</td>' +
      '<td>' + esc(r.title || '考勤') + '</td>' +
      '<td><span class="tag ' + cls + '">' + esc(r.typeName) + '</span></td>' +
      '<td><span class="st st-' + (r.cls || 'dim') + '"><i></i>' + esc(r.status) + '</span></td>' +
      '<td class="time">' + esc(io) + '</td>' +
    '</tr>';
  }).join('');
}

function renderEvents(evs){
  const box = $('events');
  if(!evs.length){ box.innerHTML = '<div class="ev" style="justify-content:center;color:var(--txt3)">暂无事件</div>'; return; }
  box.innerHTML = evs.slice(0, 30).map(function(e){
    return '<div class="ev ' + esc(e.level) + '"><span class="t">' + esc((e.time || '').slice(11)) + '</span><span class="m">' + esc(e.message) + '</span></div>';
  }).join('');
}

function renderHead(s){
  const b = $('status-pill');
  const missing = s.token.missing, expired = s.token.expired;
  const ok = !missing && !expired && s.poll.lastOk;
  b.className = 'pill ' + (ok ? 'ok' : (missing || expired ? 'err' : 'warn'));
  $('status-dot').className = 'dot' + (ok ? ' live' : '');
  $('status-text').textContent = missing ? '待配置 token' : (expired ? 'token 失效' : (ok ? '运行正常' : '巡检异常'));
  $('setup').style.display = missing ? 'block' : 'none';
  $('meta-courses').textContent = s.coursesCount;
  $('meta-interval').textContent = s.pollIntervalSec;
  $('meta-version').textContent = 'v' + s.version;
  const upd = new Date(s.now);
  $('meta-updated').textContent = upd.toLocaleTimeString('zh-CN', {hour12:false});
}

async function refresh(){
  try{
    const s = await jget('/status');
    S = s;
    renderHead(s); renderStats(s); renderTodo(s); renderRecent(s);
    const evs = await jget('/events?since=0');
    renderEvents(evs.events || []);
  }catch(err){
    $('status-pill').className = 'pill err';
    $('status-dot').className = 'dot';
    $('status-text').textContent = '无法连接服务';
  }
}

async function submitCode(){
  const el = $('code'); const msg = $('codeMsg');
  if(!el || !msg) return;
  const code = el.value.trim();
  if(!/^[0-9]{4}$/.test(code)){ msg.className = 'msg err'; msg.textContent = '请输入 4 位数字'; return; }
  msg.className = 'msg'; msg.textContent = '提交中…';
  try{
    const r = await fetch('/code' + (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : ''), {
      method:'POST',
      headers:{'Content-Type':'application/json','X-Dashboard-Token':TOKEN},
      body: JSON.stringify({code: code})
    });
    const j = await r.json();
    msg.className = 'msg ' + (j.ok ? 'ok' : 'err');
    msg.textContent = j.ok ? ('✓ ' + (j.message || '补签成功')) : ('✗ ' + (j.message || '失败'));
    el.value = '';
    setTimeout(refresh, 800);
  }catch(e){ msg.className = 'msg err'; msg.textContent = '请求失败'; }
}

refresh();
setInterval(refresh, 5000);
`;


const BODY = `
<div class="wrap">
  <header>
    <div class="brand">
      <div class="logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#08111a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>
      </div>
      <div>
        <h1>课堂派自动签到</h1>
        <div class="meta">课程 <b id="meta-courses">-</b> 门 · 每 <b id="meta-interval">-</b> 秒巡检 · <b id="meta-version">-</b> · 更新于 <b id="meta-updated">-</b></div>
      </div>
    </div>
    <div class="pill warn" id="status-pill"><span class="dot" id="status-dot"></span><span id="status-text">连接中</span></div>
  </header>

  <div class="setup" id="setup" style="display:none">
    <h3>还没配置 token</h3>
    <ol>
      <li>浏览器登录 <code>w.ketangpai.com</code>，按 <kbd>F12</kbd> → Console，执行：<br/>
        <code>copy(localStorage.getItem('token') || localStorage.getItem('token_for_login'))</code></li>
      <li>写进 <code>data/config.json</code> 的 <code>token</code> 字段，约 30 秒热生效，不用重启</li>
      <li>或者改 <code>.env</code> 的 <code>KTP_TOKEN</code>，然后 <code>docker compose up -d</code></li>
    </ol>
  </div>

  <div class="stats">
    <div class="stat" id="s-pending-card">
      <div class="k">待办</div><div class="v" id="s-pending">-</div><div class="s" id="s-pending-sub">-</div>
    </div>
    <div class="stat accent-ok" id="s-signed-card">
      <div class="k">今日签入</div><div class="v" id="s-signed">-</div><div class="s">成功次数</div>
    </div>
    <div class="stat accent-info" id="s-out-card">
      <div class="k">今日签出</div><div class="v" id="s-out">-</div><div class="s" id="s-out-sub">-</div>
    </div>
    <div class="stat">
      <div class="k">今日巡检</div><div class="v" id="s-rounds">-</div><div class="s" id="s-rounds-sub">-</div>
    </div>
  </div>

  <section>
    <div class="sec-head"><h2>当前待办</h2><span class="count" id="todo-count">0</span></div>
    <div id="todo-list"></div>
    <div id="codebar"></div>
  </section>

  <section>
    <div class="sec-head"><h2>最近考勤</h2><span class="count" id="recent-count">0</span></div>
    <div class="tablewrap">
      <table>
        <thead><tr><th>课程</th><th>考勤</th><th>类型</th><th>状态</th><th>签入 / 签出</th></tr></thead>
        <tbody id="recent-body"><tr><td colspan="5" class="empty" style="border:0">加载中…</td></tr></tbody>
      </table>
    </div>
  </section>

  <section>
    <div class="sec-head"><h2>最近事件</h2></div>
    <div class="events" id="events"></div>
  </section>

  <footer>
    <a href="/healthz">/healthz</a> · <a href="/status">/status</a> · <a href="/events?since=0">/events</a><br/>
    每 5 秒自动刷新
  </footer>
</div>
`;

/**
 * @param {string} token 看板令牌，注入到前端脚本里
 */
export function dashboardHtml(token) {
  const js = JS.replace('__TOKEN__', JSON.stringify(token || ''));
  return '<!doctype html>\n<html lang="zh-CN"><head>' +
    '<meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<meta name="color-scheme" content="dark"/>' +
    '<title>课堂派自动签到 · 状态看板</title>' +
    '<style>' + CSS + '</style>' +
    '</head><body>' + BODY +
    '<script>' + js + '</script>' +
    '</body></html>';
}
