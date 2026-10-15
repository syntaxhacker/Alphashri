# 52W Chaser (FIXED gates) — Full All-Equity Universe Sweep
Date: 2026-10-11 | Strategy: `52w_chaser` | days=365 | params={} (defaults) | Engine: nautilus (`backtest.engine.get_engine().run`)

## Fix under test
- `rsi_hi` 70→75, volume gate 1.8×20d avg (only positive single-setting gate), MA50/MA200/RSI-lo removed, NaN fails closed, entry bar excluded from its own volume baseline (`shift(1)`), duplicate-date LAST-match, canonical constants `CHASER_ADX_MIN/RHI/VOL_MULT` shared live↔backtest.
- Scope note: `params={}` leaves `enable_filters=False`, so this sweep measures the fixed codebase on the full universe; gate effects verified separately below.

## Fix verification (live before sweep)
- Unit gates: RSI 72 passes (old 70 vetoed), RSI 76 vetoed, vol 1.7× vetoed, RSI-NaN/ADX-missing fail closed, `shift(1)` baseline present. All True.
- 2-symbol trial (defaults): BHEL 6 / −256.51, CUMMINSIND 4 / +61,058.86 — matches `chaser_universe.json` exactly; `skipped_stocks` empty (zero engine errors).
- Filters-on trial (`enable_filters: True`): BHEL 6→1 (−1,493.01), CUMMINSIND 4→2 (+48,513.76) — gates live and biting.

## Universe
- Source: `chart_patterns.universes.get_universe("all_equity")` — 2,685 symbols.
- Tested 2,682, errors 3 (all genuine "No data": CAMLINFINE, SOMATEX, VASCONEQ). Zero engine errors.

## Pooled totals (defaults, costs included)
| gross | costs | **net** | trades | wins | win rate |
|---:|---:|---:|---:|---:|---:|
| 339,959.00 | 145,736.68 | **194,222.32** | 2341 | 1027 | 43.9% |

- Symbols with ≥1 trade: 1189/2,682 (44.3%); zero-trade: 1493
- Avg trades/symbol (tested): 0.87 | per active symbol: 1.97
- Exit mix: TP 811 / SL 1187 / trailing 0 / max-hold 272

## Last-week slice (Oct 5–9 2026, fixed gates, ₹1L/trade)
- Signal: last session before Oct 5 (Oct 1; mission "Fri Oct 3" is a Saturday, Oct 2 NSE holiday) close in [0.5,3.0]% above 52W high + ADX≥25, RSI≤75, vol≥1.8×avg20, avg20≥50k, NaN vetoes. Entry Oct-5 open → 2% SL on Oct 5–9 lows else Oct-9 close. Costs via `backtest/costs.py`.
- Result: **0 signals → 0 trades, net ₹0.00.**
- Evidence: full-universe band-only scan (2,471 usable) found 0 closes in-band; distribution <−10%: 2,155 / −10..−3%: 265 / −3..+0.5%: 51. Nearest misses all liquid ETFs. Oct-1 was deep in a correction (87% of symbols >10% off highs); that week's breakouts happened mid-week (cf `chaser_outcome`: 5 hitters, both chaser-band entries lost).

## Before/after vs `chaser_universe.json` (old gates)
- Old: liquid-321 pooled gross −36,726.00 / costs 35,782.45 / **net −72,508.45** / 473 trades / 43.8%.
- Overlap 321/321 symbols **bit-identical** (Δtrades=0, Δnet=0.00, 0 mismatches) — expected: filters-off path untouched by the gate fix. Headline pooled differs only by universe scope (all-equity 2,682 vs liquid 321).
- Sibling ablation context (−15.5pp→+3.5pp) applies to the filters-on path, not this defaults sweep.

