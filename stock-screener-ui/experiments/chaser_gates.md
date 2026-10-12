# 52W Chaser gate calibration — setup ≤2026-10-03, outcome Oct 5–9

Universe: 323 liquid symbols; **6 candidates** within 3.0% of 52w high as of setup close (2026-10-01). Outcome = setup-close → Fri 2026-10-09 close (buy-and-hold proxy).
Base: 3/6 profitable (50.0%); gross profit +25.45pp, gross loss -17.54pp, net 7.91pp (equal-weight, sum of %).

## Per-gate precision / recall

| gate | pass rate | recall P(pass|profit) | P(pass|unprof) | precision P(profit|pass) | base | blocked-profit tt (n) | noise avoided (n) | pp blocked / noise |
|---|---|---|---|---|---|---|---|---|
| adx | 0.833 | 0.667 | 1.0 | 0.4 | 0.5 | 17.15 (1) | 0 | None |
| rsi_lo | 1.0 | 1.0 | 1.0 | 0.5 | 0.5 | 0.0 (0) | 0 | None |
| rsi_hi | 0.667 | 0.667 | 0.667 | 0.5 | 0.5 | 6.26 (1) | 1 | 6.26 |
| rsi | 0.667 | 0.667 | 0.667 | 0.5 | 0.5 | 6.26 (1) | 1 | 6.26 |
| vol | 0.333 | 0.333 | 0.333 | 0.5 | 0.5 | 19.19 (2) | 2 | 9.59 |
| ma50 | 1.0 | 1.0 | 1.0 | 0.5 | 0.5 | 0.0 (0) | 0 | None |
| ma200 | 1.0 | 1.0 | 1.0 | 0.5 | 0.5 | 0.0 (0) | 0 | None |
| all | 0.0 | 0.0 | 0.0 | None | 0.5 | 25.45 (3) | 3 | 8.48 |

Reading: precision ≈ base rate ⇒ gate has no discrimination (pure noise). Recall ≪ 1 with high blocked-profit ⇒ gate kills profit.

## Sweeps (one threshold moved, rest at default)
### adx_min

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 15 | 0 | 0 | None | 0.0 | None |
| 20 | 0 | 0 | None | 0.0 | None |
| 25 | 0 | 0 | None | 0.0 | None |
| 30 | 0 | 0 | None | 0.0 | None |
| 35 | 0 | 0 | None | 0.0 | None |

### rsi_lo

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 40 | 0 | 0 | None | 0.0 | None |
| 45 | 0 | 0 | None | 0.0 | None |
| 50 | 0 | 0 | None | 0.0 | None |
| 55 | 0 | 0 | None | 0.0 | None |
| 60 | 0 | 0 | None | 0.0 | None |

### rsi_hi

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 60 | 0 | 0 | None | 0.0 | None |
| 65 | 0 | 0 | None | 0.0 | None |
| 70 | 0 | 0 | None | 0.0 | None |
| 75 | 1 | 1 | 1.0 | 6.26 | 6.26 |
| 80 | 2 | 1 | 0.5 | -0.19 | -0.1 |

### rsi_off_hi

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| inf (no upper cap) | 2 | 1 | 0.5 | -0.19 | -0.1 |

### vol_mult

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 1.0 | 2 | 1 | 0.5 | -4.24 | -2.12 |
| 1.2 | 1 | 0 | 0.0 | -6.28 | -6.28 |
| 1.5 | 0 | 0 | None | 0.0 | None |
| 1.8 | 0 | 0 | None | 0.0 | None |
| 2.0 | 0 | 0 | None | 0.0 | None |

### drop_one_gate

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| adx | 0 | 0 | None | 0.0 | None |
| rsi | 2 | 1 | 0.5 | -0.19 | -0.1 |
| vol | 3 | 1 | 0.333 | -9.05 | -3.02 |
| ma50 | 0 | 0 | None | 0.0 | None |
| ma200 | 0 | 0 | None | 0.0 | None |

