# New trend/breakout patterns — Week 42 (2026-10-05 .. 2026-10-09, NIFTY 500)

Research backtest. Code: `backtest/strategies/new_patterns_week42.py`
(registered in `backtest/strategies/__init__.py`, runnable via
`BacktestEngine.run`), runner `experiments/run_new_patterns_week42.py`.
Raw numbers: `experiments/new_patterns_week42.json` (per-variant totals);
trade/signal lists: `experiments/new_patterns_week42_trades.json`.

## Protocol (identical for every variant, incl. baselines)

- Daily bars, NIFTY 500 (501 symbols, `chart_patterns.universes`).
- Signal on close(T) → enter next session open. Exception: gap-and-go enters
  the **same-day open** (gap is known pre-entry, zero lookahead) with a
  volume-confirmation filter applied at the close; failures exit next open
  as `VOL_FAIL`.
- LONG only, 1 position/symbol, no re-entry while holding.
- SL = max(1×ATR(14), entry − signal level); target = entry + 2R.
  Same-bar SL/target ambiguity → SL first (conservative).
- Exits: `TARGET` / `SL` / `WEEK_END` (Fri 2026-10-09 close).
- Size: floor(₹1,00,000 / entry), min 1 sh. Costs via
  `backtest/costs.py:calculate_trading_costs()` on **every** trade (verified:
  0 trades with zero costs; 0 entries before signal date).
- Data: disk cache only — **0 live Upstox fetches** for the whole run
  (≤6 fetch workers requested, cache served everything). 500/501 symbols had
  full week coverage.

## Regime context (read first)

Down week for LONG breakouts: **329 of 500 names fell**, median weekly return
**−1.33%** (mean −0.95%, range −8.6% … +18.1%). Friday (10-09) signals could
not be entered (no next-open in window): 30 unfilled signals across variants.
Only **3 TARGET hits in the entire study** (2 in base_20d, 1 in base_52w) —
with a 5-day window, 2R targets are nearly unreachable; most trades end
`SL` or `WEEK_END`. Everything below must be read with that headwind in mind.

## Head-to-head rank (by net P&L; all variants lost money this week)

| # | Variant | Trades | Win% | Gross (₹) | Costs (₹) | Net (₹) | PF | Expect/ trade (₹) | MaxDD (₹) |
|---|---------|--------|------|-----------|-----------|---------|----|-------------------|-----------|
| 1 | 52W-high + volume | 1 | 0.0 | −1,999 | 82 | **−2,080** | 0.00 | −2,080 | 2,080 |
| 2 | Accum + ADX≥20 gate | 8 | 25.0 | −13,677 | 646 | **−14,323** | 0.15 | −1,790 | 16,791 |
| 3 | RSI thrust (cross 60) | 9 | 22.2 | −17,629 | 733 | **−18,362** | 0.20 | −2,040 | 22,894 |
| 4 | Accumulation breakout | 10 | 20.0 | −18,766 | 809 | **−19,575** | 0.11 | −1,958 | 22,043 |
| 5 | BASE 52w proximity | 14 | 21.4 | −19,839 | 1,143 | **−20,981** | 0.33 | −1,499 | 30,226 |
| 6 | ADX breakout (≥25, rising) | 9 | 11.1 | −25,955 | 732 | **−26,687** | 0.01 | −2,965 | 26,687 |
| 7 | BASE 20d break | 22 | 22.7 | −31,940 | 1,790 | **−33,731** | 0.34 | −1,533 | 44,318 |
| 8 | EMA-stack breakout | 12 | 8.3 | −34,193 | 976 | **−35,169** | 0.00 | −2,931 | 35,169 |
| 9 | Failed-breakdown reversal | 48 | **43.8** | −37,612 | 3,936 | **−41,548** | **0.48** | **−866** | 41,548 |
| 10 | EMA-stack ablation (no gate) | 16 | 12.5 | −40,494 | 1,303 | **−41,797** | 0.02 | −2,612 | 42,436 |
| — | Gap-and-go | 0 | — | 0 | 0 | 0 | — | — | — (no signals; see §5) |

Notes: `adx_breakout_nogate` ≡ `base_20d` by construction (same rule set),
so it is folded into the BASE 20d row. Best expectancy **per trade** is
failed-breakdown (−₹866); best win% too (43.8%, PF 0.48 — the only PF
approaching 0.5). It also traded most (48) so costs (₹3,936) dominate.

## Ablations — what did the MA/ADX filters add?

| Pair | Gated | Ungated | Δ win% | Δ PF | Δ expectancy | Verdict |
|------|-------|---------|--------|------|--------------|---------|
| Accum vs Accum+ADX≥20 | 25.0% / 0.15 / −1790 (n=8) | 20.0% / 0.11 / −1958 (n=10) | +5pp | +0.04 | +₹167 | weakly helpful |
| EMA-stack vs no-gate | 8.3% / 0.00 / −2931 (n=12) | 12.5% / 0.02 / −2612 (n=16) | −4pp | −0.02 | −₹319 | gate hurt |
| ADX≥25+rising vs plain 20d | 11.1% / 0.01 / −2965 (n=9) | 22.7% / 0.34 / −1533 (n=22) | −12pp | −0.33 | −₹1,432 | gate hurt a lot |

