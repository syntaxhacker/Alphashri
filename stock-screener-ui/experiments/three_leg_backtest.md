# Three-leg system backtest — Nifty-500, 10 weeks ending 2026-10-09

System: screen (legs A/B/C per `missed_breakouts_week42.md` §4) + catalyst filter
(`news_symbol_mentions` ±5 sessions, pass ≥ 1) + regime gate (Nifty weekly
change > −1% AND close > 20DMA, else skip whole week).
₹1L/trade, LONG only, costs on EVERY trade via `backtest/costs.py:calculate_trading_costs`.
Entry: first daily-bar break of setup level during the week, next-bar open.
Monday open > setup×1.03 = skip (unchaseable). SL = min(entry−boxlow, 1×ATR14),
no-box SL = 1×ATR14; target 2R; same-bar SL+target = SL; else Friday-close exit.
Companion data: `three_leg_backtest.json` (weekly × leg matrix, pooled trades,
killed-signal audit). Run script: `experiments/three_leg_backtest_run.py`.
Sibling dataset (`three_leg_dataset.json`) was not ready; weeks were built to
the same spec from the local 1D cache (494/501 symbols, 7 no-cache).

## 0. Bottom line (pooled, 10 weeks)

| Leg | Trades | Win% | Gross ₹ | Costs ₹ | **Net ₹ (no slip)** | **Net ₹ (+5bps/side)** | PF | Exp/trade ₹ | MaxDD ₹ |
|---|---|---|---|---|---|---|---|---|---|
| L1 screen only | 259 | 33.6 | −82,891 | 21,211 | **−104,103** | **−129,623** | 0.78 | −402 | 161,095 |
| L2 +catalyst | 76 | 38.2 | +3,095 | 6,229 | **−3,134** | **−10,626** | 1.03 | −41 | 31,859 |
| L3 +regime | 48 | 45.8 | +32,666 | 3,942 | **+28,725** | **+23,980** | 1.74 | +598 | 12,740 |

Exit mix (L1, n=259): TARGET 33 · SL 109 · Friday time-exit 117.

## 1. Ablation — what each leg adds (net ex-slippage)

| Step | Δ trades | Δ net ₹ | PF before → after | Verdict |
|---|---|---|---|---|
| L1 → L2 (catalyst kills score-0) | 259 → 76 (−183, **−70.7%**) | −104,103 → −3,134 (**+100,969**) | 0.78 → 1.03 | Filter earns its keep: killed expectancy −₹552/trade vs kept −₹41/trade |
| L2 → L3 (regime skips 7/10 weeks) | 76 → 48 (−28) | −3,134 → +28,725 (**+31,859**) | 1.03 → 1.74 | Gate dodges the Sep drawdown; all 28 skipped trades net −₹31,859 |

## 2. Weekly × leg matrix (net ₹ ex-slip / incl-slip; PF)

| Week end (setup) | Regime (wkΔ, close/DMA20) | L1 n / net / PF | L2 n / net / PF | L3 n / net |
|---|---|---|---|---|
| 08-07 (07-31) | OK (+2.59, 25727>DMA) | 43 / +38,887/+34,608 / 2.20 | 17 / +14,042/+12,358 / 2.16 | 17 / +14,042 |
| 08-14 (08-07) | OK (+0.77, >DMA) | 51 / −10,712/−15,730 / 0.90 | 23 / +3,400/+1,143 / 1.23 | 23 / +3,400 |
| 08-21 (08-14) | OK (−0.83, >DMA) | 36 / +7,842/+4,294 / 1.26 | 8 / +11,282/+10,479 / 2.61 | 8 / +11,282 |
| 08-28 (08-21) | SKIP (−0.47, <DMA) | 36 / −18,489/−22,036 / 0.67 | 6 / −2,663/−3,257 / 0.68 | 0 |
| 09-04 (08-28) | SKIP (−0.31, <DMA) | 19 / −14,772/−16,616 / 0.61 | 6 / −8,556/−9,129 / 0.43 | 0 |
| 09-11 (09-04) | SKIP (−1.15, <DMA) | 20 / −39,421/−41,374 / 0.15 | 5 / −14,908/−15,399 / 0.00 | 0 |
| 09-18 (09-11) | SKIP (−2.09, <DMA) | 12 / +9,015/+7,825 / 1.74 | 4 / +6,822/+6,423 / 3.73 | 0 |
| 09-25 (09-18) | SKIP (−0.56, <DMA) | 19 / −43,069/−44,942 / 0.10 | 4 / −9,748/−10,143 / 0.00 | 0 |
| 10-02 (09-25) | SKIP (−0.88, <DMA) | 11 / −18,527/−19,607 / 0.30 | 0 / 0 | 0 |
| 10-09 (10-01) | SKIP (−2.78, <DMA) | 12 / −14,855/−16,044 / 0.41 | 3 / −2,805/−3,101 / 0.08 | 0 |

