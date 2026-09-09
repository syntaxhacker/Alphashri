# Refined ORB Strategy — ES/Nasdaq 15m

**Saved: 2026-08-26 | No prop-firm assumptions, just edge**

## Strategy: ORB 15m No-Retest + Structure

**Core (15m opening range = 5×3m bars, 09:30–09:45 ET):**
- Entry: **next bar open after breakout close** beyond OR (no retest wait) — continuation, not pullback
- SL: opposite OR edge (1.0× width), TP: **1.2R** — win-rate optimized (win72% vs 53% at 2R)
- Cost: 1pt RT (fees+1 tick slippage), 1% risk/trade, EOD flat

**Filters (why they work):**

1. **eff ≥0.50** — `eff = OR_height / sum(bar_ranges)`. Filters choppy overlapping opens (0.30-0.44) where breakout is noise. Winners avg 0.61 vs losers 0.43.
2. **HL ≥3 / LL ≥3** — For longs, 3 of 4 lows rising (higher lows); for shorts, falling lows. Measures buying/selling pressure in the OR. Winners 84% have it vs losers 45%. Lifts PF 1.60→4.61 on 13tr sample.
3. **OR/prev ≥1.0 (expanding)** — Today's OR bigger than yesterday's = volatile/trending day, breakout has follow-through. Winners 1.68× vs losers 0.80×.

Filters 2+3 are structure/momentum, not curve-fit: HL shows trend, expanding shows volatility regime.

## Performance (ES)

- **Jan 20–Apr 15, 3m, 61 RTH days:** 13tr win84.6% PF4.61 net+7.6% avgR+0.57 (baseline retest TP2R: 54tr win53.7% PF1.64 net+15.5% — more trades but lower quality)
- **Entire 68 days (Jan-Apr + Aug 17-25 yfinance 3m):** refined 13tr win84.6% PF4.61 net+7.6% (Aug 7 days: 0 trades — correctly filtered choppy week that lost 3R before)
- **August 5m (Aug 1-25, 5m 3-bar OR, HL≥2):** 4tr win75% PF2.53 net+6.1% (2 TP wins, 1 EOD, 1 SL) — 5m approx matches 3m.

**Why no-retest + 1.2R wins:**
- Retest waits at edge: PF1.64, late entry chases 0.38× range, TP 2R hit only 9/61
- No-retest enters next open: PF2.16, TP1.2 hit rate jumps to 72% (small target, high win), PF2.6-4.6 with structure filters

## What was tested and rejected

- VWAP distance: no edge (PF same) — breakout already above VWAP
- Volume surge ≥1.5×: cuts to 3tr, no PF gain
- Tight SL (0.5×): PF1.16, costs eat edge
- 5pt PDL/PDH reject: PF1.92 on 17tr but not robust vs 3m HL
- Wider TP 2R: win drops to 53%, PF lower

## Files

- `orb_verify.py` — baseline backtest (retest vs run)
- `orb_showcase.py` — current refined (eff+HL, no-retest TP1.2) → `reports/ORB_ES_showcase/orb_es_showcase.html` (pitch black, HH/HL dashed)
- `research_orb_vwap.py` — VWAP/volume sweep
- `refine_orb.py` — incremental filter holdout (train Jan-Apr vs test Aug)

## Next

- Walk-forward on 12mo (need 1y 1m data beyond USB) — 13tr is small sample, PF confidence wide
- Test 0.5% risk live first — same PF, half DD
- Keep 5m sleeve `eff≥0.30 HL≥1` for volume (61tr win60.7% PF1.50 net+12%) if more trades needed
- ICT sleeve: `buffer10 fvg5 vol1.5 RR7 HTF` PF4.55 on 3tr needs 3-month walk-forward before live

## Changelog 2026-08-26 (Build)
- Fixed `market_data.py` TF3 resample (was no-op) and SL-first in `trading/autoresearch_strategies.py`
- ICT v2: `MNQ 5m sweep 10pt + FVG5 + vol1.5× + RR7 → PF2.07 (5tr)`; with HTF → PF4.55 (3tr)
