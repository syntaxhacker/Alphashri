# Entry-timing study (screened A/B/C signals, 10 weeks ending 2026-10-09)

Runner: `experiments/entry_timing_run.py` → `experiments/entry_timing.json` (this file is the human read-out).
Universe: all rows in `experiments/three_leg_dataset.json` with `screen.screened == true`
(legs A/B/C, screen built on bars ≤ setup session — screen NOT rebuilt here, nothing fitted).
Costs: `backtest/costs.py:calculate_trading_costs` on EVERY trade/leg. Notional ₹1L/trade
(₹50k/leg for V5). LONG only except V4. Slippage run: ±5bps/side price adjust, qty fixed,
costs recomputed. Win% = share of trades with net > 0. PF = Σ(net>0) / |Σ(net≤0)| on net.
maxDD = peak-to-trough of cumulative net in (week, symbol) order.
Level = setup box high, else 20d high. Break = first outcome-day close > level.
Rows with `already_above` (175, extended) skipped in ALL variants. 480 screened rows never
broke (no_break). No-box SL fallback: entry − 1×ATR14 on setup bars. Same-bar SL+target = SL.

Baseline differs deliberately from `three_leg_backtest.json` (that used high>level trigger,
ATR-based SL, catalyst/regime gates). Here B0 = mission-defined: close-break, next-open,
SL = box low, no gates — so every variant is comparable on the identical signal set.

## Rank table (pooled, 10 weeks)

| rank | variant | trades | win% | net (no slip) | net (5bps) | expectancy | PF (no/slip) | maxDD (no/slip) |
|---|---|---|---|---|---|---|---|---|
| — | **V3 limit@level** | 105 | 71.4 | **+₹144,234** | +₹133,829 | +₹1,374 | 4.16/3.75 | −10k/−11k |
| — | V3c same-trigger @close (sensitivity) | 105 | 25.7 | −₹84,977 | −₹95,293 | −₹809 | 0.38/0.34 | −87k/−97k |
| 1 | **V4 fade-the-flag SHORT** | 67 | 55.2 | **+₹7,411** | **+₹817** | +₹111 | 1.14/1.01 | −25k/−29k |
| 2 | V2 hold + volume | 72 | 41.7 | −₹35,998 | −₹43,080 | −₹500 | 0.65/0.60 | −39k/−46k |
| 3 | V1 hold-confirm | 102 | 39.2 | −₹53,670 | −₹63,693 | −₹526 | 0.62/0.57 | −56k/−65k |
| 4 | V5 half + add | 179 | 31.8 | −₹79,640 | −₹93,275 | −₹445 | 0.60/0.55 | −84k/−96k |
| 5 | **B0 next-open baseline** | 179 | 33.0 | −₹101,059 | −₹118,626 | −₹565 | 0.64/0.60 | −126k/−139k |

V3 is ranked "—" because its profit is an artefact (see verdict). Only V4 is ≥ 0, and only
barely once slippage is applied.

## Per-week net (trades / net no-slip / net 5bps-slip)

| wk | B0 | V1 | V2 | V3 | V3c | V4 | V5 |
|---|---|---|---|---|---|---|---|---|
| W1 | 39 / +13,026 / +9,172 | 24 / −10,144 / −12,503 | 14 / +1,091 / −283 | 27 / +37,771 / +35,089 | 27 / −16,623 / −19,286 | 11 / −3,738 / −4,822 | 39 / +844 / −2,234 |
| W2 | 32 / −10,851 / −13,981 | 19 / −22,710 / −24,569 | 14 / −20,942 / −22,307 | 19 / +40,861 / +38,977 | 19 / −9,636 / −11,497 | 10 / +6,061 / +5,078 | 32 / −17,398 / −19,842 |
| W3 | 27 / −17,709 / −20,354 | 18 / −6,380 / −8,153 | 15 / −5,725 / −7,203 | 21 / +42,574 / +40,475 | 21 / −21,736 / −23,803 | 10 / −14,608 / −15,592 | 27 / −11,925 / −14,097 |
| W4 | 27 / −13,758 / −16,412 | 13 / +4,758 / +3,480 | 9 / +8,655 / +7,758 | 10 / +12,272 / +11,295 | 10 / −2,208 / −3,183 | 8 / −3,007 / −3,803 | 27 / −5,247 / −7,190 |
| W5 | 14 / +1,244 / −109 | 6 / +11,097 / +10,502 | 3 / +3,823 / +3,521 | 6 / +16,192 / +15,607 | 6 / +2,266 / +1,685 | 8 / +2,567 / +1,795 | 14 / +6,022 / +5,051 |
| W6 | 13 / −23,343 / −24,610 | 8 / −4,215 / −4,992 | 7 / −2,839 / −3,517 | 6 / −1,118 / −1,709 | 6 / −8,325 / −8,914 | 4 / +5,234 / +4,839 | 13 / −13,954 / −14,973 |
| W7 | 2 / −269 / −469 | 1 / −434 / −533 | 1 / −434 / −533 | 2 / +3,146 / +2,945 | 2 / −1,006 / −1,205 | 0 / 0 / 0 | 2 / −383 / −532 |
| W8 | 14 / −37,678 / −39,053 | 8 / −17,368 / −18,159 | 5 / −11,349 / −11,842 | 9 / −7,292 / −8,183 | 9 / −19,219 / −20,108 | 8 / +11,922 / +11,134 | 14 / −27,597 / −28,671 |
| W9 | 3 / −682 / −979 | 1 / +1,940 / +1,839 | 1 / +1,940 / +1,839 | 1 / +1,104 / +1,005 | 1 / −2,275 / −2,373 | 2 / +2,115 / +1,919 | 3 / +687 / +491 |
| W10 | 8 / −11,039 / −11,830 | 4 / −10,213 / −10,605 | 3 / −10,218 / −10,512 | 4 / −1,276 / −1,672 | 4 / −6,215 / −6,609 | 6 / +865 / +269 | 8 / −10,690 / −11,278 |

