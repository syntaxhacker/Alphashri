#!/usr/bin/env python3
"""High-volatility stock screener using TV screener directly.

Filters: market_cap >= 1000Cr, ATR% >= 3.0%, price >= 100, volume > 500K
Outputs sorted list of qualifying stocks.
"""
import sys, os, csv
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SCRIPT_DIR, '..'))
sys.path.insert(0, os.path.join(SCRIPT_DIR, '..', 'scanners'))
sys.path.insert(0, os.path.join(SCRIPT_DIR, '..', 'upstox_trader'))

from trending_upside import fetch_trending_stocks

MIN_MCAP_CR = 1000    # min market cap in Cr
MIN_ATR_PCT = 3.0     # min ATR%
MIN_PRICE = 100       # min price
MIN_VOLUME = 500000   # min volume

print("Fetching volatility_trend stocks from TV...", file=sys.stderr)
df = fetch_trending_stocks(limit=200, profile='volatility_trend')

if df is None or df.empty:
    print("No data returned from TV screener", file=sys.stderr)
    sys.exit(1)

print(f"Raw stocks from TV: {len(df)}", file=sys.stderr)

# Filter
filtered = []
for _, row in df.iterrows():
    mcap = float(row.get('market_cap_basic', 0)) / 1e7  # convert to Cr
    atr_pct = float(row.get('Volatility.D', 0))
    price = float(row.get('close', 0))
    vol = float(row.get('volume', 0))
    adx = float(row.get('ADX', 0))
    rsi = float(row.get('RSI', 0))
    name = str(row.get('name', '?')).upper()

    if mcap < MIN_MCAP_CR: continue
    if atr_pct < MIN_ATR_PCT: continue
    if price < MIN_PRICE: continue
    if vol < MIN_VOLUME: continue

    filtered.append({
        'symbol': name, 'price': price, 'atr_pct': round(atr_pct, 2),
        'adx': round(adx, 1), 'rsi': round(rsi, 1),
        'mcap_cr': round(mcap, 0), 'volume': int(vol),
    })

# Sort by ATR% descending
filtered.sort(key=lambda x: x['atr_pct'], reverse=True)

# Output
print(f"\n{'Rank':<5} {'Symbol':<18} {'Price':>8} {'ATR%':>6} {'ADX':>6} {'RSI':>6} {'MktCap(Cr)':>12} {'Volume':>10}")
print("-" * 75)
for i, s in enumerate(filtered, 1):
    print(f"{i:<5} {s['symbol']:<18} {s['price']:>8.1f} {s['atr_pct']:>5.1f}% {s['adx']:>6.1f} {s['rsi']:>6.1f} {s['mcap_cr']:>10.0f} {s['volume']:>10}")

# Save CSV
csv_path = os.path.join(os.path.dirname(__file__), '..', 'experiments', 'data', 'high_vol_stocks.csv')
os.makedirs(os.path.dirname(csv_path), exist_ok=True)
with open(csv_path, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=['symbol','price','atr_pct','adx','rsi','mcap_cr','volume'])
    w.writeheader()
    w.writerows(filtered)

print(f"\n✅ {len(filtered)} stocks passed filters. Saved to {csv_path}", file=sys.stderr)
print(f"\nTop 10 by ATR%:")
for s in filtered[:10]:
    print(f"  {s['symbol']:<18} ATR={s['atr_pct']:>5.1f}% ADX={s['adx']:>5.1f} RSI={s['rsi']:>5.1f} MCap={s['mcap_cr']:>8.0f}Cr")
