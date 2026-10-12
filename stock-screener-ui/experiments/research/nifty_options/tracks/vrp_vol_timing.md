# Track A — Variance risk premium (VRP) timing

**Hypothesis.** Options are rich vs trailing RV; sell a straddle/strangle when prior-day VRP is high and term structure is in contango; buy vol when IV<RV.
**Causal & costed.** Prior-day features only; fill at next bar open; engine charges NSE fees + 0.35% half-spread + 0.15% slippage per leg. Config selected on train 2018-22, test 2023-26.

**The premise is true.** Real 2026 surface (front expiry): ATM VRP mean +0.054 / median +0.054, range [0.005,0.096], 100% positive (n=96); VRP grows with tenor (0.033 @0-7d → 0.057 @60-200d). Synthetic prior-day IV/RV: mean 1.19, median 1.17, IV>RV 83% of days.
So richness is real — the question is whether it is tradeable intraday net of cost.

| config | n | exp ₹ | PF | win% | maxDD% | raw dir% | train exp | test exp |
|---|---|---|---|---|---|---|---|---|
| syn_ss_atm_e60|unconditional | 1720 | 383 | 1.65 | 63 | -9.2 | 50 | 413 | 343 |
| syn_ss_atm_e60|vix_rel>1.1 | 1237 | 282 | 1.51 | 62 | -11.3 | 50 | 331 | 216 |
| syn_ss_atm_e60|vrp>0.02 | 827 | 234 | 1.39 | 61 | -20.4 | 50 | 331 | 48 |
| syn_ss_atm_e60|ratio>1.3 | 436 | 38 | 1.06 | 58 | -11.8 | 50 | 71 | -25 |
| syn_ss_atm_e60|vix_rel<1.2 | 730 | 704 | 2.24 | 68 | -5.4 | 49 | 694 | 717 |
| syn_ls_atm|ratio<1.0 | 310 | -579 | 0.60 | 29 | -59.8 | 49 | -679 | -434 |
| real_ss_atm|unconditional | 59 | -312 | 0.50 | 47 | -5.9 | 51 | nan | nan |
| real_sx1|unconditional | 56 | -218 | 0.63 | 54 | -5.0 | 54 | nan | nan |
| real_sx2|unconditional | 55 | -440 | 0.43 | 38 | -9.1 | 51 | nan | nan |
| real_sx1|contango | 32 | 108 | 1.39 | 59 | -1.1 | 50 | nan | nan |
| real_ls_atm|unconditional | 59 | -961 | 0.16 | 14 | -19.3 | 51 | nan | nan |

**High VRP is a contra-signal.** Gating on high prior-day VRP makes short vol *worse* in-sample and OOS; high IV/RV is driven by depressed trailing RV that mean-reverts up. Unconditional e60 straddle expectancy by prior IV/RV bucket (₹/trade): 0.0-1.0: ₹546 (n=310); 1.0-1.1: ₹941 (n=311); 1.1-1.2: ₹434 (n=360); 1.2-1.3: ₹79 (n=303); 1.3-1.5: ₹22 (n=313); 1.5-10.0: ₹81 (n=123).
Real strangle1 expectancy by prior-VRP tercile: ₹-225 (n=19); ₹-268 (n=18); ₹-164 (n=19).

**Tail.** Best real config (real_sx1|contango): n=32, exp ₹108, PF 1.39, CI [-140,354] (spans 0), worst trade ₹-2033, worst week ₹-2441, maxDD -1.1% of ₹3L, RoR 0.000.
Synthetic e60 unconditional: worst trade ₹-8329, worst week ₹-9419, maxDD -9.2%, RoR 0.000; ₹15k/week needs ₹3,114,926.
Real short-vol losers: straddle −₹312/trade (PF 0.50), strangle1 −₹218 (0.63), strangle2 −₹440 (0.43); long straddle −₹961 (0.16, RoR 1.0) — buying vol is never +EV.
**Where the money goes.** Real straddle: premium ₹48,677/lot, gross ₹-186, fees ₹125 → net ₹-312 (98% EOD exits). Synthetic e60 straddle: premium ₹13,975/lot, gross ₹419, fees ₹36 → net ₹383 — the model's gross vol edge is not present in real quotes.

**Red-team.** (1) The synthetic edge is model artifact: options are BS-priced off the same VIX/RV blend the gate reads, with no IV crush/true bid-ask; raw dir accuracy ≈ 50%, so positive P&L is *payout geometry*, not directional skill (per brief). (2) The only model-space positive condition is the opposite one (sell when IV/RV LOW: test +₹717/trade, CI [440,999]) and it fails transfer — same gate on real premiums: ₹-613/trade (n=34).
(3) Real basket is ~59 trades of one long-dated (Sep) contract: intraday theta ≪ round-trip cost, and a 130-DTE short straddle needs ~₹4.5L SPAN margin > ₹3L capital; term-contango flip is in-sample with CI spanning 0.

**Verdict: REJECT.** No condition makes selling vol +EV net of costs on real premiums, and none makes buying vol +EV. The real-premium basket has no n≥100, CI⊄0, <25%-DD candidate.
