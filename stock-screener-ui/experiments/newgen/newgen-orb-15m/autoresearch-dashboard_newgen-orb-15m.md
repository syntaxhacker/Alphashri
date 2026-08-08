# Autoresearch Dashboard: newgen-orb-15m

**Runs:** 111 | **Kept:** 69 | **Discarded:** 42 | **Crashed:** 0
**Baseline:** profit_factor: 1.1168 (#1)
**Best (trustworthy, >=10 trades):** profit_factor: 9.9137 (#92, +787.7%)
**Best (any, <10 trades, NOT reliable):** profit_factor: 24.2554 (#84, only 6 trades)

Best trustworthy config: OR=15, SL=1.25, TP=8.5, buffer=0.6, cooldown=1, shorts=off, EOD=13:00, min_or_range=0.8
=> PF=9.91, WR=50.0%, net=+Rs10218, 10 trades (2TP/0SL/8EOD)

| # | commit | profit_factor | status | description |
|---|--------|---------------|--------|-------------|
| 1 | b63ee0a | 1.117 (+0.0%) | keep | baseline OR=15 SL=1.0 TP=1.5 BUF=0.3 COOLDOWN=1 SHORTS=0 EOD=900 MINOR=0.3 |
| 2 | b63ee0a | 1.117 (+0.0%) | keep | OR sweep: OR=5 |
| 3 | b63ee0a | 1.117 (+0.0%) | discard | OR sweep: OR=10 (aliases to 1 candle on 15m) |
| 4 | b63ee0a | 0.302 (-72.9%) | keep | OR sweep: OR=60 (4 candles) |
| 5 | b63ee0a | 0.148 (-86.8%) | keep | OR sweep: OR=30 (2 candles) |
| 6 | b63ee0a | 0.270 (-75.8%) | discard | OR sweep: OR=45 (3 candles) |
| 7 | b63ee0a | 0.957 (-14.3%) | keep | SL sweep: SL=0.5 |
| 8 | b63ee0a | 1.029 (-7.9%) | keep | SL sweep: SL=0.75 |
| 9 | b63ee0a | 0.957 (-14.3%) | discard | SL sweep: SL=0.5 PF0.957<1.117 |
| 10 | b63ee0a | 1.029 (-7.9%) | discard | SL sweep: SL=0.75 PF1.029<1.117 |
| 11 | b63ee0a | 1.064 (-4.7%) | keep | SL sweep: SL=1.25 |
| 12 | b63ee0a | 1.097 (-1.8%) | keep | SL sweep: SL=1.5 |
| 13 | b63ee0a | 1.064 (-4.7%) | discard | SL sweep: SL=1.25 PF1.064<1.117 |
| 14 | b63ee0a | 1.097 (-1.8%) | discard | SL sweep: SL=1.5 PF1.096<1.117 |
| 15 | b63ee0a | 1.129 (+1.1%) | keep | TP sweep: TP=1.0 |
| 16 | b63ee0a | 1.038 (-7.1%) | keep | TP sweep: TP=2.0 |
| 17 | b63ee0a | 1.038 (-7.1%) | discard | TP sweep: TP=2.0 PF1.038<1.129 |
| 18 | b63ee0a | 1.378 (+23.4%) | keep | TP sweep: TP=3.0 |
| 19 | b63ee0a | 0.000 (-100.0%) | keep | TP sweep: TP=0 (no TP) |
| 20 | b63ee0a | 0.000 (-100.0%) | discard | TP sweep: TP=3.0 PF1.378>1.129 keep; TP=0 degenerate instant-exit |
| 21 | b63ee0a | 1.167 (+4.5%) | keep | TP sweep: TP=2.5 |
| 22 | b63ee0a | 1.563 (+40.0%) | keep | TP sweep: TP=4.0 |
| 23 | b63ee0a | 1.167 (+4.5%) | discard | TP sweep: TP=2.5 PF1.167<1.563 |
| 24 | b63ee0a | 1.573 (+40.9%) | keep | TP sweep: TP=3.5 |
| 25 | b63ee0a | 1.524 (+36.4%) | keep | TP sweep: TP=5.0 |
| 26 | b63ee0a | 1.926 (+72.4%) | keep | TP sweep: TP=6.0 |
| 27 | b63ee0a | 1.524 (+36.4%) | discard | TP sweep: TP=5.0 PF1.524<1.926 |
| 28 | b63ee0a | 2.012 (+80.2%) | keep | TP sweep: TP=7.0 |
| 29 | b63ee0a | 2.221 (+98.9%) | keep | TP sweep: TP=8.0 |
| 30 | b63ee0a | 1.398 (+25.2%) | keep | TP sweep: TP=10.0 |
| 31 | b63ee0a | 2.012 (+80.2%) | discard | TP sweep: TP=7.0 PF2.012<2.222 |
| 32 | b63ee0a | 2.300 (+105.9%) | keep | TP sweep: TP=8.5 |
| 33 | b63ee0a | 1.794 (+60.6%) | keep | TP sweep: TP=9.0 |
| 34 | b63ee0a | 1.398 (+25.2%) | discard | TP sweep: TP=10.0 PF1.398<2.222 |
| 35 | b63ee0a | 1.794 (+60.6%) | discard | TP sweep: TP=9.0 PF1.794<2.300 |
| 36 | b63ee0a | 1.201 (+7.6%) | keep | buffer sweep: BUF=0.0 |
| 37 | b63ee0a | 1.362 (+21.9%) | keep | buffer sweep: BUF=0.5 |
| 38 | b63ee0a | 1.039 (-7.0%) | keep | buffer sweep: BUF=1.0 |
| 39 | b63ee0a | 2.516 (+125.3%) | keep | buffer sweep@TP8.5: BUF=0.0 |
| 40 | b63ee0a | 3.022 (+170.5%) | keep | buffer sweep@TP8.5: BUF=0.5 |
| 41 | b63ee0a | 1.197 (+7.2%) | keep | buffer sweep@TP8.5: BUF=1.0 |
| 42 | b63ee0a | 2.516 (+125.3%) | discard | buffer@TP8.5: BUF=0.0 PF2.516<3.022 |
| 43 | b63ee0a | 2.568 (+130.0%) | keep | buffer@TP8.5: BUF=0.4 |
| 44 | b63ee0a | 3.132 (+180.4%) | keep | buffer@TP8.5: BUF=0.6 |
| 45 | b63ee0a | 2.062 (+84.7%) | keep | buffer@TP8.5: BUF=0.75 |
| 46 | b63ee0a | 2.568 (+130.0%) | discard | buffer@TP8.5: BUF=0.4 PF2.568<3.132 |
| 47 | b63ee0a | 2.758 (+147.0%) | keep | buffer@TP8.5: BUF=0.55 |
| 48 | b63ee0a | 3.106 (+178.1%) | keep | buffer@TP8.5: BUF=0.65 |
| 49 | b63ee0a | 2.062 (+84.7%) | discard | buffer@TP8.5: BUF=0.75 PF2.062<3.132 |
| 50 | b63ee0a | 2.758 (+147.0%) | discard | buffer@TP8.5: BUF=0.55 PF2.758<3.132 |
| 51 | b63ee0a | 3.132 (+180.4%) | keep | cooldown sweep: CD=0 |
| 52 | b63ee0a | 2.715 (+143.1%) | keep | cooldown sweep: CD=2 |
| 53 | b63ee0a | 2.152 (+92.7%) | keep | cooldown sweep: CD=3 |
| 54 | b63ee0a | 3.132 (+180.4%) | discard | cooldown sweep: CD=0 same as CD=1 |
| 55 | b63ee0a | 4.138 (+270.5%) | keep | EOD sweep: EOD=870 (14:30) |
| 56 | b63ee0a | 4.465 (+299.8%) | keep | EOD sweep: EOD=885 (14:45) |
| 57 | b63ee0a | 2.715 (+143.1%) | discard | cooldown sweep: CD=2 PF2.715<3.132 |
| 58 | b63ee0a | 4.138 (+270.5%) | discard | EOD sweep: EOD=870 PF4.138<4.465 |
| 59 | b63ee0a | 4.321 (+286.9%) | keep | EOD sweep: EOD=855 (14:15) |
| 60 | b63ee0a | 5.386 (+382.3%) | keep | EOD sweep: EOD=840 (14:00) |
| 61 | b63ee0a | 5.508 (+393.2%) | keep | EOD sweep: EOD=825 (13:45) |
| 62 | b63ee0a | 4.321 (+286.9%) | discard | EOD sweep: EOD=855 PF4.321<5.386 |
| 63 | b63ee0a | 5.701 (+410.5%) | keep | EOD sweep: EOD=810 (13:30) |
| 64 | b63ee0a | 5.097 (+356.4%) | keep | EOD sweep: EOD=795 (13:15) |
| 65 | b63ee0a | 5.945 (+432.3%) | keep | EOD sweep: EOD=780 (13:00) |
| 66 | b63ee0a | 5.701 (+410.5%) | discard | EOD sweep: EOD=810 PF5.701<5.945 |
| 67 | b63ee0a | 5.178 (+363.6%) | keep | EOD sweep: EOD=765 (12:45) |
| 68 | b63ee0a | 4.734 (+323.9%) | keep | EOD sweep: EOD=750 (12:30) |
| 69 | b63ee0a | 5.097 (+356.4%) | discard | EOD sweep: EOD=795 PF5.097<5.945 |
| 70 | b63ee0a | 5.178 (+363.6%) | discard | EOD sweep: EOD=765 PF5.178<5.945 |
| 71 | b63ee0a | 3.007 (+169.3%) | keep | TP sens @EOD780: TP=3.0 |
| 72 | b63ee0a | 5.263 (+371.2%) | keep | TP sens @EOD780: TP=99 (pure EOD exit) |
| 73 | b63ee0a | 4.734 (+323.9%) | discard | EOD sweep: EOD=750 PF4.734<5.945 |
| 74 | b63ee0a | 3.007 (+169.3%) | discard | TP sens@EOD780: TP=3.0 PF3.007<5.945 |
| 75 | b63ee0a | 5.945 (+432.3%) | keep | minOR sweep: 0.2 |
| 76 | b63ee0a | 5.945 (+432.3%) | keep | minOR sweep: 0.5 |
| 77 | b63ee0a | 8.967 (+702.9%) | keep | minOR sweep: 0.8 |
| 78 | b63ee0a | 5.945 (+432.3%) | discard | minOR sweep: 0.2/0.5 same as 0.3 |
| 79 | b63ee0a | 5.945 (+432.3%) | keep | minOR sweep: 0.6 |
| 80 | b63ee0a | 8.967 (+702.9%) | keep | minOR sweep: 0.7 |
| 81 | b63ee0a | 8.967 (+702.9%) | keep | minOR sweep: 1.0 |
| 82 | b63ee0a | 5.945 (+432.3%) | discard | minOR sweep: 0.6 same as 0.3 |
| 83 | b63ee0a | 8.967 (+702.9%) | keep | minOR sweep: 1.2 |
| 84 | b63ee0a | 24.255 (+2071.9%) | keep | minOR sweep: 1.5 |
| 85 | b63ee0a | 8.967 (+702.9%) | discard | minOR sweep: 1.0 dup of 0.7-0.8 |
| 86 | b63ee0a | 24.255 (+2071.9%) | discard | minOR=1.5 PF24.3 but only 6 trades UNRELIABLE |
| 87 | b63ee0a | 2.513 (+125.0%) | keep | shorts ON @best minOR0.8 |
| 88 | b63ee0a | 2.218 (+98.6%) | keep | shorts ON @minOR0.3 (more trades) |
| 89 | b63ee0a | 8.967 (+702.9%) | discard | minOR=1.2 dup of 0.8 |
| 90 | b63ee0a | 2.513 (+125.0%) | discard | shorts@0.8 PF2.51 worse, shorts hurt |
| 91 | b63ee0a | 4.311 (+286.0%) | keep | robust: SL=0.75 |
| 92 | b63ee0a | 9.914 (+787.7%) | keep | robust: SL=1.25 |
| 93 | b63ee0a | 2.218 (+98.6%) | discard | shorts@0.3 PF2.22 worse |
| 94 | b63ee0a | 4.311 (+286.0%) | discard | robust SL=0.75 PF4.31 worse |
| 95 | b63ee0a | 9.914 (+787.7%) | keep | robust: SL=1.5 |
| 96 | b63ee0a | 9.914 (+787.7%) | keep | robust: SL=2.0 |
| 97 | b63ee0a | 9.914 (+787.7%) | discard | robust SL=1.5 dup of 1.25 |
| 98 | b63ee0a | 5.939 (+431.7%) | keep | robust: BUF=0.5 SL=1.25 |
| 99 | b63ee0a | 9.257 (+728.9%) | keep | robust: BUF=0.7 SL=1.25 |
| 100 | b63ee0a | 9.914 (+787.7%) | discard | robust SL=2.0 dup of 1.25 |
| 101 | b63ee0a | 5.939 (+431.7%) | discard | robust BUF=0.5 PF5.94 worse |
| 102 | b63ee0a | 9.914 (+787.7%) | keep | robust: EOD=770 |
| 103 | b63ee0a | 8.468 (+658.2%) | keep | robust: EOD=790 |
| 104 | b63ee0a | 9.257 (+728.9%) | discard | robust BUF=0.7 PF9.26<9.91 |
| 105 | b63ee0a | 9.914 (+787.7%) | discard | robust EOD=770 same as 780 |
| 106 | b63ee0a | 9.483 (+749.1%) | keep | robust: TP=8.0 SL=1.25 |
| 107 | b63ee0a | 9.746 (+772.6%) | keep | robust: TP=9.0 SL=1.25 |
| 108 | b63ee0a | 8.468 (+658.2%) | discard | robust EOD=790 PF8.47<9.91 |
| 109 | b63ee0a | 9.483 (+749.1%) | discard | robust TP=8.0 PF9.48<9.91 |
| 110 | b63ee0a | 9.746 (+772.6%) | discard | robust TP=9.0 PF9.75<9.91 |
| 111 | b63ee0a | 0.000 (-100.0%) | keep | OR60 with best params (rescue attempt) |
