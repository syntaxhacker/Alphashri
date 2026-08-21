---
name: stock-eda-report
description: Generate a complete EDA + investment-view report for any NSE stock (e.g. NETWEB, HAL, HINDZINC) — intraday high-volume times, big-player footprints (delivery %, bulk/block/insider deals, FII/DII), earnings & results, full balance sheet / P&L / ratios / shareholding from Screener.in, valuation vs peers & NIFTY, buy/sell levels and verdict, plus charts and a self-contained HTML + Markdown report with plain-English summaries. Use when asked to analyze a ticker's volume patterns, big players, earnings, fundamentals, valuation, or produce an "EDA report" / "stock report".
---

# Stock EDA Report (volume / big-player / fundamentals / valuation)

Reusable, data-driven EDA report for an NSE equity ticker (NETWEB, HAL, HINDZINC, …).
One command produces a ~19-chart, 11-section report that answers: **when does it trade
most, what do big players do, is it cheap or expensive, and what are the levels.**

Data sources (all free / already wired):
- **Upstox V3** — daily + 1-minute OHLCV (price/volume tape).
- **yfinance** (`TICKER.NS`) — earnings, income statement, ownership, analyst targets, calendar, NIFTY.
- **financeindia** (Rust lib) — NSE delivery %, bulk/block/insider deals, FII/DII flows, India VIX, NIFTY P/E.
- **Screener.in** (HTML scrape) — full balance sheet, P&L, cash flow, ratios, quarterly shareholding.
- **Web search** (Serper) — optional, for latest results / order-book / news not in any feed.

A ready-to-run generator lives in `scripts/generate_stock_eda_report.py`.

## Quick start

```bash
cd /home/mysyntax/Documents/Alphashri/stock-screener-ui

# Full run (Upstox + yfinance + financeindia + Screener.in)
.venv/bin/python .prime/agent/skills/stock-eda-report/scripts/generate_stock_eda_report.py --symbol HAL

# Common flags
#   --peers BEL,BDL,MAZDOCK       override the peer set for the valuation table
#   --daily-from 2020-01-01       start of daily OHLCV fetch
#   --no-nse / --no-screener      skip the NSE / Screener.in network fetches
#   --daily-csv ... --minute-csv ...   reuse cached CSVs (skips Upstox fetch)

# Web-search enrichment (needs Serper key configured via /login → MCP → Serper):
#   then ask the agent to search and append a "news & catalysts" note.
```

Output → `reports/<SYMBOL>_EDA/`:
- `<SYM>_EDA_report.html` — self-contained HTML (charts base64-embedded), `xdg-open` it.
- `<SYM>_EDA_report.md` — Markdown version (references `figures/*.png`).
- `figures/*.png` (≈19), `high_volume_days.csv`, `earnings_event_study.csv`.

## Dependencies

In the project `.venv` (all installed): `matplotlib seaborn yfinance pandas scipy numpy
financeindia polars httpx beautifulsoup4 lxml`.
Install any missing: `uv pip install matplotlib seaborn yfinance scipy financeindia polars httpx beautifulsoup4 lxml`.
- Upstox creds from `config.py`/`.env` (`UPSTOX_API_KEY`, `UPSTOX_API_SECRET`).
- `financeindia` needs a Rust wheel (installs fine); its `_df()` helpers need `polars`
  (the raw methods return dicts — use those, see gotchas).
- Run from repo root so `market_data` / `upstox_trader` imports resolve.

## Report structure (what the script produces)

1. Executive summary (3 questions) · 2. Price context · 3. Intraday U-shape ·
4. Big-player footprints · 5. Earnings & results + balance sheet/P&L/ratios (Screener.in) ·
6. Market & statistical EDA · 7. Day-of-week · 8. Returns & risk metrics ·
9. Investment view (valuation, peers, levels, buy/sell verdict) ·
10. NSE big-player & market data (delivery %, FII/DII, VIX, corporate actions) ·
11. Caveats · 12. Takeaways — **each analytical section ends with a "💡 In plain English" line.**

## Workflow (follow these steps when doing it interactively)

