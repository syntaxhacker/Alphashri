# Track — regime-conditioned NIFTY structure selector

**Hypothesis.** A causal NIFTY regime (direction x vol x term) can be mapped to a structure whose OOS expectancy beats taking one structure unconditionally.

**Method.** Causal regime at entry (prior-session EMA20/50, 10d slope, return sign, ADX sign, expanding VIX & ATR% percentiles, real term_slope, spot vs prior high/low, IV-crush proxy). Multi-day hold-to-expiry simulator (generalised `theta_harvest`): credit+debit structures, stops on daily high/low, expiry-intrinsic settlement, NSE fees + spread on every leg. Cell->structure map fitted on TRAIN 2018-2022 only.

| set | n | exp/trade | PF | win | total | maxDD% 3L | CI90 |
|---|---|---|---|---|---|---|---|
| selector full | 454 | 779 | 1.40 | 54% | 353,566 | -32.5 | [229, 1308] |
| selector train | 260 | 1,226 | 1.72 | 48% | 318,872 | -20.7 | [541, 1915] |
| selector test 23-26 | 194 | 179 | 1.08 | 63% | 34,695 | -32.5 | [-683, 1002] |
| a-priori test | 194 | 137 | 1.10 | 63% | 26,507 | -19.5 | [-406, 703] |
| always iron condor test | 194 | 652 | 1.44 | 71% | 126,579 | -18.7 | [129, 1143] |
| always short strangle test | 194 | 649 | 1.27 | 70% | 125,925 | -32.5 | [-355, 1580] |

**Paired OOS (selector - baseline, per entry day):** vs IC -474 (CI [-1,065, 84]); vs SS -470 (CI [-971, 4]).

**Train-fitted selectors (OOS 2023-2026; all fitted on TRAIN only).**

| selector | map (cell->structure) | test n | test exp | test PF | paired vs IC (CI) |
|---|---|---|---|---|---|
| primary_positive_gate | bear_high:short_strangle, bear_low:short_strangle, bull_high:bear_put_spread, bull_low:short_strangle, event_crush:bear_put_spread, range_high:short_strangle, range_low:short_strangle | 194 | 179 | 1.08 | -474 [-1,065,84] |
| argmax_all | bear_high:short_strangle, bear_low:short_strangle, bull_high:bear_put_spread, bull_low:short_strangle, event_crush:bear_put_spread, range_high:short_strangle, range_low:short_strangle | 194 | 179 | 1.08 | -474 [-1,065,84] |
| credit_positive_gate | bear_high:short_strangle, bear_low:short_strangle, bull_high:bull_put_spread, bull_low:short_strangle, event_crush:iron_condor, range_high:short_strangle, range_low:short_strangle | 194 | 533 | 1.24 | -120 [-682,384] |
| credit_argmax | bear_high:short_strangle, bear_low:short_strangle, bull_high:bull_put_spread, bull_low:short_strangle, event_crush:iron_condor, range_high:short_strangle, range_low:short_strangle | 194 | 533 | 1.24 | -120 [-682,384] |

| a-priori brief | fixed bull_high->bull_call, range_high->long_condor, else credit/IC | 194 | 137 | 1.10 | — |
| a-priori credit | bull->bull_put, bear->bear_call, range->IC, event->SS | 194 | 422 | 1.34 | — |

**Per-regime OOS expectancy table (train exp / test exp; Rs/trade, n in parens).**

| cell | bear_call_spread | bear_put_spread | bull_call_spread | bull_put_spread | iron_condor | long_condor | long_straddle | long_strangle | short_strangle |
|---|---|---|---|---|---|---|---|---|---|
| bear_high | 1,065/-1,085 (39/14) | -1,470/-1,660 (39/14) | -1,107/1,830 (39/14) | 1,019/1,048 (39/14) | 912/-432 (39/14) | -1,014/-229 (39/14) | -1,167/-1,198 (39/14) | -1,016/-823 (39/14) | 1,979/-1,193 (39/14) |
| bear_low | -1,254/-87 (3/40) | 5,763/-82 (3/40) | 4,750/-584 (3/40) | 60/-133 (3/40) | -1,447/-406 (3/40) | 918/-730 (3/40) | 8,768/1,962 (3/40) | 823/-666 (3/40) | -1,327/-1,046 (3/40) |
| bull_high | 643/1,456 (59/8) | 978/-1,157 (59/8) | -215/-1,129 (59/8) | 799/-120 (59/8) | 726/220 (59/8) | -177/-1,856 (59/8) | -677/-7,625 (59/8) | -544/-2,591 (59/8) | 559/-52 (59/8) |
| bull_low | 506/864 (63/65) | -679/-402 (63/65) | -1,082/484 (63/65) | 233/-19 (63/65) | 334/1,023 (63/65) | -859/-278 (63/65) | -1,785/-1,646 (63/65) | -655/67 (63/65) | 640/1,045 (63/65) |
| event_crush | -321/3,486 (45/8) | 905/-1,689 (45/8) | 882/-1,820 (45/8) | 339/-1,354 (45/8) | 752/5,853 (45/8) | 274/-3,439 (45/8) | -91/-15,254 (45/8) | -929/-6,783 (45/8) | 309/8,610 (45/8) |
| range_high | 640/827 (36/9) | -1,398/-1,202 (36/9) | -440/-1,414 (36/9) | 810/315 (36/9) | 2,115/2,910 (36/9) | -1,802/-2,343 (36/9) | -4,522/-7,050 (36/9) | -2,663/-3,490 (36/9) | 2,802/5,234 (36/9) |
| range_low | 616/675 (15/50) | -37/163 (15/50) | -1,228/-852 (15/50) | 137/-63 (15/50) | 350/153 (15/50) | -143/-914 (15/50) | 294/-945 (15/50) | -2/-1,196 (15/50) | 403/19 (15/50) |

**Curve-fit diagnostic.** Train vs test argmax structure agrees in 4/7 cells. Train regime mix is *_high-heavy (2018-22 had COVID/2022 vol), test is *_low-heavy — the cells are not stationary, so a train-fit map is fragile.

**Real 2026 transfer (front 2026-09-29, 5-day non-overlapping marks, all MARK_END).** selector n=10 exp Rs1,676 | a-priori n=11 Rs1,148 | IC n=9 Rs736 | SS n=10 Rs2,533.

**Raw direction.** underlying P(up)=0.559; exposure-signed accuracy=0.559 (NIFTY drift + structure delta, not skill); short-premium structures are delta-hedged-ish so the relevant edge is variance, not direction.

**Red-team.** (1) Synthetic premiums are BS off IV=0.65*VIX+0.35*RV with a *flat* smile, so every short-vol structure is handed the VRP and every long-vol structure pays it — debit structures are structurally handicapped in this model. (2) Train/test regime non-stationarity makes any per-cell map prone to curve-fitting. (3) Real contracts never settle at intrinsic, so the real transfer cannot confirm the mechanism.

**Verdict: REJECT.** Conditioning the structure on the causal regime does NOT beat taking a single structure unconditionally OOS: primary selector Rs179/trade vs always-IC Rs652 and always-SS Rs649 (paired sel-IC CI [-1065, 84] straddles 0 and is centred negative). Curve-fit evidence: train and test per-cell argmax structure agree in only 4/7 regime cells; the train regime mix is *_high-heavy (2018-22 COVID/2022 vol) while test is *_low-heavy, so the cells are non-stationary and a train-fit map does not transfer.
