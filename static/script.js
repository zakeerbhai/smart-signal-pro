/**
 * Smart Signal Pro — FINAL script.js
 * CHANGES vs original:
 *  1. Countdown aligned to 5-min wall clock (signals never flip mid-window)
 *  2. drawPredictionChart() replaces drawMiniChart() — shows history + 3 forecast candles
 *  3. Signal cards show target price, pips, expiry
 *  4. History table shows entry price + target price
 *  5. refreshInterval hardcoded to 300s (5 min) matching server
 */

let currentTimeframe = "5m";
let currentFilter    = "ALL";
let activeAsset      = null;
let allSignals       = [];
let cdTimer          = null;

/* ── INIT ── */
document.addEventListener("DOMContentLoaded", () => {
  startClock();
  loadSettings().then(() => {
    fetchAllSignals();
    loadHistory();
    loadStats();
  });

  document.querySelectorAll(".tf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTimeframe = btn.dataset.tf;
      fetchAllSignals();
    });
  });

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderSignalCards(allSignals);
    });
  });
});

/* ── CLOCK ── */
function startClock() {
  const upd = () => {
    document.getElementById("clock").textContent = new Date().toTimeString().slice(0,8);
  };
  upd(); setInterval(upd, 1000);
}

/* ── COUNTDOWN — aligned to real 5-min windows ──
   e.g. 00:00, 05:00, 10:00 … so signal matches server window exactly */
function startCountdown() {
  clearInterval(cdTimer);
  const el = document.getElementById("stat-countdown");

  function tick() {
    const secs   = Math.floor(Date.now() / 1000);
    const left   = 300 - (secs % 300);
    const m      = Math.floor(left / 60);
    const s      = (left % 60).toString().padStart(2,"0");
    el.textContent = `${m}:${s}`;

    // When window rolls over, refresh
    if (left === 300) {
      el.textContent = "…";
      fetchAllSignals();
      loadStats();
    }
  }
  tick();
  cdTimer = setInterval(tick, 1000);
}

/* ── FETCH ALL SIGNALS ── */
async function fetchAllSignals() {
  try {
    const res  = await fetch(`/api/all_signals?timeframe=${currentTimeframe}`);
    allSignals = await res.json();
    renderSignalCards(allSignals);
    startCountdown();
    if (activeAsset) loadSignalDetail(activeAsset);
    document.getElementById("market-status-text").textContent = "SIGNALS LIVE";
  } catch(e) {
    showToast("⚠ Network error — retrying…");
  }
}

