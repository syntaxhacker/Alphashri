# 52W Chaser — Nifty500 Liquid Universe Sweep
Date: 2026-10-11 | Strategy: `52w_chaser` | days=365 | params=default
Engine: nautilus (`backtest.engine.get_engine().run`)

## Universe
- Source: Nifty500 (501) → filter `avg_volume_10d ≥ 500,000`
- TV metrics returned for 321/501 → kept 227, dropped below threshold 94
- TV-missing 180 resolved via Upstox daily candles: kept 96, dropped 79, no-data 5 (BAGMANE, BIRET, DUMMYHEG, EMBASSY, MTARTECH)
- **Liquid universe: 323 symbols** (DUMMYHEG blacklisted by instrument master)
- Tested 321, errors 2 (HFCL (No data), STLTECH (No data))

## Pooled totals (default params, costs included)
| gross | costs | **net** | trades | wins | win rate |
|---:|---:|---:|---:|---:|---:|
| -36,726.00 | 35,782.45 | **-72,508.45** | 473 | 207 | 43.8% |

- Symbols with ≥1 trade: 196/321 (61.1%); zero-trade: 125
- Avg trades/symbol (tested): 1.47 | per active symbol: 2.41
- Exit mix: TP 187 / SL 256 / trailing 0 / max-hold 21
- Costs ≈ 49.3% of (gross loss + costs) drag — flat 100-share sizing, costs dominate.

## Verdict: NOT profitable on liquid Nifty500 @ defaults
Net **₹-72,508.45** over 473 trades / 321 symbols / 365d. Win rate 43.8% with
TP 187 vs SL 256 exits — losers outnumber winners and costs erase the rest.

## Top-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
| GVT&D | 3 | 100.0% | 86,508.84 |
| CUMMINSIND | 4 | 75.0% | 61,058.86 |
| LT | 2 | 100.0% | 43,512.87 |
| BSE | 2 | 100.0% | 41,296.98 |
| AZAD | 3 | 66.7% | 29,644.21 |
| ANANDRATHI | 4 | 75.0% | 26,139.04 |
| BHARATFORG | 5 | 80.0% | 25,625.46 |
| WELCORP | 4 | 75.0% | 23,851.39 |
| AETHER | 5 | 60.0% | 21,252.92 |
| AUROPHARMA | 4 | 75.0% | 18,546.56 |
| ADANIGREEN | 2 | 100.0% | 17,352.41 |
| TVSMOTOR | 4 | 50.0% | 17,127.27 |
| LUPIN | 3 | 66.7% | 15,187.48 |
| NESTLEIND | 4 | 75.0% | 14,425.63 |
| GESHIP | 2 | 100.0% | 14,348.11 |
| LAURUSLABS | 4 | 75.0% | 12,292.22 |
| WOCKPHARMA | 1 | 100.0% | 12,027.73 |
| HINDALCO | 2 | 100.0% | 10,406.89 |
| SHRIRAMFIN | 4 | 75.0% | 10,149.36 |
| JKTYRE | 3 | 100.0% | 9,472.36 |

## Bottom-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
| APOLLOHOSP | 4 | 25.0% | -90,850.32 |
| NETWEB | 2 | 0.0% | -53,035.91 |
| MUTHOOTFIN | 2 | 50.0% | -37,437.60 |
| GLENMARK | 3 | 0.0% | -35,711.10 |
| M&M | 2 | 0.0% | -26,766.12 |
| GRAPHITE | 5 | 0.0% | -21,064.62 |
| AXISBANK | 4 | 0.0% | -20,793.33 |
| SUNPHARMA | 3 | 0.0% | -17,473.26 |
| COFORGE | 2 | 0.0% | -17,459.78 |
| ADANIENSOL | 5 | 20.0% | -17,000.69 |
| JINDALSTEL | 3 | 0.0% | -16,682.88 |
| CHENNPETRO | 4 | 0.0% | -16,551.58 |
| GRASIM | 4 | 25.0% | -15,972.33 |
| HAL | 1 | 0.0% | -15,656.19 |
| DRREDDY | 2 | 0.0% | -15,025.49 |
| MANKIND | 1 | 0.0% | -14,965.22 |
| BAJFINANCE | 2 | 0.0% | -14,468.77 |
| ENRIN | 1 | 0.0% | -11,359.98 |
| HDFCAMC | 1 | 0.0% | -11,145.63 |
| CLEANMAX | 1 | 0.0% | -10,756.81 |

## Win-rate distribution (active symbols only, n=196)
| bucket | symbols |
|---|---:|
| 0% | 66 |
| 1-25% | 12 |
| 26-50% | 55 |
| 51-75% | 25 |
| 76-99% | 3 |
| 100% | 35 |

## Trades-per-symbol distribution
- 1 trade: 60 symbols | 2–3: 94 | 4+: 42 (max: BHEL 6)

## Runtime
- Sweep wall time ≈ 80.8s across 13 chunks (data cached / daily bars are cheap)
- wrangle_bars read-only-buffer fix verified: `skipped_stocks` shows only 2 genuine "No data" (HFCL, STLTECH), zero engine errors.

## Notes
- 0-trade symbols (125) are legitimate no-signal outcomes (entry needs new 52W high + momentum filters), confirmed by RELIANCE/INFY 2-symbol verification pre-run.
- Per-symbol full table: `experiments/chaser_universe.json` (`per_symbol`).
- Progress checkpoints: `experiments/chaser_universe_progress.json`; liquid list: `experiments/chaser_universe_list.json`.
