# Timeless Reversion / BOS Research Log

Updated: 2026-09-15

## Purpose

This document records the screenshot-matching NQ short reversion strategy, the
data used to test it, the failure analysis, and the changes that survived the
larger replay runs.

The backtests are research results, not live-trading performance. They exclude
commission, slippage, latency, and partial-fill effects.

## Strategy definition

The strategy is a short-only mean-reversion setup:

1. Fair price is the 09:30 ET opening price.
2. Price must trade at least 30 points above fair price.
3. A local swing low is identified using one bar on each side.
4. A bearish BOS requires both the bar low and close to break that swing low.
5. The default entry is the first tick of the next 1-minute bar.
6. The default bracket is a 25-point stop and a 37.5-point target (1.5R).
7. Exits use bid/ask ticks; stop loss wins if stop and target cross on one tick.
8. Default session entry window is 09:30–11:00 ET.

Position sizing in the reports is six MNQ contracts: $12 per NQ point total.

## Current implementation

`experiments/timeless_reversion.py` now defaults to:

```python
max_signal_range_points = 30.0
```

This rejects a BOS candle whose high-low range is wider than 30 points. The
research showed that these expansion candles were usually continuation
impulses, not controlled reversals.

Optional controls remain available:

- `opening_drive_max_points`: block new shorts after a strong bullish first
  15-minute drive.
- `opening_range_max_points`: wait for the first completed opening range and
  block shorts when its high-low expansion is too large.
- `require_bearish_ema`: require session EMA(9) to be at or below EMA(20).
- `max_consecutive_losses`: daily circuit breaker.
- `bos_confirmation_bars=1`: wait for one completed confirmation bar.

The optional controls are not all enabled by default because the most selective
combinations produced too few trades and sometimes removed the profitable
Sep-14 screenshot behavior.

## Data and coverage

- Instrument: Dukascopy `usatechidxusd` tick data, used as the NQ proxy.
- March and April 2026 sessions were fetched and cached locally.
- May through September 2026 sessions came from the local cache, with missing
  Sep-3 and Sep-8–14 sessions refreshed directly from Dukascopy.
- Final completed-session range: 2026-03-02 through 2026-09-14.
- Valid sessions evaluated: 136.
- Partial/weekend/holiday sessions without a 09:30 ET bar were skipped.
- A constant NQ-futures basis shift does not change this strategy's relative
  point-based decisions; March/April raw proxy ticks were therefore usable for
  the signal/P&L replay.

## Final March-to-Sep-14 results

| Version | Trades | Wins/Losses | Win rate | Net points | 6 MNQ gross P&L | Profit factor | Max drawdown |
|---|---:|---:|---:|---:|---:|---:|---:|
| Original, no range guard | 225 | 82/143 | 36.4% | -500.0 | -$6,000 | 0.86 | -$10,650 |
| Current 30-point range guard | 151 | 64/87 | 42.4% | +225.0 | +$2,700 | 1.10 | -$4,650 |

Monthly P&L for the current version:

| Month | Points | 6 MNQ gross P&L |
|---|---:|---:|
| March | +50.0 | +$600 |
| April | -200.0 | -$2,400 |
| May | +300.0 | +$3,600 |
| June | -162.5 | -$1,950 |
| July | -37.5 | -$450 |
| August | +25.0 | +$300 |
| September 1–14 | +250.0 | +$3,000 |
| **Total** | **+225.0** | **+$2,700** |

The edge is not uniform. April and June remain poor regimes, while May and
September carried most of the gain.

## Why the losing months failed

The volatility audit showed that there are at least two different failure
regimes; one volatility threshold cannot explain every losing month.

| Month | Current result | Observed failure mode | What the audit suggests |
|---|---:|---|---|
| April | -200 points | Low ATR and relatively small opening ranges, but slow/choppy continuation and repeated structure reclaims | A pure volatility filter is not enough; this needs a trend/chop or reclaim-quality filter |
| June | -162.5 points | Highest average opening range and ATR in the sample; wide expansion days produced continuation impulses | A completed opening-range cap removes many of the worst days |
| July | -37.5 points | Elevated opening-range expansion and ATR, with fewer clean reversions | Same opening-range cap helps, but the sample is smaller |

The current 30-point BOS-candle guard helps because losing signal candles were
larger than winners on average, but it is applied after the session has already
expanded. It therefore misses the information available from the first 30
minutes. The new `opening_range_max_points` control tests that earlier regime
information without changing the BOS wick-and-close definition.

## Opening-range volatility test

On the same 136-session March 2–September 14 replay, using the existing
30-point BOS-candle guard:

