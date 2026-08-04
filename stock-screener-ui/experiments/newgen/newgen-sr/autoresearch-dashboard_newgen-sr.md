# Autoresearch Dashboard: newgen-sr

**Runs:** 42 | **Kept:** 19 | **Discarded:** 23 | **Crashed:** 0
**Baseline:** profit_factor: 0.473 (#1)
**Best:** profit_factor: 480.6166 (#11, +101510.3%)

| # | commit | profit_factor | total_trades | win_rate | net_pnl | status | description |
|---|--------|---------------|--------------|----------|---------|--------|-------------|
| 1 | b63ee0a | 0.473 | 15 | 40.0 | -4536.38 | keep | baseline tf=5 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 |
| 2 | b63ee0a | 0.4024 | 12 | 41.7 | -4466.59 | discard | tf=15 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 |
| 3 | b63ee0a | 0.7627 | 5 | 40.0 | -729.54 | discard | tf=60 classic SL=2.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 shorts=0 (only 5 trades, unreliable) |
| 4 | b63ee0a | 0.3454 | 32 | 21.9 | -8662.91 | discard | tf=5 SL=1.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 |
| 5 | b63ee0a | 0.4604 | 20 | 35.0 | -5422.14 | discard | tf=5 SL=1.5 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 |
| 6 | b63ee0a | 0.6039 | 12 | 50.0 | -2669.7 | discard | tf=5 SL=2.5 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 |
| 7 | b63ee0a | 0.6235 | 11 | 54.5 | -2458.06 | discard | tf=5 SL=3.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 |
| 8 | b63ee0a | 0.865 | 9 | 66.7 | -635.2 | discard | tf=5 SL=4.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 (9 trades, unreliable) |
| 9 | b63ee0a | 1.3795 | 8 | 75.0 | 1119.87 | keep | tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=30 (8 trades, unreliable but best so far) |
| 10 | b63ee0a | 1.38 | 8 | 75.0 | 1120.89 | discard | tf=5 SL=5.0 TP=3.0 buffer=0.0 max_dist=5.0 min_entry=10:00 cd=30 (8 trades, unreliable) |
| 11 | b63ee0a | 480.6166 | 7 | 85.7 | 3448.44 | keep | tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=30 (7 trades, unreliable but huge PF) |
| 12 | b63ee0a | 455.5721 | 7 | 85.7 | 3268.37 | discard | tf=5 SL=5.0 TP=3.0 buffer=0.5 max_dist=5.0 min_entry=10:00 cd=30 (7 trades, unreliable) |
| 13 | b63ee0a | 1.8626 | 11 | 81.8 | 2562.86 | keep | tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=0 (11 trades, trustworthy) |
| 14 | b63ee0a | 1.8835 | 9 | 88.9 | 2600.87 | discard | tf=5 SL=5.0 TP=3.0 buffer=0.1 max_dist=5.0 min_entry=10:00 cd=15 (9 trades, unreliable) |
| 15 | b63ee0a | 180.832 | 10 | 90.0 | 4891.43 | keep | tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=0 (10 trades, trustworthy, BEST) |
| 16 | b63ee0a | 174.2118 | 10 | 90.0 | 4711.36 | keep | tf=5 SL=5.0 TP=3.0 buffer=0.5 max_dist=5.0 min_entry=10:00 cd=0 (10 trades) |
| 17 | b63ee0a | 99.9999 | 8 | 100.0 | 4929.44 | discard | tf=5 SL=5.0 TP=3.0 buffer=0.3 max_dist=5.0 min_entry=10:00 cd=15 (8 trades, 100% WR, unreliable) |
| 18 | b63ee0a | 1.8633 | 11 | 81.8 | 2563.88 | discard | tf=5 SL=5.0 TP=3.0 buffer=0.0 max_dist=5.0 min_entry=10:00 cd=0 (11 trades, PF similar to run13) |
| 19 | b63ee0a | 155.1831 | 10 | 90.0 | 4193.78 | discard | TP sweep: SL=5.0 TP=1.5 buffer=0.3 cd=0 (worse than TP=3.0) |
| 20 | b63ee0a | 163.7327 | 10 | 90.0 | 4426.33 | discard | TP sweep: SL=5.0 TP=2.0 buffer=0.3 cd=0 |
| 21 | b63ee0a | 197.9313 | 10 | 90.0 | 5356.53 | discard | TP sweep: SL=5.0 TP=4.0 buffer=0.3 cd=0 |
| 22 | b63ee0a | 215.0309 | 10 | 90.0 | 5821.64 | discard | TP sweep: SL=5.0 TP=5.0 buffer=0.3 cd=0 |
| 23 | b63ee0a | 300.5276 | 10 | 90.0 | 8147.15 | keep | TP sweep: SL=5.0 TP=10.0 buffer=0.3 cd=0 (monotone TP; R2 caps most, one +10% run) |
| 24 | b63ee0a | 153.5931 | 10 | 90.0 | 4150.53 | discard | max_dist sweep: SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=2.0 |
| 25 | b63ee0a | 400.079 | 14 | 92.9 | 10854.95 | keep | max_dist sweep: SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=8.0 (14 trades, BEST) |
| 26 | b63ee0a | 401.1529 | 14 | 92.9 | 10884.16 | keep | max_dist sweep: max_dist=10.0-20.0 plateau (14 trades, PF~401) |
| 27 | b63ee0a | 201.99 | 11 | 90.9 | 5466.93 | discard | min_entry sweep: min_entry=9:45 (11 trades, PF lower than 10:00) |
| 28 | b63ee0a | 154.8833 | 6 | 83.3 | 4185.63 | discard | min_entry sweep: min_entry=10:30 (6 trades, fewer) |
| 29 | b63ee0a | 3.3491 | 12 | 83.3 | 6922.48 | discard | pivot sweep: fibonacci tf5 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (PF much lower than classic) |
| 30 | b63ee0a | 99.9999 | 11 | 100.0 | 8752.77 | keep | tf sweep: classic tf15 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (11 trades, 100% WR) |
| 31 | b63ee0a | 99.9999 | 4 | 100.0 | 5243.64 | discard | tf sweep: classic tf60 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (4 trades, unreliable) |
| 32 | b63ee0a | 181.3166 | 25 | 88.0 | 12331.25 | keep | shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (25 trades, highest net) |
| 33 | b63ee0a | 92.4515 | 24 | 83.3 | 10192.27 | keep | shorts=1 tf15 SL=5.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (24 trades) |
| 34 | b63ee0a | 175.3225 | 25 | 88.0 | 11921.33 | keep | shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.5 cd=0 max_dist=10 (robust to buffer 0.5) |
| 35 | b63ee0a | 4.5198 | 26 | 84.6 | 10602.29 | discard | shorts=1 tf5 SL=5.0 TP=3.0 buffer=0.1 cd=0 max_dist=10 (buffer=0.1 breaks PF -> buffer>=0.3 critical) |
| 36 | b63ee0a | 2.956 | 13 | 84.6 | 5791.75 | discard | tf15 SL=3.0 TP=3.0 buffer=0.3 cd=0 max_dist=10 (wide SL matters at tf15 too) |
| 37 | b63ee0a | 400.5471 | 14 | 92.9 | 10867.68 | keep | ROBUST: SL=4.5 buffer=0.3 cd=0 max_dist=10 (same 14 trades as best) |
| 38 | b63ee0a | 400.5471 | 14 | 92.9 | 10867.68 | keep | ROBUST: SL=5.5 buffer=0.3 cd=0 max_dist=10 (same as best) |
| 39 | b63ee0a | 400.5471 | 14 | 92.9 | 10867.68 | keep | ROBUST: buffer=0.2 SL=5.0 cd=0 max_dist=10 (same as best) |
| 40 | b63ee0a | 393.9268 | 14 | 92.9 | 10687.61 | keep | ROBUST: buffer=0.4 SL=5.0 cd=0 max_dist=10 (PF 394) |
| 41 | b63ee0a | 401.1529 | 14 | 92.9 | 10884.16 | keep | ROBUST: max_dist=12 SL=5.0 buffer=0.3 cd=0 (PF 401) |
| 42 | b63ee0a | 330.9447 | 13 | 84.6 | 10515.34 | keep | ROBUST: min_entry=615 SL=5.0 buffer=0.3 cd=0 max_dist=10 (PF 331, 13 trades) |
