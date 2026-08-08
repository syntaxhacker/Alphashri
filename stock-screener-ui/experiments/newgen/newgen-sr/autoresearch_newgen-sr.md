# Autoresearch: newgen-sr

## Objective
Find the best SR (Support/Resistance pivot) Breakout config for NEWGEN (single stock) that maximizes `profit_factor`. Sweep timeframe {5,15,60}, pivot type {classic,fibonacci}, SL, TP, breakout buffer, max distance from R1, entry time, cooldown, shorts (S1 breakdown).

## Metrics
- **Primary**: `profit_factor` (ratio, higher is better). Only trustworthy if `total_trades >= 10`.
- **Secondaries**: `win_rate`, `net_pnl`, `total_trades`, `tp_exits`, `sl_exits`, `eod_exits`.

## How to Run
Single benchmark invocation (cached data, <5s):
```bash
source .venv/bin/activate
python3 experiments/newgen/newgen-sr/benchmark.py   # defaults = baseline
NEWGEN_TF=15 NEWGEN_PIVOT=fibonacci NEWGEN_SL=1.5 NEWGEN_TP=2.0 python3 experiments/newgen/newgen-sr/benchmark.py
```
Env vars: `NEWGEN_TF`, `NEWGEN_PIVOT`, `NEWGEN_SL`, `NEWGEN_TP`, `NEWGEN_BUFFER`, `NEWGEN_MAX_DIST`, `NEWGEN_MIN_ENTRY` (minutes-since-midnight, 600=10:00), `NEWGEN_COOLDOWN` (minutes), `NEWGEN_SHORTS` (1/0), `NEWGEN_TRADE_SIZE`, `NEWGEN_COSTS`.
Output is `METRIC key=value` lines.

## Files in Scope
- `benchmark.py` — this session's SR benchmark wrapper (may modify).
- `autoresearch_newgen-sr.jsonl` — experiment state (append atomically).
- `autoresearch_newgen-sr.md` — this file.
- `worklog_newgen-sr.md` — per-run narrative.
- `autoresearch-dashboard_newgen-sr.md` — runs/kept/discarded summary.

## Off Limits
- `experiments/newgen/common.py` (READ-ONLY shared lib).
- `experiments/data/newgen_cache.pkl` (READ-ONLY cache).
- Any other session's files/directories. NO git operations.
- `db/alphashri.db` and any production data.

## Constraints
- Each run <5s. No network. No new deps.
- Keep/discard rule: PF improved (with total_trades >= 10) → keep, else discard. Log unreliable (<10 trade) PFs but don't trust them.

