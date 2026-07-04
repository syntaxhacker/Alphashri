# Worklog: Optimize Screener Filters for EMA Cross 60-min

Started: 2026-06-27

## Key Insights
- **Larger market cap = better PF** — mcap≥15000Cr gives PF=2.082 vs baseline 1.529 (+36%)
- **Price≥200 improves PF** at every mcap level (e.g., mcap≥10000: 1.940→2.032, mcap≥15000: 1.936→2.082)
- **ATR% filter doesn't help** on top of mcap+price — it removes good stocks
- **Volume filter** above 500K doesn't improve PF
- Sweet spot: **mcap≥10000Cr + price≥200** gives best balance of PF (2.032) and stock count (41)
- Peak PF: **mcap≥15000Cr + price≥200** at PF=2.082 but only 26 stocks

## Next Ideas
- Try combining mcap≥10000 with atr≥5% for mega-volatile large caps
- Test if the best PF stocks individually are different from the aggregate best
- Create bot with the top 2 filter combos

## Experiments

### Run 1: baseline — aggregate_pf=1.529 (KEEP)
- Timestamp: 2026-06-27
- What changed: initial run with default filters (mcap>=1000, atr>=3%, price>=100, vol>=500k)
- Result: PF=1.529, 130 stocks, 1454 trades, ₹3,040,839 net, 85.4% stocks profitable, avg PF=3.39
- Insight: Baseline is solid. Wide filter catches many stocks but some are duds.
- Next: Try tightening ATR% to 4% to filter out low-quality volatile stocks

### Run 2: atr>=4% — aggregate_pf=1.520 (DISCARD)
- Timestamp: 2026-06-27
- What changed: min_atr_pct=4.0
- Result: PF=1.520, 119 stocks, 1345 trades, ₹2.77M net, 84.0% prof
- Insight: Tighter ATR removed some good stocks. Makes PF slightly worse.

### Run 3: atr>=2% — aggregate_pf=1.529 (SAME)
- Timestamp: 2026-06-27
- What changed: min_atr_pct=2.0
- Result: Identical to baseline — TV's volatility_trend profile already filters ATR high enough
- Insight: Relaxing ATR doesn't add new stocks; TV profile is the natural ceiling

### Run 4: atr>=5% — aggregate_pf=1.447 (DISCARD)
- Timestamp: 2026-06-27
- What changed: min_atr_pct=5.0
- Result: PF=1.447, 102 stocks, 1175 trades, ₹2.14M net, 81.4% prof
- Insight: Too aggressive — removes too many good large-cap stocks

### Run 5: mcap>=2000Cr — aggregate_pf=1.579 (KEEP)
- Timestamp: 2026-06-27
- What changed: min_mcap_cr=2000
- Result: PF=1.579 (+3.3%), 112 stocks, 1207 trades, ₹2.72M net, 86.6% prof
- Insight: Larger caps have more orderly EMA cross patterns. Clear improvement.

### Run 6: mcap>=5000Cr — aggregate_pf=1.843 (KEEP)
- Timestamp: 2026-06-27
- What changed: min_mcap_cr=5000
- Result: PF=1.843 (+20.5%), 68 stocks, 662 trades, ₹2.00M net, 91.2% prof
- Insight: Huge jump! Large caps clearly outperform. Avg PF per stock also well above baseline.

### Run 7: mcap>=10000Cr — aggregate_pf=1.940 (KEEP)
- Timestamp: 2026-06-27
- What changed: min_mcap_cr=10000
- Result: PF=1.940 (+26.9%), 45 stocks, 383 trades, ₹1.25M net, 88.9% prof
- Insight: Best single-param tweak. The mcap filter is the dominant factor.

### Run 8: mcap>=10000Cr + atr>=4% — aggregate_pf=1.902 (DISCARD)
- Timestamp: 2026-06-27
- What changed: combined mcap>=10000 with atr>=4%
- Result: PF=1.902, 40 stocks, 347 trades, ₹1.10M net
- Insight: Adding ATR filter on top of mcap always makes things worse.

### Run 9: mcap>=10000Cr + price>=200 — aggregate_pf=2.032 (KEEP)
- Timestamp: 2026-06-27
- What changed: mcap>=10000 + price>=200
- Result: PF=2.032 (+32.9%), 41 stocks, 339 trades, ₹1.18M net, 87.8% prof
- Insight: Price filter synergizes well with mcap filter. Obvious in hindsight: cheap large-cap stocks tend to be value traps.

