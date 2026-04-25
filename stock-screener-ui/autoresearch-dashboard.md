# Autoresearch Dashboard: ORB Profit Factor

**Runs:** 11 | **Kept:** 5 | **Discarded:** 6 | **Crashed:** 0
**Baseline:** profit_factor: 0.91 (#1)
**Best:** profit_factor: 1.61 (#9, +76.9%)

| # | commit | PF | WR | Trades | Net PnL | status | description |
|---|--------|----|----|--------|---------|--------|-------------|
| 1 | 9a5354b | 0.91 | 33.7% | 1485 | -56K | keep | baseline: or_min=45 sl=0.4 tp=1.2 buf=0.3 cd=3 |
| 2 | 9a5354b | 1.00 | 37.4% | 1315 | +3K | discard | SL sweep: SL=1.0 |
| 3 | 9a5354b | 1.15 | 34.2% | 1132 | +74K | keep | cooldown=6 (30min): biggest single lever |
| 4 | 9a5354b | 1.27 | 37.9% | 931 | +116K | keep | CD=6 + SL=0.8 + TP=2.0 + BUF=0.3 |
| 5 | 9a5354b | 1.29 | 41.5% | 615 | +102K | keep | CD=15 (75min) + SL=1.0 + TP=1.5 |
| 6 | 9a5354b | 1.28 | 42.9% | 567 | +86K | discard | CD=30 (150min): diminishing returns |
| 7 | 9a5354b | 1.08 | 41.3% | 603 | +28K | discard | time filter min_entry=10:30 |
| 8 | 9a5354b | 1.14 | 42.8% | 537 | +44K | discard | max 1 trade/day |
| 9 | 9a5354b | **1.61** | **49.6%** | **615** | **+200K** | **keep** | **EOD=15:00 + CD=15 + SL=1.0 + TP=1.5** |
| 10 | 9a5354b | 1.10 | 56.2% | 1598 | +123K | discard | trailing stop: higher WR but lower PF |
| 11 | 9a5354b | 1.22 | 50.0% | 1467 | +178K | discard | partial TP: worse than simple exit |

## Best Config
```
OR_MIN=45, SL=1.0%, TP=1.5%, buffer=0.3%, cooldown=15 bars (75 min), shorts=OFF, EOD exit=15:00
→ PF=1.61, WR=49.6%, 615 trades/90 days, net_pnl=+199,519 INR
```

## Parameter Sensitivity (with EOD=15:00, CD=15, BUF=0.3)
- SL=0.6-1.5, TP=1.0-2.5 all profitable (PF 1.19-1.61)
- SL=1.0, TP=1.5 is the clear peak
- Cooldown 6-30 all work with EOD=15:00 (PF 1.12-1.61), CD=15 best
