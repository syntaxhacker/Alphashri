
### Run 1: baseline tf=5 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 — PF=0.473 (keep)
- metrics: WR=40.0% net=-4536.38 trades=15 TP=7 SL=8 EOD=0

### Run 2: tf=15 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 — PF=0.4024 (discard)
- metrics: WR=41.7% net=-4466.59 trades=12 TP=5 SL=7 EOD=0

### Run 3: tf=60 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 (only 5 trades, unreliable) — PF=0.7627 (discard)
- metrics: WR=40.0% net=-729.54 trades=5 TP=2 SL=3 EOD=0

### Run 4: tf=5 SL=1.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 — PF=0.3454 (discard)
- metrics: WR=21.9% net=-8662.91 trades=32 TP=8 SL=24 EOD=0

### Run 5: tf=5 SL=1.5 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 — PF=0.4604 (discard)
- metrics: WR=35.0% net=-5422.14 trades=20 TP=8 SL=12 EOD=0

### Run 6: tf=5 SL=2.5 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 — PF=0.6039 (discard)
- metrics: WR=50.0% net=-2669.7 trades=12 TP=7 SL=5 EOD=0

### Run 7: tf=5 SL=3.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 — PF=0.6235 (discard)
- metrics: WR=54.5% net=-2458.06 trades=11 TP=7 SL=4 EOD=0

### Run 8: tf=5 SL=4.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 (9 trades, unreliable) — PF=0.865 (discard)
- metrics: WR=66.7% net=-635.2 trades=9 TP=7 SL=2 EOD=0

### Run 9: tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 (8 trades, unreliable but best so far) — PF=1.3795 (keep)
- metrics: WR=75.0% net=1119.87 trades=8 TP=7 SL=1 EOD=0

### Run 10: tf=5 SL=5.0 TP=3.0 buffer=0.0 max_dist=5.0 min_entry=10:00 cd=30 (8 trades, unreliable) — PF=1.38 (discard)
- metrics: WR=75.0% net=1120.89 trades=8 TP=7 SL=1 EOD=0

### Run 11: tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=30 (7 trades, unreliable but huge PF) — PF=480.6166 (keep)
- metrics: WR=85.7% net=3448.44 trades=7 TP=7 SL=0 EOD=0

### Run 12: tf=5 SL=5.0 TP=3.0 buffer=0.5 max_dist=5.0 min_entry=10:00 cd=30 (7 trades, unreliable) — PF=455.5721 (discard)
- metrics: WR=85.7% net=3268.37 trades=7 TP=7 SL=0 EOD=0

### Run 13: tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=0 (11 trades, trustworthy) — PF=1.8626 (keep)
- metrics: WR=81.8% net=2562.86 trades=11 TP=10 SL=1 EOD=0

### Run 14: tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=15 (9 trades, unreliable) — PF=1.8835 (discard)
- metrics: WR=88.9% net=2600.87 trades=9 TP=8 SL=1 EOD=0

### Run 15: tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=0 (10 trades, trustworthy, BEST) — PF=180.832 (keep)
- metrics: WR=90.0% net=4891.43 trades=10 TP=10 SL=0 EOD=0

### Run 16: tf=5 SL=5.0 TP=3.0 buffer=0.5 max_dist=5.0 min_entry=10:00 cd=0 (10 trades) — PF=174.2118 (keep)
- metrics: WR=90.0% net=4711.36 trades=10 TP=10 SL=0 EOD=0

### Run 17: tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=15 (8 trades, 100% WR, unreliable) — PF=99.9999 (discard)
- metrics: WR=100.0% net=4929.44 trades=8 TP=8 SL=0 EOD=0

### Run 18: tf=5 SL=5.0 TP=3.0 buffer=0.0 max_dist=5.0 min_entry=10:00 cd=0 (11 trades, PF similar to run13) — PF=1.8633 (discard)
- metrics: WR=81.8% net=2563.88 trades=11 TP=10 SL=1 EOD=0

### Run 19: TP sweep: SL=5.0 TP=1.5 buffer=0.3 cd=0 (worse than TP=3.0) — PF=155.1831 (discard)
- metrics: WR=90.0% net=4193.78 trades=10 TP=10 SL=0 EOD=0

### Run 20: TP sweep: SL=5.0 TP=2.0 buffer=0.3 cd=0 — PF=163.7327 (discard)
- metrics: WR=90.0% net=4426.33 trades=10 TP=10 SL=0 EOD=0

### Run 21: TP sweep: SL=5.0 TP=4.0 buffer=0.3 cd=0 — PF=197.9313 (discard)
- metrics: WR=90.0% net=5356.53 trades=10 TP=10 SL=0 EOD=0

### Run 22: TP sweep: SL=5.0 TP=5.0 buffer=0.3 cd=0 — PF=215.0309 (discard)
- metrics: WR=90.0% net=5821.64 trades=10 TP=10 SL=0 EOD=0

### Run 23: TP sweep: SL=5.0 TP=10.0 buffer=0.3 cd=0 (monotone TP; R2 caps most, one +10% run) — PF=300.5276 (keep)
- metrics: WR=90.0% net=8147.15 trades=10 TP=10 SL=0 EOD=0

