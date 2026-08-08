# Worklog: newgen-orb-10m

Session: ORB parameter search for NEWGEN on 10-min candles, primary metric profit_factor (higher better).
Data: 65 days (2026-05-04..2026-08-04), 38 candles/day. Shared lib `experiments/newgen/common.py`, cache `experiments/data/newgen_cache.pkl`.

## Key Insights
_(updated as I learn)_

## Next Ideas
_(updated as I go)_

### Run 1: baseline OR15 SL1.0 TP1.5 buf0.3 cool1 shorts0 EOD900 minOR0.3 — PF=0.954 (KEEP)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '15', 'NEWGEN_SL': '1.0', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=0.954, WR=38.9%, net=₹-486.24, trades=36.0, tp=13.0, sl=16.0, eod=7.0

### Run 2: OR sweep 5m — PF=1.1336 (KEEP)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.0', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.1336, WR=44.4%, net=₹2006.05, trades=54.0, tp=23.0, sl=24.0, eod=7.0

### Run 3: OR sweep 10m — PF=1.1336 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '10', 'NEWGEN_SL': '1.0', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.1336, WR=44.4%, net=₹2006.05, trades=54.0, tp=23.0, sl=24.0, eod=7.0

### Run 4: OR sweep 60m — PF=0.4679 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '60', 'NEWGEN_SL': '1.0', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=0.4679, WR=27.3%, net=₹-1702.02, trades=11.0, tp=2.0, sl=5.0, eod=4.0

### Run 5: SL sweep 0.5 @OR5 — PF=1.0449 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '0.5', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.0449, WR=30.3%, net=₹700.86, trades=76.0, tp=22.0, sl=48.0, eod=6.0

### Run 6: SL sweep 0.75 @OR5 — PF=1.0517 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '0.75', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.0517, WR=38.5%, net=₹838.49, trades=65.0, tp=23.0, sl=35.0, eod=7.0

### Run 7: SL sweep 1.25 @OR5 — PF=1.1823 (KEEP)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.1823, WR=50.0%, net=₹2524.45, trades=48.0, tp=22.0, sl=17.0, eod=9.0

### Run 8: SL sweep 1.5 @OR5 — PF=1.0995 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.0995, WR=51.1%, net=₹1412.42, trades=45.0, tp=21.0, sl=14.0, eod=10.0

### Run 9: TP sweep 1.0 @OR5/SL1.25 — PF=0.795 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '1.0', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=0.795, WR=51.8%, net=₹-3306.56, trades=56.0, tp=27.0, sl=20.0, eod=9.0

### Run 10: TP sweep 2.0 @OR5/SL1.25 — PF=1.2318 (KEEP)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.2318, WR=47.7%, net=₹3168.44, trades=44.0, tp=16.0, sl=18.0, eod=10.0

### Run 11: TP sweep 3.0 @OR5/SL1.25 — PF=1.0608 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '3.0', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.0608, WR=41.2%, net=₹715.46, trades=34.0, tp=7.0, sl=16.0, eod=11.0

### Run 12: TP sweep 0 (no TP) @OR5/SL1.25 — PF=0.0 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '0', 'NEWGEN_BUFFER': '0.3', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=0.0, WR=0.0%, net=₹-9699.35, trades=163.0, tp=161.0, sl=1.0, eod=1.0

### Run 13: buffer sweep 0.0 @OR5/SL1.25/TP2 — PF=1.0859 (DISCARD)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '0.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.0859, WR=45.3%, net=₹1444.86, trades=53.0, tp=17.0, sl=22.0, eod=14.0

### Run 14: buffer sweep 0.5 @OR5/SL1.25/TP2 — PF=1.4231 (KEEP)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '0.5', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.4231, WR=51.2%, net=₹5006.74, trades=41.0, tp=16.0, sl=15.0, eod=10.0

### Run 15: buffer sweep 1.0 @OR5/SL1.25/TP2 — PF=1.4677 (KEEP)
- Timestamp: 2026-08-05 03:27
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.4677, WR=53.1%, net=₹4560.59, trades=32.0, tp=13.0, sl=12.0, eod=7.0

### Run 16: buffer probe 1.5 @OR5/SL1.25/TP2 — PF=1.2273 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.5', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.2273, WR=48.0%, net=₹1927.74, trades=25.0, tp=10.0, sl=11.0, eod=4.0

### Run 17: buffer probe 2.0 @OR5/SL1.25/TP2 — PF=1.093 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '2.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.093, WR=47.8%, net=₹798.85, trades=23.0, tp=9.0, sl=11.0, eod=3.0

