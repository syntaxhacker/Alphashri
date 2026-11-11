# CISD + LRLR — complete deep-dive (NQ)

**Verdict: comprehensively dead as a systematic strategy.** The Oct-13 example is real and
profitable; the *population* it belongs to loses. This document is the full characterisation,
produced by 8 agents (BC→BK) with an honest fill engine and a true holdout.

## 1. What the model is (mechanically)
1. **Liquidity sweep** — a bar takes out a reference low (PDL / session low / swing low / EQ) and closes back inside.
2. **Completion** — the sweep stops making new lows (the low is "locked").
3. **CISD** — a close beyond the HIGH of the last consecutive down-close run (the delivery flips).
4. **Entry** — market at the CISD close / next open.
5. **Stop** — beyond the deepest swept low.
6. **Target** — the opposing liquidity pool ("low-resistance liquidity run").

**Canonical example (2026-10-13, our feed):** sweep 30,369.5 (09:32) → complete 09:33 → CISD 30,410.5 →
entry 30,418.7 → stop 30,368.5 → pool 30,550.5 → **+2.61R**. (Your TradingView scale is ~+230 higher.)

⚠️ **The timing matters and is easy to get wrong:** firing the CISD *before* the sweep completes
(09:30) gets **stopped out −1.13R**; firing it *after* completion (09:33, BE's definition A) wins.
BC/BD got this wrong; BE fixed it.

## 2. The base rate (the population)
| | |
|---|---|
| instances catalogued (2022-26, all TFs) | **42,209** |
| win rate | **40.7%** |
| **avgR** | **−0.062** |
| PF | 0.89 |
| t | **−10.3** |
| full −1R stops | **54%** |
| same-bar-target share | **0.97%** (clean) |
| negative in every period? | **yes** — 2022-24 −0.062 · 2024H2 −0.086 · 2025-26 −0.056 |
| negative at every TF? | **yes** |

**"Looking like the chart" predicts nothing:** the mechanically-defined Oct-13-like subset
(sweep depth ≥0.5·ATR, clean CISD, target ≥2R) — **n=9,222, win 36.6%, avgR −0.065** — i.e.
*slightly worse* than setups that don't look like it.

## 3. Where it forms / at which timeframes
- **Frequency:** extremely high (~24k signals on 1m alone, 2022-26).
- **Per TF:** 1m is worst (−0.08R, t −6); 3m/5m −0.02…−0.07; **best raw is 15m ≈ 0.0 (PF 1.01)**;
  4h nominally +0.1 but n=135 (noise).
- **Time of day:** no robust cluster (the open bucket is only weakly less-bad).
- **Regime:** no robust high/low-vol or trend/range split.

## 4. Why it loses (the mechanics)
**Only ~10% of trades reach 2R before the stop, while 54–59% are full −1R stops.**
A distant target with a 10% touch rate cannot pay for the stops. That single fact is the whole verdict.

## 5. What is INERT (tested, adds nothing)
- **The liquidity reference:** PDL / PDH / session H-L / prior swing / **EQ clusters** / Asia / prior week — all ≈ base or worse. *Equal-highs clustering adds zero over a single swing.*
- **The delivery-flip definition:** MSS / down-leg origin / sequence high / displacement — all ≈ the baseline.
- **Multi-TF alignment:** all 5 layers (HTF CISD, higher-TF level, prior-day bias, HTF EMA, HTF VWAP).
- **Context (24 causal features × 94 buckets):** 1/94 buckets survive in all 3 periods = the multiple-testing null.
- **The LRLR premise itself:** all path features (swings in the path, opposing momentum, distance, VWAP/PDC crossings, cleanliness) have |r| ≤ 0.06 with the outcome and flip sign across regimes.
- **No target carries R:** pool ≈ 1R ≈ 2R ≈ 3R ≈ next-pool ≈ time exit.

## 6. What is HARMFUL
- **Structure overlays:** FVG / **iFVG** / order-block / CISD+FVG retests are *all worse* than base at every TF (OB: win 32%).
- **Multi-sweep** (double sweep, sweep-of-a-sweep): worse in all periods.
- **Fading the CISD** (continuation): the worst cell in the grid (−0.18…−0.21R).
- **Limit-retrace entries:** pure adverse selection (win 19–29%, ~54% fill, 11–15% same-bar stops).
- **Scale-out** (partial + runner): worse than a fixed target.

## 7. What is WEAKLY HELPFUL (but not enough)
**A wider stop** — 0.5·ATR behind the sweep is the least-bad stop in **all** regimes
(−0.064/−0.054/−0.092 vs base −0.076/−0.081/−0.127). It is better, and still negative.
→ **The stop is partly too tight**, but that is not the source of an edge.

## 8. The one survivor (and why it isn't real)
*Entry within 0–1 ATR of the day-high-so-far* — the only bucket positive in all 3 periods
(n=3,051, +0.036/+0.039/+0.013) — has **t = 0.96 / 1.43 / 0.20** and **halves when the single
best month is removed**. That is the expected behaviour of one marginal survivor out of 94 buckets.

## 9. Is the winner/loser split predictable? (agents BK + BM)
**Yes — weakly.** Out-of-sample classifier AUC **0.566-0.581** (stable >0.55), and a score-built filter
**beats a matched placebo 100%**. So the outcome is NOT pure noise: **HTF alignment and the
target/stop geometry genuinely select better trades.**

**Top stable discriminators** (same sign in all three periods):
| feature | Cliff's | meaning |
|---|--|--|
| **targetR** | **0.115** | **a FARTHER target LOSES** (the pool is too far) |
| **riskPts** | 0.062 | **a WIDER stop WINS** |
| er15 | 0.061 | a higher efficiency ratio is worse |
| dayHiDist / distATR | 0.05 | closer to the day high / a closer target is better |
| dayOpenDist / prevCloseDist / clearAtr / atr15pct | 0.04 | weak-but-stable context |
*(pxVsEma240 / ema240slope FLIP SIGN → the slow HTF EMA alone is not a bias.)*

**HTF alignment is REAL** (aligned vs counter, by period): 15m −0.015 vs −0.089 ALL
(OOS +0.001 vs −0.099; HOLD −0.059 vs −0.099; IS −0.025 vs −0.072); 1h −0.004 vs ~−0.08 (OOS +0.011).

**BUT the magnitude is insufficient.** The best combined filter (score + a closer target + a wider
stop) gives testA **+0.008 (t 0.42)**, holdout **+0.025**, and **walk-forward +0.006 (t 0.51)** with
folds flipping sign; it has **no dose-response** (top-15% → negative), **dies when the best month is
removed** (ex-2026-07 = +0.0007), and its prop drawdown (78R ≈ $9.8k at 0.25%) fails.
→ **the signal is real; the edge is ~2 orders of magnitude too small.**

## 11. The exit/hold axis (agent BN — the last untested lever)
Hypothesis: the engine capped the hold at 40 bars, so **time-exits were cutting winners short** — let them run.
**Result: the opposite.** Hold sweep (10/20/40/60/120/240 bars / to session end / **unlimited**):
| hold | IS 1m avgR | OOS 1m avgR |
|---|--|--|
| 10 bars | **−0.056** (least-bad) | −0.076 |
| 40 (baseline) | −0.062 | −0.081 |
| unlimited | **−0.073** (worst) | **−0.087** |

- Time-exit share falls 44% → 0% — **but the trades being cut were small PROFITS; holding them longer converts them into full −1R stops.** Per-trade sd **1.27 → 1.63R (+28%)**: variance up, **mean down**.
- **Trailing stops are the worst family** (PF 0.56-0.68; the tightest trail is the worst cell in all 3 periods: −0.30…−0.36R, t to −37). MFE-capture turns marginally positive (+0.08) — via tiny wins against full stops.
- Partials lift the win rate to ~49% yet avgR stays **< 0**.
- **Walk-forward: 6/8 folds negative, pooled −0.141R (t −1.55, PF 0.83).**

**Conclusion: the quick exits were PROTECTING the equity, not leaking it.** There is no exit scheme
(10 bars → unlimited, fixed / trail / partial / next-pool) that makes the model positive.

## 12. FINAL VERDICT (all axes exhausted)
Every axis has now been swept — **entry, stop, target, hold/exit, filter, context (24 features × 94 buckets),
TF (1m-4h), multi-TF alignment, liquidity reference, delivery-flip definition, structure overlays
(FVG/iFVG/OB), multi-sweep, direction, and the combined causal filter** — plus a **42,209-instance
catalog**, **walk-forward on every family**, and a **true untouched holdout**.
**Nothing is positive.** The outcome is *weakly* predictable (AUC ~0.57; the filter beats the placebo)
and the **HTF bias is a real discriminator** — but the edge is ~20× too small to overcome costs.
The Oct-13 trade is a **97.6th-percentile outlier inside a breakeven-to-negative cohort.**

## 12b. The final exploration wave (BS–BW) — every remaining dimension, eliminated
| agent | dimension | result |
|---|---|---|
| **BS** | **the continuation** (trade *through* the pool — the one hypothesis the whole study pointed at) | ❌ **WORSE than the reversal** — negative in 118/120 cells; IS −0.089 / OOS −0.191 / HOLD −0.213 (win 20-23%); WF −0.056 (t −3.25) |
| **BT** | **the tail** (what the R≥3 winners have in common) | ❌ **unpredictable luck** — the 10 biggest winners' nearest-neighbour cohorts average **−0.114R** (isolated outliers, not repeatable) |
| **BU** | **any positive pocket** (1-D + 2-D + 94 buckets) | ❌ **none** — 0/66 1-D cells positive in all 3; the best (`09h & 15m` +0.098/+0.152/+0.176) is **below the selection-aware noise null** (p99 = +0.126) |
| **BV** | **any profitable time window** (48 half-hour slots × sessions × TF × 2 signal sets, with a shift test) | ❌ **none** — the best (`15m 09:30-10:00`, +0.10/+0.15/+0.18) has **t 1.58 vs a bar of 3.9**, the **plateau fails**, and **4% of random windows beat it** |
| **BW** | **long vs short** | ❌ **no tradeable side** — the difference is significant only in OOS and **flips sign**; the matched random-entry control ≈ the signal; 0/123 cells pass |

**The two "least-bad" locations, found independently by multiple agents:**
**the NY open (09:00–10:00 ET, best on 15m)** and **the power hour (15:30–16:00)**.
Both are nominally positive in all three regimes and both sit **inside the noise band** (t ≈ 0.8–1.7 where the
multiple-testing bar is 3.4–4.1; they beat ~95% of random-selection draws, which is exactly chance).

## 13. Verdict
**No path filter, target, stop, entry, structure, reference, alignment, or context makes this
model positive at t≥2 in IS + OOS + HOLDOUT on any timeframe.** The Oct-13 chart is a real trade
drawn from a negative-expectancy distribution — a **hindsight example, not an edge**.
What *is* true: the model's outcome is **weakly predictable** (AUC ~0.57) and the **HTF bias is a
genuine discriminator** — but neither is strong enough to overcome costs. The decisive arithmetic:
**the wins average ~1.3R while 26% of trades ever see 2R and 50-60% are full −1R stops.**

## 10. Artifacts
- Catalog of all 42,209 instances: `bf_catalog/agent_BF_catalog.csv`
- Per-agent results: `agent_code/agent_B[CHIJ]*_result.json` + `MUSE_LOG.md`
- Marked charts: `bb_verify/oct13_LRLR_BSL.png` (the canonical trade), `bf_catalog/*.png` (best/worst)