## Top-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
| DYNAMATECH | 3 | 100.0% | 198,846.41 |
| BAJAJ-AUTO | 4 | 75.0% | 151,724.15 |
| SANSERA | 6 | 83.3% | 95,011.08 |
| VADILALIND | 2 | 100.0% | 91,323.31 |
| GVT&D | 3 | 100.0% | 86,508.84 |
| GRWRHITECH | 2 | 100.0% | 77,656.28 |
| KINGFA | 4 | 75.0% | 75,769.27 |
| TCPLPACK | 1 | 100.0% | 71,712.66 |
| VOLTAMP | 1 | 100.0% | 67,036.33 |
| TVSSRICHAK | 2 | 100.0% | 65,499.93 |
| SEDEMAC | 3 | 100.0% | 62,626.43 |
| HAWKINCOOK | 1 | 100.0% | 61,942.93 |
| CUMMINSIND | 4 | 75.0% | 61,058.86 |
| ESABINDIA | 2 | 50.0% | 55,304.52 |
| SIEMENS | 2 | 100.0% | 47,848.30 |
| THANGAMAYL | 5 | 80.0% | 44,065.52 |
| LT | 2 | 100.0% | 43,512.87 |
| BSE | 2 | 100.0% | 41,296.98 |
| SHRIPISTON | 5 | 60.0% | 40,558.30 |
| DIVISLAB | 4 | 50.0% | 39,849.01 |

## Bottom-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
| NGLFINE | 4 | 25.0% | -98,842.91 |
| CRAFTSMAN | 4 | 25.0% | -92,666.20 |
| APOLLOHOSP | 4 | 25.0% | -90,850.32 |
| ABB | 3 | 0.0% | -88,009.97 |
| ALKEM | 3 | 0.0% | -82,629.68 |
| BRITANNIA | 3 | 0.0% | -62,576.12 |
| CPPLUS | 5 | 0.0% | -58,567.06 |
| EICHERMOT | 2 | 0.0% | -56,768.36 |
| TIMKEN | 3 | 0.0% | -55,586.31 |
| PGHL | 1 | 0.0% | -54,664.67 |
| VSTTILLERS | 2 | 0.0% | -53,552.46 |
| CENTUM | 4 | 25.0% | -53,192.22 |
| NETWEB | 2 | 0.0% | -53,035.91 |
| AMBER | 1 | 0.0% | -50,138.22 |
| INGERRAND | 3 | 0.0% | -50,116.94 |
| SUNDARMFIN | 2 | 0.0% | -42,842.08 |
| PRIVISCL | 4 | 25.0% | -39,700.27 |
| LINDEINDIA | 1 | 0.0% | -39,562.55 |
| FINEORG | 2 | 0.0% | -38,207.60 |
| MUTHOOTFIN | 2 | 50.0% | -37,437.60 |

## Win-rate distribution (active symbols only, n=1189)
| bucket | symbols |
|---|---:|
| 0% | 466 |
| 1-25% | 31 |
| 26-50% | 282 |
| 51-75% | 83 |
| 76-99% | 6 |
| 100% | 321 |

## Trades-per-symbol distribution
- 1 trade: 535 symbols | 2–3: 520 | 4+: 134 (max: BHEL 6)

## Hand verification (trade_list re-run, costs recomputed via `backtest/costs.py`)
- **DYNAMATECH**: 3×TP → gross 200,100.00 − costs 1,253.59 = **+198,846.41** ✓ (trade0: (9715−9061)×100=65,400; costs 385.28 == stored).
- **APOLLOHOSP**: 1TP/3SL → gross −89,500.00 − costs 1,350.32 = **−90,850.32** ✓ (all 4 costs recalc-match; also matches old universe value).

## Runtime / repro
- Sweep ≈ 15 min wall (269 chunks × 10 sym, internal pool ≤4 workers), checkpoints every chunk to `experiments/chaser_fixed_progress.json` (resumable).
- Artifacts (all `experiments/chaser_fixed_*`, uncommitted): `chaser_fixed.json` (full per-symbol table), `chaser_fixed.md` (this file), `chaser_fixed_progress.json`, `chaser_fixed_run.py`, `chaser_fixed_weekslice.py`, `chaser_fixed_weekslice.json`, `chaser_fixed_report.py`, logs.
