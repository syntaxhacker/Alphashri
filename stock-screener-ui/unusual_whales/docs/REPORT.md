# Unusual Whales API — Access & Capability Report

Generated from a live probe of all 236 REST endpoints on **2026-09-25** (last data date `2026-09-24`).

## TL;DR

- **184 of 236 endpoints return data on the current token** (~78%).
- **51 endpoints are gated** by tier/scope/add-on.
- Daily quota headers on this token: **40,000 requests/day**, no practical per-minute cap (burst-limited only).
- Everything core to **options flow, dark pool, GEX/greeks, IV, market tide, congress, insider, shorts, earnings, ETFs, institutional, stock screeners** is **live**.
- Gated: **Futures**, **Advanced+ fundamentals/macro/FX/crypto-history**, **politics/FEC**, **private markets**, **unusual congress trades**, **politician portfolios**, **stock ownership**, and **real-time WebSocket**.

## Access by category

| Category | Working | Total |
|----------|--------:|------:|
| Futures | 0 | 7 |
| Gex/Greeks | 11 | 11 |
| alerts | 4 | 4 |
| commodities | 0 | 1 |
| companies | 0 | 5 |
| congress | 4 | 4 |
| crypto | 8 | 8 |
| darkpool | 3 | 3 |
| digital_currencies | 0 | 2 |
| earnings | 3 | 3 |
| economy | 0 | 1 |
| etfs | 5 | 5 |
| forex | 0 | 3 |
| group_flow | 2 | 2 |
| insiders | 4 | 4 |
| institution | 7 | 7 |
| intel | 0 | 5 |
| lit-flow | 2 | 2 |
| market | 13 | 13 |
| news | 1 | 1 |
| option-contract | 7 | 7 |
| option-trade | 6 | 8 |
| options-pulse | 4 | 4 |
| politician_portfolios | 1 | 5 |
| politics | 0 | 6 |
| potus | 2 | 2 |
| predictions | 8 | 9 |
| private_markets | 0 | 9 |
| screener | 5 | 5 |
| seasonality | 4 | 4 |
| short | 7 | 7 |
| stock | 38 | 39 |
| stock-directory | 1 | 1 |
| unusual_trades | 0 | 4 |
| volatility | 11 | 12 |
| websocket | 23 | 23 |

## Gated endpoints (what to unlock and why)

| Barrier | Endpoints | Representative routes |
|---------|----------:|-----------------------|
| Advanced+ tier | 19 | `/api/commodities/{name}`, `/api/companies/{ticker}/dividends`, `/api/companies/{ticker}/earnings-estimates`, `/api/companies/{ticker}/profile` |
| Premium add-on | 13 | `/api/private-markets/companies`, `/api/private-markets/companies/{npm_ticker}`, `/api/private-markets/companies/{npm_ticker}/funding`, `/api/private-markets/companies/{npm_ticker}/investors` |
| Futures add-on | 7 | `/api/futures/contracts`, `/api/futures/display_factors`, `/api/futures/display_factors/{security_id}`, `/api/futures/flow` |
| Politics scope | 6 | `/api/politics/fec/candidates`, `/api/politics/fec/companies`, `/api/politics/fec/company/{ticker}/lobbying`, `/api/politics/fec/company/{ticker}/people` |
| Enterprise only | 5 | `/api/politician-portfolios/disclosures`, `/api/politician-portfolios/holders/{ticker}`, `/api/politician-portfolios/people`, `/api/politician-portfolios/{politician_id}` |
| Volatility scope | 1 | `/api/volatility/vix-term-structure` |

### Full gated list

**Advanced+ tier**

- `GET /api/commodities/{name}`
- `GET /api/companies/{ticker}/dividends`
- `GET /api/companies/{ticker}/earnings-estimates`
- `GET /api/companies/{ticker}/profile`
- `GET /api/companies/{ticker}/splits`
- `GET /api/companies/{ticker}/transcripts/{quarter}`
- `GET /api/digital-currencies/history`
- `GET /api/digital-currencies/intraday`
- `GET /api/economy/{indicator}`
- `GET /api/forex/history`
- `GET /api/forex/intraday`
- `GET /api/forex/rate`
- `GET /api/analytics/sliding`
- `GET /api/analytics/window`
- `GET /api/calendar/ipo`
- `GET /api/companies/listings`
- `GET /api/market/movers`
- `GET /api/option-trades/exchange-breakdown/{date}`
- `GET /api/option-trades/optionable-tickers`

