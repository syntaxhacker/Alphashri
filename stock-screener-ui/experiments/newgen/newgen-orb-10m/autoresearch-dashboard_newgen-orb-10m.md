# Autoresearch Dashboard: newgen-orb-10m

**Runs:** 72 | **Kept:** 18 | **Discarded:** 54 | **Crashed:** 0
**Baseline:** profit_factor: 0.954 (#1)
**Best:** profit_factor: 21.8613 (#51, +2191.5%)

> **Note:** Best TRUSTWORTHY config (>=10 trades) is run #47 (PF 8.237, 10 trades, net Rs9886.5).
> Runs #50/#51 (PF 18-22) have only 9 trades - below the 10-trade trust threshold, logged but not selected.

| # | commit | PF | win_rate | net_pnl | trades | status | description |
|---|--------|-----|----------|---------|--------|--------|-------------|
| 1 | b63ee0a | 0.954 | 38.9% | ₹-486.24 | 36 | keep | baseline OR15 SL1.0 TP1.5 buf0.3 cool1 shorts0 EOD900 minOR0.3 [or_min=15 sl=1.0 tp=1.5 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 2 | b63ee0a | 1.1336 | 44.4% | ₹2006.05 | 54 | keep | OR sweep 5m [or_min=5 sl=1.0 tp=1.5 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 3 | b63ee0a | 1.1336 | 44.4% | ₹2006.05 | 54 | discard | OR sweep 10m [or_min=10 sl=1.0 tp=1.5 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 4 | b63ee0a | 0.4679 | 27.3% | ₹-1702.02 | 11 | discard | OR sweep 60m [or_min=60 sl=1.0 tp=1.5 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 5 | b63ee0a | 1.0449 | 30.3% | ₹700.86 | 76 | discard | SL sweep 0.5 @OR5 [or_min=5 sl=0.5 tp=1.5 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 6 | b63ee0a | 1.0517 | 38.5% | ₹838.49 | 65 | discard | SL sweep 0.75 @OR5 [or_min=5 sl=0.75 tp=1.5 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 7 | b63ee0a | 1.1823 | 50.0% | ₹2524.45 | 48 | keep | SL sweep 1.25 @OR5 [or_min=5 sl=1.25 tp=1.5 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 8 | b63ee0a | 1.0995 | 51.1% | ₹1412.42 | 45 | discard | SL sweep 1.5 @OR5 [or_min=5 sl=1.5 tp=1.5 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 9 | b63ee0a | 0.795 | 51.8% | ₹-3306.56 | 56 | discard | TP sweep 1.0 @OR5/SL1.25 [or_min=5 sl=1.25 tp=1.0 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 10 | b63ee0a | 1.2318 | 47.7% | ₹3168.44 | 44 | keep | TP sweep 2.0 @OR5/SL1.25 [or_min=5 sl=1.25 tp=2.0 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 11 | b63ee0a | 1.0608 | 41.2% | ₹715.46 | 34 | discard | TP sweep 3.0 @OR5/SL1.25 [or_min=5 sl=1.25 tp=3.0 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 12 | b63ee0a | 0.0 | 0.0% | ₹-9699.35 | 163 | discard | TP sweep 0 (no TP) @OR5/SL1.25 [or_min=5 sl=1.25 tp=0.0 buffer=0.3 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 13 | b63ee0a | 1.0859 | 45.3% | ₹1444.86 | 53 | discard | buffer sweep 0.0 @OR5/SL1.25/TP2 [or_min=5 sl=1.25 tp=2.0 buffer=0.0 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 14 | b63ee0a | 1.4231 | 51.2% | ₹5006.74 | 41 | keep | buffer sweep 0.5 @OR5/SL1.25/TP2 [or_min=5 sl=1.25 tp=2.0 buffer=0.5 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 15 | b63ee0a | 1.4677 | 53.1% | ₹4560.59 | 32 | keep | buffer sweep 1.0 @OR5/SL1.25/TP2 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 16 | b63ee0a | 1.2273 | 48.0% | ₹1927.74 | 25 | discard | buffer probe 1.5 @OR5/SL1.25/TP2 [or_min=5 sl=1.25 tp=2.0 buffer=1.5 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 17 | b63ee0a | 1.093 | 47.8% | ₹798.85 | 23 | discard | buffer probe 2.0 @OR5/SL1.25/TP2 [or_min=5 sl=1.25 tp=2.0 buffer=2.0 cooldown=1 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 18 | b63ee0a | 1.4677 | 53.1% | ₹4560.59 | 32 | discard | cooldown 0 @OR5/SL1.25/TP2/buf1 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=0 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 19 | b63ee0a | 1.2729 | 50.0% | ₹2639.5 | 30 | discard | cooldown 2 @OR5/SL1.25/TP2/buf1 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=2 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 20 | b63ee0a | 1.2896 | 46.2% | ₹2425.93 | 26 | discard | cooldown 3 @OR5/SL1.25/TP2/buf1 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=3 shorts=False eod=900 min_or_range=0.3 max_or_range=5.0] |
| 21 | b63ee0a | 1.2049 | 46.0% | ₹2857.42 | 50 | discard | shorts ON @OR5/SL1.25/TP2/buf1/cool1 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=True eod=900 min_or_range=0.3 max_or_range=5.0] |
| 22 | b63ee0a | 1.4922 | 50.0% | ₹4138.55 | 28 | keep | EOD 870 @OR5/SL1.25/TP2/buf1/cool1 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=870 min_or_range=0.3 max_or_range=5.0] |
| 23 | b63ee0a | 1.5687 | 55.2% | ₹4892.8 | 29 | keep | EOD 885 @OR5/SL1.25/TP2/buf1/cool1 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=885 min_or_range=0.3 max_or_range=5.0] |
| 24 | b63ee0a | 1.6833 | 51.9% | ₹4993.55 | 27 | keep | EOD 855 @OR5/SL1.25/TP2/buf1/cool1 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=0.3 max_or_range=5.0] |
| 25 | b63ee0a | 1.6739 | 48.1% | ₹4908.61 | 27 | discard | EOD 840 @OR5/SL1.25/TP2/buf1/cool1 [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=840 min_or_range=0.3 max_or_range=5.0] |
| 26 | b63ee0a | 1.6833 | 51.9% | ₹4993.55 | 27 | discard | minOR 0.2 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=0.2 max_or_range=5.0] |
| 27 | b63ee0a | 1.6833 | 51.9% | ₹4993.55 | 27 | discard | minOR 0.5 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=0.5 max_or_range=5.0] |
| 28 | b63ee0a | 1.8344 | 53.8% | ₹5595.62 | 26 | keep | minOR 0.8 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=0.8 max_or_range=5.0] |
| 29 | b63ee0a | 1.8344 | 53.8% | ₹5595.62 | 26 | discard | minOR 1.0 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=1.0 max_or_range=5.0] |
| 30 | b63ee0a | 2.1336 | 57.1% | ₹5997.83 | 21 | keep | minOR 1.5 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=1.5 max_or_range=5.0] |
| 31 | b63ee0a | 2.1336 | 57.1% | ₹5997.83 | 21 | discard | minOR 2.0 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.0 max_or_range=5.0] |
| 32 | b63ee0a | 2.7359 | 60.0% | ₹5702.12 | 15 | keep | minOR 2.5 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 33 | b63ee0a | 2.7359 | 60.0% | ₹5702.12 | 15 | discard | minOR 3.0 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=3.0 max_or_range=5.0] |
| 34 | b63ee0a | 1.4615 | 50.0% | ₹1159.58 | 8 | discard | minOR 4.0 @best [or_min=5 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=4.0 max_or_range=5.0] |
| 35 | b63ee0a | 2.0353 | 50.0% | ₹4087.53 | 16 | discard | SL 1.0 @minOR2.5 [or_min=5 sl=1.0 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 36 | b63ee0a | 3.9471 | 69.2% | ₹6714.0 | 13 | keep | SL 1.5 @minOR2.5 [or_min=5 sl=1.5 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 37 | b63ee0a | 2.3444 | 57.1% | ₹5303.44 | 14 | discard | TP 2.5 @minOR2.5 [or_min=5 sl=1.25 tp=2.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 38 | b63ee0a | 2.8087 | 66.7% | ₹4756.89 | 15 | discard | TP 1.5 @minOR2.5 [or_min=5 sl=1.25 tp=1.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 39 | b63ee0a | 3.5224 | 69.2% | ₹6439.36 | 13 | discard | SL 1.75 @minOR2.5/TP2 [or_min=5 sl=1.75 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 40 | b63ee0a | 5.4509 | 75.0% | ₹7349.31 | 12 | keep | SL 2.0 @minOR2.5/TP2 [or_min=5 sl=2.0 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 41 | b63ee0a | 3.5767 | 72.7% | ₹6667.27 | 11 | discard | SL 1.5 TP2.5 @minOR2.5 [or_min=5 sl=1.5 tp=2.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 42 | b63ee0a | 7.1057 | 80.0% | ₹8341.03 | 10 | keep | SL 1.5 TP3 @minOR2.5 [or_min=5 sl=1.5 tp=3.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 43 | b63ee0a | 5.933 | 80.0% | ₹8071.01 | 10 | discard | SL2.0 TP3 @minOR2.5 [or_min=5 sl=2.0 tp=3.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 44 | b63ee0a | 4.6361 | 80.0% | ₹7258.6 | 10 | discard | SL2.0 TP2.5 @minOR2.5 [or_min=5 sl=2.0 tp=2.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 45 | b63ee0a | 6.4666 | 80.0% | ₹8206.02 | 10 | discard | SL1.75 TP3 @minOR2.5 [or_min=5 sl=1.75 tp=3.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 46 | b63ee0a | 4.6847 | 75.0% | ₹7079.28 | 12 | discard | SL2.5 TP2 @minOR2.5 [or_min=5 sl=2.5 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 47 | b63ee0a | 8.237 | 80.0% | ₹9886.5 | 10 | keep | SL1.5 TP3.5 @minOR2.5 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 48 | b63ee0a | 6.4324 | 77.8% | ₹9183.31 | 9 | discard | SL1.5 TP4 @minOR2.5 [or_min=5 sl=1.5 tp=4.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 49 | b63ee0a | 4.2862 | 72.7% | ₹7437.08 | 11 | discard | SL1.5 TP3 buf0.5 @minOR2.5 [or_min=5 sl=1.5 tp=3.0 buffer=0.5 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 50 | b63ee0a | 18.7624 | 88.9% | ₹8858.27 | 9 | keep | SL1.5 TP3 buf1.5 @minOR2.5 [or_min=5 sl=1.5 tp=3.0 buffer=1.5 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 51 | b63ee0a | 21.8613 | 88.9% | ₹10403.74 | 9 | keep | SL1.5 TP3.5 buf1.5 @minOR2.5 [or_min=5 sl=1.5 tp=3.5 buffer=1.5 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 52 | b63ee0a | 6.8494 | 80.0% | ₹7990.88 | 10 | discard | SL1.5 TP3 buf1.2 @minOR2.5 [or_min=5 sl=1.5 tp=3.0 buffer=1.2 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 53 | b63ee0a | 7.9807 | 80.0% | ₹9536.35 | 10 | discard | SL1.5 TP3.5 buf1.2 @minOR2.5 [or_min=5 sl=1.5 tp=3.5 buffer=1.2 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 54 | b63ee0a | 5.2568 | 71.4% | ₹10829.5 | 14 | discard | SL1.5 TP3.5 buf1 minOR2.0 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.0 max_or_range=5.0] |
| 55 | b63ee0a | 8.237 | 80.0% | ₹9886.5 | 10 | discard | SL1.5 TP3.5 buf1 minOR3.0 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=3.0 max_or_range=5.0] |
| 56 | b63ee0a | 5.2959 | 71.4% | ₹11079.35 | 14 | discard | SL1.5 TP3.5 buf1 minOR1.5 EOD840 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=840 min_or_range=1.5 max_or_range=5.0] |
| 57 | b63ee0a | 8.1329 | 80.0% | ₹10136.34 | 10 | discard | SL1.5 TP3.5 buf1 minOR2.5 EOD840 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=840 min_or_range=2.5 max_or_range=5.0] |
| 58 | b63ee0a | 4.2994 | 70.0% | ₹8687.27 | 10 | discard | SL1.5 TP3.5 buf1 minOR2.5 EOD870 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=870 min_or_range=2.5 max_or_range=5.0] |
| 59 | b63ee0a | 4.1798 | 70.0% | ₹8372.47 | 10 | discard | SL1.5 TP3.5 buf1 minOR2.5 EOD885 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=885 min_or_range=2.5 max_or_range=5.0] |
| 60 | b63ee0a | 8.237 | 80.0% | ₹9886.5 | 10 | discard | SL1.5 TP3.5 buf1 minOR2.5 EOD850 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=850 min_or_range=2.5 max_or_range=5.0] |
| 61 | b63ee0a | 7.4349 | 70.0% | ₹9386.81 | 10 | discard | SL1.5 TP3.5 buf1 minOR2.5 EOD860 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=860 min_or_range=2.5 max_or_range=5.0] |
| 62 | b63ee0a | 6.1983 | 70.0% | ₹9145.34 | 10 | discard | robustness cooldown2 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=2 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 63 | b63ee0a | 3.0202 | 53.3% | ₹7526.84 | 15 | discard | robustness shorts ON [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=True eod=855 min_or_range=2.5 max_or_range=5.0] |
| 64 | b63ee0a | 4.964 | 72.7% | ₹8970.84 | 11 | discard | robustness buf0.8 [or_min=5 sl=1.5 tp=3.5 buffer=0.8 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 65 | b63ee0a | 7.9807 | 80.0% | ₹9536.35 | 10 | discard | robustness buf1.25 [or_min=5 sl=1.5 tp=3.5 buffer=1.25 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 66 | b63ee0a | 8.237 | 80.0% | ₹9886.5 | 10 | discard | tuned params OR10 [or_min=10 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 67 | b63ee0a | 1.571 | 44.4% | ₹2161.23 | 9 | discard | tuned params OR15 [or_min=15 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 68 | b63ee0a | 0.0 | 0.0% | ₹-919.71 | 1 | discard | tuned params OR60 [or_min=60 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 69 | b63ee0a | 0.9763 | 44.4% | ₹-155.99 | 18 | discard | OR15 SL1.25 TP2 buf1 minOR0.3 [or_min=15 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=0.3 max_or_range=5.0] |
| 70 | b63ee0a | 0.0 | 0.0% | ₹-2315.47 | 4 | discard | OR60 SL1.25 TP2 buf1 minOR0.3 [or_min=60 sl=1.25 tp=2.0 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=0.3 max_or_range=5.0] |
| 71 | b63ee0a | 8.237 | 80.0% | ₹9886.5 | 10 | discard | OR5 best config TP3.5 minOR2.5 cooldown0 [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=0 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
| 72 | b63ee0a | 8.237 | 80.0% | ₹9886.5 | 10 | discard | final best verification run [or_min=5 sl=1.5 tp=3.5 buffer=1.0 cooldown=1 shorts=False eod=855 min_or_range=2.5 max_or_range=5.0] |
