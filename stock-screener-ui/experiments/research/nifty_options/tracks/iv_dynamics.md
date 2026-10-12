# Track C — Intraday & overnight IV dynamics / IV crush

**Hypothesis.** ATM IV has a systematic intraday/overnight shape and the front expiry is priced rich vs realised moves; one can harvest overnight IV crush and expiry crush net of costs.

**Method.** Built a real 30-min ATM IV surface (`mispricing.build_surface("30")`, 96 dates 2026-05→09, 77,086 rows). Front-expiry ATM IV per bucket; causal overnight trades on real FYERS premiums (entry 15:00 close → exit next 09:30) with the shared ExecutionModel (0.35% half-spread + 0.15% slippage/side + fees). Synthetic BS anchor 2018-2026 for theta/VRP. Regime gate = **causal expanding median** of prior-day |log ret|.

## Results
| real 2026-06..09 | n | net/trade | PF | win | maxDD | 90% CI | raw dir acc |
|---|---|---|---|---|---|---|---|
| ATM straddle sell/buy | 57 | −₹191 / −₹1041 | 0.68/0.07 | 44/19% | −₹21.6k | [−434,+59] | 0.51 |
| ±100 strangle sell | 49 | **+₹69** | 1.17 | 57% | −₹7.1k | [−178,+312] | 0.45 |
| ±150 strangle sell | 51 | **+₹75** | 1.18 | 61% | −₹10.4k | [−179,+316] | 0.55 |
| short front when IV>median (next open) | 21 | +₹182 | 1.45 | 57% | −₹2.4k | [−229,+610] | 0.62 |
| ±100 short **after calm** (headline) | 36 | **+₹233** | 1.78 | 61% | **−₹2.3k** | **[−33,+508]** | 0.36 |
| ±100 short after volatile | 13 | −₹386 | 0.43 | 46% | −₹5.5k | [−891,+118] | 0.69 |
| synth short strangle→expiry | 2158 | +₹551 | 1.22 | 67% | −₹337k | [+240,+853] | 0.55 |

**Intraday/overnight shape.** Front ATM IV 09:30 12.54% → 15:00 12.45%; mean intraday Δ −0.09 vp (median −0.12, sd 0.60); VIX 16.72→16.64. Same-expiry overnight Δ mean +0.05 vp, median 0.00, sd 0.54, falls on 50% of nights. → IV drifts **down** intraday and is **flat** overnight; it does *not* rise into the close / crush at the open.

**Overnight mechanism (real).** Long ATM straddle decomposition (n=57): theta −11.9 pts (−₹771), gamma-move +4.6 (+₹299), IV residual +0.7 (+₹46) = −₹425/lot at mid; short earns +₹425 mid but pays ≈₹619 spread+fees → −₹191. Realised overnight |gap| 79.6 pts vs implied overnight move 117.8 pts (hit-rate 0.28) → positive VRP gross, consumed by front-month execution.

**Expiry crush.** Real front ATM IV by DTE is noisy and there is no expiry-day data (ends DTE 4). Synthetic short strangle→expiry is +EV (n=2158, CI excludes 0) but maxDD −₹337k = −112% of ₹3L; rich-gated n=1018 +₹753; long mirror −₹738. **Caveat:** synthetic overnight IV Δ is **+1.0 vp (77% up)** because VIX opens higher — the opposite of a crush — so the synthetic *overstates long-vol / understates short-overnight* profit and cannot confirm the real mechanism.

**IV vs prior move.** IV Δ after calm −0.03 vp, after volatile +0.12 vp. Realised |gap| after calm 57 vs 74 pts after volatile. Short-vol only pays after calm days; it loses after volatile days.

## Red-team
- Front expiry is a single monthly (2026-09-29) for the entire real window; n≤57 and no cross-expiry panel.
- Short-strangle `raw_dir_accuracy` ≈0.36–0.45 → P&L is short-vol **payoff geometry** (many small wins, fat tail), not directional skill; the only real edge is the VRP.
- Costs are assumptions: a thinner spread (0.35%→~0.2%/side) would roughly flip the ATM short straddle to break-even.
- Real and synthetic disagree on overnight sign; neither CI excludes 0 for any real config.
- No candidate meets the bar (n≥100, CI excludes 0, maxDD<25% of ₹3L).

## Verdict: **reject**
Best config = real short ±100 front-expiry strangle after calm days, 15:00→09:30: n=36, +₹233/trade, PF 1.78, maxDD −₹2.3k (0.8% of ₹3L), CI [−₹33,+₹508] **includes 0**, n<100, `capital_for_15k_week`≈₹6.4M (cannot gross ₹15k/wk on ₹3L). Mechanism (VRP) is real gross, but front-month cost ≈ one night's theta.