NO filter: {'n_entries': 6, 'n_profitable': 3, 'win_rate': 0.5, 'total_fwd_pct': 7.91, 'avg_fwd_pct': 1.32}  |  FULL default filter: {'n_entries': 0, 'n_profitable': 0, 'win_rate': None, 'total_fwd_pct': 0.0, 'avg_fwd_pct': None}

## Robustness cohorts

### wide_5pct: n=14, profitable=7, no-filter total -0.09pp (raw) / -2.98pp (SL3/TP5), full-filter {'n_entries': 1, 'n_profitable': 1, 'win_rate': 1.0, 'total_fwd_pct': 0.2, 'avg_fwd_pct': 0.2} (raw) / {'n_entries': 1, 'n_profitable': 1, 'win_rate': 1.0, 'total_fwd_pct': 5.0, 'avg_fwd_pct': 5.0} (SL3/TP5)

per-gate (raw week hold)

| gate | recall | P(pass|unprof) | precision | blocked-profit (n) | avoided-loss (n) | pp blocked/noise |
|---|---|---|---|---|---|---|
| adx | 0.571 | 0.857 | 0.4 | 19.72 (3) | -2.7 (1) | 19.72 |
| rsi_lo | 1.0 | 1.0 | 0.5 | 0.0 (0) | 0.0 (0) | None |
| rsi_hi | 0.857 | 0.857 | 0.5 | 6.26 (1) | -6.45 (1) | 6.26 |
| rsi | 0.857 | 0.857 | 0.5 | 6.26 (1) | -6.45 (1) | 6.26 |
| vol | 0.286 | 0.286 | 0.5 | 24.41 (5) | -21.81 (5) | 4.88 |
| ma50 | 1.0 | 1.0 | 0.5 | 0.0 (0) | 0.0 (0) | None |
| ma200 | 1.0 | 1.0 | 0.5 | 0.0 (0) | 0.0 (0) | None |
| all | 0.143 | 0.0 | 1.0 | 30.67 (6) | -30.96 (7) | 4.38 |

per-gate (SL3/TP5 exits)

| gate | recall | P(pass|unprof) | precision | blocked-profit (n) | avoided-loss (n) | pp blocked/noise |
|---|---|---|---|---|---|---|
| adx | 0.667 | 0.75 | 0.4 | 2.57 (2) | -6.0 (2) | 1.29 |
| rsi_lo | 1.0 | 1.0 | 0.429 | 0.0 (0) | 0.0 (0) | None |
| rsi_hi | 0.833 | 0.875 | 0.417 | 5.0 (1) | -3.0 (1) | 5.0 |
| rsi | 0.833 | 0.875 | 0.417 | 5.0 (1) | -3.0 (1) | 5.0 |
| vol | 0.333 | 0.25 | 0.5 | 10.22 (4) | -17.2 (6) | 1.7 |
| ma50 | 1.0 | 1.0 | 0.429 | 0.0 (0) | 0.0 (0) | None |
| ma200 | 1.0 | 1.0 | 0.429 | 0.0 (0) | 0.0 (0) | None |
| all | 0.167 | 0.0 | 1.0 | 15.22 (5) | -23.2 (8) | 1.9 |

#### wide_5pct / adx_min (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 15 | 2 | 1 | 0.5 | -2.5 | -1.25 |
| 20 | 2 | 1 | 0.5 | -2.5 | -1.25 |
| 25 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 30 | 0 | 0 | None | 0.0 | None |
| 35 | 0 | 0 | None | 0.0 | None |

#### wide_5pct / rsi_lo (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 40 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 45 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 50 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 55 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 60 | 0 | 0 | None | 0.0 | None |

#### wide_5pct / rsi_hi (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 60 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 65 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 70 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 75 | 2 | 2 | 1.0 | 6.46 | 3.23 |
| 80 | 3 | 2 | 0.667 | 0.01 | 0.0 |

