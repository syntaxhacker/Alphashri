# BOS-BREAK Entries — Backtest Report (6 tick sessions)

Standalone script: `experiments/smc/proposals/bos_backtest.py`
(`source .venv/bin/activate && python experiments/smc/proposals/bos_backtest.py` from `stock-screener-ui/`).
Engine untouched; structure discovery (3-bar fractal pivots, BOS levels, FVG pool, TP selection)
copied verbatim from `trading/smc_ifvg.py`. Tick evaluation: SL-first, LONG exits at bid,
SHORT SL at ask / TP at bid. One position at a time, 3-bar cooldown, EOD-open excluded
(all = engine conventions). Baseline = `SMCIFVGEngine(entries="inv")` on identical bars/ticks.

## Frozen rule spec (what was tested)

- **Structure (engine-identical):** 3-bar fractal pivots (2 bars each side, strict), confirmed at
  bar `i` for pivot bar `j = i-2`; new pivot resets the broken flag. BOS when a 1m close prints
  beyond the last unbroken pivot (`close > piv_high` → `bos_dir=+1`; `close < piv_low` → −1);
  the broken pivot is marked and cannot re-fire until a fresh pivot forms. FVGs (`gap > 2.0`)
  tracked only to give TP selection the same liquidity pool as the engine.
- **ENTRY:** side = `bos_dir` on the breaking bar's close; fill at the first tick of bar `i+1`
  (LONG at ask, SHORT at bid). Cancel if that tick already gaps past SL. Signals while in a
  position are ignored; 3-bar cooldown after each exit.
- **SL:** just beyond the broken level ± 6 pts buffer — LONG (broke `P`): `SL = P − 6`;
  SHORT (broke `P`): `SL = P + 6`. Skip if `|fill − SL| < 5.0`.
- **TP:** nearest untouched opposing liquidity (3-bar fractal pivot OR active non-inverted FVG
  edge, untouched over full history to the fill bar) with `|entry − TP| / risk ≥ 3.0`,
  else SKIP the signal (no trail, no fallback).
- **Exits:** SL-first on ambiguous ticks; no partials, no REV, no structure trail.

## Per-session results (pts)

| session   | BOS n | BOS net  | BOS PF | BOS W%  | INV n | INV net  | INV PF |
|-----------|------:|---------:|-------:|--------:|------:|---------:|-------:|
| 2026-07-02|    43 |  +175.15 |   1.36 | 23%     |    17 |  +673.57 |   2.55 |
| 2026-07-10|    27 |   −74.91 |   0.72 | 15%     |    26 |   +75.73 |   1.17 |
| 2026-07-22|    46 |   +30.77 |   1.07 | 26%     |    36 |  −193.72 |   0.63 |
| 2026-07-24|    30 |    −2.53 |   0.99 | 20%     |    23 |  +198.13 |   1.38 |
| 2026-08-26|    53 |    −3.55 |   0.99 | 21%     |    26 |  +341.29 |   2.11 |
| 2026-09-02|    25 |    −3.32 |   0.98 | 24%     |    26 |  −219.65 |   0.52 |
| TOTAL     |   224 |  +121.61 |   1.06 | 22%     |   154 |  +875.35 |   1.32 |

Signal funnel (BOS): 224 taken; skipped — no RR≥3 TP ~178 (24+32+31+22+35+31), busy 162,
cooldown 62, EOD-open 3. Expectancy: BOS +0.54 pt/trade vs INV +5.68 pt/trade.

## Overlap analysis (same side + overlapping hold windows)

- 63 matched pairs: BOS-first 34, INV-first 24, same-bar 5.
- **On the same moves, INV leg +1256.82 vs BOS leg +445.31** (win counts equal: 23 vs 22).
  Inversion entries get the better price (enter the pullback/inversion, not the chase) against
  the same structural TP — e.g. 07-02 07:40 BOS +39.30 vs INV +287.63; 07-02 15:50 BOS +84.93
  vs INV +256.43; 08-26 16:57 BOS +50.23 vs INV +140.31.
- **BOS-only flow (161 trades): net −323.70.** The extra breaks BOS takes that INV never
  touches are net losers — mostly chop-breaks that snap back into the 6-pt SL
  (BOS win rate on these ≈ 17%).
- INV-only flow (91 trades): net −381.47 — INV's extras lose too, but INV's pair edge
  (+811 over BOS on shared moves) dominates the total.
- BOS beat INV on INV's two red sessions (07-22, 09-02) — 6-session curiosity, not a hedge
  case: BOS-only flow is negative and the sample is tiny.

## Why BOS-break underperforms

1. **Chase pricing.** Entering the break pays the worst price of the move while SL sits a
   fixed 6 pts behind a micro-level that chop retests constantly → 22% win rate vs the 25%
   breakeven the RR≥3 gate requires.
2. **No selection.** Inversion/retest arming filters for a zone + bias confluence; BOS-break
   fires on every fractal break including range-expansion noise (224 vs 154 trades, 78% losers).
3. **Same TP, worse R.** Both use nearest untouched liquidity, so BOS's later entry compresses
   realized R on shared winners (pairs: +445 vs +1257).

## Verdict: REJECT (both as replacement and as complement)

- Replace: no — PF 1.06 vs 1.32, net +122 vs +875, expectancy one-tenth of INV.
- Complement (stacked division): no — the BOS-only incremental flow is −324 pts over 161
  trades; adding it dilutes the engine.
- Standing recommendation: keep BOS exactly where it is — as a **bias input** (`bos_dir`
  gating inversion/retest entries), never as an entry trigger. A possible follow-up is testing
  BOS-break *only* as an early-entry alternative inside already-matched pairs (limit-order at
  the inversion zone after BOS confirms), not as an independent signal stream.