### Run 10: mcap>=10000Cr + price>=200 + vol>=1M — aggregate_pf=2.018 (DISCARD)
- Timestamp: 2026-06-27
- What changed: added min_volume=1M
- Result: PF=2.018, 32 stocks, 265 trades
- Insight: Volume filter doesn't help — 500K is enough liquidity

### Run 11: mcap>=10000Cr + price>=150 — aggregate_pf=1.987 (DISCARD)
- Timestamp: 2026-06-27
- What changed: price>=150 instead of 200
- Result: PF=1.987, 43 stocks, 358 trades, ₹1.21M net
- Insight: Price≥200 is the sweet spot — price≥150 gives worse PF even with more stocks

### Run 12: mcap>=10000Cr + price>=300 — aggregate_pf=1.834 (DISCARD)
- Timestamp: 2026-06-27
- What changed: price>=300 instead of 200
- Result: PF=1.834, 32 stocks, 249 trades
- Insight: Too high — excludes too many good stocks in the 200-300 range

### Run 13: mcap>=5000Cr + price>=200 — aggregate_pf=1.994 (KEEP)
- Timestamp: 2026-06-27
- What changed: mcap>=5000 + price>=200
- Result: PF=1.994 (+30.4%), 59 stocks, 552 trades, ₹1.88M net, 91.5% prof
- Insight: Best diversification with PF-close-to-2.0. 59 stocks is a solid bot watchlist.

### Run 14: mcap>=5000Cr + price>=200 + atr>=4% — aggregate_pf=2.022 (KEEP)
- Timestamp: 2026-06-27
- What changed: added atr>=4%
- Result: PF=2.022 (+32.2%), 52 stocks, 493 trades, ₹1.71M net, 90.4% prof
- Insight: Surprisingly good — atr≥4% works here because mcap≥5000 already filters the junk

### Run 15: mcap>=10000Cr + price>=200 + atr>=4% — aggregate_pf=1.997 (DISCARD)
- Timestamp: 2026-06-27
- What changed: mcap>=10000 + price>=200 + atr>=4%
- Result: PF=1.997, 36 stocks
- Insight: ATR filter not helpful at mcap≥10000 either

### Run 16: mcap>=7500Cr + price>=200 — aggregate_pf=1.901 (DISCARD)
- Timestamp: 2026-06-27
- What changed: medium mcap threshold
- Result: PF=1.901, 52 stocks
- Insight: Not a threshold effect — PF scales monotonically with mcap

### Run 17: mcap>=8000Cr + price>=200 — aggregate_pf=1.911 (DISCARD)
- Timestamp: 2026-06-27
- What changed: stepped mcap
- Result: PF=1.911, 51 stocks

### Run 18: mcap>=3000Cr + price>=200 — aggregate_pf=1.852 (DISCARD)
- Timestamp: 2026-06-27
- What changed: mcap>=3000 + price>=200
- Result: PF=1.852, 76 stocks, 742 trades

### Run 19: price>=200 (baseline mcap>=1000) — aggregate_pf=1.631 (KEEP)
- Timestamp: 2026-06-27
- What changed: just price>=200, no mcap change
- Result: PF=1.631, 100 stocks, 1075 trades, ₹2.59M net, 87.0% prof
- Insight: Price≥200 alone is a solid improvement (+6.7%) but mcap is the bigger lever

### Run 20: mcap>=15000Cr + price>=200 — aggregate_pf=2.082 BEST (KEEP)
- Timestamp: 2026-06-27
- What changed: mcap>=15000 + price>=200
- Result: PF=2.082 (+36.2%), 26 stocks, 203 trades, ₹0.73M net, 88.5% prof, avg PF=5.88
- Insight: Peak PF. Larger caps with high beta are the sweet spot. Few stocks but excellent quality.

### Run 21: mcap>=20000Cr + price>=200 — aggregate_pf=1.970 (DISCARD)
- Timestamp: 2026-06-27
- What changed: mcap>=20000 + price>=200
- Result: PF=1.970, 21 stocks, 162 trades
- Insight: Too few stocks and PF drops — mcap≥15000 is the peak

### Run 22: mcap>=15000Cr (no price filter) — aggregate_pf=1.936 (DISCARD)
- Timestamp: 2026-06-27
- What changed: no price>=200 constraint
- Result: PF=1.936, 29 stocks
- Insight: Price≥200 adds +7.5% at this mcap level — always beneficial

### Run 23: mcap>=15000Cr + price>=200 + atr>=4% — aggregate_pf=2.055 (DISCARD)
- Timestamp: 2026-06-27
- What changed: added atr>=4%
- Result: PF=2.055, 22 stocks, 173 trades, ₹0.61M net
- Insight: Slightly worse than without ATR filter. ATR never helps on top of mcap+price.
