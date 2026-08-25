# Autoresearch: ORB Winrate 80% (NSE NETWEB + US ES)

## Objective
Push ORB winrate to **≥80%** without collapsing PF. Current best is 84.6% on 13tr (eff≥0.50 HL≥3 no-retest TP1.2 on NETWEB Jan-Apr) but fragile (small n). Need to generalize across TF/OR/TP while keeping PF>1.5 and trades≥10. Test on NETWEB 5mo (2026-03-26→08-26, Upstox) — same window we found PF1.5-4.6 depending on RR.

## Metrics
- **Primary**: `win_rate` (%, higher is better) — target 80
- **Secondary**: `profit_factor`, `net_pnl`, `total_trades`

## How to Run
`./autoresearch.sh` — outputs `METRIC win_rate=...`, `METRIC profit_factor=...` etc.

Env overrides:
```
OR_MIN=15 TF=3 EFF_THR=0.50 HL_THR=3 TP_R=1.2 RETEST=0
```

## Files in Scope
- `experiments/benchmark_orb_winrate.py` — the benchmark (fetch NETWEB via market_data, ORB logic, metrics)
- `market_data/market_data.py` — data fetcher (read-only)
- `experiments/us_futures_research/*` — prior ORB research (read-only, for ideas)

## Off Limits
- `db/`, `api/`, `src/`, `trading/`, `backtest/` — production code
- Do not change TF mapping in market_data

## Constraints
- No new deps
- Trades≥10 to count (else winrate noisy)
- PF must stay >1.2 (don't buy winrate with negative edge)
- Fast: Upstox fetch cached, benchmark <30s

## What's Been Tried
- Baseline 5mo NETWEB TF3 OR30 retest TP3 PF1.54 win52.4% (84tr)
- Refined ES no-retest eff0.50 HL3 TP1.2 PF4.61 win84.6% (13tr, Jan-Apr) — fragile, Aug 0tr with strict 3m, 5m gave 4tr win75%
- Looser eff0.30 HL1 PF1.50 win60.7% (61tr) — more trades but win drops
- Current loop starts from refined (OR15 TF3 eff0.50 HL3 TP1.2, 84.6%) and will sweep TF/OR/TP/HL to hit 80% winrate with ≥10tr
