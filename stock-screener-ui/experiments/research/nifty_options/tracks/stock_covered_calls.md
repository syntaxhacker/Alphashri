# STOCK-OPTIONS track — covered-call income vs buy-and-hold (MODEL-BASED)
**⚠ No real stock-option premiums exist** (FYERS token expired; only NIFTY cached). Premiums are **Black-Scholes** off the *real* stock path with **causal IV** = 20d trailing realised vol × multiple. Every number is a model result, not a market quote.
**Setup.** yfinance daily (auto-adjust) 2020-09→2026-09, 12 liquid optionable NSE names (RELIANCE, TCS, INFY, HDFCBANK, ICICIBANK, SBIN, ITC, LT, AXISBANK, MARUTI, BHARTIARTL, KOTAKBANK). Hold stock, sell 1 call at K=spot×(1.0/1.02/1.05/1.08), hold to expiry, cash-settle intrinsic, roll. Schedules: monthly last-Thursday expiry and 30-DTE. Costs: `costs.leg_costs` + 0.35% half-spread + 0.15% slip per leg. IV=RV×1.15, smile=atm·(1+1.5·|log(K/S)|). Lots = current NSE F&O lots (RELIANCE 500, TCS 175, INFY 400, HDFCBANK 550, ICICIBANK 700, SBIN 750, ITC 400, LT 300, AXISBANK 625, MARUTI 50, BHARTIARTL 475, KOTAKBANK 400; NSE contract file 2025, revised periodically).
## Aggregate (monthly n=864 / 30-DTE n=840; 12 names)
| metric | CC 1.05 mo | B&H mo | CC 1.05 30DTE | B&H 30DTE |
|---|---|---|---|---|
| ann return (pooled) | **17.9%** | 11.6% | **23.1%** | 14.5% |
| ann vol | 18.7% | 22.1% | 19.1% | 22.9% |
| Sharpe | **0.61** | 0.23 | **0.79** | 0.40 |
| x-sec CAGR mean | 17.7% | 10.1% | 23.1% | 14.5% |
| max DD (x-sec mean) | −19.4% | −28.5% | −19.6% | −27.6% |
| win rate / cycle | 63% | 55% | — | — |
CC beats B&H by **+0.52%/cycle ≈ +6.3%/yr** (30-DTE +6.9%/yr); bootstrap 90% CI on per-cycle excess **[+0.34%, +0.71%]**, P(>0)=1.00; beats B&H in 92% of names at 1.05, 100% at 1.08. Avg premium 1.0→3.25%, 1.02→2.41%, **1.05→1.59%**, 1.08→1.09% of spot. Call expired worthless (NOT capped) 45%/59%/**76%**/88%.
## Per-stock (monthly, m=1.05, net of costs)
| sym | CC CAGR | B&H CAGR | CC Shp | B&H Shp | CC DD | B&H DD | prem% | worth% | BE IV× |
|---|---|---|---|---|---|---|---|---|---|
| RELIANCE | 9.5 | −3.8 | 0.24 | −0.47 | −17.5 | −35.6 | 1.55 | 86 | 0.52 |
| TCS | 4.7 | −4.1 | 0.01 | −0.34 | −35.9 | −49.7 | 1.40 | 79 | 0.73 |
| INFY | 11.4 | 1.3 | 0.30 | −0.08 | −34.1 | −43.2 | 1.77 | 74 | 0.79 |
| HDFCBANK | 11.6 | 2.7 | 0.33 | −0.11 | −18.1 | −25.8 | 1.39 | 78 | 0.73 |
| ICICIBANK | 27.2 | 19.8 | 1.13 | 0.70 | −11.9 | −17.9 | 1.48 | 79 | 0.87 |
| SBIN | 21.0 | 22.4 | 0.77 | 0.61 | −12.0 | −22.0 | 1.93 | 71 | **1.19** |
| ITC | 13.6 | 7.5 | 0.49 | 0.13 | −23.8 | −34.7 | 1.27 | 82 | 0.86 |
| LT | 27.0 | 20.8 | 1.05 | 0.66 | −17.5 | −26.5 | 1.74 | 74 | 0.96 |
| AXISBANK | 22.1 | 14.7 | 0.79 | 0.42 | −16.2 | −23.2 | 1.82 | 69 | 0.92 |
| MARUTI | 18.7 | 7.6 | 0.65 | 0.14 | −17.2 | −19.6 | 1.56 | 75 | 0.71 |
| BHARTIARTL | 33.3 | 25.7 | 1.46 | 1.00 | −8.5 | −10.8 | 1.55 | 69 | 0.90 |
| KOTAKBANK | 12.7 | 6.1 | 0.37 | 0.09 | −20.3 | −32.5 | 1.60 | 74 | 0.90 |
## Regime test (the known truth), monthly m=1.05
| stock move in cycle | n | CC mean | B&H mean | CC − B&H |
|---|---|---|---|---|
| strong bull (> +5%) | 207 | +6.8% | +9.4% | **−2.5 pp** |
| mild up (0…+5%) | 267 | +4.0% | +2.4% | **+1.6 pp** |
| flat/down (≤0) | 390 | −3.0% | −4.4% | **+1.4 pp** |
Confirmed: a covered call = long stock + short call = **short vol** — caps upside in strong bulls, earns carry when flat/mildly-up or falling.
## IV sensitivity / break-even (m=1.05, monthly) — the model dependency
| IV/RV mult | cum CC | cum B&H | avg prem% |
|---|---|---|---|
| 0.90 | +100% | +100% | 1.08 |
| 1.00 | +130% | +100% | 1.28 |
| **1.15 base** | **+187%** | +100% | 1.59 |
| 1.30 | +261% | +100% | 1.92 |
Break-even **raw IV mult ≈0.90** (aggregate); incl. smile the *effective* break-even is ≈**0.97×RV**. Per name 0.52–1.19: momentum names (SBIN 1.19) need rich IV; laggards (RELIANCE 0.52) "win" only because B&H was negative. The whole positive result is the assumed IV=1.15×RV premium.
**Other structures (monthly).** CSP 0.97: ann 9.3%, vol 10.9%, Sharpe 0.26, win 80%, assigned ~17–35%. Collar 0.95/1.05: ann 8.8%, vol 13.2%, Sharpe 0.17; 5th-pct cycle **−4.8% vs B&H −8.8%**, worst −5.2% (real tail reduction). Wheel (CSP→assign→CC): mean CAGR 21.9% / 23.9% (30-DTE).
## Red-team / model dependency
1. **Premiums fabricated** — the +6–7%/yr edge *is* the modelled VRP (IV 1.15×RV + smile). Real single-stock IV/RV is often 0.9–1.0 (trending names) → edge can vanish (break-even ≈0.97×RV).
2. **European/cash-settle vs real American, physically-settled stock F&O** — no early assignment or ex-dividend early exercise (real writers get called away pre-div).
3. **IV from trailing RV** — real IV is forward-looking and spikes into earnings/events where realised can exceed IV; monthly cycles include those.
4. **Costs may be optimistic** — 0.5% round-trip/leg; single-stock spreads are wider than index.
5. **Survivorship + dividend-folded adjusted path** (12 survivors only). Bootstrap CI is on *model* per-cycle excess — sampling stability, not model validity.
## Verdict
**DEFER.** In-model, covered-call income beats buy-and-hold by ~+6–7%/yr with better Sharpe and smaller drawdowns; it underperforms only in strong-bull months (~25% of cycles) and wins in flat/mild-up/down months — the classic short-vol profile. But ~all of the edge is the assumed VRP, break-even sits at ~0.97× realised vol, and no real premiums could be tested. Re-run on real stock-option chains before any capital decision. Artifacts: `stock_covered_calls.json`, `stock_covered_calls_log.jsonl`, `stock_covered_calls.py`.
