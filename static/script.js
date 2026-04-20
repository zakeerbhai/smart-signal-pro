/**
 * Smart Signal Pro — Frontend Script
 * Handles: auto-refresh, signal rendering, chart, indicator panel,
 *          history table, settings modal, win/loss tracking
 */

/* ══════════════════════════════════
   STATE
   ══════════════════════════════════ */
let currentTimeframe = "5m";
let currentFilter = "ALL";
let activeAsset = null;
let refreshInterval = 30;
let countdownTimer = null;
let countdown = 30;
let allSignals = [];

/* ══════════════════════════════════
   INIT
   ══════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  startClock();
  loadSettings().then(() => {
    fetchAllSignals();
    loadHistory();
    loadStats();
  });

  // Timeframe buttons
  document.querySelectorAll(".tf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTimeframe = btn.dataset.tf;
      fetchAllSignals();
    });
  });

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderSignalCards(allSignals);
    });
  });
});

/* ══════════════════════════════════
   CLOCK
   ══════════════════════════════════ */
function startClock() {
  function update() {
    const now = new Date();
    document.getElementById("clock").textContent =
      now.toTimeString().slice(0, 8);
  }
  update();
  setInterval(update, 1000);
}

/* ══════════════════════════════════
   COUNTDOWN
   ══════════════════════════════════ */
function startCountdown() {
  clearInterval(countdownTimer);
  countdown = refreshInterval;
  const el = document.getElementById("stat-countdown");
  countdownTimer = setInterval(() => {
    countdown--;
    el.textContent = countdown + "s";
    if (countdown <= 0) {
      el.textContent = "…";
      fetchAllSignals();
      loadStats();
    }
  }, 1000);
}

/* ══════════════════════════════════
   FETCH ALL SIGNALS
   ══════════════════════════════════ */
async function fetchAllSignals() {
  try {
    const res = await fetch(`/api/all_signals?timeframe=${currentTimeframe}`);
    allSignals = await res.json();
    renderSignalCards(allSignals);
    startCountdown();

    // Auto-refresh active asset detail
    if (activeAsset) loadSignalDetail(activeAsset);

    // Update market status
    document.getElementById("market-status-text").textContent = "MARKET LIVE";
  } catch (e) {
    showToast("⚠ Network error — retrying…");
  }
}

/* ══════════════════════════════════
   RENDER SIGNAL CARDS
   ══════════════════════════════════ */
