# Worklog: NEWGEN Intraday Parallel Autoresearch

Started: 2026-08-05

## Context
- **Symbol**: NEWGEN only (Newgen Software Technologies)
- **Data source**: Upstox API only (no yfinance / no TradingView)
- **Data window**: 2026-05-04 .. 2026-08-04 (~62 trading days), cached at `experiments/data/newgen_cache.pkl`
- **Mode**: 8 fully-parallel autonomous subagents, each a self-contained autoresearch session with a unique name:
  - `newgen-orb-5m`, `newgen-orb-10m`, `newgen-orb-15m`, `newgen-orb-1h` (ORB, grid of OR durations)
  - `newgen-sr` (SR Breakout pivots)
  - `newgen-ema` (EMA Cross)
  - `newgen-supertrend`
  - `newgen-bb-short-vol` (Bollinger + short-only + volume surge)
- **Primary metric**: profit_factor (higher better). Secondaries: win_rate, net_pnl, total_trades, exit splits.
- **Trust rule**: configs with <10 trades flagged as unreliable (single-stock small-sample noise).

## Key Insights
### Timeframe for ORB
- **5-min ORB** → best config PF=5.86 (11 trades, robust 4.8–5.9). No-TP cap + early EOD (14:05) + min_or_range≥1.3%.
- **10-min ORB** → PF=8.24 (10 trades, reproducible). OR=5/10 (first candle only) + wide SL 1.5% + TP 3.5% + mor≥2.5% + EOD 14:15.
- **15-min ORB** → PF=9.91 (10 trades). Single-candle OR, TP=8.5 (≈ no cap), EOD 13:00 is the single biggest lever, mor≥0.8%.
- **1-hr ORB** → NOT viable. Only ~5–7 trades/quarter; best "config" is a single-winner curve-fit (PF 3.51 on 5 trades); realistic regimes lose (PF 0.28–0.34). OR duration is irrelevant on hourly bars (always first 9:15 bar).
- **Cross-timeframe commonality**: only the FIRST candle's range has edge (short OR wins); afternoon moves fade (early EOD 13:00–14:15 >> 15:00); shorts always hurt ORB on NEWGEN; volatility filter (min_or_range) is a huge lever.

### Other strategies (NEWGEN)
- **SR Breakout** → tf=5 classic, wide SL 5% → acts as R1→R2 target scalper (PF 400 on 14 trades, inflated by zero SL hits). Buffer≥0.3% critical. Not production-trustworthy without more data.
- **EMA Cross** → the most statistically reliable: tf=5 fast=12 slow=26 SL=1.75 TP=1.0 (TP≈SL/2 scalp) shorts=on EOD=850 → **PF=2.16, 67 trades, +₹16,947**. 15m caps at ~1.1, 60m unprofitable.
- **Supertrend** → tf=15 ATR=20 mult=1.0 SL=1.0 TP=2.0 shorts=on → PF=2.08 (22 trades). Standard mult 2–4 never flips (NEWGEN in strong uptrend); only tight bands trade it.
- **BB / Short / Volume** → short-only `breakout_fail` tf=5 SL=2.0 TP=4.5 → PF=2.28 (19 trades, EOD-heavy). BB bounce tf=15 PF=1.32 (31 trades, best balanced). Volume surge marginal (PF=1.15, 111 trades, thin edge).

### Overall recommendation
- **Production-candidates for NEWGEN**: EMA Cross tf=5 (PF 2.16, 67 trades) and 5/10/15-min ORB variants (PF 5.9–9.9 but only 10-11 trades each — directionally strong, small sample).
- **Avoid on NEWGEN**: 1-hr ORB, 60-min EMA, Supertrend mult>1.
- All best configs are single-stock fits; validate out-of-sample before deployment.

## Experiments
See per-session worklogs for the full run-by-run narrative:
- `experiments/newgen/newgen-orb-5m/worklog_newgen-orb-5m.md` (117 runs)
- `experiments/worklog_newgen-orb-10m.md` (72 runs)
- `experiments/worklog_newgen-orb-15m.md` (111 runs)
- `experiments/worklog_newgen-orb-1h.md` (45 runs)
- `experiments/worklog_newgen-sr.md` (42 runs)
- `experiments/newgen/newgen-ema/worklog_newgen-ema.md` (90 runs)
- `experiments/worklog_newgen-supertrend.md` (50 runs)
- `experiments/newgen/newgen-bb-short-vol/worklog_newgen-bb-short-vol.md` (43 runs)

Consolidated state: `autoresearch-newgen.jsonl` (570 runs, 8 sessions, segment 0).