#### wide_5pct / rsi_off_hi (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| inf (no upper cap) | 3 | 2 | 0.667 | 0.01 | 0.0 |

#### wide_5pct / vol_mult (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 1.0 | 3 | 2 | 0.667 | -4.04 | -1.35 |
| 1.2 | 2 | 1 | 0.5 | -6.08 | -3.04 |
| 1.5 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 1.8 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| 2.0 | 0 | 0 | None | 0.0 | None |

#### wide_5pct / drop_one_gate (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| adx | 2 | 1 | 0.5 | -2.5 | -1.25 |
| rsi | 3 | 2 | 0.667 | 0.01 | 0.0 |
| vol | 8 | 3 | 0.375 | -16.92 | -2.12 |
| ma50 | 1 | 1 | 1.0 | 0.2 | 0.2 |
| ma200 | 1 | 1 | 1.0 | 0.2 | 0.2 |

#### wide_5pct / adx_min (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 15 | 2 | 1 | 0.5 | 2.0 | 1.0 |
| 20 | 2 | 1 | 0.5 | 2.0 | 1.0 |
| 25 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 30 | 0 | 0 | None | 0.0 | None |
| 35 | 0 | 0 | None | 0.0 | None |

#### wide_5pct / rsi_lo (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 40 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 45 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 50 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 55 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 60 | 0 | 0 | None | 0.0 | None |

#### wide_5pct / rsi_hi (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 60 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 65 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 70 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 75 | 2 | 2 | 1.0 | 10.0 | 5.0 |
| 80 | 3 | 2 | 0.667 | 7.0 | 2.33 |

#### wide_5pct / rsi_off_hi (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| inf (no upper cap) | 3 | 2 | 0.667 | 7.0 | 2.33 |

#### wide_5pct / vol_mult (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 1.0 | 3 | 2 | 0.667 | 7.0 | 2.33 |
| 1.2 | 2 | 1 | 0.5 | 2.0 | 1.0 |
| 1.5 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 1.8 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| 2.0 | 0 | 0 | None | 0.0 | None |

#### wide_5pct / drop_one_gate (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| adx | 2 | 1 | 0.5 | 2.0 | 1.0 |
| rsi | 3 | 2 | 0.667 | 7.0 | 2.33 |
| vol | 8 | 3 | 0.375 | -1.55 | -0.19 |
| ma50 | 1 | 1 | 1.0 | 5.0 | 5.0 |
| ma200 | 1 | 1 | 1.0 | 5.0 | 5.0 |

### pooled_6wk_5pct: n=173, profitable=58, no-filter total -222.81pp (raw) / -166.21pp (SL3/TP5), full-filter {'n_entries': 20, 'n_profitable': 9, 'win_rate': 0.45, 'total_fwd_pct': -15.71, 'avg_fwd_pct': -0.79} (raw) / {'n_entries': 20, 'n_profitable': 7, 'win_rate': 0.35, 'total_fwd_pct': -15.53, 'avg_fwd_pct': -0.78} (SL3/TP5)

per-gate (raw week hold)

| gate | recall | P(pass|unprof) | precision | blocked-profit (n) | avoided-loss (n) | pp blocked/noise |
|---|---|---|---|---|---|---|
| adx | 0.655 | 0.626 | 0.345 | 65.24 (20) | -127.77 (43) | 1.52 |
| rsi_lo | 0.983 | 0.965 | 0.339 | 2.15 (1) | -9.54 (4) | 0.54 |
| rsi_hi | 0.793 | 0.8 | 0.333 | 70.09 (12) | -83.42 (23) | 3.05 |
| rsi | 0.776 | 0.765 | 0.338 | 72.24 (13) | -92.96 (27) | 2.68 |
| vol | 0.259 | 0.252 | 0.341 | 176.24 (43) | -334.73 (86) | 2.05 |
| ma50 | 0.966 | 0.991 | 0.329 | 3.38 (2) | -3.08 (1) | 3.38 |
| ma200 | 1.0 | 1.0 | 0.335 | 0.0 (0) | 0.0 (0) | None |
| all | 0.155 | 0.096 | 0.45 | 195.09 (49) | -402.19 (104) | 1.88 |

