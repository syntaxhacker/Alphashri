### Run 1: baseline OR=15 SL=1.0 TP=1.5 BUFFER=0.3 COOLDOWN=1 SHORTS=0 EOD=900 MINOR=0.3 — pf=1.1168 (keep)
- Timestamp: 2026-08-05 03:27
- What changed: baseline config
- Result: PF=1.1168 WR=43.2% net_pnl=1337.23 trades=44 tp=17 sl=18 eod=9

# Worklog: newgen-orb-15m

Autoresearch session for the best ORB (Opening Range Breakout) parameter set on NEWGEN
15-min candles. Primary metric: profit_factor (higher better). Data: 65 trading days
(2026-05-04..2026-08-04) of Upstox 15-min candles from `experiments/data/newgen_cache.pkl`.

Baseline config: OR=15m, SL=1.0%, TP=1.5%, buffer=0.3%, cooldown=1 bar, shorts=off,
EOD=15:00, min_or_range=0.3%, max_or_range=5.0%.

## Key Insights
- **OR duration is decisive.** On 15-min candles, only a single-candle OR (OR≤15m, the 9:15–9:30 range) is viable. OR=30 (2 candles) PF=0.15, OR=45 PF=0.27, OR=60 PF=0.30 — all hopeless. OR≤15 all alias to the same 1-candle OR (identical results).
- **Wide TP wins.** PF rises monotonically with TP up to TP=8.5 (PF 1.12@1.5 → 2.22@8 → 2.30@8.5). With TP this wide it almost never triggers (2 hits / 10 trades) — the strategy is effectively "let the winner run to the fixed exit". TP>8.5 (10+) degrades.
- **Earlier EOD exit is a huge lever.** EOD 15:00→13:00 lifted PF from 2.30 to 5.95 (net +₹9.5k). NEWGEN gives back gains in the afternoon; a 12:45–13:00 exit locks in the morning move. Peak at EOD=780 (13:00), stable across 770–780.
- **Strong-range filter concentrates the edge.** min_or_range≥0.7 removes the 2 losing days in (0.6,0.7) → PF 5.95→8.97 on the same 10 trades. Thresholds 0.7–1.2 all identical (clustered OR ranges). min_or_range=1.5 gives PF=24 but only 6 trades — UNRELIABLE.
- **Wide SL is free insurance here.** With minOR≥0.8 + EOD 13:00, SL≥1.25 never triggers (0 SL exits of 10). SL=1.25..2.0 identical (PF=9.91). SL<1.0 badly hurts (PF 0.96–1.03 on more trades).
- **Shorts hurt.** Enabling shorts at the best config adds ~16 extra trades but drags PF to 2.2–2.5. Short-side ORB is not an edge on NEWGEN.
- **Cooldown irrelevant at high buffer** (CD 0/1 identical); buffer peaks at 0.6% (PF 9.91 vs 5.94@0.5, 9.26@0.7).
- **Trustworthiness:** best PF=9.91 rests on only 10 trades; treat as directionally strong but sample-limited. minOR=1.5's PF=24 is overfit (6 trades).

## Next Ideas
- Validate best config on a different timeframe/stock (out of session scope).
- Consider trailing-stop exit instead of fixed wide TP + EOD (let winners run but lock gains).
- Fractionalized EOD exit (sell half at 13:00) to reduce single-trade variance.

### Run 2: OR sweep: OR=5 — pf=1.1168 (keep)
- Timestamp: 2026-08-05 03:27
- What changed: OR sweep: OR=5
- Result: PF=1.1168 WR=43.2% net_pnl=1337.23 trades=44 tp=17 sl=18 eod=9

### Run 3: OR sweep: OR=10 (aliases to 1 candle on 15m) — pf=1.1168 (discard)
- Timestamp: 2026-08-05 03:27
- What changed: OR sweep: OR=10 (aliases to 1 candle on 15m)
- Result: PF=1.1168 WR=43.2% net_pnl=1337.23 trades=44 tp=17 sl=18 eod=9

### Run 4: OR sweep: OR=60 (4 candles) — pf=0.3023 (keep)
- Timestamp: 2026-08-05 03:27
- What changed: OR sweep: OR=60 (4 candles)
- Result: PF=0.3023 WR=15.4% net_pnl=-3386.43 trades=13 tp=2 sl=8 eod=3

