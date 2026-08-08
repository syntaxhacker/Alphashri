# newgen-ema Autoresearch Session

## Objective
Find the best EMA Cross intraday config for NEWGEN that maximizes **profit_factor**,
sweeping timeframe {5,15,60}, fast/slow EMA periods, SL, TP, cooldown, shorts, EOD exit.

## Metrics
- **Primary**: `profit_factor` (higher is better). Trustworthy only if `total_trades >= 10`.
- **Secondaries**: `win_rate`, `net_pnl`, `total_trades`, `tp_exits`, `sl_exits`, `eod_exits`.

## Strategy semantics (EMA cross intraday)
- Fast EMA vs slow EMA over closes (seeded like `ema_benchmark.ema`).
- LONG when fast crosses above slow; SHORT (if `NEWGEN_SHORTS=1`) on opposite cross.
- Enter at close of crossing bar during market hours only.
- Exit: TP / SL (intrabar high/low checks) / EOD exit (`NEWGEN_EOD_EXIT` minutes IST).

## How to run
```bash
source .venv/bin/activate
NEWGEN_TF=5 NEWGEN_FAST=9 NEWGEN_SLOW=21 NEWGEN_SL=1.0 NEWGEN_TP=1.5 \
NEWGEN_COOLDOWN=3 NEWGEN_SHORTS=0 NEWGEN_EOD_EXIT=885 \
python experiments/newgen/newgen-ema/benchmark.py
# log: ... | python experiments/newgen/newgen-ema/log_run.py "<desc>"
```
Each run <5s (cached data, no network).

## Files in scope (OWN)
- `experiments/newgen/newgen-ema/benchmark.py`
- `experiments/newgen/newgen-ema/log_run.py`
- `experiments/newgen/newgen-ema/autoresearch_newgen-ema.jsonl`
- `experiments/newgen/newgen-ema/autoresearch_newgen-ema.md`
- `experiments/newgen/newgen-ema/autoresearch-dashboard_newgen-ema.md`
- `experiments/newgen/newgen-ema/worklog_newgen-ema.md`

## Off limits
- `experiments/newgen/common.py` (read-only shared lib)
- `experiments/data/newgen_cache.pkl` (read-only cache)
- Any file outside the `experiments/newgen/newgen-ema/` namespace
- NO git operations

## What's Been Tried
90 runs logged. Summary of the search path:

1. **Baseline** (tf5 9/21 sl1.0 tp1.5 cd3 no-shorts eod885): PF 1.166, keep.
2. **tf sweep**: tf5 > tf15 > tf60. tf60 too few trades (9) + PF 0.41 — unreliable. tf15 caps ~1.12.
3. **fast/slow pairs**: 12/26 best (1.19). 5/13, 20/50 poor. 16/34 poor at win frame.
4. **SL sweep** (12/26): wider SL better — 2.0 → 1.38; 2.5/3.0 plateau/lower.
5. **TP sweep**: TP 1.0 >> 1.5/2.0/3.0. TP 0.5/0.75 raise WR but lower PF.
6. **sl2.0/tp1.0** → 1.61. Cooldown 0/1/3 identical (EMA cross self-spaces re-entry).
7. **Shorts ON** adds trades + net PnL, slight PF boost at right EOD.
8. **EOD sweep** (14:45→14:25→14:15→14:10): 885→1.61, 870→1.76, 855→1.96, **850→2.16**; earlier (845/840/830) worse.
9. **Winner**: tf5 12/26 sl1.75 tp1.0 shorts1 eod850 → **PF 2.162**, WR 70.1%, net 16,947, 67 trades.
10. **Robustness**: neighbors sl1.5–2.0 (1.98–2.16), adjacent pairs (1.67–1.71), tp 0.95 (2.11), shorts-off (1.79) — winner is a broad local plateau, not a spike.
