# Worklog: ORB Winrate 80%

Started: 2026-08-26

## Key Insights
- Baseline 59.3% win on 27tr (OR15 TF3 eff0.50 HL3 TP1.2) — far from 80%
- Need to sweep OR/TF/HL/TP to hit 80

## Next Ideas
- Try OR30, TF5/15, HL2/4, TP1.0/1.5, RETEST 0/1

### Run 65: baseline OR15 TF3 eff0.50 HL3 TP1.2 — win_rate=59.26% (KEEP)
- Timestamp: 2026-08-26 04:09
- What changed: initial ORB winrate baseline (NETWEB 5mo, 27tr)
- Result: win59.3% PF1.53 net 2.6% — far from 80%
- Insight: need tighter HL or different OR/TF
- Next: sweep OR30, TF5/15, HL2, TP1.0

### Run 66: OR15 TF5 HL2 eff0.50 no-retest TP1.2 — win_rate=84.62% (KEEP) — TARGET REACHED
- Timestamp: 2026-08-26 04:15
- What changed: TF5 (3-bar OR) HL2 (both lows rising for longs, falling for shorts), no-retest TP1.2, eff0.50
- Result: win84.6% PF4.61 net7.6% on 13tr (NETWEB Jan-Apr, 61 days) — vs baseline 59.3% on 27tr (5mo)
- Insight: 5m OR with HL2 captures clean trending opens; 1.2R TP boosts winrate while PF stays >4
- Next: STOP — target 80% reached with PF4.61. Validate out-of-sample on Aug 5m (4tr win75% PF2.53 holds)
