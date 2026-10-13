# Pre-range fade — research pipeline

Backtests a "premarket range fade" strategy on US equities and renders dark-theme
HTML reports into `reports/`. Tracked here so the generator code survives; the
generated artifacts live in `reports/` (gitignored) and are **never deleted** —
they are overwritten in place.

## Strategy

Per session date `D` (timestamps in `America/New_York`):

- `prev_close` = close of the prior daily bar (strictly before `D`)
- `pre` = intraday bars with time `< 09:30`; `reg` = bars `09:30 <= t < 16:00`
- `pre_hi` / `pre_lo` from `pre`; `pre_last` = last `pre` close; `pre_chg = pre_last/prev_close - 1`
- **Side:** `LONG` if `pre_last < prev_close`, else `SHORT`
- **Stop:** `pre_lo` (LONG) / `pre_hi` (SHORT)
- **Entry:** first `reg` bar open, only if strictly inside `(pre_lo, pre_hi)`, else skip
- **Filter:** only trade when `1.0 <= |pre_chg| * 100 <= 5.0`
- **Exits** (bar by bar; intrabar hard stop uses Low/High; signal exits use Close):
  - `baseline` — target = opposite pre level, else MOC
  - `ema9_1230` — no target; exit on EMA9(span 9) cross against position, else at/after 12:30
  - `time_1230` — no target; exit at/after 12:30

### Key findings

- **`>5%` premarket moves lose on essentially every ticker** — gap/trend days break the range.
- The edge lives in the **`1–5%`** band; `3–5%` is the strongest sub-bucket for most names.
- **Drop the fixed target** — `time_1230` / `ema9_1230` beat the `baseline` target on most names;
  the pre-range extreme caps winners.
- The edge is a **volatility effect, not a mega-cap effect**: high-beta names (SNDK, MU) win big,
  while AAPL/NVDA/TSLA show little to no edge. MSFT/GOOGL are the mega-cap exceptions.

## Scripts

| script | output | purpose |
|---|---|---|
| `generate_prerange_template.py [TICKER]` | `reports/PRERANGE_<TICKER>/` | full per-ticker backtest: results table (sets A/B/C × variants), edge buckets, verdict, charts |
| `generate_gallery.py` | `reports/SNDK_STRATEGY/` | SNDK trade gallery + exit study (EMA/VWAP/time), plus a live "today" section |
| `today_playbook.py` | `reports/SNDK_STRATEGY/` | single-day playbook chart for the latest session (also imported by `generate_gallery.py`) |
| `generate_compare.py` | `reports/PRERANGE_COMPARE/` | recomputes every ticker with identical code and ranks them |

### Usage

Run from the repo (`stock-screener-ui/`) with the project venv:

```bash
.venv/bin/python scripts/research/prerange/generate_prerange_template.py NVDA
.venv/bin/python scripts/research/prerange/generate_gallery.py
.venv/bin/python scripts/research/prerange/generate_compare.py
```

Outputs default to `<repo>/stock-screener-ui/reports/...`; override with
`PRERANGE_OUT=/some/dir`.

## Data & caveats

- Data source: `yfinance` (5m history ≈ 60 days, 1h ≈ 1 year, prepost=True).
- **No costs, slippage or borrow** are modelled — results are gross and indicative.
- 1h premarket bars are coarse; a 12:30 exit on 1h bars effectively fills near 13:30.
- One trade per session; sample sizes are small (~20–140 trades/ticker).
- Current partial session and early-close half days are excluded.
