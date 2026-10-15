# Autoresearch: LRL+iFVG PF and A+ setup quality

## Objective

Improve the low-resistance-liquidity plus iFVG retest strategy while keeping
history-only signals, tick-accurate fills, and enough A+ setups to be usable.
The literal chart profile remains unchanged until a candidate passes the frozen
chronological validation and September holdout.

## Metrics

- **Primary**: profit factor on validation sessions (higher is better).
- **Secondary**: net points, trade count, active days, A+ setup count, maximum
  drawdown, and holdout profit factor.
- **A+ setup definition**: confirmed LRL with at least four touches and an
  iFVG timeframe of three minutes or higher, followed by a retest.

## How to Run

From this directory:

```bash
./autoresearch.sh
```

The runner evaluates fixed parameter variants on evenly spaced March–July
sessions, validates the top candidates on August, and tests the winner once on
September. Results are stored in `research/nq_lrl_liquidity/autoresearch.jsonl`.

## Files in Scope

- `lrl_liquidity_reversion.py` — strategy engine and configuration.
- `research/nq_lrl_liquidity/autoresearch_loop.py` — bounded search and split
  evaluation.
- `research/nq_lrl_liquidity/autoresearch.sh` — reproducible entry point.
- `research/nq_lrl_liquidity/autoresearch.jsonl` — experiment ledger.
- `research/nq_lrl_liquidity/worklog.md` — narrative findings.

## Off Limits

- Existing production strategies, API/UI files, and `db/alphashri.db`.
- September holdout data during candidate selection.
- Any look-ahead or future-bar information.

## Constraints

- Keep the existing six LRL unit tests green.
- Do not promote a candidate solely because of one large winning day.
- A candidate must have at least ten trades and five active days in the
  selection stage; holdout results are reported separately.
- Prefer a candidate with more A+ setups when PF is comparable.

## What's Been Tried

- Baseline measured profile: four-touch LRL, three-minute iFVG, retest, 1R
  target. The recent six-date random check produced PF 1.21 across only 16
  trades, so broader validation is required.
- Literal three-touch multi-timeframe profile overtrades and is regime
  sensitive; it produced PF 0.75 on the same random-date check.
- First parameter-only search: `max_stop_45` led August validation at PF 1.52,
  but fell to PF 1.03 on the untouched September holdout, versus baseline PF
  1.40. This is treated as overfit and not promoted.
- Next hypothesis: completed 15-minute or 5-minute EMA alignment should block
  counter-trend LRL targets during strong trends.
- Focused loop result: 15-minute EMA alignment reached validation PF 1.87 but
  produced only one September holdout trade, which lost. `tight_line_gap`
  reached validation PF 1.34 but holdout PF 0.97. No candidate is promoted;
  the measured baseline remains the reference.