### Run 5: OR sweep: OR=30 (2 candles) — pf=0.1476 (keep)
- Timestamp: 2026-08-05 03:27
- What changed: OR sweep: OR=30 (2 candles)
- Result: PF=0.1476 WR=9.1% net_pnl=-8447.61 trades=22 tp=2 sl=16 eod=4

### Run 6: OR sweep: OR=45 (3 candles) — pf=0.2703 (discard)
- Timestamp: 2026-08-05 03:27
- What changed: OR sweep: OR=45 (3 candles)
- Result: PF=0.2703 WR=14.3% net_pnl=-3962.07 trades=14 tp=2 sl=9 eod=3

### Run 7: SL sweep: SL=0.5 — pf=0.9569 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: SL sweep: SL=0.5
- Result: PF=0.9569 WR=26.8% net_pnl=-502.84 trades=56 tp=15 sl=36 eod=5

### Run 8: SL sweep: SL=0.75 — pf=1.029 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: SL sweep: SL=0.75
- Result: PF=1.029 WR=35.4% net_pnl=355.11 trades=48 tp=17 sl=25 eod=6

### Run 9: SL sweep: SL=0.5 PF0.957<1.117 — pf=0.9569 (discard)
- Timestamp: 2026-08-05 03:28
- What changed: SL sweep: SL=0.5 PF0.957<1.117
- Result: PF=0.9569 WR=26.8% net_pnl=-502.84 trades=56 tp=15 sl=36 eod=5

### Run 10: SL sweep: SL=0.75 PF1.029<1.117 — pf=1.029 (discard)
- Timestamp: 2026-08-05 03:28
- What changed: SL sweep: SL=0.75 PF1.029<1.117
- Result: PF=1.029 WR=35.4% net_pnl=355.11 trades=48 tp=17 sl=25 eod=6

### Run 11: SL sweep: SL=1.25 — pf=1.0638 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: SL sweep: SL=1.25
- Result: PF=1.0638 WR=46.2% net_pnl=724.27 trades=39 tp=16 sl=14 eod=9

### Run 12: SL sweep: SL=1.5 — pf=1.0965 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: SL sweep: SL=1.5
- Result: PF=1.0965 WR=48.6% net_pnl=994.65 trades=35 tp=15 sl=10 eod=10

### Run 13: SL sweep: SL=1.25 PF1.064<1.117 — pf=1.0638 (discard)
- Timestamp: 2026-08-05 03:28
- What changed: SL sweep: SL=1.25 PF1.064<1.117
- Result: PF=1.0638 WR=46.2% net_pnl=724.27 trades=39 tp=16 sl=14 eod=9

### Run 14: SL sweep: SL=1.5 PF1.096<1.117 — pf=1.0965 (discard)
- Timestamp: 2026-08-05 03:28
- What changed: SL sweep: SL=1.5 PF1.096<1.117
- Result: PF=1.0965 WR=48.6% net_pnl=994.65 trades=35 tp=15 sl=10 eod=10

### Run 15: TP sweep: TP=1.0 — pf=1.1287 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=1.0
- Result: PF=1.1287 WR=53.1% net_pnl=1356.04 trades=49 tp=25 sl=16 eod=8

### Run 16: TP sweep: TP=2.0 — pf=1.038 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=2.0
- Result: PF=1.038 WR=35.0% net_pnl=448.51 trades=40 tp=12 sl=19 eod=9

### Run 17: TP sweep: TP=2.0 PF1.038<1.129 — pf=1.038 (discard)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=2.0 PF1.038<1.129
- Result: PF=1.038 WR=35.0% net_pnl=448.51 trades=40 tp=12 sl=19 eod=9

### Run 18: TP sweep: TP=3.0 — pf=1.3777 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=3.0
- Result: PF=1.3777 WR=34.4% net_pnl=3503.52 trades=32 tp=7 sl=15 eod=10

### Run 19: TP sweep: TP=0 (no TP) — pf=0.0 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=0 (no TP)
- Result: PF=0.0 WR=0.0% net_pnl=-6570.13 trades=102 tp=100 sl=2 eod=0

### Run 20: TP sweep: TP=3.0 PF1.378>1.129 keep; TP=0 degenerate instant-exit — pf=0.0 (discard)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=3.0 PF1.378>1.129 keep; TP=0 degenerate instant-exit
- Result: PF=0.0 WR=0.0% net_pnl=-6570.13 trades=102 tp=100 sl=2 eod=0

