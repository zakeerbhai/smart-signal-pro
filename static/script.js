/**
 * Smart Signal Pro v2 — Frontend
 * KEY UPGRADE: Renders historical candles + predicted future candles on chart
 * Shows prediction zone, entry timing, target pips, expiry suggestion
 */

let currentTimeframe = "5m";
let currentFilter    = "ALL";
let activeAsset      = null;
let refreshInterval  = 300;   // 5 minutes — matches server window
let allSignals       = [];
let countdown        = 300;
let countdownTimer   = null;

// ──────────────────────────────────────────
// INIT
// ──────────────────────────────────────────
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

// ──────────────────────────────────────────
// CLOCK
// ──────────────────────────────────────────
function startClock() {
  const update = () => {
    document.getElementById("clock").textContent =
      new Date().toTimeString().slice(0, 8);
  };
  update();
  setInterval(update, 1000);
}

// ──────────────────────────────────────────
// COUNTDOWN  (5-min window aligned)
// ──────────────────────────────────────────
function startCountdown() {
  clearInterval(countdownTimer);
  // Align to 5-minute wall clock windows
  const now  = Date.now();
  const secs = Math.floor(now / 1000);
  countdown  = 300 - (secs % 300);

  const el = document.getElementById("stat-countdown");

  countdownTimer = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      el.textContent = "…";
      fetchAllSignals();
      loadStats();
      countdown = 300;
    } else {
      const m = Math.floor(countdown / 60);
      const s = (countdown % 60).toString().padStart(2, "0");
      el.textContent = `${m}:${s}`;
    }
  }, 1000);
}

// ──────────────────────────────────────────
// FETCH ALL SIGNALS
// ──────────────────────────────────────────
async function fetchAllSignals() {
  try {
    const res  = await fetch(`/api/all_signals?timeframe=${currentTimeframe}`);
    allSignals = await res.json();
    renderSignalCards(allSignals);
    startCountdown();
    if (activeAsset) loadSignalDetail(activeAsset);
  } catch (e) {
    showToast("⚠ Network error — retrying…");
  }
}