Regime gate skips **7 of 10 weeks**. Nifty (Yahoo ^NSEI, cached to
`experiments/three_leg_nifty.csv`) topped early-Aug (~25.7k) and bled into Oct
(22.4k Oct-1); every setup from Aug-21 on closed below its 20DMA. L3 therefore
= the three benign early-Aug weeks only — the +₹28.7k is real but
narrow-regime evidence, not a full-cycle result.

## 3. Killed-signal audit (was the catalyst right to kill them?)

- Killed 183/259 L1 signals (**70.7%**). Their shadow P&L: gross −₹85,986,
  costs ₹14,983, **net −₹100,969** (incl-slip −₹118,997), PF **0.70**,
  expectancy **−₹552/trade**, win% 31.7. In aggregate: yes, right to kill.
- Kept 76 (L2): net −₹3,134, PF 1.03, expectancy −₹41. The filter removed
  ~97% of the screen's net loss.
- Caveat, both directions: the single best L1 trade (CUPID, week 10-09,
  +₹9,275 net, TARGET hit) was catalyst-killed (score 0) — the filter costs
  real winners too. And the 09-18 week shows L2 (n=4, PF 3.73) beating its
  killed siblings, i.e. the filter discriminated correctly even in a skipped
  (regime-off) week.

## 4. Hand verification (raw 1D cache candles, independent recompute)

1. **CUPID, week 10-09 (BEST, TARGET).** Setup Oct-1 C 312.50. Oct-5 O 314.30
   (+0.6%, no gap-skip), H 316.00 > 20d-high → break; entry Oct-6 O 310.95.
   qty ⌊1L/310.95⌋ = 321 ✓. ATR-risk 14.58 → SL 296.37, tgt 340.11 ✓.
   Oct-6 H 324.95 hold; Oct-7 H 345.00 ≥ tgt → exit 340.11.
   Gross (340.11−310.95)×321 = ₹9,360.54 ✓, costs ₹85.06 ✓ (recomputed
   buy ≈ ₹30.20 + sell ≈ ₹54.84), net ₹9,275.48 ✓.
2. **TDPOWERSYS, week 09-18 (WORST, SL).** Setup Sep-11 C 804.90. Sep-14 Mon =
   holiday (no bars — week runs Tue–Fri on available bars). Sep-15 H 817.55 >
   level → break; entry Sep-16 O 728.75. qty 137 ✓. SL 692.21;
   Sep-16 L 680.00 ≤ SL → exit 692.21 same entry bar.
   Gross (692.21−728.75)×137 = −₹5,005.92 ✓, net −₹5,086.88 ✓.
3. **BHEL, week 10-09 (SL).** Setup Oct-1 C 421.00, box high 442.65.
   Oct-5 H 433.45 no break; Oct-6 H 453.90 > box → break (matches post-mortem
   first-break Oct-6, C 452.00 ✓). Entry Oct-7 O 451.50, qty 221 ✓.
   ATR (12.44) tighter than box depth → SL 439.06, tgt 476.39 ✓.
   Oct-7 L 446.60 hold; Oct-8 L 429.45 ≤ SL → exit 439.06.
   Gross (439.06−451.50)×221 = −₹2,750.31 ✓, net −₹2,831.89 ✓.

## 5. Assumptions (all load-bearing, stated)

1. Screen = §4 rules verbatim, setup-sliced frames, ≥60 setup bars; week-42
   screen count reproduces the post-mortem union exactly (35/35).
2. Catalyst window is symmetric **±5 Nifty sessions** around setup — peeks
   into the outcome week. Live use should be prior-5 only; L2 is flattered.
3. Regime = Nifty (^NSEI Yahoo daily) week-over-week at setup + setup close
   vs 20DMA; whole-week skip.
4. Break = first bar with **high > level** (not close-break); no volume
   confirmation required (weaker than `watch.live`'s 1.5× rule).
5. SL/target filled exactly; same-bar conflict resolves to SL (conservative).
6. `published_at` date part treated as IST calendar date; mention matches on
   `trading_symbol` OR `symbol_code`.
7. Holiday-shortened weeks (Oct-2 Gandhi Jayanti; Sep-14 Ganesh Chaturthi —
   no bars) trade on available sessions; Monday-gap check uses first
   available bar of the week vs setup close.
8. Slippage 5 bps/side applied via price adjust (entry×1.0005, exit×0.9995)
   with costs recomputed at slipped prices; qty sized at quoted entry.
9. Per-week maxDD = peak-to-trough of cumulative net in (week, symbol) order;
   pooled maxDD concatenates weeks in chronological order — indicative only.

## 6. Limitations / next steps

- L3's profit rests on 3 benign weeks (n=48); the gate has never been tested
  holding *through* a whipsaw (regime flips intra-week are ignored).
- Catalyst lookahead (§5.2) needs a prior-5-only rerun before sizing on L2.
- No volume confirmation on entry; 117/259 L1 trades bleed out via Friday
  time-exit — a Day-1 volume gate (per post-mortem §4) is the obvious add.
- Single-entry, no pyramiding, no short side; ₹1L fixed notional (no
  volatility sizing).