### Run 21: TP sweep: TP=2.5 — pf=1.1667 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=2.5
- Result: PF=1.1667 WR=34.3% net_pnl=1732.33 trades=35 tp=8 sl=17 eod=10

### Run 22: TP sweep: TP=4.0 — pf=1.5632 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=4.0
- Result: PF=1.5632 WR=32.3% net_pnl=5224.41 trades=31 tp=6 sl=15 eod=10

### Run 23: TP sweep: TP=2.5 PF1.167<1.563 — pf=1.1667 (discard)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=2.5 PF1.167<1.563
- Result: PF=1.1667 WR=34.3% net_pnl=1732.33 trades=35 tp=8 sl=17 eod=10

### Run 24: TP sweep: TP=3.5 — pf=1.5731 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=3.5
- Result: PF=1.5731 WR=34.4% net_pnl=5315.79 trades=32 tp=7 sl=15 eod=10

### Run 25: TP sweep: TP=5.0 — pf=1.5238 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=5.0
- Result: PF=1.5238 WR=30.0% net_pnl=4897.92 trades=30 tp=5 sl=15 eod=10

### Run 26: TP sweep: TP=6.0 — pf=1.9259 (keep)
- Timestamp: 2026-08-05 03:28
- What changed: TP sweep: TP=6.0
- Result: PF=1.9259 WR=29.2% net_pnl=6471.54 trades=24 tp=4 sl=11 eod=9

### Run 27: TP sweep: TP=5.0 PF1.524<1.926 — pf=1.5238 (discard)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=5.0 PF1.524<1.926
- Result: PF=1.5238 WR=30.0% net_pnl=4897.92 trades=30 tp=5 sl=15 eod=10

### Run 28: TP sweep: TP=7.0 — pf=2.012 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=7.0
- Result: PF=2.012 WR=27.3% net_pnl=6414.05 trades=22 tp=2 sl=10 eod=10

### Run 29: TP sweep: TP=8.0 — pf=2.2215 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=8.0
- Result: PF=2.2215 WR=27.3% net_pnl=7742.1 trades=22 tp=2 sl=10 eod=10

### Run 30: TP sweep: TP=10.0 — pf=1.398 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=10.0
- Result: PF=1.398 WR=24.0% net_pnl=3228.21 trades=25 tp=2 sl=13 eod=10

### Run 31: TP sweep: TP=7.0 PF2.012<2.222 — pf=2.012 (discard)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=7.0 PF2.012<2.222
- Result: PF=2.012 WR=27.3% net_pnl=6414.05 trades=22 tp=2 sl=10 eod=10

### Run 32: TP sweep: TP=8.5 — pf=2.2995 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=8.5
- Result: PF=2.2995 WR=27.3% net_pnl=8236.06 trades=22 tp=2 sl=10 eod=10

### Run 33: TP sweep: TP=9.0 — pf=1.7937 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=9.0
- Result: PF=1.7937 WR=26.1% net_pnl=5547.6 trades=23 tp=2 sl=11 eod=10

### Run 34: TP sweep: TP=10.0 PF1.398<2.222 — pf=1.398 (discard)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=10.0 PF1.398<2.222
- Result: PF=1.398 WR=24.0% net_pnl=3228.21 trades=25 tp=2 sl=13 eod=10

### Run 35: TP sweep: TP=9.0 PF1.794<2.300 — pf=1.7937 (discard)
- Timestamp: 2026-08-05 03:29
- What changed: TP sweep: TP=9.0 PF1.794<2.300
- Result: PF=1.7937 WR=26.1% net_pnl=5547.6 trades=23 tp=2 sl=11 eod=10

### Run 36: buffer sweep: BUF=0.0 — pf=1.2012 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer sweep: BUF=0.0
- Result: PF=1.2012 WR=47.1% net_pnl=2449.12 trades=51 tp=19 sl=17 eod=15

### Run 37: buffer sweep: BUF=0.5 — pf=1.3616 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer sweep: BUF=0.5
- Result: PF=1.3616 WR=48.7% net_pnl=3395.61 trades=39 tp=17 sl=14 eod=8

### Run 38: buffer sweep: BUF=1.0 — pf=1.0388 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer sweep: BUF=1.0
- Result: PF=1.0388 WR=46.9% net_pnl=363.05 trades=32 tp=13 sl=15 eod=4

