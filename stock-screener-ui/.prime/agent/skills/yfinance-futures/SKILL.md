---
name: yfinance-futures
description: Fetch futures & index data via yfinance without Upstox — CME session split, ticker conventions, and EDA helpers for ES=F / NQ=F. Use when asked to pull futures data with yfinance, analyse CME Globex sessions (Asia/Europe/NY RTH), or produce a session EDA for ES/NQ.
---

# yfinance Futures (ES/NQ via yfinance, no Upstox)

One command gives **ES=F + NQ=F daily & hourly data** and session-level EDA. No credentials — Yahoo Finance is free but unofficial.

Data: `yfinance` (`ES=F`, `NQ=F`, `^GSPC`, `^NDX`); CME Globex sessions split in `America/New_York`.

## Quick start

```bash
cd /home/mysyntax/Documents/Alphashri/stock-screener-ui

# Last week (auto: last 7 calendar days)
.venv/bin/python scripts/eda_futures.py

# Explicit window — last week vs this week
.venv/bin/python scripts/eda_futures.py --start 2026-08-17 --end 2026-08-24
.venv/bin/python scripts/eda_futures.py --start 2026-08-24 --end 2026-08-30

# Reuse for any ticker pair (SPY/QQQ proxies):
# edit SYMBOLS in scripts/eda_futures.py or call helpers directly
```

Output → `reports/ES_NQ_EDA/`:
- `es_nq_eda_report.html` — self-contained HTML (base64 charts), `xdg-open` it
- `es_nq_eda_report.md`, `figures/*.png` (6), `sessions_daily.csv`, `summary.json`

## Tickers

| Instrument | yfinance ticker | Upstox equiv | Notes |
|---|---|---|---|
| E-mini S&P 500 | `ES=F` | N/A (CME) | yfinance daily/hourly/1m; expires quarterly |
| E-mini Nasdaq 100 | `NQ=F` | N/A | more volatile, ~1.6× ES beta |
| S&P 500 index | `^GSPC` | — | cash index, 9:30-16:00 ET only |
| Nasdaq 100 | `^NDX` | — | cash index |
| ETF proxies | `SPY` (ES), `QQQ` (NQ) | N/A | smooth history, better for backtests |

Use `=F` suffix for futures. `yf.Ticker("ES=F").info` works; `yf.download("ES=F", interval="1h")` returns UTC-tz bars.

## CME Globex sessions (ET)

| Session | Hours (ET) | What happens |
|---|---|---|
| Asia-only | 18:00–03:00 | thin, sets overnight low/high |
| Europe (London) | 03:00–09:30 | ramp, sets lean into NY open |
| NY RTH | 09:30–16:00 | max liquidity — where to trade |
| Post-RTH | 16:00–17:00 | squaring, fade |
| Overnight (aggregate) | 18:00–09:30 | Asia+Europe — ONH/ONL = key levels |

CME day: 18:00 ET → 17:00 ET next day (23h, 17:00-18:00 maintenance). RTH 09:30-16:00 aligns with NYSE.

## How to use programmatically

```python
from scripts.eda_futures import _fetch_one, split_sessions, cross_stats
import pandas as pd

daily = _fetch_one("ES=F", "2026-08-17", "2026-08-30", "1d")
hourly = _fetch_one("ES=F", "2026-08-17", "2026-08-30", "1h")
sessions = split_sessions(hourly)
# sessions["Asia (18:00-03:00 ET)"] etc.
```

## Report contents

1. **Daily** — price/volume/MAs, weekly return
2. **Session volume** — weekly aggregate + daily NY vs Overnight stacked
3. **Session range** — avg daily range % per window (Asia/Europe/NY)
4. **ES vs NQ spread** — normalised 100 + ES/NQ ratio
5. **Heatmaps** — hour × day-of-week volume share (ET)
6. **Key levels** — window H/L, 5d MA, avg vol
7. **Cross stats** — corr, beta(ES|NQ), relative strength
8. **Takeaways** — plain-English: Asia ONH/ONL → NY breakout/fade setup

Each section ends with **💡 In plain English**.

## Next-week workflow

Change dates and re-run:

```bash
.venv/bin/python scripts/eda_futures.py --start 2026-08-31 --end 2026-09-06
# diff:  diff reports/ES_NQ_EDA/sessions_daily.csv (prev copy)
```

Or without flags for auto last-7-days. Sessions are ET-fixed — no code change.

## Gotchas (learnings)

- **yfinance end is exclusive** — bump end+1 day for inclusive window (handled in `fetch_all`).
- **MultiIndex columns** — single ticker still returns `Price/Ticker` columns; flatten with `df.columns.get_level_values(0)`.
- **UTC → ET** — all bars arrive UTC-tz; convert to `America/New_York` before session split. DST-aware.
- **Futures roll** — ES=F/NQ=F auto-roll to front month; compare `SPY/QQQ` if you need continuous history.
- **Hourly volume is CME Globex** — overnight bars exist (unlike ^GSPC). Missing 17:00-18:00 is maintenance — expected.
- **Rate limits** — use `yf.download` not per-ticker `Ticker.history` loops; 1h fetch for 2 weeks ≈ 1 call per symbol.
- **Force Agg** — `MPLBACKEND=Agg` before pyplot; venv may inherit broken inline backend.
- **1h interval depth** — yfinance keeps ~730 days of 1h; daily is unlimited.
