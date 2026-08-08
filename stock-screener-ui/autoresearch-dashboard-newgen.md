# Autoresearch Dashboard: newgen-intraday-parallel

**Runs:** 570 | **Kept:** 238 | **Discarded:** 332 | **Crashed:** 0
**Data:** NEWGEN via Upstox only, 2026-05-04..2026-08-04 (~62 trading days), cached experiments/data/newgen_cache.pkl

## Best Config Per Session

| Session | Best config | PF | WR | Net | Trades | Notes |
|---|---|---|---|---|---|---|
| **newgen-orb-5m** | OR=15 SL=1.0 TP=none(100) buf=0.45 cd=3 shorts=off EOD=845 mor=1.3 | 5.86 | 54.5% | +₹10,872 | 11 | robust 4.8-5.9 across perturbations |
| **newgen-orb-10m** | OR=5/10 SL=1.5 TP=3.5 buf=1.0 cd=1 shorts=off EOD=855 mor=2.5 | 8.24 | 80% | +₹9,887 | 10 | verified reproducible |
| **newgen-orb-15m** | OR=15(1 bar) SL=1.25 TP=8.5 buf=0.6 cd=1 shorts=off EOD=780(13:00) mor=0.8 | 9.91 | 50% | +₹10,218 | 10 | EOD 13:00 biggest lever |
| **newgen-orb-1h** | OR=any SL=0.01 TP=1.79 buf=0.5 cd=2 shorts=off EOD=885 | 3.51 | 20% | +₹578 | 5 | NOT trustworthy - single-winner curve-fit; realistic regimes lose |
| **newgen-sr** | tf=5 classic SL=5.0 TP=3.0 buf=0.3 max_dist=10 cd=0 shorts=off | 400.5 | 92.9% | +₹10,868 | 14 | wide SL => R1->R2 scalper, inflated by zero SL hits |
| **newgen-ema** | tf=5 fast=12 slow=26 SL=1.75 TP=1.0 cd=3 shorts=on EOD=850 | 2.16 | 70.1% | +₹16,947 | 67 | most trades - best statistically; tp~sl/2 scalp + early exit |
| **newgen-supertrend** | tf=15 ATR=20 mult=1.0 SL=1.0 TP=2.0 EOD=885 shorts=on | 2.08 | 59.1% | +₹4,641 | 22 | mult 2-4 never flips (strong uptrend); tight bands only |
| **newgen-bb-short-vol** | short:breakout_fail tf=5 SL=2.0 TP=4.5 EOD=915 | 2.28 | 57.9% | +₹3,376 | 19 | bb bounce tf15 PF1.32/31t; vol PF1.15/111t |

## Trusted vs Unreliable

Trustworthy (>=10 trades, robustness-checked): ORB 5m/10m/15m, EMA Cross tf5, Supertrend tf15, SR tf5 (still single-stock small), BB bounce tf15, short breakout_fail.

Unreliable / avoid: ORB 1h (5 trades), Supertrend tf60 (2 trades), SR PF 480 config (7 trades), RSI overbought short (6 trades).

## Recommended Configs for NEWGEN

1. **EMA Cross** (best stats): tf=5, fast=12, slow=26, SL=1.75%, TP=1.0%, cooldown=3, shorts=on, EOD=850 (14:10 IST) → PF 2.16, 67 trades
2. **ORB 5m**: OR=15, SL=1.0%, no TP cap, buffer=0.45%, cooldown=3, EOD=845, min_or_range=1.3% → PF 5.86 (11 trades)
3. **ORB 10m**: OR=5, SL=1.5%, TP=3.5%, buffer=1.0%, EOD=855, min_or_range=2.5% → PF 8.24 (10 trades)
4. **ORB 15m**: single-bar OR, SL=1.25%, TP=8.5%, buffer=0.6%, EOD=13:00, min_or_range=0.8% → PF 9.91 (10 trades)

## Run Count By Session

| Session | Runs | Kept | Discarded | Crashed |
|---|---|---|---|---|
| newgen-orb-5m | 117 | 33 | 84 | 0 |
| newgen-orb-10m | 72 | 18 | 54 | 0 |
| newgen-orb-15m | 111 | 69 | 42 | 0 |
| newgen-orb-1h | 45 | 17 | 28 | 0 |
| newgen-sr | 42 | 19 | 23 | 0 |
| newgen-ema | 90 | 18 | 72 | 0 |
| newgen-supertrend | 50 | 39 | 11 | 0 |
| newgen-bb-short-vol | 43 | 25 | 18 | 0 |
