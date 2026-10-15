# NIFTY Options — Quantitative Research Report

_All results are causal: signals use completed bars only; fills occur at the next bar open; each bar's stop is checked before its target; NSE fees, spread and slippage are charged on every leg._

## 1. Data

- NIFTY50 spot + INDIAVIX: 1-min/5-min/15-min/daily, **2017-07-17 → 2026-09-25** (~852k 1-min bars each), pulled from FYERS and cached as parquet.
- Options: **real FYERS premiums for currently-listed contracts only**; expired contracts return `-300 Invalid symbol`, so no multi-year option history exists via FYERS history. 669 contracts (6 expiries, 22k–25.6k strike ladder) cached.

- QC: 677 files, 7,381,682 rows, 0 files with duplicate timestamps, 7 files with bad OHLC (all index files; options clean). Median zero-volume-minute fraction 0.76.

- Pricing overlay calibration (real ATM band): median |model−actual|/actual = **6.2%**, iv_mult=1.0000000000000002, smile_coeff=0.0.


## 2. Deep multi-regime study (synthetic option P&L, 2018–2026)

Signals from the real spot path; option P&L from Black-Scholes with a causal VIX/realised-vol surface calibrated above. **Model-premium caveat applies.**

### Per-strategy (5-min, 1% risk budget, 35% stop / 60% target)

| strategy                |   trades |    net_₹ |   PF |   win% |   exp_₹ |   maxDD_₹ |   Sharpe/trade |   avg_week_₹ |   worst_week_₹ |   P(win week) |
|:------------------------|---------:|---------:|-----:|-------:|--------:|----------:|---------------:|-------------:|---------------:|--------------:|
| orb_breakout            |      929 |   114302 | 1.12 |     45 |     123 |    -51774 |           0.05 |          287 |         -11268 |            51 |
| vwap_reclaim            |      583 |     4932 | 1.01 |     43 |       8 |    -97896 |           0    |           76 |         -18853 |            40 |
| prev_day_break          |     1271 |    48794 | 1.03 |     43 |      38 |   -101366 |           0.01 |          113 |         -19187 |            50 |
| momentum_pullback       |     4767 |   133804 | 1.02 |     41 |      28 |   -153852 |           0.01 |          293 |         -26110 |            50 |
| short_straddle_intraday |     2156 |   292356 | 1.2  |     54 |     136 |   -151907 |           0.06 |          641 |         -13192 |            51 |
| credit_spread_intraday  |     2154 | -1325336 | 0.3  |     21 |    -615 |  -1339730 |          -0.45 |        -2906 |         -11403 |            22 |


### Walk-forward sweep (train 2018–2022, test 2023–2026)

32 configs tested. Survivors (positive in *and* out of sample, n≥100, test PF ≥ 1.05): **13**.

| strategy                | params                            |   stop |   target |   train_exp |   test_exp |   test_pf |   test_dd |
|:------------------------|:----------------------------------|-------:|---------:|------------:|-----------:|----------:|----------:|
| orb_breakout            | {'or_min': 15, 'buffer': 0.0015}  |    0.3 |      0.5 |   112.936   |   116.654  |   1.10339 |  -34490.7 |
| orb_breakout            | {'or_min': 15, 'buffer': 0.0015}  |    0.5 |      0.5 |    47.7267  |   156.631  |   1.16677 |  -50196.4 |
| orb_breakout            | {'or_min': 15, 'buffer': 0.0015}  |    0.5 |      1   |    78.1385  |    66.8298 |   1.06232 |  -47359.9 |
| orb_breakout            | {'or_min': 30, 'buffer': 0.0015}  |    0.3 |      0.5 |   151.232   |   168.444  |   1.16118 |  -25919.9 |
| orb_breakout            | {'or_min': 30, 'buffer': 0.0015}  |    0.3 |      1   |     9.95289 |   174.898  |   1.15422 |  -37911.2 |
| orb_breakout            | {'or_min': 30, 'buffer': 0.0015}  |    0.5 |      0.5 |    43.5235  |   122.523  |   1.13407 |  -32810.2 |
| orb_breakout            | {'or_min': 15, 'buffer': 0.003}   |    0.3 |      0.5 |   186.272   |   192.513  |   1.1768  |  -21433.5 |
| orb_breakout            | {'or_min': 15, 'buffer': 0.003}   |    0.3 |      1   |   268.892   |   433.928  |   1.38654 |  -21433.5 |
| orb_breakout            | {'or_min': 15, 'buffer': 0.003}   |    0.5 |      1   |   127.997   |   156.576  |   1.1435  |  -19553.9 |
| momentum_pullback       | {'ema_span': 20}                  |    0.3 |      1   |   124.523   |    87.5922 |   1.06248 |  -91365.2 |
| short_straddle_intraday | {'entry_min': 30, 'otm_steps': 0} |    0.3 |      0.5 |   239.736   |    46.7925 |   1.05846 | -119465   |
| short_straddle_intraday | {'entry_min': 30, 'otm_steps': 1} |    0.3 |      0.5 |   243.842   |    48.5126 |   1.05603 | -119004   |
| short_straddle_intraday | {'entry_min': 30, 'otm_steps': 1} |    0.3 |      1   |   201.207   |    44.5498 |   1.0512  | -118447   |


