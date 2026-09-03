# Worklog: SMC trend-break autoresearch

## Session setup — 2026-09-03
- Goal: PF on held-out tick sessions. Train: 07-02, 07-22, 07-24, 08-26. Test: 07-10, 09-02.
- Engine: trading/smc_ifvg.py (RR3 default, coupled). Ticks cached in experiments/data/duka_cache.
- Prior art (from earlier analysis, pre-loop): baseline test-PF ~0.8; known losers = chase entries,
  counter-trend bounce longs, round-trip TP misses; MFE law (median 1R, p75 2.8R).
