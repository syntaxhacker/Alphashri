# Track E — Overnight defined-risk short-vol + gap tail hedge

**Hypothesis.** The overnight variance risk premium (realised gap < implied move) can be harvested by a
short strangle held EOD→next open; long far wings should make it account-safe without killing the edge.
**Method.** Real FYERS premiums, front listed monthly (exp 2026-09-29), 2026-07-01→09-25, entry 15:00 /
exit 09:30; NSE fees + 0.35% half-spread + 0.15% slippage per leg/side. Causal `shift(1)` filters: |log ret|
and prior IV/RV vs expanding medians. Synthetic BS anchor 2018-2026 (train 18-22 / test 23-26).

## Naked vs winged (real)
| config | n | net/trade ₹ | PF | win | worst night ₹ | maxDD %3L | 90% CI |
|---|---|---|---|---|---|---|---|
| naked ±1.0%, unfiltered | 50 | 106 | 1.28 | 60% | -3,346 | 3.35 | [-147,356] |
| best winged (n≥15, any filter) | 24 | -319 | 0.22 | 21% | -1,638 | 3.20 | [-502,-123] |

Every winged variant (d 0.5–1.25%, wing 50–250 pts, all 13 filters) is net-negative; the CI excludes 0 on the loss side.

## Filter plateau — naked strangle, net ₹/trade (n)
| short dist | all | calm | IV/RV high | calm & IV/RV high | volatile |
|---|---|---|---|---|---|
| ±0.5% | 69 (49) | 233 (36) | 194 (33) | 527 (22) | -386 (13) |
| ±0.75% | 48 (47) | 190 (36) | 173 (30) | 514 (21) | -418 (11) |
| ±1.0% | 106 (50) | 301 (35) | 141 (34) | 537 (22) | -348 (15) |
| ±1.25% | -4 (48) | 190 (37) | 86 (31) | 450 (22) | -657 (11) |

`calm & IV/RV-high` plateaus across distance (+527/+514/+537/+450) but n≈22 among 312 swept cells; day-of-week is noise-sized (Tue n≈10 negative, Fri positive).

## Best config — real naked ±1.0%, calm & prior IV/RV>median, 15:00→09:30 (raw dir P(up)=0.41 — uninformative; real metric P(inside strikes)=1.00)
| n / exp ₹ / PF / win | total / maxDD | worst night | 90% CI | RoR | cap ₹15k/wk | realised vs implied |
|---|---|---|---|---|---|---|
| 22 / 537 / 4.14 / 73% | ₹11,819 / -₹1761 (0.6%) | -₹1009 (0.34%) | [225,833] | 0.0 | ₹3.81M | 60 vs 111 pts (82%<) |

## Red-team: does the tail hedge make it robust?
- **No.** d=1.0%/w150 condor: short strangle ≈ +₹425/night; two long wings ≈ -₹672 (₹187 exec + ₹485 overnight mark-down; IV flat → theta/smile).
  The hedge costs 2–6× the edge; even with *free* execution it loses ≈₹485/night — more than the ~₹300-425 naked edge it protects (unfiltered edge only ~₹106).
- Unhedged tail is already small at 1 lot (worst night ₹-3.3k = 1.1% of ₹3L); wings insure a risk the account
  does not carry, and scaling lots on the freed margin only scales negative expectancy. n≤50, one monthly
  (130→4 DTE), one Jul–Sep 2026 regime; best cell from 312. Synthetic wings *help* (BS artifact, no transfer);
  Track B's skew trade (short rich put + long cheap call wing) is negative in every variant (best n=12).

## Verdict: **reject** — no n≥100 / CI-excludes-0 / defined-risk candidate; the wing hedge destroys the real edge.