| Variant | Trades | Net points | 6 MNQ gross P&L | Profit factor | Mar–May | Jun–Aug | Sep 1–14 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Current `range30` | 151 | +225.0 | +$2,700 | 1.10 | +150.0 | -175.0 | +250.0 |
| 30-minute range <=175 | 63 | +550.0 | +$6,600 | 1.76 | +175.0 | +162.5 | +212.5 |
| 30-minute range <=200 | 85 | +500.0 | +$6,000 | 1.47 | +275.0 | +12.5 | +212.5 |
| 30-minute range <=225 | 94 | +587.5 | +$7,050 | 1.50 | +425.0 | -50.0 | +212.5 |

These are gross, pre-cost research results and the candidates were evaluated
on this same period, so they are not proof of future profitability. The
opening-range gate is promising because it improves the high-volatility June
and July block, but it does not fully repair April: April remains negative
under each tested 30-minute cap. The <=175 candidate has the strongest measured
profit factor and positive results in each broad time block, while <=200 takes
more trades with a smoother trade-count/return compromise. Neither is promoted
to the default until it passes a genuinely independent forward period.

Raw ATR was less useful as a hard filter: ATR(30) >=40 was only mildly
negative, while some medium-ATR buckets were profitable. The opening-range
expansion is more closely tied to this strategy's failure mechanism than ATR
alone.

An April-only test of the remaining non-calendar filters found that one BOS
confirmation bar reduced the `opening range <=175` loss from -150 points to
-37.5 points (9 trades versus 11). EMA confirmation reduced trade count to 4
and still lost -37.5 points. A one-loss circuit breaker remained negative at
-112.5 points. Confirmation is therefore a useful risk/quality candidate for
forward testing, but it is not yet a proven replacement for the default: it
can delay or remove valid early reversions such as the screenshot day.

## Winner versus loser findings

Across the filtered May–September sample:

- Winning BOS candle range averaged about 29 points.
- Losing BOS candle range averaged about 40 points.
- Winners had lower 30-minute and 60-minute opening-drive strength.
- BOS depth itself did not separate winners from losers.
- VWAP position did not provide a stable edge.
- EMA(9)-EMA(20) was useful diagnostically, but as a hard filter it reduced
  trade count too aggressively and did not generalize consistently.
- Losing trades commonly reclaimed the broken BOS level within the next few
  bars; winners generally moved toward target without an immediate reclaim.
- Repeated stop-outs on the same day are a regime warning, but a loss circuit
  breaker is risk control rather than a proven source of alpha.

The Sep-14 screenshot day is an important counterexample: its first two BOS
trades worked despite a bullish opening drive. A simple “bullish open = no
trade” rule would have removed those winners. The range guard preserves them.

## Variant search conclusions

A bounded grid was run with May–July training, August validation, and September
as a final holdout.

- The 30-point signal-range guard was the best balanced high-frequency choice.
- Opening-drive caps around 30–40 points improved results but skipped some valid
  reversal days and reduced trade count.
- EMA plus range filters looked excellent in-sample but became too sparse to
  trust as the default.
- Confirmation mode improved some random holdouts but hurt the screenshot day.
- VWAP and raw BOS-depth filters were not promoted.

The current default is therefore the range guard only. It is the best measured
safe variant, not a claim of a universal optimum.

## Reusable research scripts

The exploratory scripts used for the study are in:

`research/nq_timeless_reversion/`

The most useful entry points are:

- `nq_march_now.py`: original versus improved March-to-current replay.
- `fetch_nq_mar_apr.py`: fetches missing March/April tick sessions.
- `nq_grid.py`: bounded variant grid with train/validation/final split.
- `nq_edge_analysis.py`: winner/loser feature analysis.
- `nq_regime_compare.py`: screenshot day versus representative losing days.
- `nq_2025_check.py`: small external 2025 sanity check.
- `nq_vol_audit.py`: range, ATR, and opening-drive regime audit.
- `nq_openrange_grid.py`: opening-range cap sweep.
- `nq_forward_validation.py`: cached-only forward/regime comparison.
- `nq_april_regime_test.py`: April-only EMA, confirmation, and circuit-breaker test.

The focused unit tests are in `test_timeless_reversion.py`:

```bash
python3 -m pytest -q test_timeless_reversion.py
python3 -m py_compile timeless_reversion.py
```

Latest verification: 12 tests passed.

## Next research boundary

The current default remains the 30-point BOS-candle guard. Do not promote the
opening-range, EMA, or opening-drive combinations without a larger independent
period. The next useful work is a forward holdout plus a non-calendar regime
filter for April-style slow continuation/reclaim days, with commissions and
realistic slippage included.