### Run 39: buffer sweep@TP8.5: BUF=0.0 — pf=2.5156 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer sweep@TP8.5: BUF=0.0
- Result: PF=2.5156 WR=42.3% net_pnl=9302.2 trades=26 tp=2 sl=8 eod=16

### Run 40: buffer sweep@TP8.5: BUF=0.5 — pf=3.0215 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer sweep@TP8.5: BUF=0.5
- Result: PF=3.0215 WR=33.3% net_pnl=9750.67 trades=18 tp=2 sl=7 eod=9

### Run 41: buffer sweep@TP8.5: BUF=1.0 — pf=1.1967 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer sweep@TP8.5: BUF=1.0
- Result: PF=1.1967 WR=27.8% net_pnl=1422.64 trades=18 tp=2 sl=12 eod=4

### Run 42: buffer@TP8.5: BUF=0.0 PF2.516<3.022 — pf=2.5156 (discard)
- Timestamp: 2026-08-05 03:29
- What changed: buffer@TP8.5: BUF=0.0 PF2.516<3.022
- Result: PF=2.5156 WR=42.3% net_pnl=9302.2 trades=26 tp=2 sl=8 eod=16

### Run 43: buffer@TP8.5: BUF=0.4 — pf=2.5682 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer@TP8.5: BUF=0.4
- Result: PF=2.5682 WR=30.0% net_pnl=8899.25 trades=20 tp=2 sl=9 eod=9

### Run 44: buffer@TP8.5: BUF=0.6 — pf=3.1319 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer@TP8.5: BUF=0.6
- Result: PF=3.1319 WR=31.2% net_pnl=9055.46 trades=16 tp=2 sl=6 eod=8

### Run 45: buffer@TP8.5: BUF=0.75 — pf=2.0625 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer@TP8.5: BUF=0.75
- Result: PF=2.0625 WR=31.2% net_pnl=5666.69 trades=16 tp=2 sl=8 eod=6

### Run 46: buffer@TP8.5: BUF=0.4 PF2.568<3.132 — pf=2.5682 (discard)
- Timestamp: 2026-08-05 03:29
- What changed: buffer@TP8.5: BUF=0.4 PF2.568<3.132
- Result: PF=2.5682 WR=30.0% net_pnl=8899.25 trades=20 tp=2 sl=9 eod=9

### Run 47: buffer@TP8.5: BUF=0.55 — pf=2.758 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer@TP8.5: BUF=0.55
- Result: PF=2.758 WR=29.4% net_pnl=8479.6 trades=17 tp=2 sl=7 eod=8

### Run 48: buffer@TP8.5: BUF=0.65 — pf=3.1063 (keep)
- Timestamp: 2026-08-05 03:29
- What changed: buffer@TP8.5: BUF=0.65
- Result: PF=3.1063 WR=31.2% net_pnl=9020.44 trades=16 tp=2 sl=6 eod=8

### Run 49: buffer@TP8.5: BUF=0.75 PF2.062<3.132 — pf=2.0625 (discard)
- Timestamp: 2026-08-05 03:30
- What changed: buffer@TP8.5: BUF=0.75 PF2.062<3.132
- Result: PF=2.0625 WR=31.2% net_pnl=5666.69 trades=16 tp=2 sl=8 eod=6

### Run 50: buffer@TP8.5: BUF=0.55 PF2.758<3.132 — pf=2.758 (discard)
- Timestamp: 2026-08-05 03:30
- What changed: buffer@TP8.5: BUF=0.55 PF2.758<3.132
- Result: PF=2.758 WR=29.4% net_pnl=8479.6 trades=17 tp=2 sl=7 eod=8

### Run 51: cooldown sweep: CD=0 — pf=3.1319 (keep)
- Timestamp: 2026-08-05 03:30
- What changed: cooldown sweep: CD=0
- Result: PF=3.1319 WR=31.2% net_pnl=9055.46 trades=16 tp=2 sl=6 eod=8

### Run 52: cooldown sweep: CD=2 — pf=2.7148 (keep)
- Timestamp: 2026-08-05 03:30
- What changed: cooldown sweep: CD=2
- Result: PF=2.7148 WR=31.2% net_pnl=7344.35 trades=16 tp=2 sl=6 eod=8

