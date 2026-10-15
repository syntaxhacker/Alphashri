# LRL+iFVG autoresearch worklog

| Run | Stage | Candidate | PF | Trades | A+ | Net points | Notes |
|---:|---|---|---:|---:|---:|---:|---|
| 0 | baseline | measured 4-touch/3m | 1.21 | 16 | 16 | +44.62 | Six separated random sessions; too small for a conclusion |
| 1 | validation/holdout | max_stop_45 | 1.52 / 1.03 | 26 / 12 | 23 / 10 | +122.14 / +4.07 | Validation winner; holdout advantage disappeared, do not promote |
| 2 | validation/holdout | tight_line_gap | 1.34 / 0.97 | 56 / 14 | 33 / 10 | +219.25 / -6.02 | More setups, but failed September holdout |
| 3 | validation/holdout | htf_15m_ema_alignment | 1.87 / 0.00 | 23 / 1 | 19 / 1 | +175.17 / -41.96 | Strong validation but suppressed almost all holdout setups; overfit |

The loop uses a fixed chronological split. Add one row per completed search
run after inspecting `autoresearch.jsonl`; do not change the split based on the
winner.

Current decision: keep the measured baseline unchanged. No candidate has yet
beaten it on the untouched September holdout with a useful number of setups.
