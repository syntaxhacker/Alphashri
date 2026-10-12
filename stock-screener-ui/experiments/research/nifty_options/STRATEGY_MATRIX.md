# Strategy matrix — NIFTY structures + stock options

Synthesis of the three tracks (`structures_catalog`, `regime_structures`, `stock_covered_calls`).
All NIFTY structures: hold-to-expiry, net of NSE fees + spread + slippage. Synthetic = BS on real
2018-26 spot with causal INDIAVIX IV (flat smile); real window is Jun-Sep 2026 and none of the
cached contracts settle inside it. **Every "profitable" number below is therefore model-based.**

## A. NIFTY structures — ranked (full sample 2018-26)

| rank | structure | exp ₹ | PF | win | maxDD %3L | worst ₹ | CI90 | OOS test ₹ |
|---|---|---|---|---|---|---|---|---|
| 1 | ratio_spread_1pct | 1,483 | 1.38 | 61% | **−85.9** | −188k | [−62, 2998] | 603 |
| 2 | short_strangle_1pct | 1,434 | 1.34 | 67% | **−70.0** | −78k | [439, 2423] | 1,722 |
| 3 | short_strangle_0.5pct | 1,426 | 1.30 | 64% | **−77.5** | −78k | [335, 2498] | 1,719 |
| 4 | short_straddle | 1,381 | 1.28 | 62% | **−81.4** | −78k | [240, 2501] | 1,623 |
| 5 | short_strangle_2pct | 1,063 | 1.41 | 77% | **−55.9** | −77k | [306, 1800] | 1,123 |
| 6 | **iron_condor_2pct_w300** | 657 | 1.35 | 75% | **−17.9** | −18k | [209, 1091] | 563 |
| 7 | iron_condor_2pct_w200 | 488 | 1.32 | 74% | −13.8 | −12k | [157, 816] | 403 |
| 8 | iron_fly_w400 | 299 | 1.09 | 53% | −44 | −16k | [−345, 931] | 117 |
| 9 | bull_call_spread | 299 | 1.12 | 46% | −53 | −6k | [−149, 742] | −339 |
| 10 | iron_condor_1pct_w200 | 274 | 1.12 | 56% | −36 | −9k | [−153, 701] | 354 |
| 12 | bull_put_spread_1pct | 141 | 1.14 | 76% | −23 | −6k | [−64, 340] | −129 |
| 14 | bear_call_spread_2pct | 98 | 1.14 | 85% | −9 | −6k | [−55, 254] | 193 |
| 18 | calendar_long_front_CE | −146 | 0.99 | 52% | −615 | −176k | — | −1,256 |
| 20 | long_condor_1pct | −291 | 0.81 | 50% | −62 | −5k | [−519, −61] | −401 |
| 21 | bear_put_spread | −320 | 0.80 | 40% | −73 | −4k | [−544, −88] | −9 |
| 23 | synthetic_short | −493 | 0.95 | 47% | −356 | −110k | — | 1,934 |
| 26 | synthetic_long | −557 | 0.95 | 52% | −236 | −247k | — | −2,278 |
| 29 | long_strangle_2pct | −1,191 | 0.69 | 23% | −225 | −50k | [−1933, −431] | −1,279 |
| 31 | **long_straddle** | **−1,683** | 0.74 | 37% | −336 | −52k | [−2806, −545] | −1,967 |

**Read:** everything that *sells* premium is gross-positive; everything that *buys* vol is solidly
negative. Naked short premium has the best expectancy and 56–86% drawdowns. Adding wings (iron condor)
cuts drawdown to 14–18% but cuts expectancy to ~₹400–660 and the OOS CI barely clears/does not clear 0.

**Gate-clearing configs** (OOS>0, CI excludes 0, DD<25%):
| config | OOS ₹ | PF | DD% | artifact test (IV=RV) |
|---|---|---|---|---|
| synthetic_long + 0.5× stop | 3,184 | 4.09 | −10 | directional beta (corr 0.6-0.8 with spot) |
| ratio_spread_1pct + 2× stop | 1,542 | 1.72 | −24 | survives (+₹720) but only via stop-fill |
| iron_condor_2pct_w300 + 2× stop | 622 | 1.42 | −19 | **collapses to −₹110 at IV=RV** → model VRP |
| bear_call_spread_2pct + 2× stop | 246 | 1.65 | −5 | directional beta |

**Artifact check:** at IV=RV every short-vol structure collapses (short straddle 1,381→−1,507;
short strangle 1,434→−884; condor_w300 657→−532). The synthetic edge *is* the assumed VRP.

## B. Regime / direction conditioning — REJECT

Causal selector (daily trend + VIX/ATR percentile + term slope) vs unconditional, OOS 2023-26:

| strategy | exp ₹ | PF | DD% | CI90 |
|---|---|---|---|---|
| regime selector | 179 | 1.08 | −33 | [−683, 1002] |
| always iron condor | **652** | 1.44 | −19 | [129, 1143] |
| always short strangle | 649 | 1.27 | −33 | [−355, 1580] |

Per-cell train/test argmax agrees only 4/7 → non-stationary. **Conditioning on spot/direction does
not beat just selling the neutral condor.**

## C. Stock options (covered calls etc.) — modeled premiums

12 liquid names, yfinance 6y daily, BS premiums with IV = 1.15×trailing RV, Indian F&O costs.

| structure | CAGR | Sharpe | maxDD | notes |
|---|---|---|---|---|
| buy & hold | 10.1% | 0.23 | −28.5% | baseline |
| covered call (5% OTM, monthly) | **17.7%** | 0.61 | −19.4% | beats B&H for 92% of names; call expired worthless 76% |
| covered call (5% OTM, 30-DTE) | 23.1% | 0.79 | −19.6% | 100% of names |
| cash-secured put (3% OTM) | 9.3% | 0.26 | — | win 80%, assigned 17–35% |
| collar (95/105) | 8.8% | — | — | tail 5th-pct −4.8% vs B&H −8.8% |
| wheel | 21.9–23.9% | — | — | |

**Regime truth:** covered call = long stock + short call = short vol → underperforms B&H by
**−2.5pp** in strong bull cycles, outperforms by **+1.4 to +1.6pp** in flat/mild-up cycles.
Premium: 3.25% ATM, 1.59% at 5% OTM. **Break-even IV ≈ 0.97× realised vol** → the +6–7%/yr is the
assumed VRP, not a discovered edge.

## Verdicts

| area | best structure | realistic edge | verdict |
|---|---|---|---|
| NIFTY range | iron condor ±2% OTM / 300pt wings / enter 5d pre-expiry / stop 2× credit | +₹620–660/trade, DD 18% | DEFER (model VRP) |
| NIFTY trend | none robust (directional beta only) | — | reject |
| NIFTY long-vol | none | negative | reject |
| stocks | covered call ~5% OTM monthly; collar for tail | +6–7%/yr in-model | DEFER (no real premiums) |

**Nothing is validated for capital.** The binding blocker is unchanged: real options that
settle at expiry. Forward-collect weekly chains (and stock chains), then re-run
`tracks/structures_catalog.py` and `tracks/stock_covered_calls.py` unchanged.
