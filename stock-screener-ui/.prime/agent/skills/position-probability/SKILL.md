---
name: position-probability
description: Build a probabilistic pre-position brief for any NSE symbol (e.g. IRFC, POWERGRID, HAL) — momentum/trend state, correlation and beta vs indices, cycle legs and drawdown history, RSI-peak momentum decay, market-implied range from live Upstox option chains, and the probability distribution of the close on a target date. Use before opening or adding to a position, when asked "what is the probability of X by date", "is this rally sustainable", "how much can it run", "should I chase this", or for any "think before taking positions" analysis.
---

# Position Probability (think before the position)

One command turns "I think it might go up" into a **distribution**: where the price is
likely to be on a target date, how the option market is pricing that date, and what
this exact momentum/trend setup has historically done next.

The point is not to predict the close. It is to see the **shape of the risk** before
you size a position: probability of reaching your target vs probability of the
invalidation level, in the same units.

## Quick start

```bash
cd /home/mysyntax/Documents/Alphashri/stock-screener-ui

.venv/bin/python .prime/agent/skills/position-probability/scripts/position_probability.py \
    --symbol IRFC --target 2026-11-23

# pick the drivers explicitly (default: NIFTY, MIDCPNIFTY, BANKNIFTY, NIFTYPSUBANK, NIFTYRAILWAYS)
.venv/bin/python .prime/agent/skills/position-probability/scripts/position_probability.py \
    --symbol POWERGRID --target 2026-11-23 --indexes NIFTY,MIDCPNIFTY,BANKNIFTY,NIFTYPSE

# print only, no files
.venv/bin/python .prime/agent/skills/position-probability/scripts/position_probability.py \
    --symbol HAL --target 2026-12-15 --print-only

# offline (no option chains, no yfinance)
.venv/bin/python .prime/agent/skills/position-probability/scripts/position_probability.py \
    --symbol IRFC --target 2026-11-23 --no-chain --no-yf
```

Output → `reports/position_probability/<SYMBOL>/position_probability_<target>.md`
plus the Upstox daily series used (`<SYMBOL>_daily_upstox.csv`, `<INDEX>_daily_upstox.csv`).

## What the brief contains

| § | Section | What it answers |
|---|---|---|
| 1 | State | Where is it now: RSI, 5/10/20/60/120d returns, distance to 20/50/100/200-DMA, 200-DMA slope, volume ratio, realised vol, 52w position, trend state |
| 2 | Correlation / beta | Which index actually drives it (60d and 252d), and how much of the move is idiosyncratic |
| 3 | Cycle | Zigzag legs (rally/drop with magnitude and duration) and forward returns after every ≥30% drawdown trough |
| 4 | Conditional behaviour | Forward-return stats by state (below/above 200-DMA, RSI bands), **momentum decay after an RSI peak**, and the **matched-state analog** for the current setup |
| 5 | Market-implied | Live Upstox option chains for the expiry on/near the target date: ATM IV, ATM straddle, implied 1σ move, max pain, PCR, put−call skew |
| 6 | Probability | Three distributions (vol-only + market-implied, momentum/trend-adjusted, blended) as price buckets, key levels and percentile summaries |
| 7 | Valuation | yfinance snapshot (P/E, P/B, yield, ROE, market cap) |

## The three models (read this before trusting a number)

1. **Vol-only + market-implied** — "where could it be?" Bootstrap and log-normal
   distributions on the symbol's own realised vol, plus a leg that maps the option
   chains' implied index moves through the symbol's regression betas and adds the
   residual volatility. Assumes no edge from the current tape.
2. **Momentum/trend-adjusted** — "what does this setup usually do next?" The
   matched-state analog (same position vs 200-DMA, same RSI band, same 10d move)
   and the RSI-peak decay curve re-weight the distribution.
3. **Blended 50/50** — the number to act on. When the two disagree by more than
   ~5pp on a level, the disagreement *is* the signal: usually "stretched tape,
   market-implied range smaller than the stock's own history".

Act on the **asymmetry**: P(target) vs P(invalidation), not the median.

## Decision rules the brief supports

- **Counter-trend rally** (price below a falling 200-DMA, RSI > 65): momentum is
  real but unconfirmed; require a close above the 200-DMA before treating it as a
  trend change. Analog splits show materially different forward behaviour
  above vs below the 200-DMA.
- **RSI at a peak**: the decay table shows the 0–3 sessions after a 21-session RSI
  peak have a negative median forward return and a low P(up). Momentum bought at
  an RSI peak is the classic exhaustion entry.
- **Short horizon (< 2 weeks)**: the distribution is dominated by volatility and
  the expiry pin. Do not expect a re-rating inside the window; expect a range.
- **Long horizon (quarters)**: use §3 (cycle legs) and the P/B cycle, not the
  8-session distribution.

## Files

```
.prime/agent/skills/position-probability/
├── SKILL.md
├── scripts/
│   ├── position_probability.py   # CLI: orchestrates fetch → features → models → report
│   ├── iv_crush.py               # earnings-event IV crush, measured on real option prices
│   ├── fetch_market_data.py      # Upstox daily/intraday, local API token, option chains
│   ├── lib_probability.py        # pure maths (no network) — unit tested
│   └── pb_cycle.py               # price/book cycle (needs a quarterly BVPS CSV you paste in)
├── references/
│   ├── method.md                 # model definitions and how to read the output
│   ├── gotchas.md                # data quirks that will silently corrupt results
├── session/                      # original working scripts (audit trail, Nov-2026 run)
└── tests/
    └── test_probability.py       # pytest, offline, 15 tests
```

