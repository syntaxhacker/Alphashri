# Autoresearch Dashboard: ORB High Beta

**Runs:** 42 | **Kept:** 22 | **Discarded:** 20 | **Crashed:** 0
**Baseline:** profit_factor: 1.4051 (#1)
**Best:** profit_factor: 1.9031 (#36, +35.4%)

| # | commit | profit_factor | status | description |
|---|--------|---------------|--------|-------------|
| 1 | c147c0a | 1.4051 (+0.0%) | keep | baseline: EOD=15:00, SL=1.0 TP=1.5 CD=3 buffer=0.3 shorts=off |
| 2 | c147c0a | 1.2133 (-13.7%) | discard | CD=6: PF drops, overtrading hurts |
| 3 | c147c0a | 1.3879 (-1.2%) | discard | CD=15: slightly worse |
| 4 | c147c0a | 1.5387 (+9.5%) | keep | CD=30: first big improvement |
| 5 | 5960b06 | 1.4414 (+2.6%) | discard | CD=30 SL=0.8 TP=1.5 |
| 6 | 5960b06 | 1.4326 (+2.0%) | discard | CD=30 SL=0.8 TP=2.0 |
| 7 | 5960b06 | 1.2671 (-9.8%) | discard | CD=30 SL=0.8 TP=2.5: TP too far |
| 8 | 5960b06 | 1.6052 (+14.2%) | keep | CD=30 SL=1.0 TP=2.0: new best |
| 9 | 5960b06 | 1.4323 (+1.9%) | discard | CD=30 SL=1.0 TP=2.5 |
| 10 | 5960b06 | 1.6447 (+17.1%) | keep | CD=30 SL=1.2 TP=1.5: high WR |
| 11 | 5960b06 | 1.6624 (+18.3%) | keep | CD=30 SL=1.2 TP=2.0: best so far |
| 12 | 5960b06 | 1.4635 (+4.2%) | discard | CD=30 SL=1.2 TP=2.5 |
| 13 | fda380b | 1.6758 (+19.3%) | keep | CD=20 SL=1.2 TP=2.0 |
| 14 | fda380b | 1.6867 (+20.0%) | keep | CD=25 SL=1.2 TP=2.0 |
| 15 | fda380b | 1.6908 (+20.3%) | keep | CD=40 SL=1.2 TP=2.0 |
| 16 | fda380b | 1.6912 (+20.4%) | keep | CD=50 SL=1.2 TP=2.0: plateau |
| 17 | 8df11cd | 1.6102 (+14.6%) | discard | EOD=15:15: PF drops |
| 18 | 8df11cd | 1.1318 (-19.5%) | discard | EOD=15:30: no EOD exits left |
| 19 | 8df11cd | 1.7428 (+24.0%) | keep | Buffer=0.1%: big jump |
| 20 | 8df11cd | 1.6682 (+18.7%) | discard | Buffer=0.2% |
| 21 | 8df11cd | 1.7721 (+26.1%) | keep | Buffer=0.5%: BEST SO FAR |
| 22 | 8df11cd | 1.7004 (+21.0%) | keep | CD=35 SL=1.2 TP=2.0 |
| 23 | 8d9d8ff | 1.7762 (+26.4%) | keep | CD=35 buf=0.5 |
| 24 | 8d9d8ff | 1.4106 (+0.4%) | discard | buf=0.4: not enough |
| 25 | 8d9d8ff | 1.8782 (+33.7%) | keep | buf=0.6: BEST SO FAR |
| 26 | 8d9d8ff | 1.4630 (+4.1%) | discard | buf=0.7: too tight |
| 27 | 8d9d8ff | 1.7701 (+26.0%) | keep | CD=45 buf=0.5 |
| 28 | 8d9d8ff | 1.7772 (+26.5%) | keep | CD=30 buf=0.5 |
| 29 | 2e99a87 | 1.6187 (+15.2%) | discard | SL=1.0 TP=1.5 buf=0.6 |
| 30 | 2e99a87 | 1.7084 (+21.6%) | discard | SL=1.0 TP=2.0 buf=0.6 |
| 31 | 2e99a87 | 1.6667 (+18.6%) | discard | SL=1.5 TP=2.5 buf=0.6 |
| 32 | 2e99a87 | 1.8922 (+34.7%) | keep | max_trades=1 (same as unlimited) |
| 33 | 2e99a87 | 1.8922 (+34.7%) | keep | max_trades=2 (same as unlimited) |
| 34 | 2e99a87 | 1.2562 (-10.6%) | discard | shorts enabled: much worse |
| 35 | 2e99a87 | 1.8922 (+34.7%) | keep | buf=0.60 (confirmed) |
| 36 | 2e99a87 | 1.9031 (+35.4%) | keep | buf=0.62 (PEAK CONFIRMED) |
| 37 | 2e99a87 | 1.8734 (+33.3%) | discard | buf=0.64 |
| 38 | 2e99a87 | 1.8608 (+32.4%) | discard | buf=0.66 |
| 39 | 2e99a87 | 1.5058 (+7.2%) | discard | buf=0.68: sharp drop |
| 40 | 8fdecb1 | 1.9031 (+35.4%) | keep | CD=55 buf=0.62 (same) |
| 41 | 8fdecb1 | 1.9019 (+35.4%) | keep | CD=45 buf=0.62 (same) |
| 42 | 8fdecb1 | 1.7401 (+23.8%) | discard | SL=1.1 TP=1.8 buf=0.62 |
