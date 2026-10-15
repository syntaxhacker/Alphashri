# Sensibull verified-P&L "Hall of Fame" — pattern analysis

**Source:** public, opt-in verified-P&L showcase (`web.sensibull.com/verified-pnl/hall-of-fame`,
Live P&L tab), pulled 2026-09-26. Underlying API: `oxide.sensibull.com/v1/compute/vbys/hall_of_fame/live_pnl`
+ `/verified_by_sensibull/live_positions/snapshot/<word_hash>`. Filtered to NIFTY legs (lot 65).

**Sample:** top 50 by live P&L → 42 held NIFTY legs.

## Headline pattern

| metric | value |
|---|---|
| short legs | **87** |
| long legs | **47** |
| short : long leg ratio | **1.85 : 1** |
| traders net *short* premium | **19** |
| traders net *long* premium | **10** |
| traders holding **both** long + short sides (spread/condor) | **17 / 42** |

**Profitable traders overwhelmingly SELL options, and ~40% hedge with wings.** Pure long-option
buying is rare and small.

## Structures observed

| structure | examples | notes |
|---|---|---|
| Short strangle / iron condor (0.5–3% OTM, front expiry) | Unnikrishnan (17 short/2 long, Sep-29), shivam verma, GRP, Hemant Chakole, Amit Raj Mishra | dominant; strikes 22,800–24,000 vs spot 23,140 |
| Credit spread / vertical (short + far wing) | Sachin Goyal (12 short/8 long, net −₹6.1M premium), Arati Patil, Hari Gupta | defined risk |
| Synthetic long (long CE + short PE, same strike) | **Compounding With Amol 2.0** (top earner, +₹16.85L) — ladder 23000–23700 across Sep/Oct, net Δ +13,000 | directional long via options, not OTM lottery |
| Naked short (call or put) | Shankar Mohan (short strangle to Mar-2027 on ₹1.33Cr), Venkata (short 27000 CE), Bharatvaadi (short 22500 PE) | smaller count, large capital |
| Pure long options | Prithvi (long PE), Nifty Sniper (long PE), কুলৰঞ্জন পাঠক (long PE), A SARASWATHI (long PE Dec-27) | minority; long-dated or hedge-like |

## Other patterns

- **Expiry:** heavily front (2026-09-29 monthly, Oct weeklies); a handful hold far shorts (Dec-29, Mar-2027).
- **Strikes:** clustered near ATM ±0.5–3% — they sell where premium and OI are.
- **ROI:** mostly single-digit (median ~2–3%; range 0.2–37%). This is **steady premium harvesting, not weekly home runs.**
- **Capital:** several run ₹1–3 Cr to earn ₹1–5L — i.e. modest return on large capital, consistent with selling.

## Caveats (important)

1. **One-day snapshot of *live positions*, not trade history.** It shows current exposure, not
   the strategy, entries, or what generated the P&L.
2. **Survivorship/selection bias.** It is an opt-in leaderboard of winners; losers are absent.
3. **Short premium = risk exposure, not proven edge.** Naked/undefined shorts can carry large tail risk.
4. Capital/ROI hidden for some profiles; cumulative P&L spans different start dates.
5. Underlyings other than NIFTY were filtered out; NIFTY lot 65 only.

## Cross-check against our own backtests

Independent confirmation of the research programme:
- **Selling has the positive gross edge** (VRP: ATM IV − realised RV = +4–5 vol pts; 82% of nights
  realised < implied) — matches the crowd being net short.
- **Buying rarely works** (raw direction accuracy 47–48%; long straddle ≈ −₹961/trade) — matches
  the near-absence of pure buyers at the top.
- **Directional buyers use synthetic-long (long call + short put) or spreads**, not naked OTM calls —
  i.e. they pay for direction with a structure that partially funds the premium.
