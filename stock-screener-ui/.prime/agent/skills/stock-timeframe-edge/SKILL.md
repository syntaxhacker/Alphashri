---
name: stock-timeframe-edge
description: Generate a "timeframe edge" report for any NSE stock (e.g. NETWEB, HAL, TATAMOTORS) — which holding period (5m/15m/1h/4h/overnight/1d/3d/5d) is actually profitable, when to enter each one (open/midday/close), whether the edge survives stops and down-regimes, benchmarked against NIFTY. Monte-Carlo random-entry backtest + session attribution with a self-contained HTML + Markdown report. Use when asked which timeframe suits a stock, whether scalping or swing pays more on a name, where its intraday moves concentrate, or for a "timeframe edge" / "holding period" study.
---

# Stock Timeframe Edge Report (which holding period pays?)

One command answers: **"If I trade this stock, what holding period makes money —
5-minute scalps, 4-hour swings, overnight holds, or multi-day?"** plus *when*
to enter each horizon and whether the edge is real or luck.

Two engines:
1. **Session decomposition** — every day split into overnight gap / open
   (09:15–10:30) / midday (10:30–14:00) / close (14:00–15:30); cumulative
   curves + log-share waterfall of where the total move comes from.
2. **Monte-Carlo holding-period backtest** — seeded random long entries at every
   horizon; profit factor with 95% bootstrap CI, win rate, per-trade Sharpe,
   SL/TP overlay (±1/2/3%), 200d-MA regime split, NIFTY session benchmark.

Data: Upstox V3 via `market_data.fetch_candles` (5m fetched once → anchored
resample to 15m/1h/4h; daily tf=1440) + yfinance `^NSEI` benchmark.

## Quick start

```bash
cd /home/mysyntax/Documents/Alphashri/stock-screener-ui

.venv/bin/python .prime/agent/skills/stock-timeframe-edge/scripts/generate_timeframe_edge_report.py --symbol NETWEB

# Common flags
#   --frm 2024-01-01            lookback start (default 2024-01-01)
#   --samples 2000 --seed 42    MC subsample size + RNG seed (reproducible)
#   --cost-bps 6                per-side cost in bps (default 6 => 12bps round trip)
#   --daily-csv f --minute-csv f1,f2   reuse cached CSVs, skip network fetch
#   --no-nifty                  skip the ^NSEI download
```

Output → `reports/<SYMBOL>_TIMEFRAME_EDGE/`:
- `<SYM>_timeframe_edge.html` — self-contained (charts base64), `xdg-open` it.
- `<SYM>_timeframe_edge.md`, `figures/*.png` (~8),
  `mc_summary.csv`, `session_attribution.csv`.

## Reading the verdict

- **PF > 1 with CI lower bound > 1** → random long entries made money at that
  horizon ⇒ the stock has drift there. PF ≈ 1 ⇒ coin flip. PF < 1 ⇒ costs eat you.
- **Heatmap (horizon × entry session)** says *when* to enter.
- **Stops chart**: if PF collapses from none→±1%, the drift is real but untradeable
  at tight stops (noise shakes you out first).
- **Regime table**: trust the `pf_down_regime` column as your base expectation.
- **NIFTY comparison**: an overnight edge below NIFTY's own overnight drift is beta, not alpha.

## Tests

```bash
source .venv/bin/activate && python -m pytest .prime/agent/skills/stock-timeframe-edge/tests/ -v
```

Known-answer tests: rising series ⇒ PF=inf; SL fills at level (or gap open when
gapped through); TP fill; same-day enforcement; anchored 4h resample = 2 blocks/day;
session chain reproduces the day's move; bootstrap CI brackets point estimate.

## Notes / gotchas

- Force Agg backend before pyplot (same as EDA skill).
- All index math in IST (`Asia/Kolkata`); bars outside 09:15–15:30 are dropped.
- Intraday horizons enforce **same-day completion** — cross-day holds belong to
  the daily rows (overnight/1d/3d/5d).
- Upstox minute history depth is limited (~1y for 5m); if the fetch comes back
  short, intraday sections degrade gracefully and daily rows still cover the full window.
- Overnight SL/TP can only fill through the opening gap (no intrabar data exists
  between close and open).
- Intrabar double-hit (SL and TP both touched in one bar) assumes **SL filled first**
  — conservative by design.
- The chained sanity check (printed in the report footer) must be within ~2% of the
  actual total return; a large diff means missing illiquid bars or a data problem.