per-gate (SL3/TP5 exits)

| gate | recall | P(pass|unprof) | precision | blocked-profit (n) | avoided-loss (n) | pp blocked/noise |
|---|---|---|---|---|---|---|
| adx | 0.674 | 0.622 | 0.282 | 42.02 (15) | -125.4 (48) | 0.88 |
| rsi_lo | 0.978 | 0.969 | 0.268 | 2.15 (1) | -9.0 (4) | 0.54 |
| rsi_hi | 0.804 | 0.795 | 0.268 | 45.0 (9) | -66.66 (26) | 1.73 |
| rsi | 0.783 | 0.764 | 0.271 | 47.15 (10) | -75.66 (30) | 1.57 |
| vol | 0.283 | 0.244 | 0.295 | 116.63 (33) | -248.09 (96) | 1.21 |
| ma50 | 0.957 | 0.992 | 0.259 | 3.38 (2) | -3.0 (1) | 3.38 |
| ma200 | 1.0 | 1.0 | 0.266 | 0.0 (0) | 0.0 (0) | None |
| all | 0.152 | 0.102 | 0.35 | 145.41 (39) | -296.09 (114) | 1.28 |

#### pooled_6wk_5pct / adx_min (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 15 | 27 | 10 | 0.37 | -30.0 | -1.11 |
| 20 | 23 | 9 | 0.391 | -23.44 | -1.02 |
| 25 | 20 | 9 | 0.45 | -15.71 | -0.79 |
| 30 | 11 | 4 | 0.364 | -19.35 | -1.76 |
| 35 | 6 | 2 | 0.333 | -8.78 | -1.46 |

#### pooled_6wk_5pct / rsi_lo (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 40 | 20 | 9 | 0.45 | -15.71 | -0.79 |
| 45 | 20 | 9 | 0.45 | -15.71 | -0.79 |
| 50 | 20 | 9 | 0.45 | -15.71 | -0.79 |
| 55 | 18 | 9 | 0.5 | -9.26 | -0.51 |
| 60 | 14 | 7 | 0.5 | -6.46 | -0.46 |

#### pooled_6wk_5pct / rsi_hi (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 60 | 6 | 2 | 0.333 | -9.25 | -1.54 |
| 65 | 12 | 5 | 0.417 | -4.85 | -0.4 |
| 70 | 20 | 9 | 0.45 | -15.71 | -0.79 |
| 75 | 26 | 11 | 0.423 | -15.13 | -0.58 |
| 80 | 29 | 11 | 0.379 | -37.36 | -1.29 |

#### pooled_6wk_5pct / rsi_off_hi (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| inf (no upper cap) | 29 | 11 | 0.379 | -37.36 | -1.29 |

#### pooled_6wk_5pct / vol_mult (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 1.0 | 36 | 14 | 0.389 | -102.29 | -2.84 |
| 1.2 | 28 | 10 | 0.357 | -111.78 | -3.99 |
| 1.5 | 20 | 9 | 0.45 | -15.71 | -0.79 |
| 1.8 | 11 | 7 | 0.636 | -3.42 | -0.31 |
| 2.0 | 9 | 5 | 0.556 | -3.73 | -0.41 |

#### pooled_6wk_5pct / drop_one_gate (raw)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| adx | 30 | 12 | 0.4 | -27.75 | -0.93 |
| rsi | 29 | 11 | 0.379 | -37.36 | -1.29 |
| vol | 81 | 28 | 0.346 | -158.4 | -1.96 |
| ma50 | 20 | 9 | 0.45 | -15.71 | -0.79 |
| ma200 | 20 | 9 | 0.45 | -15.71 | -0.79 |

