# How to Profit from the Unusual Whales API (Free-Trial Scope)

> **Not investment advice.** These are evidence-based research workflows you must
> backtest and risk-manage yourself. The API is a *data* product, not a signal
> with a guaranteed win rate.

The token currently unlocks **184 working endpoints** — the entire core Unusual
Whales dataset (options flow, dark pool, GEX, IV, tide, congress, insider,
shorts, earnings, ETFs, institutional, screeners). That is more than enough to
build real edges. Below, each play maps to the exact endpoints that work today.

---

## 0. What actually creates edge here

Four structural facts about this data:

1. **Options flow is intent, not opinion.** Sweeps and ask-side opening trades
   with `volume > open_interest` are market participants paying up for a
   position right now. That is a leading signal.
2. **Dark-pool prints are institutional footprints.** They mark accumulation /
   distribution price levels that frequently act as support/resistance.
3. **Dealer gamma determines *how* price moves**, not *which way* — pinning,
   squeezes, and accelerated trends near walls/flips.
4. **Aggregate flow (tide, net premium) is a regime dial.** It tells you when to
   press directional risk and when to sell premium instead.

The winning pattern is **confluence**: flow + dark pool + gamma + regime agree.

---

## 1. Unusual options flow — the flagship edge

**Endpoints**
- `GET /api/option-activity/unusual` (preset: vol>OI, OTM, DTE≤60, ask≥50%, prem≥$10k)
- `GET /api/option-trades/flow-alerts` (`ticker_symbol`, `min_premium`, `size_greater_oi`)
- `GET /api/screener/option-contracts` (full filter set: `min_ask_perc`, `min_volume`, `vol_greater_oi`, `max_multileg_volume_ratio`)
- `GET /api/option-trades` (raw tape; `is_otm`, `min_premium`, `excluded_tags[]=bid_side`, `include_agg_trades`)
- `GET /api/option-trades/multi-leg` and `/{id}/legs` (spread structures)
- `GET /api/stock/{ticker}/flow-recent`, `/api/stock/{ticker}/flow-per-strike`
- `GET /api/option-contract/{id}/volume-profile` (where size actually filled)

**Signal**
Aggressive, opening, ask-side call (or put) sweeps where size ≫ OI, ideally
near-dated and OTM, on a name whose sector tide agrees.

**Play — "sweep continuation"**
1. Screen `unusual` for premium ≥ $500k, `min_ask_perc ≥ 0.7`, DTE 7–45.
2. Require the ticker's `sector-tide` to be net-positive for calls.
3. Confirm the strike sits **below** the call wall from `gex-levels`.
4. Enter 5–10 min after the sweep (let the first pop settle), stop below the
   sweep's price level, first target = call wall / next dark-pool level.

**Play — "fade the exhaustion"**
At a **call wall in positive gamma**, repeated far-OTM call sweeps that fail to
move spot are often dealers/market-makers; fade them. Combine with
`volatility/anomaly/top` showing extreme IV percentile.

**Validation**: pull `flow-alerts` history, forward-return the underlying 1/5/20
days conditioned on (ask-side, opening, size>OI, premium bucket). No look-ahead:
use `created_at` as the timestamp, not `expiry`.

---

## 2. Dark pool & lit-flow levels

**Endpoints**: `/api/darkpool/recent`, `/api/darkpool/{ticker}`,
`/api/darkpool/{ticker}/price-levels`, `/api/lit-flow/recent`,
`/api/lit-flow/{ticker}`, `/api/stock/{ticker}/offlit-price-levels`

**Signal**: clusters of large prints at a price = a level institutions defend.

**Play — "level reclaim / rejection"**: build a per-ticker volume-by-price map
from dark-pool prints over the last 5–20 sessions. Trade breakouts **through**
the biggest shelf (continuation) or reversals **at** it (range). Add flow
confirmation: reclaim + call sweeps = long; reject + put sweeps = short.

---

## 3. Dealer gamma (GEX) — pinning & squeezes

**Endpoints**: `/api/stock/{ticker}/gex-levels`, `/spot-exposures/strike`,
`/greek-exposure/strike`, `/greek-exposure/expiry`, `/max-pain`,
`/api/stock/{ticker}/oi-per-strike`, `/oi-per-expiry`

