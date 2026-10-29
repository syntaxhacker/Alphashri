# Autoresearch: LRL strategy refinement (rounds 1-6, corrected sim)

Walk-forward IS=2025 / OOS=2026. Selection = min(IS,OOS) avgR with hold>=5 bars, n>=45.

| ver | config | key change |
|--|--|--|
| r1 | r1 time30 | exit=time trail=0.25 time=30 be=0.0 sess_end=960 maxdist=45.0 db=0.5 |
| r2 | r2 sess2h+time30 | exit=time trail=0.25 time=30 be=0.0 sess_end=690 maxdist=45.0 db=0.5 |
| r3 | r3 sess2h+time45+db.45 | exit=time trail=0.25 time=45 be=0.0 sess_end=690 maxdist=45.0 db=0.45 |
| r4 | r4 maxdist60 | exit=time trail=0.25 time=45 be=0.0 sess_end=690 maxdist=60.0 db=0.45 |
| r5 | r5 maxdist70 | exit=time trail=0.25 time=45 be=0.0 sess_end=690 maxdist=70.0 db=0.45 |
| r6 | r6 be1.0+time60 | exit=time trail=0.25 time=60 be=1.0 sess_end=690 maxdist=70.0 db=0.45 |

## Issues found
- intrabar look-ahead (entry-bar high used for trail) -> fixed (stop checked before peak update)
- trail 0.1R is sub-bar -> exits at ~0R; min realistic trail ~0.25R
- session-gap FVG artifacts -> same-session enforced
- higher avgR (longer holds) => lumpier equity (win 36-43%) => $2k DD breach at >0.25% risk

## Prop eval (rolling, 47 starts, daily circuit-breaker -$800)
- best_r6 @ 0.25% risk: PASS 100%, median 21 days to +$3k
- @ 0.5%: PASS ~47%, DD breaches; @1%: PASS ~36%
