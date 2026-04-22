/* Smart Signal Pro — Final script.js */

let curTF = "5m", curFilter = "ALL", curMarket = "ALL";
let activeAsset = null, allSignals = [], cd = 300;
let cdTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  startClock();
  loadSettings().then(() => { fetchAll(); loadHistory(); loadStats(); });
  document.querySelectorAll(".tf").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tf").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); curTF = b.dataset.tf; fetchAll();
  }));
  document.querySelectorAll(".fb[data-f]").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".fb[data-f]").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); curFilter = b.dataset.f; renderCards(allSignals);
  }));
  document.querySelectorAll(".fb[data-m]").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".fb[data-m]").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); curMarket = b.dataset.m; renderCards(allSignals);
  }));
});

function showPage(p) {
  document.getElementById("page-dashboard").style.display = p === "dashboard" ? "block" : "none";
  document.getElementById("page-howto").style.display = p === "howto" ? "block" : "none";
  document.querySelectorAll(".nav-tab").forEach((t, i) => {
    t.classList.toggle("active", (p === "dashboard" && i === 0) || (p === "howto" && i === 1));
  });
}

function startClock() {
  const upd = () => { document.getElementById("clock").textContent = new Date().toTimeString().slice(0,8); };
  upd(); setInterval(upd, 1000);
}

function startCountdown() {
  clearInterval(cdTimer);
  // align to 5-min wall clock
  cd = 300 - (Math.floor(Date.now()/1000) % 300);
  cdTimer = setInterval(() => {
    cd--;
    const m = Math.floor(cd/60), s = (cd%60).toString().padStart(2,"0");
    document.getElementById("st-cd").textContent = `${m}:${s}`;
    if (cd <= 0) { fetchAll(); loadStats(); }
  }, 1000);
}

async function fetchAll() {
  try {
    const res = await fetch(`/api/all_signals?timeframe=${curTF}`);
    allSignals = await res.json();
    renderCards(allSignals);
    updateLiveStatus(allSignals);
    startCountdown();
    if (activeAsset) loadDetail(activeAsset);
  } catch(e) { showToast("⚠ Network error"); }
}

function updateLiveStatus(signals) {
  const liveCount = signals.filter(s => s.data_source === "LIVE").length;
  const dot = document.querySelector(".live-dot");
  const lbl = document.getElementById("live-label");
  if (liveCount > 0) {
    dot.classList.add("live"); lbl.classList.add("live");
    lbl.textContent = `${liveCount} LIVE FEEDS`;
  } else {
    dot.classList.remove("live"); lbl.classList.remove("live");
    lbl.textContent = "SIMULATION MODE";
  }
}

function filterSignals(signals) {
  const FOREX = ["EUR/USD","GBP/USD","USD/JPY","AUD/USD","USD/CHF","NZD/USD","EUR/GBP","USD/CAD"];
  const CRYPTO = ["BTC/USD","ETH/USD","XRP/USD"];
  const OTC = ["EUR/USD-OTC","GBP/USD-OTC","AUD/USD-OTC","USD/JPY-OTC"];
  let out = signals;
  if (curFilter !== "ALL") out = out.filter(s => s.signal === curFilter);
  if (curMarket === "FOREX")  out = out.filter(s => FOREX.includes(s.asset));
  if (curMarket === "CRYPTO") out = out.filter(s => CRYPTO.includes(s.asset));
  if (curMarket === "OTC")    out = out.filter(s => OTC.includes(s.asset));
  return out;
}

