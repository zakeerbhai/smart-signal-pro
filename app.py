"""
Smart Signal Pro - Flask Backend
Trading Signal Generator using Multiple Technical Indicators
"""

from flask import Flask, render_template, jsonify, request
import sqlite3
import math
import random
import time
from datetime import datetime, timedelta

app = Flask(__name__)
DB_PATH = "signals.db"

# ─────────────────────────────────────────────
# DATABASE SETUP
# ─────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset TEXT,
            signal TEXT,
            strength INTEGER,
            timeframe TEXT,
            risk TEXT,
            confirmations INTEGER,
            indicators TEXT,
            timestamp TEXT,
            result TEXT DEFAULT 'PENDING'
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    # Default settings
    defaults = [
        ("rsi_oversold", "30"),
        ("rsi_overbought", "70"),
        ("min_confirmations", "4"),
        ("signal_interval", "30"),
        ("risk_threshold_low", "60"),
        ("risk_threshold_medium", "75"),
    ]
    for k, v in defaults:
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
    conn.commit()
    conn.close()


def get_settings():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT key, value FROM settings")
    settings = {row[0]: row[1] for row in c.fetchall()}
    conn.close()
    return settings


# ─────────────────────────────────────────────
# CANDLE DATA SIMULATION (Realistic OHLCV)
# ─────────────────────────────────────────────
def generate_candles(asset, n=100, timeframe="1m"):
    """
    Generate realistic OHLCV candle data using a random walk model.
    In production, replace this with a live data feed (e.g. Binance, Polygon.io, etc.)
    """
    seed = sum(ord(c) for c in asset) + int(time.time() / 60)
    random.seed(seed)

    base_prices = {
        "EUR/USD": 1.0850, "GBP/USD": 1.2650, "USD/JPY": 149.50,
        "AUD/USD": 0.6580, "EUR/GBP": 0.8580,
        "BTC/USD": 67500.0, "ETH/USD": 3400.0, "XRP/USD": 0.5820,
        "EUR/USD-OTC": 1.0848, "GBP/USD-OTC": 1.2648,
        "USD/CHF": 0.9020, "NZD/USD": 0.6080,
    }
    price = base_prices.get(asset, 1.0000)
    volatility = price * 0.0008

    candles = []
    for i in range(n):
        open_ = price
        move = random.gauss(0, volatility)
        high = open_ + abs(random.gauss(0, volatility * 0.8))
        low = open_ - abs(random.gauss(0, volatility * 0.8))
        close = open_ + move
        high = max(high, open_, close)
        low = min(low, open_, close)
        volume = random.randint(800, 5000)
        candles.append({
            "open": round(open_, 5),
            "high": round(high, 5),
            "low": round(low, 5),
            "close": round(close, 5),
            "volume": volume,
        })
        price = close

    return candles


# ─────────────────────────────────────────────
# TECHNICAL INDICATOR FUNCTIONS
# ─────────────────────────────────────────────
def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, period + 1):
        diff = closes[-i] - closes[-i - 1]
        (gains if diff > 0 else losses).append(abs(diff))
    avg_gain = sum(gains) / period if gains else 0.0001
    avg_loss = sum(losses) / period if losses else 0.0001
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def calc_sma(closes, period):
    if len(closes) < period:
        return closes[-1]
    return round(sum(closes[-period:]) / period, 5)


def calc_ema(closes, period):
    if len(closes) < period:
        return closes[-1]
    k = 2 / (period + 1)
    ema = sum(closes[:period]) / period
    for price in closes[period:]:
        ema = price * k + ema * (1 - k)
    return round(ema, 5)


def calc_macd(closes):
    if len(closes) < 26:
        return 0, 0, 0
    ema12 = calc_ema(closes, 12)
    ema26 = calc_ema(closes, 26)
    macd_line = round(ema12 - ema26, 6)
    # Signal line: 9-period EMA of MACD
    macd_values = []
    for i in range(9):
        e12 = calc_ema(closes[:-(9 - i) or len(closes)], 12)
        e26 = calc_ema(closes[:-(9 - i) or len(closes)], 26)
        macd_values.append(e12 - e26)
    signal_line = round(calc_ema(macd_values, 9), 6)
    histogram = round(macd_line - signal_line, 6)
    return macd_line, signal_line, histogram


def calc_bollinger(closes, period=20, std_dev=2):
    if len(closes) < period:
        return closes[-1], closes[-1], closes[-1]
    sma = calc_sma(closes, period)
    variance = sum((c - sma) ** 2 for c in closes[-period:]) / period
    std = math.sqrt(variance)
    upper = round(sma + std_dev * std, 5)
    lower = round(sma - std_dev * std, 5)
    return upper, sma, lower