### Run 53: cooldown sweep: CD=3 — pf=2.1519 (keep)
- Timestamp: 2026-08-05 03:30
- What changed: cooldown sweep: CD=3
- Result: PF=2.1519 WR=26.7% net_pnl=5339.33 trades=15 tp=2 sl=6 eod=7

### Run 54: cooldown sweep: CD=0 same as CD=1 — pf=3.1319 (discard)
- Timestamp: 2026-08-05 03:30
- What changed: cooldown sweep: CD=0 same as CD=1
- Result: PF=3.1319 WR=31.2% net_pnl=9055.46 trades=16 tp=2 sl=6 eod=8

### Run 55: EOD sweep: EOD=870 (14:30) — pf=4.1378 (keep)
- Timestamp: 2026-08-05 03:30
- What changed: EOD sweep: EOD=870 (14:30)
- Result: PF=4.1378 WR=46.7% net_pnl=8882.5 trades=15 tp=2 sl=5 eod=8

### Run 56: EOD sweep: EOD=885 (14:45) — pf=4.4648 (keep)
- Timestamp: 2026-08-05 03:30
- What changed: EOD sweep: EOD=885 (14:45)
- Result: PF=4.4648 WR=53.3% net_pnl=10551.45 trades=15 tp=2 sl=5 eod=8

### Run 57: cooldown sweep: CD=2 PF2.715<3.132 — pf=2.7148 (discard)
- Timestamp: 2026-08-05 03:30
- What changed: cooldown sweep: CD=2 PF2.715<3.132
- Result: PF=2.7148 WR=31.2% net_pnl=7344.35 trades=16 tp=2 sl=6 eod=8

### Run 58: EOD sweep: EOD=870 PF4.138<4.465 — pf=4.1378 (discard)
- Timestamp: 2026-08-05 03:30
- What changed: EOD sweep: EOD=870 PF4.138<4.465
- Result: PF=4.1378 WR=46.7% net_pnl=8882.5 trades=15 tp=2 sl=5 eod=8

### Run 59: EOD sweep: EOD=855 (14:15) — pf=4.3208 (keep)
- Timestamp: 2026-08-05 03:30
- What changed: EOD sweep: EOD=855 (14:15)
- Result: PF=4.3208 WR=46.7% net_pnl=9739.97 trades=15 tp=2 sl=4 eod=9

### Run 60: EOD sweep: EOD=840 (14:00) — pf=5.3861 (keep)
- Timestamp: 2026-08-05 03:30
- What changed: EOD sweep: EOD=840 (14:00)
- Result: PF=5.3861 WR=50.0% net_pnl=10751.19 trades=14 tp=2 sl=2 eod=10

### Run 61: EOD sweep: EOD=825 (13:45) — pf=5.5075 (keep)
- Timestamp: 2026-08-05 03:30
- What changed: EOD sweep: EOD=825 (13:45)
- Result: PF=5.5075 WR=42.9% net_pnl=10556.31 trades=14 tp=2 sl=2 eod=10

### Run 62: EOD sweep: EOD=855 PF4.321<5.386 — pf=4.3208 (discard)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=855 PF4.321<5.386
- Result: PF=4.3208 WR=46.7% net_pnl=9739.97 trades=15 tp=2 sl=4 eod=9

### Run 63: EOD sweep: EOD=810 (13:30) — pf=5.7014 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=810 (13:30)
- Result: PF=5.7014 WR=35.7% net_pnl=9910.73 trades=14 tp=2 sl=2 eod=10

### Run 64: EOD sweep: EOD=795 (13:15) — pf=5.0968 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=795 (13:15)
- Result: PF=5.0968 WR=30.8% net_pnl=8652.73 trades=13 tp=2 sl=2 eod=9

### Run 65: EOD sweep: EOD=780 (13:00) — pf=5.9452 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=780 (13:00)
- Result: PF=5.9452 WR=41.7% net_pnl=9452.86 trades=12 tp=2 sl=2 eod=8

### Run 66: EOD sweep: EOD=810 PF5.701<5.945 — pf=5.7014 (discard)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=810 PF5.701<5.945
- Result: PF=5.7014 WR=35.7% net_pnl=9910.73 trades=14 tp=2 sl=2 eod=10

### Run 67: EOD sweep: EOD=765 (12:45) — pf=5.1778 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=765 (12:45)
- Result: PF=5.1778 WR=41.7% net_pnl=7516.14 trades=12 tp=1 sl=2 eod=9