**Enterprise only**

- `GET /api/politician-portfolios/disclosures`
- `GET /api/politician-portfolios/holders/{ticker}`
- `GET /api/politician-portfolios/people`
- `GET /api/politician-portfolios/{politician_id}`
- `GET /api/stock/{ticker}/ownership`

**Futures add-on**

- `GET /api/futures/contracts`
- `GET /api/futures/display_factors`
- `GET /api/futures/display_factors/{security_id}`
- `GET /api/futures/flow`
- `GET /api/futures/{contract}/candles`
- `GET /api/futures/{contract}/stats`
- `GET /api/futures/{contract}/trades`

**Politics scope**

- `GET /api/politics/fec/candidates`
- `GET /api/politics/fec/companies`
- `GET /api/politics/fec/company/{ticker}/lobbying`
- `GET /api/politics/fec/company/{ticker}/people`
- `GET /api/politics/fec/contributions`
- `GET /api/politics/politician/trades`

**Premium add-on**

- `GET /api/private-markets/companies`
- `GET /api/private-markets/companies/{npm_ticker}`
- `GET /api/private-markets/companies/{npm_ticker}/funding`
- `GET /api/private-markets/companies/{npm_ticker}/investors`
- `GET /api/private-markets/companies/{npm_ticker}/management`
- `GET /api/private-markets/companies/{npm_ticker}/pricing`
- `GET /api/private-markets/investors`
- `GET /api/private-markets/investors/{name}`
- `GET /api/private-markets/search`
- `GET /api/congress/unusual-trades`
- `GET /api/congress/unusual-trades/by-tickers`
- `GET /api/congress/unusual-trades/chart-data`
- `GET /api/congress/unusual-trades/stats`

**Volatility scope**

- `GET /api/volatility/vix-term-structure`

## Working endpoints

### Gex/Greeks

- `GET /api/stock/{ticker}/gex-levels`
- `GET /api/stock/{ticker}/greek-exposure`
- `GET /api/stock/{ticker}/greek-exposure/expiry`
- `GET /api/stock/{ticker}/greek-exposure/strike`
- `GET /api/stock/{ticker}/greek-exposure/strike-expiry` — required: expiry
- `GET /api/stock/{ticker}/greek-flow`
- `GET /api/stock/{ticker}/greek-flow/{expiry}`
- `GET /api/stock/{ticker}/spot-exposures`
- `GET /api/stock/{ticker}/spot-exposures/expiry-strike` — required: expirations[]
- `GET /api/stock/{ticker}/spot-exposures/strike`
- `GET /api/stock/{ticker}/spot-exposures/{expiry}/strike`

### alerts

- `GET /api/alerts`
- `GET /api/alerts/configuration`
- `GET /api/alerts/filters`
- `GET /api/alerts/query/grammar`

### congress

- `GET /api/congress/congress-trader`
- `GET /api/congress/late-reports`
- `GET /api/congress/politicians`
- `GET /api/congress/recent-trades`

### crypto

- `GET /api/crypto/candles/{interval}`
- `GET /api/crypto/list_tokens`
- `GET /api/crypto/token/{token}`
- `GET /api/crypto/trades`
- `GET /api/crypto/whale-transactions`
- `GET /api/crypto/whales/recent`
- `GET /api/crypto/{pair}/ohlc/{candle_size}`
- `GET /api/crypto/{pair}/state`

### darkpool

- `GET /api/darkpool/recent`
- `GET /api/darkpool/{ticker}`
- `GET /api/darkpool/{ticker}/price-levels`

### earnings

- `GET /api/earnings/afterhours`
- `GET /api/earnings/premarket`
- `GET /api/earnings/{ticker}`

### etfs

- `GET /api/etfs/{ticker}/exposure`
- `GET /api/etfs/{ticker}/holdings`
- `GET /api/etfs/{ticker}/in-outflow`
- `GET /api/etfs/{ticker}/info`
- `GET /api/etfs/{ticker}/weights`

### group_flow

- `GET /api/group-flow/{flow_group}/greek-flow`
- `GET /api/group-flow/{flow_group}/greek-flow/{expiry}`