function renderCards(signals) {
  const grid = document.getElementById("cards-grid");
  const filtered = filterSignals(signals);
  document.getElementById("sig-count").textContent = filtered.length;
  if (!filtered.length) {
    grid.innerHTML = `<div class="loading-box"><p style="color:var(--t3)">No signals match filter</p></div>`;
    return;
  }
  const sorted = [...filtered].sort((a,b) => {
    if (a.signal==="WAIT" && b.signal!=="WAIT") return 1;
    if (b.signal==="WAIT" && a.signal!=="WAIT") return -1;
    return b.strength - a.strength;
  });
  grid.innerHTML = sorted.map(s => buildCard(s)).join("");
  grid.querySelectorAll(".sig-card").forEach(c => {
    c.addEventListener("click", () => {
      grid.querySelectorAll(".sig-card").forEach(x => x.classList.remove("sel"));
      c.classList.add("sel");
      activeAsset = c.dataset.asset;
      loadDetail(activeAsset);
    });
  });
  if (activeAsset) {
    const a = grid.querySelector(`[data-asset="${activeAsset}"]`);
    if (a) a.classList.add("sel");
  }
}

function buildCard(s) {
  const ti = s.trend === "UPTREND" ? "↗" : s.trend === "DOWNTREND" ? "↘" : "→";
  const arrow = s.signal === "BUY" ? "▲" : s.signal === "SELL" ? "▼" : "◆";
  const fp = fmtPrice(s.price, s.asset);
  return `<div class="sig-card ${s.signal}" data-asset="${s.asset}">
    <div class="card-top">
      <span class="card-asset">${s.asset}</span>
      <div class="card-badges">
        <span class="card-tf">${curTF.toUpperCase()}</span>
        <span class="src-badge src-${s.data_source}">${s.data_source}</span>
      </div>
    </div>
    <div class="pill ${s.signal}">${arrow} ${s.signal}</div>
    <div class="bar-row">
      <div class="bar-bg"><div class="bar-fill" style="width:${s.strength}%"></div></div>
      <span class="bar-pct">${s.strength}%</span>
    </div>
    <div class="card-meta">
      <span class="c-price">${fp}</span>
      <span class="risk-b r${s.risk}">${s.risk} RISK</span>
    </div>
    <div class="card-conf">✔ <span>${s.confirmations}</span> confirmations</div>
    <div class="card-trend ${s.trend}">${ti} ${s.trend.replace("TREND","")}</div>
    ${s.signal !== "WAIT" ? `<div class="entry-hint">⏱ ${s.entry_advice} · ${s.expiry_minutes}m</div>` : ""}
  </div>`;
}

function fmtPrice(p, a) {
  if (!p) return "—";
  if (a && (a.includes("BTC") || a.includes("ETH"))) return "$" + p.toFixed(2);
  return p.toFixed(5);
}

async function loadDetail(asset) {
  try {
    const res = await fetch(`/api/signal?asset=${encodeURIComponent(asset)}&timeframe=${curTF}`);
    const d = await res.json();
    document.getElementById("chart-asset").textContent = asset;
    drawChart(d.candles, d.signal);
    renderInds(d.indicators);
    renderDetail(d);
  } catch(e) { console.error(e); }
}

function renderInds(inds) {
  if (!inds) return;
  document.getElementById("ind-grid").innerHTML = Object.entries(inds).map(([n,o]) => `
    <div class="ind-row">
      <span class="i-name">${n}</span>
      <span class="i-det">${o.detail}</span>
      <span class="i-sig ${o.signal}">${o.signal}</span>
    </div>`).join("");
}

