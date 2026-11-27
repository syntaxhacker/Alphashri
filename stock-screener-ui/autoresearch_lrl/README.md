# autoresearch_lrl — NQ futures research sandbox

**Research only.** Nothing in this folder is imported by the app, API, bots or any live strategy. It is not production code and must not be wired in without a separate review. The Dukascopy NQ 1-minute dataset is **not committed**.

## Verdict (honest)

As production code this folder is dead. As research, the best result is **not a true out-of-sample edge**: the 2026 "OOS" year was reused for selection across ~283 trials, selection was on gross R (slippage and most costs absent), the headline LRL result rests on n≈62 trades, and it is one instrument in one regime. Treat every number below as a record of an experiment, not as evidence of a tradable edge.

## Structure

```
README.md                       this file
findings.md                     merged notes, result tables, caveats, provenance
sims/lrl_ifvg/                generation 1 — corrected LRL sim + r6 config
sims/htf_sweep/               generation 2 — HTF sweep -> iFVG -> retrace + V2b config
sims/htf_breakout/            generation 3 — HTF K-bar breakout + V3b config
evaluate/prop_eval_lrl.py       $50k rolling prop eval for the LRL config
evaluate/prop_eval_v3.py        $50k rolling prop eval for the V3 breakout config
results/trials.jsonl            283-line audit log of all trials (not proof)
results/worklog.md              raw pre/post-sim-fix sweep tables
```

Each `sims/*/backtest.py` is standalone: it loads its same-directory `params.json`, prints `METRIC ...` lines, and splits IS=2025 / OOS=2026.

## Supply data and run

We kept the strategy math unchanged; only I/O was made configurable:

```bash
# From stock-screener-ui/. The pickle is a Dukascopy NQ 1m DataFrame with a
# tz-aware DatetimeIndex and open/high/low/close/volume columns.
export NQ_1M_PKL=/path/to/duka_nq_1m.pkl   # documented default: /tmp/opencode/duka_nq_1m.pkl

../.venv/bin/python autoresearch_lrl/sims/lrl_ifvg/backtest.py
../.venv/bin/python autoresearch_lrl/sims/htf_sweep/backtest.py
../.venv/bin/python autoresearch_lrl/sims/htf_breakout/backtest.py

../.venv/bin/python autoresearch_lrl/evaluate/prop_eval_lrl.py
../.venv/bin/python autoresearch_lrl/evaluate/prop_eval_v3.py
```

`NQ_1M_PKL` selects the pickle (default `/tmp/opencode/duka_nq_1m.pkl` — that path appears in the scripts only as this documented fallback). `PARAMS_JSON` optionally overrides the config path; otherwise each backtest reads its own `params.json` and each prop eval reads the matching `sims/*/params.json`. Reproducing the three frozen runs requires the original data file, which is absent from the repo.

## Limits to keep in mind

- 2026 was used for **selection**, so its "OOS" metrics are in-sample to the search.
- ~283 trials, gross-R selection, n≈62 for the LRL result; multiple testing is uncorrected.
- Costs appear **only** in the prop-eval scripts; backtests have no slippage or fees.
- One instrument, one regime; no walk-forward across independent years.
- Two conflicting result tables for the same candidates show how sensitive the sim was to one intrabar fix (see `findings.md`).
- Config provenance is reconstructed from surviving notes/drivers; the V2b/V3b sweep drivers are gone, so exact historical reproduction of those two runs is not guaranteed.

`results/trials.jsonl` is a chronological **audit log of what was tried**, not proof that any configuration works.
