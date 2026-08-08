# Autoresearch: Optimize BTST (Buy Today Sell Tomorrow) Parameters

## Objective
Find the best combination of SL%, TP%, and entry threshold that maximizes profit factor for a BTST strategy across a universe of high-volatility Indian stocks.

BTST = Buy at market close when entry signal triggers (e.g., stock was up > X% that day), sell at next trading day's close (or when SL/TP hits intraday).

## Metrics
- **Primary**: `profit_factor` (ratio, higher is better) — combined profit factor across ALL trades
- **Secondary**: `win_rate` (%), `net_pnl` (INR), `total_trades` (count), `stocks_with_trades` (count), `sl_exits` / `tp_exits` / `close_exits` (counts)

## How to Run
```bash
./autoresearch.sh
```
Outputs `METRIC name=value` lines.

## Parameters Being Optimized
| Parameter | Baseline | Range |
|-----------|----------|-------|
| `BTST_SL_PCT` | 2.0 | 0.5, 1.0, 1.5, 2.0, 3.0, 5.0 |
| `BTST_TP_PCT` | 3.0 | 0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 0.0 (no TP) |
| `BTST_ENTRY_THRESHOLD` | 0.5 | 0.0, 0.5, 1.0, 2.0, 3.0 |
| `BTST_ENTRY_MODE` | up_day | up_day, any_day, volume_surge |

## Fixed Settings
```
Date range: Jan-Jun 2026
Trade capital per trade: ₹100,000
Stock universe: TV volatile_trend screener, min mcap=1000Cr, min price=50
Max stocks: 100
Costs: Delivery trading (STT=0.1%, stamp=0.015%)
Data: yfinance daily (NSE/BSE)
```

## Files in Scope
- `experiments/benchmark_btst.py` — the BTST benchmark script (TV screener → yfinance daily → BTST sim → metrics)
- Modify this file to add new entry modes or signal logic

## Off Limits
- `db/` — database models
- `api/` — API routes
- `src/` — frontend code
- `trading/` — production trading code
- `backtest/` — production backtest framework

## Constraints
- Must have >= 5 qualifying stocks for valid result (otherwise skip)
- Each stock must have >= 2 trades to count as "qualified" for per-stock PF
- No new dependencies beyond what's already in requirements
- Fast execution: 5 workers, yfinance cached data

## What's Been Tried
- **SL Sensitivity**: PF increases monotonically as SL tightens (2%→0.001%)
  - 2% SL: PF=0.82, 1% SL: PF=1.08, 0.5% SL: PF=1.47, 0.1% SL: PF=2.74, 0.001% SL: PF=4.04
  - **No SL is worse** (PF=1.05) — SL is essential
- **No TP beats any TP**: Removing TP gives PF=1.08 vs TP=3% gives PF=0.82
- **any_day beats up_day**: No entry threshold gives PF=1.16 vs up_day PF=1.08
- **volume_surge gives highest PF**: PF=4.20 (H1 2026) / PF=3.88 (full year) — fewer but higher-quality trades
- **Higher mcap helps marginally**: mcap>=10000Cr gives PF=4.18 vs mcap>=1000 gives PF=4.04
- **Price filter doesn't help**: price>=200 gave PF=4.10 vs baseline at same SL
- **Full year robustness**: Best config PF=3.88 (volume_surge) / 2.85 (any_day) across Jul 2025-Jun 2026
- **100% stocks profitable** at SL<=0.05% with any_day/no TP config
- **Best configs**:
  - Highest PF: volume_surge, SL=0.001%, no TP, mcap>=1000Cr (PF=3.88 FY / 4.20 H1)
  - Most trades: any_day, SL=0.001%, no TP, mcap>=1000Cr (PF=2.85 FY / 4.04 H1)

---

# Autoresearch Session: NEWGEN Intraday Parallel (2026-08-05)

## Objective
Find the best intraday strategy configs for the single stock **NEWGEN**, across 8 fully-parallel autonomous sessions (ORB on 5/10/15/60-min candles × OR durations, SR Breakout, EMA Cross, Supertrend, BB + short-only + volume surge). **Upstox API only** (no yfinance/TradingView).

## Metrics
- **Primary**: `profit_factor` (higher is better). Secondaries: win_rate, net_pnl, total_trades, tp/sl/eod exits.
- Trust rule: configs with <10 trades are flagged unreliable (single-stock small-sample noise).

## How to Run
```bash
source .venv/bin/activate
python3 experiments/newgen_data.py            # rebuild Upstox cache (tf 5/10/15/60)
python3 experiments/newgen/common.py --tf 5   # sanity check
python3 experiments/newgen/newgen-orb-5m/benchmark.py   # one session's benchmark
```

## Files in Scope
- `experiments/newgen_data.py` — Upstox-only data fetcher → `experiments/data/newgen_cache.pkl`
- `experiments/newgen/common.py` — shared load_newgen/calc_costs/compute_metrics/ORB sim (READ-ONLY)
- `experiments/newgen/<session>/` — one dir per session: benchmark.py, autoresearch_<session>.jsonl/.md, worklog, dashboard
- `autoresearch-newgen.jsonl` — consolidated 570-run state
- `autoresearch-dashboard-newgen.md` — final summary dashboard
- `experiments/worklog_newgen.md` — master worklog

## Off Limits
`trading/`, `api/`, `src/`, `backtest/`, `db/`, `upstox_trader/` — only `experiments/` + autoresearch files.

## What's Been Tried (NEWGEN)
- **ORB best by candle tf**: 5m PF=5.86 (OR15/SL1.0/no-TP/EOD845/mor1.3, 11t), 10m PF=8.24 (OR5/SL1.5/TP3.5/EOD855/mor2.5, 10t), 15m PF=9.91 (1-bar OR/SL1.25/TP8.5/EOD13:00/mor0.8, 10t), 1h NOT viable (5 trades, curve-fit).
- **Common ORB levers**: only the first candle's range has edge; afternoon fades → early EOD (13:00–14:15); shorts hurt; min_or_range volatility filter is huge.
- **EMA Cross tf5** fast=12 slow=26 SL=1.75 TP=1.0 shorts=on EOD=850 → PF=2.16, 67 trades (most statistically reliable).
- **SR Breakout tf5** classic SL=5.0 → R1→R2 scalper (PF 400 on 14t, inflated by zero SL hits).
- **Supertrend tf15** ATR=20 mult=1.0 SL=1.0 TP=2.0 shorts=on → PF=2.08 (22t); mult 2–4 never flips.
- **Short-only breakout_fail tf5** SL=2.0 TP=4.5 → PF=2.28 (19t). BB bounce tf15 PF=1.32. Volume surge marginal (1.15).
- **All configs are single-stock fits — validate out-of-sample before deployment.**
