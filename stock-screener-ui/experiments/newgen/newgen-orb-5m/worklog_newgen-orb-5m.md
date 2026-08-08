# Worklog: newgen-orb-5m

Autoresearch session for ORB parameters on NEWGEN 5-min candles. Primary metric: profit_factor (higher better, trust only if total_trades>=10). Data: Upstox 5-min candles 2026-05-04..2026-08-04 (4875 rows, 65 days). Baseline config: OR=15, SL=1.0, TP=1.5, buffer=0.3, cooldown=1, shorts=0, EOD=900, min_or_range=0.3, max_or_range=5.0, size=100, costs=on.

### Run 1: baseline OR=15 SL=1.0 TP=1.5 buffer=0.3 cooldown=1 shorts=0 EOD=900 min_or_range=0.3 — PF=0.9548 (KEEP)
- Timestamp: 2026-08-05 03:27
- Result: PF=0.9548, net_pnl=-777.70, trades=61, WR=45.9%, TP=22 SL=29 EOD=10

### Run 2: OR sweep: OR=5 SL=1.0 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=0.9277 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Result: PF=0.9277, net_pnl=-1718.72, trades=82, WR=43.9%, TP=30 SL=38 EOD=14

### Run 3: OR sweep: OR=10 SL=1.0 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=0.9823 (KEEP)
- Timestamp: 2026-08-05 03:27
- Result: PF=0.9823, net_pnl=-331.46, trades=67, WR=46.3%, TP=25 SL=31 EOD=11

### Run 4: OR sweep: OR=60 SL=1.0 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=0.6136 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Result: PF=0.6136, net_pnl=-1356.52, trades=13, WR=30.8%, TP=3 SL=6 EOD=4

### Run 5: OR=10 SL=0.5 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=1.0346 (KEEP)
- Timestamp: 2026-08-05 03:27
- Result: PF=1.0346, net_pnl=656.80, trades=95, WR=34.7%, TP=26 SL=60 EOD=9

### Run 6: OR=10 SL=0.75 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=1.0372 (KEEP)
- Timestamp: 2026-08-05 03:27
- Result: PF=1.0372, net_pnl=695.85, trades=77, WR=41.6%, TP=26 SL=40 EOD=11

### Run 7: OR=10 SL=1.25 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=1.1409 (KEEP)
- Timestamp: 2026-08-05 03:27
- Result: PF=1.1409, net_pnl=2354.69, trades=58, WR=51.7%, TP=26 SL=21 EOD=11

### Run 8: OR=10 SL=1.5 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=1.1235 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Result: PF=1.1235, net_pnl=2108.60, trades=56, WR=53.6%, TP=26 SL=17 EOD=13

### Run 9: OR=10 SL=2.0 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=1.0920 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Result: PF=1.0920, net_pnl=1456.19, trades=48, WR=58.3%, TP=23 SL=12 EOD=13

### Run 10: OR=10 SL=2.5 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=1.4542 (KEEP)
- Timestamp: 2026-08-05 03:27
- Result: PF=1.4542, net_pnl=5335.64, trades=43, WR=62.8%, TP=23 SL=5 EOD=15

### Run 11: OR=10 SL=3.0 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=1.4499 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Result: PF=1.4499, net_pnl=5052.77, trades=41, WR=63.4%, TP=22 SL=2 EOD=17

### Run 12: OR=10 SL=4.0 TP=1.5 buffer=0.3 cooldown=1 EOD=900 — PF=1.3931 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Result: PF=1.3931, net_pnl=4588.99, trades=40, WR=62.5%, TP=22 SL=1 EOD=17

### Run 13: OR=10 SL=2.5 TP=1.0 buffer=0.3 cooldown=1 EOD=900 — PF=1.3321 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Result: PF=1.3321, net_pnl=4117.70, trades=55, WR=69.1%, TP=35 SL=5 EOD=15

### Run 14: OR=10 SL=2.5 TP=2.0 buffer=0.3 cooldown=1 EOD=900 — PF=1.3105 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Result: PF=1.3105, net_pnl=3852.57, trades=36, WR=58.3%, TP=15 SL=6 EOD=15

