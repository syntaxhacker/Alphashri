# Track D — hold-to-expiry defined-risk theta harvest

**Hypothesis.** The VRP is real (ATM IV/RV ~1.2 syn, 1.85 real-2026) but one night's theta < round-trip cost, so it can only be harvested by *holding* a short strangle / iron condor to expiry. Prior engines force-exit at EOD.

**Method.** Multi-day simulator (`tracks/theta_harvest.py`): enter one weekly cycle, hold across sessions, settle at expiry intrinsic (spot at expiry close), stop on daily high/low. Entry day from prior-day features only; spread (0.35%+0.15%) + NSE fees on every leg. Config chosen on train 2018-2022 only.

**Best config (train-selected):** `syn_ed5_dp0.02_w6_s3.0`.

| set | n | exp/trade | PF | win | total | maxDD% 3L | worst trade | CI90 |
|---|---|---|---|---|---|---|---|---|
| full 2018-26 | 454 | 782 | 1.44 | 74% | 354,829 | -17.5 | -14,713 | [366, 1181] |
| train 18-22 | 260 | 829 | 1.43 | 72% | 215,618 | -17.5 | -14,713 | [229, 1411] |
| test 23-26 | 194 | 718 | 1.47 | 75% | 139,211 | -9.9 | -13,287 | [163, 1231] |

**Costs.** avg credit Rs3,768/lot, avg fees Rs17 (0.4% of credit), avg gross Rs798, avg net Rs782; 87% intrinsic settlement.

**Plateau check (strike dist x wing width x entry DTE, 54 configs).** Broad plateau, not a spike: 5-trading-day holds > 3d/7d; wider wings monotonically better; 1.5-2.5% OTM all positive on train and test (`config_table` in the JSON).

**Artifact check (IV=RV).** Re-pricing every strike at trailing RV (removing the VRP from the input) collapses the edge: n=454 exp Rs-172 PF 0.90 (vs Rs782 PF 1.44 with the VRP-laden IV). So the model P&L *is* the VRP input, i.e. a model artifact until real quotes confirm it.

**Entry filters (train-derived thresholds, applied OOS).**
| gate | train exp (n) | test exp (n) |
|---|---|---|
| none | 829 (260) | 718 (194) |
| ratio<=q33 | 849 (86) | 523 (125) |
| ratio>=q66 | 1,532 (89) | 2,019 (22) |
| calm_move | 385 (130) | 246 (128) |
| volatile_move | 1,273 (130) | 1,633 (66) |

**Real-premium transfer (RED TEAM).** pooled n=102 (configs x entry days, non-independent), exp Rs-1,594, PF 0.28; the -76% 'DD' is just many overlapping marks summed over one move, not a portfolio DD. Every cached real contract expires **after** the data window (spot ends 2026-09-25; nearest real expiry 2026-09-29) so **nothing settles at intrinsic** — all MARK_END.
Sep-29 monthly by entry DTE (calendar): 8d Rs397(n=12, 2026-09-21); 18d Rs2,624(n=12, 2026-09-11); 25d Rs-3,888(n=12, 2026-09-04); 32d Rs-6,094(n=12, 2026-08-28); 39d Rs-7,554(n=12, 2026-08-21)
Rolling non-overlapping weekly marks (real vs synthetic, same dates/expiry): h5_dp0.02 real Rs736(n=9) / syn Rs-43; h5_dp0.03 real Rs580(n=8) / syn Rs221; h10_dp0.02 real Rs427(n=5) / syn Rs625; h10_dp0.03 real Rs730(n=4) / syn Rs878

**Raw direction.** brief raw_dir_accuracy=0.555 (NIFTY's up-drift, not skill); the condor is delta-neutral, so `within_short_strikes` =0.700 is the relevant 'geometric' rate; edge is variance, not direction.

**Red-team.** (1) The synthetic edge is a model artifact — SyntheticOptionSource prices every strike at combine_iv=0.65*INDIAVIX+0.35*RV with a flat smile (smile_coeff=0), so the VRP is baked into the input and the 18-22/23-26 split is not independent of that assumption. (2) The real transfer is blocked (no settlement; n<20 independent): its sign is set by one ~4% Sep-2026 selloff where holds >2 weeks lost Rs5-11k/lot, while the cleanest rolling 5-day real marks are +Rs736 (n=9, 90% CI spans 0). (3) Tail: long wings cap loss at (width-credit)/lot but a gap/vol-spike can exceed the mark.

**Verdict: DEFER.** In the synthetic model a broad plateau of far-OTM, wide-wing, ~1-week hold-to-expiry condors is net +EV with a positive test period (n>=100, bootstrap CI excluding 0, maxDD < 25% of Rs3L). BUT the edge is exactly the model's IV input: re-pricing every strike at trailing RV (IV=RV) collapses it, and SyntheticOptionSource prices every strike at combine_iv = 0.65*INDIAVIX+0.35*RV with a flat smile (smile_coeff=0), i.e. the VRP is baked into the input. The real-premium transfer cannot confirm it: every cached real contract expires after the data window, so nothing settles at intrinsic; the real sample is a handful of non-independent MARK_END marks (5 entry vintages on the Sep-29 monthly x overlapping configs) whose sign is set by a single ~4% Sep-2026 drawdown, where holds longer than ~2 weeks lose Rs5-11k/lot (the cleanest real sub-test -- rolling non-overlapping 5-day marks on the Sep-29 monthly, n=9 -- is positive at Rs736/trade but its 90% CI [-72, 1571] includes 0). The mechanism is real (real-2026 ATM VRP ratio 1.85) but a tradeable, defensible candidate cannot be demonstrated with the available data -- acquire real expiry-settled weekly chains (or a weekly realised-vol series) before risking capital.

n=454, exp Rs782, PF 1.44, win 74%, total Rs354,829, maxDD -17.5% of Rs3L, worst week Rs-20,377, worst trade Rs-14,713, RoR 0.000, capital_for_15k_week Rs5,592,832; test(23-26) n=194 exp Rs718.