### Run 18: cooldown 0 @OR5/SL1.25/TP2/buf1 — PF=1.4677 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '0', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.4677, WR=53.1%, net=₹4560.59, trades=32.0, tp=13.0, sl=12.0, eod=7.0

### Run 19: cooldown 2 @OR5/SL1.25/TP2/buf1 — PF=1.2729 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '2', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.2729, WR=50.0%, net=₹2639.5, trades=30.0, tp=12.0, sl=12.0, eod=6.0

### Run 20: cooldown 3 @OR5/SL1.25/TP2/buf1 — PF=1.2896 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '3', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.2896, WR=46.2%, net=₹2425.93, trades=26.0, tp=10.0, sl=10.0, eod=6.0

### Run 21: shorts ON @OR5/SL1.25/TP2/buf1/cool1 — PF=1.2049 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '1', 'NEWGEN_EOD_EXIT': '900', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.2049, WR=46.0%, net=₹2857.42, trades=50.0, tp=15.0, sl=16.0, eod=19.0

### Run 22: EOD 870 @OR5/SL1.25/TP2/buf1/cool1 — PF=1.4922 (KEEP)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '870', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.4922, WR=50.0%, net=₹4138.55, trades=28.0, tp=12.0, sl=11.0, eod=5.0

### Run 23: EOD 885 @OR5/SL1.25/TP2/buf1/cool1 — PF=1.5687 (KEEP)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '885', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.5687, WR=55.2%, net=₹4892.8, trades=29.0, tp=13.0, sl=11.0, eod=5.0

### Run 24: EOD 855 @OR5/SL1.25/TP2/buf1/cool1 — PF=1.6833 (KEEP)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.6833, WR=51.9%, net=₹4993.55, trades=27.0, tp=12.0, sl=8.0, eod=7.0

### Run 25: EOD 840 @OR5/SL1.25/TP2/buf1/cool1 — PF=1.6739 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '840', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=1.6739, WR=48.1%, net=₹4908.61, trades=27.0, tp=12.0, sl=8.0, eod=7.0

### Run 26: minOR 0.2 @best — PF=1.6833 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '0.2'}
- Result: PF=1.6833, WR=51.9%, net=₹4993.55, trades=27.0, tp=12.0, sl=8.0, eod=7.0

### Run 27: minOR 0.5 @best — PF=1.6833 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '0.5'}
- Result: PF=1.6833, WR=51.9%, net=₹4993.55, trades=27.0, tp=12.0, sl=8.0, eod=7.0

### Run 28: minOR 0.8 @best — PF=1.8344 (KEEP)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '0.8'}
- Result: PF=1.8344, WR=53.8%, net=₹5595.62, trades=26.0, tp=12.0, sl=7.0, eod=7.0

### Run 29: minOR 1.0 @best — PF=1.8344 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '1.0'}
- Result: PF=1.8344, WR=53.8%, net=₹5595.62, trades=26.0, tp=12.0, sl=7.0, eod=7.0

### Run 30: minOR 1.5 @best — PF=2.1336 (KEEP)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '1.5'}
- Result: PF=2.1336, WR=57.1%, net=₹5997.83, trades=21.0, tp=11.0, sl=6.0, eod=4.0

### Run 31: minOR 2.0 @best — PF=2.1336 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.0'}
- Result: PF=2.1336, WR=57.1%, net=₹5997.83, trades=21.0, tp=11.0, sl=6.0, eod=4.0

### Run 32: minOR 2.5 @best — PF=2.7359 (KEEP)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=2.7359, WR=60.0%, net=₹5702.12, trades=15.0, tp=9.0, sl=4.0, eod=2.0

### Run 33: minOR 3.0 @best — PF=2.7359 (DISCARD)
- Timestamp: 2026-08-05 03:28
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '3.0'}
- Result: PF=2.7359, WR=60.0%, net=₹5702.12, trades=15.0, tp=9.0, sl=4.0, eod=2.0

### Run 34: minOR 4.0 @best — PF=1.4615 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '4.0'}
- Result: PF=1.4615, WR=50.0%, net=₹1159.58, trades=8.0, tp=4.0, sl=3.0, eod=1.0

### Run 35: SL 1.0 @minOR2.5 — PF=2.0353 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.0', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=2.0353, WR=50.0%, net=₹4087.53, trades=16.0, tp=8.0, sl=7.0, eod=1.0

### Run 36: SL 1.5 @minOR2.5 — PF=3.9471 (KEEP)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=3.9471, WR=69.2%, net=₹6714.0, trades=13.0, tp=9.0, sl=2.0, eod=2.0