The ADX≥25+rising gate filtered **out** both TARGET winners (CUPID-style
continuation moves) and kept concentrated losers. The EMA-stack gate
(close>EMA20>EMA50) likewise selected names that then mean-reverted
(8.3% wins, worst expectancy). The mild ADX≥20 gate on accumulation is the
only filter with a positive sign — and n=8 vs 10 is noise. **Do not ship any
gate on this evidence.**

## Per-variant notes

1. **Accumulation breakout** (10T, −19.6k): OBV slope>0 + vol 5/20 ≥1.5 via
   `chart_patterns.watch._near52w_row` (imported, not copied) + 20d-high
   close break. 7 SL / 3 WEEK_END. Losers were entry-day reversals (BHEL-type).
2. **Accum + ADX≥20** (8T, −14.3k): same + ADX floor. Removed 2 losers, no
   signal-shape change otherwise.
3. **Gap-and-go** (0 signals): threshold ≥3% over prior 20d high never
   triggered — verified max gap in-window was **2.32%** (median −8.66%;
   only 2 bars ≥1%). Variant is untestable this week, not broken.
4. **52W-high + volume** (1T, −2.1k): within-1%-under + 2× vol is extremely
   selective (2 signals, 1 unfilled Friday). Rank #1 by net is a sample-size
   artefact — ignore the rank, keep the variant for a longer window.
5. **Failed-breakdown reversal** (48T, −41.5k): most active, best win%/PF/
   expectancy-per-trade, but 41/48 exits were WEEK_END time-stops in a
   falling market — the edge (if any) needs holding periods >1 week to show.
   Highest cost drag (₹3,936).
6. **EMA-stack** (12T, −35.2k) / ablation (16T, −41.8k): worst expectancy.
   EMA levels via `trading.indicators.ema` (same helper the live
   `EMACrossSignalGenerator` wraps).
7. **ADX breakout** (9T, −26.7k): ADX semantics via
   `trading.adx_trend_signals.compute_adx` + canonical `indicators.adx`
   rising check. See ablation — gate destructive this week.
8. **RSI thrust** (9T, −18.4k): RSI-cross-60 + 20d break (`indicators.rsi`).
   Middle of pack; cheapest cost base of the active set.
9. **Baselines**: plain 20d break (−33.7k, PF 0.34 — best PF after
   failed-breakdown) and 52w proximity (−21.0k, only variant besides base_20d
   with a TARGET hit). No variant beat buy-and-hold-breadth; no variant beat
   both baselines on PF.

## Manual spot-checks (3/3 verified vs raw candles)

- **CUPID / base_20d TARGET**: signal 10-06 close 324.20 > prior-20d high
  316.00 ✓; entered 10-07 open 325.00 ×307 sh ✓; 10-08 high 357 ≥ target
  354.11 (low 344 > SL) → TARGET +₹8,936 gross, ₹84.92 costs ✓ (costs
  recomputed by hand: 2×₹20 brokerage + ₹27.18 STT + stamp/exch/GST ≈ ₹84.9).
- **BANKBARODA / failed-breakdown WEEK_END +₹1,110**: broke 231.92 (09-18
  low) with trough 223.82 (09-29), reclaimed 10-05 close 232.80 on 10.8M
  shares ✓; entered 10-06 open 233.02; never touched SL 223.82 or target
  251.42; exited 10-09 close 235.80, gross exactly 2.78×429=₹1,192.62 ✓.
- **BHEL / accum SL −₹3,049**: 10-06 close 452 > 20d high 439.90, OBV slope
  +0.13, vol 1.54× ✓; entered 10-07 open 451.50; 10-08 low 429.45 ≤ SL
  438.07 → stopped ✓.

## Caveats (frank) + follow-up

1. **One week is thin.** n=1..48 per variant; every comparison is noise-
   dominated. Nothing here is shippable.
2. **Regime bias.** A −1.33%-median week punishes LONG breakouts
   systematically; ranks partly measure "who traded least" (high52w_vol #1
   on n=1). Re-run on an up week before judging direction.
3. **Truncation bias.** Friday signals unfilled (30); WEEK_END exits (esp.
   failed-breakdown's 41) cut holding periods to ≤4 days — 2R targets never
   got room. Minimum follow-up: 4–6 weeks including an uptrend leg.
4. **Failed-breakdown deserves the follow-up**: only variant with win%>40%
   and PF≈0.5 under headwinds; test with 2–3 week max-hold instead of
   week-end force-exit.
5. **Gap-and-go needs threshold sensitivity** (3% → 1.5–2%) or a volatile
   week; as specified it did not fire once.
6. Suggested window: 2026-09-07..10-09 (5 weeks, same protocol, same
   universe) + opposite-regime week split (up vs down weeks) before any
   gate decision.
