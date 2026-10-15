# AGENT BRIEF — NIFTY options mispricing research tracks

Read this fully before running anything. You are one of several parallel agents,
each owning **one** hypothesis track. Produce a machine-readable verdict, not prose.

## Environment

- Repo root: `/home/mysyntax/Documents/Alphashri/stock-screener-ui`
- Python (use this, NOT `python3`): `/home/mysyntax/Documents/Alphashri/stock-screener-ui/.venv/bin/python`
- Work only inside `experiments/research/nifty_options/`. Data cache: `experiments/data/nifty_options/`.
- **FYERS token is EXPIRED — do not call the network.** Use cached parquet only.
- **FORBIDDEN:** any `git` command, any write to `db/*.db`, deleting files, editing shared kernel files
  (`fyers_data.py`, `engine.py`, `costs.py`, `strategies.py`, `stats.py`, `runner.py`, `mispricing.py`).
  You may ADD new files under `tracks/`.

## Causal rules (non-negotiable)

- A signal at bar `i` may use only bars `0..i` (completed). Fills occur at bar `i+1` open.
- Never use future prices/OI/IV. Use prior-day info for daily features (`shift(1)`).
- Charge fees + spread + slippage on every leg (the engine does this automatically).

## Data

- Real NIFTY spot + INDIAVIX 1-min: `experiments/data/nifty_options/candles/NSE_NIFTY50-INDEX__1.parquet`
  (also `__5`, `__15`, `__D`). Columns: `ts,open,high,low,close,volume,oi`. `ts` is tz-aware IST.
- Real option 1-min contracts: `candles/NSE_NIFTY<...>__1.parquet`; manifest:
  `experiments/data/nifty_options/option_manifest.json` (fields: symbol, expiry, weekly, strike, opt, rows, first, last, volume_sum).
  Real window ≈ 2026-06-01 → 2026-09-25 (listed contracts only).
- **Real IV surface (built for you)**: `experiments/data/nifty_options/iv_surface_daily.parquet`
  columns: `ts,date,expiry,strike,opt,price,spot,T,iv,volume,rv,dte`.
- **Surface metrics**: `experiments/data/nifty_options/surface_metrics_daily.parquet`
  columns: `date,expiry,dte,atm_iv,rv,vrp,vrp_ratio,rr25,iv_put,iv_call,term_slope`.

## Kernel API (import from this dir)

```python
import sys; sys.path.insert(0, "experiments/research/nifty_options")
import runner as R, stats as st
from engine import EngineConfig, SyntheticOptionSource, RealOptionSource, ExpiryResolver, \
                   replay, Leg, Signal, build_legdicts
from costs import ExecutionModel
import mispricing  # build_surface(res), surface_metrics(df), implied_vol(...)

spot   = R.load_spot("5")                 # 5-min bars (resampled, cleaned)
meta   = R.load_daily_meta()              # day -> {prev_high, prev_low, prev_close}
synth  = SyntheticOptionSource.from_cached()          # 2018-2026, BS premiums (model)
real   = RealOptionSource()                            # actual premiums (2026 only)
resolv = R.build_weekly_resolver(start, end)           # synthetic expiries
# real resolver: build from option_manifest.json (see runner.run_mode for the pattern)

cfg = EngineConfig(capital=300_000, risk_pct=0.01, stop_pct=0.35, target_pct=0.60,
                   execution=ExecutionModel(), lot=65)

def my_strategy(ctx, i):                  # returns Signal | None
    # ctx._closes, ctx._highs, ctx._lows, ctx._opens  (numpy, index <= i only)
    # ctx.vwap(i), ctx.ema(i, span), ctx.atr(i, n), ctx.minutes(i), ctx.opening_range(i, or_min)
    # ctx.to_close_min(i), getattr(ctx,'prev_high',None), ctx.spot
    if ctx.minutes(i) < 60: return None
    return Signal([Leg("CE","BUY",0)], "reason", "tag", 0.35, 0.60, 120)

trades = replay(my_strategy, spot, synth, resolv, cfg, start, end, day_meta=meta)
net = [t.net_pnl for t in trades]         # also t.gross_pnl, t.fees, t.spot_entry, t.spot_exit
```

`RealOptionSource` replay: pass `require_data=True` and the real resolver; start date = 2026-06-01 or later.

Statistics: `st.summarize(net, 300000)`, `st.bootstrap(net)`, `st.weekly(net, dates)`,
`st.risk_of_ruin(net, 300000)`, `st.walk_forward(trades)`.

## The one rule that killed earlier tracks

Always report **raw directional accuracy**:
```python
sgn = [1 if t.legs[0]["opt"]=="CE" else -1 for t in trades]
mv  = [(t.spot_exit-t.spot_entry)*s for t,s in zip(trades,sgn)]
raw_acc = sum(1 for x in mv if x>0)/len(mv); raw_move = sum(mv)/len(mv)
```
If `raw_acc < 0.51`, a positive gross P&L is likely a **payoff-geometry artifact**, not an edge. Say so.

## What "cheap/rich" means here

An option is cheap/rich relative to: (a) realized vol (VRP), (b) the fitted smile at
the same timestamp, (c) the same strike at other expiries (term structure), (d) put-vs-call
skew. Rescue the *mechanism*, not just a pattern.

## Deliverable (write these two files, named after your track)

`tracks/<track>.json`:
```json
{"track":"<name>","hypothesis":"...","feature":"...","rule":"...","data":"...",
 "n_trades":0,"net_exp":0,"pf":0,"win":0,"total_net":0,"max_drawdown":0,
 "train_exp":0,"test_exp":0,"bootstrap_ci":[0,0],"tail_loss_p95":0,
 "raw_dir_accuracy":0,"edge_basis":"","capital_for_15k_week":0,
 "verdict":"accept|reject|defer","reason":"...","artifacts":["..."]}
```
`tracks/<track>.md`: ≤40 lines — hypothesis, method, result table, red-team objections, verdict.

Also append each experiment to `tracks/<track>_log.jsonl`.

## Definition of a real candidate

Positive expectancy **net of costs** on a held-out period, sample n ≥ 100,
bootstrap 90% CI excluding 0, max drawdown < 25% of ₹3L, and a stated mechanism.
If you cannot meet this, the correct verdict is `reject` — say so plainly.
