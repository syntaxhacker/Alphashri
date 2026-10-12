# Adversarial validation — entry-timing + short-side studies (10 weeks ending 2026-10-09)

Validator ran independently. Recompute harness: `experiments/validate_edge_check.py`
(own loader, own IST mapping, own exit sims; costs re-derived via `backtest/costs.py`).
Raw findings: `experiments/validate_edge_findings.json`.

## 1. Recompute results (all trades, best variants + full coverage)

| study / variant | trades checked | entry/open | triggers | exit/gross | costs | verdict on mechanics |
|---|---|---|---|---|---|---|
| B0 next-open | 179 | 179/179 | — | match | match (all) | CLEAN |
| V1 hold-confirm | 102 | 102/102 | — | match | match | CLEAN |
| V2 hold+volume | 72 | 72/72 | — | match | match | CLEAN |
| V3 limit@level | 105 | level-fill (see §2) | touch-rule ok | match | match | PRICE-FICTION (see §2) |
| V3c @close | 105 | 105/105 (=raw close) | — | match | match | CLEAN (and −₹85k) |
| V4 fade SHORT | 67 | 67/67 | 67/67 break+fail+SL re-derived | match | match | CLEAN |
| V5 legs | 281 | 281/281 | — | match | match (both legs) | CLEAN |
| S1 breakdown | 312 | 312/312 | — | match¹ | match | CLEAN¹ |
| S2 fade | 218 | 218/218 | — | match¹ | match | CLEAN¹ |
| S3 distribution | 61 | 61/61 | 61/61 recounted | match | match | CLEAN |
| L3 three-leg (prior) | 48 | 48/48 | — | match² | match | CLEAN² |

¹ 11× "SL-same-bar" vs "SL" = label-only, identical exit price. 1× MARICO S1:
sub-tick float-boundary (Friday low exactly = rounded target; full-precision
target unhit → Friday exit). Sibling's number stands; ₹781 swing, immaterial.
² 1× ₹1 rounding diff (TATACAP). Otherwise exact.
No same-bar-data entries. Costs present on every trade/leg. Zero duplicate-date
rows in any frame used. Box/level spot-check (10 random): 10/10 match raw setup bars.
Arithmetic: every pooled / first-5 / last-5 sum re-derived from trade lists — 0 mismatches.
Coverage: dataset 5010 rows = 501 symbols × 10 weeks; entry study skipped 0 for
cache/bars (175 extended + 480 no-break, both legitimate).

Validator's own early flags (104 ENTRY!=OPEN, 6 S3-TRIGGER-FAIL) were all
validator bugs (V3c enters at close; ret5 off-by-one) — withdrawn, scripts fixed.

## 2. V3 kill detail (independent numbers)

- Strict-def phantom rate: **46/105 fills (43.8%)** had raw day-low strictly above
  the level — a limit order at the level could never fill. Mean gift 0.48%,
  median 0.47% (~₹480/trade on ₹1L) vs claimed expectancy +₹1,374.
- Attribution of V3's +₹144,234: phantom fills +₹86,928 (46T) + "touched" +₹57,305 (59T).
  Even "touched" fills are unproven at daily resolution (no intraday fill evidence).
- Feasible-fill V3c on identical triggers: **−₹84,977, PF 0.38, win 25.7%**.
- REJECT as artefact. Confirmed.

## 3. Half-split (first-5 vs last-5 calendar weeks, no-slip net / exp / n)

| variant | W1–W5 | W6–W10 | both-half+ |
|---|---|---|---|
| B0 | −27k / −202 / 139 | −73k / −1,825 / 40 | neg/neg |
| V1 | −23k / −292 / 80 | −30k / −1,377 / 22 | neg/neg |
| V2 | −13k / −238 / 55 | −23k / −1,347 / 17 | neg/neg |
| V3 | artefact (§2) | artefact (§2) | — |
| V4 SHORT | −12.7k / −271 / 47 | +20.1k / +1,007 / 20 | **neg/pos — REJECT (one-half)** |
| V5 | −28k / −199 / 139 | −52k / −1,298 / 40 | neg/neg |
| S1 | −46.9k / −408 / 115 | −52.9k / −269 / 197 | neg/neg |
| S2 | −31.3k / −227 / 138 | +38.2k / +477 / 80 | **neg/pos — REJECT (one-half)** |
| S3 | −19.8k / −682 / 29 | +44.1k / +1,378 / 32 | **neg/pos — REJECT (one-half)** |
| L3 (prior) | +28.7k (3 active wks) | **0 trades (regime blocked 7/10 wks)** | **REJECT (no second half)** |

V4/S2/S3 profits all concentrate in the Sept drawdown weeks — short beta in a
falling market (8/10 outcome weeks Nifty-negative), not a tradeable edge. S2 dies
under slippage anyway (+₹6.9k → −₹14.6k). L3 additionally uses a symmetric ±5-session
catalyst window that peeks into the outcome week (admitted in its own meta) —
lookahead in the filter, plus a regime gate that silences it 70% of the time.

## 4. Fresh-data confirmation

Impossible today: latest IST session in any cached frame is 2026-10-09; today is
Sunday 2026-10-11. No sessions exist after the test window. Nothing qualified
for confirmation regardless (no survivor — see §5).

## 5. FINAL RANK (slip-adjusted ₹/trade; PF no-slip)

| rank | edge | exp/trade ₹ | PF | verdict | one-line reason |
|---|---|---|---|---|---|
| 1 | S3 distribution short | +300 (+399) | 1.40 | REJECT | one-half wonder (−682/+1,378), n=61, borrow unmodelled |
| 2 | V4 fade-the-flag SHORT | +12 (+111) | 1.14 | REJECT | slippage-away-from-zero; short beta, lost first half |
| 3 | S2 failed-breakout fade | −67 (+32) | 1.12 | REJECT | dies under slippage; negative first half |
| 4 | L3 screen+catalyst+regime | +499 (+598) | 1.74 | REJECT | 0 trades in 7/10 weeks; catalyst filter peeks (lookahead) |
| 5 | S1 breakdown short | −419 (−320) | 0.76 | REJECT | breakdowns don't follow through in either half |
| 6 | V1 hold-confirm | −624 (−526) | 0.62 | REJECT | discards trades, not losses |
| 7 | V2 hold+volume | −598 (−500) | 0.65 | REJECT | Day+1 volume adds nothing |
| 8 | B0 next-open (long) | −663 (−565) | 0.64 | REJECT | confirmed loser, neg 8/10 weeks; reproduces prior kill |
| 9 | V5 half+add | −521 (−445) | 0.60 | REJECT | sizing can't fix negative expectancy; double costs |
| 10 | V3 limit-retest | fictional +1,275 (feasible −908) | 4.16→0.38 | REJECT | 43.8% phantom fills; feasible-fill strongly negative |
| 11 | plain long-breakout (prior) | −943 | 0.35 | REJECT | dead (493T, −₹465k); B0 re-confirms on screened set |

**No SHIP. No PROMISING-NEEDS-FRESH-DATA** (nothing is positive in both halves).
Strongest negative result: the defect is the screen/level (buying extended tops),
not the entry day or direction — five timing variants, three short systems, and
gated combos all fail on the same signal set. Stop refining entries; fix or drop
the screen. S3's distribution screen is the only component that ever printed a
positive half (+₹44k, n=32) — if anything is revisited with fresh data + borrow
costs, it is S3, but today it is REJECT.
