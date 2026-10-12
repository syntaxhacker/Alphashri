# Bounded pre-weekend setup search — findings (10 weeks ending 2026-10-09)

Loop runner: `experiments/loop_search.py` → raw numbers `experiments/loop_search_out.json`
(console: `experiments/loop_search_console.txt`).
Universe Nifty-500, ₹1L/trade, costs on EVERY trade (`backtest/costs.py`,
SHORT side where applicable), slippage 5bps/side reported both ways
(`net` = ex-slip, `net_slip` = after-slip; expectancy columns below are **after-slip**).

Split discipline: FIT = weeks 1–7, OOS = weeks 8–10 locked, evaluated ONCE per
candidate. Confirm bar: pooled expectancy_slip > +₹300/trade AND fit-half
net_slip > 0 AND oos-half net_slip > 0 AND pooled n ≥ 40.
Fit-red but OOS-green = REJECTED, no re-fitting on OOS.

## Verdict: NO-SHIP (stop condition b — all 5 candidates exhausted, no edge confirmed)

| Cand | Best variant (fit-selected) | Fit n / exp ₹ | OOS n / exp ₹ | Pooled n / exp ₹ | Max concur | Verdict |
|---|---|---|---|---|---|---|
| C1 MR-long oversold | r3: ret5<−3%, dry<0.8, no-reclaim, tgt 3% | 16 / **+383** | 2 / −19 | 18 / +338 | 5 | REJECT (n<40, OOS flat) |
| C2 smallcap momentum | as-specified BLOCKED; proxy: rupee-vol<fit-median + L1 chase | 114 / −109 | 26 / −2,378 | 140 / −530 | 26 | REJECT (red both halves) |
| C3 weekly-base (12w) | r2: rng≤12%, dist≤6%, Mon→Fri | 48 / −337 | 31 / −1,858 | 79 / −934 | 12 | REJECT (red both halves) |
| C4 catalyst≥2 drift | base: screened & score≥2, Mon→Fri | 11 / −40 | 1 / −1,378 | 12 / −151 | 3 | REJECT (n≪40, red) |
| C5 S3 distribution-short | base (verbatim), short Mon→Fri | 52 / −257 | 34 / **+1,895** | 86 / +594 | 27 | REJECT (fit-half red → sign-flip, see §C5) |

Pooled PF for reference: C1 1.63 · C2 0.48 · C3 0.31 · C4 0.94 · C5 1.76.
(PF flatters small-n above-zero-gross cases; the expectancy + halves rule governs.)

## Per-round log

- **C1-R0** `ret5<−5%, dry<0.8, 5DMA-reclaim, tgt+3%`: fit n=0. **C1-R1**
  (`−7%`): n=0. **C1-R2** (`−5%`, dry<0.7, tgt 4%): n=0. Diagnosis (fit only):
  3/677 screened fit-rows had ret5<−5% — the screen selects near-high
  accumulation names (obv>0, ema20x≥0.98), so 5-day droppers are structurally
  absent. The hypothesis as specified is nearly empty by construction.
- **C1-R3** (3rd/last refinement, 2 changes: `ret5<−3%`, drop reclaim):
  fit n=16, exp +₹383, PF 1.57 → best-fit variant → single OOS eval:
  n=2, exp −₹19. Pooled n=18 < 40. REJECT.
- **C2-R0** proxy `rupee-vol20 < fit-median (₹134.3cr), L1-verbatim chase`:
  fit n=114, exp −₹109. **C2-R1** (`<0.5×median`): fit n=68, exp −₹533
  (tighter = worse). OOS on R0: n=26, exp −₹2,378, PF 0.16. REJECT.
  As-specified mcap<₹8000cr BLOCKED: no point-in-time cap data exists locally
  (DB `instruments` has no cap/shares; a current TradingView fetch = lookahead
  bias). The rupee-volume proxy is the closest setup-observable tier cut.
- **C3-R0** `12w rng≤12%, dist≤4%`: fit n=24, exp −₹627. **C3-R1** (rng≤10%):
  n=9, exp −₹438. **C3-R2** (dist≤6%): n=48, exp −₹337 → best → OOS:
  n=31, exp −₹1,858, PF 0.15. REJECT. Weekly bases break down as often as they
  follow through; loosening the gate only adds losers.
