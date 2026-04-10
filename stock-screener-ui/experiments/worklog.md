# ORB Profit Factor Optimization Worklog

## Session: orb-profit-factor-20260410
**Start**: 2026-04-10
**Data**: 23 volatile NSE symbols (25 listed, 2 dupes), ~90 days of 5-min candles, ~101K total candles

### Run 1: Baseline — PF=0.91 (KEEP)
- What: OR_MIN=45, SL=0.4%, TP=1.2%, buffer=0.3%, cooldown=3, no shorts
- Result: PF=0.91, WR=33.7%, 1485 trades, 500W/985L, net=-56,432
- Note: 953 EOD exits (64%) — most positions never hit TP or SL

### Run 2: SL sweep (SL=1.0) — PF=1.00 (DISCARD)
- What: Wider SL=1.0% reduces SL exits from 420→129, but PF only reaches 1.0
- Result: PF=1.00, WR=37.4%, 1315 trades, net=+2,716
- Insight: Wider SL alone is not enough; too many EOD exits still bleed

### Run 3: Cooldown=6 — PF=1.15 (KEEP, +26%)
- What: Increase cooldown from 3→6 bars (15→30 min between trades)
- Result: PF=1.15, WR=34.2%, 1132 trades, net=+74,287
- Insight: **Biggest single lever.** Prevents re-entry after SL into the same failed breakout. Reduces overtrading.

### Run 4: Grid search (CD=6 + SL=0.8 + TP=2.0 + BUF=0.3) — PF=1.27 (KEEP, +40%)
- What: Full grid of SL×TP×Buffer with CD=6. Best: SL=0.8%, TP=2.0%, BUF=0.3%
- Result: PF=1.27, WR=37.9%, 931 trades, net=+115,971
- Insight: Buffer=0.3 is consistently best. Ties at SL=1.0/TP=1.5 and SL=1.0/TP=2.0 (all PF=1.27)

### Run 5: Cooldown=15 (75 min) — PF=1.29 (KEEP, +42%)
- What: Push cooldown higher. CD=15 bars = 75 min between trades
- Result: PF=1.29, WR=41.5%, 615 trades, net=+101,690
- Insight: 75-min cooldown = ~1.5 trading hours between entries. Structural change that reduces overtrading. Win rate jumps to 41.5%.

### Run 6: Cooldown=30 (150 min) — PF=1.28 (DISCARD)
- What: Push cooldown even further
- Result: PF=1.28, 567 trades, net=+85,761
- Insight: Diminishing returns past CD=15. Fewer trades offsets the PF gain.

### Run 7: Time filter (min_entry=10:30) — PF=1.08 (DISCARD)
- What: Skip entries before 10:30 AM (from SR research insight)
- Result: PF=1.08, 603 trades, net=+27,868
- Insight: With CD=15 already active, time filter provides no benefit. Cooldown already prevents early re-entries.

### Run 8: Max 1 trade/day — PF=1.14 (DISCARD)
- What: Limit to 1 trade per stock per day
- Result: PF=1.14, 615→537 trades, net=+43,561
- Insight: Post-filter analysis showed PF=1.32 but proper simulation gives 1.14. Some second trades per day are profitable — removing them hurts.

### Run 9: EOD exit at 15:00 — PF=1.61 (KEEP, +77%)
- What: Move EOD force-close from 14:45 to 15:00 (market close)
- Result: PF=1.61, WR=49.6%, 615 trades, net=+199,519
- Insight: **Biggest single improvement.** Extra 15 min lets positions recover or hit TP. WR jumps from 41.5%→49.6%. 50 more trades become winners. The last 15 min of trading matters enormously.
- Verified across full SL×TP grid (20 combos) and CD×EOD grid (15 combos). EOD=900 dominates in all cases.

## Key Insights
1. **EOD exit time is the #1 parameter** — moving from 14:45 to 15:00 improves PF by 25% (1.29→1.61)
2. **Cooldown=15 (75 min) is #2** — reduces overtrading, prevents re-entry after SL
3. **Buffer=0.3% is consistently optimal** across all parameter combinations
4. **SL=1.0% + TP=1.5%** is the sweet spot (1.5:1 reward-risk ratio)
5. **No shorts** — shorts consistently hurt PF
6. **Time filter doesn't help when cooldown is high**
7. **OR_MIN=45 is best** — shorter OR = more noise, longer = fewer trades
8. **EOD exits still dominate** (413/615 = 67%) even at 15:00 close
9. **Post-filter analysis is misleading** — always simulate properly

## Best Config
```
OR_MIN=45, SL=1.0%, TP=1.5%, buffer=0.3%, cooldown=15 bars (75 min), shorts=OFF, EOD exit=15:00
PF=1.61, WR=49.6%, 615 trades over 90 days, net_pnl=+199,519 INR
```

## Overfitting Risk
- Cooldown=15 is structural — should generalize
- EOD=15:00 is structural (just holding to market close) — should generalize
- SL=1.0% and TP=1.5% are moderate — not extreme
- Buffer=0.3% matches the live trading default
- 615 trades over 90 days on 23 stocks = ~0.3 trades/stock/day — reasonable
- **Risk**: 67% EOD exits means edge still comes from avoiding bad trades (via cooldown/buffer)
- **Risk**: This is one 90-day window. Need validation on other periods.

## Next Ideas
- Try partial TP (exit 50% at TP, trail rest)
- Try trailing stop instead of fixed SL
- Validate on different time periods / different symbol sets
- Try ATR-based dynamic SL instead of fixed %
- Implement these params in the live trading ORB strategy