**Signal**
- **Positive gamma** (spot > flip): dealers dampen moves → mean-revert between
  put wall and call wall, expect pinning near the magnet into expiry.
- **Negative gamma** (spot < flip): dealers amplify moves → trade breakouts with
  wider targets.
- **Max pain** pulls spot toward it into expiry.

**Play — "expiry pin"**: on a name with a clear gamma magnet and max-pain
agreement, sell iron condors or directional hedges inside the walls in the last
2–3 days before OPEX.

**Play — "gamma flip breakout"**: when spot crosses the flip with net-positive
call flow and rising tide, go long with a stop back under the flip.

---

## 4. Volatility / IV regime — premium harvesting

**Endpoints**: `/api/stock/{ticker}/interpolated-iv`, `/iv-rank`,
`/volatility/realized`, `/volatility/realized/windows`,
`/volatility/variance-risk-premium`, `/volatility/variance-risk-premium/windows`,
`/volatility/term-structure/distribution`, `/historical-risk-reversal-skew`,
`/volatility/anomaly/top`, `/volatility/character/top`,
`/volatility/option-sentiment/top`

**Signal**
- **Variance risk premium (VRP) = IV − RV.** Positive VRP → premium selling has
  a statistical edge.
- **IV rank** mean-reverts.
- **Term structure** contango vs backwardation = calm vs stress.
- **Risk-reversal skew** (25Δ put IV − call IV) = directional fear/euphoria.

**Play — "VRP harvest"**: when VRP and IV-rank are elevated and term structure
is in contango, sell defined-risk premium (credit spreads / calendars). Exit on
IV crush or when skew flips.

**Play — "long vol into catalyst"**: low IV-rank + rising anomaly score +
upcoming earnings → buy straddles/calendars. (The official UW skill
`uw-earnings-vol-scan-skill.md` documents a tested call-calendar screen.)

---

## 5. Market / sector tide — regime overlay

**Endpoints**: `/api/market/market-tide`, `/api/market/{sector}/sector-tide`,
`/api/market/{ticker}/etf-tide`, `/api/net-flow/expiry`,
`/api/market/top-net-impact`, `/api/market/total-options-volume`,
`/api/market/oi-change`, `/api/market/daily-report`

**Play — "regime dial"**: net call premium vs net put premium (and 0DTE via
`net-flow/expiry`) sets gross exposure. Risk-on → trade breakouts/long flow.
Risk-off → trade shorts, or sell premium. Rotate long exposure to the
strongest sector tide.

---

## 6. Congress & insider flow — event-driven

**Endpoints**: `/api/congress/recent-trades`, `/api/insider/transactions`,
`/api/insider/{sector}/sector-flow`, `/api/insider/{ticker}/flow`,
`/api/insider/{ticker}/ticker-flow`

**Signal**: *clusters* — several politicians or insiders, same ticker, same
direction, tight window — are far more informative than single trades.

**Play — "cluster follow"**: monthly rebalance long baskets of tickers with ≥2
distinct insider buys (open-market) or ≥2 congressional buys in the last 30
days, filtered to liquid names. This is essentially what the public NANC/KRUZ
style strategies do. Add flow confirmation.

Note: the *flagged* unusual-congress endpoints (`/congress/unusual-trades*`) are
gated, but raw recent trades + insider data are open and cover most of the edge.

---

## 7. Shorts — squeeze screener

**Endpoints**: `/api/short_screener`, `/api/shorts/{ticker}/interest-float/v2`,
`/api/shorts/{ticker}/volume-and-ratio`, `/api/shorts/{ticker}/ftds`,
`/api/shorts/{ticker}/data`

**Play — "squeeze trigger"**: candidates = high SI/float + high days-to-cover +
rising short volume + a *fresh bullish flow anomaly*. Enter on the day flow
turns; the catalyst plus crowded shorts is the fuel.

---

## 8. Earnings

**Endpoints**: `/api/earnings/premarket`, `/api/earnings/afterhours`,
`/api/stock/{ticker}/earnings`

**Play — "earnings drift + vol"**: pre-earnings, use historical surprise and the
IV run-up; post-earnings, trade the drift when the reaction is muted relative to
the historical move. (Forward estimates are gated — use history + realized moves.)

