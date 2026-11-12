# Method — how the brief is built

## 1. Data (Upstox first)

| Input | Source | Note |
|---|---|---|
| Daily OHLCV (symbol + indices) | `UpstoxAPI.fetch_historical_data_v3(unit="days")` | index ids resolve through `chart_patterns/indices.py::INDEX_KEYS` (`NIFTY`, `MIDCPNIFTY`, `BANKNIFTY`, `NIFTYPSUBANK`, `NIFTYRAILWAYS`, `NIFTYINFRA`, `NIFTYPSE`, …) |
| Current session | `fetch_intraday_data_v3(symbol, "1")` | the daily endpoint omits today |
| Option chain | local `GET /api/options/chain/{underlying}?expiry=YYYY-MM-DD` | Upstox-native `NSE_FO` keys; QA token minted by the script |
| Valuation snapshot | yfinance `TICKER.NS` | trailing/forward P/E, P/B, yield, ROE |
| Trading calendar | `trading.utils.is_trading_holiday` (DB-backed) | horizon = real trading sessions, not weekdays |

## 2. Features

For the symbol: `rsi` (Wilder 14), returns over 5/10/20/60/120 sessions, distance to
20/50/100/200-DMA, 20-session % slope of the 200-DMA, volume ÷ 60-session median
volume, annualised realised vol (60d, 252d), position in the 52-week range.

Trend state is defined by the sign of (price ÷ 200-DMA − 1) and the sign of the
200-DMA slope. A symbol below a falling 200-DMA with RSI > 65 is a **counter-trend
rally** — the distinction the conditional tables are built around.

## 3. Cycle structure

- **Zigzag** (30% default, 20/25% available) with alternating high/low pivots →
  rally/drop legs with magnitude, calendar days and session count.
- **Drawdown episodes**: for each drawdown that reached 30%, the deepest trough,
  and the forward 3M/6M/12M return from it. Nearby troughs inside one slide are
  merged (60-session window) so a single drawdown is not counted several times.

## 4. Conditional (momentum / trend) behaviour

Three layers, each with an explicit sample size:

1. **State tables** — forward `H`-session return by state: unconditional, below /
   above the 200-DMA, RSI bands. Two samples are reported: **episodes** (entries
   kept `H` sessions apart — the honest sample) and **pooled days** (overlapping
   windows — the flattering one).
2. **Momentum decay** — forward return bucketed by sessions elapsed since a
   21-session centred RSI peak. This isolates exhaustion: 0–1 session after a peak
   has historically been the worst bucket.
3. **Matched-state analog** — the current state mirrored back onto history
   (`price vs 200-DMA`, `RSI ± 10`, `10d move ± 5pp`); if fewer than 8 samples
   match, the RSI band widens to 40–70 rather than reporting a 3-sample answer.

## 5. Market-implied leg

For each index that has a listed chain (NIFTY, BANKNIFTY, MIDCPNIFTY, SENSEX):

- **1σ move over the expiry** = ATM straddle ÷ 0.7979 ÷ spot.
- **Skew** = ATM put IV − ATM call IV (negative = put demand).
- **Max pain** and **PCR** are the positioning read: max pain below spot plus a
  positive put skew means dealers are positioned for a lower settle.

The symbol's terminal distribution is then
`spot × exp(Σ β_k · index_move_k + ε)` with `ε ~ N(0, σ_resid²)` and
`σ_resid² = σ_symbol² − Σ β_k² σ_index²` (floored at zero). Index moves are drawn
with their market-implied 1σ and the historical index correlation matrix.

**No option chain exists for individual stocks** (POWERGRID, IRFC, …), so the
market-implied view for a single name is always the index-implied view mapped
through its betas — an approximation, and it must be read together with the
symbol's own realised vol.

## 6. The three distributions

| Model | Construction | Question it answers |
|---|---|---|
| Vol-only + market-implied | bootstrap (2Y, 60d) + log-normal (realised vol, zero drift) + log-normal (risk-neutral drift: repo − dividend yield) + market-implied leg | *where could it be?* |
| Momentum/trend-adjusted | log-normal shifted by the matched-analog median + empirical bootstrap of the analog + low-vol variant | *what does this setup do next?* |
| Blended 50/50 | concatenation of the two | *what do I act on?* |

Risk-neutral drift uses the current repo rate minus the symbol's dividend yield
(5.50% − yield for Nov-2026 conditions). The risk-neutral models are the only ones
that embed a forward view of the world; the physical ones assume no drift.

## 7. Reading the output

- **Buckets** are sized at ±2% of spot per step — fine enough to see the mode,
  coarse enough to read.
- **Key levels** are the 50-DMA, the 200-DMA, ±2/5/8% and ±10% of spot. The
  invalidation level is usually the one to compare against.
- **Percentiles** (p10/p25/p75/p90) are the honest way to talk about a range:
  "p25–p75" is the middle half of outcomes, not a forecast.
- The distribution answers *where*. It never answers *whether* — sizing, stop
  placement and the thesis itself are separate decisions.

## 8. What this method cannot do

- It cannot see a scheduled catalyst (results, policy, order win) — the
  conditional tables are backward-looking and have no forward information.
- The analog samples are small (typically 5–170 episodes). A conditional table
  with `n_ep` in single digits is a direction, not a probability.
- Momentum decay is partly mechanical mean reversion in a high-volatility stock;
  it is an empirical regularity, not a law.