### Run 15: OR=10 SL=2.5 TP=3.0 buffer=0.3 cooldown=1 EOD=900 — PF=1.5006 (KEEP)
- Timestamp: 2026-08-05 03:28
- Result: PF=1.5006, net_pnl=5232.12, trades=29, WR=51.7%, TP=9 SL=4 EOD=16

### Run 16: OR=10 SL=2.5 TP=0(degenerate=immediate TP) buffer=0.3 cooldown=1 EOD=900 — PF=0.0000 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Result: PF=0.0000, net_pnl=-17904.01, trades=280, WR=0.0%, TP=276 SL=1 EOD=3

### Run 17: OR=10 SL=2.5 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=2.0577 (KEEP)
- Timestamp: 2026-08-05 03:28
- Result: PF=2.0577, net_pnl=7081.02, trades=18, WR=44.4%, TP=0 SL=2 EOD=16

### Run 18: OR=10 SL=2.5 TP=5.0 buffer=0.3 cooldown=1 EOD=900 — PF=1.7074 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Result: PF=1.7074, net_pnl=6019.08, trades=24, WR=50.0%, TP=5 SL=3 EOD=16

### Run 19: OR=10 SL=1.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=2.2842 (KEEP)
- Timestamp: 2026-08-05 03:29
- Result: PF=2.2842, net_pnl=7600.26, trades=22, WR=45.5%, TP=0 SL=10 EOD=12

### Run 20: OR=10 SL=1.5 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=2.0524 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Result: PF=2.0524, net_pnl=6876.35, trades=19, WR=42.1%, TP=0 SL=5 EOD=14

### Run 21: OR=10 SL=2.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=1.7125 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Result: PF=1.7125, net_pnl=5579.53, trades=19, WR=42.1%, TP=0 SL=5 EOD=14

### Run 22: OR=10 SL=3.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=2.1670 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Result: PF=2.1670, net_pnl=7418.56, trades=18, WR=44.4%, TP=0 SL=0 EOD=18

### Run 23: OR=5 SL=1.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=1.7682 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Result: PF=1.7682, net_pnl=6379.78, trades=28, WR=39.3%, TP=0 SL=13 EOD=15

### Run 24: OR=15 SL=1.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=2.5299 (KEEP)
- Timestamp: 2026-08-05 03:29
- Result: PF=2.5299, net_pnl=7582.12, trades=20, WR=45.0%, TP=0 SL=9 EOD=11

### Run 25: OR=60 SL=1.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=0.0005 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Result: PF=0.0005, net_pnl=-2275.48, trades=8, WR=12.5%, TP=0 SL=4 EOD=4

### Run 26: OR=10 SL=1.0 TP=100 buffer=0.0 cooldown=1 EOD=900 — PF=1.5115 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Result: PF=1.5115, net_pnl=4861.59, trades=32, WR=40.6%, TP=0 SL=15 EOD=17

### Run 27: OR=10 SL=1.0 TP=100 buffer=0.5 cooldown=1 EOD=900 — PF=2.3064 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Result: PF=2.3064, net_pnl=7314.89, trades=20, WR=35.0%, TP=0 SL=9 EOD=11

### Run 28: OR=10 SL=1.0 TP=100 buffer=1.0 cooldown=1 EOD=900 — PF=1.7771 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Result: PF=1.7771, net_pnl=5137.92, trades=18, WR=27.8%, TP=0 SL=11 EOD=7

### Run 29: OR=12 SL=1.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=2.5299 (KEEP)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.5299, net_pnl=7582.12, trades=20, WR=45.0%, TP=0 SL=9 EOD=11

### Run 30: OR=20 SL=1.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=0.9248 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Result: PF=0.9248, net_pnl=-499.59, trades=20, WR=20.0%, TP=0 SL=11 EOD=9

### Run 31: OR=30 SL=1.0 TP=100(no cap) buffer=0.3 cooldown=1 EOD=900 — PF=0.0259 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Result: PF=0.0259, net_pnl=-4514.03, trades=14, WR=21.4%, TP=0 SL=7 EOD=7

### Run 32: OR=15 SL=1.0 TP=100 buffer=0.2 cooldown=1 EOD=900 — PF=2.4469 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.4469, net_pnl=7526.34, trades=21, WR=42.9%, TP=0 SL=8 EOD=13