#### pooled_6wk_5pct / adx_min (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 15 | 27 | 8 | 0.296 | -26.8 | -0.99 |
| 20 | 23 | 7 | 0.304 | -22.8 | -0.99 |
| 25 | 20 | 7 | 0.35 | -15.53 | -0.78 |
| 30 | 11 | 3 | 0.273 | -17.04 | -1.55 |
| 35 | 6 | 1 | 0.167 | -13.15 | -2.19 |

#### pooled_6wk_5pct / rsi_lo (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 40 | 20 | 7 | 0.35 | -15.53 | -0.78 |
| 45 | 20 | 7 | 0.35 | -15.53 | -0.78 |
| 50 | 20 | 7 | 0.35 | -15.53 | -0.78 |
| 55 | 18 | 7 | 0.389 | -9.53 | -0.53 |
| 60 | 14 | 5 | 0.357 | -10.57 | -0.76 |

#### pooled_6wk_5pct / rsi_hi (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 60 | 6 | 2 | 0.333 | -4.96 | -0.83 |
| 65 | 12 | 4 | 0.333 | -7.49 | -0.62 |
| 70 | 20 | 7 | 0.35 | -15.53 | -0.78 |
| 75 | 26 | 9 | 0.346 | -15.83 | -0.61 |
| 80 | 29 | 10 | 0.345 | -16.83 | -0.58 |

#### pooled_6wk_5pct / rsi_off_hi (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| inf (no upper cap) | 29 | 10 | 0.345 | -16.83 | -0.58 |

#### pooled_6wk_5pct / vol_mult (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| 1.0 | 36 | 13 | 0.361 | -17.0 | -0.47 |
| 1.2 | 28 | 8 | 0.286 | -31.53 | -1.13 |
| 1.5 | 20 | 7 | 0.35 | -15.53 | -0.78 |
| 1.8 | 11 | 6 | 0.545 | 3.83 | 0.35 |
| 2.0 | 9 | 4 | 0.444 | -1.28 | -0.14 |

#### pooled_6wk_5pct / drop_one_gate (SL3/TP5)

| setting | n | n_prof | win_rate | total_pp | avg_pp |
|---|---|---|---|---|---|
| adx | 30 | 10 | 0.333 | -21.02 | -0.7 |
| rsi | 29 | 10 | 0.345 | -16.83 | -0.58 |
| vol | 81 | 22 | 0.272 | -76.6 | -0.95 |
| ma50 | 20 | 7 | 0.35 | -15.53 | -0.78 |
| ma200 | 20 | 7 | 0.35 | -15.53 | -0.78 |

## Verdict (primary week, raw hold)

Highest raw pp-blocked/noise on Oct 5–9: `vol` (19.19pp blocked vs 2 noise trades avoided). Full verdict across cohorts + strategy exits: see Recommendation below.

## Recommendation (pooled 6wk SL3/TP5 + primary week)