function renderSignalCards(signals) {
  const grid = document.getElementById("signals-grid");
  const filtered = currentFilter === "ALL"
    ? signals
    : signals.filter(s => s.signal === currentFilter);

  document.getElementById("signal-count").textContent = filtered.length;

  if (!filtered.length) {
    grid.innerHTML = `<div class="loading-state"><p style="color:var(--text-muted)">No signals matching filter</p></div>`;
    return;
  }

  // Sort: BUY & SELL first (strongest first), WAIT last
  const sorted = [...filtered].sort((a, b) => {
    if (a.signal === "WAIT" && b.signal !== "WAIT") return 1;
    if (b.signal === "WAIT" && a.signal !== "WAIT") return -1;
    return b.strength - a.strength;
  });

  grid.innerHTML = sorted.map(s => buildSignalCard(s)).join("");

  // Click handlers
  grid.querySelectorAll(".signal-card").forEach(card => {
    card.addEventListener("click", () => {
      grid.querySelectorAll(".signal-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      activeAsset = card.dataset.asset;
      loadSignalDetail(activeAsset);
    });
  });

  // Re-highlight active
  if (activeAsset) {
    const active = grid.querySelector(`[data-asset="${activeAsset}"]`);
    if (active) active.classList.add("active");
  }
}

function buildSignalCard(s) {
  const trendClass = s.trend || "SIDEWAYS";
  const trendIcons = { UPTREND: "↗", DOWNTREND: "↘", SIDEWAYS: "→" };
  const icon = trendIcons[trendClass] || "→";

  return `
  <div class="signal-card ${s.signal}" data-asset="${s.asset}">
    <div class="card-top">
      <span class="card-asset">${s.asset}</span>
      <span class="card-tf">${currentTimeframe.toUpperCase()}</span>
    </div>
    <div class="signal-pill ${s.signal}">${s.signal}</div>
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
    <div class="conf-row">✔ <span>${s.confirmations}</span> confirmations</div>
    <div class="trend-tag ${trendClass}">${icon} ${trendClass.replace("TREND","")}</div>
  </div>`;
}

function formatPrice(price, asset) {
  if (!price) return "—";
  if (asset && (asset.includes("BTC") || asset.includes("ETH"))) {
    return "$" + price.toFixed(2);
  }
  return price.toFixed(5);
}

/* ══════════════════════════════════
   SIGNAL DETAIL (right panel)
   ══════════════════════════════════ */
async function loadSignalDetail(asset) {
  try {
    const res = await fetch(`/api/signal?asset=${encodeURIComponent(asset)}&timeframe=${currentTimeframe}`);
    const data = await res.json();

    document.getElementById("chart-asset-label").textContent = asset;
    drawMiniChart(data.candles, data.signal);
    renderIndicatorGrid(data.indicators);
    renderSignalDetail(data);
  } catch (e) {
    console.error("Detail load error:", e);
  }
}

/* ── Indicator Grid ── */
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
    </div>
  `).join("");
}

/* ── Signal Detail Card ── */
function renderSignalDetail(data) {
  const card = document.getElementById("signal-detail-card");
  const body = document.getElementById("signal-detail-body");
  card.style.display = "block";

  const confClass = data.signal === "SELL" ? "sell" : "";
  const confTags = data.confirmations_list
    ? data.confirmations_list.map(c => `<span class="conf-tag ${confClass}">${c}</span>`).join("")
    : "";

  body.innerHTML = `
    <div class="detail-row">
      <span class="detail-key">Asset</span>
      <span class="detail-val">${data.asset}</span>
    </div>
    <div class="detail-row">
      <span class="detail-key">Signal</span>
      <span class="detail-val" style="color:${signalColor(data.signal)};font-weight:700">${data.signal}</span>
    </div>
    <div class="detail-row">
      <span class="detail-key">Strength</span>
      <span class="detail-val">${data.strength}%</span>
    </div>
    <div class="detail-row">
      <span class="detail-key">Risk Level</span>
      <span class="detail-val risk-${data.risk}">${data.risk}</span>
    </div>
    <div class="detail-row">
      <span class="detail-key">Trend</span>
      <span class="detail-val ${data.trend}">${data.trend}</span>
    </div>
    <div class="detail-row">
      <span class="detail-key">Price</span>
      <span class="detail-val">${formatPrice(data.price, data.asset)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-key">Timeframe</span>
      <span class="detail-val">${data.timeframe}</span>
    </div>
    <div class="detail-row">
      <span class="detail-key">Time</span>
      <span class="detail-val">${data.timestamp.slice(11,19)}</span>
    </div>
    ${confTags ? `<div style="margin-top:8px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:5px">CONFIRMATIONS</div><div class="confirmations-list">${confTags}</div></div>` : ""}
  `;
}

function signalColor(sig) {
  return sig === "BUY" ? "var(--buy)" : sig === "SELL" ? "var(--sell)" : "var(--wait)";
}

/* ══════════════════════════════════
   MINI CANDLESTICK CHART
   ══════════════════════════════════ */
function drawMiniChart(candles, signalType) {
  const canvas = document.getElementById("mini-chart");
  const ctx = canvas.getContext("2d");
  const W = canvas.offsetWidth || 340;
  const H = 160;
  canvas.width = W;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  if (!candles || candles.length < 2) return;

  const n = candles.length;
  const highs = candles.map(c => c.high);
  const lows  = candles.map(c => c.low);
  const maxP = Math.max(...highs);
  const minP = Math.min(...lows);
  const priceRange = maxP - minP || 0.0001;

  const pad = { top: 12, bottom: 20, left: 6, right: 6 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const candleW = Math.max(2, Math.floor(chartW / n) - 1);

  // Grid lines
  ctx.strokeStyle = "#1e2d3d";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
  }

  // Candles
  candles.forEach((c, i) => {
    const x = pad.left + i * (chartW / n);
    const isGreen = c.close >= c.open;
    const color = isGreen ? "#00e676" : "#ff3d57";

    const openY  = pad.top + chartH * (1 - (c.open  - minP) / priceRange);
    const closeY = pad.top + chartH * (1 - (c.close - minP) / priceRange);
    const highY  = pad.top + chartH * (1 - (c.high  - minP) / priceRange);
    const lowY   = pad.top + chartH * (1 - (c.low   - minP) / priceRange);

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + candleW / 2, highY);
    ctx.lineTo(x + candleW / 2, lowY);
    ctx.stroke();

    // Body
    ctx.fillStyle = isGreen ? "rgba(0,230,118,.8)" : "rgba(255,61,87,.8)";
    const bodyTop = Math.min(openY, closeY);
    const bodyH   = Math.max(Math.abs(closeY - openY), 1);
    ctx.fillRect(x, bodyTop, candleW, bodyH);
  });

  // Signal arrow
  if (signalType && signalType !== "WAIT") {
    const lastC = candles[candles.length - 1];
    const lastX = pad.left + (n - 1) * (chartW / n) + candleW / 2;
    const isBuy = signalType === "BUY";
    const arrowY = isBuy
      ? pad.top + chartH * (1 - (lastC.low  - minP) / priceRange) + 14
      : pad.top + chartH * (1 - (lastC.high - minP) / priceRange) - 14;

    ctx.fillStyle = isBuy ? "#00e676" : "#ff3d57";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(isBuy ? "▲" : "▼", lastX, arrowY);
  }

  // Price labels
  ctx.fillStyle = "#3d5268";
  ctx.font = "9px 'Share Tech Mono'";
  ctx.textAlign = "left";
  ctx.fillText(maxP.toFixed(4), pad.left + 2, pad.top + 9);
  ctx.fillText(minP.toFixed(4), pad.left + 2, H - pad.bottom + 12);
}

/* ══════════════════════════════════
   HISTORY
   ══════════════════════════════════ */
async function loadHistory() {
  try {
    const res = await fetch("/api/history?limit=50");
    const rows = await res.json();
    const tbody = document.getElementById("history-body");

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No history yet…</td></tr>`;
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
        <td style="color:var(--text-muted)">${r.timestamp.slice(11,19)}</td>
        <td>
          <select class="result-select result-${r.result}" onchange="updateResult(${r.id}, this.value, this)">
            <option value="PENDING" ${r.result==="PENDING"?"selected":""}>⏳</option>
            <option value="WIN"     ${r.result==="WIN"?"selected":""}>✅ WIN</option>
            <option value="LOSS"    ${r.result==="LOSS"?"selected":""}>❌ LOSS</option>
          </select>
        </td>
      </tr>
    `).join("");
  } catch (e) {
    console.error("History load error:", e);
  }
}

function strengthBar(pct) {
  const color = pct >= 75 ? "var(--buy)" : pct >= 60 ? "var(--wait)" : "var(--sell)";
  return `<div style="display:flex;align-items:center;gap:5px">
    <div style="width:50px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:2px"></div>
    </div>
    <span style="font-size:10px;color:${color}">${pct}%</span>
  </div>`;
}

async function updateResult(id, result, selectEl) {
  try {
    await fetch("/api/update_result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, result }),
    });
    selectEl.className = `result-select result-${result}`;
    loadStats();
    showToast(`Signal #${id} marked as ${result}`);
  } catch (e) {
    showToast("Error updating result");
  }
}