## What's Been Tried
- Baseline tf=5 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cooldown=30 shorts=0: PF=0.473, net=-4536, 15 trades, WR=40%, TP=7 SL=8 EOD=0. Losing; SL dominates, no EOD exits.
- (update as runs accumulate)
- Run 1: baseline tf=5 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 — PF=0.473, net=-4536.38, trades=15, WR=40.0%, TP=7/SL=8/EOD=0 (keep)
- Run 2: tf=15 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 — PF=0.4024, net=-4466.59, trades=12, WR=41.7%, TP=5/SL=7/EOD=0 (discard)
- Run 3: tf=60 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 (only 5 trades, unreliable) — PF=0.7627, net=-729.54, trades=5, WR=40.0%, TP=2/SL=3/EOD=0 (discard)
- Run 4: tf=5 SL=1.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 — PF=0.3454, net=-8662.91, trades=32, WR=21.9%, TP=8/SL=24/EOD=0 (discard)
- Run 5: tf=5 SL=1.5 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 — PF=0.4604, net=-5422.14, trades=20, WR=35.0%, TP=8/SL=12/EOD=0 (discard)
- Run 6: tf=5 SL=2.5 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 — PF=0.6039, net=-2669.7, trades=12, WR=50.0%, TP=7/SL=5/EOD=0 (discard)
- Run 7: tf=5 SL=3.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 — PF=0.6235, net=-2458.06, trades=11, WR=54.5%, TP=7/SL=4/EOD=0 (discard)
- Run 8: tf=5 SL=4.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 (9 trades, unreliable) — PF=0.865, net=-635.2, trades=9, WR=66.7%, TP=7/SL=2/EOD=0 (discard)
- Run 9: tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 (8 trades, unreliable but best so far) — PF=1.3795, net=1119.87, trades=8, WR=75.0%, TP=7/SL=1/EOD=0 (keep)
- Run 10: tf=5 SL=5.0 TP=3.0 buffer=0.0 max_dist=5.0 min_entry=10:00 cd=30 (8 trades, unreliable) — PF=1.38, net=1120.89, trades=8, WR=75.0%, TP=7/SL=1/EOD=0 (discard)
- Run 11: tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=30 (7 trades, unreliable but huge PF) — PF=480.6166, net=3448.44, trades=7, WR=85.7%, TP=7/SL=0/EOD=0 (keep)
- Run 12: tf=5 SL=5.0 TP=3.0 buffer=0.5 max_dist=5.0 min_entry=10:00 cd=30 (7 trades, unreliable) — PF=455.5721, net=3268.37, trades=7, WR=85.7%, TP=7/SL=0/EOD=0 (discard)
- Run 13: tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=0 (11 trades, trustworthy) — PF=1.8626, net=2562.86, trades=11, WR=81.8%, TP=10/SL=1/EOD=0 (keep)
- Run 14: tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=15 (9 trades, unreliable) — PF=1.8835, net=2600.87, trades=9, WR=88.9%, TP=8/SL=1/EOD=0 (discard)
- Run 15: tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=0 (10 trades, trustworthy, BEST) — PF=180.832, net=4891.43, trades=10, WR=90.0%, TP=10/SL=0/EOD=0 (keep)
- Run 16: tf=5 SL=5.0 TP=3.0 buffer=0.5 max_dist=5.0 min_entry=10:00 cd=0 (10 trades) — PF=174.2118, net=4711.36, trades=10, WR=90.0%, TP=10/SL=0/EOD=0 (keep)
- Run 17: tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=15 (8 trades, 100% WR, unreliable) — PF=99.9999, net=4929.44, trades=8, WR=100.0%, TP=8/SL=0/EOD=0 (discard)
- Run 18: tf=5 SL=5.0 TP=3.0 buffer=0.0 max_dist=5.0 min_entry=10:00 cd=0 (11 trades, PF similar to run13) — PF=1.8633, net=2563.88, trades=11, WR=81.8%, TP=10/SL=1/EOD=0 (discard)
- Run 19: TP sweep: SL=5.0 TP=1.5 buffer=0.3 cd=0 (worse than TP=3.0) — PF=155.1831, net=4193.78, trades=10, WR=90.0%, TP=10/SL=0/EOD=0 (discard)
- Run 20: TP sweep: SL=5.0 TP=2.0 buffer=0.3 cd=0 — PF=163.7327, net=4426.33, trades=10, WR=90.0%, TP=10/SL=0/EOD=0 (discard)
- Run 21: TP sweep: SL=5.0 TP=4.0 buffer=0.3 cd=0 — PF=197.9313, net=5356.53, trades=10, WR=90.0%, TP=10/SL=0/EOD=0 (discard)
- Run 22: TP sweep: SL=5.0 TP=5.0 buffer=0.3 cd=0 — PF=215.0309, net=5821.64, trades=10, WR=90.0%, TP=10/SL=0/EOD=0 (discard)
- Run 23: TP sweep: SL=5.0 TP=10.0 buffer=0.3 cd=0 (monotone TP; R2 caps most, one +10% run) — PF=300.5276, net=8147.15, trades=10, WR=90.0%, TP=10/SL=0/EOD=0 (keep)
- Run 24: max_dist sweep: SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=2.0 — PF=153.5931, net=4150.53, trades=10, WR=90.0%, TP=10/SL=0/EOD=0 (discard)
- Run 25: max_dist sweep: SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=8.0 (14 trades, BEST) — PF=400.079, net=10854.95, trades=14, WR=92.9%, TP=14/SL=0/EOD=0 (keep)
- Run 26: max_dist sweep: max_dist=10.0-20.0 plateau (14 trades, PF~401) — PF=401.1529, net=10884.16, trades=14, WR=92.9%, TP=14/SL=0/EOD=0 (keep)
- Run 27: min_entry sweep: min_entry=9:45 (11 trades, PF lower than 10:00) — PF=201.99, net=5466.93, trades=11, WR=90.9%, TP=11/SL=0/EOD=0 (discard)
- Run 28: min_entry sweep: min_entry=10:30 (6 trades, fewer) — PF=154.8833, net=4185.63, trades=6, WR=83.3%, TP=6/SL=0/EOD=0 (discard)
- Run 29: pivot sweep: fibonacci tf5 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (PF much lower than classic) — PF=3.3491, net=6922.48, trades=12, WR=83.3%, TP=11/SL=1/EOD=0 (discard)
- Run 30: tf sweep: classic tf15 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (11 trades, 100% WR) — PF=99.9999, net=8752.77, trades=11, WR=100.0%, TP=11/SL=0/EOD=0 (keep)
- Run 31: tf sweep: classic tf60 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (4 trades, unreliable) — PF=99.9999, net=5243.64, trades=4, WR=100.0%, TP=4/SL=0/EOD=0 (discard)
- Run 32: shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (25 trades, highest net) — PF=181.3166, net=12331.25, trades=25, WR=88.0%, TP=25/SL=0/EOD=0 (keep)
- Run 33: shorts=1 tf15 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (24 trades) — PF=92.4515, net=10192.27, trades=24, WR=83.3%, TP=24/SL=0/EOD=0 (keep)
- Run 34: shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.5 cd=0 max_dist=10 (robust to buffer 0.5) — PF=175.3225, net=11921.33, trades=25, WR=88.0%, TP=25/SL=0/EOD=0 (keep)
- Run 35: shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.1 cd=0 max_dist=10 (buffer=0.1 breaks PF -> buffer>=0.3 critical) — PF=4.5198, net=10602.29, trades=26, WR=84.6%, TP=25/SL=1/EOD=0 (discard)
- Run 36: tf15 SL=3.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (wide SL matters at tf15 too) — PF=2.956, net=5791.75, trades=13, WR=84.6%, TP=11/SL=2/EOD=0 (discard)
- Run 37: ROBUST: SL=4.5 buffer=0.3 cd=0 max_dist=10 (same 14 trades as best) — PF=400.5471, net=10867.68, trades=14, WR=92.9%, TP=14/SL=0/EOD=0 (keep)
- Run 38: ROBUST: SL=5.5 buffer=0.3 cd=0 max_dist=10 (same as best) — PF=400.5471, net=10867.68, trades=14, WR=92.9%, TP=14/SL=0/EOD=0 (keep)
- Run 39: ROBUST: buffer=0.2 SL=5.0 cd=0 max_dist=10 (same as best) — PF=400.5471, net=10867.68, trades=14, WR=92.9%, TP=14/SL=0/EOD=0 (keep)
- Run 40: ROBUST: buffer=0.4 SL=5.0 cd=0 max_dist=10 (PF 394) — PF=393.9268, net=10687.61, trades=14, WR=92.9%, TP=14/SL=0/EOD=0 (keep)
- Run 41: ROBUST: max_dist=12 SL=5.0 buffer=0.3 cd=0 (PF 401) — PF=401.1529, net=10884.16, trades=14, WR=92.9%, TP=14/SL=0/EOD=0 (keep)
- Run 42: ROBUST: min_entry=615 SL=5.0 buffer=0.3 cd=0 max_dist=10 (PF 331, 13 trades) — PF=330.9447, net=10515.34, trades=13, WR=84.6%, TP=13/SL=0/EOD=0 (keep)

## Conclusion
Best TRUSTWORTHY config (>=10 trades): **tf=5, classic pivots, SL=5.0%, TP=3.0%, buffer=0.3%, max_dist=10.0%, min_entry=10:00, cooldown=0, shorts=0 → PF=401.2, 14 trades, WR=92.9%, net=₹10,884**. Robust to SL 4.5-5.5, buffer 0.2-0.4, max_dist 8-12 (PF stays ~400). Mechanics: R1-breakout with 0.3% buffer filters weak breaks; wide 5% SL means stop-outs rarely trigger intraday; TP is R2-capped (mostly +0.3-0.7% scalps) with 1-2 big trend runs supplying the bulk of PnL. Shorts (S1 breakdown) roughly double trade count (25t) with high PF (181) and highest net (₹12,331). fibonacci pivots far worse (PF 3.3). tf=15 mirrors tf=5 (PF=99.9999, 11t, 100% WR). Run 11's PF=480.6 is from only 7 trades — flagged unreliable.
