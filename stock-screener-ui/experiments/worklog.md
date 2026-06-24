# Autoresearch Worklog: ORB High Beta

**Start**: 2026-06-14
**Universe**: 23 high-volatility F&O stocks (5-min data, Dec 2025 - Apr 2026)
**Goal**: Maximize profit factor for ORB 45-min strategy on high beta stocks

## Summary
| Metric | Baseline | Best | Delta |
|--------|----------|------|-------|
| Profit Factor | 1.4051 | 1.9031 | +35.4% |
| Win Rate | 36.8% | 55.7% | +18.9pp |
| Total Trades | 800 | 291 | -64% |
| Net P&L | Rs +128,401 | Rs +125,432 | -2% |

## Best Config
```
OR_MIN=45, SL=1.2%, TP=2.0%, buffer=0.62%, cooldown=50 bars (250 min), shorts=OFF, EOD=15:00
→ PF=1.90, WR=55.7%, 291 trades, net_pnl=+Rs 125,432
```

## Key Insights
- **High beta stocks need wider buffer (0.62%) and longer cooldown (250 min)** vs general volatile stocks
- EOD exit at 15:00 (vs 14:45) is a massive lever
- SL=1.2% + TP=2.0% gives best R:R for high beta universe
- Buffer sweet spot is 0.62% — too tight hurts entries, too wide kills trades
- Cooldown plateaus at CD=40-55 (200-275 min), no benefit beyond CD=50
- Shorts double trades but destroy PF (1.26 vs 1.90)
- Max trades per day filter is redundant — cooldown already handles it
- EOD at 15:15 or 15:30 both worse than 15:00

## Experiment History
### Runs 1: Baseline (PF=1.4051)
- EOD=15:00, SL=1.0 TP=1.5 CD=3 buffer=0.3

### Runs 2-4: Cooldown sweep
- CD=6: 1.21 (discard), CD=15: 1.39 (discard), CD=30: 1.54 (keep)

### Runs 5-12: SL/TP grid with CD=30
- Best: SL=1.2 TP=2.0 → PF=1.66

### Runs 13-16: CD refine with SL=1.2 TP=2.0
- CD=40 (1.69), CD=50 (1.69) plateau

### Runs 17-18: EOD time sweep
- 15:15 (1.61 discard), 15:30 (1.13 discard)

### Runs 19-28: Buffer sweep
- 0.1% (1.74), 0.5% (1.77), 0.6% (1.88), 0.7% (1.46)

### Runs 29-39: Buffer fine-tune + SL re-check
- buf=0.62% peak at PF=1.9031
- SL=1.2 TP=2.0 confirmed best

### Runs 40-42: Final CD refinement with buf=0.62
- CD=45/50/55 all ~1.90 — plateau confirmed
