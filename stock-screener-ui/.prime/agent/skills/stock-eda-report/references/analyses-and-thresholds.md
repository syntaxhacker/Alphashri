# Analyses, thresholds & formulas (with NETWEB reference results)

Reference values are from **NETWEB (NSE: NETWEB, `NSE_EQ|INE0NT901020`)**, daily 2023-07-27 →
2026-08-14 (757 sessions) and 1-minute 2025-01-01 → 2026-08-14 (381 sessions). Use them as a
sanity-check baseline; other tickers will differ.

## 1. Daily EDA

### Returns
- `ret = close.pct_change()`, `range_pct = (high-low)/close*100`, `gap_pct = (open-prev_close)/prev_close*100`.

### Volume anomaly
- `vol_ma60 = volume.rolling(60).mean()`, `vol_ratio = volume / vol_ma60`.
- High-volume day threshold: `vol_ratio > 3` (extreme: `> 5`).
- NETWEB: top 10% of days = 41% of total volume; top 5% = 27%.

### Up vs down day volume (accumulation bias)
- NETWEB 2025-26: up days mean 2.04 M vs down 0.92 M (~2.2×); median 1.10 M vs 0.55 M.
- `|ret|` vs volume Spearman ρ ≈ 0.38; signed ret vs volume ρ ≈ 0.28.

### Forward returns after high-volume days
- `fwdN = close.shift(-N)/close - 1` for N in {1,3,5,10,20}.
- NETWEB 2025-26 medians (20-day): baseline +2.6%; high-vol UP (vol>3×) +3.7%;
  high-vol UP (vol>5×) **+12.2%**; high-vol DOWN (vol>3×) negative (n too small to trust).

### Money flow
- OBV: `(sign(close.diff()) * volume).cumsum()`. NETWEB corr(close, OBV) = 0.93.
- Chaikin A/D: `mf = ((close-low)-(high-close))/(high-low); (mf*volume).cumsum()`. Corr = 0.85.

## 2. Intraday EDA

- Compute `mins = (index - normalize(index) - 09:15).total_seconds()/60`, keep 0..374.
- 15-min bucket = `mins // 15`; volume share per bucket = each day's `volume / day_total`,
  averaged across days.

### U-shape reference (NETWEB, share of daily volume)
| Window (IST) | Share | vs fair |
|---|---|---|
| 09:15 opening minute | 3.1% | ~11× |
| 09:15–09:30 | 17.7% | ~4.4× |
| 09:15–10:15 | 37.5% | ~2.3× |
| 11:45–13:30 | 15.6% | ~0.56× |
| 15:00–15:30 | 13.6% | ~1.7× |
| 15:15–15:30 | 8.4% | ~2.1× |

- Opening minute avg volume = 43,565 vs median minute 3,015 (≈14.5×).
- Intraday range also U-shaped: open bucket 0.61% vs midday 0.13-0.14%.

### Big bars
- `vol_x_med = volume / groupby(date).volume.transform('median')`; big bar = `> 20`.
- NETWEB: 1,342 big bars (0.94% of all). ~50% in first 15 min; ~70% in first hour (09:15-10:15); ~12% last hour.
- Big-bar |move| ≈ 0.51% vs 0.10% normal; 5-min continuation ≈ 0 (market absorbs quickly).

## 3. yfinance (fundamentals)

- Ticker: `yf.Ticker(f"{symbol}.NS")`.
- `earnings_dates` → EPS Estimate, Reported EPS, Surprise(%). (Deprecated `Ticker.earnings`
  returns None — use `earnings_dates` and the income statement.)
- `quarterly_income_stmt` / `income_stmt` → Total Revenue, Net Income, Diluted EPS.
- `major_holders` → insidersPercentHeld, institutionsPercentHeld, institutionsCount.
- `analyst_price_targets` / `recommendations_summary` → target & rating mix.
- Benchmark: `yf.download("^NSEI", ...)`.