## 3. Real-premium check (actual FYERS prices, 2026-07-01 → 2026-09-25)

Same strategies on **real premiums** for the front listed monthly. Small sample and a back-month contract bias (only Sep/Oct/Dec monthlies are still listed); this validates execution mechanics and cost realism, not a multi-regime edge.

### Per-strategy (real premiums)

| strategy                |   trades |   net_₹ |   PF |   win% |   exp_₹ |   maxDD_₹ |   Sharpe/trade |   avg_week_₹ |   worst_week_₹ |   P(win week) |
|:------------------------|---------:|--------:|-----:|-------:|--------:|----------:|---------------:|-------------:|---------------:|--------------:|
| orb_breakout            |       10 |   -4115 | 0.65 |     60 |    -411 |     -5200 |          -0.17 |         -588 |          -4569 |            57 |
| vwap_reclaim            |       89 |  -29232 | 0.61 |     38 |    -328 |    -31342 |          -0.2  |        -1949 |          -5823 |            27 |
| prev_day_break          |       27 |   -6699 | 0.71 |     41 |    -248 |    -14224 |          -0.12 |         -515 |          -5787 |            46 |
| momentum_pullback       |      101 |  -33507 | 0.66 |     35 |    -332 |    -47017 |          -0.14 |        -2234 |          -7615 |            27 |
| short_straddle_intraday |       59 |  -30606 | 0.29 |     41 |    -519 |    -29262 |          -0.39 |        -2186 |          -6335 |             7 |
| credit_spread_intraday  |       45 |  -97508 | 0.04 |      2 |   -2167 |    -93478 |          -1.76 |        -8864 |         -15465 |             0 |


## ₹15,000/week feasibility

- **orb_breakout**: mean week ₹287 → to average ₹15k/week needs ~₹1.57 Cr (52.2× capital), worst week at 1× = ₹-11,268, P(+week)=51%.
- **vwap_reclaim**: mean week ₹76 → to average ₹15k/week needs ~₹5.93 Cr (197.7× capital), worst week at 1× = ₹-18,853, P(+week)=40%.
- **prev_day_break**: mean week ₹113 → to average ₹15k/week needs ~₹3.97 Cr (132.5× capital), worst week at 1× = ₹-19,187, P(+week)=50%.
- **momentum_pullback**: mean week ₹293 → to average ₹15k/week needs ~₹1.53 Cr (51.1× capital), worst week at 1× = ₹-26,110, P(+week)=50%.
- **short_straddle_intraday**: mean week ₹641 → to average ₹15k/week needs ~₹0.70 Cr (23.4× capital), worst week at 1× = ₹-13,192, P(+week)=51%.
- **credit_spread_intraday**: mean week ₹-2,906 → to average ₹15k/week needs ~₹-0.15 Cr (-5.2× capital), worst week at 1× = ₹-11,403, P(+week)=22%.


## 4. Current market state

```json
{
  "spot": 23140.5,
  "regime": {
    "regime": "Bearish",
    "adx_daily": 51.59113375900731,
    "ema20_slope_10d": -0.0180807135932947,
    "atr_pct": 0.00878978414468141,
    "atr_pct_percentile": 0.25911286780852,
    "vix": 12.16,
    "vix_percentile": 0.17169069462647443,
    "vol_regime": "Low"
  },
  "levels": {
    "as_of": "2026-09-25 05:30:00+05:30",
    "prev_day_high": 23281.95,
    "prev_day_low": 23046.15,
    "prev_day_close": 23063.1,
    "prev_week_high": 23489.0,
    "prev_week_low": 23046.15,
    "session_vwap": 23087.66763655199,
    "session_open": 23035.0,
    "opening_range_15m": [
      23030.0,
      23118.55
    ]
  },
  "oi": {
    "pcr_oi": 0.954,
    "call_oi": 169746265,
    "put_oi": 161994845,
    "max_pain": 23250,
    "top_call_oi_strikes": [
      [
        24000,
        15791555,
        -3618245
      ],
      [
        23500,
        14586065,
        1013965
      ],
      [
        23400,
        9863295,
        -659005
      ]
    ],
    "top_put_oi_strikes": [
      [
        23000,
        14643835,
        2886235
      ],
      [
        22000,
        13122005,
        989405
      ],
      [
        23100,
        10990785,
        3404765
      ]
    ]
  },
  "iv": {
    "nearest_atm_iv": 9.85,
    "term": [
      {
        "expiry": "29-09-2026",
        "atm_iv": 9.85
      },
      {
        "expiry": "06-10-2026",
        "atm_iv": 10.47
      },
      {
        "expiry": "13-10-2026",
        "atm_iv": 11
      }
    ],
    "skew": 3.27
  },
  "expiries": [
    "29-09-2026",
    "06-10-2026",
    "13-10-2026",
    "19-10-2026",
    "27-10-2026",
    "03-11-2026"
  ]
}
```