### insiders

- `GET /api/insider/transactions`
- `GET /api/insider/{sector}/sector-flow`
- `GET /api/insider/{ticker}`
- `GET /api/insider/{ticker}/ticker-flow`

### institution

- `GET /api/institution/{name}/activity`
- `GET /api/institution/{name}/activity/v2`
- `GET /api/institution/{name}/holdings`
- `GET /api/institution/{name}/sectors`
- `GET /api/institution/{ticker}/ownership`
- `GET /api/institutions`
- `GET /api/institutions/latest_filings`

### lit-flow

- `GET /api/lit-flow/recent`
- `GET /api/lit-flow/{ticker}`

### market

- `GET /api/market/correlations` — required: tickers
- `GET /api/market/daily-report`
- `GET /api/market/economic-calendar`
- `GET /api/market/fda-calendar`
- `GET /api/market/insider-buy-sells`
- `GET /api/market/market-tide`
- `GET /api/market/oi-change`
- `GET /api/market/sector-etfs`
- `GET /api/market/top-net-impact`
- `GET /api/market/total-options-volume`
- `GET /api/market/{sector}/sector-tide`
- `GET /api/market/{ticker}/etf-tide`
- `GET /api/net-flow/expiry`

### news

- `GET /api/news/headlines`

### option-contract

- `GET /api/option-contract/{id}/flow`
- `GET /api/option-contract/{id}/historic`
- `GET /api/option-contract/{id}/intraday`
- `GET /api/option-contract/{id}/volume-profile`
- `GET /api/stock/{ticker}/expiry-breakdown`
- `GET /api/stock/{ticker}/option-contracts`
- `GET /api/stock/{ticker}/option-stance` — required: stance

### option-trade

- `GET /api/option-trades`
- `GET /api/option-trades/flow-alerts`
- `GET /api/option-trades/flow-alerts/{id}`
- `GET /api/option-trades/full-tape/{date}`
- `GET /api/option-trades/multi-leg`
- `GET /api/option-trades/multi-leg/{id}/legs`

### options-pulse

- `GET /api/options-pulse/sectors`
- `GET /api/options-pulse/top`
- `GET /api/options-pulse/total`
- `GET /api/stock/{ticker}/options-pulse`

### politician_portfolios

- `GET /api/politician-portfolios/recent_trades`

### potus

- `GET /api/potus/posts`
- `GET /api/potus/schedule`

### predictions

- `GET /api/predictions/insiders`
- `GET /api/predictions/market/{asset_id}`
- `GET /api/predictions/market/{asset_id}/liquidity`
- `GET /api/predictions/market/{asset_id}/positions`
- `GET /api/predictions/search-users` — required: q
- `GET /api/predictions/smart-money`
- `GET /api/predictions/unusual`
- `GET /api/predictions/whales`

### screener

- `GET /api/option-activity/unusual`
- `GET /api/screener/analysts`
- `GET /api/screener/option-contracts`
- `GET /api/screener/stocks`
- `GET /api/screener/stocks/dsl`

### seasonality

- `GET /api/seasonality/market`
- `GET /api/seasonality/{month}/performers`
- `GET /api/seasonality/{ticker}/monthly`
- `GET /api/seasonality/{ticker}/year-month`

### short

- `GET /api/short_screener`
- `GET /api/shorts/{ticker}/data`
- `GET /api/shorts/{ticker}/ftds`
- `GET /api/shorts/{ticker}/interest-float`
- `GET /api/shorts/{ticker}/interest-float/v2`
- `GET /api/shorts/{ticker}/volume-and-ratio`
- `GET /api/shorts/{ticker}/volumes-by-exchange`

### stock

