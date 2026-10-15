# 5-minute iFVG reversion

This is a separate research strategy based on the supplied chart. Existing
fair-price/BOS strategies were not modified.

## Mechanical rules

1. Build five-minute OHLC bars from the available tick/one-minute data.
2. Detect a three-candle fair-value gap:
   - bullish FVG when the current low is above the high two candles earlier;
   - bearish FVG when the current high is below the low two candles earlier.
3. Wait for a completed candle to close through the gap, flipping its polarity:
   - bearish FVG reclaimed upward becomes long-support iFVG;
   - bullish FVG broken downward becomes short-resistance iFVG.
4. Enter on a later retest with a directional confirmation candle.
5. Enter on the next available tick after the signal candle, use bid/ask-aware
   exits, place the stop beyond the zone, and target 1.5R by default.

The chart does not specify an exact trendline, volume rule, or higher-timeframe
filter, so those are intentionally not included as hidden assumptions.

The measured strict profile adds explicit context rather than hiding it:

- 15-minute EMA20/EMA50 alignment;
- a three-bar liquidity sweep before the retest;
- minimum five-minute gap of one point;
- minimum zone-based stop distance of 25 points;
- both long and short directions remain enabled.

## September 14 replay

With the unfiltered baseline rules, 09:30–16:00 ET window, one-point minimum
gap, and two NQ contracts:

- 24 confirmed signals;
- 5 accepted trades;
- -14.07 points / -$562.80 gross;
- 2 targets and 3 stops.

This is a baseline implementation, not a production recommendation. The
negative single-day result does not disprove the chart setup; it shows that
the chart's exact iFVG definition, trendline/liquidity filter, and execution
selection still need to be specified and tested over a larger sample.

## Strict-profile replay

The strict profile was rerun after restoring the five missing September tick
sessions. The forward-validation harness replays 160 cached sessions in date
order, resets HTF context after long data gaps, and uses Yahoo `NQ=F` only for
daily regime labels; all entries and exits still come from Dukascopy bid/ask
ticks.

| Period | Sessions | Trades | W/L | Result |
|---|---:|---:|---:|---:|
| March–May train | 65 | 14 | 6/8 | +1.00R |
| June–July validation | 53 | 10 | 5/5 | +2.50R |
| August–September holdout | 37 | 10 | 5/5 | +2.50R |
| **March–September total** | **155** | **34** | **16/18** | **+6.00R** |

For comparison, the unfiltered baseline produced 660 trades and -30.44R on
the same March–September sessions. The strict profile traded on only 31 days,
so the improvement is primarily a loss-avoidance filter, not evidence of a
high-frequency edge.

Additional checks from the full report:

- 141/160 sessions joined to Yahoo daily data; tick-versus-Yahoo direction
  agreed on 85.82% of joined sessions. This is a coarse data/regime check,
  not an execution match because the session boundaries differ.
- Strict result after an additional 0.5-point round-trip cost stress:
  +5.46R / +172.28 points before commissions; at two NQ contracts this is
  approximately +$6,891 gross of commissions.
- Four of seven 2026 calendar months were positive, two negative, and one
  flat. The deterministic random five-session windows were sparse: several
  had no trades, which is consistent with the strict filter's low activity.

This is the best measured profile so far, but 34 trades is still a small
sample. It remains a research candidate for forward paper trading, not a
guarantee of future profitability. The CLI uses this strict profile by
default and loads five prior sessions for HTF warm-up. Use
`--profile baseline` to reproduce the unfiltered detector.

The reproducible report command is:

```bash
../.venv/bin/python research/nq_ifvg_reversion/forward_validation.py \
  --start 2025-07-01 --end 2026-09-14 \
  --output research/nq_ifvg_reversion/forward_validation.json
```

## Run

```bash
DUKA_DIR=. python3 experiments/ifvg_reversion.py \
  --date 2026-09-14 \
  --profile strict \
  --history-days 5 \
  --entry-start 09:30 \
  --entry-end 16:00 \
  --target-r 1.5 \
  --max-stop-points 40 \
  --min-gap-points 1
```