### Run 68: EOD sweep: EOD=750 (12:30) — pf=4.7343 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=750 (12:30)
- Result: PF=4.7343 WR=36.4% net_pnl=6452.9 trades=11 tp=1 sl=1 eod=9

### Run 69: EOD sweep: EOD=795 PF5.097<5.945 — pf=5.0968 (discard)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=795 PF5.097<5.945
- Result: PF=5.0968 WR=30.8% net_pnl=8652.73 trades=13 tp=2 sl=2 eod=9

### Run 70: EOD sweep: EOD=765 PF5.178<5.945 — pf=5.1778 (discard)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=765 PF5.178<5.945
- Result: PF=5.1778 WR=41.7% net_pnl=7516.14 trades=12 tp=1 sl=2 eod=9

### Run 71: TP sens @EOD780: TP=3.0 — pf=3.0071 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: TP sens @EOD780: TP=3.0
- Result: PF=3.0071 WR=47.1% net_pnl=6384.1 trades=17 tp=6 sl=4 eod=7

### Run 72: TP sens @EOD780: TP=99 (pure EOD exit) — pf=5.2625 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: TP sens @EOD780: TP=99 (pure EOD exit)
- Result: PF=5.2625 WR=36.4% net_pnl=8147.88 trades=11 tp=0 sl=2 eod=9

### Run 73: EOD sweep: EOD=750 PF4.734<5.945 — pf=4.7343 (discard)
- Timestamp: 2026-08-05 03:31
- What changed: EOD sweep: EOD=750 PF4.734<5.945
- Result: PF=4.7343 WR=36.4% net_pnl=6452.9 trades=11 tp=1 sl=1 eod=9

### Run 74: TP sens@EOD780: TP=3.0 PF3.007<5.945 — pf=3.0071 (discard)
- Timestamp: 2026-08-05 03:31
- What changed: TP sens@EOD780: TP=3.0 PF3.007<5.945
- Result: PF=3.0071 WR=47.1% net_pnl=6384.1 trades=17 tp=6 sl=4 eod=7

### Run 75: minOR sweep: 0.2 — pf=5.9452 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: minOR sweep: 0.2
- Result: PF=5.9452 WR=41.7% net_pnl=9452.86 trades=12 tp=2 sl=2 eod=8

### Run 76: minOR sweep: 0.5 — pf=5.9452 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: minOR sweep: 0.5
- Result: PF=5.9452 WR=41.7% net_pnl=9452.86 trades=12 tp=2 sl=2 eod=8

### Run 77: minOR sweep: 0.8 — pf=8.9671 (keep)
- Timestamp: 2026-08-05 03:31
- What changed: minOR sweep: 0.8
- Result: PF=8.9671 WR=50.0% net_pnl=10097.05 trades=10 tp=2 sl=1 eod=7

### Run 78: minOR sweep: 0.2/0.5 same as 0.3 — pf=5.9452 (discard)
- Timestamp: 2026-08-05 03:32
- What changed: minOR sweep: 0.2/0.5 same as 0.3
- Result: PF=5.9452 WR=41.7% net_pnl=9452.86 trades=12 tp=2 sl=2 eod=8

### Run 79: minOR sweep: 0.6 — pf=5.9452 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: minOR sweep: 0.6
- Result: PF=5.9452 WR=41.7% net_pnl=9452.86 trades=12 tp=2 sl=2 eod=8

### Run 80: minOR sweep: 0.7 — pf=8.9671 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: minOR sweep: 0.7
- Result: PF=8.9671 WR=50.0% net_pnl=10097.05 trades=10 tp=2 sl=1 eod=7

### Run 81: minOR sweep: 1.0 — pf=8.9671 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: minOR sweep: 1.0
- Result: PF=8.9671 WR=50.0% net_pnl=10097.05 trades=10 tp=2 sl=1 eod=7

### Run 82: minOR sweep: 0.6 same as 0.3 — pf=5.9452 (discard)
- Timestamp: 2026-08-05 03:32
- What changed: minOR sweep: 0.6 same as 0.3
- Result: PF=5.9452 WR=41.7% net_pnl=9452.86 trades=12 tp=2 sl=2 eod=8