---

## 9. The market-wide stock screener (highest leverage research tool)

**Endpoints**: `/api/screener/stocks` + `/api/screener/stocks/dsl` (query
grammar)

**Play — "automated candidate factory"**: write DSL queries that combine datasets
across the whole market — e.g. *bullish net premium + unusual volume percentile +
insider buying + high days-to-cover*. Run daily, rank, and feed your execution
lane. This is where you turn 184 endpoints into a repeatable funnel instead of
reading one screen at a time.

---

## 10. ETFs, institutions, seasonality

**Endpoints**: `/api/etfs/{ticker}/holdings`, `/inflow-outflow`,
`/etfs/{ticker}/exposure`, `/sector-country-weights`,
`/api/institution/latest_filings`, `/api/institution/{name}/holdings`,
`/api/institution/{ticker}/ownership`, `/api/seasonality/*`

**Play**: sector-rotation baskets from ETF flow + seasonality tilt + insider
confirmation; 13F tracking for long-horizon positioning.

---

## 11. Crypto, prediction markets, POTUS (novel/uncrowded)

**Endpoints**: `/api/crypto/*`, `/api/predictions/unusual`, `/smart-money`,
`/whales`, `/market/{asset_id}`, `/api/potus/posts`, `/api/potus/schedule`

**Play**
- **POTUS post reaction**: parse `/api/potus/posts` for ticker-relevant phrases
  (tariffs, a company, a sector) → intraday long/short the affected ETF. Policy
  headlines are among the fastest-moving catalysts.
- **Prediction-market smart money**: track `/api/predictions/smart-money` and
  `/whales` as an event-probability overlay for macro trades.

---

## 12. The confluence stack (putting it together)

A daily loop that is genuinely worth automating:

1. **Regime** (`market-tide`, `net-flow/expiry`) → risk-on / risk-off / neutral.
2. **Candidates** (`option-activity/unusual`, `screener/stocks` DSL) → names with
   fresh aggressive flow in the regime's direction.
3. **Structure** (`gex-levels`, `darkpool/{t}/price-levels`) → entry, stop, target.
4. **Confirmation** (`insider`, `congress`, `short_screener`, `volatility/*`) →
   rank and size.
5. **Execute + journal**, then backtest the rule set on history before scaling.

`scripts/daily_snapshot.py` is a working first version of steps 1–3.

---

## Monetization paths

| Path | What it needs | Notes |
|------|---------------|-------|
| **Trade it** | US equities/options broker (Alpaca, IBKR, Tradier) | Biggest upside; requires US market access and capital. |
| **Signal/alert service** | Redistribution license | UW data redistribution requires a commercial license (email dev@unusualwhales.com). |
| **Internal research overlay** | Nothing extra | Use flow/tide as a macro/sentiment layer for your existing strategies. |
| **Dashboard/product** | Redistribution license | Sell the interface, not the raw data, but still get a license. |

---

## Limitations & risks (read before building)

- **Free trial is temporary.** After it, core endpoints need at least an API
  plan; Advanced+/Futures/Politics scopes and the $250/mo historical full tape are
  extra. Budget accordingly.
- **US markets only.** This does not directly cover NSE/Indian tickers. Options:
  build a US lane, or use US tide/insider/flow as a *global sector sentiment*
  overlay for Indian IT/pharma/etc.
- **Look-ahead traps.** `start_time`/`created_at` are your event times; daily
  datasets restate (OI updates next morning). Backtest point-in-time.
- **No per-minute cap but burst-limited** — we hit 429s at ~6 concurrent calls.
  Use a small worker pool (3–4) and retry with backoff.
- **`/api/socket/*` is docs only**; live WebSocket needs the Advanced plan.
- **Not investment advice.** Backtest, paper-trade, size with risk limits.

## Fastest path to a first dollar of edge

1. Run `scripts/daily_snapshot.py` for a week; journal every name it surfaces.
2. Pick the **one** play with the cleanest history you can pull
   (`flow-alerts` continuation is a good start).
3. Backtest it with forward returns and transaction costs.
4. If positive, paper-trade 2 weeks, then size small.