### Earnings event study
- Map each `earnings_dates` row (US-tz) to the **first NSE trading day ≥ its IST date**.
- `ret_d0 = close(d0)/close(d0-1) - 1`, then `ret_d1/d3/d5/d10` similarly.
- Correlate `Surprise(%)` with forward returns (Spearman).
- NETWEB: surprise vs 10-day fwd return **ρ = 0.75 (p = 0.01)**; beat days +5.6% vs miss −15.2%.
- Earnings-day volume ≈ **4.2×** prior-10-day average (median 2.2×).

### Fundamental growth (NETWEB)
| FY | Revenue ₹ Cr | Growth | Net income ₹ Cr | Diluted EPS |
|---|---|---|---|---|
| FY23 | 441 | — | 47 | 8.37 |
| FY24 | 724 | +64% | 76 | 13.88 |
| FY25 | 1,149 | +59% | 114 | 20.11 |
| FY26 | 2,184 | +90% | 206 | 36.30 |

- Valuation: trailing P/E = price / FY26 EPS; forward P/E = price / (next-qtr EPS est × 4);
  P/S = price × shares / FY revenue.

## 4. Market & statistical EDA

- Beta = `polyfit(nifty_ret, stock_ret, 1)[0]`; correlation = `stock_ret.corr(nifty_ret)`.
  NETWEB 2025-26: β = 1.37, ρ = 0.30 (idiosyncratic).
- Overnight vs intraday: overnight = open/prev_close−1, intraday = close/open−1.
  NETWEB 2025-26 cumulative: overnight +174%, intraday −33% (gains come overnight;
  66% of days gap up, median gap +0.28%).
- Spearman feature matrix columns: `ret, abs_ret, log_vol, range_pct, gap_pct, intraday_pct, vol_ratio`.
  NETWEB: ret↔intraday 0.91; vol_ratio↔range 0.74; |ret|↔range 0.67.
- Statistical tests (2025-26): return autocorr lag1 +0.14 (Ljung-Box p=0.006);
  Jarque-Bera p≈1e-19; log-volume AR(1)=0.77; Granger volume→return not significant (p=0.77).

## 5. Report conventions

- Figures: fig1 price/volume, fig2 volume-anomaly, fig3 returns/vol, fig4 intraday volume profile,
  fig5 intraday volatility/big bars, fig6 big-bar heatmap, fig7 day-of-week, fig8 forward returns,
  fig9 OBV/A-D, fig10 concentration/monthly, fig11 earnings surprise, fig12 fundamentals,
  fig13 overnight/intraday, fig14 corr matrix, fig15 beta/corr, fig16 ownership/valuation.
- Markdown references figures via relative `figures/*.png`; HTML embeds base64.
- Always include: Executive summary (3 questions answered), Caveats & limitations,
  Practical takeaways.


## 6. financeindia (NSE big-player & market data)

- `deliverable_position_data(symbol, from, to)` → dict with columns `Symbol`, `Series`, `Date`,
  `Traded Qty`, `Deliverable Qty`, `% Dly Qt to Traded Qty` (keys have trailing spaces — `.strip()`).
  - **Delivery %** = deliverable qty / traded qty. ≥50% = genuine accumulation; <35% = intraday churn.
  - HAL reference: 10-day avg 46%; 62% on a dip day (accumulation) vs 33% on the results-day spike (churn).
- `bulk_deal_data(from,to)` / `block_deals_data(from,to)` → market-wide; filter `Symbol == symbol`.
  - `get_insider_trades(from,to)` → `{"acqNameList":[...], "data":[record dicts with "symbol"]}`; filter `symbol`.
