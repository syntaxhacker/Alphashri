# Findings — NQ LRL autoresearch (research record, not an edge claim)

Merged from `autoresearch.md` (round notes) and `experiments/worklog.md` (raw sweep tables, kept verbatim at [`results/worklog.md`](results/worklog.md)). Trial numbers below come from `results/trials.jsonl` (283 lines, chronological audit log). See [`README.md`](README.md) for run commands and the full limitations list.

## Verdict

As production code this work is dead — nothing imports it. As research, the best result is **not a true out-of-sample edge**: 2026 was used for selection, the search ran ~283 trials, the headline LRL result has n≈62, selection was on gross R with no slippage, and it covers one instrument in one regime.

## LRL rounds (from autoresearch.md)

Walk-forward IS=2025 / OOS=2026. Notes state selection = min(IS,OOS) avgR with hold≥5 bars and n≥45.

| ver | config | key change |
|--|--|--|
| r1 | r1 time30 | exit=time trail=0.25 time=30 be=0.0 sess_end=960 maxdist=45.0 db=0.5 |
| r2 | r2 sess2h+time30 | exit=time trail=0.25 time=30 be=0.0 sess_end=690 maxdist=45.0 db=0.5 |
| r3 | r3 sess2h+time45+db.45 | exit=time trail=0.25 time=45 be=0.0 sess_end=690 maxdist=45.0 db=0.45 |
| r4 | r4 maxdist60 | exit=time trail=0.25 time=45 be=0.0 sess_end=690 maxdist=60.0 db=0.45 |
| r5 | r5 maxdist70 | exit=time trail=0.25 time=45 be=0.0 sess_end=690 maxdist=70.0 db=0.45 |
| r6 | r6 be1.0+time60 | exit=time trail=0.25 time=60 be=1.0 sess_end=690 maxdist=70.0 db=0.45 |

r6 is frozen in `sims/lrl_ifvg/params.json`.

### Issues found during the rounds

- Intrabar look-ahead (entry-bar high used for the trail) → fixed: stop is checked before the peak update.
- Trail 0.1R is sub-bar → exits at ≈0R; minimum realistic trail ≈0.25R.
- Session-gap FVG artifacts → same-session enforcement added.
- Higher avgR came with longer, lumpier holds (win rate 36–43%), so the $2k drawdown limit was breached above ≈0.25% risk.

## Sim sensitivity: two conflicting result tables

`results/worklog.md` contains two 30-row tables for the **same candidate grid** (both logged as segment 0 in the trials file, with run numbering restarted; the later block has later timestamps and post-fix numbers). The only substantive change between them was the intrabar sim correction noted above. Selected rows (OOS avgR / IS avgR / n):

| candidate | block 1 (before fix) | block 2 (after fix) |
|---|---|---|
| baseline trail0.5 tf5 | +1.221 / +0.591 / 62 | +0.435 / −0.013 / 62 |
| tf1 | +0.588 / +0.395 / 281 | +0.083 / −0.018 / 281 |
| trail0.25 | +1.380 / +0.786 / 62 | +0.601 / +0.154 / 62 |
| disp0.5 | +2.411 / +0.914 / 70 | +0.453 / +0.406 / 70 |
| sl0 | +2.797 / +1.292 / 62 | +1.216 / +0.058 / 62 |
| fixedR3 | +0.026 / +0.321 / 62 | −0.087 / +0.085 / 62 |

One ordering change moved headline OOS avgR by up to ~2R and flipped several IS values from positive to negative. Simulation mechanics, not the signal, dominated these results — any comparison against numbers from other sims is unsafe. Full tables: `results/worklog.md`.

## Prop-eval claims (with caveats)

From `autoresearch.md`, rolling eval (47 starts, daily circuit breaker −$800, $50k start, +$3k target, $2k max DD):

- `best_r6` at 0.25% risk: PASS 100%, median 21 days to +$3k.
- At 0.5%: PASS ≈47%, with DD breaches.
- At 1%: PASS ≈36%.

Caveats: these are gross R-based signals with a flat per-contract cost ($1.5 in `evaluate/prop_eval_lrl.py`), **no slippage**, and the same 2026 data that was used for selection. The 47 rolling starts are overlapping windows on one short sample, not independent trials. `evaluate/prop_eval_v3.py` applies the same $50k / +$3k / $2k / −$800 assumptions to the breakout model at 0.25–1% risk with a $4 per-trade cost; no written result summary from that script survived in the source notes.

## Generation 2 and 3 summary

| model | trial | logged metrics | kept? |
|---|---|---|---|
| HTF sweep `V2b db.6` | run 1102, segment 9 | OOS avgR 0.4310, IS avgR 0.3964, total_n 84, OOS PF 1.80, win 29% | keep |
| HTF breakout `V3b htf30_K40_t1.25` | run 2110, segment 11 | OOS avgR 0.6953, IS avgR 0.5024, total_n 471, OOS PF 2.45, win 51%, 15.9 R/month | keep |

These are logged values from `results/trials.jsonl`, not verified reproductions. Generation 2 searches HTF liquidity sweeps then an LTF iFVG retrace with the stop at the HTF sweep extreme; generation 3 trades a K-bar HTF range breakout with a trailing stop. Both were selected on the same reused 2026 period.

## Config provenance

| file | reconstructed from |
|---|---|
| `sims/lrl_ifvg/params.json` (r6) | Overrides from the r6 row of `autoresearch.md` (`exit=time, trail=0.25, time_bars=60, be=1.0, sess_end=690, maxdist=70, disp_body=0.45`) applied to the surviving `drive3.py` BASE (all other values unchanged). |
| `sims/htf_sweep/params.json` (V2b db.6) | Run 1102 label in `results/trials.jsonl` (`V2b db.6`) → `disp_body=0.6` applied to the surviving `drive_v2.py` BASE. |
| `sims/htf_breakout/params.json` (V3b htf30_K40_t1.25) | Run 2110 label (`V3b htf30_K40_t1.25`) → `htf=30, K=40, trail=1.25` applied to the surviving `drive_v3.py` BASE. |

Reproduction gap: the drivers for segments 9 and 11 (`V2b`, `V3b`) were already missing; their BASE dictionaries are inferred from the surviving `drive_v2.py` / `drive_v3.py`, so exact equality with the historical runs is not guaranteed. The LRL round notes also say hold≥5/n≥45 while the surviving `drive3.py` used hold≥3 — the frozen params are unaffected, but the stated selection rule and the executed one differ.

## Curve-fit caveats

- 2026 OOS was part of the search; there is no untouched holdout year.
- ~283 trials across seven segments with **changing** selection rules (OOS avgR with `IS>0`; then `min(IS,OOS)` with hold≥3; then `total_n≥40`; then R/month) — no multiple-testing correction.
- n≈62 OOS trades for the LRL family; small-sample win rates and PFs are unstable.
- Backtests are gross R with no slippage or costs; costs appear only in the prop-eval scripts.
- Single instrument (NQ), single regime; session filters and exit styles were tuned on the same data.
- Result tables disagree after a one-line sim fix (above), so small metric differences are not meaningful.