// ──────────────────────────────────────────
// RENDER SIGNAL CARDS
// ──────────────────────────────────────────
function renderSignalCards(signals) {
  const grid = document.getElementById("signals-grid");
  const filtered = currentFilter === "ALL"
    ? signals
    : signals.filter(s => s.signal === currentFilter);

  document.getElementById("signal-count").textContent = filtered.length;

  if (!filtered.length) {
    grid.innerHTML = `<div class="loading-state"><p>No signals matching filter</p></div>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => {
    if (a.signal === "WAIT" && b.signal !== "WAIT") return 1;
    if (b.signal === "WAIT" && a.signal !== "WAIT") return -1;
    return b.strength - a.strength;
  });

  grid.innerHTML = sorted.map(s => buildCard(s)).join("");

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

function buildCard(s) {
  const trendIcon = { UPTREND:"↗", DOWNTREND:"↘", SIDEWAYS:"→" }[s.trend] || "→";
  const arrow     = s.signal === "BUY" ? "▲" : s.signal === "SELL" ? "▼" : "◆";
  const pipsColor = s.signal === "BUY" ? "var(--buy)" : s.signal === "SELL" ? "var(--sell)" : "var(--wait)";

  // Predicted close delta
  let predTag = "";
  if (s.predicted_close && s.price && s.signal !== "WAIT") {
    const delta = ((s.predicted_close - s.price) / s.price * 100).toFixed(3);
    const dSign = delta >= 0 ? "+" : "";
    predTag = `<div class="pred-tag" style="color:${pipsColor}">
      🎯 Target: ${dSign}${delta}% &nbsp;|&nbsp; ${s.target_pips} pips
    </div>`;
  }

  return `
  <div class="signal-card ${s.signal}" data-asset="${s.asset}">
    <div class="card-top">
      <span class="card-asset">${s.asset}</span>
      <span class="card-tf">${currentTimeframe.toUpperCase()}</span>
    </div>
    <div class="signal-pill ${s.signal}">${arrow} ${s.signal}</div>
    <div class="strength-row">
      <div class="strength-bar-wrap">
        <div class="strength-bar" style="width:${s.strength}%"></div>
      </div>
      <span class="strength-pct">${s.strength}%</span>
    </div>
    <div class="card-meta">
      <span class="card-price">${formatPrice(s.price, s.asset)}</span>
      <span class="risk-badge risk-${s.risk}">${s.risk} RISK</span>
    </div>
    ${predTag}
    <div class="conf-row">✔ <span>${s.confirmations}</span> confirms</div>
    <div class="trend-tag ${s.trend}">${trendIcon} ${s.trend.replace("TREND","")}</div>
    ${s.entry_quality ? `<div class="entry-tag eq-${s.entry_quality}">${s.entry_quality} · ${s.expiry_minutes}m expiry</div>` : ""}
  </div>`;
}

function formatPrice(p, asset) {
  if (!p) return "—";
  if (asset && (asset.includes("BTC") || asset.includes("ETH"))) return "$" + p.toFixed(2);
  return p.toFixed(5);
}

// ──────────────────────────────────────────
// SIGNAL DETAIL  (right panel)
// ──────────────────────────────────────────
async function loadSignalDetail(asset) {
  try {
    const res  = await fetch(`/api/signal?asset=${encodeURIComponent(asset)}&timeframe=${currentTimeframe}`);
    const data = await res.json();

    document.getElementById("chart-asset-label").textContent = asset;
    drawPredictionChart(data);
    renderIndicatorGrid(data.indicators);
    renderSignalDetail(data);
  } catch (e) {
    console.error("Detail error:", e);
  }
}

// ──────────────────────────────────────────
// ★ PREDICTION CHART ★
// Draws: historical candles (grey outline) + past 15 real candles
//        + 3 projected candles (dashed, coloured) + prediction band
// ──────────────────────────────────────────
function drawPredictionChart(data) {
  const canvas = document.getElementById("mini-chart");
  const ctx    = canvas.getContext("2d");
  const W      = canvas.offsetWidth || 340;
  const H      = 200;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const historical  = data.candles || [];
  const predicted   = data.predicted_candles || [];
  const allCandles  = [...historical, ...predicted];
  if (allCandles.length < 2) return;

  const signal = data.signal;
  const sigColor = signal === "BUY" ? "#00e676" : signal === "SELL" ? "#ff3d57" : "#ffb300";

  // Price range (historical + predicted high/low)
  let maxP = Math.max(...allCandles.map(c => c.high), data.predicted_high || 0);
  let minP = Math.min(...allCandles.map(c => c.low),  data.predicted_low  || 999999);
  const range = maxP - minP || 0.0001;
  // Add 5% padding
  maxP += range * 0.05;
  minP -= range * 0.05;
  const rng2 = maxP - minP;

  const pad  = { top:20, bottom:30, left:8, right:8 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top  - pad.bottom;
  const n      = allCandles.length;
  const cw     = Math.max(2, Math.floor(chartW / n) - 1);

  const toY = price => pad.top + chartH * (1 - (price - minP) / rng2);
  const toX = i     => pad.left + i * (chartW / n);

  // ── Grid ──
  ctx.strokeStyle = "#1e2d3d"; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    const priceAtLine = maxP - (rng2 / 4) * i;
    ctx.fillStyle = "#3d5268"; ctx.font = "9px 'Share Tech Mono'";
    ctx.textAlign = "right";
    ctx.fillText(priceAtLine.toFixed(4), pad.left + 46, y - 2);
  }

  // ── Divider: historical | predicted ──
  const divX = toX(historical.length - 0.5);
  ctx.strokeStyle = "rgba(0,212,255,.35)"; ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(divX, pad.top); ctx.lineTo(divX, H - pad.bottom); ctx.stroke();
  ctx.setLineDash([]);

  // Label
  ctx.fillStyle = "rgba(0,212,255,.6)"; ctx.font = "9px 'Share Tech Mono'";
  ctx.textAlign = "left";
  ctx.fillText("◄ HISTORY", divX - 60, pad.top + 10);
  ctx.fillStyle = sigColor;
  ctx.fillText("FORECAST ►", divX + 4, pad.top + 10);

  // ── Prediction confidence band ──
  if (data.predicted_high && data.predicted_low && predicted.length) {
    const bandStartX = toX(historical.length);
    const bandEndX   = toX(n - 1) + cw;
    const bandTopY   = toY(data.predicted_high);
    const bandBotY   = toY(data.predicted_low);
    ctx.fillStyle = signal === "BUY"
      ? "rgba(0,230,118,.08)"
      : signal === "SELL"
      ? "rgba(255,61,87,.08)"
      : "rgba(255,179,0,.08)";
    ctx.fillRect(bandStartX, bandTopY, bandEndX - bandStartX, bandBotY - bandTopY);
    // Band borders
    ctx.strokeStyle = sigColor + "44"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bandStartX, bandTopY); ctx.lineTo(bandEndX, bandTopY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bandStartX, bandBotY); ctx.lineTo(bandEndX, bandBotY); ctx.stroke();
    // Target label
    ctx.fillStyle = sigColor; ctx.font = "bold 9px 'Share Tech Mono'";
    ctx.textAlign = "right";
    ctx.fillText(`TARGET ${data.predicted_close.toFixed(4)}`, W - pad.right - 2, toY(data.predicted_close) - 3);
  }

  // ── Historical candles ──
  historical.forEach((c, i) => {
    const x     = toX(i);
    const isG   = c.close >= c.open;
    const color = isG ? "rgba(0,230,118,.8)" : "rgba(255,61,87,.8)";
    const oy    = toY(c.open);  const cy = toY(c.close);
    const hy    = toY(c.high);  const ly = toY(c.low);

    ctx.strokeStyle = isG ? "#00e676" : "#ff3d57"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + cw/2, hy); ctx.lineTo(x + cw/2, ly); ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x, Math.min(oy, cy), cw, Math.max(Math.abs(cy - oy), 1));
  });

  // ── Predicted candles (dashed wick, glowing body) ──
  predicted.forEach((c, i) => {
    const xi  = historical.length + i;
    const x   = toX(xi);
    const isG = c.close >= c.open;
    const oy  = toY(c.open);  const cy = toY(c.close);
    const hy  = toY(c.high);  const ly = toY(c.low);

    // Dashed wick
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = sigColor; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + cw/2, hy); ctx.lineTo(x + cw/2, ly); ctx.stroke();
    ctx.setLineDash([]);

    // Glowing body
    ctx.shadowColor  = sigColor; ctx.shadowBlur = 6;
    ctx.fillStyle    = signal === "BUY"
      ? "rgba(0,230,118,0.55)"
      : signal === "SELL"
      ? "rgba(255,61,87,0.55)"
      : "rgba(255,179,0,0.55)";
    ctx.fillRect(x, Math.min(oy, cy), cw + 1, Math.max(Math.abs(cy - oy), 2));
    ctx.shadowBlur = 0;

    // Bar number label
    ctx.fillStyle = sigColor; ctx.font = "8px 'Share Tech Mono'";
    ctx.textAlign = "center";
    ctx.fillText(`+${i+1}`, x + cw/2, H - pad.bottom + 10);
  });

  // ── Entry arrow on last historical candle ──
  if (signal !== "WAIT") {
    const lc   = historical[historical.length - 1];
    const lx   = toX(historical.length - 1) + cw / 2;
    const isBuy = signal === "BUY";
    const ay   = isBuy ? toY(lc.low) + 14 : toY(lc.high) - 14;
    ctx.fillStyle = sigColor; ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.shadowColor = sigColor; ctx.shadowBlur = 8;
    ctx.fillText(isBuy ? "▲" : "▼", lx, ay);
    ctx.shadowBlur = 0;

    // "ENTER" label
    ctx.fillStyle = sigColor; ctx.font = "bold 8px 'Share Tech Mono'";
    ctx.fillText("ENTER", lx, isBuy ? ay + 10 : ay - 10);
  }

  // ── Legend ──
  ctx.fillStyle = "#3d5268"; ctx.font = "8px 'Share Tech Mono'";
  ctx.textAlign = "left";
  ctx.fillText(`ATR: ${data.atr_pips} pips`, pad.left + 2, H - 4);
  ctx.textAlign = "right";
  ctx.fillText(`${data.target_pips} pip target`, W - pad.right - 2, H - 4);
}

// ──────────────────────────────────────────
// INDICATOR GRID
// ──────────────────────────────────────────
function renderIndicatorGrid(indicators) {
  const grid = document.getElementById("indicator-grid");
  if (!indicators) {
    grid.innerHTML = `<div class="ind-placeholder">No data</div>`;
    return;
  }
  grid.innerHTML = Object.entries(indicators).map(([name, obj]) => `
    <div class="ind-row">
      <span class="ind-name">${name}</span>
      <span class="ind-detail">${obj.detail}</span>
      <span class="ind-badge ${obj.signal}">${obj.signal}</span>
    </div>`).join("");
}

// ──────────────────────────────────────────
// SIGNAL DETAIL CARD
// ──────────────────────────────────────────
function renderSignalDetail(data) {
  const card = document.getElementById("signal-detail-card");
  const body = document.getElementById("signal-detail-body");
  card.style.display = "block";

  const sc = data.signal === "BUY" ? "var(--buy)" : data.signal === "SELL" ? "var(--sell)" : "var(--wait)";
  const confTags = (data.confirmations_list || [])
    .map(c => `<span class="conf-tag ${data.signal === 'SELL' ? 'sell' : ''}">${c}</span>`)
    .join("");

  body.innerHTML = `
    <div class="detail-row"><span class="detail-key">Signal</span>
      <span class="detail-val" style="color:${sc};font-weight:700">${data.signal}</span></div>
    <div class="detail-row"><span class="detail-key">Strength</span>
      <span class="detail-val">${data.strength}%</span></div>
    <div class="detail-row"><span class="detail-key">Current Price</span>
      <span class="detail-val">${formatPrice(data.price, data.asset)}</span></div>
    <div class="detail-row"><span class="detail-key">Predicted Close</span>
      <span class="detail-val" style="color:${sc}">${formatPrice(data.predicted_close, data.asset)}</span></div>
    <div class="detail-row"><span class="detail-key">Target</span>
      <span class="detail-val" style="color:${sc}">${data.target_pips} pips</span></div>
    <div class="detail-row"><span class="detail-key">ATR (volatility)</span>
      <span class="detail-val">${data.atr_pips} pips</span></div>
    <div class="detail-row"><span class="detail-key">Entry</span>
      <span class="detail-val" style="color:var(--accent)">${data.entry_in}</span></div>
    <div class="detail-row"><span class="detail-key">Expiry</span>
      <span class="detail-val">${data.expiry_minutes} minutes</span></div>
    <div class="detail-row"><span class="detail-key">Risk</span>
      <span class="detail-val risk-${data.risk}">${data.risk}</span></div>
    <div class="detail-row"><span class="detail-key">Trend</span>
      <span class="detail-val ${data.trend}">${data.trend}</span></div>
    <div class="detail-row"><span class="detail-key">Momentum</span>
      <span class="detail-val">${data.momentum}%</span></div>
    <div class="detail-row"><span class="detail-key">Support</span>
      <span class="detail-val" style="color:var(--buy)">${formatPrice(data.support, data.asset)}</span></div>
    <div class="detail-row"><span class="detail-key">Resistance</span>
      <span class="detail-val" style="color:var(--sell)">${formatPrice(data.resistance, data.asset)}</span></div>
    ${confTags ? `
    <div style="margin-top:8px">
      <div style="font-size:9px;color:var(--text-muted);margin-bottom:5px">CONFIRMATIONS</div>
      <div class="confirmations-list">${confTags}</div>
    </div>` : ""}
  `;
}

// ──────────────────────────────────────────
// HISTORY
// ──────────────────────────────────────────
async function loadHistory() {
  try {
    const res  = await fetch("/api/history?limit=50");
    const rows = await res.json();
    const tbody = document.getElementById("history-body");

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-row">No history yet…</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="color:var(--text-muted)">${r.id}</td>
        <td>${r.asset}</td>
        <td class="cell-${r.signal.toLowerCase()}">${r.signal}</td>
        <td>${strengthBar(r.strength)}</td>
        <td>${r.timeframe}</td>
        <td><span class="risk-badge risk-${r.risk}">${r.risk}</span></td>
        <td style="color:var(--text-secondary)">${r.confirmations}</td>
        <td style="color:var(--accent);font-size:10px">${r.predicted_close ? formatPrice(r.predicted_close, r.asset) : "—"}</td>
        <td style="color:var(--text-muted)">${r.timestamp ? r.timestamp.slice(11,19) : "—"}</td>
        <td>
          <select class="result-select result-${r.result}"
            onchange="updateResult(${r.id}, this.value, this)">
            <option value="PENDING" ${r.result==="PENDING"?"selected":""}>⏳</option>
            <option value="WIN"     ${r.result==="WIN"?"selected":""}>✅ WIN</option>
            <option value="LOSS"    ${r.result==="LOSS"?"selected":""}>❌ LOSS</option>
          </select>
        </td>
      </tr>`).join("");
  } catch(e) { console.error("History error:", e); }
}

