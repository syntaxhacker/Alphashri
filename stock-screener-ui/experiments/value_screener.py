#!/usr/bin/env python3
"""Find financially undervalued NSE stocks via TV screener.

Uses correct TV field names from tv_fields.md:
  price_earnings_ttm, price_book_ratio, return_on_equity,
  debt_to_equity, dividend_yield_recent, current_ratio
"""
import sys, os; import pandas as pd
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(SCRIPT_DIR), 'upstox_trader', 'screeners'))

from tradingview_screener import Query, col

try:
    from tv_helpers import get_tradingview_cookies
    cookies = get_tradingview_cookies(quiet=True)
except:
    cookies = None

print("Fetching undervalued NSE stocks from TV...", file=sys.stderr)

try:
    _, df = (
        Query()
        .select(
            'name', 'close', 'volume', 'market_cap_basic', 'sector',
            'price_earnings_ttm',      # P/E
            'price_book_ratio',        # P/B
            'return_on_equity',        # ROE
            'debt_to_equity',          # D/E
            'dividend_yield_recent',   # Div yield
            'current_ratio',
        )
        .set_markets('india')
        .where(
            col('close') > 30,
            col('volume') > 100000,
            col('market_cap_basic') > 1_000_000_000,  # 100Cr+
            col('price_earnings_ttm').between(3, 20),
            col('price_book_ratio').between(0.3, 5),
            col('return_on_equity') > 8,
            col('debt_to_equity') < 1.5,
            col('exchange') == 'NSE',
        )
        .order_by('price_earnings_ttm', ascending=True)
        .limit(100)
        .get_scanner_data(cookies=cookies)
    )
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)

if df is None or df.empty:
    print("No stocks found with strict filters — relaxing...", file=sys.stderr)
    try:
        _, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'market_cap_basic', 'sector',
                'price_earnings_ttm', 'price_book_ratio', 'return_on_equity',
                'debt_to_equity', 'dividend_yield_recent',
            )
            .set_markets('india')
            .where(
                col('close') > 20, col('volume') > 50000,
                col('market_cap_basic') > 500_000_000,
                col('price_earnings_ttm').between(3, 25),
                col('price_book_ratio') < 5,
                col('return_on_equity') > 6,
                col('debt_to_equity') < 2,
                col('exchange') == 'NSE',
            )
            .order_by('price_earnings_ttm', ascending=True)
            .limit(100)
            .get_scanner_data(cookies=cookies)
        )
    except Exception as e:
        print(f"Relaxed query also failed: {e}", file=sys.stderr)
        sys.exit(1)

if df is None or df.empty:
    print("No stocks found", file=sys.stderr)
    sys.exit(1)

# Clean & score
df['mcap_cr'] = df['market_cap_basic'] / 1e7
df['name'] = df['name'].str.replace('NSE:', '', regex=False)

# Handle missing P/B for banks (will be NaN for some)
df['price_book_ratio'] = df['price_book_ratio'].fillna(3)  # assume moderate P/B for banks
df['debt_to_equity'] = df['debt_to_equity'].fillna(0.5)

df['value_score'] = (
    (20 - df['price_earnings_ttm'].clip(0, 20)) * 0.35 +
    (4 - df['price_book_ratio'].clip(0, 4)) * 0.20 +
    df['return_on_equity'].clip(0, 40) * 0.25 +
    (2 - df['debt_to_equity'].clip(0, 2)) * 0.20
)
df = df.sort_values('value_score', ascending=False)

print(f"\n{'='*150}")
print(f"  💎 UNDERVALUED NSE STOCKS (TV Fundamental Fields) — {len(df)} found")
print(f"  P/E 3-25 | P/B <5 | ROE>6% | D/E<2 | Vol>50K")
print(f"{'='*150}")
print(f"{'Rank':<5} {'Symbol':<20} {'Price':>8} {'MCap(Cr)':>10} {'P/E':>6} {'P/B':>6} "
      f"{'ROE%':>6} {'D/E':>6} {'Div%':>6} {'Score':>6}")
print("-" * 150)

for i, (_, r) in enumerate(df.head(35).iterrows(), 1):
    pe = f"{r['price_earnings_ttm']:.1f}"
    pb = f"{r['price_book_ratio']:.2f}" if pd.notna(r.get('price_book_ratio')) else "  N/A"
    roe = f"{r['return_on_equity']:.1f}%"
    de = f"{r['debt_to_equity']:.2f}" if pd.notna(r.get('debt_to_equity')) else "  N/A"
    dy = f"{r['dividend_yield_recent']:.1f}%" if pd.notna(r.get('dividend_yield_recent')) and r['dividend_yield_recent'] > 0 else "     "
    name = str(r['name'])[:20]
    print(f"{i:<5} {name:<20} {r['close']:>8.1f} {r['mcap_cr']:>9,.0f} "
          f"{pe:>6} {pb:>6} {roe:>6} {de:>6} {dy:>6} {r['value_score']:>6.1f}")

print(f"\n  Avg P/E: {df['price_earnings_ttm'].mean():.1f} | Avg ROE: {df['return_on_equity'].mean():.1f}%")
print(f"✅ {len(df)} undervalued stocks from TV screener", file=sys.stderr)
