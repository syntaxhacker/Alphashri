# Autoresearch: newgen-orb-5m

## Objective
Find the best ORB (Opening Range Breakout) parameter set for NEWGEN (single stock) on 5-min candles that maximizes `profit_factor`. We sweep OR durations {5,10,15,60} and tune SL/TP/buffer/cooldown/shorts/EOD exit/min_or_range_pct.

## Metrics
- **Primary**: `profit_factor` (ratio, higher is better). Only trustworthy if `total_trades >= 10`.
- **Secondaries**: `win_rate`, `net_pnl`, `total_trades`, `tp_exits`, `sl_exits`, `eod_exits`.

## How to Run
Single benchmark invocation (cached data, <5s):
```bash
source .venv/bin/activate
python3 experiments/newgen/newgen-orb-5m/benchmark.py   # defaults = baseline
NEWGEN_OR_MIN=5 NEWGEN_SL=0.5 NEWGEN_TP=2.0 python3 experiments/newgen/newgen-orb-5m/benchmark.py
```
Env vars: `NEWGEN_OR_MIN`, `NEWGEN_SL`, `NEWGEN_TP`, `NEWGEN_BUFFER`, `NEWGEN_COOLDOWN_BARS`, `NEWGEN_SHORTS` (1/0), `NEWGEN_EOD_EXIT` (minutes), `NEWGEN_TRADE_SIZE`, `NEWGEN_COSTS`, `NEWGEN_MIN_OR_RANGE`, `NEWGEN_MAX_OR_RANGE`, `NEWGEN_MIN_ENTRY_MIN`, `NEWGEN_MAX_PER_DAY`.
Output is `METRIC key=value` lines.

## Files in Scope
- `benchmark.py` — this session's ORB benchmark wrapper.
- `log_run.py` — helper that appends experiment results to the JSONL atomically.
- `autoresearch_newgen-orb-5m.jsonl` — experiment state (117 runs, 1 segment).
- `autoresearch_newgen-orb-5m.md` — this file.
- `worklog_newgen-orb-5m.md` — per-run narrative.
- `autoresearch-dashboard_newgen-orb-5m.md` — runs/kept/discarded summary.

## Off Limits
- `experiments/newgen/common.py` (READ-ONLY shared lib).
- `experiments/data/newgen_cache.pkl` (READ-ONLY cache).
- Any other session's files/directories. NO git operations.
- `db/alphashri.db` and any production data.

## Constraints
- Each run <5s. No network. No new deps.
- Keep/discard rule: PF improved (with total_trades >= 10) → keep, else discard. Log unreliable (<10 trade) PFs but don't trust them.

## What's Been Tried
- **BEST CONFIG**: OR=15, SL=1.0, TP=100 (no TP cap), buffer=0.45, cooldown=3, shorts=off, EOD exit=845 (14:05 IST), min_or_range=1.3, max_or_range=5.0 → **PF=5.8596**, win_rate=54.5%, net_pnl=+10,872, 11 trades (TP=0 SL=4 EOD=7). Robust: perturbations (SL 0.9-1.1, buffer 0.4-0.5, cooldown 2-4, EOD 840-850, mor 1.28-1.32) all stay in PF 4.8-5.9 band.
- Baseline OR=15 SL=1.0 TP=1.5 buffer=0.3 cooldown=1 EOD=900 mor=0.3: PF=0.9548 (slight loser). Three levers explain the whole journey:
  1. **No TP cap** (TP=100): PF 0.95→2.28 at OR=10. Capping winners killed the edge; with no cap most trades exit at EOD and winners run.
  2. **EOD exit earlier** (900→845 = 14:05 IST): PF 2.87→3.77→4.03. NEWGEN's intraday move fades in the afternoon; 845-843 is a stable plateau, 847+ loses.
  3. **min_or_range filter** (0.3→1.3%): PF 4.03→5.86. Only trade high-volatility OR days. Beyond 1.35 trades drop under 10 (unreliable); mor=1.5/2.0/3.0 show inflated PF 8-24 on 4-8 trades — NOT trustworthy.
- OR duration: 15 is best (12/15 tie at PF 2.53 pre-filter). OR=5 → 1.77-3.75, OR=10 → 2.28-3.73, OR=60 → 0.03-0.61 (near-useless, too few trades).
- Shorts=1: PF drops (3.05 vs 4.50 at mor=0.8); edge is long-only.
- max_or_range capping hurts (3.0% → PF 0.39): high-range days ARE the edge; keep default 5.0.
- TP=0 is degenerate in the simulator (tp=entry → immediate TP), not a no-cap.
- min_entry_minutes=30 hurts; max_per_day=1 hurts; costs on for all reported runs.