## First-5 vs last-5 weeks (no-slip net / expectancy / PF; slip net in brackets)

| variant | W1–W5 net | exp | PF | W6–W10 net | exp | PF |
|---|---|---|---|---|---|---|
| B0 | −27k (−42k) | −202 | 0.85 | −73k (−77k) | −1,825 | 0.24 |
| V1 | −23k (−31k) | −292 | 0.78 | −30k (−32k) | −1,377 | 0.19 |
| V2 | −13k (−19k) | −238 | 0.82 | −23k (−25k) | −1,347 | 0.23 |
| V3 (fictional fill) | +150k (+141k) | +1,803 | 6.64 | −5k (−8k) | −247 | 0.72 |
| V3c (feasible fill) | −48k (−56k) | −578 | 0.51 | −37k (−39k) | −1,684 | 0.07 |
| V4 SHORT | −13k (−17k) | −271 | 0.73 | **+20k (+18k)** | +1,007 | 3.75 |
| V5 | −28k (−38k) | −199 | 0.79 | −52k (−55k) | −1,298 | 0.18 |

Longs decay hard in W6–W10 (B0 expectancy −202 → −1,825). V4's entire pooled profit comes
from 20 trades in W6–W10 — small-sample flip, not a regime-robust edge (it lost in W1–W5).

## Hand-verification (3 trades, recomputed from raw 1D pickle candles)

1. **B0 360ONE W1** (leg A, level 1170.0, box low 1060.6): 08-05 close 1192.0 > 1170 break ✓.
   Entry 08-06 open 1193.1, qty floor(1e5/1193.1) = 83. 08-06 low 1180.9 / 08-07 low 1151.0
   (no SL at 1060.6); highs 1197.0/1192.8 (no target 1458.1). Friday exit 1168.1.
   Gross (1168.1−1193.1)×83 = −2075.0; costs 81.51 → **net −2156.51** ✓ matches record.
2. **V4 BAJFINANCE W1** (no-box, level 1151.5 = 20d high): 08-03 close 1153.0 > level break,
   break-day high 1176.4 = SL. 08-04 close 1149.0 < level = fail ✓. Entry 08-05 open 1152.0,
   qty 86, R = 24.4, target 1103.2. 08-05/08-06 no touch; 08-07 low 1074.5 ≤ target,
   high 1113.0 < SL → TARGET @1103.2. Gross (1152.0−1103.2)×86 = 4196.8; costs 81.84 →
   **net +4114.96** ✓.
3. **V3/V3c BERGEPAINT W1** (level 528.1): break 08-04 (close 533.8). Touch 08-05:
   low 525.1 ≤ 528.1×1.01 = 533.38 and close 545.2 > 528.1 ✓. V3 level-fill: entry 528.1,
   tgt 554.68; 08-05 high 555.0 ≥ tgt → TARGET, gross (554.68−528.1)×189 = +5023.62 →
   **net +4939.8**. V3c close-fill: entry 545.2, SL 531.91; 08-05 low 525.1 ≤ SL → SL,
   gross (531.91−545.2)×183 = −2432.07 → **net −2513.74**. Same signal, same day,
   **₹7.4k swing from the fill assumption alone** — the V3 edge is the fill, not the setup.

## Blunt verdicts

- **B0 next-open: CONFIRMED LOSER.** −₹101k / 179 trades, PF 0.64, negative in 8/10 weeks.
  Reproduces the earlier finding on the full screened set with mission-defined rules.
- **V1 hold-confirm: NO.** Halves the trade count but expectancy (−526) ≈ B0 (−565). The filter
  discards trades, not losses — confirmation at these levels is still buying the top, one day later.
- **V2 hold + volume: NO.** Same story as V1 (−500/trade, PF 0.65). Volume on Day+1 adds nothing.
- **V3 limit-retest: REJECT — artefact.** +₹144k requires fills at the exact level while the
  touch proxy tolerates lows up to 1% above it (mean phantom discount 1.73%, median 1.32% —
  ≈ ₹1.7k/trade gift on ₹1L notional vs expectancy +₹1.4k). Feasible-fill V3c on the IDENTICAL
  trigger set: −₹85k, PF 0.38, wins 26%. The "edge" is 100% entry-price fiction plus
  dip-and-recover selection bias (touch requires close > level). Do not trade V3 without
  intraday data proving real fills; daily bars cannot validate it.
- **V4 fade-the-flag SHORT: FLAT, not an edge.** +₹7.4k pooled → +₹0.8k with slippage
  (PF 1.01). Profitable only in W6–W10 (n=20) when longs were collapsing — i.e. it is short
  beta, not a flag-fade edge; it lost −₹12.7k in W1–W5. Plus swing shorting needs F&O/SLB
  (borrow cost, bans, lot sizes) that this backtest does NOT model — live P&L would be worse.
  Hypothesis to test with more data, not a strategy.
- **V5 half + add: NO.** −₹80k / 179 trades; expectancy (−445) marginally less bad than B0 only
  because half the book sits out when Day+1 fails — while paying two sets of costs. Position
  sizing cannot fix a negative-expectancy entry.

**Bottom line: none of the five timing variants rescues the screened long-breakout setups.
The defect is the screen/level (buying extended tops), not the entry day. V3's apparent
profit is a backtest artefact; V4 is slippage-away-from-zero with an unmodelled borrow
constraint. Stop refining entry timing on this signal set — fix or drop the screen.**
