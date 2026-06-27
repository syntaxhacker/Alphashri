#!/usr/bin/env python3
"""Find financially undervalued NSE stocks using yfinance fundamental data.

Combines TV screener candidates with yfinance fundamentals (P/E, P/B, ROE, D/E).
Scores and ranks by value + quality.
"""
import sys, os, time
from concurrent.futures import ThreadPoolExecutor, as_completed
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
import yfinance as yf; import pandas as pd
from trending_upside import fetch_trending_stocks

FIN_SECTORS = {'financial services', 'financial', 'banks', 'insurance'}

def get_fundamentals(sym):
    try:
        info = yf.Ticker(sym + '.NS').info
        pe = info.get('trailingPE') or info.get('forwardPE')
        pb = info.get('priceToBook')
        roe = info.get('returnOnEquity')
        de = info.get('debtToEquity')
        mcap = info.get('marketCap') or 0
        sector = (info.get('sector') or '')[:30]
        price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
        if roe and roe < 1: roe *= 100
        if pe and 3 <= pe <= 35 and mcap > 1e9:
            return {'symbol': sym, 'price': round(price, 1), 'mcap': mcap,
                    'P/E': round(pe, 1), 'P/B': round(pb, 2) if pb else None,
                    'ROE': round(roe, 1) if roe else None,
                    'D/E': round(de, 1) if de else None, 'sector': sector}
    except: pass
    return None

print("Fetching NSE candidates from TV screener...", file=sys.stderr)
tv = fetch_trending_stocks(limit=200, profile='trending')
if tv is None or tv.empty: print("No data"); sys.exit(1)
symbols = [str(s).upper().strip() for s in tv[tv['close'] > 30]['name'].tolist()][:100]
print(f"  {len(symbols)} stocks, enriching with yfinance...", file=sys.stderr)

results = []
with ThreadPoolExecutor(max_workers=6) as pool:
    futures = {pool.submit(get_fundamentals, s): s for s in symbols}
    for i, f in enumerate(as_completed(futures), 1):
        r = f.result()
        if r: results.append(r)
        if i % 20 == 0: print(f"  {i}/{len(symbols)}...", file=sys.stderr)

if not results: print("No fundamental data"); sys.exit(1)
df = pd.DataFrame(results)
df['mcap_cr'] = df['mcap'] / 1e7
df['is_fin'] = df['sector'].str.lower().str.contains('|'.join(FIN_SECTORS), na=False)

# Filter: sector-aware
filt = df[(df['P/E'].between(3, 25)) & (df['P/B'].between(0.3, 5)) &
          (df['ROE'].fillna(10) > 8)].copy()

# Score
filt['score'] = (
    (25 - filt['P/E'].clip(0, 25)) * 0.35 +
    (4 - filt['P/B'].clip(0, 4)) * 0.25 +
    filt['ROE'].clip(0, 40) * 0.25 +
    (3 - filt['D/E'].fillna(0.5).clip(0, 3)) * 0.15
)
filt = filt.sort_values('score', ascending=False)

# Show all
print(f"\n{'='*130}")
print(f"  💎 UNDERVALUED NSE STOCKS — {len(filt)} found")
print(f"  P/E 3-25 | P/B 0.3-5 | ROE>8% | Sourced from yfinance")
print(f"{'='*130}")
print(f"{'Rank':<5} {'Symbol':<18} {'Price':>8} {'MCap(Cr)':>10} {'P/E':>6} {'P/B':>6} "
      f"{'ROE%':>6} {'D/E':>6} {'Score':>6} {'Sector':<28}")
print("-" * 130)
for i, (_, r) in enumerate(filt.iterrows(), 1):
    roe_s = f"{r['ROE']:.1f}%" if pd.notna(r.get('ROE')) else "  N/A"
    de_s = f"{r['D/E']:.1f}" if pd.notna(r.get('D/E')) else "  N/A"
    print(f"{i:<5} {r['symbol']:<18} {r['price']:>8.1f} {r['mcap_cr']:>9,.0f} "
          f"{r['P/E']:>6.1f} {r['P/B']:>5.2f} {roe_s} {de_s} "
          f"{r['score']:>6.1f} {str(r.get('sector','') or '')[:28]}")

print(f"\n  Avg P/E: {filt['P/E'].mean():.1f} | Avg P/B: {filt['P/B'].mean():.2f} | Avg ROE: {filt['ROE'].mean():.1f}%")
print(f"\n✅ Done", file=sys.stderr)
