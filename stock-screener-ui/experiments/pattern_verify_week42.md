# Verification: pattern-profitability study, week 42 (2026-10-05 → 09)

Adversarial verifier report. Baseline: `experiments/pattern_profit_week42.json`
(+ generator `experiments/pattern_profit_week42.py`). Independent harness:
`experiments/verify_week42.py`. Cross-check: `experiments/verify_crosscheck.py`.
Refinement: `experiments/verify_refine.py`. Numbers: `pattern_verify_week42.json`.

## 1. Verdict: EXACT-MATCH (modulo rounding dust)

Recomputed **all 493 baseline trades** from raw daily candles via an independent
code path (own frame reader, own SL-first walk, `backtest/costs.py` directly):

- **483/493 bit-exact** (entry, qty, exit price/reason/date, gross, costs, net).
- **10/10 remaining mismatches are rounding dust only** — all in `ema_stack`,
  gross/net fields only, max **₹1.04/trade**. Cause: JSON stores SL/TP rounded
  to 2dp; gross was computed at full precision. Entry/qty/reason/date/costs
  match on those 10 too. Benign, not an error.
- **Lookahead audit (read every strategy branch): clean.** All indicators are
  causal (EMA/ATR forward recursions, bars `≤ signal bar` only); entries are
  next-session opens; 52w-high uses `exclude_current=True`.
- **Survivorship: accounted.** 494/501 both studies, identical 7 missing
  (`BAGMANE, BIRET, DUMMYHEG, EMBASSY, HFCL, MTARTECH, STLTECH` — REITs/InvITs
  with no daily tape + stale constituent tickers). DUMMYHEG looks like a
  stale/test ticker in the constituents list — worth cleaning upstream.
- **One real optimism source: zero slippage.** Baseline fills exactly at
  open/level/close. Re-running all 493 with +5 bps adverse slippage on every
  fill: total net **−₹464,903 → −₹513,204** (≈ **−₹98/trade**, ~10% worse).
  No gap-below-SL fills occurred (0/493). Conclusions unaffected (losses are
  5–20× larger than this bias).

## 2. Top-1 pick (incl. MA/ADX/momentum variants)

W0 expectancy ranking (₹/trade): `orb_proxy` −542 (n=102) > `sr_breakout` −686
> `ema_stack` −703 (n=16) > `ema_cross` −798 > `week52_chaser` −1,194 (n=2,
noise) > `adx_trend` −1,371 > `week52_target` −1,841 > `consolidation` −2,324.
**Top-1 = `orb_proxy`**: least-negative expectancy at the largest sample among
the least-bad, and also least-negative on pooled priors (−₹465/trade, n=145).
(`ema_stack` has the best win% at 31.2% but worse expectancy at n=16.)

## 3. Stability: edge is not a one-week fluke — losses are 3/3 weeks

Same fixed parameters, baseline's own code, prior weeks
(W-2 = Sep 21–25; W-1 = Sep 28–Oct 1, 4 sessions, Oct 2 holiday):

| strategy | W-2 (n / net) | W-1 (n / net) | W0 (n / net) |
|---|---|---|---|
| orb_proxy | 106 / −33,580 | 39 / −33,902 | 102 / −55,274 |
| ema_stack | 36 / −67,349 | 9 / **+2,385** | 16 / −11,250 |
| adx_trend | 303 / −226,057 | 155 / −169,997 | 157 / −215,168 |

Market context (equal-weight Mon-open→Fri-close, 494 stocks): W-2 −0.8%,
W-1 −3.4% (only 10.9% of stocks up), W0 −1.05%. Long-only breakouts bled in
all three down weeks. The lone green cell (`ema_stack` W-1, n=9) is noise.

Independent weekly-hold protocol (signal Friday close → hold next week, 9
candidates incl. I-EMA/I-ADX/I-ACC/I-RSI): **all 9 negative in all 3 weeks**
(worst: P-REV −₹11.3k/trade; best-prior I-ACC is an n=7 artifact). Convergent.

## 4. Refinement: does NOT survive

Grid `sl_pct × tp_pct` = 9 cells on **priors only** (W-2+W-1 pooled).
Best cell `(0.75, 2.0)`, −₹41,730 pooled. Locked, evaluated **once** on
untouched W0: **−₹39,351, n=94, exp −₹419/trade, PF 0.42, win% 16.0.**
Refinement improves nothing — still firmly negative. No config change
recommended; baseline params stand only as documentation, not as tradable.

## 5. Expected value, sizing, "what could we have made"

- **Per-signal EV (orb_proxy, W0): −₹542 ± ₹175 (95% CI [−716, −367],
  n=102, sd=₹900).** p(win)=0.196, payoff ratio b=1.13.
- **Kelly: f\* = 0.00 → DO NOT TRADE.** Capped-25% of zero is zero.
  If a regime filter ever produces positive EV: ≤ quarter-Kelly, max 5
  concurrent, ₹1L/slot.
- **Last week at ₹1L/trade (unconstrained): −₹55,274** (−₹65,293 with
  slippage). Taking every signal needed **₹61L** deployed (61 concurrent max
  on Oct 7). **₹5L capital (5 slots): expected −₹2,710/week.** I.e. you
  would have *lost* money at any capital — that is the finding.

## 6. Overfitting warning (blunt)

n=1 week for W0; but the top-1 loses 3/3 weeks, refinement fails on holdout,
and an independent protocol agrees. There is **no demonstrated edge** in any
tested variant (patterns, EMA-stack, ADX-trend, RSI thrust, accumulation,
SR/ORB/52w). Do not trade these long-only breakouts without a proven
positive-EV regime filter — in these down weeks, buy-and-hold lost ≈1–3%
and the strategies lost considerably more (wide stops + weekly holds +
chasing confirmed breakouts at next open).