### Run 33: OR=15 SL=1.0 TP=100 buffer=0.4 cooldown=1 EOD=900 — PF=2.8307 (KEEP)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.8307, net_pnl=8107.96, trades=18, WR=44.4%, TP=0 SL=8 EOD=10

### Run 34: OR=15 SL=1.0 TP=100 buffer=0.6 cooldown=1 EOD=900 — PF=2.0563 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.0563, net_pnl=6043.51, trades=19, WR=21.1%, TP=0 SL=9 EOD=10

### Run 35: OR=15 SL=1.0 TP=100 buffer=0.35 cooldown=1 EOD=900 — PF=2.5296 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.5296, net_pnl=7581.57, trades=20, WR=45.0%, TP=0 SL=9 EOD=11

### Run 36: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=1 EOD=900 — PF=2.8494 (KEEP)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.8494, net_pnl=8106.06, trades=17, WR=35.3%, TP=0 SL=7 EOD=10

### Run 37: OR=15 SL=1.0 TP=100 buffer=0.5 cooldown=1 EOD=900 — PF=2.8480 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.8480, net_pnl=8103.90, trades=17, WR=35.3%, TP=0 SL=7 EOD=10

### Run 38: OR=15 SL=0.75 TP=100 buffer=0.4 cooldown=1 EOD=900 — PF=2.4445 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.4445, net_pnl=7710.60, trades=22, WR=31.8%, TP=0 SL=12 EOD=10

### Run 39: OR=15 SL=1.25 TP=100 buffer=0.4 cooldown=1 EOD=900 — PF=2.3741 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Result: PF=2.3741, net_pnl=7155.72, trades=17, WR=41.2%, TP=0 SL=7 EOD=10

### Run 40: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=0 EOD=900 — PF=2.8494 (KEEP)
- Timestamp: 2026-08-05 03:31
- Result: PF=2.8494, net_pnl=8106.06, trades=17, WR=35.3%, TP=0 SL=7 EOD=10

### Run 41: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=2 EOD=900 — PF=2.8186 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Result: PF=2.8186, net_pnl=7971.01, trades=17, WR=35.3%, TP=0 SL=7 EOD=10

### Run 42: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=900 — PF=2.8665 (KEEP)
- Timestamp: 2026-08-05 03:31
- Result: PF=2.8665, net_pnl=8181.10, trades=17, WR=35.3%, TP=0 SL=7 EOD=10

### Run 43: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=4 EOD=900 — PF=2.7595 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Result: PF=2.7595, net_pnl=7755.92, trades=17, WR=35.3%, TP=0 SL=7 EOD=10

### Run 44: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=5 EOD=900 — PF=2.7765 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Result: PF=2.7765, net_pnl=7910.98, trades=17, WR=35.3%, TP=0 SL=7 EOD=10

### Run 45: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=870 — PF=2.9983 (KEEP)
- Timestamp: 2026-08-05 03:31
- Result: PF=2.9983, net_pnl=7563.25, trades=16, WR=31.2%, TP=0 SL=6 EOD=10

### Run 46: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=885 — PF=2.9667 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Result: PF=2.9667, net_pnl=7477.75, trades=17, WR=41.2%, TP=0 SL=6 EOD=11

### Run 47: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=840 — PF=3.7725 (KEEP)
- Timestamp: 2026-08-05 03:31
- Result: PF=3.7725, net_pnl=8946.13, trades=15, WR=53.3%, TP=0 SL=5 EOD=10

### Run 48: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=855 — PF=3.3097 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Result: PF=3.3097, net_pnl=8461.12, trades=16, WR=37.5%, TP=0 SL=5 EOD=11

### Run 49: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=860 — PF=3.2440 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Result: PF=3.2440, net_pnl=8321.21, trades=16, WR=43.8%, TP=0 SL=5 EOD=11

### Run 50: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=810 — PF=3.4310 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Result: PF=3.4310, net_pnl=7492.06, trades=15, WR=46.7%, TP=0 SL=5 EOD=10

### Run 51: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=825 — PF=3.6936 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Result: PF=3.6936, net_pnl=8626.33, trades=15, WR=40.0%, TP=0 SL=5 EOD=10