1. **Daily OHLCV** — `market_data.market_data.fetch_candles(symbol, tf=1440, ...)`; convert to
   `Asia/Kolkata` and use the IST *date* (Upstox bars arrive 18:30 UTC = 00:00 IST).
2. **1-minute OHLCV** — `tf=1` (chunked automatically); de-duplicate when combining CSVs.
3. **Daily EDA** — returns, volume z-score/ratio, up-vs-down volume, forward returns after
   high-volume days, OBV / A/D line, volume-concentration (Lorenz) curve, risk metrics
   (Sharpe/Sortino/max-DD/VaR/win-rate).
4. **Intraday EDA** — minute volume U-shape, 15-min bucket share, intraday volatility,
   "big bars" (≥20× day-median) heatmap, delivery-% bars.
5. **yfinance** — `earnings_dates`, `income_stmt`, `quarterly_income_stmt`, `major_holders`,
   `analyst_price_targets`, `recommendations_summary`, `calendar` (next earnings/ex-div),
   `^NSEI` for beta.
6. **financeindia** — `deliverable_position_data`, `bulk_deal_data`/`block_deals_data`,
   `get_insider_trades`, `get_fii_dii_activity`, `get_index_yield("NIFTY 50")`,
   `get_india_vix_history`, `get_corporate_actions`. (Optional: `get_financial_results`→
   `get_financial_details(xbrl_url)` for NSE P&L + Debt/Equity.)
7. **Screener.in** — GET `https://www.screener.in/company/{symbol}/` and parse the
   `#balance-sheet`, `#profit-loss`, `#cash-flow`, `#ratios`, `#shareholding`, `#quarters`
   HTML tables (BeautifulSoup). The JSON API 404s — parse the server-rendered HTML.
8. **Market/stat EDA** — beta & correlation vs NIFTY, overnight-vs-intraday, feature
   correlation matrix, autocorrelation/Jarque-Bera/volume persistence, monthly seasonality.
9. **Report** — `matplotlib` (Agg) charts, then Markdown **and** self-contained HTML with
   base64 images + colored numbers + plain-English callouts.

## Key thresholds & reusable findings

See `references/analyses-and-thresholds.md`. Highlights:

- Volume U-shape: opening minute ≈ 3% of daily volume; first hour ≈ 30–37%; midday quiet;
  last 15 min pick up. Opening print ≈ 14× the median minute.
- "Big print" = minute bar ≥ 20× that day's median minute volume; ~50% in first 15 min,
  ~70% in first hour.
- Accumulation bias: up-day volume ~1–2× down-day volume; high-volume **up** days
  (vol > 3×/5× the 60-day avg) show positive 20-day forward drift.
- Earnings days trade ~2–4× normal volume; EPS-surprise size correlates (ρ) with the 10-day
  forward return (strong for momentum names, weak for large-caps).
- **Delivery %** (NSE): ≥50% = genuine accumulation, <35% = intraday churn.
- **Valuation rubric**: PEG = trailing P/E ÷ EPS growth. <1 cheap, 1–2.5 fair, >2.5 rich;
  combined with analyst upside → verdict (Buy bias / Hold / Caution).

## Notes / gotchas

- Force `matplotlib.use("Agg")` (and `os.environ["MPLBACKEND"]="Agg"`) before pyplot — the
  project venv may inherit a broken inline backend.
- Normalize/drop tz before joining with yfinance series (Upstox is tz-aware UTC; yfinance
  naive or US-tz).
- yfinance `earnings_dates` are US-time (several land on Saturday) — map each to the next
  NSE trading day and state the caveat.
- `financeindia` `_df()` methods raise "polars required" even when polars is installed; use
  the raw methods (they return clean column-dicts) and convert with pandas.
- `financeindia.get_equity_quote` may 403 (NSE block); `get_financial_results` can lag or
  return empty — wrap every NSE call in try/except and degrade gracefully.
- Screener.in values are comma-formatted strings ("1,34,205") / "71.64%" — strip and cast.
- Always state caveats: OHLCV inference for "big players", small n in extreme cohorts, no
  causality, closing-auction volume possibly missing from 1-min bars.
- Embed charts as base64 in the HTML so the report is portable/offline.
