# Full-universe (all_equity) L1 + next-open rerun, 10w ending 2026-10-09

Universe all_equity n=2685 (overlap nifty500: 494); progress symbols=2685; gate=setup close within 10.0% of level both sides; Rs 1L/trade LONG; costs=calculate_trading_costs every trade.

## (b) Primary: all_equity + gate, per week (no-slip net)

| wk | setup | trades | win% | net | expectancy | pf |
|---|---|---|---|---|---|---|
| 1 | 2026-07-31 | 142 | 35.9 | -40301.83 | -283.82 | 0.78 |
| 2 | 2026-08-07 | 114 | 29.8 | -82490.24 | -723.6 | 0.59 |
| 3 | 2026-08-14 | 103 | 37.9 | -7006.33 | -68.02 | 0.95 |
| 4 | 2026-08-21 | 102 | 23.5 | -65557.57 | -642.72 | 0.57 |
| 5 | 2026-08-28 | 66 | 37.9 | -15520.53 | -235.16 | 0.86 |
| 6 | 2026-09-04 | 86 | 18.6 | -139709.65 | -1624.53 | 0.33 |
| 7 | 2026-09-11 | 27 | 33.3 | 11687.92 | 432.89 | 1.4 |
| 8 | 2026-09-18 | 54 | 25.9 | -61321.97 | -1135.59 | 0.49 |
| 9 | 2026-09-25 | 33 | 12.1 | -69460.11 | -2104.85 | 0.14 |
| 10 | 2026-10-01 | 45 | 15.6 | -89229.91 | -1982.89 | 0.33 |

## Pooled comparison (no-slip)

| variant | trades | win% | net | expectancy | pf | costs |
|---|---|---|---|---|---|---|
| n500_nogate | 179 | 33.0 | -101058.56 | -564.57 | 0.64 | 14631.88 |
| n500_gate | 179 | 33.0 | -101058.56 | -564.57 | 0.64 | 14631.88 |
| alleq_nogate | 774 | 28.8 | -560584.39 | -724.27 | 0.59 | 63483.61 |
| alleq_gate | 772 | 28.9 | -558910.22 | -723.98 | 0.59 | 63319.21 |
| non500_gate | 593 | 27.7 | -457851.66 | -772.09 | 0.58 | 48687.33 |
| smallcap_gate | 334 | 29.6 | -354338.32 | -1060.89 | 0.58 | 27404.23 |
| largemid_gate | 258 | 33.7 | -146772.4 | -568.89 | 0.67 | 21102.06 |
| unknown_mcap_gate | 180 | 20.6 | -57799.5 | -321.11 | 0.4 | 14812.92 |
| gated_out | 2 | 0.0 | -1674.17 | -837.09 | 0.0 | 164.4 |

## (a) Long-side proximity gate: did it change anything?

Gated-out simulated trades: 2 net -1674.17; of which with box level: 0 net 0; by rule: {"B": 2}.
Gated-out dist range: 10.9..11.3%.
Verdict: NO mirror bug. Both gated rows are rule-B with HI20 (no-box) levels at ~11% -- zero box-high trades were stale. Legs A/C/B already cap distance (dist_box<=6% / dist_20d<=4% / close_gap<=8%), and box-high levels only trade via rule A (dist<=6%), so a stale far-above box can never become the traded level. The short-side bug (unconstrained box-LOW level choice in S1) has no long-side counterpart in this screen.
n500 reproduction anchor (entry_timing B0 no-slip): {"trades": 179, "win_pct": 33.0, "net": -101058.56, "expectancy": -564.57, "pf": 0.64, "maxdd": -126267.92} vs rerun n500_nogate {"trades": 179, "win_pct": 33.0, "net": -101058.56, "expectancy": -564.57, "pf": 0.64, "maxdd": -126267.92, "costs": 14631.88, "gross": -86426.68}.

## (c) nifty500 vs all_equity (both gated)

n500_gate net -101058.56 / 179 trades; alleq_gate net -558910.22 / 772 trades; non-nifty500 net -457851.66 / 593 trades (exp -772.09, pf 0.58). Broadening the universe 501 -> 2685 roughly quadruples trades and quintuples losses; per-trade expectancy worsens -565 -> -724.

## (d) Smallcap-only cut (mcap < Rs 8000cr)

Source: yfinance marketCap (INR) primary for all traded symbols; TradingView market_cap_basic bulk for the rest -- NOTE its units are ~96.9x smaller than INR (TV-side denomination, NOT INR; calibrated tv_scale_yf_over_tv=96.86801976826072 on n=389 overlaps; TV-only leftovers rescaled). mcap coverage 1711/2685; 93 traded symbols (mostly ETFs/thematic products, 180 trades) unclassifiable by either source. Caveat: mcap is CURRENT (Oct-2026), not as-of-setup -- boundary crossers misclassify.

