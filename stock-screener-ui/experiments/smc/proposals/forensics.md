# SMC iFVG losing-trade forensics — 6 tick sessions, engine defaults

Method (read-only): `SMCIFVGEngine()` defaults
(`gap_min=2, sl_buf=6, min_rr=3, min_risk=5, cooldown=3, ttl=30`, TP-less → structure trail)
run on Dukascopy US-100 ticks for
2026-07-02, 2026-07-10, 2026-07-22, 2026-07-24, 2026-08-26, 2026-09-02.
MFE/MAE measured tick-accurately (exit-side prices) between `t_in`/`t_out`.
Chase = signal-bar close distance beyond the inverted zone edge (SHORT: `zone_bot − close`;
LONG: `close − zone_top`), also expressed in R. Day-dir = full-session drift (diagnostic only).

**Headline: 154 trades, net +875.4 pts. 50 winners (+3570.8) / 104 losers (−2695.5).
Losers: 72 SL (−2116.5), 32 TRAIL (−579.0); 89 inv (−2480.5), 15 retest (−215.0).**

Per-session losers:

| session | n | P&L | SL | TRAIL | inv | retest |
|---|---|---|---|---|---|---|
| 2026-07-02 | 8 | −435.2 | 6 | 2 | 7 | 1 |
| 2026-07-10 | 17 | −442.6 | 11 | 6 | 16 | 1 |
| 2026-07-22 | 27 | −522.7 | 19 | 8 | 22 | 5 |
| 2026-07-24 | 14 | −528.2 | 12 | 2 | 11 | 3 |
| 2026-08-26 | 18 | −306.7 | 13 | 5 | 15 | 3 |
| 2026-09-02 | 20 | −460.1 | 11 | 9 | 18 | 2 |

## Loss clusters (primary cause, MFE-based partition — sums to 104 / −2695.5)

| # | cluster | n | net P&L | signature |
|---|---|---|---|---|
| 1 | Immediate failure (MFE < +0.3R) | 50 | −1335.3 | stopped/TRAILed with price never going anywhere; median hold 9 min vs 30.5 for winners |
| 2 | Mid-fade (MFE +0.3…+1.5R, then SL/TRAIL) | 40 | −1025.6 | moved ~½–1R favorably, reversed |
| 3 | Round-trip TP miss (MFE ≥ +1.5R → SL/TRAIL loss) | 14 | −334.6 | bankable excursion given back in full |

Cross-cutting (overlapping, not additive):

| cross-cut | losers | P&L | winners (same filter) | verdict |
|---|---|---|---|---|
| chase_r > 1.0 (signal close >1R beyond zone edge) | 13 | −303 | 4 (+159) | weak but real edge, ex-ante usable |
| same-side fill < 30 min before entry ("duplicate") | 28 | −718 | — (winners often follow losers too) | cooldown tested NEGATIVE, see below |
| risk < 12 ("stop in noise") | 8 | −81 | — | negligible; wide stops NOT guilty (risk-80+ bucket is net +347) |
| against full-day drift | 51 | −1281 | 20 (+1145) | no edge; fading the day produced the biggest winners (e.g. 07-02 13:04 LONG +288) |
| against trailing-30m momentum | 41 | −1010 | 13 (+1247) | no edge |
| stale zone (age > 30 bars) | 14 | −233 | 9 (+549) | no edge |
| Asia hours 00–08 IST | 17 | −362 | 4 (+307) | net −55, not worth a rule |

Killed hypotheses (no discrimination, winners ≈ losers): chase distance median
0.60R los vs 0.56R win; risk size median 27 vs 30; day direction ≈ 50/50 on both sides.

## Proposed rule changes (ranked by expected P&L impact)

**R1 — Breakeven stop once MFE ≥ +1.5R (new param, e.g. `be_trigger_r=1.5`).**
14 round-trips (−335) become ≈ scratch → ≈ **+300 gross**. Cost: winners that dipped
below entry after printing +1.5R get clipped at BE instead of full win — unquantified
(needs tick-sequenced MAE-after-MFE test). Expected net ≈ +150…+300. Note: the existing
`partials=True` (BE at +1R) is system-NEGATIVE (+103 vs +875, 214 trades — BE churn
creates re-entries), so the trigger must be ≥1.5R, not 1R.

**R2 — Skip inv when chase > 1.0R (relative `max_zone_dist_r=1.0`).**
Measured backtest-neutral accounting: removes 13 losers (−303), sacrifices 4 winners
(+159) → **+144 net** on these 6 sessions. Small sample; needs validation on fresh
sessions. Implement as R-multiple check next to the existing absolute `max_zone_dist`.

**R3 — Do nothing about duplicates/cooldowns (explicit anti-recommendation).**
"Skip same-side entry <30 min after a same-side loss" removes 35 losers (−781) but also
17 winners (+1262) → **−481**. "Skip if any same-side exit <20 min" → **−154**.
Day-drift alignment filter → **−549…−106** depending on buffer. Mean-reversion chop is
where the edge lives; cooldowns strangle it.

## Open problem

Cluster 1 (immediate failures, 50 / −1335 — half the bleed) has no ex-ante separator
among everything tested (chase, risk, day-dir, pre30, hour, zone age, kind). Next step:
tick-level signal quality (spread/slippage at fill, bar-range/close-position at signal,
BOS recency) rather than more trade-level filters.
