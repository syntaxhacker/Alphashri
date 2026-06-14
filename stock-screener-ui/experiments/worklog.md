# Autoresearch Worklog: ORB High Beta

**Start**: 2026-06-14
**Universe**: 23 high-volatility F&O stocks (5-min data, Dec 2025 - Apr 2026)
**Goal**: Maximize profit factor for ORB 45-min strategy on high beta stocks

## Summary
| Metric | Baseline |
|--------|----------|
| Profit Factor | 1.4051 |
| Win Rate | 36.8% |
| Total Trades | 800 |
| Net P&L | Rs +128,401 |

## Key Insights
- EOD exit at 15:00 (vs 14:45) is a massive lever: PF 1.21 → 1.41
- High beta stocks produce more trades (800 vs 615 on volatile universe)

## Next Ideas
1. Cooldown sweep (CD=6, 15, 30) — biggest lever in previous research
2. SL/TP grid search around best CD
3. Test EOD=15:15 or 15:30 to capture more late-session moves
4. Max trades per day = 1 or 2 to filter weakest setups
5. Buffer sweep (0.1%, 0.2%, 0.5%)