smallcap_gate net -354338.32 / 334 trades (exp -1060.89, pf 0.58); largemid_gate net -146772.4 / 258 trades (exp -568.89, pf 0.67); unknown-mcap (ETF) net -57799.5 / 180 trades. Verdict: the edge does NOT live in smallcaps -- per-trade loss is ~1.9x worse there (-1061 vs -569 large/mid). No cut is profitable; smallcaps just lose faster.

## Side finding for the parent session (repo bug, out of mission)

experiments/benchmark_52w.py, benchmark_adx_btst.py and experiments/value_screener.py divide TradingView market_cap_basic by 1e7 assuming INR. Calibrated against yfinance on 389 symbols, TV units are ~96.9x smaller than INR -- those filters are ~100x looser than labelled (e.g. a '100Cr+' filter is really ~9700Cr+).

## Hand-verification (raw candles vs booked)


## 3BBLACKBIO wk5 rules=['B'] gate=True dist=1.51%
booked: entry=1528.5 sl=1461.78 tgt=1661.94 qty=65 exit=1461.78 why=SL gross=-4336.8 costs=80.98 net=-4417.78
  2026-08-28: {'date': '2026-08-28', 'open': 1362.0, 'high': 1463.0, 'low': 1362.0, 'close': 1441.2, 'vol': 45446.0}
  2026-08-31: {'date': '2026-08-31', 'open': 1458.1, 'high': 1510.0, 'low': 1430.0, 'close': 1447.8, 'vol': 33118.0}
  2026-09-01: {'date': '2026-09-01', 'open': 1455.0, 'high': 1546.8, 'low': 1451.1, 'close': 1523.5, 'vol': 40078.0}
  2026-09-02: {'date': '2026-09-02', 'open': 1528.5, 'high': 1588.9, 'low': 1469.1, 'close': 1478.6, 'vol': 50928.0}
  2026-09-03: {'date': '2026-09-03', 'open': 1500.0, 'high': 1550.0, 'low': 1481.0, 'close': 1486.2, 'vol': 20142.0}
  2026-09-04: {'date': '2026-09-04', 'open': 1508.5, 'high': 1513.9, 'low': 1411.2, 'close': 1460.1, 'vol': 19626.0}
  recompute: gross=-4336.8 costs=80.98 -> MATCH

## ACMESOLAR wk8 rules=['B'] gate=True dist=1.25%
booked: entry=460.0 sl=441.81 tgt=496.38 qty=217 exit=441.81 why=SL gross=-3947.23 costs=81.25 net=-4028.48
  2026-09-18: {'date': '2026-09-18', 'open': 411.5, 'high': 440.7, 'low': 411.5, 'close': 435.25, 'vol': 12038412.0}
  2026-09-21: {'date': '2026-09-21', 'open': 439.0, 'high': 464.45, 'low': 437.5, 'close': 458.1, 'vol': 6919009.0}
  2026-09-22: {'date': '2026-09-22', 'open': 460.0, 'high': 476.9, 'low': 441.55, 'close': 458.65, 'vol': 3701858.0}
  2026-09-23: {'date': '2026-09-23', 'open': 461.6, 'high': 476.4, 'low': 445.6, 'close': 452.3, 'vol': 2719156.0}
  2026-09-24: {'date': '2026-09-24', 'open': 454.8, 'high': 459.45, 'low': 444.15, 'close': 446.65, 'vol': 1545806.0}
  2026-09-25: {'date': '2026-09-25', 'open': 446.9, 'high': 449.75, 'low': 431.5, 'close': 442.9, 'vol': 3082821.0}
  recompute: gross=-3947.23 costs=81.25 -> MATCH

## AAREYDRUGS wk10 rules=['B'] gate=True dist=3.85%
booked: entry=106.24 sl=102.09 tgt=114.54 qty=941 exit=102.09 why=SL gross=-3905.15 costs=81.32 net=-3986.47
  2026-10-01: {'date': '2026-10-01', 'open': 104.3, 'high': 107.85, 'low': 102.49, 'close': 103.85, 'vol': 449714.0}
  2026-10-05: {'date': '2026-10-05', 'open': 104.02, 'high': 106.51, 'low': 100.5, 'close': 104.07, 'vol': 234591.0}
  2026-10-06: {'date': '2026-10-06', 'open': 104.0, 'high': 108.98, 'low': 101.01, 'close': 107.85, 'vol': 184313.0}
  2026-10-07: {'date': '2026-10-07', 'open': 108.1, 'high': 110.0, 'low': 104.48, 'close': 108.81, 'vol': 497489.0}
  2026-10-08: {'date': '2026-10-08', 'open': 106.24, 'high': 108.79, 'low': 103.37, 'close': 103.89, 'vol': 436502.0}
  2026-10-09: {'date': '2026-10-09', 'open': 102.01, 'high': 105.7, 'low': 100.54, 'close': 104.08, 'vol': 152052.0}
  recompute: gross=-3905.15 costs=81.32 -> MATCH

## Skips

{
 "no-break": 2074,
 "extended": 603,
 "setup-bars<60": 2189,
 "no-bars": 7,
 "break-friday-no-next-bar": 95
}
