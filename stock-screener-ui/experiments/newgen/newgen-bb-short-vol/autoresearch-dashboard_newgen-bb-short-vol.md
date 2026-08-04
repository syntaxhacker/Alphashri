# Autoresearch Dashboard — newgen-bb-short-vol

Objective: maximize **profit_factor** for NEWGEN across 3 intraday strategies (bb / short / vol).
Primary metric: profit_factor (higher better). Reliability requires total_trades >= 10.

## Best kept config per strategy

- **bb**: run 13 PF=1.322 WR=58.1% net=2534.76 trades=31 — bb:bounce tf=15 p=20 std=2.5 SL=1.5 TP=2.0
- **short**: run 39 PF=2.2752 WR=57.9% net=3375.86 trades=19 — short:breakout_fail tf=5 SL=2.0 TP=4.5 [perturb of run22]
- **vol**: run 36 PF=1.1459 WR=45.0% net=4309.09 trades=111 — vol tf=5 mult=1.5 avg=10 SL=1.5 TP=2.0

## All runs (43)

| Run | Strategy | PF | WR% | Net PnL | Trades | TP | SL | EOD | Status | Description |
|-----|----------|-----|-----|---------|--------|----|----|-----|--------|-------------|
| 1 | bb | 0.7845 | 41.3% | -5362.73 | 109 | 19 | 34 | 56 | keep | bb:bounce tf=5 p=20 std=2.0 SL=1.0 TP=1.5 EOD=885 [baseline] |
| 2 | short | 0.4792 | 55.2% | -3324.85 | 29 | 11 | 5 | 13 | keep | short:s1_breakdown tf=5 SL=1.5 TP=2.0 buf=0.3 piv=classic EOD=915 [baseline] |
| 3 | vol | 0.762 | 39.3% | -7521.39 | 122 | 30 | 50 | 42 | keep | vol tf=5 mult=2.0 avg=20 SL=1.0 TP=1.5 EOD=885 [baseline] |
| 4 | bb | 0.8378 | 41.3% | -3837.35 | 109 | 17 | 34 | 58 | discard | bb:bounce tf=5 p=15 std=2.0 SL=1.0 TP=1.5 |
| 5 | bb | 0.9751 | 45.1% | -437.44 | 71 | 11 | 15 | 45 | keep | bb:bounce tf=5 p=20 std=2.5 SL=1.5 TP=2.0 |
| 6 | bb | 0.887 | 44.5% | -3114.17 | 119 | 25 | 38 | 56 | discard | bb:breakout tf=5 p=20 std=2.0 SL=1.0 TP=1.5 |
| 7 | bb | 0.9658 | 40.0% | -155.58 | 40 | 3 | 3 | 34 | keep | bb:squeeze tf=5 p=20 std=2.0 SL=1.0 TP=1.5 |
| 8 | bb | 1.1892 | 50.0% | 2147.29 | 54 | 10 | 10 | 34 | keep | bb:bounce tf=15 p=20 std=2.0 SL=1.5 TP=2.0 |
| 9 | bb | 1.0913 | 48.5% | 1518.65 | 66 | 5 | 14 | 47 | keep | bb:bounce tf=5 p=20 std=2.5 SL=1.5 TP=3.0 |
| 10 | bb | 1.0495 | 50.8% | 866.93 | 65 | 5 | 9 | 51 | keep | bb:bounce tf=5 p=20 std=2.5 SL=2.0 TP=3.0 |
| 11 | bb | 0.909 | 44.2% | -1903.92 | 77 | 13 | 14 | 50 | discard | bb:breakout tf=5 p=20 std=2.5 SL=1.5 TP=2.0 |
| 12 | bb | 1.2986 | 43.6% | 1302.45 | 39 | 3 | 2 | 34 | keep | bb:squeeze tf=5 p=20 std=2.5 SL=1.5 TP=2.0 |
| 13 | bb | 1.322 | 58.1% | 2534.76 | 31 | 8 | 8 | 15 | keep | bb:bounce tf=15 p=20 std=2.5 SL=1.5 TP=2.0 |
| 14 | bb | 0.8676 | 46.8% | -1515.26 | 47 | 6 | 11 | 30 | discard | bb:bounce tf=15 p=15 std=2.0 SL=1.5 TP=2.0 |
| 15 | bb | 0.4622 | 33.3% | -3646.24 | 18 | 2 | 6 | 10 | discard | bb:squeeze tf=15 p=20 std=2.0 SL=1.5 TP=2.0 |
| 16 | bb | 0.9658 | 40.0% | -155.58 | 40 | 3 | 3 | 34 | discard | bb:squeeze tf=5 p=20 std=2.5 SL=1.0 TP=1.5 |
| 17 | short | 1.8919 | 66.7% | 1490.92 | 6 | 3 | 2 | 1 | keep | short:rsi_overbought tf=5 SL=1.5 TP=2.0 |
| 18 | short | 1.1252 | 52.4% | 512.29 | 21 | 1 | 3 | 17 | keep | short:breakout_fail tf=5 SL=1.5 TP=2.0 buf=0.3 |
| 19 | short | 0.4218 | 25.0% | -2999.48 | 8 | 2 | 6 | 0 | discard | short:ema_extended tf=5 SL=1.5 TP=2.0 |
| 20 | short | 0.5421 | 53.3% | -3204.04 | 30 | 11 | 6 | 13 | discard | short:s1_breakdown tf=5 SL=1.5 TP=2.0 buf=0.1 |
| 21 | short | 0.6205 | 55.3% | -3591.84 | 38 | 12 | 9 | 17 | keep | short:s1_breakdown tf=5 SL=1.5 TP=2.0 buf=0.3 piv=fib |
| 22 | short | 1.9525 | 57.9% | 2521.48 | 19 | 1 | 1 | 17 | keep | short:breakout_fail tf=5 SL=2.0 TP=3.0 |
| 23 | short | 1.2651 | 52.4% | 1085.19 | 21 | 1 | 3 | 17 | keep | short:breakout_fail tf=5 SL=1.5 TP=3.0 |
| 24 | short | 1.4045 | 70.0% | 1290.12 | 20 | 2 | 3 | 15 | keep | short:breakout_fail tf=15 SL=1.5 TP=2.0 |
| 25 | short | 0.3942 | 55.2% | -4527.27 | 29 | 10 | 4 | 15 | discard | short:s1_breakdown tf=5 SL=2.0 TP=3.0 |
| 26 | vol | 0.8091 | 40.6% | -6856.27 | 138 | 36 | 56 | 46 | keep | vol tf=5 mult=1.5 avg=20 SL=1.0 TP=1.5 |
| 27 | vol | 0.6954 | 36.1% | -7628.57 | 72 | 8 | 21 | 43 | discard | vol tf=5 mult=3.0 avg=20 SL=1.5 TP=3.0 |
| 28 | vol | 0.7983 | 39.2% | -6144.13 | 120 | 30 | 45 | 45 | discard | vol tf=5 mult=2.0 avg=10 SL=1.0 TP=1.5 |
| 29 | vol | 0.6409 | 32.8% | -8248.8 | 58 | 14 | 23 | 21 | discard | vol tf=15 mult=2.0 avg=20 SL=1.5 TP=2.0 |
| 30 | vol | 0.7117 | 36.7% | -9057.4 | 90 | 11 | 28 | 51 | discard | vol tf=5 mult=2.0 avg=20 SL=1.5 TP=3.0 |
| 31 | vol | 0.8255 | 36.2% | -5567.72 | 116 | 24 | 50 | 42 | discard | vol tf=5 mult=2.0 avg=20 SL=1.0 TP=2.0 |
| 32 | vol | 0.7295 | 35.3% | -6242.52 | 85 | 15 | 35 | 35 | discard | vol tf=5 mult=3.0 avg=10 SL=1.0 TP=2.0 |
| 33 | vol | 0.8532 | 38.6% | -2673.07 | 70 | 20 | 28 | 22 | keep | vol tf=15 mult=2.0 avg=10 SL=1.0 TP=1.5 |
| 34 | vol | 1.0364 | 40.6% | 1202.91 | 133 | 30 | 48 | 55 | keep | vol tf=5 mult=1.5 avg=10 SL=1.0 TP=2.0 |
| 35 | vol | 0.8047 | 36.0% | -6174.48 | 114 | 11 | 47 | 56 | discard | vol tf=5 mult=1.5 avg=10 SL=1.0 TP=3.0 |
| 36 | vol | 1.1459 | 45.0% | 4309.09 | 111 | 30 | 23 | 58 | keep | vol tf=5 mult=1.5 avg=10 SL=1.5 TP=2.0 |
| 37 | vol | 0.6566 | 27.2% | -7693.57 | 81 | 13 | 33 | 35 | discard | vol tf=15 mult=1.5 avg=10 SL=1.0 TP=2.0 |
| 38 | bb | 1.1194 | 54.8% | 921.78 | 31 | 0 | 3 | 28 | keep | bb:bounce tf=15 p=20 std=2.5 SL=2.0 TP=3.0 [perturb of run13] |
| 39 | short | 2.2752 | 57.9% | 3375.86 | 19 | 1 | 1 | 17 | keep | short:breakout_fail tf=5 SL=2.0 TP=4.5 [perturb of run22] |
| 40 | short | 1.9525 | 57.9% | 2521.48 | 19 | 1 | 1 | 17 | keep | short:breakout_fail tf=5 SL=2.0 TP=3.0 buf=0.5 [perturb of run22] |
| 41 | vol | 0.9683 | 40.2% | -870.52 | 97 | 23 | 22 | 52 | keep | vol tf=5 mult=2.0 avg=10 SL=1.5 TP=2.0 [perturb of run36] |
| 42 | short | 1.2408 | 65.0% | 1098.44 | 20 | 1 | 3 | 16 | keep | short:breakout_fail tf=5 SL=2.0 TP=4.5 piv=fib [perturb of run39] |
| 43 | vol | 0.8725 | 41.0% | -4644.81 | 144 | 41 | 54 | 49 | discard | vol tf=5 mult=1.5 avg=10 SL=1.0 TP=1.5 [family check] |