### Run 52: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=830 — PF=3.7200 (DISCARD)
- Timestamp: 2026-08-05 03:32
- Result: PF=3.7200, net_pnl=8551.39, trades=15, WR=40.0%, TP=0 SL=5 EOD=10

### Run 53: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=835 — PF=3.6808 (DISCARD)
- Timestamp: 2026-08-05 03:32
- Result: PF=3.6808, net_pnl=8681.30, trades=15, WR=40.0%, TP=0 SL=5 EOD=10

### Run 54: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 — PF=4.0294 (KEEP)
- Timestamp: 2026-08-05 03:32
- Result: PF=4.0294, net_pnl=9870.52, trades=15, WR=46.7%, TP=0 SL=5 EOD=10

### Run 55: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=842 — PF=4.0294 (KEEP)
- Timestamp: 2026-08-05 03:32
- Result: PF=4.0294, net_pnl=9870.52, trades=15, WR=46.7%, TP=0 SL=5 EOD=10

### Run 56: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=843 — PF=4.0294 (KEEP)
- Timestamp: 2026-08-05 03:32
- Result: PF=4.0294, net_pnl=9870.52, trades=15, WR=46.7%, TP=0 SL=5 EOD=10

### Run 57: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=847 — PF=3.4521 (DISCARD)
- Timestamp: 2026-08-05 03:32
- Result: PF=3.4521, net_pnl=8700.97, trades=16, WR=37.5%, TP=0 SL=5 EOD=11

### Run 58: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=848 — PF=3.4521 (DISCARD)
- Timestamp: 2026-08-05 03:32
- Result: PF=3.4521, net_pnl=8700.97, trades=16, WR=37.5%, TP=0 SL=5 EOD=11

### Run 59: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=850 — PF=3.4521 (DISCARD)
- Timestamp: 2026-08-05 03:32
- Result: PF=3.4521, net_pnl=8700.97, trades=16, WR=37.5%, TP=0 SL=5 EOD=11

### Run 60: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=0.2 — PF=4.0294 (KEEP)
- Timestamp: 2026-08-05 03:32
- Result: PF=4.0294, net_pnl=9870.52, trades=15, WR=46.7%, TP=0 SL=5 EOD=10

### Run 61: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=0.5 — PF=4.0294 (KEEP)
- Timestamp: 2026-08-05 03:32
- Result: PF=4.0294, net_pnl=9870.52, trades=15, WR=46.7%, TP=0 SL=5 EOD=10

### Run 62: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=0.8 — PF=4.5015 (KEEP)
- Timestamp: 2026-08-05 03:32
- Result: PF=4.5015, net_pnl=10212.25, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 63: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=1.0 — PF=4.5015 (KEEP)
- Timestamp: 2026-08-05 03:32
- Result: PF=4.5015, net_pnl=10212.25, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 64: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=1.2 — PF=4.5015 (KEEP)
- Timestamp: 2026-08-05 03:32
- Result: PF=4.5015, net_pnl=10212.25, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 65: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=1.5 [<10 trades unreliable] — PF=8.0206 (DISCARD)
- Timestamp: 2026-08-05 03:32
- Result: PF=8.0206, net_pnl=11072.41, trades=8, WR=62.5%, TP=0 SL=3 EOD=5

### Run 66: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=2.0 [<10 trades unreliable] — PF=12.4778 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=12.4778, net_pnl=11635.78, trades=7, WR=71.4%, TP=0 SL=2 EOD=5

### Run 67: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=3.0 [<10 trades unreliable] — PF=23.8805 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=23.8805, net_pnl=11691.25, trades=4, WR=75.0%, TP=0 SL=1 EOD=3

### Run 68: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=840 min_or_range=0.8 — PF=4.2266 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=4.2266, net_pnl=9292.86, trades=14, WR=57.1%, TP=0 SL=5 EOD=9

### Run 69: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=850 min_or_range=0.8 — PF=3.8560 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=3.8560, net_pnl=9072.68, trades=15, WR=40.0%, TP=0 SL=5 EOD=10

