# ICT Learning — MNQ Liquidity Sweep + FVG (High RR)

## v1 — Naive (FAILED)
- Sweep 2pt beyond PDH/PDL or 20-bar swing, close back inside, FVG within 20 bars, entry 50% FVG, SL sweep+2ticks
- **Result: PF 0.41 RR3 win24.1% net -22.5% on 54 trades/60 days — 0.9 trades/day, pure noise.** Mistake: 2pt wick = ATR/12 on MNQ, FVGs too common, no HTF context.

## v2 — Sweep (learned 2026-08-26)
- **Best ICT v2:** `buffer 10pt + FVG≥5pt + vol 1.5× median + RR7` → **PF2.07 on 5 trades win40% net+3.2%** (MNQ 5m 61 days). Tight sweep + displacement volume + FVG size filter cut noise 54→5 trades.
- `buffer10 fvg5 vol1.5 RR5` → PF1.43 on 5 trades — RR7 beats RR5 (high RR needs HTF).
- **HTF bias on best:** without HTF PF1.43 (5tr), with HTF 1h EMA20 bias → **PF4.55 win66.7% on 3 trades** — HTF doubles PF though sample tiny. Confirms: liquidity sweep alone needs HTF trend filter.
- **Grid sweep lessons:**
  - Buffer 10 > 15 (PF0.73 vs 0.55) — 15pt too strict loses sweeps, 2pt too loose is noise.
  - FVG 5 > 10 (PF2.07 vs 0.80) — 10pt FVG too rare on MNQ 5m.
  - Vol 1.5× cuts 35→5 trades and lifts PF 0.47→1.43 — displacement is key filter.
  - Without vol: 35tr PF0.47, with vol: 5tr PF1.43 — volume separates real sweeps from wicks.
  - RR7 > RR5 > RR3 monotonically on best config — ICT edge needs high RR, not 1.2R like ORB.
- **Next:** test HTF-biased v2 on 3 months walk-forward, require FVG retest with volume, sweep only PDH/PDL (not swing) for cleaner liquidity.

## Cross-learning ORB ↔ ICT
- ORB refined: `eff≥0.50 HL≥3 no-retest TP1.2 win84% PF4.6 on 13tr` — small sample, needs 1y walk-forward.
- ICT needs opposite: high RR (5-7R) + vol + HTF, win 40% is expected. ORB and ICT are complementary sleeves.
- Fixed bugs: `market_data.py` added `3:"3min"` (TF3 was no-op), `trading/autoresearch_strategies.py:118` SL-first (was TP-first inflating PF).