/* ── RENDER SIGNAL CARDS ── */
function renderSignalCards(signals) {
  const grid     = document.getElementById("signals-grid");
  const filtered = currentFilter === "ALL" ? signals : signals.filter(s => s.signal === currentFilter);
  document.getElementById("signal-count").textContent = filtered.length;

  if (!filtered.length) {
    grid.innerHTML = `<div class="loading-state"><p style="color:var(--text-muted)">No signals matching filter</p></div>`;
    return;
  }

  const sorted = [...filtered].sort((a,b) => {
    if (a.signal==="WAIT" && b.signal!=="WAIT") return  1;
    if (b.signal==="WAIT" && a.signal!=="WAIT") return -1;
    return b.strength - a.strength;
  });

  grid.innerHTML = sorted.map(s => buildSignalCard(s)).join("");

  grid.querySelectorAll(".signal-card").forEach(card => {
    card.addEventListener("click", () => {
      grid.querySelectorAll(".signal-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      activeAsset = card.dataset.asset;
      loadSignalDetail(activeAsset);
    });
  });

  if (activeAsset) {
    const a = grid.querySelector(`[data-asset="${activeAsset}"]`);
    if (a) a.classList.add("active");
  }
}

function buildSignalCard(s) {
  const tIcon = {UPTREND:"↗",DOWNTREND:"↘",SIDEWAYS:"→"}[s.trend] || "→";
  const arrow = s.signal==="BUY" ? "▲" : s.signal==="SELL" ? "▼" : "◆";
  const sc    = s.signal==="BUY" ? "var(--buy)" : s.signal==="SELL" ? "var(--sell)" : "var(--wait)";

  const predRow = (s.signal !== "WAIT" && s.target_price) ? `
    <div class="pred-row">
      <span style="color:${sc}">🎯 ${fmtPrice(s.target_price,s.asset)}</span>
      <span style="color:var(--text-muted)">${s.pips_target} pips · ${s.expiry_minutes}m expiry</span>
    </div>` : "";

  return `
  <div class="signal-card ${s.signal}" data-asset="${s.asset}">
    <div class="card-top">
      <span class="card-asset">${s.asset}</span>
      <span class="card-tf">${currentTimeframe.toUpperCase()}</span>
    </div>
    <div class="signal-pill ${s.signal}">${arrow} ${s.signal}</div>
    <div class="strength-row">
      <div class="strength-bar-wrap"><div class="strength-bar" style="width:${s.strength}%"></div></div>
      <span class="strength-pct">${s.strength}%</span>
    </div>
    <div class="card-meta">
      <span class="card-price">${fmtPrice(s.price, s.asset)}</span>
      <span class="risk-badge risk-${s.risk}">${s.risk}</span>
    </div>
    ${predRow}
    <div class="conf-row">✔ <span>${s.confirmations}</span> confirmations</div>
    <div class="trend-tag ${s.trend}">${tIcon} ${s.trend.replace("TREND","")}</div>
  </div>`;
}

function fmtPrice(p, asset) {
  if (!p && p !== 0) return "—";
  if (asset && (asset.includes("BTC") || asset.includes("ETH"))) return "$" + p.toFixed(2);
  if (asset && asset.includes("JPY")) return p.toFixed(3);
  if (asset && (asset.includes("XRP"))) return "$" + p.toFixed(4);
  return p.toFixed(5);
}

/* ── SIGNAL DETAIL (right panel) ── */
async function loadSignalDetail(asset) {
  try {
    const res  = await fetch(`/api/signal?asset=${encodeURIComponent(asset)}&timeframe=${currentTimeframe}`);
    const data = await res.json();
    document.getElementById("chart-asset-label").textContent = asset;
    drawPredictionChart(data);
    renderIndicatorGrid(data.indicators);
    renderSignalDetail(data);
  } catch(e) { console.error(e); }
}

/* ── PREDICTION CHART ──
   LEFT HALF  = historical candles (real green/red)
   DIVIDER    = dashed cyan line labelled "NOW"
   RIGHT HALF = 3 forecast candles (glowing, dashed wicks) + confidence band
   ENTER arrow on last historical candle
   TARGET line on predicted close
*/
function drawPredictionChart(data) {
  const canvas  = document.getElementById("mini-chart");
  const ctx     = canvas.getContext("2d");
  const W       = canvas.offsetWidth || 340;
  const H       = 210;
  canvas.width  = W;
  canvas.height = H;
  ctx.clearRect(0,0,W,H);

  const hist   = data.candles          || [];
  const pred   = data.predicted_candles || [];
  const all    = [...hist, ...pred];
  if (all.length < 2) return;

  const sig   = data.signal;
  const sc    = sig==="BUY" ? "#00e676" : sig==="SELL" ? "#ff3d57" : "#ffb300";

  // Price range (with padding)
  let maxP = Math.max(...all.map(c=>c.high), data.band_high||0);
  let minP = Math.min(...all.map(c=>c.low),  data.band_low||9e9);
  const pad5 = (maxP-minP)*0.06;
  maxP += pad5; minP -= pad5;
  const prng = maxP - minP || 1e-9;

  const pad = {t:22,b:26,l:8,r:8};
  const cW  = W - pad.l - pad.r;
  const cH  = H - pad.t - pad.b;
  const n   = all.length;
  const cw  = Math.max(2, Math.floor(cW/n) - 1);

  const toY = price => pad.t + cH * (1 - (price-minP)/prng);
  const toX = i     => pad.l + i * (cW/n);

  // Grid lines + price labels
  ctx.strokeStyle="#1e2d3d"; ctx.lineWidth=0.5;
  for (let i=0; i<=4; i++) {
    const y = pad.t + (cH/4)*i;
    const p = maxP - (maxP-minP)/4*i;
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke();
    ctx.fillStyle="#3d5268"; ctx.font="8px 'Share Tech Mono'";
    ctx.textAlign="right"; ctx.fillText(p.toFixed(4), pad.l+46, y-2);
  }

  // Confidence band (prediction zone shading)
  if (data.band_high && data.band_low && pred.length) {
    const bx  = toX(hist.length);
    const bx2 = toX(n-1) + cw;
    ctx.fillStyle = sig==="BUY"  ? "rgba(0,230,118,.07)"
                  : sig==="SELL" ? "rgba(255,61,87,.07)"
                  : "rgba(255,179,0,.07)";
    ctx.fillRect(bx, toY(data.band_high), bx2-bx, toY(data.band_low)-toY(data.band_high));
    ctx.strokeStyle = sc+"44"; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(bx,toY(data.band_high)); ctx.lineTo(bx2,toY(data.band_high)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx,toY(data.band_low));  ctx.lineTo(bx2,toY(data.band_low));  ctx.stroke();
  }

  // Target price horizontal line
  if (data.target_price) {
    const ty = toY(data.target_price);
    ctx.strokeStyle = sc+"88"; ctx.lineWidth=1; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(toX(hist.length),ty); ctx.lineTo(W-pad.r,ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle=sc; ctx.font="bold 8px 'Share Tech Mono'"; ctx.textAlign="right";
    ctx.fillText("TARGET "+fmtPrice(data.target_price,data.asset), W-pad.r-2, ty-3);
  }

  // NOW divider line
  const divX = toX(hist.length - 0.5);
  ctx.strokeStyle="rgba(0,212,255,.5)"; ctx.lineWidth=1; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(divX,pad.t); ctx.lineTo(divX,H-pad.b); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle="rgba(0,212,255,.7)"; ctx.font="8px 'Share Tech Mono'"; ctx.textAlign="center";
  ctx.fillText("NOW", divX, pad.t-6);

  // Labels
  ctx.fillStyle="rgba(0,230,118,.5)"; ctx.font="7px 'Share Tech Mono'"; ctx.textAlign="right";
  ctx.fillText("◄ HISTORY", divX-4, pad.t+10);
  ctx.fillStyle=sc+"cc"; ctx.textAlign="left";
  ctx.fillText("FORECAST ►", divX+4, pad.t+10);

  // Historical candles
  hist.forEach((c,i) => {
    const x   = toX(i);
    const isG = c.close >= c.open;
    ctx.strokeStyle = isG ? "#00e676" : "#ff3d57"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x+cw/2, toY(c.high)); ctx.lineTo(x+cw/2, toY(c.low)); ctx.stroke();
    ctx.fillStyle = isG ? "rgba(0,230,118,.8)" : "rgba(255,61,87,.8)";
    ctx.fillRect(x, Math.min(toY(c.open),toY(c.close)), cw, Math.max(Math.abs(toY(c.close)-toY(c.open)),1));
  });

  // Forecast candles (glowing)
  pred.forEach((c,i) => {
    const xi = hist.length + i;
    const x  = toX(xi);
    ctx.setLineDash([2,2]);
    ctx.strokeStyle=sc; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x+cw/2,toY(c.high)); ctx.lineTo(x+cw/2,toY(c.low)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor=sc; ctx.shadowBlur=8;
    ctx.fillStyle = sig==="BUY"  ? "rgba(0,230,118,.6)"
                  : sig==="SELL" ? "rgba(255,61,87,.6)"
                  : "rgba(255,179,0,.6)";
    ctx.fillRect(x, Math.min(toY(c.open),toY(c.close)), cw+1, Math.max(Math.abs(toY(c.close)-toY(c.open)),2));
    ctx.shadowBlur=0;
    ctx.fillStyle=sc; ctx.font="7px 'Share Tech Mono'"; ctx.textAlign="center";
    ctx.fillText(`+${c.bar||i+1}`, x+cw/2, H-pad.b+10);
  });

  // ENTER arrow
  if (sig !== "WAIT" && hist.length) {
    const lc   = hist[hist.length-1];
    const lx   = toX(hist.length-1) + cw/2;
    const isBuy= sig==="BUY";
    const ay   = isBuy ? toY(lc.low)+15 : toY(lc.high)-15;
    ctx.shadowColor=sc; ctx.shadowBlur=10;
    ctx.fillStyle=sc; ctx.font="bold 14px monospace"; ctx.textAlign="center";
    ctx.fillText(isBuy?"▲":"▼", lx, ay);
    ctx.shadowBlur=0;
    ctx.font="bold 7px 'Share Tech Mono'";
    ctx.fillText("ENTER", lx, isBuy ? ay+9 : ay-9);
  }

  // Legend bottom
  ctx.fillStyle="#3d5268"; ctx.font="8px 'Share Tech Mono'"; ctx.textAlign="left";
  ctx.fillText(`ATR: ${fmtPrice(data.atr,data.asset)}`, pad.l, H-5);
}

/* ── INDICATOR GRID ── */
function renderIndicatorGrid(indicators) {
  const grid = document.getElementById("indicator-grid");
  if (!indicators) { grid.innerHTML=`<div class="ind-placeholder">No data</div>`; return; }
  grid.innerHTML = Object.entries(indicators).map(([name,obj]) => `
    <div class="ind-row">
      <span class="ind-name">${name}</span>
      <span class="ind-detail">${obj.detail}</span>
      <span class="ind-badge ${obj.signal}">${obj.signal}</span>
    </div>`).join("");
}

/* ── SIGNAL DETAIL CARD ── */
function renderSignalDetail(data) {
  const card = document.getElementById("signal-detail-card");
  const body = document.getElementById("signal-detail-body");
  card.style.display = "block";
  const sc  = data.signal==="BUY"?"var(--buy)":data.signal==="SELL"?"var(--sell)":"var(--wait)";
  const cls = data.signal==="SELL"?"sell":"";
  const tags= (data.confirmations_list||[]).map(c=>`<span class="conf-tag ${cls}">${c}</span>`).join("");

  body.innerHTML = `
    <div class="detail-row"><span class="detail-key">Signal</span>
      <span class="detail-val" style="color:${sc};font-weight:700">${data.signal}</span></div>
    <div class="detail-row"><span class="detail-key">Strength</span>
      <span class="detail-val">${data.strength}%</span></div>
    <div class="detail-row"><span class="detail-key">Entry Price</span>
      <span class="detail-val">${fmtPrice(data.price, data.asset)}</span></div>
    <div class="detail-row"><span class="detail-key">Target Price</span>
      <span class="detail-val" style="color:${sc}">${fmtPrice(data.target_price, data.asset)}</span></div>
    <div class="detail-row"><span class="detail-key">Pip Target</span>
      <span class="detail-val" style="color:${sc}">${data.pips_target} pips</span></div>
    <div class="detail-row"><span class="detail-key">Expiry</span>
      <span class="detail-val" style="color:var(--accent)">${data.expiry_minutes} minutes</span></div>
    <div class="detail-row"><span class="detail-key">Risk</span>
      <span class="detail-val risk-${data.risk}">${data.risk}</span></div>
    <div class="detail-row"><span class="detail-key">Confirmations</span>
      <span class="detail-val">${data.confirmations} / 12</span></div>
    <div class="detail-row"><span class="detail-key">Trend</span>
      <span class="detail-val ${data.trend}">${data.trend}</span></div>
    <div class="detail-row"><span class="detail-key">Support</span>
      <span class="detail-val" style="color:var(--buy)">${fmtPrice(data.support,data.asset)}</span></div>
    <div class="detail-row"><span class="detail-key">Resistance</span>
      <span class="detail-val" style="color:var(--sell)">${fmtPrice(data.resistance,data.asset)}</span></div>
    <div class="detail-row"><span class="detail-key">Momentum</span>
      <span class="detail-val">${data.momentum}%</span></div>
    <div class="detail-row"><span class="detail-key">Time</span>
      <span class="detail-val">${(data.timestamp||"").slice(11,19)}</span></div>
    ${tags ? `<div style="margin-top:8px">
      <div style="font-size:9px;color:var(--text-muted);margin-bottom:5px">CONFIRMATIONS</div>
      <div class="confirmations-list">${tags}</div></div>` : ""}
  `;
}

/* ── HISTORY ── */
async function loadHistory() {
  try {
    const res   = await fetch("/api/history?limit=50");
    const rows  = await res.json();
    const tbody = document.getElementById("history-body");
    if (!rows.length) {
      tbody.innerHTML=`<tr><td colspan="10" class="empty-row">No history yet…</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="color:var(--text-muted)">${r.id}</td>
        <td>${r.asset}</td>
        <td class="cell-${(r.signal||"").toLowerCase()}">${r.signal}</td>
        <td>${sBar(r.strength)}</td>
        <td>${r.timeframe}</td>
        <td><span class="risk-badge risk-${r.risk}">${r.risk}</span></td>
        <td style="color:var(--text-secondary)">${r.confirmations}</td>
        <td style="color:var(--text-secondary);font-family:var(--font-mono);font-size:11px">${r.entry_price ? fmtPrice(r.entry_price,r.asset) : "—"}</td>
        <td style="color:var(--accent);font-family:var(--font-mono);font-size:11px">${r.target_price ? fmtPrice(r.target_price,r.asset) : "—"}</td>
        <td style="color:var(--text-muted)">${r.expiry_minutes ? r.expiry_minutes+"m" : "—"}</td>
        <td style="color:var(--text-muted)">${(r.timestamp||"").slice(11,19)}</td>
        <td>
          <select class="result-select result-${r.result}" onchange="updateResult(${r.id},this.value,this)">
            <option value="PENDING" ${r.result==="PENDING"?"selected":""}>⏳</option>
            <option value="WIN"     ${r.result==="WIN"    ?"selected":""}>✅ WIN</option>
            <option value="LOSS"    ${r.result==="LOSS"   ?"selected":""}>❌ LOSS</option>
          </select>
        </td>
      </tr>`).join("");
  } catch(e) { console.error(e); }
}

function sBar(pct) {
  const col = pct>=75?"var(--buy)":pct>=55?"var(--wait)":"var(--sell)";
  return `<div style="display:flex;align-items:center;gap:4px">
    <div style="width:44px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${col}"></div>
    </div>
    <span style="font-size:10px;color:${col}">${pct}%</span>
  </div>`;
}

async function updateResult(id, result, el) {
  await fetch("/api/update_result",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id,result})
  });
  el.className=`result-select result-${result}`;
  loadStats();
  showToast(`Signal #${id} → ${result}`);
}

