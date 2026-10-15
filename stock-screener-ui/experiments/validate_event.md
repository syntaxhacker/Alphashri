# Adversarial validation — event+technical combos (10 weeks ending 2026-10-09)

Validator ran independently. Harness: `experiments/validate_event_check.py`
(own glob scan, own leakage/half/survivorship checks; costs via `backtest/costs.py`).
Machine output: `experiments/validate_event.json`. DB never opened.

## 1. Sibling-file status: NOTHING TO RECOMPUTE

Searched `experiments/` for `eventtech*`, `event_tech*`, `event-tech*`
(top level + one subdir): **0 files found** at verify time (Sun 2026-10-11).

| check | result |
|---|---|
| sibling result files present | NO (0) |
| trades recomputed from raw 1D candles | n/a — no trade lists published |
| per-trade event_date ≤ entry_date audit | n/a — no event dates published |
| costs re-derived | n/a |
| first-5 vs last-5 split | n/a |

Per mission rule, event-variant verdicts are therefore **NEEDS-FRESH-DATA**
(one-line reason each: *no published trades to audit*). This is a scope
statement, not an endorsement — the kill criteria in §3 are pre-registered
and will apply unchanged when sibling files land. Re-run:
`python3 experiments/validate_event_check.py`, then extend §2.

## 2. Rank: event variants vs price-only systems

No event variant has published numbers, so no event row can be ranked.
Price-only baselines (verified recompute, slip-adjusted ₹/trade; PF no-slip;
sources: `validate_edge.md`, `three_leg_verify.md`, `short_side.md`,
`entry_timing.md`, `all_eq_rerun.md`):

| rank | edge | exp/trade ₹ (slip-adj) | PF | verdict | one-line reason |
|---|---|---|---|---|---|
| — | *event+technical best variant* | *unpublished* | *—* | NEEDS-FRESH-DATA | no eventtech* files; nothing to audit |
| 1 | S3 distribution short | +300 | 1.40 | REJECT | one-half wonder (−682/+1,378), n=61, borrow unmodelled |
| 2 | V4 fade-the-flag SHORT | +12 | 1.14 | REJECT | slippage-away-from-zero; short beta, lost first half |
| 3 | S2 failed-breakout fade | −67 | 1.12 | REJECT | dies under slippage; negative first half |
| 4 | L3 screen+catalyst+regime | +499 | 1.74 | REJECT | 0 trades in 7/10 weeks; catalyst filter peeks (lookahead) |
| 5 | S1 breakdown short | −419 | 0.76 | REJECT | breakdowns don't follow through in either half |
| 6 | V1 hold-confirm | −624 | 0.62 | REJECT | discards trades, not losses |
| 7 | V2 hold+volume | −598 | 0.65 | REJECT | Day+1 volume adds nothing |
| 8 | B0 next-open (long) | −663 | 0.64 | REJECT | confirmed loser, neg 8/10 weeks |
| 9 | V5 half+add | −521 | 0.60 | REJECT | sizing can't fix negative expectancy; double costs |
| 10 | V3 limit-retest | −908 (feasible) | 0.38 | REJECT | 43.8% phantom fills; feasible-fill strongly negative |
| 11 | plain long-breakout (prior) | −943 | 0.35 | REJECT | dead (493T, −₹465k); B0 re-confirms |
| 12 | all-equity L1 next-open | −806 | 0.59 | REJECT | 772T −₹559k; wider universe loses more |

Context the event study must beat, not join: week-42 breakouts were
news-sponsored 13/21, but the 5 *tradable* screened breakouts under the
entry protocol all lost (GLAND +10.3% MFE → −₹2.8k). Sponsorship ≠ edge
until a costed, leakage-free backtest says otherwise.

## 3. Pre-registered kill criteria (apply on sibling landing)

1. **Event-date leakage (the critical mode).** Every trade: `event_date ≤
   entry_date`, with *knowability* at entry time, not just calendar order.
   Specific traps: results announced mid-week used for a Monday entry;
   yfinance estimate dates that shift ex-post (flagged unless a filing
   timestamp proves knowability); QIP-board/EGM telegraphing counted as
   known only from the filing date (cf. TDPOWERSYS: board Aug 14, EGM
   Sep 10 — telegraphed weeks before the Oct 7 placement). >5% leaked
   trades kills the variant, not just the trades.
2. **Lookahead in windows.** Any symmetric ±N-session catalyst window that
   peeks into the outcome week = lookahead in the filter (the exact defect
   that killed L3). Windows must end ≤ setup session.
3. **Costs.** Every trade costed via `backtest/costs.py`; ₹1L/trade; missing
   costs = kill. Slippage run ±5bps/side (~₹100/trade hurdle).
4. **Halves.** First-5 vs last-5 weeks computed from trade lists. Reject on
   any red half unless n≥40 pooled AND exp > +₹300 after slippage AND a
   fundamental reason the halves differ (e.g. regime composition, not
   post-hoc storytelling).
5. **Survivorship.** Universe fixed ex-ante; delisted/dropped symbols must
   appear as trades or disclosed skips, not silent absences.

## 4. Fresh-data confirmation

Impossible today: latest IST session in any cached frame is 2026-10-09;
today is Sunday 2026-10-11. No sessions exist after the test window.

## 5. Verdicts

| subject | verdict | one-line reason |
|---|---|---|
| event+technical best variant | NEEDS-FRESH-DATA | no eventtech* sibling files published; nothing to audit |
| event+technical non-best variants | NEEDS-FRESH-DATA | same — no trade lists to recompute |
| all 12 price-only systems | REJECT | see rank table; every one fails halves and/or slippage and/or leakage |

**No SHIP.** Re-validation is one command away when siblings publish.
