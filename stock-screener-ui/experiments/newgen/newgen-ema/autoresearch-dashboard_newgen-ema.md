# newgen-ema Autoresearch Dashboard

Goal: maximize profit_factor (higher is better) for NEWGEN EMA cross intraday.

| Run | TF | fast/slow | SL% | TP% | CD | shorts | EOD | PF | win_rate | net_pnl | trades | tp/sl/eod | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| r1 | tf=5 | fast=9 | slow=21 | sl=1.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | baseline | 1.1657 | 47.0 | 3783.54 | 66 | 16/15/35 | keep |
| r2 | tf=15 | fast=9 | slow=21 | sl=1.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | tf sweep | 1.119 | 48.1 | 1511.24 | 27 | 9/11/7 | discard |
| r3 | tf=60 | fast=9 | slow=21 | sl=1.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | tf sweep | 0.4064 | 22.2 | -4121.94 | 9 | 2/6/1 | discard |
| r4 | tf=5 | fast=5 | slow=13 | sl=1.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | pair 5/13 | 0.805 | 39.8 | -8442.09 | 93 | 21/32/40 | discard |
| r5 | tf=5 | fast=8 | slow=21 | sl=1.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | pair 8/21 | 1.0475 | 44.9 | 1220.71 | 69 | 16/18/35 | discard |
| r6 | tf=5 | fast=12 | slow=26 | sl=1.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | pair 12/26 | 1.1921 | 49.0 | 3591.29 | 51 | 13/13/25 | keep |
| r7 | tf=5 | fast=20 | slow=50 | sl=1.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | pair 20/50 | 0.6483 | 38.7 | -5414.75 | 31 | 5/13/13 | discard |
| r8 | tf=5 | fast=12 | slow=26 | sl=0.5 | tp=1.5 | cd=3 | shorts=0 | eod=885 | sl sweep | 1.0561 | 40.7 | 895.84 | 54 | 9/25/20 | discard |
| r9 | tf=5 | fast=12 | slow=26 | sl=1.5 | tp=1.5 | cd=3 | shorts=0 | eod=885 | sl sweep | 1.3808 | 53.2 | 6530.71 | 47 | 14/6/27 | keep |
| r10 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | sl sweep | 1.3809 | 53.3 | 6435.72 | 45 | 14/3/28 | keep |
| r11 | tf=5 | fast=12 | slow=26 | sl=1.0 | tp=1.0 | cd=3 | shorts=0 | eod=885 | tp sweep | 1.2688 | 54.9 | 4155.37 | 51 | 19/10/22 | discard |
| r12 | tf=5 | fast=12 | slow=26 | sl=1.0 | tp=2.0 | cd=3 | shorts=0 | eod=885 | tp sweep | 0.8574 | 42.0 | -3207.49 | 50 | 8/17/25 | discard |
| r13 | tf=5 | fast=12 | slow=26 | sl=1.0 | tp=3.0 | cd=3 | shorts=0 | eod=885 | tp sweep | 0.7409 | 40.0 | -6105.17 | 50 | 3/18/29 | discard |
| r14 | tf=5 | fast=12 | slow=26 | sl=1.0 | tp=0 | cd=3 | shorts=0 | eod=885 | tp sweep no tp | 1.1136 | 40.0 | 2677.22 | 50 | 0/18/32 | discard |
| r15 | tf=5 | fast=12 | slow=26 | sl=2.5 | tp=1.5 | cd=3 | shorts=0 | eod=885 | sl wider | 1.2685 | 53.3 | 4939.42 | 45 | 14/3/28 | discard |
| r16 | tf=5 | fast=12 | slow=26 | sl=3.0 | tp=1.5 | cd=3 | shorts=0 | eod=885 | sl wider | 1.233 | 53.3 | 4407.91 | 45 | 14/1/30 | discard |
| r17 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=885 | sl/tp combo | 1.6143 | 58.7 | 7671.57 | 46 | 20/1/25 | keep |
| r18 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=2.0 | cd=3 | shorts=0 | eod=885 | sl/tp combo | 0.8932 | 45.5 | -2489.82 | 44 | 9/6/29 | discard |
| r19 | tf=5 | fast=12 | slow=26 | sl=1.5 | tp=1.0 | cd=3 | shorts=0 | eod=885 | sl/tp combo | 1.4928 | 58.3 | 6769.29 | 48 | 20/4/24 | discard |
| r20 | tf=5 | fast=12 | slow=26 | sl=1.5 | tp=2.0 | cd=3 | shorts=0 | eod=885 | sl/tp combo | 0.9592 | 45.7 | -900.11 | 46 | 9/9/28 | discard |
| r21 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=0.75 | cd=3 | shorts=0 | eod=885 | tp tighter | 1.4212 | 61.7 | 4996.0 | 47 | 23/1/23 | discard |
| r22 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=0.5 | cd=3 | shorts=0 | eod=885 | tp tighter | 1.411 | 69.4 | 4040.2 | 49 | 33/1/15 | discard |
| r23 | tf=5 | fast=12 | slow=26 | sl=2.5 | tp=1.0 | cd=3 | shorts=0 | eod=885 | sl/tp combo | 1.5523 | 58.7 | 7172.53 | 46 | 20/1/25 | discard |
| r24 | tf=5 | fast=12 | slow=26 | sl=1.5 | tp=0.75 | cd=3 | shorts=0 | eod=885 | sl/tp combo | 1.3123 | 61.2 | 4093.72 | 49 | 23/4/22 | discard |
| r25 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=0 | shorts=0 | eod=885 | cooldown 0 | 1.6143 | 58.7 | 7671.57 | 46 | 20/1/25 | keep |
| r26 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=1 | shorts=0 | eod=885 | cooldown 1 | 1.6143 | 58.7 | 7671.57 | 46 | 20/1/25 | keep |
| r27 | tf=5 | fast=8 | slow=21 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=885 | pair resweep | 0.7819 | 46.9 | -5565.13 | 64 | 18/5/41 | discard |
| r28 | tf=5 | fast=9 | slow=21 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=885 | pair resweep | 1.1308 | 52.5 | 2418.55 | 61 | 20/2/39 | discard |
| r29 | tf=5 | fast=10 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=885 | pair resweep | 1.1965 | 56.2 | 3118.56 | 48 | 19/2/27 | discard |
| r30 | tf=5 | fast=12 | slow=30 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=885 | pair resweep | 1.3358 | 54.3 | 4442.14 | 46 | 18/2/26 | discard |
| r31 | tf=5 | fast=16 | slow=34 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=885 | pair resweep | 1.0136 | 55.8 | 225.03 | 43 | 16/4/23 | discard |
| r32 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=885 | shorts on | 1.6061 | 62.9 | 12817.84 | 70 | 35/4/31 | discard |
| r33 | tf=5 | fast=9 | slow=21 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=885 | shorts on | 1.2479 | 56.8 | 6741.24 | 81 | 34/5/42 | discard |
| r34 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=0.75 | cd=3 | shorts=1 | eod=885 | shorts tp tune | 1.4863 | 69.3 | 9995.25 | 75 | 43/5/27 | discard |
| r35 | tf=5 | fast=12 | slow=26 | sl=1.5 | tp=1.0 | cd=3 | shorts=1 | eod=885 | shorts sl tune | 1.5636 | 63.5 | 12504.15 | 74 | 35/9/30 | discard |
| r36 | tf=5 | fast=12 | slow=26 | sl=2.5 | tp=1.0 | cd=3 | shorts=1 | eod=885 | shorts sl tune | 1.5637 | 62.9 | 12244.21 | 70 | 35/3/32 | discard |
| r37 | tf=15 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=885 | tf15 best sl/tp | 0.5722 | 44.4 | -4624.51 | 18 | 6/2/10 | discard |
| r38 | tf=15 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=885 | tf15 shorts | 0.717 | 47.1 | -4697.28 | 34 | 12/3/19 | discard |
| r39 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=870 | eod 870 | 1.7602 | 59.5 | 8423.53 | 42 | 20/1/21 | keep |
| r40 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=900 | eod 900 | 1.4662 | 56.9 | 6825.09 | 51 | 21/1/29 | discard |
| r41 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=855 | eod 855 | 1.7953 | 61.9 | 8673.41 | 42 | 19/1/22 | keep |
| r42 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=0 | eod=840 | eod 840 | 1.5224 | 60.5 | 6418.59 | 38 | 18/0/20 | discard |
| r43 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=870 | shorts eod 870 | 1.8101 | 68.1 | 15010.68 | 69 | 33/4/32 | keep |
| r44 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | shorts eod 855 | 1.9605 | 65.7 | 15646.02 | 67 | 29/4/34 | keep |
| r45 | tf=5 | fast=12 | slow=26 | sl=1.5 | tp=1.0 | cd=3 | shorts=0 | eod=870 | sl tune eod870 | 1.6378 | 60.5 | 7623.04 | 43 | 20/4/19 | discard |
| r46 | tf=5 | fast=12 | slow=26 | sl=2.5 | tp=1.0 | cd=3 | shorts=0 | eod=870 | sl tune eod870 | 1.6843 | 59.5 | 7924.49 | 42 | 20/1/21 | discard |
| r47 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=840 | shorts eod 840 | 1.7498 | 68.8 | 13100.91 | 64 | 28/3/33 | discard |
| r48 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=825 | shorts eod 825 | 1.8063 | 66.7 | 12723.58 | 63 | 27/3/33 | discard |
| r49 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=810 | shorts eod 810 | 1.7554 | 66.7 | 12106.32 | 63 | 27/3/33 | discard |
| r50 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.25 | cd=3 | shorts=1 | eod=855 | shorts tp 1.25 | 1.6079 | 60.0 | 13056.33 | 65 | 25/6/34 | discard |
| r51 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=0.75 | cd=3 | shorts=1 | eod=855 | shorts tp 0.75 | 1.5964 | 70.0 | 10566.47 | 70 | 38/5/27 | discard |
| r52 | tf=5 | fast=12 | slow=26 | sl=1.5 | tp=1.0 | cd=3 | shorts=1 | eod=855 | shorts sl 1.5 | 1.9106 | 65.7 | 15384.0 | 70 | 29/8/33 | discard |
| r53 | tf=5 | fast=10 | slow=21 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | pair resweep2 | 1.7247 | 69.9 | 14460.93 | 73 | 31/5/37 | discard |
| r54 | tf=5 | fast=8 | slow=21 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | pair resweep2 | 1.6222 | 64.1 | 13857.42 | 78 | 32/6/40 | discard |
| r55 | tf=5 | fast=9 | slow=21 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | pair resweep2 | 1.6679 | 66.7 | 13917.42 | 75 | 31/5/39 | discard |
| r56 | tf=5 | fast=12 | slow=30 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | pair resweep2 | 1.769 | 61.5 | 12464.25 | 65 | 27/4/34 | discard |
| r57 | tf=5 | fast=10 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | pair resweep2 | 1.7238 | 66.2 | 13335.86 | 68 | 29/4/35 | discard |
| r58 | tf=5 | fast=16 | slow=34 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | pair resweep2 | 1.1508 | 58.7 | 3343.28 | 63 | 24/7/32 | discard |
| r59 | tf=5 | fast=12 | slow=26 | sl=2.25 | tp=1.0 | cd=3 | shorts=1 | eod=855 | fine sl 2.25 | 1.9742 | 65.7 | 15758.93 | 67 | 29/3/35 | keep |
| r60 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=855 | fine sl 1.75 | 2.0884 | 65.7 | 16643.98 | 67 | 29/4/34 | keep |
| r61 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=0.9 | cd=3 | shorts=1 | eod=855 | fine tp 0.9 | 1.9305 | 67.6 | 14845.04 | 68 | 33/4/31 | discard |
| r62 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.1 | cd=3 | shorts=1 | eod=855 | fine tp 1.1 | 1.4338 | 60.0 | 9316.92 | 65 | 25/6/34 | discard |
| r63 | tf=15 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | tf15 winner | 0.7316 | 45.2 | -4126.34 | 31 | 12/3/16 | discard |
| r64 | tf=15 | fast=9 | slow=21 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | tf15 9/21 | 0.6849 | 51.2 | -6942.13 | 41 | 15/6/20 | discard |
| r65 | tf=60 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=855 | tf60 winner | 0.7355 | 50.0 | -1765.09 | 12 | 5/2/5 | discard |
| r66 | tf=5 | fast=12 | slow=26 | sl=1.6 | tp=1.0 | cd=3 | shorts=1 | eod=855 | fine sl 1.6 | 1.8149 | 65.2 | 14419.35 | 69 | 29/8/32 | discard |
| r67 | tf=5 | fast=12 | slow=26 | sl=1.7 | tp=1.0 | cd=3 | shorts=1 | eod=855 | fine sl 1.7 | 2.067 | 65.7 | 16485.5 | 67 | 29/5/33 | discard |
| r68 | tf=5 | fast=12 | slow=26 | sl=1.8 | tp=1.0 | cd=3 | shorts=1 | eod=855 | fine sl 1.8 | 2.0615 | 65.7 | 16444.38 | 67 | 29/4/34 | discard |
| r69 | tf=5 | fast=12 | slow=26 | sl=1.9 | tp=1.0 | cd=3 | shorts=1 | eod=855 | fine sl 1.9 | 2.0098 | 65.7 | 16045.2 | 67 | 29/4/34 | discard |
| r70 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=0 | shorts=1 | eod=855 | cd 0 | 2.0884 | 65.7 | 16643.98 | 67 | 29/4/34 | keep |
| r71 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=1 | shorts=1 | eod=855 | cd 1 | 2.0884 | 65.7 | 16643.98 | 67 | 29/4/34 | keep |
| r72 | tf=5 | fast=11 | slow=24 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=855 | perturb pair | 1.4935 | 64.4 | 10635.13 | 73 | 29/7/37 | discard |
| r73 | tf=5 | fast=13 | slow=28 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=855 | perturb pair | 1.9004 | 63.1 | 13728.63 | 65 | 27/4/34 | discard |
| r74 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=0.95 | cd=3 | shorts=1 | eod=855 | perturb tp | 2.1097 | 67.6 | 16597.17 | 68 | 31/4/33 | keep |
| r75 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.05 | cd=3 | shorts=1 | eod=855 | perturb tp | 1.6277 | 62.1 | 11894.93 | 66 | 27/6/33 | discard |
| r76 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=850 | perturb eod | 2.1622 | 70.1 | 16946.78 | 67 | 29/4/34 | keep |
| r77 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=860 | perturb eod | 1.9005 | 64.2 | 15039.59 | 67 | 29/4/34 | discard |
| r78 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=5 | shorts=1 | eod=855 | perturb cd | 2.0884 | 65.7 | 16643.98 | 67 | 29/4/34 | discard |
| r79 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=845 | eod 845 | 1.7746 | 68.2 | 13439.72 | 66 | 29/4/33 | discard |
| r80 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=840 | eod 840 | 1.8281 | 68.8 | 13849.34 | 64 | 28/3/33 | discard |
| r81 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=830 | eod 830 | 1.9255 | 71.4 | 13859.69 | 63 | 27/3/33 | discard |
| r82 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=0.95 | cd=3 | shorts=1 | eod=850 | tp 0.95 eod850 | 2.1607 | 71.6 | 16644.39 | 67 | 31/4/32 | discard |
| r83 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=0.95 | cd=3 | shorts=1 | eod=845 | tp 0.95 eod845 | 1.7571 | 69.7 | 13016.83 | 66 | 30/4/32 | discard |
| r84 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=850 | recheck eod850 | 2.1622 | 70.1 | 16946.78 | 67 | 29/4/34 | keep |
| r85 | tf=5 | fast=12 | slow=24 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=850 | robust pair | 1.6958 | 68.6 | 13316.73 | 70 | 30/7/33 | discard |
| r86 | tf=5 | fast=11 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=850 | robust pair | 1.6707 | 68.1 | 12795.92 | 69 | 29/7/33 | discard |
| r87 | tf=5 | fast=14 | slow=30 | sl=1.75 | tp=1.0 | cd=3 | shorts=1 | eod=850 | robust pair | 1.7076 | 60.3 | 11148.24 | 63 | 26/5/32 | discard |
| r88 | tf=5 | fast=12 | slow=26 | sl=1.5 | tp=1.0 | cd=3 | shorts=1 | eod=850 | robust sl | 1.9769 | 70.0 | 15793.7 | 70 | 29/8/33 | discard |
| r89 | tf=5 | fast=12 | slow=26 | sl=2.0 | tp=1.0 | cd=3 | shorts=1 | eod=850 | robust sl | 2.0237 | 70.1 | 15948.82 | 67 | 29/4/34 | discard |
| r90 | tf=5 | fast=12 | slow=26 | sl=1.75 | tp=1.0 | cd=3 | shorts=0 | eod=850 | robust shorts off | 1.7907 | 61.0 | 8418.66 | 41 | 19/1/21 | discard |
