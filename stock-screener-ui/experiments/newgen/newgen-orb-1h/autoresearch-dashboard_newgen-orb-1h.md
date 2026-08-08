# Autoresearch Dashboard: newgen-orb-1h

**Runs:** 45 | **Kept:** 17 | **Discarded:** 28 | **Crashed:** 0
**Baseline:** profit_factor: 0.2796 (#1)
**Best:** profit_factor: 3.5148 (#44, +1157.1%)

| # | commit | profit_factor | status | description |
|---|--------|---------------|--------|-------------|
| 1 | b63ee0a | 0.2796 (+0.0%) | keep | baseline OR=15 SL=1.0 TP=1.5 buf=0.3 cd=1 no-shorts EOD=885 |
| 2 | b63ee0a | 0.2796 (+0.0%) | discard | OR sweep: OR=5 |
| 3 | b63ee0a | 0.2796 (+0.0%) | discard | OR sweep: OR=10 |
| 4 | b63ee0a | 0.2796 (+0.0%) | discard | OR sweep: OR=60 |
| 5 | b63ee0a | 0.3793 (+35.7%) | keep | SL sweep: SL=0.5 |
| 6 | b63ee0a | 0.2945 (+5.3%) | discard | SL sweep: SL=0.75 |
| 7 | b63ee0a | 0.2567 (-8.2%) | discard | SL sweep: SL=1.5 |
| 8 | b63ee0a | 0.214 (-23.5%) | discard | SL sweep: SL=2.0 |
| 9 | b63ee0a | 0.5661 (+102.5%) | keep | SL refine: SL=0.3 |
| 10 | b63ee0a | 0.4543 (+62.5%) | discard | SL refine: SL=0.4 |
| 11 | b63ee0a | 0.3256 (+16.5%) | discard | SL refine: SL=0.6 |
| 12 | b63ee0a | 0.7511 (+168.6%) | keep | SL refine: SL=0.2 |
| 13 | b63ee0a | 0.6456 (+130.9%) | discard | SL refine: SL=0.25 |
| 14 | b63ee0a | 0.8977 (+221.1%) | keep | SL refine: SL=0.15 |
| 15 | b63ee0a | 1.1155 (+299.0%) | keep | SL refine: SL=0.1 |
| 16 | b63ee0a | 1.2695 (+354.0%) | keep | SL refine: SL=0.075 |
| 17 | b63ee0a | 1.4728 (+426.8%) | keep | SL refine: SL=0.05 |
| 18 | b63ee0a | 0.9445 (+237.8%) | discard | TP sweep @SL=0.05: TP=1.0 |
| 19 | b63ee0a | 0.0 (-100.0%) | discard | TP sweep @SL=0.05: TP=2.0 |
| 20 | b63ee0a | 0.0 (-100.0%) | discard | TP sweep @SL=0.05: TP=3.0 |
| 21 | b63ee0a | 0.0 (-100.0%) | discard | TP sweep @SL=0.05: TP=4.0 |
| 22 | b63ee0a | 0.0 (-100.0%) | discard | TP sweep @SL=0.05: TP=0 (no TP) |
| 23 | b63ee0a | 0.7906 (+182.8%) | discard | buffer sweep @SL=0.05/TP=1.5: buf=0.0 |
| 24 | b63ee0a | 1.7697 (+532.9%) | keep | buffer sweep @SL=0.05/TP=1.5: buf=0.5 |
| 25 | b63ee0a | 1.4728 (+426.8%) | discard | cooldown sweep @best: cd=0 |
| 26 | b63ee0a | 1.7712 (+533.5%) | keep | cooldown sweep @best: cd=2 |
| 27 | b63ee0a | 0.6277 (+124.5%) | discard | shorts ON @SL=0.05/TP=1.5/buf=0.3 |
| 28 | b63ee0a | 1.7712 (+533.5%) | discard | EOD sweep @best: EOD=870 |
| 29 | b63ee0a | 1.7712 (+533.5%) | discard | EOD sweep @best: EOD=900 |
| 30 | b63ee0a | 2.164 (+674.0%) | keep | buf=0.5 + cd=2 combo @SL=0.05/TP=1.5 |
| 31 | b63ee0a | 1.7712 (+533.5%) | discard | perturb buf=0.4 @best |
| 32 | b63ee0a | 0.0 (-100.0%) | discard | perturb buf=0.6 @best |
| 33 | b63ee0a | 0.0 (-100.0%) | discard | perturb buf=0.7 @best |
| 34 | b63ee0a | 2.482 (+787.7%) | keep | perturb SL=0.03 @best |
| 35 | b63ee0a | 2.6787 (+858.0%) | keep | perturb SL=0.02 @best |
| 36 | b63ee0a | 2.9095 (+940.6%) | keep | perturb SL=0.01 @best |
| 37 | b63ee0a | 2.6787 (+858.0%) | discard | min_entry=60min @SL=0.02/buf=0.5/cd=2 |
| 38 | b63ee0a | 2.6887 (+861.6%) | discard | min_entry=120min @SL=0.02/buf=0.5/cd=2 |
| 39 | b63ee0a | 0.3396 (+21.5%) | discard | realistic regime SL=0.5/TP=2.0/buf=0.3/cd=1 |
| 40 | b63ee0a | 0.3233 (+15.6%) | discard | wide regime SL=1.0/TP=3.0/buf=0.5/cd=0 |
| 41 | b63ee0a | 2.7007 (+865.9%) | discard | TP perturb 1.4 @best |
| 42 | b63ee0a | 3.1182 (+1015.2%) | keep | TP perturb 1.6 @best |
| 43 | b63ee0a | 3.4313 (+1127.2%) | keep | TP=1.75 @best (near ceiling) |
| 44 | b63ee0a | 3.5148 (+1157.1%) | keep | TP=1.79 @best (exact ceiling) |
| 45 | b63ee0a | 0.0 (-100.0%) | discard | TP=1.80 @best (just past ceiling) |

**NOTE:** 2 runs had <5 trades (flagged unreliable): #32, #33

**Insight:** OR duration irrelevant on hourly bars; best PF=3.51 (SL=0.01,TP=1.79,buf=0.5,cd=2) is a degenerate single-trade curve-fit — TP=1.80 or buffer=0.6 both collapse PF to 0.0. Realistic regimes lose (PF 0.28-0.38).