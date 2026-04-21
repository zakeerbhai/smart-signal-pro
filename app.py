"""
Smart Signal Pro v2 — Flask Backend
UPGRADED: Analyses past 100 candles, predicts next 5-15 min price direction
using multi-indicator confluence + momentum projection engine.
"""

from flask import Flask, render_template, jsonify, request
import sqlite3
import math
import random
import time
import requests
from datetime import datetime

app = Flask(__name__)
DB_PATH = "signals.db"

# ─────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset TEXT, signal TEXT, strength INTEGER,
            timeframe TEXT, risk TEXT, confirmations INTEGER,
            predicted_high REAL, predicted_low REAL, predicted_close REAL,
            indicators TEXT, timestamp TEXT, result TEXT DEFAULT 'PENDING'
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT
        )
    """)
    defaults = [
        ("rsi_oversold","30"),("rsi_overbought","70"),
        ("min_confirmations","4"),("signal_interval","300"),
        ("risk_threshold_low","60"),("risk_threshold_medium","75"),
    ]
    for k,v in defaults:
        c.execute("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)",(k,v))
    conn.commit(); conn.close()

def get_settings():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT key,value FROM settings")
    s = {r[0]:r[1] for r in c.fetchall()}
    conn.close(); return s


# ─────────────────────────────────────────────
# CANDLE GENERATION  (stable 5-min seed window)
# ─────────────────────────────────────────────
BASE_PRICES = {
    "EUR/USD":1.0850,"GBP/USD":1.2650,"USD/JPY":149.50,
    "AUD/USD":0.6580,"EUR/GBP":0.8580,
    "BTC/USD":67500.0,"ETH/USD":3400.0,"XRP/USD":0.5820,
    "EUR/USD-OTC":1.0848,"GBP/USD-OTC":1.2648,
    "USD/CHF":0.9020,"NZD/USD":0.6080,
}

import requests

def generate_candles(asset, n=120):
    API_KEY = "QDPMSJTAE3WVURK3"

    symbol = asset.replace("/", "").replace("-OTC", "")

    if len(symbol) < 6:
        return []

    from_symbol = symbol[:3]
    to_symbol = symbol[3:]

    url = f"https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol={from_symbol}&to_symbol={to_symbol}&interval=5min&apikey={API_KEY}&outputsize=compact"

    response = requests.get(url)
    data = response.json()

    series = data.get("Time Series FX (5min)", {})

    candles = []

    for ts, v in list(series.items())[:n]:
        candles.append({
            "open": float(v["1. open"]),
            "high": float(v["2. high"]),
            "low": float(v["3. low"]),
            "close": float(v["4. close"]),
            "volume": 1000
        })

    return list(reversed(candles))


# ─────────────────────────────────────────────
# TECHNICAL INDICATORS
# ─────────────────────────────────────────────
def calc_rsi(closes, period=14):
    if len(closes) < period + 1: return 50.0
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = closes[-i] - closes[-i-1]
        if d > 0: gains += d
        else: losses -= d
    ag = gains / period or 0.0001
    al = losses / period or 0.0001
    return round(100 - (100 / (1 + ag/al)), 2)

def calc_sma(closes, p):
    if len(closes) < p: return closes[-1]
    return round(sum(closes[-p:]) / p, 6)

def calc_ema(closes, p):
    if len(closes) < p: return closes[-1]
    k = 2 / (p + 1)
    e = sum(closes[:p]) / p
    for c in closes[p:]:
        e = c * k + e * (1 - k)
    return round(e, 6)

def calc_macd(closes):
    if len(closes) < 35: return 0,0,0
    ema12 = calc_ema(closes, 12)
    ema26 = calc_ema(closes, 26)
    ml = ema12 - ema26
    # proper 9-bar signal
    ml_series = []
    for i in range(9, 0, -1):
        sl = closes[:-i] if i < len(closes) else closes
        ml_series.append(calc_ema(sl,12) - calc_ema(sl,26))
    sl = calc_ema(ml_series, 9)
    return round(ml,6), round(sl,6), round(ml-sl,6)

def calc_bollinger(closes, p=20, sd=2):
    if len(closes) < p: return closes[-1], closes[-1], closes[-1]
    m = calc_sma(closes, p)
    std = math.sqrt(sum((c-m)**2 for c in closes[-p:]) / p)
    return round(m+sd*std,6), round(m,6), round(m-sd*std,6)

def calc_stochastic(candles, kp=14):
    if len(candles) < kp: return 50.0, 50.0
    sl = candles[-kp:]
    H, L = max(c["high"] for c in sl), min(c["low"] for c in sl)
    close = candles[-1]["close"]
    k = round(((close-L)/(H-L))*100, 2) if H != L else 50.0
    # D = 3-bar SMA of K
    ks = []
    for i in range(3):
        sub = candles[-(kp+i): -i or len(candles)]
        H2,L2 = max(c["high"] for c in sub), min(c["low"] for c in sub)
        cl2 = candles[-1-i]["close"]
        ks.append(((cl2-L2)/(H2-L2))*100 if H2!=L2 else 50)
    return k, round(sum(ks)/3, 2)

def calc_atr(candles, p=14):
    """Average True Range — measures volatility for price projection"""
    if len(candles) < p+1: return 0
    trs = []
    for i in range(1, p+1):
        c = candles[-i]; prev = candles[-i-1]
        tr = max(c["high"]-c["low"],
                 abs(c["high"]-prev["close"]),
                 abs(c["low"]-prev["close"]))
        trs.append(tr)
    return round(sum(trs)/p, 6)

def calc_momentum(closes, p=10):
    """Price momentum: rate of change over p bars"""
    if len(closes) < p+1: return 0
    return round((closes[-1] - closes[-p-1]) / closes[-p-1] * 100, 4)

def calc_support_resistance(candles, lb=30):
    highs = [c["high"] for c in candles[-lb:]]
    lows  = [c["low"]  for c in candles[-lb:]]
    return round(min(lows),6), round(max(highs),6)

def calc_heiken_ashi(candles):
    if len(candles) < 5: return None
    ha = []
    po = (candles[0]["open"] + candles[0]["close"]) / 2
    pc = (candles[0]["open"] + candles[0]["high"] + candles[0]["low"] + candles[0]["close"]) / 4
    for c in candles[-5:]:
        hc = (c["open"]+c["high"]+c["low"]+c["close"]) / 4
        ho = (po + pc) / 2
        ha.append({"open":ho,"close":hc,
                   "high":max(c["high"],ho,hc),
                   "low":min(c["low"],ho,hc)})
        po, pc = ho, hc
    return ha

def detect_pattern(candles):
    if len(candles) < 3: return "None","NEUTRAL"
    c, p, pp = candles[-1], candles[-2], candles[-3]
    body  = abs(c["close"]-c["open"])
    rng   = c["high"]-c["low"] or 0.0001
    uw    = c["high"] - max(c["open"],c["close"])
    lw    = min(c["open"],c["close"]) - c["low"]

    if body/rng < 0.1:                                   return "Doji","NEUTRAL"
    if lw>body*2 and uw<body*0.5 and c["close"]>c["open"]: return "Hammer","BUY"
    if uw>body*2 and lw<body*0.5 and c["close"]<c["open"]: return "Shooting Star","SELL"
    if (p["close"]<p["open"] and c["close"]>c["open"]
        and c["open"]<p["close"] and c["close"]>p["open"]): return "Bullish Engulfing","BUY"
    if (p["close"]>p["open"] and c["close"]<c["open"]
        and c["open"]>p["close"] and c["close"]<p["open"]): return "Bearish Engulfing","SELL"
    # Morning Star
    if (pp["close"]<pp["open"] and abs(p["close"]-p["open"])<body*0.3
        and c["close"]>c["open"] and c["close"]>pp["open"]):
        return "Morning Star","BUY"
    # Evening Star
    if (pp["close"]>pp["open"] and abs(p["close"]-p["open"])<body*0.3
        and c["close"]<c["open"] and c["close"]<pp["open"]):
        return "Evening Star","SELL"
    if body/rng > 0.85 and c["close"]>c["open"]: return "Bull Marubozu","BUY"
    if body/rng > 0.85 and c["close"]<c["open"]: return "Bear Marubozu","SELL"
    return "None","NEUTRAL"

def calc_trend(closes, short=10, long=30):
    if len(closes) < long: return "SIDEWAYS", 0
    es, el = calc_ema(closes, short), calc_ema(closes, long)
    diff = (es - el) / el * 100
    if diff >  0.05: return "UPTREND",   round(min(abs(diff)*80, 100),1)
    if diff < -0.05: return "DOWNTREND", round(min(abs(diff)*80, 100),1)
    return "SIDEWAYS", round(abs(diff)*80, 1)

def volume_ok(candles, lb=10):
    avg = sum(c["volume"] for c in candles[-lb:]) / lb
    cur = candles[-1]["volume"]
    return cur > avg * 1.2, round(cur/avg*100, 1)


# ─────────────────────────────────────────────
# ★ PREDICTION ENGINE ★
# Analyses 120 historical candles → predicts
# next 5-15 min price range + direction
# ─────────────────────────────────────────────
def predict_next_candles(candles, signal_direction, atr, n_bars=3):
    """
    Projects next n_bars candle price levels using:
    - ATR-based range expansion
    - Momentum continuation probability
    - Support/Resistance magnetic levels
    - EMA slope extrapolation

    Returns list of projected OHLC candles + confidence band.
    """
    closes = [c["close"] for c in candles]
    last   = candles[-1]["close"]
    support, resistance = calc_support_resistance(candles)
    ema9   = calc_ema(closes, 9)
    mom    = calc_momentum(closes, 10)

    # EMA slope (pips per bar)
    ema_slope = (calc_ema(closes[-5:], 3) - calc_ema(closes[-10:-5], 3)) / 5

    projected = []
    price = last

    for i in range(1, n_bars + 1):
        # Base move: EMA slope + momentum carry
        if signal_direction == "BUY":
            base_move = abs(ema_slope) * 1.2 + atr * 0.08 * i
        elif signal_direction == "SELL":
            base_move = -(abs(ema_slope) * 1.2 + atr * 0.08 * i)
        else:
            base_move = ema_slope * 0.5

        # Resistance/support gravity
        if signal_direction == "BUY" and price > resistance * 0.998:
            base_move *= 0.4   # slow near resistance
        if signal_direction == "SELL" and price < support * 1.002:
            base_move *= 0.4   # slow near support

        proj_close = round(price + base_move, 6)
        proj_high  = round(proj_close + atr * 0.6, 6)
        proj_low   = round(proj_close - atr * 0.6, 6)

        if signal_direction == "BUY":
            proj_high = round(proj_close + atr * 0.9, 6)
            proj_low  = round(proj_close - atr * 0.3, 6)
        elif signal_direction == "SELL":
            proj_high = round(proj_close + atr * 0.3, 6)
            proj_low  = round(proj_close - atr * 0.9, 6)

        projected.append({
            "bar": i,
            "open":  round(price, 6),
            "high":  proj_high,
            "low":   proj_low,
            "close": proj_close,
            "is_prediction": True
        })
        price = proj_close

    # Confidence band (wider = lower confidence)
    final_proj = projected[-1]["close"]
    band_half  = atr * 1.5
    return {
        "candles":        projected,
        "predicted_high": round(final_proj + band_half, 6),
        "predicted_low":  round(final_proj - band_half, 6),
        "predicted_close": round(final_proj, 6),
        "target_pips":    round(abs(final_proj - last) / last * 10000, 1),
        "atr_pips":       round(atr / last * 10000, 1),
    }

def calc_entry_timing(signal, timeframe, strength):
    """Suggest optimal entry window based on signal quality."""
    tf_map = {"1m":1,"5m":5,"15m":15,"30m":30}
    base   = tf_map.get(timeframe, 5)

    if strength >= 80:
        entry_in = "Now — within 30 seconds"
        expiry   = base
        quality  = "STRONG"
    elif strength >= 70:
        entry_in = f"Within next {base} candle close"
        expiry   = base * 2
        quality  = "GOOD"
    else:
        entry_in = "Wait for next candle confirmation"
        expiry   = base * 3
        quality  = "WEAK"

    return {
        "entry_in": entry_in,
        "expiry_minutes": expiry,
        "quality": quality,
        "recommended_tf": "5m" if base < 5 else timeframe
    }


# ─────────────────────────────────────────────
# MAIN SIGNAL ENGINE
# ─────────────────────────────────────────────
def generate_signal(asset, timeframe, settings):
    candles = generate_candles(asset, n=120)
    closes  = [c["close"] for c in candles]

    rsi_os  = float(settings.get("rsi_oversold",  30))
    rsi_ob  = float(settings.get("rsi_overbought",70))

    # ── Compute all indicators ──
    rsi_val              = calc_rsi(closes)
    sma20                = calc_sma(closes, 20)
    sma50                = calc_sma(closes, 50)
    ema9                 = calc_ema(closes, 9)
    ema21                = calc_ema(closes, 21)
    ml, sl_line, hist    = calc_macd(closes)
    bb_up, bb_mid, bb_lo = calc_bollinger(closes)
    stk, std             = calc_stochastic(candles)
    support, resistance  = calc_support_resistance(candles)
    patt_name, patt_sig  = detect_pattern(candles)
    ha                   = calc_heiken_ashi(candles)
    trend_dir, t_str     = calc_trend(closes)
    vol_ok, vol_ratio    = volume_ok(candles)
    atr                  = calc_atr(candles)
    momentum             = calc_momentum(closes)
    current_price        = closes[-1]

    # ── Score indicators ──
    buy_c, sell_c  = [], []
    ind_status     = {}

    # RSI
    if rsi_val < rsi_os:
        buy_c.append("RSI Oversold")
        ind_status["RSI"] = {"signal":"BUY","detail":f"{rsi_val} — Oversold"}
    elif rsi_val > rsi_ob:
        sell_c.append("RSI Overbought")
        ind_status["RSI"] = {"signal":"SELL","detail":f"{rsi_val} — Overbought"}
    else:
        ind_status["RSI"] = {"signal":"NEUTRAL","detail":f"{rsi_val} — Neutral"}

    # MACD
    if ml > sl_line and hist > 0:
        buy_c.append("MACD Bullish Crossover")
        ind_status["MACD"] = {"signal":"BUY","detail":f"Hist +{round(hist,5)}"}
    elif ml < sl_line and hist < 0:
        sell_c.append("MACD Bearish Crossover")
        ind_status["MACD"] = {"signal":"SELL","detail":f"Hist {round(hist,5)}"}
    else:
        ind_status["MACD"] = {"signal":"NEUTRAL","detail":"No crossover"}

    # SMA
    if sma20 > sma50:
        buy_c.append("SMA Golden Cross")
        ind_status["SMA"] = {"signal":"BUY","detail":"SMA20 > SMA50"}
    else:
        sell_c.append("SMA Death Cross")
        ind_status["SMA"] = {"signal":"SELL","detail":"SMA20 < SMA50"}

    # EMA
    if ema9 > ema21:
        buy_c.append("EMA Bullish Cross")
        ind_status["EMA"] = {"signal":"BUY","detail":"EMA9 > EMA21"}
    else:
        sell_c.append("EMA Bearish Cross")
        ind_status["EMA"] = {"signal":"SELL","detail":"EMA9 < EMA21"}

    # Bollinger
    if current_price <= bb_lo:
        buy_c.append("BB Lower Band Bounce")
        ind_status["Bollinger"] = {"signal":"BUY","detail":"Price at Lower Band"}
    elif current_price >= bb_up:
        sell_c.append("BB Upper Band Rejection")
        ind_status["Bollinger"] = {"signal":"SELL","detail":"Price at Upper Band"}
    else:
        bp = round((current_price-bb_lo)/(bb_up-bb_lo)*100,1)
        ind_status["Bollinger"] = {"signal":"NEUTRAL","detail":f"Band position {bp}%"}

    # Stochastic
    if stk < 20 and std < 20:
        buy_c.append("Stochastic Oversold")
        ind_status["Stochastic"] = {"signal":"BUY","detail":f"K:{stk} D:{std}"}
    elif stk > 80 and std > 80:
        sell_c.append("Stochastic Overbought")
        ind_status["Stochastic"] = {"signal":"SELL","detail":f"K:{stk} D:{std}"}
    else:
        ind_status["Stochastic"] = {"signal":"NEUTRAL","detail":f"K:{stk} D:{std}"}

    # Support / Resistance
    sr_pos = (current_price-support)/(resistance-support) if resistance!=support else 0.5
    if sr_pos < 0.15:
        buy_c.append("Price at Support")
        ind_status["S/R"] = {"signal":"BUY","detail":f"Support: {support}"}
    elif sr_pos > 0.85:
        sell_c.append("Price at Resistance")
        ind_status["S/R"] = {"signal":"SELL","detail":f"Resist: {resistance}"}
    else:
        ind_status["S/R"] = {"signal":"NEUTRAL","detail":f"S:{support} R:{resistance}"}

    # Candlestick pattern
    if patt_sig == "BUY":
        buy_c.append(f"Pattern: {patt_name}")
        ind_status["Candle"] = {"signal":"BUY","detail":patt_name}
    elif patt_sig == "SELL":
        sell_c.append(f"Pattern: {patt_name}")
        ind_status["Candle"] = {"signal":"SELL","detail":patt_name}
    else:
        ind_status["Candle"] = {"signal":"NEUTRAL","detail":patt_name or "No pattern"}

    # Heiken Ashi
    if ha and len(ha) >= 2:
        ha_bull = ha[-1]["close"]>ha[-1]["open"] and ha[-2]["close"]>ha[-2]["open"]
        ha_bear = ha[-1]["close"]<ha[-1]["open"] and ha[-2]["close"]<ha[-2]["open"]
        if ha_bull:
            buy_c.append("Heiken Ashi Bullish")
            ind_status["HeikenAshi"] = {"signal":"BUY","detail":"2 green HA bars"}
        elif ha_bear:
            sell_c.append("Heiken Ashi Bearish")
            ind_status["HeikenAshi"] = {"signal":"SELL","detail":"2 red HA bars"}
        else:
            ind_status["HeikenAshi"] = {"signal":"NEUTRAL","detail":"Mixed HA"}

    # Trend
    if trend_dir == "UPTREND":
        buy_c.append("Uptrend Confirmed")
        ind_status["Trend"] = {"signal":"BUY","detail":f"Strength {t_str}%"}
    elif trend_dir == "DOWNTREND":
        sell_c.append("Downtrend Confirmed")
        ind_status["Trend"] = {"signal":"SELL","detail":f"Strength {t_str}%"}
    else:
        ind_status["Trend"] = {"signal":"NEUTRAL","detail":"Sideways"}

    # Momentum
    if momentum > 0.05:
        buy_c.append("Positive Momentum")
        ind_status["Momentum"] = {"signal":"BUY","detail":f"ROC +{momentum}%"}
    elif momentum < -0.05:
        sell_c.append("Negative Momentum")
        ind_status["Momentum"] = {"signal":"SELL","detail":f"ROC {momentum}%"}
    else:
        ind_status["Momentum"] = {"signal":"NEUTRAL","detail":f"ROC {momentum}%"}

    # Volume
    if vol_ok:
        (buy_c if len(buy_c)>len(sell_c) else sell_c).append("Volume Spike")
        ind_status["Volume"] = {"signal":"ACTIVE","detail":f"{vol_ratio}% of avg"}
    else:
        ind_status["Volume"] = {"signal":"LOW","detail":f"{vol_ratio}% of avg"}

    # ── Final signal decision ──
    min_conf   = int(settings.get("min_confirmations", 4))
    buy_count  = len(buy_c)
    sell_count = len(sell_c)
    total      = buy_count + sell_count or 1

    if buy_count >= min_conf and buy_count > sell_count:
        final_sig  = "BUY"
        strength   = round(buy_count / total * 100)
        conf_count = buy_count
        conf_list  = buy_c
    elif sell_count >= min_conf and sell_count > buy_count:
        final_sig  = "SELL"
        strength   = round(sell_count / total * 100)
        conf_count = sell_count
        conf_list  = sell_c
    else:
        final_sig  = "WAIT"
        strength   = 0
        conf_count = max(buy_count, sell_count)
        conf_list  = []

    lo = int(settings.get("risk_threshold_low",  60))
    me = int(settings.get("risk_threshold_medium",75))
    risk = "LOW" if strength >= me else "MEDIUM" if strength >= lo else "HIGH"

    # ── PREDICTION ENGINE ──
    prediction  = predict_next_candles(candles, final_sig, atr, n_bars=3)
    entry_info  = calc_entry_timing(final_sig, timeframe, strength)

    # ── Return everything ──
    prediction = predict_next_candles(candles)

    entry_timing = calc_entry_timing(
        signal,
        prediction["confidence"]
    )

    expiry = calc_expiry_suggestion(
        prediction["confidence"]
    )
    return {
        "asset":            asset,
        "signal":           final_sig,
        "strength":         strength,
        "timeframe":        timeframe,
        "risk":             risk,
        "confirmations":    conf_count,
        "confirmations_list": conf_list,
        "indicators":       ind_status,
        "price":            current_price,
        "trend":            trend_dir,
        "trend_strength":   t_str,
        "atr":              atr,
        "momentum":         momentum,
        "support":          support,
        "resistance":       resistance,
        "timestamp":        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        # Historical candles (last 40) + 3 predicted candles
        "candles":          candles[-40:],
        "predicted_candles": prediction["candles"],
        "predicted_high":   prediction["predicted_high"],
        "predicted_low":    prediction["predicted_low"],
        "predicted_close":  prediction["predicted_close"],
        "target_pips":      prediction["target_pips"],
        "atr_pips":         prediction["atr_pips"],
        # Entry timing
        "entry_in":         entry_info["entry_in"],
        "expiry_minutes":   entry_info["expiry_minutes"],
        "entry_quality":    entry_info["quality"],
        "predicted_close": prediction["predicted_close"],
        "predicted_high": prediction["predicted_high"],
        "predicted_low": prediction["predicted_low"],
        "target_pips": prediction["target_pips"],
        "confidence_score": prediction["confidence"],
        "entry_timing": entry_timing,
        "expiry_suggestion": expiry,
        }

def predict_next_candles(candles):
    if len(candles) < 20:
        return {
            "predicted_close": 0,
            "predicted_high": 0,
            "predicted_low": 0,
            "target_pips": 0,
            "confidence": 50
        }

    closes = [c["close"] for c in candles[-20:]]
    highs = [c["high"] for c in candles[-20:]]
    lows = [c["low"] for c in candles[-20:]]

    last_close = closes[-1]

    avg_move = sum([
        abs(closes[i] - closes[i - 1])
        for i in range(1, len(closes))
    ]) / (len(closes) - 1)

    trend_strength = closes[-1] - closes[0]

    predicted_close = last_close + (avg_move if trend_strength > 0 else -avg_move)
    predicted_high = max(highs[-5:]) + avg_move
    predicted_low = min(lows[-5:]) - avg_move

    target_pips = round(abs(predicted_close - last_close) * 10000, 1)

    confidence = min(95, max(60, int(abs(trend_strength) * 10000)))
    prediction = predict_next_candles(candles)

    entry_timing = calc_entry_timing(
        signal,
        prediction["confidence"]
    )

    expiry = calc_expiry_suggestion(
        prediction["confidence"]
    )
    return {
                "asset": asset,
        "signal": signal,
        "strength": strength,
        "predicted_close": prediction["predicted_close"],
        "predicted_high": prediction["predicted_high"],
        "predicted_low": prediction["predicted_low"],
        "target_pips": prediction["target_pips"],
        "confidence_score": prediction["confidence"],
        "entry_timing": entry_timing,
        "expiry_suggestion": expiry
    }


def calc_entry_timing(signal, confidence):
    if confidence >= 85:
        return "ENTER NOW"
    elif confidence >= 70:
        return "WAIT NEXT CANDLE"
    else:
        return "NO TRADE"


def calc_expiry_suggestion(confidence):
    if confidence >= 85:
        return "5 Minutes"
    elif confidence >= 70:
        return "10 Minutes"
    else:
        return "15 Minutes"
# ─────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────
ASSETS = [
    "EUR/USD","GBP/USD","USD/JPY","AUD/USD","EUR/GBP",
    "BTC/USD","ETH/USD","XRP/USD",
    "EUR/USD-OTC","GBP/USD-OTC","USD/CHF","NZD/USD",
]

@app.route("/")
def index():
    return render_template("index.html", assets=ASSETS)

@app.route("/api/signal")
def api_signal():
    asset     = request.args.get("asset","EUR/USD")
    timeframe = request.args.get("timeframe","5m")
    settings  = get_settings()
    data      = generate_signal(asset, timeframe, settings)

    if data["signal"] != "WAIT":
        conn = sqlite3.connect(DB_PATH)
        c    = conn.cursor()
        c.execute("""
            INSERT INTO signals
            (asset,signal,strength,timeframe,risk,confirmations,
             predicted_high,predicted_low,predicted_close,indicators,timestamp)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (
            data["asset"], data["signal"], data["strength"],
            data["timeframe"], data["risk"], data["confirmations"],
            data["predicted_high"], data["predicted_low"], data["predicted_close"],
            str(data["confirmations_list"]), data["timestamp"]
        ))
        conn.commit(); conn.close()

    return jsonify(data)