### Run 83: minOR sweep: 1.2 — pf=8.9671 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: minOR sweep: 1.2
- Result: PF=8.9671 WR=50.0% net_pnl=10097.05 trades=10 tp=2 sl=1 eod=7

### Run 84: minOR sweep: 1.5 — pf=24.2554 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: minOR sweep: 1.5
- Result: PF=24.2554 WR=83.3% net_pnl=10895.87 trades=6 tp=2 sl=0 eod=4

### Run 85: minOR sweep: 1.0 dup of 0.7-0.8 — pf=8.9671 (discard)
- Timestamp: 2026-08-05 03:32
- What changed: minOR sweep: 1.0 dup of 0.7-0.8
- Result: PF=8.9671 WR=50.0% net_pnl=10097.05 trades=10 tp=2 sl=1 eod=7

### Run 86: minOR=1.5 PF24.3 but only 6 trades UNRELIABLE — pf=24.2554 (discard)
- Timestamp: 2026-08-05 03:32
- What changed: minOR=1.5 PF24.3 but only 6 trades UNRELIABLE
- Result: PF=24.2554 WR=83.3% net_pnl=10895.87 trades=6 tp=2 sl=0 eod=4

### Run 87: shorts ON @best minOR0.8 — pf=2.5127 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: shorts ON @best minOR0.8
- Result: PF=2.5127 WR=46.2% net_pnl=7341.68 trades=26 tp=2 sl=7 eod=17

### Run 88: shorts ON @minOR0.3 (more trades) — pf=2.2182 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: shorts ON @minOR0.3 (more trades)
- Result: PF=2.2182 WR=42.9% net_pnl=6697.49 trades=28 tp=2 sl=8 eod=18

### Run 89: minOR=1.2 dup of 0.8 — pf=8.9671 (discard)
- Timestamp: 2026-08-05 03:32
- What changed: minOR=1.2 dup of 0.8
- Result: PF=8.9671 WR=50.0% net_pnl=10097.05 trades=10 tp=2 sl=1 eod=7

### Run 90: shorts@0.8 PF2.51 worse, shorts hurt — pf=2.5127 (discard)
- Timestamp: 2026-08-05 03:32
- What changed: shorts@0.8 PF2.51 worse, shorts hurt
- Result: PF=2.5127 WR=46.2% net_pnl=7341.68 trades=26 tp=2 sl=7 eod=17

### Run 91: robust: SL=0.75 — pf=4.3107 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: robust: SL=0.75
- Result: PF=4.3107 WR=38.5% net_pnl=8824.1 trades=13 tp=2 sl=4 eod=7

### Run 92: robust: SL=1.25 — pf=9.9137 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: robust: SL=1.25
- Result: PF=9.9137 WR=50.0% net_pnl=10218.07 trades=10 tp=2 sl=0 eod=8

### Run 93: shorts@0.3 PF2.22 worse — pf=2.2182 (discard)
- Timestamp: 2026-08-05 03:32
- What changed: shorts@0.3 PF2.22 worse
- Result: PF=2.2182 WR=42.9% net_pnl=6697.49 trades=28 tp=2 sl=8 eod=18

### Run 94: robust SL=0.75 PF4.31 worse — pf=4.3107 (discard)
- Timestamp: 2026-08-05 03:32
- What changed: robust SL=0.75 PF4.31 worse
- Result: PF=4.3107 WR=38.5% net_pnl=8824.1 trades=13 tp=2 sl=4 eod=7

### Run 95: robust: SL=1.5 — pf=9.9137 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: robust: SL=1.5
- Result: PF=9.9137 WR=50.0% net_pnl=10218.07 trades=10 tp=2 sl=0 eod=8

### Run 96: robust: SL=2.0 — pf=9.9137 (keep)
- Timestamp: 2026-08-05 03:32
- What changed: robust: SL=2.0
- Result: PF=9.9137 WR=50.0% net_pnl=10218.07 trades=10 tp=2 sl=0 eod=8

### Run 97: robust SL=1.5 dup of 1.25 — pf=9.9137 (discard)
- Timestamp: 2026-08-05 03:33
- What changed: robust SL=1.5 dup of 1.25
- Result: PF=9.9137 WR=50.0% net_pnl=10218.07 trades=10 tp=2 sl=0 eod=8

