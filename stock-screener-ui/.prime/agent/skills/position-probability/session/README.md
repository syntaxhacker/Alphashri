# Session scripts (provenance)

These are the **original working scripts** from the Nov-2026 IRFC / POWERGRID
investigations (2026-11-11). They are kept as the audit trail for the numbers
quoted in those conversations; the maintained, generalised versions live one
level up in `scripts/`.

| File | What it produced |
|---|---|
| `01_correlation_matrix_yfinance.py` | IRFC vs NIFTY/BANKNIFTY/SENSEX/PSU-BANK/MIDCAP correlation and beta by window (yfinance) |
| `02_cycle_legs_and_drawdowns.py` | Zigzag cycle legs, peak-to-peak extensions, forward returns after drawdowns |
| `03_probability_market_implied_upstox.py` | Upstox-sourced probability ensemble: bootstraps, log-normal, market-implied leg from the NIFTY/BANKNIFTY/MIDCP option chains |
| `04_conditional_momentum_trend.py` | Momentum/trend conditional tables (RSI bands, 200-DMA splits), RSI-peak decay |
| `05_rsi_peak_decay_adjustment.py` | Post-RSI-peak drift applied to the distribution, blended with the vol-only ensemble |
| `06_powergrid_analysis.py` | POWERGRID snapshot, momentum/trend, correlation vs 7 indices, cycle legs, RSI decay |
| `07_powergrid_probability.py` | POWERGRID P/B cycle, matched-state analog, probability to 2026-11-23 |

They write into `/tmp/opencode/` and contain symbol-specific constants (targets,
BVPS series, index lists). They are **not** the entry point — use
`scripts/position_probability.py` for new work. Kept because they show how each
number was derived, including the two bugs that were found and fixed on the way
(a bootstrap that multiplied returns instead of `(1+return)`, and an analog pool
drawn from a 2023+ window only, which excluded the 2022–23 melt-up episodes).