### Run 24: max_dist sweep: SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=2.0 — PF=153.5931 (discard)
- metrics: WR=90.0% net=4150.53 trades=10 TP=10 SL=0 EOD=0

### Run 25: max_dist sweep: SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=8.0 (14 trades, BEST) — PF=400.079 (keep)
- metrics: WR=92.9% net=10854.95 trades=14 TP=14 SL=0 EOD=0

### Run 26: max_dist sweep: max_dist=10.0-20.0 plateau (14 trades, PF~401) — PF=401.1529 (keep)
- metrics: WR=92.9% net=10884.16 trades=14 TP=14 SL=0 EOD=0

### Run 27: min_entry sweep: min_entry=9:45 (11 trades, PF lower than 10:00) — PF=201.99 (discard)
- metrics: WR=90.9% net=5466.93 trades=11 TP=11 SL=0 EOD=0

### Run 28: min_entry sweep: min_entry=10:30 (6 trades, fewer) — PF=154.8833 (discard)
- metrics: WR=83.3% net=4185.63 trades=6 TP=6 SL=0 EOD=0

### Run 29: pivot sweep: fibonacci tf5 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (PF much lower than classic) — PF=3.3491 (discard)
- metrics: WR=83.3% net=6922.48 trades=12 TP=11 SL=1 EOD=0

### Run 30: tf sweep: classic tf15 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (11 trades, 100% WR) — PF=99.9999 (keep)
- metrics: WR=100.0% net=8752.77 trades=11 TP=11 SL=0 EOD=0

### Run 31: tf sweep: classic tf60 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (4 trades, unreliable) — PF=99.9999 (discard)
- metrics: WR=100.0% net=5243.64 trades=4 TP=4 SL=0 EOD=0

### Run 32: shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (25 trades, highest net) — PF=181.3166 (keep)
- metrics: WR=88.0% net=12331.25 trades=25 TP=25 SL=0 EOD=0

### Run 33: shorts=1 tf15 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (24 trades) — PF=92.4515 (keep)
- metrics: WR=83.3% net=10192.27 trades=24 TP=24 SL=0 EOD=0

### Run 34: shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.5 cd=0 max_dist=10 (robust to buffer 0.5) — PF=175.3225 (keep)
- metrics: WR=88.0% net=11921.33 trades=25 TP=25 SL=0 EOD=0

### Run 35: shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.1 cd=0 max_dist=10 (buffer=0.1 breaks PF -> buffer>=0.3 critical) — PF=4.5198 (discard)
- metrics: WR=84.6% net=10602.29 trades=26 TP=25 SL=1 EOD=0

### Run 36: tf15 SL=3.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (wide SL matters at tf15 too) — PF=2.956 (discard)
- metrics: WR=84.6% net=5791.75 trades=13 TP=11 SL=2 EOD=0

### Run 37: ROBUST: SL=4.5 buffer=0.3 cd=0 max_dist=10 (same 14 trades as best) — PF=400.5471 (keep)
- metrics: WR=92.9% net=10867.68 trades=14 TP=14 SL=0 EOD=0

### Run 38: ROBUST: SL=5.5 buffer=0.3 cd=0 max_dist=10 (same as best) — PF=400.5471 (keep)
- metrics: WR=92.9% net=10867.68 trades=14 TP=14 SL=0 EOD=0

### Run 39: ROBUST: buffer=0.2 SL=5.0 cd=0 max_dist=10 (same as best) — PF=400.5471 (keep)
- metrics: WR=92.9% net=10867.68 trades=14 TP=14 SL=0 EOD=0

### Run 40: ROBUST: buffer=0.4 SL=5.0 cd=0 max_dist=10 (PF 394) — PF=393.9268 (keep)
- metrics: WR=92.9% net=10687.61 trades=14 TP=14 SL=0 EOD=0

### Run 41: ROBUST: max_dist=12 SL=5.0 buffer=0.3 cd=0 (PF 401) — PF=401.1529 (keep)
- metrics: WR=92.9% net=10884.16 trades=14 TP=14 SL=0 EOD=0

### Run 42: ROBUST: min_entry=615 SL=5.0 buffer=0.3 cd=0 max_dist=10 (PF 331, 13 trades) — PF=330.9447 (keep)
- metrics: WR=84.6% net=10515.34 trades=13 TP=13 SL=0 EOD=0

## Summary
- Best trustworthy config (run 26): tf=5 classic SL=5.0 TP=3.0 buffer=0.3 max_dist=10.0 min_entry=10:00 cd=0 shorts=0 → PF=401.2, 14 trades, WR=92.9%, net=₹10,884. Robust to SL/buffer/max_dist perturbations.
- Best per tf: tf=5 PF=401 (14t); tf=15 PF=99.9999 100% WR (11t, net=₹8,753); tf=60 PF=99.9999 but only 4t (unreliable).
- Shorts variant: tf5 shorts=1 → PF=181, 25t, net=₹12,331 (highest net, more trades).
- Key levers: wide SL (5% >> 1%), buffer>=0.3%, cooldown=0, classic>fibonacci. Baseline (SL=2, buffer=0.1) was a strong loser (PF=0.47).
