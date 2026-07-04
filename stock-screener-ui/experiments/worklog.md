# Autoresearch Worklog: EMA Cross Trending

**Start**: 2026-06-26
**Universe**: 34 liquid F&O stocks (5-min data, Jan 2026 - Jun 2026)
**Goal**: Maximize profit factor for EMA crossover strategy

## Summary
| Metric | Baseline | Best | Delta |
|--------|----------|------|-------|
| Profit Factor | 1.0585 | 1.4561 | +37.6% |
| Win Rate | 49.3% | 48.0% | -1.3pp |
| Total Trades | 3057 | 2242 | -27% |
| Net P&L | Rs +53,299 | Rs +112,009 | +110% |

## Best Config
```
FAST=12, SLOW=26, SL=0.5%, TP=2.4%, CD=35 bars (175 min), shorts=OFF, EOD=14:53
→ PF=1.456, WR=48.0%, 2242 trades, net_pnl=+Rs 112,009
```

## Key Insights
- **SL=0.5% is the sweet spot** — tighter than EMA cross default (1.0%). Quick stop-outs prevent large drawdowns
- **TP=2.4%** better than 2.0% or 2.5% — captures enough winners while staying reachable
- **EMA 12/26** (vs 9/21) produces slightly fewer but higher-quality signals
- **CD=35 bars (175 min)** cuts trades by 27% but improves PF by 37.6%
- **EOD=14:53 is critical** — shifting from 14:45→14:53 gave +0.11 PF jump. 15:00 gives 1.402, 14:53 gives 1.456
- Shorts hurt PF (1.27 vs 1.46) — same pattern as ORB
- EMA cross has lower PF ceiling than ORB (1.46 vs 1.90) — trend following is inherently less precise than breakout

## Experiment History
### Run 43 (baseline): FAST=9 SLOW=21 SL=1.0 TP=1.5 CD=3 shorts=off EOD=14:45 — PF=1.0585 (KEEP)
### Run 44: FAST=9 SLOW=21 SL=0.5 TP=1.0 CD=3 — PF=1.1063 (KEEP)
- SL=0.5 gives tighter stops, more trades, higher PF
### Runs 45-53: SL/TP grid sweep
- Best: SL=0.5 TP=2.0 → PF=1.1731. TP=2.0% best ratio
- SL=0.8 and above all worse than SL=0.5
### Runs 54-63: EMA period sweep
- Best: FAST=12 SLOW=26 → PF=1.19. Longer EMAs filter noise
### Runs 64-66: SL/TP refine with FAST=12 SLOW=26
- SL=0.5 TP=2.0 confirmed best (re-tested with new EMAs)
### Runs 67-78: Cooldown sweep
- CD=35 → PF=1.343 (BEST). CD sweeps 5→15→20→30→35→40→50
- CD=35 optimal, CD=30 close (1.321), CD=40 drops (1.330)
### Runs 79-83: EOD time + shorts
- EOD=15:00 → PF=1.376. EOD=15:30 drops to 1.267
- Shorts: 1.270, worse than longs-only
### Runs 84-92: TP refinement with CD=35 EOD=15:00
- TP=2.4 → PF=1.402 (BEST). TP=2.2 (1.396), TP=2.5 (1.385)
### Runs 93-98: CD + EMA refine with TP=2.4 EOD=15:00
- CD=35 is peak, CD=34/36/38 close but lower
- FAST=12/26 confirmed best EMA pair
### Runs 99-115: EOD=14:53 breakthrough & final refine
- EOD=14:53 → PF=1.4561 (breakthrough!)
- EOD=14:50 (1.416), EOD=14:57 (1.402), EOD=15:05 (1.423)
- Final SL/CD/EMA refine all confirm best config
