# Autoresearch: newgen-orb-10m

## Objective
Find the best ORB (Opening Range Breakout) parameter set for NEWGEN (NSE) on **10-min candles** that maximizes **profit_factor**, by sweeping OR durations {5,10,15,60} and tuning SL/TP/buffer/cooldown/shorts/EOD/min_or_range.

## Metrics
- **Primary**: profit_factor (ratio, higher is better)
- **Secondary**: win_rate (%), net_pnl (₹), total_trades (count), tp_exits, sl_exits, eod_exits
- A config is only trustworthy if `total_trades >= 10`. PF from <10 trades is unreliable (still logged, but noted).

## How to Run
```bash
source .venv/bin/activate
python3 experiments/newgen/newgen-orb-10m/benchmark.py
```
Env overrides (each run ~0.7s):
`NEWGEN_OR_MIN`, `NEWGEN_SL`, `NEWGEN_TP`, `NEWGEN_BUFFER`, `NEWGEN_COOLDOWN_BARS`, `NEWGEN_SHORTS` (0/1), `NEWGEN_EOD_EXIT` (minutes, 900=15:00), `NEWGEN_TRADE_SIZE`, `NEWGEN_MIN_OR_RANGE`, `NEWGEN_MAX_OR_RANGE`.

Output: `METRIC key=value` lines + `INFO` line on stderr describing the config.

## Files in Scope (this session's namespace)
- `experiments/newgen/newgen-orb-10m/benchmark.py` — benchmark entry point
- `autoresearch_newgen-orb-10m.jsonl` — experiment state (atomic writes)
- `autoresearch_newgen-orb-10m.md` — this file
- `experiments/worklog_newgen-orb-10m.md` — per-run narrative
- `autoresearch-dashboard_newgen-orb-10m.md` — runs summary + table

## Off Limits
- `experiments/newgen/common.py` (READ-ONLY shared lib) and `experiments/data/newgen_cache.pkl` (data)
- NO git operations (shared filesystem with 7 other parallel agents)
- No other sessions' files (`newgen-orb-5m`, etc.)

## Constraints
- Data is Upstox-only, already cached. NO network fetches.
- Window: 2026-05-04..2026-08-04, 65 trading days.
- Each benchmark run must complete in <5s.
- Use common.simulate_orb / compute_metrics / print_metrics exclusively.

## Baseline (Run 1)
OR=15, SL=1.0, TP=1.5, buffer=0.3, cooldown=1, shorts=off, EOD=900, min_or_range=0.3.
→ PF=0.954, WR=38.9%, net=-₹486, trades=36, tp=13, sl=16, eod=7. **keep** (baseline)

## What's Been Tried
71 runs completed (66 keep/discard decided on metric, plus robustness probes).

**Best trustworthy config (≥10 trades):** OR=5, SL=1.5, TP=3.5, buffer=1.0, cooldown=1, shorts=OFF, EOD=855 (14:15), min_or_range=2.5 → **PF=8.24**, WR=80%, net=₹9886, 10 trades (run 47).

**Wins:**
- OR=5/10 (identical on 10-min candles — both use only the 9:15 candle) massively beat OR=15 (PF≈0.95) and OR=60 (PF≈0.47). Wide ORs lose the breakout edge.
- Wider SL (1.5-2.0) beats tight SL; with SL≥2.0 losses nearly vanish but trades drop.
- min_or_range=2.5 filters to high-volatility days only → big PF boost (0.3→2.5: 1.57→2.74 at fixed SL/TP).
- EOD=855 (14:15) is the sweet spot; 870/885 hurt PF badly at tuned params.
- Buffer 1.0-1.5 helps (1.0 best for trade count; 1.5 gives PF 18+ but only 9 trades, unreliable).

**Failures / dead ends:**
- shorts=ON always hurts (adds unprofitable short entries).
- TP=0 (no TP) is degenerate in simulate_orb (instant TP at entry) — 161 "TP" exits, PF=0. Ignore.
- minOR=4.0 drops to 8 trades (unreliable) with PF 1.46.
- cooldown>1 and cooldown=0 both slightly worse than cooldown=1.
- Runs 50/51 (buffer=1.5) hit PF 18-21 but only 9 trades — below the 10-trade trust threshold, NOT chosen as best.

## Next Ideas
- Robustness: config is stable around OR5/SL1.5/TP3.5/buf1.0/minOR2.5/EOD855 (neighbors give PF 5-8).
- Could explore trade_size / max_per_day but out of scope of the param grid.
