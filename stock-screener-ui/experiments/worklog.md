# Autoresearch Worklog: EMA Cross Trending

**Start**: 2026-06-26
**Universe**: 34 liquid F&O stocks (5-min data, Jan 2026 - Jun 2026)
**Goal**: Maximize profit factor for EMA crossover strategy

## Summary
| Metric | Baseline | Best | Delta |
|--------|----------|------|-------|
| Profit Factor | TBD | TBD | TBD |
| Win Rate | TBD | TBD | TBD |
| Total Trades | TBD | TBD | TBD |
| Net P&L | TBD | TBD | TBD |

## Key Insights
- (to be filled as experiments run)

## Experiment History
### Run 43 (baseline): FAST=9 SLOW=21 SL=1.0 TP=1.5 CD=3 shorts=off EOD=14:45 — PF=1.0585 (KEEP)
- Timestamp: 2026-06-26
- What changed: Initial baseline run
- Result: PF=1.0585, WR=49.3%, 3057 trades, net=Rs+53,299
- Insight: 68% of trades exit via EOD (2083/3057) — TPs rarely hit at 1.5%. SL:TP ratio 2:1 suggests need wider TP or tighter SL.
- Next: Sweep SL/TP grid (0.5/1.0/1.5/2.0/3.0), try longer EMAs (20/50)
