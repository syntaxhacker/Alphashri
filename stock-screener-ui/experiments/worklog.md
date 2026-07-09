# Worklog: Optimize BTST (Buy Today Sell Tomorrow) Parameters

Started: 2026-07-09

## Key Insights
- Baseline PF=0.8188 — below 1.0, need better SL/TP/threshold combos
- 1632 SL exits vs 1009 TP exits — SL hits more often with 2%/3% setting

## Next Ideas
- Try wider TP (5%) to capture more runners
- Try tighter SL (1%) to limit losses
- Try no entry threshold (any_day) to increase trade count
- Try volume_surge entry mode for higher-quality signals

## Experiments

### Run 1: baseline — profit_factor=0.8188 (KEEP)
- Timestamp: 2026-07-09
- What changed: initial run with default params (SL=2%, TP=3%, entry>0.5%, up_day, mcap>=1000, price>=50)
- Result: PF=0.8188, 3689 trades, 79 stocks, WR=39.3%, Net=₹-712K, SL/TP/CLOSE=1632/1009/1048
- Insight: Baseline unprofitable. SL hits more often than TP at 2%/3%. Room for improvement.
- Next: Try wider TP, tighter SL, or different entry conditions
