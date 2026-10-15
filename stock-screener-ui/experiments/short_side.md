# SHORT side mirror backtest — verdict + numbers

Dataset: `experiments/three_leg_dataset.json` (10 weeks ending 2026-10-09, Nifty-500,
daily candles via `chart_patterns` cache). Costs: `backtest/costs.py:calculate_trading_costs`
with `side="SHORT"` on **every** trade. ₹1L notional/trade. Slippage variant: 5 bps/side
(short-unfavourable: entry×(1−5bps), exit×(1+5bps)). All shorts: enter next open, cover
Friday close. Full per-trade detail: `experiments/short_side.json`. Runner:
`experiments/short_side_backtest_run.py`.

> **CAVEAT (stated, not solved):** swing shorting in cash is not practical for most
> accounts — there is no cash-carry short; this needs intraday or F&O/SLB. Costs below
> are intraday-style. This study tests only whether the **EDGE** exists; execution comes later.

## Systems

- **S1 breakdown**: CLOSE below 20d low (or box low from the dataset screen) on ≥1.5×
  avgvol20 → short next open. SL = breakdown-day high, fallback entry+1×ATR(14).
  Target = entry − 2R. Plus one mission-necessary gate found during verification:
  the level must be *live* — setup close ≥ level and within 10% above it (mirror of the
  long leg-A distance filter). Without it, stale box lows far above price fired
  trivially (e.g. box-low 1710 vs price 1160).
- **S2 failed-breakout fade**: screened long signals (legs A/B/C) whose breakout day
  (high > level) closes back below the level within 2 sessions → short next open.
  SL = max(breakout-day high, fail-day high), fallback entry+ATR. Target 2R.
- **S3 distribution short** (own spec, setup-only, no outcome peek): in the last 10 setup
  sessions, a *distribution day* = down day (close < prev close) on ≥1.3× avgvol20 with a
  weak close ((close−low)/(high−low) < 0.5). If ≥3 distribution days AND 5-session return
  < 0 → short the first outcome-day open. SL = highest high of last 5 setup sessions
  (fallback entry+ATR). Target 2R.

## Verdict: NO short edge in S1/S2; S3 is interesting but tiny (61 trades)

| system | trades | win% | net (no-slip) | net (+slip) | expectancy | PF | maxDD |
|---|---|---|---|---|---|---|---|
| S1 breakdown | 312 | 42.9 | **−99,876** | −130,834 | −320 | 0.76 | 131,070 |
| S2 fade | 218 | 51.4 | **+6,882** | −14,642 | +32 | 1.12 | 44,557 |
| S3 distribution | 61 | 57.4 | **+24,318** | +18,275 | +399 | 1.40 | 25,323 |

- **S1 is decisively negative** — gross itself is −74k before costs (PF 0.76), so this is
  not a cost problem, it is a signal problem. Breakdowns snap back within the week:
  only 23/312 (7%) reach the 2R target; 203/312 (65%) end in Friday-cover exits and
  86 hit the (wide) breakdown-day-high stop. Costs (~₹82/trade) add −25.6k on top.
- **S2 is zero** — +6.9k no-slip flips to −14.6k with slippage (PF 1.12 → sub-1.0).
  Fading failed breakouts is exactly offset by continuation weeks (wk3: −25k; wk7: −35k).
- **S3 is the only green system** (PF 1.40, green even with slippage), but n=61 over 10
  weeks (~6/wk) — suggestive, not conclusive. Its edge concentrates in down weeks
  (see below); first-5 weeks it lost −19.8k, last-5 it made +44.1k. Unstable.

## Regime interaction (up vs down outcome-weeks; Nifty outcome-ret in .json)

Nifty outcome-week returns: wk1 +0.77 (up), wk2–wk9 all negative (−0.22…−3.11, 8 down
weeks), wk10 +0.44 (up). So "down-week" sample dominates (8/10 weeks).

| system | up-week net (n) | down-week net (n) |
|---|---|---|
| S1 breakdown | −34,332 (68) | −65,544 (297) |
| S2 fade | +9,654 (40) | −2,773 (178) |
| S3 distribution | +5,927 (22) | +18,392 (39) |

Expectation ("shorts work in down weeks") is **rejected for S1**: breakdown shorts lose in
*down* weeks too (−65.5k over 297 trades) — breakdowns in a drifting market snap back
before Friday. S2 is flat in both regimes. Only **S3 behaves as expected** (both splits
green, expectancy +270 up / +472 down) — but again, n is small.

Extreme weeks illustrate the mechanism, not data errors (spot-checked raw candles):
wk7 (Nifty −0.22%, flat) massacred S1 (−79.7k, 3/32 wins — e.g. JSWINFRA breakdown
326.4 → entry 326.45 → SL 349.2 hit on the snapback); wk9 (Nifty −3.11%, crash week)
is the *only* strongly green S1 week (+51.3k, 86 trades, PF 2.35). Breakdown shorts only
pay in crash weeks and bleed everywhere else.

## Stability: first-5 vs last-5 weeks

| system | first-5 net | last-5 net |
|---|---|---|
| S1 | −46,947 | −52,929 (negative in both halves — stable loser) |
| S2 | −31,306 | +38,188 (sign flip — no stable edge) |
| S3 | −19,791 | +44,109 (sign flip on n≈30/half — unstable) |

## Hand-verification (raw candles → booked trade, all 3 check out)

1. **S1 BEML wk1**: setup 07-31 O/H/L/C 1770/1799.2/1741.7/1750.4; break day 08-04
   1750/1774/1685/**1690.6** (close < box-low 1693.2 ✓, vol 320006/avgvol = 1.69× ✓);
   entry 08-05 open **1700.2** ✓; SL = break-day high **1774** ✓; tgt 1700.2−2×73.8 =
   1552.6 ✓; 08-06 high 1738.6, 08-07 high 1817.6 → SL hit ✓.
   Gross (1700.2−1774)×58 = −4280.40 ✓; SHORT costs 30.41+51.83 = 82.24 ✓.
2. **S2 360ONE wk1**: ref 1170; 08-04 high 1174 > 1170 (break) but close 1155 < 1170
   (fail same day, within 2 sessions ✓); entry 08-05 open **1174.0** ✓;
   SL = max(1174, 1174) = entry → ATR fallback 1174+34.35 = **1208.35** ✓;
   week high 1197 < SL ✓, tgt 1105.31 untouched ✓ → Friday exit 1168.1 ✓;
   gross (1174−1168.1)×85 = 501.50 ✓.
3. **S3 ABSLAMC wk1**: dist_days 3, ret5 −0.51% ✓; entry 08-03 open **1026.3** ✓;
   SL 1029.3 (setup 5d high); tgt 1020.3 ✓; 08-03 bar H 1027.8 < SL ✓, L 1000.0 ≤ tgt →
   TARGET day 1 ✓; gross (1026.3−1020.3)×97 = 582.00 ✓.

## Bottom line

Mirror-image shorting of this universe/period has **no robust edge**: S1 loses steadily
(PF 0.76 on gross — signal, not costs), S2 is slippage-negative noise, S3 is a 61-trade
hint that needs out-of-sample validation before any sizing. Combined with the long-side
losses, the honest read is that weekly breakout/breakdown directional holds on this
dataset did not survive costs in either direction — consistent with the verifier's
−3% false-positive skew note: the screen's "predictions" fade within days regardless
of side.