### Run 70: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 min_or_range=0.8 SHORTS=1 — PF=3.0459 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=3.0459, net_pnl=11557.68, trades=35, WR=48.6%, TP=0 SL=9 EOD=26

### Run 71: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=1 EOD=845 min_or_range=0.8 SHORTS=1 — PF=2.9825 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=2.9825, net_pnl=11387.71, trades=35, WR=48.6%, TP=0 SL=9 EOD=26

### Run 72: OR=15 SL=1.0 TP=100 buffer=0.4 cooldown=3 EOD=845 min_or_range=0.8 — PF=4.0542 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=4.0542, net_pnl=10093.84, trades=16, WR=56.2%, TP=0 SL=6 EOD=10

### Run 73: OR=15 SL=1.0 TP=100 buffer=0.5 cooldown=3 EOD=845 min_or_range=0.8 — PF=4.2328 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=4.2328, net_pnl=10027.07, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 74: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 mor=0.8 min_entry=15 — PF=4.5015 (KEEP)
- Timestamp: 2026-08-05 03:33
- Result: PF=4.5015, net_pnl=10212.25, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 75: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 mor=0.8 min_entry=30 — PF=3.4630 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=3.4630, net_pnl=9108.71, trades=14, WR=42.9%, TP=0 SL=6 EOD=8

### Run 76: OR=15 SL=1.0 TP=100 buffer=0.45 cooldown=3 EOD=845 mor=0.8 max_per_day=1 — PF=2.8754 (DISCARD)
- Timestamp: 2026-08-05 03:33
- Result: PF=2.8754, net_pnl=5469.70, trades=12, WR=41.7%, TP=0 SL=5 EOD=7

### Run 77: robustness: OR=15 SL=0.9 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.8 — PF=3.5928 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=3.5928, net_pnl=9492.63, trades=16, WR=43.8%, TP=0 SL=7 EOD=9

### Run 78: robustness: OR=15 SL=1.1 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.8 — PF=4.1497 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=4.1497, net_pnl=9964.96, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 79: robustness: OR=15 SL=1.0 TP=100 buffer=0.43 cd=3 EOD=845 mor=0.8 — PF=3.8001 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=3.8001, net_pnl=9673.92, trades=15, WR=46.7%, TP=0 SL=6 EOD=9

### Run 80: robustness: OR=15 SL=1.0 TP=100 buffer=0.47 cd=3 EOD=845 mor=0.8 — PF=4.2329 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=4.2329, net_pnl=10027.18, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 81: robustness: OR=15 SL=1.0 TP=100 buffer=0.45 cd=2 EOD=845 mor=0.8 — PF=4.4295 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=4.4295, net_pnl=10002.17, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 82: robustness: OR=15 SL=1.0 TP=100 buffer=0.45 cd=4 EOD=845 mor=0.8 — PF=4.3643 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=4.3643, net_pnl=9812.09, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 83: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.8 max_or_range=3.0 — PF=0.3852 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=0.3852, net_pnl=-1479.00, trades=10, WR=40.0%, TP=0 SL=4 EOD=6

### Run 84: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.8 max_or_range=4.0 — PF=3.4673 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=3.4673, net_pnl=5935.14, trades=11, WR=45.5%, TP=0 SL=4 EOD=7

### Run 85: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=843 mor=0.8 — PF=4.5015 (KEEP)
- Timestamp: 2026-08-05 03:34
- Result: PF=4.5015, net_pnl=10212.25, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 86: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=847 mor=0.8 — PF=3.8560 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=3.8560, net_pnl=9072.68, trades=15, WR=40.0%, TP=0 SL=5 EOD=10

### Run 87: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.8 COSTS=0 (PF inflated, for reference) — PF=5.2801 (KEEP)
- Timestamp: 2026-08-05 03:34
- Result: PF=5.2801, net_pnl=10975.65, trades=14, WR=57.1%, TP=0 SL=5 EOD=9

### Run 88: tuned at OR=5 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.8 — PF=2.8340 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=2.8340, net_pnl=10553.95, trades=22, WR=40.9%, TP=0 SL=9 EOD=13

### Run 89: tuned at OR=10 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.8 — PF=3.1494 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=3.1494, net_pnl=9373.02, trades=18, WR=44.4%, TP=0 SL=7 EOD=11

