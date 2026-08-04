# Autoresearch: newgen-supertrend

## Objective
Find the best Supertrend config for NEWGEN that maximizes `profit_factor`,
sweeping:
- timeframe `{15, 60}`
- ATR period `{7, 10, 14, 20}`
- ATR multiplier `{2.0, 2.5, 3.0, 3.5, 4.0}` (extended to `{1.0, 1.5}` after observing the data)
- fixed SL `{0, 1.0, 1.5, 2.0}`, fixed TP `{0, 2.0, 3.0, 4.0}`
- EOD exit `{870, 885, 900}`
- shorts on/off

## Strategy semantics
- Long when Supertrend flips to up (green); short when it flips down (red, if shorts enabled).
- Exit on Supertrend flip back, OR fixed SL/TP (if sl_pct/tp_pct > 0), OR EOD.
- Standard Supertrend: ATR(n) = SMA(TR, n); basic_up = hl2 - mult*atr; basic_down = hl2 + mult*atr;
  band follows prior band while trend persists (max/min chain). Reference: `experiments/benchmark_supertrend.py`.

## Primary metric
`profit_factor` (higher is better). Secondaries: `win_rate`, `net_pnl`, `total_trades`, `tp_exits`, `sl_exits`, `eod_exits`.
A config is trustworthy only if `total_trades >= 10` (single stock → small counts; PF from <10 trades flagged unreliable).

## How to run
```bash
source .venv/bin/activate
env NEWGEN_TF=15 NEWGEN_ATR_PERIOD=10 NEWGEN_MULT=3.0 NEWGEN_SL=0 NEWGEN_TP=0 \
    NEWGEN_EOD_EXIT=885 NEWGEN_SHORTS=0 \
    python experiments/newgen/newgen-supertrend/benchmark.py
```

## Files in scope (my unique namespace)
- `experiments/newgen/newgen-supertrend/benchmark.py`
- `autoresearch_newgen-supertrend.jsonl`
- `autoresearch_newgen-supertrend.md`
- `experiments/worklog_newgen-supertrend.md`
- `autoresearch-dashboard_newgen-supertrend.md`

## Off limits
- `experiments/newgen/common.py` (read-only) and `experiments/data/newgen_cache.pkl` (read-only)
- Other parallel sessions' files under `experiments/newgen/newgen-orb-*`
- No git operations. No network fetches.

## What's Been Tried
50 runs completed (see `autoresearch_newgen-supertrend.jsonl` and `experiments/worklog_newgen-supertrend.md`).

- **Run 1 (baseline)**: tf=15 ATR=10 MULT=3.0 SL=0 TP=0 EOD=885 SHORTS=0 → **0 trades**. NEWGEN is in a
  sustained 3-month uptrend (501→562) and close never breaches the mult=3.0 lower band → no flips, no entries.
  Same for the full prescribed multiplier sweep {2.0,2.5,3.5,4.0} (runs 2–5): all 0 trades. This motivated
  extending the multiplier sweep down to {1.0, 1.5} and longer ATR periods which actually generate flips.
- **Tight bands (mult 1.0–1.5) on tf=15 trade** (runs 6–13): flip-only exit is mostly negative (PF 0.07–0.74)
  except a couple of 2–3 trade flukes.
- **Adding fixed SL/TP** (runs 14–21, 30–33): SL=1.0%/TP=2.0% at ATR=20/MULT=1.0 → PF≈2.0 (11 trades).
- **tf=60** (runs 22–29, 40–41): huge PF numbers but only 2 trades — not trustworthy.
- **EOD sweep** (runs 34–37): 870/885/900 all retain PF≈1.95–2.02 on the best long-only config.
- **Shorts ON** (run 38): tf=15 ATR=20 MULT=1.0 SL=1.0 TP=2.0 EOD=885 → **PF=2.0766, 22 trades** (best).
  Flip-only with shorts (run 39) still negative.
- **Robustness** (runs 45–50): ATR∈{18,22}, MULT∈{0.9,1.1}, SL=0.8, TP=1.8 perturbations all keep PF>1.3
  with 19–26 trades.

### Best config (trustworthy)
tf=15, ATR=20, MULT=1.0, SL=1.0%, TP=2.0%, EOD=885, shorts=ON → PF=2.0766, WR=59.1%, net_pnl=₹4,641, 22 trades (tp/sl/eod=6/7/9).