- WORST GATE = RSI upper cap (RSI > 70 veto). Pooled SL3/TP5: blocks 9 profitable (45.0pp incl. TP-capped) vs 26 noise avoided = 1.73pp killed per noise avoided -- highest of any binding gate (raw-hold: 3.05, also highest). Primary week: blocked STLTECH's TP (+6.26 raw / +5.0 strat) over 2.02 RSI points (72.02 vs 70). Conceptually it fights the setup's premise: a 52w-high chaser SHOULD be overbought. Fix: rsi_hi 70 -> 75 (pooled sweep: rsi_hi 75 keeps every vol-1.8 gain; 80/off re-admits WELSPUNLIV-type blowoffs).
- TOP FIX = volume gate 1.5x -> 1.8x (keep, but tighten). The vol gate is the highest-ABSOLUTE-impact gate: pooled strat it blocks 116.63pp profit AND avoids 248.09pp loss; 1.5x lets in too many dead breakouts. Sweep (pooled SL3/TP5, others default): 1.0x -> -17.00 (n=36), 1.2x -> -31.53 (n=28), 1.5x -> -15.53 (n=20), **1.8x -> +3.83 (n=11, win 0.545)** -- the ONLY positive configuration --, 2.0x -> -1.28 (n=9).
- COMBINED recalibration {vol 1.8, rsi_hi 75} (rest default): pooled-strat -15.53 -> +3.53pp (DELTA +19.06pp over 6 weeks, n=17, win 0.471); LAST WEEK strat 0 -> +5.0pp (DELTA +5.0pp: recovers STLTECH TP; CUPID still vetoed by ADX 24.34<25 and vol 1.10<1.8, LGEINDIA by vol 1.01<1.8). Raw-hold last week: 0 -> +6.26pp. ADX 25 is already at its sweep optimum -- do NOT loosen it (adx 20: pooled -22.8).
- PURE-NOISE gates (no discrimination, delete or demote to logging-only): MA200 = 100% pass on all cohorts (candidates at 52w highs are definitionally above MA200); MA50 = 98-100% pass; RSI_lo = 97-100% pass (recall 0.978-1.0). Drop-one ablation: removing ma50/ma200 changes pooled total by exactly 0.00pp. They add config surface and false confidence, zero filtering value.
- REGIME CAVEAT: pooled no-filter buy-and-hold = -222.81pp raw / -166.21pp strat (avg -1.29%/-0.96% per setup). Chasing 52w highs with a 1-week hold had NEGATIVE edge Aug-Oct 2026; gates are loss-cutters, not edge creators. The +3.53pp recalibrated total is 17 trades -- fragile, needs out-of-sample validation before sizing. Also: pooled reuses symbols across weeks (setups judged independently); costs excluded (add ~0.1%/round-trip).

See chaser_gates.json for full candidate table + sweep numbers.

## Bug list (static review of `_check_entry_filters` / `_should_enter`)
- BUG-1 (fail-OPEN on NaN): every gate is guarded by `pd.notna(...)` -> NaN *passes*. ADX needs 14 bars, MA50 50 bars, MA200 200 bars, but the 52w tracker only requires min_periods=20. Any symbol with 20-199 bars of history sails through the MA200 gate (and short-history symbols skip ADX/RSI too). Filters are silently weakest exactly where breakouts are most explosive (recent listings). Fix: require `idx >= 200` (or longest lookback) when enable_filters=True, else skip entry.
- BUG-2 (fail-OPEN on exception / date miss): `except Exception: return True` and `if not mask.any(): return True` mean any tz/format mismatch or missing bar date disables ALL filters silently. No logging. Fix: log + return False (fail closed) when filters are explicitly enabled.
- BUG-3 (`mask.argmax()` on duplicate/no-match edge): guarded by the mask.any() check, so benign today; but if the index contains duplicate dates (corporate-action re-fetch, tz-duplicate midnight bars) argmax takes the FIRST match while iloc positions of the precalc series assume unique dates -> gate evaluated on the wrong bar. Fix: use `df.index.get_indexer_for` / exact `.loc[bar_date]` match instead of boolean-mask argmax.
- BUG-4 (same-bar volume inclusion, minor): the volume gate compares the ENTRY bar's own volume against its 20d average that *includes* the entry bar, diluting real spikes (spike inflates its own baseline by ~5%). Breakout-day volume should be compared to the prior-20-bar average EXCLUDING the current bar (`shift(1)`). Small but systematic bias against genuine breakouts.
- BUG-5 (config mismatch, not math): Nautilus defaults (entry 2.0 / SL 2.0 / TP 3.0) differ from run_single_stock_backtest + get_params defaults (3.0 / 3.0 / 5.0), and enable_filters defaults to False everywhere -- so published backtests likely ran with filters OFF while the gate debate assumes ON. Any calibration must state which config it used.
- NO-LOOKAHEAD found: ADX/RSI/MA/vol-avg are all causal (Wilder/rolling on history only), the 52w tracker updates on the current bar's high before the distance check (intended -- chaser enters AT new highs), and precalc iloc[idx] aligns to the entry bar date. Indicator timing is clean; the issues are fail-open handling, not lookahead.