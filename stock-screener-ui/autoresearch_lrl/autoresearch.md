# Autoresearch: MNQ/NQ "LRL" strategy (sweep -> iFVG -> retrace entry -> exit)

## Objective
Find the strategy **concepts/parameters** that give a robust edge (not curve-fit) on the
sweep -> iFVG model, across 21 months of real NQ 1-min data (Dukascopy), walk-forward split.

## Metrics
- **Primary**: `oos_avgR` = avg R/trade on the held-out period (2026), higher better.
- **Robustness (used for selection)**: `min(is_avgR, oos_avgR)` — must be positive in BOTH 2025 and 2026.
- Secondary: `is_avgR`, `oos_n`, `oos_pf`, `oos_win`.

## How to Run
`./autoresearch.sh` — writes `METRIC name=value` lines. Params in `params.json`, drivers `drive.py` / `drive2.py`.

## Data
Dukascopy `INSTRUMENT_IDX_AMERICA_E_NQ_100` 1-min, 2025-01 → 2026-10 (176,423 RTH rows, 460 days),
fetched via `dukascopy-python`. IS = 2025, OOS = 2026. RTH 09:30-16:00 ET only.

## Strategy tested
1. Liquidity sweep of a prior swing low/high (wick beyond + close back inside).
2. Displacement candle leaves an FVG (the iFVG).
3. **Entry on the retrace INTO the iFVG** (limit) — critical.
4. SL at the sweep extreme ± `sl_buf`.
5. Exit: fixed R or a **trailing stop** `trail`× risk behind the peak.

## Findings
- **Entry trigger is the key concept**: entering *at* the iFVG formation bar close is ~0 edge;
  entering on the **retrace into** the iFVG is what makes it work.
- **Exit**: a **tight trailing stop** dominates fixed-R, partials, breakeven, and
  "exit at opposing liquidity". Fixed-R is positive but much weaker; EOD is negative.
- **SL at the sweep extreme with no buffer** (`sl_buf=0`) is better than a wider stop.
- `disp_body ≥ 0.5`, `buf ≈ 3`, `entry_win ≈ 5` all help slightly.

## Best robust params (post look-ahead fix)
`disp_body=0.5, sl_buf=0, trail=0.1, entry_win=5, buf=3, fvg_min=3, atr_mult=1.2, look_disp=5, tf=5`
→ **IS(2025) +0.45R/trade, OOS(2026) +1.74R/trade, n=51**.

## Caveats
- Data is a strong bull regime (NQ 2025-2026) — longs benefit; short side was weaker.
- Small OOS n; the late-2026 OOS is more favourable than 2025 (regime).
- Gross of costs.
- A look-ahead bug (using the entry bar's high) was found and removed mid-session — the
  pre-fix numbers (+1.5R) were inflated; post-fix is the honest result.

## What's Been Tried
- Entry at formation vs retrace → retrace wins decisively.
- Exits: fixed R1/R2/R3, trail 0.1/0.25/0.5/0.75/1/1.5/2, breakeven->2R, partial+trail, liq target, EOD.
- Filters: disp_body 0.5-0.75, atr_mult 1.0-2.0, fvg_min 1-5, fvg_max_atr 2-5, buf 1-5, sl_buf 0-10, entry_win 5-25.
