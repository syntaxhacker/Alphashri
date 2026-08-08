# Autoresearch: newgen-orb-15m

## Objective
Find the best ORB (Opening Range Breakout) parameter set for NEWGEN on **15-min candles**
that maximizes profit_factor. Sweep OR durations {5,10,15,60} and tune SL/TP/buffer/
cooldown/shorts/EOD/min_or_range. Single stock (NEWGEN), 65 trading days
(2026-05-04..2026-08-04) of Upstox data.

## Metrics
- **Primary**: `profit_factor` (ratio, higher is better). A config is only trustworthy if
  `total_trades >= 10` (single stock → small counts; PF from <10 trades is unreliable).
- **Secondary**: win_rate (%), net_pnl (INR), total_trades, tp_exits, sl_exits, eod_exits.

## How to Run
```bash
source .venv/bin/activate
python3 experiments/newgen/newgen-orb-15m/benchmark.py   # baseline defaults
# env overrides (each run <5s):
NEWGEN_OR_MIN=5 NEWGEN_SL=0.75 NEWGEN_TP=2.0 NEWGEN_BUFFER=0.3 \
NEWGEN_COOLDOWN_BARS=1 NEWGEN_SHORTS=0 NEWGEN_EOD_EXIT=900 \
python3 experiments/newgen/newgen-orb-15m/benchmark.py
```
The script prints `METRIC key=value` lines + a `DESC` line describing the config.

## Files in Scope
- `experiments/newgen/newgen-orb-15m/benchmark.py` — the benchmark (env-param driven)
- `autoresearch_newgen-orb-15m.jsonl` — experiment state (config header + one line/run)
- `autoresearch_newgen-orb-15m.md` — this file
- `autoresearch-dashboard_newgen-orb-15m.md` — dashboard
- `experiments/worklog_newgen-orb-15m.md` — worklog

## Off Limits
- `experiments/newgen/common.py` (READ-ONLY shared lib)
- `experiments/data/newgen_cache.pkl` (READ-ONLY cache)
- Other sessions' namespaces (e.g. `experiments/newgen/newgen-orb-5m/`)
- NO git operations, NO commits, NO network fetches.

## Constraints
- Each benchmark run must complete in <5s.
- ORB sim via `common.simulate_orb`, metrics via `common.compute_metrics`.
- JSONL writes must be atomic (temp file + rename). Never lose data.
- The simulator enforces min/max OR range, EOD exit, cooldown, shorts toggle.

## What's Been Tried
_(111 runs completed. Baseline OR=15/SL=1.0/TP=1.5/BUF=0.3/CD=1/shorts=0/EOD=900/minOR=0.3 → PF=1.12, 44 trades.)_

- **OR duration sweep**: OR=5/10/15 all alias to the single 9:15–9:30 candle (identical). OR=30 (0.15), 45 (0.27), 60 (0.30) all PF<0.4 — dead ends. Single-candle OR only.
- **SL sweep** (OR=15, TP=1.5): peak at 1.0 (PF=1.12); 0.5→0.96, 0.75→1.03, 1.25→1.06, 1.5→1.10. Later, at the high-TP/EOD-13:00 regime, SL≥1.25 never triggers (0 SL exits) and equals PF=9.91.
- **TP sweep** (OR=15/SL=1.0): 1.0→1.13, 1.5→1.12, 2.0→1.04, 2.5→1.17, 3.0→1.38, 3.5→1.57, 4.0→1.56, 5.0→1.52, 6.0→1.93, 7.0→2.01, 8.0→2.22, **8.5→2.30 (best)**, 9.0→1.79, 10.0→1.40. TP=0 degenerate (instant exit at entry). Peak 8.5.
- **Buffer sweep** (TP=8.5): 0.0→2.52, 0.3→2.30, 0.4→2.57, 0.5→3.02, 0.55→2.76, **0.6→3.13 (best)**, 0.65→3.11, 0.75→2.06, 1.0→1.20.
- **Cooldown sweep**: CD=0 identical to 1 (high buffer rarely re-enters); 2→2.71, 3→2.15.
- **EOD sweep** (13:00 window): 900→3.13, 885→4.46, 870→4.14, 855→4.32, 840→5.39, 825→5.51, 810→5.70, 795→5.10, **780→5.95 (best)**, 765→5.18, 750→4.73. Peak 13:00; stable 770–780.
- **TP sensitivity @EOD=780**: TP=3.0→3.01, 8.5→5.95, 99 (pure EOD)→5.26. Wide TP still adds a bit over pure EOD.
- **min_or_range sweep** (best config): 0.2/0.3/0.5/0.6 identical (PF=5.95, 12 trades); **≥0.7 → PF=8.97, 10 trades** (removes the 2 losing days in OR-range 0.6–0.7). 0.7–1.2 identical; 1.5→PF=24.3 but only 6 trades (overfit, discarded as unreliable).
- **Shorts**: on at minOR=0.8→PF=2.51, at minOR=0.3→PF=2.22. Short side destroys the edge. shorts=off.
- **Robustness (final config)**: SL=0.75→4.31 (worse), SL=1.25/1.5/2.0→9.91 identical; BUF=0.5→5.94, 0.7→9.26; EOD=770→9.91, 790→8.47; TP=8.0→9.48, 9.0→9.75. Config robust within ±1 buffer step, EOD 770–780, SL≥1.25, TP 8.0–9.0.
- **OR=60 rescue attempt** with best params → 3 trades, PF=0.0. Confirms multi-candle OR dead.
- **FINAL BEST (trustworthy):** OR=15, SL=1.25, TP=8.5, buffer=0.6, cooldown=1, shorts=off, EOD=780 (13:00), min_or_range=0.8, max_or_range=5.0 → **PF=9.91, WR=50%, net=+₹10,218, 10 trades** (2 TP / 0 SL / 8 EOD).