def calc_stochastic(candles, k_period=14, d_period=3):
    if len(candles) < k_period:
        return 50.0, 50.0
    highs = [c["high"] for c in candles[-k_period:]]
    lows = [c["low"] for c in candles[-k_period:]]
    close = candles[-1]["close"]
    highest_high = max(highs)
    lowest_low = min(lows)
    if highest_high == lowest_low:
        k = 50.0
    else:
        k = round(((close - lowest_low) / (highest_high - lowest_low)) * 100, 2)
    # D line (3-period SMA of K)
    k_values = []
    for i in range(d_period):
        h = max(c["high"] for c in candles[-(k_period + i): -i or len(candles)])
        l = min(c["low"] for c in candles[-(k_period + i): -i or len(candles)])
        cl = candles[-1 - i]["close"]
        k_values.append(((cl - l) / (h - l)) * 100 if h != l else 50)
    d = round(sum(k_values) / d_period, 2)
    return k, d


def calc_support_resistance(candles, lookback=20):
    highs = [c["high"] for c in candles[-lookback:]]
    lows = [c["low"] for c in candles[-lookback:]]
    resistance = round(max(highs), 5)
    support = round(min(lows), 5)
    return support, resistance


def calc_heiken_ashi(candles):
    """Convert last 3 candles to Heiken Ashi"""
    if len(candles) < 3:
        return None
    ha = []
    prev_close = (candles[0]["open"] + candles[0]["high"] + candles[0]["low"] + candles[0]["close"]) / 4
    prev_open = (candles[0]["open"] + candles[0]["close"]) / 2
    for c in candles[-3:]:
        ha_close = (c["open"] + c["high"] + c["low"] + c["close"]) / 4
        ha_open = (prev_open + prev_close) / 2
        ha_high = max(c["high"], ha_open, ha_close)
        ha_low = min(c["low"], ha_open, ha_close)
        ha.append({"open": ha_open, "close": ha_close, "high": ha_high, "low": ha_low})
        prev_open, prev_close = ha_open, ha_close
    return ha


def detect_candlestick_patterns(candles):
    """Detect key candlestick patterns from last 2 candles"""
    if len(candles) < 2:
        return "None", "NEUTRAL"
    c = candles[-1]
    p = candles[-2]
    body = abs(c["close"] - c["open"])
    full_range = c["high"] - c["low"]
    if full_range == 0:
        return "None", "NEUTRAL"
    upper_wick = c["high"] - max(c["open"], c["close"])
    lower_wick = min(c["open"], c["close"]) - c["low"]

    # Doji
    if body / full_range < 0.1:
        return "Doji", "NEUTRAL"
    # Hammer
    if lower_wick > body * 2 and upper_wick < body * 0.5 and c["close"] > c["open"]:
        return "Hammer", "BUY"
    # Shooting Star
    if upper_wick > body * 2 and lower_wick < body * 0.5 and c["close"] < c["open"]:
        return "Shooting Star", "SELL"
    # Bullish Engulfing
    if (p["close"] < p["open"] and c["close"] > c["open"]
            and c["open"] < p["close"] and c["close"] > p["open"]):
        return "Bullish Engulfing", "BUY"
    # Bearish Engulfing
    if (p["close"] > p["open"] and c["close"] < c["open"]
            and c["open"] > p["close"] and c["close"] < p["open"]):
        return "Bearish Engulfing", "SELL"
    # Bullish Marubozu
    if body / full_range > 0.9 and c["close"] > c["open"]:
        return "Bullish Marubozu", "BUY"
    # Bearish Marubozu
    if body / full_range > 0.9 and c["close"] < c["open"]:
        return "Bearish Marubozu", "SELL"
    return "None", "NEUTRAL"


def calc_trend_strength(closes, short=10, long=30):
    """Detect trend strength using slope of EMA"""
    if len(closes) < long:
        return "SIDEWAYS", 0
    ema_short = calc_ema(closes, short)
    ema_long = calc_ema(closes, long)
    diff_pct = (ema_short - ema_long) / ema_long * 100
    if diff_pct > 0.05:
        return "UPTREND", round(min(abs(diff_pct) * 100, 100), 1)
    elif diff_pct < -0.05:
        return "DOWNTREND", round(min(abs(diff_pct) * 100, 100), 1)
    return "SIDEWAYS", round(abs(diff_pct) * 100, 1)


