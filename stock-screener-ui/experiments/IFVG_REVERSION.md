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

## September 14 replay

With the default mechanical rules, 09:30–16:00 ET window, one-point minimum
gap, and two NQ contracts:

- 24 confirmed signals;
- 5 accepted trades;
- -14.07 points / -$562.80 gross;
- 2 targets and 3 stops.

This is a baseline implementation, not a production recommendation. The
negative single-day result does not disprove the chart setup; it shows that
the chart's exact iFVG definition, trendline/liquidity filter, and execution
selection still need to be specified and tested over a larger sample.

## Run

```bash
DUKA_DIR=. python3 experiments/ifvg_reversion.py \
  --date 2026-09-14 \
  --entry-start 09:30 \
  --entry-end 16:00 \
  --target-r 1.5 \
  --max-stop-points 40 \
  --min-gap-points 1
```