- `get_fii_dii_activity()` → list of objects with `.category, .date, .buy_value, .sell_value, .net_value`.
- `get_index_yield("NIFTY 50", from, to)` → `{"data":[{IY_DT, IY_PE, IY_PB, IY_DY, ...}]}` — take last element.
- `get_india_vix_history(from,to)` → `{"data": [...]}` with `EOD_CLOSE_INDEX_VAL`; <15 calm, >20 elevated fear.
- `get_corporate_actions()` → upcoming dividend/split/bonus list; filter `symbol`.
- `get_financial_results(symbol, from, to, period)` → filing metadata with `xbrl` URL (Archive can lag —
  HAL only returned up to Dec-2024 filings). `get_financial_details(xbrl_url)` → 76-field dict of
  Ind-AS facts: RevenueFromOperations, ProfitLossForPeriod, BasicEarningsLossPerShare..., DebtEquityRatio, etc.
  (contexts: `OneD` = quarter, `FourD` = 9-month, etc.). This is P&L + ratios, NOT a full balance sheet.
- `get_equity_quote` may 403 (NSE block). `_df()` methods raise "polars required" even when polars is
  installed — use the raw dict methods.

## 7. Screener.in (full balance sheet, P&L, ratios, shareholding)

- GET `https://www.screener.in/company/{SYMBOL}/` (server-rendered HTML; the JSON API 404s).
- Parse `<section id="...">` tables with BeautifulSoup:
  `#balance-sheet`, `#profit-loss`, `#cash-flow`, `#ratios`, `#shareholding`, `#quarters`.
- Row labels: Balance sheet → `Equity Capital, Reserves, Borrowings+, Total Liabilities, Total Assets`.
  P&L → `Sales+, Operating Profit, Net Profit+, EPS in Rs`. Ratios → `ROCE %, Debtor Days,
  Inventory Days, Working Capital Days`. Shareholding → `Promoters+, FIIs+, DIIs+` (quarterly columns).
- Values are comma/percent strings — strip and cast.
- HAL reference (FY26): Equity ₹334 Cr, Reserves ₹40,528 Cr, Borrowings ₹65 Cr (near debt-free),
  Total assets ₹134,205 Cr; Sales ₹33,090 Cr; Net profit ₹9,076 Cr; EPS ₹135.7; ROCE 32%.

## 8. Valuation / investment view

- Trailing P/E = price / FY EPS (prefer yfinance `info.trailingPE`); Forward P/E = `info.forwardPE`;
  P/S = `info.priceToSalesTrailing12Months`; dividend yield = `info.dividendRate / price * 100`
  (yfinance `dividendYield` field is inconsistent for Indian tickers).
- **PEG** = trailing P/E ÷ EPS growth (%). <1 cheap, 1–2.5 fair, >2.5 rich.
- Verdict rubric: PEG<1 & analyst upside>10% → "Undervalued — Buy bias"; PEG>2.5 or upside<−10%
  → "Overvalued — Caution"; else "Fairly valued — Hold".
- Levels: 52w high/low from `high/low.rolling(252)`; support = 60-day low; resistance = 60-day high.
- Peer table (`fetch_peers`) uses yfinance `info` for a sector/industry peer set (or `--peers`).

## 9. Report structure (current)

11 sections + 19 figures. Sections 1 Executive summary → 2 Price → 3 Intraday U-shape →
4 Big players → 5 Earnings + balance sheet/ratios (5.5) → 6 Market/stat EDA (incl. India VIX) →
7 Day-of-week → 8 Returns & risk metrics → 9 Investment view (valuation, peers, levels, verdict) →
10 NSE big-player data → 11 Caveats → 12 Takeaways.
**Every analytical section ends with a "💡 In plain English" layman line.**

Figures: fig1 price/volume, fig2 volume-anomaly, fig3 returns/vol (3 panels), fig4 intraday volume
profile, fig5 intraday volatility/big bars, fig6 big-bar heatmap, fig7 day-of-week (2 panels),
fig8 forward returns, fig9 OBV/A-D, fig10 concentration/monthly, fig11 earnings surprise,
fig12 fundamentals (annual + quarterly), fig13 overnight/intraday, fig14 corr matrix,
fig15 beta/corr, fig16 ownership/valuation, fig17 price vs levels, fig18 delivery %,
fig19 shareholding trend.

Colored numbers: HTML wraps signed values in `.pos` (emerald #059669) / `.neg` (red #dc2626)
spans; verdict badge `.buy`/`.hold`/`.caution`.