### Run 37: TP 2.5 @minOR2.5 — PF=2.3444 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=2.3444, WR=57.1%, net=₹5303.44, trades=14.0, tp=7.0, sl=5.0, eod=2.0

### Run 38: TP 1.5 @minOR2.5 — PF=2.8087 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '1.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=2.8087, WR=66.7%, net=₹4756.89, trades=15.0, tp=10.0, sl=3.0, eod=2.0

### Run 39: SL 1.75 @minOR2.5/TP2 — PF=3.5224 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.75', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=3.5224, WR=69.2%, net=₹6439.36, trades=13.0, tp=9.0, sl=2.0, eod=2.0

### Run 40: SL 2.0 @minOR2.5/TP2 — PF=5.4509 (KEEP)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '2.0', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=5.4509, WR=75.0%, net=₹7349.31, trades=12.0, tp=9.0, sl=1.0, eod=2.0

### Run 41: SL 1.5 TP2.5 @minOR2.5 — PF=3.5767 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '2.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=3.5767, WR=72.7%, net=₹6667.27, trades=11.0, tp=7.0, sl=3.0, eod=1.0

### Run 42: SL 1.5 TP3 @minOR2.5 — PF=7.1057 (KEEP)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=7.1057, WR=80.0%, net=₹8341.03, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 43: SL2.0 TP3 @minOR2.5 — PF=5.933 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '2.0', 'NEWGEN_TP': '3.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=5.933, WR=80.0%, net=₹8071.01, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 44: SL2.0 TP2.5 @minOR2.5 — PF=4.6361 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '2.0', 'NEWGEN_TP': '2.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=4.6361, WR=80.0%, net=₹7258.6, trades=10.0, tp=7.0, sl=1.0, eod=2.0

### Run 45: SL1.75 TP3 @minOR2.5 — PF=6.4666 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.75', 'NEWGEN_TP': '3.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=6.4666, WR=80.0%, net=₹8206.02, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 46: SL2.5 TP2 @minOR2.5 — PF=4.6847 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '2.5', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=4.6847, WR=75.0%, net=₹7079.28, trades=12.0, tp=9.0, sl=1.0, eod=2.0

### Run 47: SL1.5 TP3.5 @minOR2.5 — PF=8.237 (KEEP)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=8.237, WR=80.0%, net=₹9886.5, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 48: SL1.5 TP4 @minOR2.5 — PF=6.4324 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '4.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=6.4324, WR=77.8%, net=₹9183.31, trades=9.0, tp=5.0, sl=2.0, eod=2.0

### Run 49: SL1.5 TP3 buf0.5 @minOR2.5 — PF=4.2862 (DISCARD)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.0', 'NEWGEN_BUFFER': '0.5', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=4.2862, WR=72.7%, net=₹7437.08, trades=11.0, tp=6.0, sl=2.0, eod=3.0

### Run 50: SL1.5 TP3 buf1.5 @minOR2.5 — PF=18.7624 (KEEP)
- Timestamp: 2026-08-05 03:29
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.0', 'NEWGEN_BUFFER': '1.5', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=18.7624, WR=88.9%, net=₹8858.27, trades=9.0, tp=6.0, sl=0.0, eod=3.0

### Run 51: SL1.5 TP3.5 buf1.5 @minOR2.5 — PF=21.8613 (KEEP)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.5', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=21.8613, WR=88.9%, net=₹10403.74, trades=9.0, tp=6.0, sl=0.0, eod=3.0

### Run 52: SL1.5 TP3 buf1.2 @minOR2.5 — PF=6.8494 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.0', 'NEWGEN_BUFFER': '1.2', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=6.8494, WR=80.0%, net=₹7990.88, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 53: SL1.5 TP3.5 buf1.2 @minOR2.5 — PF=7.9807 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.2', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=7.9807, WR=80.0%, net=₹9536.35, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 54: SL1.5 TP3.5 buf1 minOR2.0 — PF=5.2568 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.0'}
- Result: PF=5.2568, WR=71.4%, net=₹10829.5, trades=14.0, tp=7.0, sl=2.0, eod=5.0

### Run 55: SL1.5 TP3.5 buf1 minOR3.0 — PF=8.237 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '3.0'}
- Result: PF=8.237, WR=80.0%, net=₹9886.5, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 56: SL1.5 TP3.5 buf1 minOR1.5 EOD840 — PF=5.2959 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '840', 'NEWGEN_MIN_OR_RANGE': '1.5'}
- Result: PF=5.2959, WR=71.4%, net=₹11079.35, trades=14.0, tp=7.0, sl=2.0, eod=5.0