- `GET /api/stock/{sector}/tickers`
- `GET /api/stock/{ticker}/atm-chains` — required: expirations[]
- `GET /api/stock/{ticker}/balance-sheets`
- `GET /api/stock/{ticker}/cash-flows`
- `GET /api/stock/{ticker}/earnings`
- `GET /api/stock/{ticker}/financials`
- `GET /api/stock/{ticker}/flow-alerts`
- `GET /api/stock/{ticker}/flow-per-expiry`
- `GET /api/stock/{ticker}/flow-per-strike`
- `GET /api/stock/{ticker}/flow-per-strike-intraday`
- `GET /api/stock/{ticker}/flow-recent`
- `GET /api/stock/{ticker}/fundamental-breakdown`
- `GET /api/stock/{ticker}/greeks` — required: expiry
- `GET /api/stock/{ticker}/historical-risk-reversal-skew` — required: expiry, delta
- `GET /api/stock/{ticker}/income-statements`
- `GET /api/stock/{ticker}/info`
- `GET /api/stock/{ticker}/insider-buy-sells`
- `GET /api/stock/{ticker}/interpolated-iv`
- `GET /api/stock/{ticker}/iv-rank`
- `GET /api/stock/{ticker}/max-pain`
- `GET /api/stock/{ticker}/net-prem-ticks`
- `GET /api/stock/{ticker}/nope`
- `GET /api/stock/{ticker}/ohlc/{candle_size}`
- `GET /api/stock/{ticker}/oi-change`
- `GET /api/stock/{ticker}/oi-per-expiry`
- `GET /api/stock/{ticker}/oi-per-strike`
- `GET /api/stock/{ticker}/option-chains`
- `GET /api/stock/{ticker}/option/stock-price-levels`
- `GET /api/stock/{ticker}/option/volume-oi-expiry`
- `GET /api/stock/{ticker}/options-volume`
- `GET /api/stock/{ticker}/quote`
- `GET /api/stock/{ticker}/stock-state`
- `GET /api/stock/{ticker}/stock-volume-price-levels`
- `GET /api/stock/{ticker}/technical-indicator/{function}`
- `GET /api/stock/{ticker}/unusualness`
- `GET /api/stock/{ticker}/volatility/realized`
- `GET /api/stock/{ticker}/volatility/stats`
- `GET /api/stock/{ticker}/volatility/term-structure`

### stock-directory

- `GET /api/stock-directory/ticker-exchanges`

### volatility

- `GET /api/stock/{ticker}/interpolated-iv/distribution`
- `GET /api/stock/{ticker}/volatility/anomaly`
- `GET /api/stock/{ticker}/volatility/character`
- `GET /api/stock/{ticker}/volatility/option-sentiment`
- `GET /api/stock/{ticker}/volatility/realized/windows`
- `GET /api/stock/{ticker}/volatility/term-structure/distribution`
- `GET /api/stock/{ticker}/volatility/variance-risk-premium`
- `GET /api/stock/{ticker}/volatility/variance-risk-premium/windows`
- `GET /api/volatility/anomaly/top` — required: direction
- `GET /api/volatility/character/top`
- `GET /api/volatility/option-sentiment/top`

### websocket

- `GET /api/socket`
- `GET /api/socket/contract_screener`
- `GET /api/socket/custom_alerts`
- `GET /api/socket/flow_alerts`
- `GET /api/socket/gex`
- `GET /api/socket/greek_flow`
- `GET /api/socket/greek_flow_expiry`
- `GET /api/socket/greeks`
- `GET /api/socket/interpolated_iv`
- `GET /api/socket/interval_flow`
- `GET /api/socket/iv_term_structure`
- `GET /api/socket/lit_trades`
- `GET /api/socket/market_tide`
- `GET /api/socket/net_flow`
- `GET /api/socket/news`
- `GET /api/socket/off_lit_trades`
- `GET /api/socket/option_trades`
- `GET /api/socket/periscope`
- `GET /api/socket/price`
- `GET /api/socket/quotes`
- `GET /api/socket/risk_reversal_skew`
- `GET /api/socket/ta_1d_live`
- `GET /api/socket/trading_halts`

## Notes & caveats

- `/api/socket/*` returns `{"data": []}`: those are channel-documentation routes. **Real WebSocket streaming requires the Advanced plan** per the docs, so live streaming is not usable on this token even though the routes answer 200.
- Many gated routes answer `422` with a `msg` saying *Missing access* instead of `403`. Classify by message/code, not status alone.
- Parameterised routes need real IDs: `flow-alerts/{id}` needs a flow-alert UUID, `multi-leg/{id}/legs` a strategy UUID, `option-contract/{id}` an OCC option symbol, `predictions/market/{asset_id}` a Polymarket-style asset id.
- `option-trades/full-tape/{date}` downloads a very large file; stream it, never load it whole.
- Dates default to the last trading day. `x-request-id` is unique per call; freshness should be read from payload timestamps.