@app.route("/api/all_signals")
def api_all_signals():
    tf       = request.args.get("timeframe","5m")
    settings = get_settings()
    results  = []
    for asset in ASSETS:
        d = generate_signal(asset, tf, settings)
        results.append({
            "asset":            d["asset"],
            "signal":           d["signal"],
            "strength":         d["strength"],
            "risk":             d["risk"],
            "confirmations":    d["confirmations"],
            "price":            d["price"],
            "trend":            d["trend"],
            "predicted_close":  d["predicted_close"],
            "target_pips":      d["target_pips"],
            "entry_in":         d["entry_in"],
            "expiry_minutes":   d["expiry_minutes"],
            "entry_quality":    d["entry_quality"],
            "timestamp":        d["timestamp"],
        })
    return jsonify(results)

@app.route("/api/history")
def api_history():
    limit = request.args.get("limit", 50)
    conn  = sqlite3.connect(DB_PATH)
    c     = conn.cursor()
    c.execute("""
        SELECT id,asset,signal,strength,timeframe,risk,confirmations,
               predicted_high,predicted_low,predicted_close,timestamp,result
        FROM signals ORDER BY id DESC LIMIT ?
    """, (limit,))
    rows = c.fetchall()
    conn.close()
    cols = ["id","asset","signal","strength","timeframe","risk","confirmations",
            "predicted_high","predicted_low","predicted_close","timestamp","result"]
    return jsonify([dict(zip(cols,r)) for r in rows])

@app.route("/api/stats")
def api_stats():
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute("SELECT COUNT(*) FROM signals"); total = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM signals WHERE result='WIN'"); wins = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM signals WHERE result='LOSS'"); losses = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM signals WHERE signal='BUY'"); buys = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM signals WHERE signal='SELL'"); sells = c.fetchone()[0]
    conn.close()
    return jsonify({
        "total":total,"wins":wins,"losses":losses,
        "pending":total-wins-losses,"buys":buys,"sells":sells,
        "win_rate": round(wins/max(wins+losses,1)*100,1)
    })

@app.route("/api/update_result", methods=["POST"])
def update_result():
    data = request.get_json()
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute("UPDATE signals SET result=? WHERE id=?", (data["result"], data["id"]))
    conn.commit(); conn.close()
    return jsonify({"status":"ok"})

@app.route("/api/settings", methods=["GET","POST"])
def api_settings():
    if request.method == "POST":
        data = request.get_json()
        conn = sqlite3.connect(DB_PATH)
        c    = conn.cursor()
        for k,v in data.items():
            c.execute("UPDATE settings SET value=? WHERE key=?",(str(v),k))
        conn.commit(); conn.close()
        return jsonify({"status":"saved"})
    return jsonify(get_settings())

if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)

