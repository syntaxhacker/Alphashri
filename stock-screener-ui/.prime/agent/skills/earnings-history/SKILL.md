---
name: earnings-history
description: Build an earnings-reaction history and an event-play plan for any NSE stock (e.g. MANKIND, HAL, NETWEB) — EPS surprise vs T+1 move, beat-and-fade rate, pre-event run-up, post-event drift, expected move, key levels and a scenario map. Use when asked "why did it fall after beating earnings", "prepare for the results", "earnings play", "event study", or to review a stock's reaction history around results.
---

# Earnings History & Event Playbook

Answers three questions before a results date:

1. **How has this stock actually reacted to earnings?** (not how it "should")
2. **What is the market pricing in?** (valuation + positioning + pre-run-up)
3. **What are the levels and the plan for each outcome?**

Built from the same data stack as `stock-eda-report`:
- **Upstox V3** daily OHLCV via `market_data.market_data.fetch_candles`
- **yfinance** (`TICKER.NS`) — earnings dates, EPS surprise, next-event consensus, valuation
- Optional: TradingView screener row for a cross-check (`tradingview_screener`)

## Quick start

```bash
cd /home/mysyntax/Documents/Alphashri/stock-screener-ui

# Report → reports/earnings/<SYMBOL>/
.venv/bin/python .prime/agent/skills/earnings-history/scripts/earnings_history.py --symbol MANKIND

# Confirmed board-meeting date (preferred — vendor dates drift)
.venv/bin/python .prime/agent/skills/earnings-history/scripts/earnings_history.py \
  --symbol MANKIND --next-date 2026-10-26

# Print only, no files
.venv/bin/python .prime/agent/skills/earnings-history/scripts/earnings_history.py --symbol MANKIND --print

# Technicals only (no yfinance)
.venv/bin/python .prime/agent/skills/earnings-history/scripts/earnings_history.py --symbol MANKIND --no-yf
```

Output → `reports/earnings/<SYMBOL>/`:

| File | Contents |
|---|---|
| `<SYM>_earnings_history.md` | reaction table, stats, expected move, technicals, scenario map, checklist |
| `<SYM>_earnings_events.csv` | one row per event (surprise, gap, T+1 move, close location, drift) |
| `<SYM>_earnings_history.json` | same data, machine-readable |

`reports/**` is append-only by project rule — the script overwrites in place and never deletes.

## Method (what the script computes)

- **Reaction window:** first NSE session **strictly after** the announcement (T+1). Indian results are released after close; weekends/holidays roll forward via `searchsorted`.
- **Per event:** EPS surprise, previous close, gap %, T+1 close-to-close %, intraday %, close location in the day's range (0 = low, 1 = high), pre-20-day run-up, volume vs 20-day average, T+5/T+10 drift.
- **Aggregates:** beat rate, avg surprise, avg move on beats vs misses, **beat-and-fade rate** (share of beats that closed red), avg gap vs intraday, drift after beats/misses.
- **Expected move:** mean / median / IQR / max of the last 8 absolute T+1 moves, plus ATR(14) and 20-day realised vol.
- **Levels:** ±1× / ±2× expected move, 20-day and 60-day swing high/low.
- **Technicals:** SMA20/50/100/200, RSI(14), MACD, ADX/DI, Bollinger, 52-week range, volume ratio.

## Reading the output

| Signal | Interpretation |
|---|---|
| Beat-and-fade ≥ 50% | the stock sells good news — fade the gap, don't chase it |
| Avg move on beats < 0 | expectations, not the print, drive the reaction |
| Pre-20d run-up > +10% | the beat is already priced in; higher bar |
| Avg gap > avg intraday, both positive | genuine gap-and-go tendency |
| Avg gap positive, intraday strongly negative | systematic gap-and-trap |
| Median \|move\| > mean \|move\| | fat left/right tails; size for the worst case |
| T+5 drift same sign as T+1 | post-earnings drift is tradeable |

## Workflow

1. **Confirm the date** from the BSE/NSE board-meeting filing, then pass `--next-date`. Vendor dates are estimates (Mankind's Q2 FY27: board meeting **26 Oct 2026**, yfinance said 29 Oct).
2. **Run the script** and read the history + stats.
3. **Do the quality-of-earnings check** — tax rate, other income, finance cost, working capital, segment mix. See `references/earnings-play-checklist.md`.
4. **Write the scenario map** with pre-committed invalidation before the print.
5. **Size for the gap**, not the intraday range. NSE event gaps regularly exceed 1× ATR.
6. **After the event**, append the result to the CSV and grade the thesis.

## Worked example (Mankind Pharma, Q2 FY27)

`references/mankind-q2fy27-playbook.md` — the full prep for the 26 Oct 2026 print, including the beat-and-fade history, consensus, levels and scenario table. Generated report: `reports/earnings/MANKIND/`.

## Gotchas

- yfinance `earnings_dates` are US-time and sometimes land on a Saturday; the T+1 mapping handles it, but verify the reaction day against the filing when it matters.
- `Surprise(%)` is yfinance's EPS surprise vs its own consensus. Vendors disagree: Mankind Q1 FY27 was a **+1% EPS beat** on yfinance and a **PAT miss** in Motilal Oswal's note (lower other income + higher tax). Always check the below-the-line items.
- Backward-looking expected move ignores the option chain and current positioning. If the option chain is available, prefer the ATM straddle-implied move.
- Low free float (Mankind ~27%) amplifies both the gap and the fade.
- Not investment advice.

## Tests

```bash
.venv/bin/python -m pytest .prime/agent/skills/earnings-history/tests -q
```