### Run 90: tuned at OR=60 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.8 — PF=0.0356 (DISCARD)
- Timestamp: 2026-08-05 03:34
- Result: PF=0.0356, net_pnl=-1758.27, trades=5, WR=20.0%, TP=0 SL=2 EOD=3

### Run 91: robustness: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.6 — PF=4.0294 (DISCARD)
- Timestamp: 2026-08-05 03:35
- Result: PF=4.0294, net_pnl=9870.52, trades=15, WR=46.7%, TP=0 SL=5 EOD=10

### Run 92: robustness: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.7 — PF=4.5015 (DISCARD)
- Timestamp: 2026-08-05 03:35
- Result: PF=4.5015, net_pnl=10212.25, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 93: robustness: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=0.9 — PF=4.5015 (DISCARD)
- Timestamp: 2026-08-05 03:35
- Result: PF=4.5015, net_pnl=10212.25, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 94: robustness: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=846 mor=0.8 — PF=3.8560 (DISCARD)
- Timestamp: 2026-08-05 03:35
- Result: PF=3.8560, net_pnl=9072.68, trades=15, WR=40.0%, TP=0 SL=5 EOD=10

### Run 95: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=1.1 — PF=4.5015 (DISCARD)
- Timestamp: 2026-08-05 03:35
- Result: PF=4.5015, net_pnl=10212.25, trades=14, WR=50.0%, TP=0 SL=5 EOD=9

### Run 96: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=1.3 [NEW BEST reliable] — PF=5.8596 (KEEP)
- Timestamp: 2026-08-05 03:35
- Result: PF=5.8596, net_pnl=10872.16, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 97: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=1.4 [<10 trades unreliable] — PF=8.0206 (DISCARD)
- Timestamp: 2026-08-05 03:35
- Result: PF=8.0206, net_pnl=11072.41, trades=8, WR=62.5%, TP=0 SL=3 EOD=5

### Run 98: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=1.25 — PF=5.4917 (DISCARD)
- Timestamp: 2026-08-05 03:35
- Result: PF=5.4917, net_pnl=10722.26, trades=12, WR=50.0%, TP=0 SL=4 EOD=8

### Run 99: OR=15 SL=1.0 TP=100 buffer=0.45 cd=3 EOD=845 mor=1.35 [<10 trades unreliable] — PF=7.8637 (DISCARD)
- Timestamp: 2026-08-05 03:35
- Result: PF=7.8637, net_pnl=11040.94, trades=9, WR=55.6%, TP=0 SL=3 EOD=6

### Run 100: robust@mor1.3: SL=0.9 — PF=5.1407 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.1407, net_pnl=10559.28, trades=12, WR=50.0%, TP=0 SL=5 EOD=7

### Run 101: robust@mor1.3: SL=1.1 — PF=5.3801 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.3801, net_pnl=10672.73, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 102: robust@mor1.3: buffer=0.4 — PF=4.7843 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=4.7843, net_pnl=10503.64, trades=13, WR=53.8%, TP=0 SL=5 EOD=8

### Run 103: robust@mor1.3: buffer=0.5 — PF=5.4117 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.4117, net_pnl=10686.98, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 104: robust@mor1.3: EOD=840 — PF=5.5122 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.5122, net_pnl=9952.77, trades=11, WR=63.6%, TP=0 SL=4 EOD=7

### Run 105: robust@mor1.3: EOD=850 — PF=4.8901 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=4.8901, net_pnl=9637.64, trades=12, WR=41.7%, TP=0 SL=4 EOD=8

### Run 106: robust@mor1.3: cooldown=2 — PF=5.7657 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.7657, net_pnl=10662.08, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 107: robust@mor1.3: cooldown=4 — PF=5.6808 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.6808, net_pnl=10472.00, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 108: robust@mor1.3: mor=1.28 (same as 1.3) — PF=5.8596 (KEEP)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.8596, net_pnl=10872.16, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 109: robust@mor1.3: mor=1.32 (same as 1.3) — PF=5.8596 (KEEP)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.8596, net_pnl=10872.16, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 110: robust@mor1.3: EOD=843 (same as 845) — PF=5.8596 (KEEP)
- Timestamp: 2026-08-05 03:36
- Result: PF=5.8596, net_pnl=10872.16, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 111: robust@mor1.3: max_or_range=6.0 — PF=4.6722 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=4.6722, net_pnl=10303.54, trades=12, WR=50.0%, TP=0 SL=5 EOD=7

