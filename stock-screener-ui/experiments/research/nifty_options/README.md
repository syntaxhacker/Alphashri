# NIFTY Options — Causal Quant Research Harness

Autonomous research program for systematic NIFTY-options edge discovery. Everything
is causal: signals use **completed bars only**, fills happen at the **next bar open**,
stops are checked before targets, and NSE fees + spread + slippage are charged.

## Key finding up front

**FYERS serves option history only for currently-listed contracts.** Expired contracts
return `-300 Invalid symbol`, so there is no multi-year option-premium history via
`/data/history`. The deep multi-regime study therefore runs on the **real NIFTY spot
path (2017-2026)** with a Black-Scholes overlay calibrated to the real premium surface
(6.2% median premium error); a **real-premium** study covers 2026-07 → 2026-09.

## Layout

| file | purpose |
|---|---|
| `fyers_data.py` | throttled + parquet-cached FYERS client, NSE option-symbol builders, expiry calendar |
| `download.py` | spot/VIX (1/5/15/D, 2017→) and option-ladder downloader |
| `download_options_real.py` | real premium ladder for the 6 listed expiries |
| `costs.py` | NSE index-option fees, spread/slippage, SPAN+exposure margin estimate |
| `pricing.py` | Black-Scholes, causal IV surface (VIX × realised vol) |
| `engine.py` | causal replay engine + option sources (real / synthetic) |
| `strategies.py` | strategy library (ORB, VWAP, prev-day break, momentum, short straddle, credit spread) |
| `stats.py` | expectancy, PF, Sharpe/Sortino, drawdown, bootstrap CI, weekly, risk-of-ruin, walk-forward |
| `sweep.py` | parallel train/test parameter sweep + red-team verdicts → `RESEARCH_LOG.jsonl` |
| `regime_check.py` | regime conditioning for the surviving strategy |
| `qc.py` | data quality control → `data_quality.json` |
| `market_state.py` | live regime / levels / OI / IV + candidate setups |
| `report.py` | assembles `REPORT.md` |
| `test_engine_causality.py` | no-look-ahead, stop-first, cost/margin regression tests |

## Reproduce

```bash
cd stock-screener-ui
.venv/bin/python experiments/research/nifty_options/download.py all
.venv/bin/python experiments/research/nifty_options/download_options_real.py 0.7
.venv/bin/python experiments/research/nifty_options/runner.py calibrate
.venv/bin/python experiments/research/nifty_options/runner.py synthetic --start 2018-01-01
.venv/bin/python experiments/research/nifty_options/runner.py real
.venv/bin/python experiments/research/nifty_options/sweep.py
.venv/bin/python experiments/research/nifty_options/regime_check.py
.venv/bin/python experiments/research/nifty_options/market_state.py
.venv/bin/python experiments/research/nifty_options/report.py
.venv/bin/python -m pytest experiments/research/nifty_options/test_engine_causality.py
```

Data + results live in `experiments/data/nifty_options/` (gitignored).

## No-look-ahead guarantees

- `StrategyContext` exposes only prefix arrays indexed up to the current completed bar.
- Signals are generated at bar *close*; `_open` fills at the *next* bar open.
- `test_engine_causality.py` asserts fills land on `signal_bar + 1` and that no price
  lookup occurs after the exit bar.

## Known limitations

- Real option history limited to listed contracts (~4 months); back-month bias in the
  real study because only Sep/Oct/Dec monthlies remain listed.
- Synthetic option P&L is a model (flat smile, no IV-crush/early-assignment).
- No historical OI (would require `oi_flag=1`; only current-chain OI is available).
- Margin numbers are SPAN+exposure estimates; the broker terminal is authoritative.
