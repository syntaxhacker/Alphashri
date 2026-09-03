# Autoresearch: SMC trend-break strategy (PF on held-out tick sessions)

## Objective
Evolve `trading/smc_ifvg.py` (SMC iFVG engine on Dukascopy US-100 ticks) into a strategy that
captures moves and swings with high R multiples: HTF bias from swing structure (HH/HL vs LH/LL),
no entries in sideways chop — only trends, trend-breaks (BOS) and inversions. Validate every
change on held-out random sessions (no lookahead anywhere, no overfit to the train set).

## Metrics
- **Primary**: `pf_test` (Profit Factor on 2 held-out sessions, higher better)
- **Secondary**: `pf_train`, `net_test`, `net_train`, `trades_*`, `win_*`

## How to Run
`./autoresearch.sh` from `stock-screener-ui/` — outputs `METRIC name=number` lines.
Full loop state in `experiments/smc/autoresearch.jsonl`; narrative in `experiments/smc/worklog.md`.

## Files in Scope
- `trading/smc_ifvg.py` — the engine (structure, entries, exits; all подбор here)
- `experiments/smc/bench.py` — train/test benchmark (env-configured)
- `experiments/smc/autoresearch.sh` — runner
- `tests/test_smc_ifvg.py` — unit tests (must stay green)
- `scripts/smc_ifvg_eval.py` — single-session inspector (read/extend only for debugging)

## Off Limits
- `db/alphashri.db` — never touch. `api/*`, `src/*` — UI/API frozen during the loop.
- Do NOT commit unrelated repo dirt: stage only the files in scope above.

## Constraints
- History-only signals, tick-accurate fills, SL-before-TP on ambiguous ticks (conservative).
- Keep decisions: primary metric rules; a `keep` needs test-PF improvement (or equal test-PF
  with clearly better trade quality + a note why).
- 11+ unit tests must pass before any keep. Baseline test count must not drop.
- Prefer structural SMC ideas (bias, sweeps, BOS, FVG/iFVG, liquidity) over indicator soup.
- Beware path dependence: entry filters reshuffle the whole sequence — always judge by the
  matrix numbers, never by single-trade logic.

## What's Been Tried
- v2 baseline (RR3, inv+retest coupled): train PF ~1.9 / test PF ~0.8 (6-session net +875).
- Divided stacks (inv + retest independent): combined +943.
- FAILED (system-negative, kept opt-in/off): 15m-EMA gate, tie-break fades, 30pt proximity
  gate, micro-pivot SL, 5-bar swing BOS, inv-flip bias, dedupe, 50/50 1R partials, REV exits.
- tp-near (nearest RR≥3 target for LONGs): +1104 divided — promising, needs 30-session proof.
- Known cost centers: chase entries after extended moves, counter-trend bounce longs,
  round-trip TP misses (e.g. +83 → -33).
