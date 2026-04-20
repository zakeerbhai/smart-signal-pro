# Smart Signal Pro 📈

A professional trading signal web application for OTC and normal market analysis.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the app
python app.py

# 3. Open browser at
http://localhost:5000
```

## Files
```
smart_signal_pro/
├── app.py                 # Flask backend + all indicator logic
├── requirements.txt
├── templates/
│   └── index.html         # Dashboard UI
└── static/
    ├── style.css          # Dark trading theme
    └── script.js          # Live signals, charts, history
```

## Indicators Used
RSI · MACD · SMA · EMA · Bollinger Bands · Stochastic · Support/Resistance · Heiken Ashi · Candlestick Patterns · Trend Strength · Volume Confirmation

## Signal Logic
- Minimum **4 indicator confirmations** required before a signal fires
- BUY: RSI<30 + MACD bullish + Support touch + Bullish candle + EMA/SMA confirm
- SELL: RSI>70 + MACD bearish + Resistance touch + Bearish pattern + EMA/SMA confirm
- WAIT: Fewer than 4 confirmations — no trade recommended

## Admin Settings
Click ⚙ in the top-right to adjust RSI levels, minimum confirmations, refresh interval, and risk thresholds.

## Win/Loss Tracking
Use the dropdown in Signal History to mark each signal WIN / LOSS. Win rate is computed live in the stats bar.

## To Use Live Data (Production)
Replace `generate_candles()` in `app.py` with a real API call:
- **Forex/OTC**: Polygon.io, Alpha Vantage, TraderMade
- **Crypto**: Binance API (`/api/v3/klines`), CoinGecko