### Run 98: robust: BUF=0.5 SL=1.25 — pf=5.9385 (keep)
- Timestamp: 2026-08-05 03:33
- What changed: robust: BUF=0.5 SL=1.25
- Result: PF=5.9385 WR=45.5% net_pnl=9450.73 trades=11 tp=2 sl=1 eod=8

### Run 99: robust: BUF=0.7 SL=1.25 — pf=9.2568 (keep)
- Timestamp: 2026-08-05 03:33
- What changed: robust: BUF=0.7 SL=1.25
- Result: PF=9.2568 WR=50.0% net_pnl=9465.01 trades=10 tp=1 sl=0 eod=9

### Run 100: robust SL=2.0 dup of 1.25 — pf=9.9137 (discard)
- Timestamp: 2026-08-05 03:33
- What changed: robust SL=2.0 dup of 1.25
- Result: PF=9.9137 WR=50.0% net_pnl=10218.07 trades=10 tp=2 sl=0 eod=8

### Run 101: robust BUF=0.5 PF5.94 worse — pf=5.9385 (discard)
- Timestamp: 2026-08-05 03:33
- What changed: robust BUF=0.5 PF5.94 worse
- Result: PF=5.9385 WR=45.5% net_pnl=9450.73 trades=11 tp=2 sl=1 eod=8

### Run 102: robust: EOD=770 — pf=9.9137 (keep)
- Timestamp: 2026-08-05 03:33
- What changed: robust: EOD=770
- Result: PF=9.9137 WR=50.0% net_pnl=10218.07 trades=10 tp=2 sl=0 eod=8

### Run 103: robust: EOD=790 — pf=8.4681 (keep)
- Timestamp: 2026-08-05 03:33
- What changed: robust: EOD=790
- Result: PF=8.4681 WR=40.0% net_pnl=9493.56 trades=10 tp=2 sl=0 eod=8

### Run 104: robust BUF=0.7 PF9.26<9.91 — pf=9.2568 (discard)
- Timestamp: 2026-08-05 03:33
- What changed: robust BUF=0.7 PF9.26<9.91
- Result: PF=9.2568 WR=50.0% net_pnl=9465.01 trades=10 tp=1 sl=0 eod=9

### Run 105: robust EOD=770 same as 780 — pf=9.9137 (discard)
- Timestamp: 2026-08-05 03:33
- What changed: robust EOD=770 same as 780
- Result: PF=9.9137 WR=50.0% net_pnl=10218.07 trades=10 tp=2 sl=0 eod=8

### Run 106: robust: TP=8.0 SL=1.25 — pf=9.4828 (keep)
- Timestamp: 2026-08-05 03:33
- What changed: robust: TP=8.0 SL=1.25
- Result: PF=9.4828 WR=50.0% net_pnl=9724.12 trades=10 tp=2 sl=0 eod=8

### Run 107: robust: TP=9.0 SL=1.25 — pf=9.7456 (keep)
- Timestamp: 2026-08-05 03:33
- What changed: robust: TP=9.0 SL=1.25
- Result: PF=9.7456 WR=50.0% net_pnl=10025.29 trades=10 tp=1 sl=0 eod=9

### Run 108: robust EOD=790 PF8.47<9.91 — pf=8.4681 (discard)
- Timestamp: 2026-08-05 03:33
- What changed: robust EOD=790 PF8.47<9.91
- Result: PF=8.4681 WR=40.0% net_pnl=9493.56 trades=10 tp=2 sl=0 eod=8

### Run 109: robust TP=8.0 PF9.48<9.91 — pf=9.4828 (discard)
- Timestamp: 2026-08-05 03:33
- What changed: robust TP=8.0 PF9.48<9.91
- Result: PF=9.4828 WR=50.0% net_pnl=9724.12 trades=10 tp=2 sl=0 eod=8

### Run 110: robust TP=9.0 PF9.75<9.91 — pf=9.7456 (discard)
- Timestamp: 2026-08-05 03:33
- What changed: robust TP=9.0 PF9.75<9.91
- Result: PF=9.7456 WR=50.0% net_pnl=10025.29 trades=10 tp=1 sl=0 eod=9

### Run 111: OR60 with best params (rescue attempt) — pf=0.0 (keep)
- Timestamp: 2026-08-05 03:33
- What changed: OR60 with best params (rescue attempt)
- Result: PF=0.0 WR=0.0% net_pnl=-1134.31 trades=3 tp=0 sl=0 eod=3