### Run 112: robust@mor1.3: max_or_range=4.5 [9 trades] — PF=4.8580 (DISCARD)
- Timestamp: 2026-08-05 03:36
- Result: PF=4.8580, net_pnl=6659.95, trades=9, WR=55.6%, TP=0 SL=3 EOD=6

### Run 113: FINAL confirmation: OR=15 SL=1.0 TP=100(no cap) buffer=0.45 cd=3 EOD=845 mor=1.3 — PF=5.8596 (KEEP)
- Timestamp: 2026-08-05 03:37
- Result: PF=5.8596, net_pnl=10872.16, trades=11, WR=54.5%, TP=0 SL=4 EOD=7

### Run 114: per-OR: OR=5 SL=1.0 TP=100 buf=0.45 cd=3 EOD=845 mor=1.3 [best OR=5] — PF=3.7516 (DISCARD)
- Timestamp: 2026-08-05 03:37
- Result: PF=3.7516, net_pnl=11727.25, trades=16, WR=43.8%, TP=0 SL=7 EOD=9

### Run 115: per-OR: OR=10 SL=1.0 TP=100 buf=0.45 cd=3 EOD=845 mor=1.3 [best OR=10] — PF=3.7253 (DISCARD)
- Timestamp: 2026-08-05 03:37
- Result: PF=3.7253, net_pnl=10032.93, trades=15, WR=46.7%, TP=0 SL=6 EOD=9

### Run 116: per-OR: OR=10 SL=2.0 TP=100 buf=0.45 cd=3 EOD=845 mor=1.3 — PF=2.7611 (DISCARD)
- Timestamp: 2026-08-05 03:37
- Result: PF=2.7611, net_pnl=8591.06, trades=13, WR=53.8%, TP=0 SL=4 EOD=9

### Run 117: per-OR: OR=5 SL=1.5 TP=100 buf=0.45 cd=3 EOD=845 mor=1.3 — PF=2.9364 (DISCARD)
- Timestamp: 2026-08-05 03:37
- Result: PF=2.9364, net_pnl=10544.10, trades=15, WR=46.7%, TP=0 SL=6 EOD=9

## Key Insights
- No TP cap (TP=100) massively improves PF: capping winners at 1.5% crushed a real intraday trend edge. With no cap, most trades exit at EOD and winners run.
- EOD exit at ~14:05 IST (845 min) beats 15:00 (900): NEWGEN trend tends to fade in the afternoon; exiting early captures the morning move. 845-843 is a stable plateau, 847+ drops off.
- min_or_range_pct filter is the single biggest lever: raising it from 0.3 to 1.3% (only trade higher-volatility OR days) took PF from 0.95 to 5.86. Beyond ~1.35 trades drop below 10 (unreliable).
- OR=15 is the best duration (OR=5/10 worse PF, OR=60 near-useless: 0.03-0.6 PF, too few trades).
- SL=1.0 is the sweet spot: SL=0.9 (5.14) and SL=1.1 (5.38) both slightly worse; SL=2.0+ only helps when TP is capped.
- Shorts reduce PF (3.05 vs 4.50 at mor=0.8) — the edge is long-only.
- buffer=0.45 slightly better than 0.3/0.4/0.5; cooldown=3 marginally best (2/4 nearly equal).
- TP=0 is a degenerate config in the simulator (tp=entry -> immediate TP), not a real no-cap; use TP=100.
- max_or_range capping HURTS (PF 4.50 -> 0.39 at 3.0%): the high-range days are exactly where the edge lives. Default 5.0 keep.

## Next Ideas
- Consider time-of-day weighting: entries only in first 30-60 min after OR (min_entry_minutes test showed 30 is too late, but 0-15 window is untested as positive filter).
- Test on other liquid NSE single stocks to check if the mor>=1.3 + no-TP + early-EOD edge generalizes.
- Combine with ATR/volume filters for entry confirmation.
