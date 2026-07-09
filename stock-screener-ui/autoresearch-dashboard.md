# Autoresearch Dashboard: btst-param-optimization

**Runs:** 17 | **Kept:** 15 | **Discarded:** 2 | **Crashed:** 0
**Baseline:** profit_factor: 0.8188 ratio (#1)
**Best:** profit_factor: 4.1781 ratio (#16, +410.3%)

| # | commit | profit_factor | status | description |
|---|--------|---------------|--------|-------------|
| 1 | 8deac38 | 0.8188 | keep | baseline: SL=2% TP=3% entry>0.5% up_day mcap>=1000 price>=50 |
| 2 | 8deac38 | 0.9144 (+11.7%) | keep | wider TP=5% SL=2% entry>0.5% up_day |
| 3 | 8deac38 | 0.9858 (+20.4%) | keep | SL=1% TP=5% entry>0.5% up_day |
| 4 | 8deac38 | 1.0628 (+29.8%) | keep | SL=1% TP=10% entry>0.5% up_day |
| 5 | 8deac38 | 1.0783 (+31.7%) | keep | SL=1% no TP entry>0.5% up_day |
| 6 | 8deac38 | 1.1637 (+42.1%) | keep | SL=1% no TP any_day mode |
| 7 | 8deac38 | 1.4747 (+80.1%) | keep | SL=0.5% no TP any_day |
| 8 | 8deac38 | 1.8377 (+124.5%) | keep | SL=0.3% no TP any_day |
| 9 | 8deac38 | 2.1697 (+165.0%) | keep | SL=0.2% no TP any_day |
| 10 | 8deac38 | 2.7364 (+234.2%) | keep | SL=0.1% no TP any_day |
| 11 | 8deac38 | 1.0483 (+28.0%) | discard | no SL no TP any_day (worse than SL>0) |
| 12 | 8deac38 | 3.267 (+299.0%) | keep | SL=0.05% no TP any_day |
| 13 | 8deac38 | 3.8503 (+370.2%) | keep | SL=0.01% no TP any_day |
| 14 | 8deac38 | 4.0376 (+393.1%) | keep | SL=0.001% no TP any_day |
| 15 | 8deac38 | 4.1612 (+408.2%) | keep | SL=0.001% no TP any_day mcap>=5000 |
| 16 | 8deac38 | 4.1781 (+410.3%) | keep | SL=0.001% no TP any_day mcap>=10000 |
| 17 | 8deac38 | 4.101 (+400.9%) | discard | SL=0.001% no TP any_day price>=200 |