function strengthBar(pct) {
  const color = pct >= 75 ? "var(--buy)" : pct >= 60 ? "var(--wait)" : "var(--sell)";
  return `<div style="display:flex;align-items:center;gap:4px">
    <div style="width:44px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color}"></div>
    </div>
    <span style="font-size:9px;color:${color}">${pct}%</span>
  </div>`;
}

async function updateResult(id, result, el) {
  await fetch("/api/update_result", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({id, result})
  });
  el.className = `result-select result-${result}`;
  loadStats();
  showToast(`Signal #${id} → ${result}`);
}

// ──────────────────────────────────────────
// STATS
// ──────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const s   = await res.json();
    document.getElementById("stat-total").textContent   = s.total;
    document.getElementById("stat-winrate").textContent = (s.wins+s.losses) > 0 ? s.win_rate+"%" : "—";
    document.getElementById("stat-wins").textContent    = s.wins;
    document.getElementById("stat-losses").textContent  = s.losses;
    document.getElementById("stat-buys").textContent    = s.buys;
    document.getElementById("stat-sells").textContent   = s.sells;
  } catch(e) {}
}

// ──────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const s   = await res.json();
    document.getElementById("s-rsi-oversold").value   = s.rsi_oversold   || 30;
    document.getElementById("s-rsi-overbought").value = s.rsi_overbought  || 70;
    document.getElementById("s-min-conf").value       = s.min_confirmations || 4;
    document.getElementById("s-interval").value       = s.signal_interval || 300;
    document.getElementById("s-risk-low").value       = s.risk_threshold_low || 60;
    document.getElementById("s-risk-med").value       = s.risk_threshold_medium || 75;
    refreshInterval = parseInt(s.signal_interval || 300);
  } catch(e) {}
}

async function saveSettings() {
  const payload = {
    rsi_oversold:          document.getElementById("s-rsi-oversold").value,
    rsi_overbought:        document.getElementById("s-rsi-overbought").value,
    min_confirmations:     document.getElementById("s-min-conf").value,
    signal_interval:       document.getElementById("s-interval").value,
    risk_threshold_low:    document.getElementById("s-risk-low").value,
    risk_threshold_medium: document.getElementById("s-risk-med").value,
  };
  await fetch("/api/settings", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  closeSettings();
  showToast("✔ Settings saved");
  fetchAllSignals();
}

function openSettings()  { document.getElementById("settings-modal").classList.add("open"); }
function closeSettings() { document.getElementById("settings-modal").classList.remove("open"); }
function closeSettingsOutside(e) {
  if (e.target === document.getElementById("settings-modal")) closeSettings();
}

// ──────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

