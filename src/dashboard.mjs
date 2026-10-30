/**
 * 状态看板（单页 HTML，5 秒轮询 /status）
 */

export function dashboardHtml(token) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>课堂派自动签到 · 状态看板</title>
<style>
:root{--bg:#0f1117;--card:#171a23;--line:#262b38;--txt:#e6e9ef;--dim:#8b93a7;--ok:#3ddc84;--warn:#ffb020;--err:#ff5c5c;--info:#4da3ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px}
h1{font-size:20px;margin:0 0 4px;display:flex;align-items:center;gap:10px}
.sub{color:var(--dim);font-size:12px;margin-bottom:20px}
.badge{padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.b-ok{background:rgba(61,220,132,.15);color:var(--ok)}
.b-bad{background:rgba(255,92,92,.15);color:var(--err)}
.b-warn{background:rgba(255,176,32,.15);color:var(--warn)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card .k{color:var(--dim);font-size:12px}
.card .v{font-size:24px;font-weight:700;margin-top:2px}
.card .v small{font-size:12px;color:var(--dim);font-weight:400}
h2{font-size:14px;color:var(--dim);margin:22px 0 10px;font-weight:600;letter-spacing:.5px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);font-size:13px}
th{color:var(--dim);font-weight:500;background:#1b1f29}
tr:last-child td{border-bottom:0}
.tag{display:inline-block;padding:1px 8px;border-radius:6px;font-size:12px;background:#222839;color:var(--dim)}
.tag.gps{color:#4da3ff}.tag.digit{color:#ffb020}.tag.qr{color:#c084fc}
.st{font-weight:600;font-size:12px}
.st-ok{color:var(--ok)}.st-warn{color:var(--warn)}.st-err{color:var(--err)}.st-dim{color:var(--dim)}
.ev{display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:13px}
.ev:last-child{border-bottom:0}
.ev .t{color:var(--dim);white-space:nowrap;font-variant-numeric:tabular-nums}
.ev .l{width:8px;height:8px;border-radius:50%;margin-top:8px;flex:0 0 8px}
.lv-info{background:var(--info)}.lv-success{background:var(--ok)}.lv-warn{background:var(--warn)}.lv-error{background:var(--err)}
form.code{display:flex;gap:8px;align-items:center;margin-top:10px}
input,button{font:inherit}
input.code{width:120px;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:#11141b;color:var(--txt);letter-spacing:4px;text-align:center;font-size:16px}
button{padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:#222839;color:var(--txt);cursor:pointer}
button:hover{background:#2b3245}
.muted{color:var(--dim)}
.card.setup{border-color:rgba(255,176,32,.45);background:rgba(255,176,32,.07);margin-bottom:18px}
.setup-t{font-weight:700;color:var(--warn);margin-bottom:6px}
.card.setup ol{margin:0;padding-left:20px;color:var(--txt)}
.card.setup li{margin:6px 0;font-size:13px;line-height:1.8}
.card.setup code{background:#11141b;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}
.card.setup kbd{background:#222839;border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:12px}
.footer{margin-top:24px;color:#596077;font-size:12px}
</style></head>
<body><div class="wrap">
<h1>课堂派自动签到 <span id="badge" class="badge b-warn">连接中</span></h1>
<div class="sub">自动巡检全部课程 · 每 <span id="interval">-</span> 秒一轮 · 课程 <span id="courses">-</span> 门（刷新于 <span id="crs">-</span>）· 数据 <span id="upd">-</span></div>

<div id="setupTip" class="card setup" style="display:none">
  <div class="setup-t">还没配置 token</div>
  <ol>
    <li>浏览器登录 <code>w.ketangpai.com</code>，按 <kbd>F12</kbd> → <b>Console</b>，执行：<br/>
      <code>copy(localStorage.getItem('token') || localStorage.getItem('token_for_login'))</code></li>
    <li>把复制的 token 写进容器挂载的 <code>data/config.json</code> 的 <code>token</code> 字段（约 30 秒热生效，不用重启）</li>
    <li>或者直接改 <code>.env</code> 里的 <code>KTP_TOKEN</code>，然后 <code>docker compose up -d</code></li>
  </ol>
</div>

<div class="grid">
  <div class="card"><div class="k">待办</div><div class="v" id="pending">-</div></div>
  <div class="card"><div class="k">今日巡检</div><div class="v" id="rounds">-</div></div>
  <div class="card"><div class="k">今日检测到</div><div class="v" id="detected">-</div></div>
  <div class="card"><div class="k">今日签入成功</div><div class="v" id="signed">-</div></div>
  <div class="card"><div class="k">今日签出成功</div><div class="v" id="signedOut">-</div></div>
  <div class="card"><div class="k">最近一轮耗时</div><div class="v" id="ms">-<small> ms</small></div></div>
</div>

<h2>当前待办</h2>
<table><thead><tr><th>课程</th><th>考勤</th><th>类型</th><th>状态</th><th>操作</th></tr></thead>
<tbody id="pendingBody"><tr><td colspan="5" class="muted">加载中…</td></tr></tbody></table>
<div id="codeBox"></div>

<h2>最近考勤</h2>
<table><thead><tr><th>课程</th><th>考勤</th><th>类型</th><th>状态</th><th>签入 / 签出</th></tr></thead>
<tbody id="recentBody"><tr><td colspan="5" class="muted">加载中…</td></tr></tbody></table>

<h2>最近事件</h2>
<div class="card" id="events" style="padding:6px 16px"></div>

<div class="footer">API：<code>/status</code> · <code>/events?since=</code> · <code>/healthz</code><br/>刷新间隔 5 秒</div>
</div>
<script>
const TOKEN = ${JSON.stringify(token)};
const q = TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '';
const TYPE_CLS = {GPS考勤:'gps',数字考勤:'digit',扫码考勤:'qr'};
let lastSeq = 0;
function fmtTime(ts){ if(!ts) return '—'; try{ return new Date(ts*1000).toLocaleTimeString('zh-CN',{hour12:false}); }catch(e){ return '—'; } }
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
async function jget(p){const r=await fetch(p+q);if(!r.ok)throw new Error(r.status);return r.json();}
async function refresh(){
  try{
    const s = await jget('/status');
    const healthy = !s.token.expired && !s.token.missing && s.poll.lastOk;
    const b = document.getElementById('badge');
    b.className = 'badge ' + (healthy?'b-ok':(s.token.expired?'b-bad':'b-warn'));
    b.textContent = s.token.missing ? '待配置 token' : (s.token.expired ? 'token 失效' : (healthy?'运行正常':'巡检异常'));
    document.getElementById('setupTip').style.display = s.token.missing ? 'block' : 'none';
    document.getElementById('interval').textContent = s.pollIntervalSec;
    document.getElementById('courses').textContent = s.coursesCount;
    document.getElementById('crs').textContent = s.coursesUpdatedAt ? new Date(s.coursesUpdatedAt).toLocaleTimeString('zh-CN',{hour12:false}) : '-';
    document.getElementById('upd').textContent = new Date(s.now).toLocaleTimeString('zh-CN',{hour12:false});
    document.getElementById('pending').textContent = s.pending.length;
    document.getElementById('rounds').textContent = s.today.rounds;
    document.getElementById('detected').textContent = s.today.detected;
    document.getElementById('signed').textContent = s.today.signed;
    document.getElementById('signedOut').textContent = s.today.signedOut || 0;
    document.getElementById('ms').innerHTML = (s.poll.lastMs??'-') + '<small> ms</small>';

    const tb = document.getElementById('pendingBody');
    if(!s.pending.length){ tb.innerHTML = '<tr><td colspan="5" class="muted">当前没有待办，一切正常</td></tr>'; }
    else {
      tb.innerHTML = s.pending.map(p=>{
        const cls = TYPE_CLS[p.typeName]||'';
        const op = p.phase==='out' ? '<span class="muted">等待自动签出</span>'
          : (p.typeName==='数字考勤' ? '<span class="muted">填下方码</span>'
          : (p.typeName==='扫码考勤'?'<span class="muted">需扫码</span>':'<span class="muted">自动处理中</span>'));
        return '<tr><td>'+esc(p.course)+'</td><td>'+esc(p.title||'考勤')+'</td><td><span class="tag '+cls+'">'+esc(p.typeName)+'</span></td><td><span class="st st-'+(p.phase==='out'?'warn':'warn')+'">'+esc(p.status||'待签到')+'</span></td><td>'+op+'</td></tr>';
      }).join('');
    }

    const rb = document.getElementById('recentBody');
    if(!s.recent || !s.recent.length){ rb.innerHTML = '<tr><td colspan="5" class="muted">暂无记录</td></tr>'; }
    else {
      rb.innerHTML = s.recent.map(r=>{
        const cls = TYPE_CLS[r.typeName]||'';
        const io = r.typeName==='签入签出'
          ? ('入 '+(r.checkinAt?fmtTime(r.checkinAt):'—')+' / 出 '+(r.checkoutAt?fmtTime(r.checkoutAt):'—'))
          : (r.checkinAt?fmtTime(r.checkinAt):'—');
        return '<tr><td>'+esc(r.course)+'</td><td>'+esc(r.title||'考勤')+'</td><td><span class="tag '+cls+'">'+esc(r.typeName)+'</span></td><td><span class="st st-'+(r.cls||'dim')+'">'+esc(r.status)+'</span></td><td class="muted">'+esc(io)+'</td></tr>';
      }).join('');
    }
    const digit = s.pending.find(p=>p.typeName==='数字考勤');
    document.getElementById('codeBox').innerHTML = digit ? ('<form class="code" onsubmit="return submitCode(event)">'+
      '<span class="muted">数字考勤（'+esc(digit.course)+'）签到码：</span>'+
      '<input class="code" id="code" maxlength="4" inputmode="numeric" placeholder="0000" autocomplete="off"/>'+
      '<button type="submit">提交补签</button><span id="codeMsg" class="muted"></span></form>') : '';

    const evs = await jget('/events?since=0');
    const box = document.getElementById('events');
    if(!evs.events.length){ box.innerHTML = '<div class="ev muted">暂无事件</div>'; }
    else {
      box.innerHTML = evs.events.slice(0,30).map(e=>'<div class="ev"><span class="l lv-'+esc(e.level)+'"></span><span class="t">'+esc(e.time)+'</span><span>'+esc(e.message)+'</span></div>').join('');
    }
    lastSeq = evs.lastSeq;
  }catch(err){
    const b=document.getElementById('badge'); b.className='badge b-bad'; b.textContent='无法连接服务';
  }
}
async function submitCode(ev){
  ev.preventDefault();
  const code = document.getElementById('code').value.trim();
  const msg = document.getElementById('codeMsg');
  if(!/^\\d{4}$/.test(code)){ msg.textContent='请输入 4 位数字'; return false; }
  msg.textContent='提交中…';
  try{
    const r = await fetch('/code'+(TOKEN?('?token='+encodeURIComponent(TOKEN)):''),{
      method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':TOKEN},
      body:JSON.stringify({code})});
    const j = await r.json();
    msg.textContent = j.ok ? ('✓ '+(j.message||'补签成功')) : ('✗ '+(j.message||'失败'));
    document.getElementById('code').value='';
    setTimeout(refresh,800);
  }catch(e){ msg.textContent='请求失败'; }
  return false;
}
refresh(); setInterval(refresh,5000);
</script></body></html>`;
}