---

## 5. Regime dependence (ORB, the only parameter-stable survivor)

Prior-day information only (VIX percentile, 20/50-EMA trend):

| regime | n | expectancy (₹/trade) | win% |
|:--|--:|--:|--:|
| low-vol (VIX pct <33) | 314 | +190 | 50 |
| mid-vol | 315 | +55 | 50 |
| high-vol | 314 | +88 | 40 |
| **down-trend** | 291 | **+286** | 50 |
| **range** | 179 | **−65** | 40 |
| up-trend | 473 | +69 | 40 |
| CE (upside break) | 408 | +193 | 50 |
| PE (downside break) | 535 | +48 | 40 |

**Conclusion:** ORB's edge is real but *regime-conditional* — it makes money in trending
sessions and **loses in range-bound sessions**. Any live use must gate on trend (skip ranges).

## 6. Adversarial red-team — what is rejected and why

- **Credit spreads** — real-premium PF 0.04 (1 winner in 45 trades); synthetic ruin
  probability 59%. Rejected outright.
- **Short straddle** — synthetic edge (₹136/trade) **degrades out of sample** (test PF
  0.92–1.06) and **fails on real premiums** (PF 0.29). The synthetic short-premium edge
  is largely a model artifact (no IV crush, flat smile). Rejected.
- **Momentum pullback** — large sample (4,767) but expectancy ₹28/trade with a bootstrap
  90% CI of [−38, +97] (spans zero); `ema_span=40` is strongly negative in *both* periods
  (instability). Not accepted.
- **Prev-day break** — negative in train (−₹142), positive in test (+₹107): period
  inconsistency. Deferred.
- **VWAP reclaim** — expectancy ₹8/trade, CI spans zero. No edge.
- **ORB** — the only strategy with 12/12 sweep configs positive out-of-sample and a
  coherent regime story. Its deep-study bootstrap CI still *includes zero* [−17, +266],
  so it is a **small, not-yet-statistically-strong** edge — not an A+ setup.

Model risks carried into every synthetic number: 6.2% median premium error, flat-vol
smile (understates OTM premium), no IV-crush modelling, no early-assignment, no
historical OI (FYERS `/history` can attach OI but expired contracts are unavailable),
and the 2026 calibration window is short.

## 7. Verdict

- **₹15,000/week is not statistically justified with ₹3L** under the tested risk
  constraints. At unchanged risk the best synthetic edge (ORB) averages **₹287/week**
  and would need **~₹1.57 Cr** to average ₹15k/week; the highest-mean strategy (short
  straddle, ₹641/wk) needs ~₹70L **and** carries a 51% max drawdown and fails
  out-of-sample/real-premium checks.
- Realistic expectation at ₹3L: **~₹0–₹600/week** in model space, with weekly P(win)
  ≈ 50%, max drawdown 17–51%, and no confirmation from real premiums.
- **Position sizing reality:** one NIFTY ATM lot (65) costs ₹10k–₹26k premium; a 35%
  premium stop risks ₹3.4k–₹9.1k = **1.1–3.0% of ₹3L per lot**, so a 1% risk budget is
  unimplementable (minimum 1 lot already exceeds it). Capital per trade is capped at
  ~₹26k–₹52k (1 lot).

### Current-week decision (as of 2026-09-25 close; next sessions 28–29 Sep, expiry Tue 29 Sep)

- **Market regime:** Bearish / trending (daily ADX 51.6) in a **low-volatility** regime
  (ATR% 0.88%, 26th pct; India VIX 12.16, 17th pct). PCR-OI 0.95 (neutral), max-pain
  23,250 (spot 23,140.5), IV term 9.85 → 11.0 (contango), put skew +3.3.
- **Options buying:** the *only* statistically supported candidate is **ORB**, and only on
  a trending day: buy ATM CE/PE on a completed 15-min opening-range break, 30% premium
  stop, 50% target, exit by ~12:00, **1 lot max** (≈₹10k–26k). Expected value ≈ +₹120/trade
  with ~50% win rate — economically marginal.
- **Options selling:** **none.** Naked short straddle needs ~₹2.0L margin/lot
  (SPAN+exposure ≈13.5% of notional) and lost money on real premiums; credit spreads are
  rejected. A ₹3L account can hold ~1 naked lot or a few defined-risk spreads, but there
  is no validated edge.
- **No-trade condition:** range-bound session (ADX < 20 intraday / price oscillating inside
  the opening range), high-impact event risk, or any session where the opening range is
  not broken by a completed bar. On those days: **do not trade**.
- **Max capital to deploy:** ₹26k (1 ATM lot) per ORB signal; ₹52k absolute cap.
- **Maximum loss per trade:** ≈₹9k (3% of capital) at a 30% premium stop.
- **Expected risk:** 1.1–3.0% of capital per lot (minimum-lot forced).
- **Key invalidation:** intraday price re-enters the opening range after entry, or daily
  trend flips to range (ADX < 20). **Trades to avoid:** naked/credit short premium,
  wide-OTM lottery tickets, and any ORB entry in a confirmed range regime.
