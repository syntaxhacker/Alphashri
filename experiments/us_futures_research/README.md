# US Futures ORB Research — ES/NQ/GC

Verifies YouTuber claim: ORB breakout+retest 1% risk 1:2RR → 19.7% → 51.5% via 4th-consec close entry.

**Data:** `/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main` — ES/NQ/GC 1-min 2026-01-20→2026-04-15 (~58 RTH sessions), 1h/4h back to 2025-03.

**Baseline (ES 15m range, retest @ edge, SL opposite, TP2R, EOD flat, 1% comp, cost 1pt):** 54tr PF1.64 net15.5% gross18.2% DD-6.7%

## Files
- `orb_verify.py` — main backtest (retest vs 4-consec run) for ES/NQ/GC, 15/30m ranges
- `orb_showcase.py` — generates self-contained ECharts HTML with markers
- `opt_width_eff.py/.txt` — opening-range quality filters (width/efficiency/drift)
- `opt_timing.py/.txt` — gap/timing filters (skip gap>1% → PF2.06 net20.6%)
- `opt_sltp.py/.txt` — SL {0.7,1.0,1.3,tight} × TP {1,1.5,2,2.5,3} grid
- `opt_range_dur.py/.txt` — OR durations 9m→60m vs 1-min pure

## Key finding
4th-candle chase fails on ES (PF1.64→1.27) — risk inflates 0.38× range, TP hit only 9/61. Robust edge is **skip gap>1% (PF2.06)** and **OR/prevOR≥0.8 (PF2.17)**, not the YouTuber's trick. Tight SL catastrophic.

Run: `python orb_verify.py`  `python orb_showcase.py` → `../../stock-screener-ui/reports/ORB_ES_showcase/orb_es_showcase.html`