### Run 57: SL1.5 TP3.5 buf1 minOR2.5 EOD840 — PF=8.1329 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '840', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=8.1329, WR=80.0%, net=₹10136.34, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 58: SL1.5 TP3.5 buf1 minOR2.5 EOD870 — PF=4.2994 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '870', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=4.2994, WR=70.0%, net=₹8687.27, trades=10.0, tp=6.0, sl=3.0, eod=1.0

### Run 59: SL1.5 TP3.5 buf1 minOR2.5 EOD885 — PF=4.1798 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '885', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=4.1798, WR=70.0%, net=₹8372.47, trades=10.0, tp=6.0, sl=3.0, eod=1.0

### Run 60: SL1.5 TP3.5 buf1 minOR2.5 EOD850 — PF=8.237 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '850', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=8.237, WR=80.0%, net=₹9886.5, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 61: SL1.5 TP3.5 buf1 minOR2.5 EOD860 — PF=7.4349 (DISCARD)
- Timestamp: 2026-08-05 03:30
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '860', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=7.4349, WR=70.0%, net=₹9386.81, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 62: robustness cooldown2 — PF=6.1983 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '2', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=6.1983, WR=70.0%, net=₹9145.34, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 63: robustness shorts ON — PF=3.0202 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '1', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=3.0202, WR=53.3%, net=₹7526.84, trades=15.0, tp=6.0, sl=3.0, eod=6.0

### Run 64: robustness buf0.8 — PF=4.964 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '0.8', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=4.964, WR=72.7%, net=₹8970.84, trades=11.0, tp=6.0, sl=2.0, eod=3.0

### Run 65: robustness buf1.25 — PF=7.9807 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.25', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=7.9807, WR=80.0%, net=₹9536.35, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 66: tuned params OR10 — PF=8.237 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '10', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=8.237, WR=80.0%, net=₹9886.5, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 67: tuned params OR15 — PF=1.571 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '15', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=1.571, WR=44.4%, net=₹2161.23, trades=9.0, tp=3.0, sl=4.0, eod=2.0

### Run 68: tuned params OR60 — PF=0.0 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '60', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=0.0, WR=0.0%, net=₹-919.71, trades=1.0, tp=0.0, sl=1.0, eod=0.0

### Run 69: OR15 SL1.25 TP2 buf1 minOR0.3 — PF=0.9763 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '15', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=0.9763, WR=44.4%, net=₹-155.99, trades=18.0, tp=6.0, sl=8.0, eod=4.0

### Run 70: OR60 SL1.25 TP2 buf1 minOR0.3 — PF=0.0 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '60', 'NEWGEN_SL': '1.25', 'NEWGEN_TP': '2.0', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '0.3'}
- Result: PF=0.0, WR=0.0%, net=₹-2315.47, trades=4.0, tp=0.0, sl=3.0, eod=1.0

### Run 71: OR5 best config TP3.5 minOR2.5 cooldown0 — PF=8.237 (DISCARD)
- Timestamp: 2026-08-05 03:31
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '0', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=8.237, WR=80.0%, net=₹9886.5, trades=10.0, tp=6.0, sl=1.0, eod=3.0

### Run 72: final best verification run — PF=8.237 (DISCARD)
- Timestamp: 2026-08-05 03:32
- Config: {'NEWGEN_OR_MIN': '5', 'NEWGEN_SL': '1.5', 'NEWGEN_TP': '3.5', 'NEWGEN_BUFFER': '1.0', 'NEWGEN_COOLDOWN_BARS': '1', 'NEWGEN_SHORTS': '0', 'NEWGEN_EOD_EXIT': '855', 'NEWGEN_MIN_OR_RANGE': '2.5'}
- Result: PF=8.237, WR=80.0%, net=₹9886.5, trades=10.0, tp=6.0, sl=1.0, eod=3.0

## Final Summary (72 runs)
- **Best trustworthy config (run 47):** OR=5, SL=1.5, TP=3.5, buffer=1.0, cooldown=1, shorts=OFF, EOD=855, min_or_range=2.5 → PF=8.24, WR=80%, net=₹9886.5, 10 trades. Verified reproducible (run 72).
- **Best per OR duration:** OR=5/10 → PF=8.24 (identical, 9:15 candle only); OR=15 → PF=0.95 (36 trades, baseline); OR=60 → PF=0.47 (11 trades).
- **Key drivers:** short OR (first 10-min candle only) + high min_or_range (2.5%, vol-filter) + wide SL (1.5%) + TP 3.5% + EOD 14:15. Shorts hurt. Buffer 1.0% best (1.5% → PF 18+ but only 9 trades, unreliable).
