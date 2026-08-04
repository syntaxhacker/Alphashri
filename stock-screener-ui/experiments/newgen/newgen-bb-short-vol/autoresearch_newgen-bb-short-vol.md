# Autoresearch Session — newgen-bb-short-vol

## Objective
Find the best config (maximizing **profit_factor**) for a single stock **NEWGEN** across three
intraday strategies. Sweep timeframe {5,15} and each strategy's parameter space. A config is only
trustworthy if `total_trades >= 10` (single stock → small counts; flag PF from <10 trades as unreliable).

## Primary metric
- **profit_factor** (higher is better) = gross_profit / gross_loss (from `common.compute_metrics`).
- Secondaries: win_rate, net_pnl, total_trades, tp/sl/eod_exits.

## Data
- Upstox-only, already cached: `experiments/data/newgen_cache.pkl`. NO network fetches.
- `from experiments.newgen.common import load_newgen` → `df = load_newgen(tf)` for tf in {5,15}.
- Candles: open/high/low/close/volume, tz-aware IST, window 2026-05-04..2026-08-04 (65 trading days, ~price 500-562).
- Trade size 100 shares; round-trip costs via `common.calc_costs` (brokerage+STT+exch+sebi+gst+stamp).

## How to run
```bash
source .venv/bin/activate
# bb
NEWGEN_STRATEGY=bb NEWGEN_TF=5 NEWGEN_BB_MODE=bounce NEWGEN_BB_PERIOD=20 NEWGEN_BB_STD=2.0 \
  NEWGEN_SL=1.0 NEWGEN_TP=1.5 NEWGEN_EOD=885 \
  python experiments/newgen/newgen-bb-short-vol/benchmark.py
# short
NEWGEN_STRATEGY=short NEWGEN_TF=5 NEWGEN_SHORT_MODE=s1_breakdown NEWGEN_SL=1.5 NEWGEN_TP=2.0 \
  NEWGEN_BUFFER=0.3 NEWGEN_PIVOT=classic NEWGEN_EOD=915 \
  python experiments/newgen/newgen-bb-short-vol/benchmark.py
# vol
NEWGEN_STRATEGY=vol NEWGEN_TF=5 NEWGEN_VOL_MULT=2.0 NEWGEN_AVG_PERIOD=20 NEWGEN_SL=1.0 NEWGEN_TP=1.5 \
  NEWGEN_EOD=885 python experiments/newgen/newgen-bb-short-vol/benchmark.py
```
Outputs `METRIC key=value` lines. Logged runs:
```bash
python experiments/newgen/newgen-bb-short-vol/run_experiment.py "<desc>" [keep|discard|crash]
```

## Strategy parameter spaces
- **bb** modes bounce|breakout|squeeze; bb_period {15,20}; bb_std {1.5,2.0,2.5}; SL {1.0,1.5,2.0}; TP {1.5,2.0,3.0}; EOD 885.
- **short** modes s1_breakdown|rsi_overbought|breakout_fail|ema_extended; SL {1.5,2.0,3.0}; TP {2.0,3.0,4.5}; buffer {0.1,0.3,0.5}; pivot {classic,fibonacci}; entry >=10:00; EOD 915.
- **vol** vol_mult {1.5,2.0,3.0}; avg_period {10,20}; SL {1.0,1.5,2.0}; TP {1.5,2.0,3.0}; EOD 885.

## Files in scope (this session only)
- `experiments/newgen/newgen-bb-short-vol/benchmark.py` — strategy sim + METRIC printer.
- `experiments/newgen/newgen-bb-short-vol/run_experiment.py` — atomic logging helper.
- `experiments/newgen/newgen-bb-short-vol/autoresearch_newgen-bb-short-vol.jsonl` — state.
- `experiments/newgen/newgen-bb-short-vol/autoresearch_newgen-bb-short-vol.md` — this file.
- `experiments/newgen/newgen-bb-short-vol/worklog_newgen-bb-short-vol.md` — per-run log.
- `experiments/newgen/newgen-bb-short-vol/autoresearch-dashboard_newgen-bb-short-vol.md` — summary.

## Off limits
- `db/alphashri.db`, `experiments/newgen/common.py`, `experiments/data/newgen_cache.pkl` (READ-ONLY).
- Other sessions' files / other newgen-* namespaces. NO git operations.

## What's Been Tried (43 runs)

### bb — best: `bounce tf15 p20 std2.5 SL1.5 TP2.0 EOD885` → **PF 1.32** (run 13)
- tf5 bounce mostly PF <1 (0.78-1.09). Higher std (2.5) + SL/TP 1.5/2.0 → near 1.0 (run 5).
- **tf15 is the edge**: bounce p20 std2.0 (run 8, 1.19) and std2.5 (run 13, **1.32**) both >1. WR 50-58%.
- squeeze: PF 1.30 at tf5 std2.5 SL1.5 TP2.0 (run 12, EOD-heavy) but 0.46 at tf15 (run 15) — unstable.
- breakout mode: max 0.91 (runs 6/11) — no edge.
- Robustness: run 38 (SL2.0/TP3.0 tf15) → 1.12; run 8 (std2.0) → 1.19. Bounce tf15 p20 std2.5 is stable >1.
- Discarded: runs 4, 6, 11, 14, 15, 16 (PF ≤0.97, no edge).

### short — best: `breakout_fail tf5 SL2.0 TP4.5 buf0.3 classic EOD915` → **PF 2.28** (run 39)
- s1_breakdown: PF 0.48-0.62 across SL/TP/buffer/pivot — no edge (loses at EOD).
- ema_extended: PF 0.42 (run 19) — bad. rsi_overbought: PF 1.89 but only **6 trades** (run 17, unreliable <10).
- **breakout_fail is the winner**: run 22 (SL2.0/TP3.0) 1.95, run 39 (SL2.0/TP4.5) **2.28**, run 24 (tf15 SL1.5/TP2.0) 1.40, run 42 (fib pivot) 1.24 (classic better). WR ~58-70%. EOD-heavy exits (TP/SL rarely hit) — edge is short-into-close after failed resistance break.
- Robustness: run 39 vs run 22 (TP3.0) both ~2.0; buffer unused by this mode; fib pivot degrades to 1.24.
- Discarded: runs 19, 20, 25 (PF <0.55).

### vol — best: `tf5 mult1.5 avg10 SL1.5 TP2.0 EOD885` → **PF 1.15** (run 36)
- Most vol configs PF 0.64-0.87 (chasing volume-spike bars gives back gains). 15m all <0.86.
- Run 34 (SL1.0/TP2.0) 1.04, run 36 (SL1.5/TP2.0) **1.15** (111 trades, WR 45%). mult 1.5 + avg 10 + TP2.0 is the sweet spot; SL1.5 helps.
- Robustness: run 41 (mult2.0) drops to 0.97, run 43 (TP1.5) 0.87 → vol edge is thin/sensitive.
- Discarded: runs 27-32, 35, 37, 43 (PF <1).