Tests: `.venv/bin/python -m pytest .prime/agent/skills/position-probability/tests -q`

### Event IV crush (separate script)
`scripts/iv_crush.py` measures the implied-vol collapse around an earnings
announcement using the **stock's own listed options** (monthly-only for most
names; Upstox `/option/chain` works with the equity's instrument key even
though the local API only exposes index chains):

```bash
.venv/bin/python .prime/agent/skills/position-probability/scripts/iv_crush.py \
    --symbol SBIN --earnings 2026-11-03 --expiry 2026-11-23

.venv/bin/python .prime/agent/skills/position-probability/scripts/iv_crush.py \
    --examples SBIN:2026-11-03,ITC:2026-11-02,TITAN:2026-11-05 --expiry 2026-11-23

.venv/bin/python .prime/agent/skills/position-probability/scripts/iv_crush.py \
    --symbol SBIN --expiry 2026-11-23 --chain-only    # live chain snapshot
```

It rebuilds the ATM straddle's IV **day by day** from Upstox historical
candles of the same contracts, re-picking the strike that was ATM on each
session (reusing today's strike mis-states IV by several vol points on a stock
that has moved), and reports: IV before / on / after the event, the crush in
vol points, the straddle's rupee change, the priced move (straddle ÷ 0.7979 ÷
spot) versus the actual reaction.

### Intraday F&O momentum scan

`scripts/fno_momentum_scan.py` ranks every optionable NSE name by live momentum
(Upstox market data — no broker token needed) and, optionally, pulls the option
chain of the leaders:

```bash
.venv/bin/python .prime/agent/skills/position-probability/scripts/fno_momentum_scan.py --top 10
.venv/bin/python .prime/agent/skills/position-probability/scripts/fno_momentum_scan.py \
    --chains SBIN,ICICIBANK --top 6
```

Score = z-scored 1d/5d/10d/20d momentum + relative strength vs NIFTY + volume
participation + trend health, with penalties for RSI exhaustion (>78) and for
a single huge day on no volume. Output: `reports/fno_scan/<date>/fno_momentum.csv`.

**Chain access needs the Upstox OAuth token** (market data does not). When the
token has expired, option economics can still be reconstructed from the *local
instrument cache* (`upstox_trader/config_and_utils/nse_instruments.json` gives
contract keys, lot sizes and expiries) plus the historical-candle API: fetch
yesterday's close of the ATM contract, invert it to an implied vol, and
re-price today with the current spot — see `scripts/iv_crush.py` for the
Black-Scholes helpers.

### Dark-theme EDA report (HTML + charts)

`scripts/generate_dark_report.py` turns all of the above into a self-contained
HTML report with matplotlib PNGs (base64-embedded), dark-themed from
`src/ui/palette.ts` so it cannot drift from the product theme:

```bash
.venv/bin/python .prime/agent/skills/position-probability/scripts/generate_dark_report.py \
    --symbols IRFC,POWERGRID --target 2026-11-23
```

Output → `reports/eda_<target>/eda_report.html` (self-contained),
`eda_report.md`, `figures/*.png`. Sections per symbol: price & cycle legs,
momentum/trend, rolling correlation, drawdown, price-book cycle, drawdown
episodes, forward-return distribution + momentum decay, probability density/CDF;
then a cross-symbol correlation heatmap, the IV-crush section (path, crush
bars, priced-vs-actual scatter, live chain OI profile + payoff) and a
provenance note.

**Every chart is followed by a data-driven "read this" paragraph** (computed
from the same numbers, not boilerplate) so the report can be read on its own
without re-deriving the numbers.

### The price/book cycle (separate script)

`scripts/pb_cycle.py` reads the symbol's price legs from Upstox and prints the
P/B at every pivot. Book value per share is not script-friendly (stockanalysis
blocks plain HTTP clients), so paste the quarterly BVPS series into a CSV
(`date,bvps`) taken from the stockanalysis balance-sheet page (row
"Book Value Per Share") or screener.in:

```bash
.venv/bin/python .prime/agent/skills/position-probability/scripts/pb_cycle.py \
    --symbol IRFC --bvps my_bvps.csv
```

## Dependencies

- Project `.venv` (pandas, numpy, scipy, yfinance already installed).
- Upstox creds via `config.py`/`.env` (`UPSTOX_API_KEY`, `UPSTOX_API_SECRET`).
- The local API (`http://localhost:8765`) for option chains; it mints its own QA
  token (`qa@test.com` / `qa123`) — never paste a token literal. Without the API
  the market-implied leg is skipped and the brief says so.

## Before you publish a conclusion

Read `references/gotchas.md`. The two that bite most often:

- Upstox's daily endpoint **omits the current session** — the script appends it
  from the 1-minute feed; if you fetch it yourself, do the same or your RSI and
  drawdown are one session stale.
- The API's `expected_move` is a **0.61×straddle convention, not a 1σ move**. The
  script computes 1σ from the ATM straddle (÷0.7979÷spot); reading
  `expected_move` as 1σ understates the market's range by roughly half.
