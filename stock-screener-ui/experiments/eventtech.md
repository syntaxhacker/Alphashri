# EVENT + TECHNICAL-TIMING backtest — Nifty-500, 10 weeks ending 2026-10-09

Fixed rules (fit nothing). Setup = prior Friday close only; no peeking:
signals use setup-session bars, execution uses outcome-week bars.
₹1L/trade, LONG, qty=floor(1L/entry), costs via `backtest/costs.py`
`calculate_trading_costs` on EVERY trade, 5bps adverse slippage both ways
(costs recomputed on slipped prices). Same-bar SL+target resolves to SL.
PF is net-profit/net-loss; expectancy = mean net/trade; maxDD on net equity.

## Per-variant results (net ₹; slip = with 5bps slippage)

| Variant | Split | Trades | Win% | Net | Net(slip) | Exp | PF | PF(slip) | maxDD | maxDD(slip) |
|---|---|---|---|---|---|---|---|---|---|---|
| V1 event-day drift | pooled | 12 | 33.3 | -18,885 | -20,057 | -1,574 | 0.27 | 0.25 | -21,647 | -22,622 |
| V1 | first-5 | 8 | 37.5 | -2,320 | -3,109 | -290 | 0.69 | 0.62 | -6,795 | -7,386 |
| V1 | last-5 | 4 | 25.0 | -16,564 | -16,948 | -4,141 | 0.10 | 0.09 | -18,372 | -18,656 |
| V2 event+accum | pooled | 9 | 33.3 | -18,884 | -19,761 | -2,098 | 0.22 | 0.20 | -19,839 | -20,618 |
| V2 | first-5 | 7 | 42.9 | -1,312 | -2,003 | -187 | 0.80 | 0.71 | -5,787 | -6,280 |
| V2 | last-5 | 2 | 0.0 | -17,572 | -17,758 | -8,786 | 0.00 | 0.00 | -17,572 | -17,758 |
| V3 pre-event | pooled | 66 | 53.0 | +48,375 | +41,905 | +733 | 1.44 | 1.37 | -24,717 | -25,595 |
| V3 | first-5 | 66 | 53.0 | +48,375 | +41,905 | +733 | 1.44 | 1.37 | -24,717 | -25,595 |
| V3 | last-5 | 0 | — | — | — | — | — | — | — | — |
| V4 QIP long | all | 0 | — | — | — | — | — | — | — | — |
| V4 QIP short-note | all | 0 | — | — | — | — | — | — | — | — |

Exits: V1 = 7 SL + 1 SL-same-bar + 2 TARGET + 2 Friday; V3 = 52
day-after-results + 14 Friday.

## Verdict

- **V1/V2: NO CONCLUSION (n=12/9 < 20).** Directionally negative, and the
  accumulation filter (V2) does not rescue it on this sample. Structural
  flaw exposed: SL = prior-day low after an event gap-up means risk is
  unbounded (NIACL: −16% single-trade loss, dominates both variants'
  pooled net). Any live version needs a risk cap (e.g. skip if risk > 3%).
- **V3: positive but NOT portable as stated (n=66, all in weeks 1–2).**
  All 66 triggers fall in Aug-2026 results season; weeks 6–10 produce zero
  triggers, so the first-5/last-5 split is degenerate and "pooled" is just
  Q1-season performance. Additional caveats: (a) no SL by spec — a −10k
  BLUESTARCO-style tail sits inside the PF 1.44; (b) earnings dates are
  realized (yfinance `earnings_dates`), not as-scheduled — mild lookahead,
  and 4/66 dates fall on Sat/Sun placeholders; (c) entry at Friday close is
  unexecutable at the quoted print without next-open slippage beyond the
  modeled 5bps. Needs an out-of-season test (Oct Q2 season just started)
  plus a stop before any sizing decision.
- **V4: EMPTY — no test possible.** Only 3 'qip' headlines exist in the
  window and none map to a (dataset-symbol, catalyst-session) pair:
  UNIMECH not in universe, WI11 symbol-code mismatch, PTC-dated-10-07 falls
  inside outcome week 10 and is coded 'PTC' vs dataset 'PTCIL'. The week-42
  PTCIL QIP follow-through is therefore invisible to this pipeline —
  symbol normalization, not the market, is the binding constraint.

## Hand verification (raw 1D cache candles)

- **NIACL w6 (V1/V2, SL):** setup 09-04 L=196.49=SL; Mon 09-07 O=233.90
  entry, qty=427; 09-07..09 L ≥ 199.52 no hit; 09-10 L=196.26 ≤ SL → exit
  196.49. gross=(196.49−233.90)×427=−15,974.07 ✓ net −16,051.90 ✓.
- **APLAPOLLO w1 (V3, Friday):** Fri 07-31 C=1819.50 entry, qty=54;
  results Sat 08-01 → exit-day Sun has no bar → Fri 08-07 C=1970.00 exit.
  gross=150.50×54=8,127.00 ✓ net +8,042.84 ✓.
- **NAUKRI w3 (V1/V2, TARGET):** setup 08-14 L=1337.00=SL; Mon 08-17
  O=1341.00, risk=4.00, tgt=1353.00; 08-17 H=1374 ≥ tgt, L=1340.70 > SL →
  exit 1353.00. gross=12×74=888.00 ✓ net +805.57 ✓.

## Repro

`python3 experiments/eventtech_run.py --phase fetch` (yfinance earnings
dates → `experiments/eventtech_earn_cache.json`, cached/resumable) then
`--phase run` (writes `experiments/eventtech.json`, this file's numbers).
Reads DB read-only; writes only `experiments/eventtech*`.