- **C4-R0**: fit n=11 (exp −₹40), OOS n=1. Catalyst≥2 is ~1% of screened rows —
  untradeable sample, no refinement spent. REJECT.
- **C5-R0** S3-verbatim (dist≥3 in last-10, ret5<0, SL=5d-high, 2R tgt,
  Friday cover): fit n=52, exp −₹257 (PF 0.94) → no refinement warranted
  (fit shows no promise) → single OOS eval: n=34, exp **+₹1,895**, PF 4.18.
  Fit-red/OOS-green = textbook sign-flip → REJECTED per split discipline.
  14-week extension impossible (cache ends 2026-10-09; no outcome data exists).

## §C5 — why the tempting one is still a reject

Pooled C5 reads +₹594/trade over 86 trades, which would pass the pooled leg of
the bar — but the fit half (−₹257, n=52) fails, and the OOS profit concentrates
in the Sep-28→Oct-9 selloff weeks (Nifty wk-chg −0.56/−0.88/−2.78): distribution
shorts pay when the market confirms weakness. Prior work (`short_side.md`)
found the mirror image (first-5 −₹19.8k / last-5 +₹44.1k). Both studies agree:
S3's sign follows the tape regime, and neither study has a regime-conditioned
OOS confirmation. Outlier check: removing the largest OOS winner (POLICYBZR
wk9, +₹16.6k, verified real below) leaves OOS +₹47.8k / 33 = +₹1,448/trade —
still green, so this is regime behavior, not one bad print. Hypothesis for a
future loop (NOT tested here): S3 armed only when Nifty < 20DMA at setup.

## Hand verification (raw 1D cache candles → booked C5 OOS trades)

1. **POLICYBZR wk9**: Mon 9-28 O **1180.0** ✓ entry; Fri 10-01 C **980.0** ✓
   exit (TIME-Friday); qty ⌊1L/1180⌋=84 ✓; gross 16,800, net_slip 16,628 ✓.
   SL 1904.9 (5d-high, stock −33% into setup) untouched ✓. Single bars/day,
   smooth cascade — real, not an artifact.
2. **ABREL wk10**: 10-05 O **1110.4** ✓ → 10-09 C **1022.3** ✓; qty 90 ✓;
   gross 7,929 vs net_slip 7,751 ✓; SL 1245 > week high 1131 ✓.
3. **ZFCVINDIA wk10**: 10-05 O **2250.0** ✓ → 10-09 C **2082.2** ✓; qty 44 ✓;
   gross 7,383 vs net_slip 7,206 ✓.

## Position sizing note

₹1L fixed notional/trade. Max concurrent Monday entries observed: C1 5 · C2 26 ·
C3 12 · C4 3 · **C5 27 (wk10)**. A literal C5 deployment would need ~₹27L
same-morning capital in crash weeks — 27× the per-trade notional. Any future
design must specify concurrent-capping (first-N / pro-rata changes fills) and
be backtested with the cap, not without.

## Invalidation rule (for the recorded C5 observation)

If a future regime-conditioned S3 is tested on new outcome weeks: kill it if
the locked-OOS expectancy_slip ≤ +₹300/trade, or either regime-half nets ≤ 0,
or pooled n < 40. Do not re-tune on the new OOS.

## Assumptions / limitations

- Setup features use bars with IST date ≤ setup session only (verified slicer).
- Monday-open entries assume liquidity at the print; no volume gate on C1/C3/C4.
- C5 ATR = Wilder over ≤60 setup sessions (prior study: full-setup ewm);
  recount vs `short_side.json`: 86 vs 61 trades, same per-week shape
  (theirs 6/5/9/4/5/6/6/1/3/16, mine 6/5/11/6/5/9/10/4/3/27) — implementation
  micro-differences (duplicate-date open convention, ATR window), same
  instability conclusion under both splits.
- Costs are intraday-style; cash swing-shorting needs F&O/SLB (prior caveat stands).
- No network used; DB untouched (read-only catalyst leg already in dataset).