/* ══════════════════════════════════
   STATS
   ══════════════════════════════════ */
async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const s = await res.json();
    document.getElementById("stat-total").textContent = s.total;
    document.getElementById("stat-winrate").textContent = s.wins + s.losses > 0 ? s.win_rate + "%" : "—";
    document.getElementById("stat-wins").textContent = s.wins;
    document.getElementById("stat-losses").textContent = s.losses;
    document.getElementById("stat-buys").textContent = s.buys;
    document.getElementById("stat-sells").textContent = s.sells;
  } catch (e) {}
}

/* ══════════════════════════════════
   SETTINGS
   ══════════════════════════════════ */
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const s = await res.json();
    document.getElementById("s-rsi-oversold").value  = s.rsi_oversold  || 30;
    document.getElementById("s-rsi-overbought").value = s.rsi_overbought || 70;
    document.getElementById("s-min-conf").value       = s.min_confirmations || 4;
    document.getElementById("s-interval").value       = s.signal_interval || 30;
    document.getElementById("s-risk-low").value       = s.risk_threshold_low || 60;
    document.getElementById("s-risk-med").value       = s.risk_threshold_medium || 75;
    refreshInterval = parseInt(s.signal_interval || 30);
  } catch (e) {}
}

async function saveSettings() {
  const payload = {
    rsi_oversold:        document.getElementById("s-rsi-oversold").value,
    rsi_overbought:      document.getElementById("s-rsi-overbought").value,
    min_confirmations:   document.getElementById("s-min-conf").value,
    signal_interval:     document.getElementById("s-interval").value,
    risk_threshold_low:  document.getElementById("s-risk-low").value,
    risk_threshold_medium: document.getElementById("s-risk-med").value,
  };
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    refreshInterval = parseInt(payload.signal_interval);
    closeSettings();
    showToast("✔ Settings saved");
    fetchAllSignals();
  } catch (e) {
    showToast("Error saving settings");
  }
}

function openSettings() {
  document.getElementById("settings-modal").classList.add("open");
}
function closeSettings() {
  document.getElementById("settings-modal").classList.remove("open");
}
function closeSettingsOutside(e) {
  if (e.target === document.getElementById("settings-modal")) closeSettings();
}

/* ══════════════════════════════════
   TOAST
   ══════════════════════════════════ */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}