def volume_confirmation(candles, lookback=10):
    """Check if current volume is above average (confirms breakout)"""
    avg_vol = sum(c["volume"] for c in candles[-lookback:]) / lookback
    current_vol = candles[-1]["volume"]
    return current_vol > avg_vol * 1.2, round(current_vol / avg_vol * 100, 1)


# ─────────────────────────────────────────────
# MAIN SIGNAL GENERATION ENGINE
# ─────────────────────────────────────────────
def generate_signal(asset, timeframe, settings):
    candles = generate_candles(asset, n=100, timeframe=timeframe)
    closes = [c["close"] for c in candles]

    rsi_oversold = float(settings.get("rsi_oversold", 30))
    rsi_overbought = float(settings.get("rsi_overbought", 70))

    # ── Compute all indicators ──
    rsi = calc_rsi(closes)
    sma20 = calc_sma(closes, 20)
    sma50 = calc_sma(closes, 50)
    ema9 = calc_ema(closes, 9)
    ema21 = calc_ema(closes, 21)
    macd_line, signal_line, histogram = calc_macd(closes)
    bb_upper, bb_mid, bb_lower = calc_bollinger(closes)
    stoch_k, stoch_d = calc_stochastic(candles)
    support, resistance = calc_support_resistance(candles)
    pattern_name, pattern_signal = detect_candlestick_patterns(candles)
    ha = calc_heiken_ashi(candles)
    trend_dir, trend_strength_val = calc_trend_strength(closes)
    vol_confirmed, vol_ratio = volume_confirmation(candles)
    current_price = closes[-1]

    # ── Score each indicator ──
    buy_confirmations = []
    sell_confirmations = []
    indicator_status = {}

    # RSI
    if rsi < rsi_oversold:
        buy_confirmations.append("RSI Oversold")
        indicator_status["RSI"] = {"value": rsi, "signal": "BUY", "detail": f"{rsi} (Oversold)"}
    elif rsi > rsi_overbought:
        sell_confirmations.append("RSI Overbought")
        indicator_status["RSI"] = {"value": rsi, "signal": "SELL", "detail": f"{rsi} (Overbought)"}
    else:
        indicator_status["RSI"] = {"value": rsi, "signal": "NEUTRAL", "detail": f"{rsi} (Neutral)"}

    # MACD
    if macd_line > signal_line and histogram > 0:
        buy_confirmations.append("MACD Bullish Crossover")
        indicator_status["MACD"] = {"value": round(macd_line, 5), "signal": "BUY", "detail": f"Bullish ({round(histogram,5)})"}
    elif macd_line < signal_line and histogram < 0:
        sell_confirmations.append("MACD Bearish Crossover")
        indicator_status["MACD"] = {"value": round(macd_line, 5), "signal": "SELL", "detail": f"Bearish ({round(histogram,5)})"}
    else:
        indicator_status["MACD"] = {"value": round(macd_line, 5), "signal": "NEUTRAL", "detail": "No clear crossover"}

    # SMA Cross
    if sma20 > sma50:
        buy_confirmations.append("SMA Golden Cross")
        indicator_status["SMA"] = {"value": round(sma20, 5), "signal": "BUY", "detail": f"SMA20 > SMA50"}
    else:
        sell_confirmations.append("SMA Death Cross")
        indicator_status["SMA"] = {"value": round(sma20, 5), "signal": "SELL", "detail": f"SMA20 < SMA50"}

    # EMA Cross
    if ema9 > ema21:
        buy_confirmations.append("EMA Bullish Cross")
        indicator_status["EMA"] = {"value": round(ema9, 5), "signal": "BUY", "detail": f"EMA9 > EMA21"}
    else:
        sell_confirmations.append("EMA Bearish Cross")
        indicator_status["EMA"] = {"value": round(ema9, 5), "signal": "SELL", "detail": f"EMA9 < EMA21"}

    # Bollinger Bands
    if current_price <= bb_lower:
        buy_confirmations.append("BB Lower Bounce")
        indicator_status["Bollinger"] = {"value": round(current_price, 5), "signal": "BUY", "detail": "Price at Lower Band"}
    elif current_price >= bb_upper:
        sell_confirmations.append("BB Upper Rejection")
        indicator_status["Bollinger"] = {"value": round(current_price, 5), "signal": "SELL", "detail": "Price at Upper Band"}
    else:
        band_pos = round((current_price - bb_lower) / (bb_upper - bb_lower) * 100, 1)
        indicator_status["Bollinger"] = {"value": round(current_price, 5), "signal": "NEUTRAL", "detail": f"Mid-Band ({band_pos}%)"}

    # Stochastic
    if stoch_k < 20 and stoch_d < 20:
        buy_confirmations.append("Stochastic Oversold")
        indicator_status["Stochastic"] = {"value": stoch_k, "signal": "BUY", "detail": f"K:{stoch_k} D:{stoch_d}"}
    elif stoch_k > 80 and stoch_d > 80:
        sell_confirmations.append("Stochastic Overbought")
        indicator_status["Stochastic"] = {"value": stoch_k, "signal": "SELL", "detail": f"K:{stoch_k} D:{stoch_d}"}
    else:
        indicator_status["Stochastic"] = {"value": stoch_k, "signal": "NEUTRAL", "detail": f"K:{stoch_k} D:{stoch_d}"}

    # Support/Resistance
    price_to_support = (current_price - support) / (resistance - support) if resistance != support else 0.5
    if price_to_support < 0.15:
        buy_confirmations.append("Price Near Support")
        indicator_status["S/R Levels"] = {"value": round(current_price, 5), "signal": "BUY", "detail": f"Support: {support}"}
    elif price_to_support > 0.85:
        sell_confirmations.append("Price Near Resistance")
        indicator_status["S/R Levels"] = {"value": round(current_price, 5), "signal": "SELL", "detail": f"Resistance: {resistance}"}
    else:
        indicator_status["S/R Levels"] = {"value": round(current_price, 5), "signal": "NEUTRAL", "detail": f"S:{support} R:{resistance}"}

    # Candlestick Pattern
    if pattern_signal == "BUY":
        buy_confirmations.append(f"Pattern: {pattern_name}")
        indicator_status["Candlestick"] = {"value": pattern_name, "signal": "BUY", "detail": pattern_name}
    elif pattern_signal == "SELL":
        sell_confirmations.append(f"Pattern: {pattern_name}")
        indicator_status["Candlestick"] = {"value": pattern_name, "signal": "SELL", "detail": pattern_name}
    else:
        indicator_status["Candlestick"] = {"value": pattern_name, "signal": "NEUTRAL", "detail": pattern_name or "No Pattern"}

    # Heiken Ashi
    if ha and len(ha) >= 2:
        ha_bullish = ha[-1]["close"] > ha[-1]["open"] and ha[-2]["close"] > ha[-2]["open"]
        ha_bearish = ha[-1]["close"] < ha[-1]["open"] and ha[-2]["close"] < ha[-2]["open"]
        if ha_bullish:
            buy_confirmations.append("Heiken Ashi Bullish")
            indicator_status["Heiken Ashi"] = {"value": "Bullish", "signal": "BUY", "detail": "2 consecutive green HA candles"}
        elif ha_bearish:
            sell_confirmations.append("Heiken Ashi Bearish")
            indicator_status["Heiken Ashi"] = {"value": "Bearish", "signal": "SELL", "detail": "2 consecutive red HA candles"}
        else:
            indicator_status["Heiken Ashi"] = {"value": "Mixed", "signal": "NEUTRAL", "detail": "Mixed HA candles"}

    # Trend
    if trend_dir == "UPTREND":
        buy_confirmations.append("Uptrend Confirmed")
        indicator_status["Trend"] = {"value": trend_dir, "signal": "BUY", "detail": f"Strength: {trend_strength_val}%"}
    elif trend_dir == "DOWNTREND":
        sell_confirmations.append("Downtrend Confirmed")
        indicator_status["Trend"] = {"value": trend_dir, "signal": "SELL", "detail": f"Strength: {trend_strength_val}%"}
    else:
        indicator_status["Trend"] = {"value": trend_dir, "signal": "NEUTRAL", "detail": "Sideways Market"}

    # Volume
    if vol_confirmed:
        if len(buy_confirmations) > len(sell_confirmations):
            buy_confirmations.append("Volume Confirmed")
        else:
            sell_confirmations.append("Volume Confirmed")
        indicator_status["Volume"] = {"value": vol_ratio, "signal": "ACTIVE", "detail": f"{vol_ratio}% of avg (High)"}
    else:
        indicator_status["Volume"] = {"value": vol_ratio, "signal": "LOW", "detail": f"{vol_ratio}% of avg (Low)"}

    # ── Determine Final Signal ──
    min_conf = int(settings.get("min_confirmations", 4))
    buy_count = len(buy_confirmations)
    sell_count = len(sell_confirmations)
    total = buy_count + sell_count if (buy_count + sell_count) > 0 else 1

    if buy_count >= min_conf and buy_count > sell_count:
        final_signal = "BUY"
        strength = round((buy_count / total) * 100)
        confirmations = buy_count
        conf_list = buy_confirmations
    elif sell_count >= min_conf and sell_count > buy_count:
        final_signal = "SELL"
        strength = round((sell_count / total) * 100)
        confirmations = sell_count
        conf_list = sell_confirmations
    else:
        final_signal = "WAIT"
        strength = 0
        confirmations = max(buy_count, sell_count)
        conf_list = []

    # Risk Level
    low_thresh = int(settings.get("risk_threshold_low", 60))
    med_thresh = int(settings.get("risk_threshold_medium", 75))
    if strength >= med_thresh:
        risk = "LOW"
    elif strength >= low_thresh:
        risk = "MEDIUM"
    else:
        risk = "HIGH"

    return {
        "asset": asset,
        "signal": final_signal,
        "strength": strength,
        "timeframe": timeframe,
        "risk": risk,
        "confirmations": confirmations,
        "indicators": indicator_status,
        "confirmations_list": conf_list,
        "price": current_price,
        "trend": trend_dir,
        "trend_strength": trend_strength_val,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "candles": candles[-30:],  # Last 30 candles for chart
    }