/* ── STATS ── */
async function loadStats() {
  try {
    const s = await (await fetch("/api/stats")).json();
    document.getElementById("stat-total").textContent   = s.total;
    document.getElementById("stat-winrate").textContent = (s.wins+s.losses)>0 ? s.win_rate+"%" : "—";
    document.getElementById("stat-wins").textContent    = s.wins;
    document.getElementById("stat-losses").textContent  = s.losses;
    document.getElementById("stat-buys").textContent    = s.buys;
    document.getElementById("stat-sells").textContent   = s.sells;
  } catch(e){}
}

/* ── SETTINGS ── */
async function loadSettings() {
  try {
    const s = await (await fetch("/api/settings")).json();
    document.getElementById("s-rsi-oversold").value   = s.rsi_oversold          || 30;
    document.getElementById("s-rsi-overbought").value = s.rsi_overbought         || 70;
    document.getElementById("s-min-conf").value       = s.min_confirmations      || 6;
    document.getElementById("s-interval").value       = s.signal_window_seconds  || 300;
    document.getElementById("s-risk-low").value       = s.risk_threshold_low     || 70;
    document.getElementById("s-risk-med").value       = s.risk_threshold_medium  || 55;
  } catch(e){}
}

async function saveSettings() {
  const payload = {
    rsi_oversold:          document.getElementById("s-rsi-oversold").value,
    rsi_overbought:        document.getElementById("s-rsi-overbought").value,
    min_confirmations:     document.getElementById("s-min-conf").value,
    signal_window_seconds: document.getElementById("s-interval").value,
    risk_threshold_low:    document.getElementById("s-risk-low").value,
    risk_threshold_medium: document.getElementById("s-risk-med").value,
  };
  await fetch("/api/settings",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
  });
  closeSettings();
  showToast("✔ Settings saved");
  fetchAllSignals();
}

function openSettings()          { document.getElementById("settings-modal").classList.add("open");    }
function closeSettings()         { document.getElementById("settings-modal").classList.remove("open"); }
function closeSettingsOutside(e) { if(e.target===document.getElementById("settings-modal")) closeSettings(); }

/* ── TOAST ── */
let tt;
function showToast(msg) {
  const t=document.getElementById("toast");
  t.textContent=msg; t.classList.add("show");
  clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),3000);
}