function renderDetail(d) {
  const card = document.getElementById("detail-card");
  card.style.display = "block";
  const sc = d.signal==="BUY"?"var(--buy)":d.signal==="SELL"?"var(--sell)":"var(--wait)";
  const tags = (d.confirmations_list||[]).map(c =>
    `<span class="ctag ${d.signal==='SELL'?'sell':''}">${c}</span>`).join("");
  document.getElementById("detail-body").innerHTML = `
    <div class="dr"><span class="dk">Signal</span><span class="dv" style="color:${sc};font-weight:700">${d.signal}</span></div>
    <div class="dr"><span class="dk">Strength</span><span class="dv">${d.strength}%</span></div>
    <div class="dr"><span class="dk">Price</span><span class="dv">${fmtPrice(d.price,d.asset)}</span></div>
    <div class="dr"><span class="dk">Entry</span><span class="dv" style="color:var(--acc);font-size:10px">${d.entry_advice}</span></div>
    <div class="dr"><span class="dk">Expiry</span><span class="dv">${d.expiry_minutes} min</span></div>
    <div class="dr"><span class="dk">Risk</span><span class="dv risk-b r${d.risk}">${d.risk}</span></div>
    <div class="dr"><span class="dk">Trend</span><span class="dv ${d.trend}">${d.trend}</span></div>
    <div class="dr"><span class="dk">Support</span><span class="dv" style="color:var(--buy)">${fmtPrice(d.support,d.asset)}</span></div>
    <div class="dr"><span class="dk">Resistance</span><span class="dv" style="color:var(--sell)">${fmtPrice(d.resistance,d.asset)}</span></div>
    <div class="dr"><span class="dk">Momentum</span><span class="dv">${d.momentum}%</span></div>
    <div class="dr"><span class="dk">Data</span><span class="dv">${d.data_source}</span></div>
    ${tags ? `<div class="conf-tags">${tags}</div>` : ""}`;
}

/* ── Clean candlestick chart ── */
function drawChart(candles, sig) {
  const cv = document.getElementById("chart");
  const ctx = cv.getContext("2d");
  const W = cv.offsetWidth || 320, H = 180;
  cv.width = W; cv.height = H;
  ctx.clearRect(0,0,W,H);
  if (!candles || candles.length < 3) return;

  const n = candles.length;
  const mx = Math.max(...candles.map(c=>c.high));
  const mn = Math.min(...candles.map(c=>c.low));
  const rng = mx - mn || 0.0001;
  const pad = {t:14,b:20,l:48,r:6};
  const cw = Math.max(2, Math.floor((W-pad.l-pad.r)/n)-1);
  const ch = H - pad.t - pad.b;

  const toY = p => pad.t + ch*(1-(p-mn)/rng);
  const toX = i => pad.l + i*(W-pad.l-pad.r)/n;

  // grid + price labels
  for (let i=0; i<=4; i++) {
    const y = pad.t + ch/4*i;
    const pr = mx - (mx-mn)/4*i;
    ctx.strokeStyle="#1e2d3d"; ctx.lineWidth=0.5;
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke();
    ctx.fillStyle="#3d5268"; ctx.font="8px 'Share Tech Mono'"; ctx.textAlign="right";
    ctx.fillText(pr.toFixed(4), pad.l-3, y+3);
  }

  // candles
  candles.forEach((c,i) => {
    const x = toX(i);
    const isG = c.close >= c.open;
    const col = isG ? "#00e676" : "#ff3d57";
    const oy=toY(c.open), cy=toY(c.close), hy=toY(c.high), ly=toY(c.low);
    ctx.strokeStyle=col; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x+cw/2,hy); ctx.lineTo(x+cw/2,ly); ctx.stroke();
    ctx.fillStyle = isG ? "rgba(0,230,118,.8)" : "rgba(255,61,87,.8)";
    ctx.fillRect(x, Math.min(oy,cy), cw, Math.max(Math.abs(cy-oy),1));
  });

  // entry arrow
  if (sig && sig !== "WAIT") {
    const lc = candles[n-1]; const lx = toX(n-1)+cw/2;
    const isBuy = sig==="BUY";
    const ay = isBuy ? toY(lc.low)+13 : toY(lc.high)-13;
    const sc = isBuy ? "#00e676" : "#ff3d57";
    ctx.fillStyle=sc; ctx.font="bold 13px monospace"; ctx.textAlign="center";
    ctx.shadowColor=sc; ctx.shadowBlur=8;
    ctx.fillText(isBuy?"▲":"▼", lx, ay);
    ctx.shadowBlur=0;
  }
}

/* ── History ── */
async function loadHistory() {
  try {
    const res = await fetch("/api/history?limit=50");
    const rows = await res.json();
    const tb = document.getElementById("history-body");
    if (!rows.length) { tb.innerHTML=`<tr><td colspan="10" class="empty-cell">No history yet</td></tr>`; return; }
    tb.innerHTML = rows.map(r => `<tr>
      <td style="color:var(--t3)">${r.id}</td>
      <td>${r.asset}</td>
      <td class="${r.signal.toLowerCase()}-cell">${r.signal}</td>
      <td>${sBar(r.strength)}</td>
      <td>${r.timeframe}</td>
      <td><span class="risk-b r${r.risk}">${r.risk}</span></td>
      <td style="color:var(--t2)">${r.confirmations}</td>
      <td style="font-family:var(--mono)">${fmtPrice(r.price,r.asset)}</td>
      <td style="color:var(--t3)">${(r.timestamp||"").slice(11,19)}</td>
      <td><select class="res-sel r-${r.result}" onchange="updResult(${r.id},this.value,this)">
        <option value="PENDING" ${r.result==="PENDING"?"selected":""}>⏳ Pending</option>
        <option value="WIN"     ${r.result==="WIN"    ?"selected":""}>✅ WIN</option>
        <option value="LOSS"    ${r.result==="LOSS"   ?"selected":""}>❌ LOSS</option>
      </select></td>
    </tr>`).join("");
  } catch(e) { console.error(e); }
}

function sBar(pct) {
  const c = pct>=75?"var(--buy)":pct>=60?"var(--wait)":"var(--sell)";
  return `<div style="display:flex;align-items:center;gap:4px">
    <div style="width:42px;height:3px;background:var(--b);border-radius:2px">
      <div style="width:${pct}%;height:100%;background:${c};border-radius:2px"></div>
    </div>
    <span style="font-size:9px;color:${c};font-family:var(--mono)">${pct}%</span>
  </div>`;
}

async function updResult(id, result, el) {
  await fetch("/api/update_result",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,result})});
  el.className=`res-sel r-${result}`; loadStats(); showToast(`#${id} → ${result}`);
}

async function loadStats() {
  try {
    const r = await (await fetch("/api/stats")).json();
    document.getElementById("st-total").textContent   = r.total;
    document.getElementById("st-wr").textContent      = r.wins+r.losses>0 ? r.win_rate+"%" : "—";
    document.getElementById("st-wins").textContent    = r.wins;
    document.getElementById("st-losses").textContent  = r.losses;
    document.getElementById("st-buys").textContent    = r.buys;
    document.getElementById("st-sells").textContent   = r.sells;
  } catch(e){}
}

async function loadSettings() {
  try {
    const s = await (await fetch("/api/settings")).json();
    document.getElementById("s-ros").value = s.rsi_os||30;
    document.getElementById("s-rob").value = s.rsi_ob||70;
    document.getElementById("s-mc").value  = s.min_conf||4;
    document.getElementById("s-rl").value  = s.risk_lo||60;
    document.getElementById("s-rm").value  = s.risk_me||75;
  } catch(e){}
}

async function saveSettings() {
  const payload = {
    rsi_os: document.getElementById("s-ros").value,
    rsi_ob: document.getElementById("s-rob").value,
    min_conf: document.getElementById("s-mc").value,
    risk_lo: document.getElementById("s-rl").value,
    risk_me: document.getElementById("s-rm").value,
  };
  await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  closeSettings(); showToast("✔ Settings saved"); fetchAll();
}

function openSettings()  { document.getElementById("modal-bg").classList.add("open"); }
function closeSettings() { document.getElementById("modal-bg").classList.remove("open"); }
function closeSettingsOutside(e) { if(e.target===document.getElementById("modal-bg")) closeSettings(); }

let toastT;
function showToast(msg) {
  const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),3000);
}
