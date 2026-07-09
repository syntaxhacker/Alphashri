# Worklog: Optimize BTST (Buy Today Sell Tomorrow) Parameters

Started: 2026-07-09

## Key Insights
- **Tighter SL = better PF**: PF scales monotonically with SL tightness from 2% to 0.001% (PF 0.82 → 4.04)
- **No TP is optimal**: TP caps winners; removing it lets trades run to next-day close
- **any_day mode beats up_day**: Entering every day gives more trades and better PF (1.16 vs 1.08)
- **No SL kills PF**: 0% SL drops PF from 4.04 to 1.05 — SL is essential
- **Higher mcap helps marginally**: mcap>=10000Cr gives PF=4.18 vs 4.04 for mcap>=1000
- **100% stocks profitable**: At SL<=0.05%, ALL 79 stocks are profitable individually
- **Win rate is low (14-16%) but irrelevant**: Tight SL cuts losers fast, winners run to next-day close
- **Best config**: any_day, no TP, SL=0.001%, mcap>=10000Cr (PF=4.18) or mcap>=5000Cr (PF=4.16)
- **Costs matter**: Tight SL + delivery costs (STT 0.1%) means many small losses, but next-day avg gain covers it

## Next Ideas
- Try volume_surge entry mode with tight SL
- Try different date ranges (bull vs bear market sensitivity)
- Test on a subset of individual best stocks
- Try SL=0.001% with min_price and mcap combo

## Experiments

### Run 1: baseline — profit_factor=0.8188 (KEEP)
- Timestamp: 2026-07-09
- What changed: initial run with default params (SL=2%, TP=3%, entry>0.5%, up_day, mcap>=1000, price>=50)
- Result: PF=0.8188, 3689 trades, 79 stocks, WR=39.3%, Net=₹-712K, SL/TP/CLOSE=1632/1009/1048
- Insight: Baseline unprofitable. SL hits more often than TP at 2%/3%.
- Next: Try wider TP

### Run 2: wider TP=5% — profit_factor=0.9144 (KEEP)
- Timestamp: 2026-07-09
- What changed: TP=5%, SL=2%, up_day
- Result: PF=0.9144 (+11.7%), 3689 trades, WR=37.6%, Net=₹-339K, SL/TP/CLOSE=1632/469/1588
- Insight: Wider TP helps (more room for winners). SL unchanged.

### Run 3: tighter SL=1% TP=5% — profit_factor=0.9858 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=1%, TP=5%, up_day
- Result: PF=0.9858 (+20.4%), 3689 trades, WR=27.8%, Net=₹-41K, SL/TP/CLOSE=2443/382/864
- Insight: Tighter SL dramatically improves PF. Almost breakeven.

### Run 4: SL=1% TP=10% — profit_factor=1.0628 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=1%, TP=10%, up_day
- Result: PF=1.0628 (+29.8%), 3689 trades, WR=27.8%, Net=₹+182K, SL/TP/CLOSE=2443/79/1167
- Insight: Wider TP pushes PF above 1.0. Profitable!

### Run 5: SL=1% no TP — profit_factor=1.0783 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=1%, no TP, up_day
- Result: PF=1.0783 (+31.7%), 3689 trades, WR=27.8%, Net=₹+228K, SL/CLOSE=2443/1246
- Insight: No TP slightly beats TP=10%. Letting winners run is better.

### Run 6: any_day mode — profit_factor=1.1637 (KEEP)
- Timestamp: 2026-07-09
- What changed: any_day mode (no entry threshold), SL=1%, no TP
- Result: PF=1.1637 (+42.1%), 9465 trades, WR=29.4%, Net=₹+1.17M, SL/CLOSE=5967/3498
- Insight: any_day beats up_day! Buying after an up day means buying high, which hurts.

### Run 7: SL=0.5% — profit_factor=1.4747 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.5%, any_day, no TP
- Result: PF=1.4747 (+80.1%), 9465 trades, WR=22.1%, Net=₹+2.25M, SL/CLOSE=7009/2456
- Insight: Tighter SL = better. 83.5% of stocks profitable.

### Run 8: SL=0.3% — profit_factor=1.8377 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.3%, any_day, no TP
- Result: PF=1.8377 (+124.5%), 9465 trades, WR=18.9%, Net=₹+2.94M, SL/CLOSE=7381/2084
- Insight: 92.4% stocks profitable. The tight SL trend continues.

### Run 9: SL=0.2% — profit_factor=2.1697 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.2%, any_day, no TP
- Result: PF=2.1697 (+165%), 9465 trades, WR=17.4%, Net=₹+3.30M, SL/CLOSE=7528/1937
- Insight: 94.9% stocks profitable. PF rising linearly with tighter SL.

### Run 10: SL=0.1% — profit_factor=2.7364 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.1%, any_day, no TP
- Result: PF=2.7364 (+234%), 9465 trades, WR=15.8%, Net=₹+3.67M, SL/CLOSE=7689/1776
- Insight: 97.5% stocks profitable.

### Run 11: no SL — profit_factor=1.0483 (DISCARD)
- Timestamp: 2026-07-09
- What changed: SL=0%, any_day, no TP
- Result: PF=1.0483, 9465 trades, WR=44.2%, Net=₹+511K, all CLOSE exits
- Insight: SL is essential! Without SL, PF drops from 2.74 to 1.05.

### Run 12: SL=0.05% — profit_factor=3.267 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.05%, any_day, no TP
- Result: PF=3.267 (+299%), 9465 trades, WR=15.2%, Net=₹+3.95M, SL/CLOSE=7739/1726
- Insight: **100% of stocks profitable!** All 79 stocks have PF>=1.0.

### Run 13: SL=0.01% — profit_factor=3.8503 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.01%, any_day, no TP
- Result: PF=3.8503 (+370%), 9465 trades, WR=14.7%, Net=₹+4.11M, SL/CLOSE=7791/1674
- Insight: 100% stocks profitable. Diminishing returns starting.

### Run 14: SL=0.001% — profit_factor=4.0376 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.001%, any_day, no TP
- Result: PF=4.0376 (+393%), 9465 trades, WR=14.6%, Net=₹+4.17M, SL/CLOSE=7796/1669
- Insight: 100% stocks profitable. Near asymptote.

### Run 15: mcap>=5000Cr — profit_factor=4.1612 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.001%, any_day, no TP, mcap>=5000Cr
- Result: PF=4.1612 (+408%), 5072 trades, 42 stocks, WR=15.5%, Net=₹+2.30M
- Insight: Higher mcap gives better PF. 100% stocks profitable.

### Run 16: mcap>=10000Cr — profit_factor=4.1781 (KEEP)
- Timestamp: 2026-07-09
- What changed: SL=0.001%, any_day, no TP, mcap>=10000Cr
- Result: PF=4.1781 (+410%), 2802 trades, 23 stocks, WR=16.0%, Net=₹+1.27M
- Insight: **BEST PF so far**. Small improvement over mcap>=5000.

### Run 17: price>=200 — profit_factor=4.101 (DISCARD)
- Timestamp: 2026-07-09
- What changed: SL=0.001%, any_day, no TP, mcap>=1000, price>=200
- Result: PF=4.101, 8223 trades, 68 stocks, Net=₹+3.69M
- Insight: Price filter doesn't help at tight SL levels.