# ─────────────────────────────────────────────
# FLASK ROUTES
# ─────────────────────────────────────────────
ASSETS = [
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "EUR/GBP",
    "BTC/USD", "ETH/USD", "XRP/USD",
    "EUR/USD-OTC", "GBP/USD-OTC", "USD/CHF", "NZD/USD",
]


@app.route("/")
def index():
    return render_template("index.html", assets=ASSETS)


@app.route("/api/signal")
def api_signal():
    asset = request.args.get("asset", "EUR/USD")
    timeframe = request.args.get("timeframe", "5m")
    settings = get_settings()
    signal_data = generate_signal(asset, timeframe, settings)

    # Save to DB (only actionable signals)
    if signal_data["signal"] != "WAIT":
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("""
            INSERT INTO signals (asset, signal, strength, timeframe, risk, confirmations, indicators, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            signal_data["asset"], signal_data["signal"], signal_data["strength"],
            signal_data["timeframe"], signal_data["risk"], signal_data["confirmations"],
            str(signal_data["confirmations_list"]), signal_data["timestamp"]
        ))
        conn.commit()
        conn.close()

    return jsonify(signal_data)


@app.route("/api/all_signals")
def api_all_signals():
    timeframe = request.args.get("timeframe", "5m")
    settings = get_settings()
    results = []
    for asset in ASSETS:
        sig = generate_signal(asset, timeframe, settings)
        results.append({
            "asset": asset,
            "signal": sig["signal"],
            "strength": sig["strength"],
            "risk": sig["risk"],
            "confirmations": sig["confirmations"],
            "price": sig["price"],
            "trend": sig["trend"],
            "timestamp": sig["timestamp"],
        })
    return jsonify(results)


@app.route("/api/history")
def api_history():
    limit = request.args.get("limit", 50)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT id, asset, signal, strength, timeframe, risk, confirmations, timestamp, result
        FROM signals ORDER BY id DESC LIMIT ?
    """, (limit,))
    rows = c.fetchall()
    conn.close()
    cols = ["id", "asset", "signal", "strength", "timeframe", "risk", "confirmations", "timestamp", "result"]
    return jsonify([dict(zip(cols, r)) for r in rows])


@app.route("/api/stats")
def api_stats():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM signals")
    total = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM signals WHERE result='WIN'")
    wins = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM signals WHERE result='LOSS'")
    losses = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM signals WHERE signal='BUY'")
    buys = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM signals WHERE signal='SELL'")
    sells = c.fetchone()[0]
    conn.close()
    win_rate = round(wins / max(wins + losses, 1) * 100, 1)
    return jsonify({
        "total": total, "wins": wins, "losses": losses,
        "pending": total - wins - losses,
        "buys": buys, "sells": sells, "win_rate": win_rate
    })


@app.route("/api/update_result", methods=["POST"])
def update_result():
    data = request.get_json()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE signals SET result=? WHERE id=?", (data["result"], data["id"]))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "POST":
        data = request.get_json()
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        for key, value in data.items():
            c.execute("UPDATE settings SET value=? WHERE key=?", (str(value), key))
        conn.commit()
        conn.close()
        return jsonify({"status": "saved"})
    return jsonify(get_settings())


if __name__ == "__main__":
    init_db()
    import os

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )
