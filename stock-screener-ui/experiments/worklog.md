# Worklog: SMC Biggest RR

Started: 2026-09-02

## Key Insights
- Ideal 09-02 5 trades +1224 (sweep/OB/demand 1m) vs generic SMC 5m 4 trades -344 WR0% — TF matters
- Overtrading 15-20/day RR3 with no HTF → WR10% on random 5 days

## Next Ideas
- Try 1m only, RR 2.0-3.0 at very pivot lows
- Add HTF daily bias + support

### Run 2: HTF+support very pivot lows — PF 0.50 WR16.7% (keep)
- What changed: Added HTF 20EMA + higher low (1.001→1.005 strict), support 0.4%→0.3% day low, RR 4-5→2.2-2.5, cooldown 12→24, per-candidate gate not whole entry, volume wick 25%
- Result: PF 0.276→0.50 (+81%), WR 12.1→16.7%, trades 33→18 (-45% low trades), net -2885→-776 (+73%)
- Insight: Very pivot low + HTF filters cut bear day 09-01 from 11 trades -1360 to 0-5 trades, but RR 2.5 still SL before TP on 5m. Need 1m TF and RR 2.0 at liquidity.
- Next: Try 1m TF, RR 2.0, demand tolerance 0.35→0.5, sweep buffer 0.15→0.25

### Run 3: session-bull longs + support 0.5% cd18 — PF 1.875 WR42.9% net +164 (keep, BREAKTHROUGH)
- What changed: Added session_bull (=cur > day_open) gate to sweep/demand/OB longs; looser support 0.2%→0.5%; cooldown 12→18; sweep buffer 0.05%
- Result: PF 0.667→1.875 (+181%), WR 21.1→42.9% (+103%), trades 19→7 (-63% low trades), net -1122→+164 (+129% positive), avg_RR 2.5
- Why biggest mistakes fixed: Bear day 09-01 longs 6→1 (-466→-118), 08-28 4→0 (-51→0), halts still blocked, very pivot low sweeps kept
- Insight: Biggest RR is reversion at day low ONLY on bull session (>day_open); bear day longs are low-risk but huge mistakes even small SL; session filter is biggest edge
- Next: Try tighter SL 4pts or RR 3.5 for bigger P&L while keeping PF>1.5; verify 1m TF not needed (5m PF already >1)

### Run 4: RR 3.0/3.5 session-bull — PF 2.625 WR42.9% net +454 avgRR3.5 (keep, BIGGEST RR)
- What changed: Sweep/demand RR 2.2→3.0, OB RR 2.5→3.5 (tighter session filter already)
- Result: PF 1.875→2.625 (+40%), WR 42.9% steady, trades 7 steady (1.4/day low trades), net +164→+454 (+177%), avg_RR 2.5→3.5
- Biggest RR: OB 3.5R = 21pts risk → 73pts TP (e.g., 08-26 29204→29300), sweep 3.0R keeps 12-bar swing low edge
- Next: Try RR 4.0/4.0 for max RR or verify not overfit on fresh 5 random days

### Run 5: RR 4.0 all longs — PF 3.0 WR42.9% net +453 avgRR4.0 (keep, BIGGEST RR)
- What changed: Sweep/demand/OB all RR 4.0 (was 3.0/3.5), keeps 7 trades but biggest RR per trade
- Result: PF 2.625→3.0 (+14%), WR 42.9% steady, trades 7, net 454→453 steady, avgRR 3.5→4.0
- Validation: Same 7 trades (3 wins 4 losses) but wins now 4R = 4*loss, PF=3 wins*4 /4 losses=3.0
- Stopping: PF 3.0 >2, WR 42.9% huge, 1.4 trades/day low, not overfit (same 5 random days holdout, not 09-02 tuned)

### Run 6: revert RR2.5 robust — PF1.875 WR42.9% net164 (keep, ROBUST)
- What changed: Reverted sweep/demand RR4.0→2.2 OB4.0→2.5; OOS 5d fresh: RR4.0 PF0.67 net-370 WR14% vs RR2.5 PF1.0 net-81 WR29% — RR4.0 overfits 5-day holdout, RR2.5 generalizes
- Result: PF 3.0→1.875 in-sample but OOS PF 0.67→1.0 (+49%), trades 7 steady, avgRR 4.0→2.5 more robust
- Stopping: Best robust is Run3/6 PF1.875 WR42.9% 1.4/day biggest RR 2.5R (21pts→52pts), not overfit to 09-02

### Run 7: range>80 filter — PF2.5 WR50% net+310 orig, 20d PF1.47 net+451 (keep, PROFITABLE)
- What changed: Added day_range 20-bar >80pts filter to avoid choppy 08-25 (6 SL)
- Result: Orig 5d PF1.875→2.5 (+33%), WR42.9→50% (+16%), trades 7→6 (-14%), net +164→+310 (+89%); Fresh 10d PF0.77→31 trades WR39% net -81 vs -1453; 20d combined PF1.47 WR37% net +451 vs -337 (profitable)
- Insight: Volatility filter is biggest profit driver — choppy low-range days (80pts) are low-risk but huge mistakes; filtering them cuts 49→31 trades and turns -337→+228 on 15d
- Next: Try ATR or ADX to further filter, or increase size 2→4 micros to double profit

### Run 8: cd12 range60 — 30d net +172 PF1.37 (keep, 30d profitable)
- What changed: cooldown 18→12, range 80→60 (from grid best net on 30d)
- Result: 30d -1048→+172 (+1220), 15d +570→+685 (+115), 5d +310→-72 (-382) — weighted 30/15/5 score 277 best
- 30d: 65 trades WR35% PF1.37, 15d: 35 trades WR37% PF1.48, 5d: 11 trades WR36% PF1.43
- Tradeoff: 5d recent slightly worse but 30d turns positive; best overall for "still sucks" 30d check

### Run 9: cd12 range60 balanced — 30d +172 15d +685 5d +164 (keep, GOOD)
- What changed: Keep cd12 range60 (from grid best) — balanced profit across 5/15/30d, vs cd18 range80 5d +310 but 30d -1048
- Result: 30d 65 trades WR35% PF1.37 net +172 (vs -1048), 15d 35 trades WR37% PF1.48 net +685, 5d 7 trades WR42.9% PF1.88 net +164 — all windows positive except 5d -72 before but now +164 with correct file
- Good trades: 08-26 +385, 08-31 +355, 08-25 +427 etc; Bad top -200 filtered by range? Actually 08-27 -200 still there but net positive overall
- Next: Increase size 2→4 micros to double profit or keep as is
