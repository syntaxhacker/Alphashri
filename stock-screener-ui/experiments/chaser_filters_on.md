# 52W Chaser (filters ON) — Full All-Equity Universe Sweep
Date: 2026-10-11 | Strategy: `52w_chaser` | days=365 | params=`{"enable_filters": True}` | Engine: nautilus (`backtest.engine.get_engine().run`)

## Gates under test
- ADX ≥ 25, RSI ≤ 75 (no lower bound), volume ≥ 1.8× 20d average excluding the entry bar (`shift(1)`), NaN/missing fails closed. MA50/MA200/RSI-lo removed. Canonical `CHASER_ADX_MIN/RHI/VOL_MULT` shared live↔backtest.
- Trial (pre-sweep): BHEL 6→1 (−1,493.01), CUMMINSIND 4→2 (+48,513.76) — matches `chaser_fixed.json` filters-on trial exactly; filters-off gives 6/−256.51 and 4/+61,058.86. Gates bite.

## Universe
- Source: `chart_patterns.universes.get_universe("all_equity")` — 2685 symbols.
- Tested 2682, errors 3 (CAMLINFINE, SOMATEX, VASCONEQ).

## Pooled totals (filters ON, costs included)
| gross | costs | **net** | trades | wins | win rate |
|---:|---:|---:|---:|---:|---:|
| -2,666.00 | 59,077.34 | **-61,743.34** | 965 | 396 | 41.0% |

- Symbols with ≥1 trade: 714/2682 (26.6%); zero-trade: 1968
- Avg trades/symbol (tested): 0.36 | per active symbol: 1.35
- Exit mix: TP 323 / SL 510 / trailing 0 / max-hold 101

## Halves split (entry-date cut at 2026-04-12: H1 < cut, H2 ≥ cut; window 2025-10-11..2026-10-11)
| half | gross | costs | **net** | trades | wins | win rate |
|---|---:|---:|---:|---:|---:|---:|
| H1 (first ~182d) | -2,354.00 | 17,321.14 | **-19,675.14** | 339 | 145 | 42.8% |
| H2 (last 182d) | -312.00 | 41,756.20 | **-42,068.20** | 626 | 251 | 40.1% |

- Reconcile: H1+H2 trades 965 vs pooled 965, H1+H2 net -61,743.34 vs pooled -61,743.34, undated 0 → match=True.
- Verdict: NO EDGE IN EITHER HALF — rejected.

## Last-week slice (Oct 5–9 2026, filters-ON gates, ₹1L/trade)
- Signal: last session before Oct 5 (Oct 1; Oct 3 Sat, Oct 2 NSE holiday) close in [0.5,3.0]% above 52W high + ADX≥25, RSI≤75, vol≥1.8×avg20, avg20≥50k, NaN vetoes. Entry Oct-5 open → 2% SL on Oct 5–9 lows else Oct-9 close. Costs via `backtest/costs.py`.
- Result: **0 signals → net ₹0.00.**

## Before/after vs `chaser_fixed.json` (same universe, filters OFF)
- Old (off): gross 339,959.00 / costs 145,736.68 / **net 194,222.32** / 2341 trades / 43.9% (n=2682).
- New (on): gross -2,666.00 / costs 59,077.34 / **net -61,743.34** / 965 trades / 41.0% (n=2682).
- Overlap 2682 symbols: Δnet **-255,965.66**, Δtrades -1376, Δgross -342,625.00; changed 1092, unchanged 1590.

## Top-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
| TCPLPACK | 1 | 100.0% | 71,712.66 |
| VOLTAMP | 1 | 100.0% | 67,036.33 |
| POLYCAB | 1 | 100.0% | 60,668.01 |
| LUMAXIND | 1 | 100.0% | 56,390.30 |
| THANGAMAYL | 1 | 100.0% | 52,040.76 |
| CUMMINSIND | 2 | 100.0% | 48,513.76 |
| FLUOROCHEM | 1 | 100.0% | 47,343.57 |
| VADILALIND | 1 | 100.0% | 45,899.68 |
| GVT&D | 2 | 100.0% | 44,890.43 |
| DIVISLAB | 2 | 50.0% | 36,398.70 |
| HEROMOTOCO | 1 | 100.0% | 31,082.99 |
| AVALON | 2 | 100.0% | 30,892.50 |
| MUTHOOTFIN | 1 | 100.0% | 29,070.52 |
| VSTTILLERS | 1 | 100.0% | 28,343.59 |
| WABAG | 1 | 100.0% | 22,814.41 |
| STYLAMIND | 1 | 100.0% | 22,420.56 |
| SHRIPISTON | 1 | 100.0% | 22,392.15 |
| SJS | 3 | 66.7% | 20,454.24 |
| EMCURE | 2 | 100.0% | 18,683.67 |
| NITTAGELA | 1 | 100.0% | 18,452.43 |

## Bottom-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
| NAVINFLUOR | 2 | 0.0% | -76,347.80 |
| NETWEB | 2 | 0.0% | -58,782.68 |
| PGHL | 1 | 0.0% | -54,664.67 |
| AMBER | 1 | 0.0% | -50,138.22 |
| CRAFTSMAN | 1 | 0.0% | -38,321.11 |
| ABB | 1 | 0.0% | -35,362.46 |
| SEDEMAC | 2 | 0.0% | -31,731.44 |
| EICHERMOT | 1 | 0.0% | -31,485.23 |
| INGERRAND | 2 | 0.0% | -30,582.72 |
| NGLFINE | 1 | 0.0% | -30,141.69 |
| TITAN | 3 | 33.3% | -29,986.76 |
| GRINDWELL | 1 | 0.0% | -29,682.70 |
| KOVAI | 1 | 0.0% | -27,561.15 |
| KPL | 2 | 0.0% | -25,285.07 |
| WHEELS | 2 | 0.0% | -25,268.08 |
| RPGLIFE | 2 | 0.0% | -24,310.50 |
| VENKEYS | 2 | 0.0% | -20,421.86 |
| THERMAX | 1 | 0.0% | -20,037.14 |
| AJANTPHARM | 1 | 0.0% | -18,306.98 |
| MACPOWER | 3 | 33.3% | -16,345.73 |

## Win-rate distribution (active symbols only, n=714)
| bucket | symbols |
|---|---:|
| 0% | 361 |
| 1-25% | 0 |
| 26-50% | 104 |
| 51-75% | 9 |
| 76-99% | 0 |
| 100% | 240 |

## Trades-per-symbol distribution
- 1 trade: 505 symbols | 2–3: 206 | 4+: 3 (max: SHREEJISPG 5)

## Hand verification (engine re-run, gross + costs recomputed via `backtest/costs.py`)
- **TCPLPACK**: 1 trades, net 71,712.66, sweep-match=True, gross-recalc=True, costs-recalc=True
- **NAVINFLUOR**: 2 trades, net -76,347.80, sweep-match=True, gross-recalc=True, costs-recalc=True

## Runtime / repro
- Sweep chunked ×10 sym (internal pool ≤4 workers), checkpoints every chunk to `experiments/chaser_filters_on_progress.json` (resumable), logged every 50.
- Artifacts (all `experiments/chaser_filters_on_*`, uncommitted): `chaser_filters_on.json` (full per-symbol table), `chaser_filters_on.md` (this file), `chaser_filters_on_progress.json`, `chaser_filters_on_run.py`, `chaser_filters_on_weekslice.py`, `chaser_filters_on_weekslice.json`, `chaser_filters_on_report.py`, `chaser_filters_on_trial.py`, logs.
