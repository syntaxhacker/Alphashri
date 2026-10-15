# NIFTY options mispricing — multi-agent findings (2 rounds, 5 tracks)

Question: where are options **cheap vs rich**, and can we systematically buy cheap / sell high?

## The one convergent result

**Options are systematically RICH (positive variance risk premium), but the edge can only be
harvested by HOLDING to expiry — never intraday.**

Independent evidence the VRP is real:
- Real 2026 IV surface: `ATM IV − trailing RV` = **+0.04…+0.05 vol pts** on every DTE (100% of days positive); ratio ≈1.45–1.85.
- Overnight: implied move **111–118 pts** vs realised gap **60–80 pts**; `P(realised < implied) = 82%`.
- So the seller has positive **gross** edge; the buyer almost never does.

Why intraday fails: one night of front-month theta ≈₹770/lot ≈ round-trip spread+fees ≈₹620.
Scalping the VRP pays the costs; only holding collects the decay.

## Track scoreboard

| # | track | verdict | best config (real unless noted) | n | exp/trade | PF | maxDD %3L |
|---|---|---|---|---|---|---|---|
| A | VRP timing | **reject** | sell straddle when IV/RV low (synthetic; real transfer −₹613) | 325 | +₹717 | 2.24 | 5.4% |
| B | skew / risk-reversal | **reject** | combined RR k3 | 22 | +₹442 | 1.52 | 3.2% |
| C | intraday/overnight IV dynamics | **reject** | short ±100 strangle after calm day, EOD→open | 36 | +₹233 | 1.78 | 0.8% |
| D | **hold-to-expiry theta harvest** | **defer** | ±2% OTM strangle, 300-pt wings, enter 5d pre-expiry, settle | 454 (194 test) | **+₹782 (+₹718 test)** | 1.44 | 17.5% (9.9% test) |
| E | overnight defined-risk short vol | **reject** | naked ±1% strangle after calm + IV/RV-high | 22 | +₹537 | 4.14 | 0.6% |

## Why D is only "defer" (the two show-stoppers)

1. **The synthetic edge *is* the model's IV input.** Re-pricing every strike at `IV = trailing RV`
   (removing the VRP) flips D to **−₹172/trade, PF 0.90**. `SyntheticOptionSource` prices at
   `0.65·INDIAVIX + 0.35·RV`; the 2018-22/2023-26 split is not independent of that assumption.
2. **Real premiums cannot be arbitrated.** Every cached real contract expires *after* the data
   window (data ends 2026-09-25; nearest expiry 2026-09-29), so **nothing settles at intrinsic** —
   all real exits are end-of-data marks, driven by one ~4% Sep selloff. Cleanest real sub-test
   (rolling non-overlapping 5-day marks, n=9) is +₹736 but CI [−72, +1571] spans zero.

## Secondary findings (durable)

- **High VRP is a *contra*-signal intraday** (depressed trailing RV mean-reverts up) but a
  *positive* signal when holding (D: high prior IV/RV + volatile prior day → OOS +₹2,019/n=22).
- **Buying vol is never +EV** on any tested rule (long straddle −₹961/trade, RoR 1.0).
- **Buying wings destroys the edge**: 0/260 winged overnight cells net-positive; wings cost
  ~₹672/lot/night (≈₹485 genuine mark-down) > the ~₹300–425 naked edge at 1 lot.
- **Skew reverts overnight, not intraday** (next-day Δrr25 −0.54 vp; by 10:00 only −0.36 vp).
- **Intraday IV is flat/slightly declining** in 2026 — no systematic overnight IV crush.

## Feasibility

At the D parameters, `capital_for_15k_week ≈ ₹5.6M`. At ₹3L the same programme averages ≈₹800/trade
× ~1 trade/week ≈ **₹800/week**, DD ~10–17%. ₹15k/week is ~19× capital.

## Verdict

Sell-high is the correct *direction* (options are rich). The only statistically passing
configuration (D) needs real **expiry-settled weekly chains** to be accepted or rejected — and
FYERS cannot serve expired contracts. **Action: forward-collect weekly chains + OI, then re-run
`tracks/theta_harvest.py` unchanged.** Until then: no validated strategy, and no capital.
