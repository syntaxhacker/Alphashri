# Low-resistance liquidity + iFVG

This is the strategy represented by the annotated chart. It is separate from
the existing fair-price and five-minute iFVG implementations.

## Mechanical interpretation

1. Build completed one-minute bars from bid ticks.
2. Confirm three- or four-touch swing lines using only pivots with both right
   confirmation bars complete.
3. Treat the nearest clean line as the low-resistance liquidity target:
   - line below price → short toward sell-side liquidity;
   - line above price → long toward buy-side liquidity.
4. Require a same-direction iFVG inversion on the highest available
   30-second, 1-minute, 2-minute, or 3-minute timeframe.
5. Wait for the iFVG zone retest shown by the cyan box, then enter on the next
   tick after the one-minute confirmation bar.
6. Stop beyond the recent swing plus six points; target 1R by default.

Each iFVG inversion can generate only one entry. This prevents the same zone
from being traded repeatedly while it remains inside the inversion-age window.
The default session is Asia, 18:00–02:00 ET.

## September 14 check

The literal chart profile produced 10 trades during the available Asia
windows: 7 targets, 2 stops, and 1 time exit, for **+4.83R / +76.58 points**.
The 18:00–00:00 ET portion contained the important directional move: price
fell from approximately 29,182.66 to 29,120.21. The strategy correctly
produced short entries at 18:55 and 19:05 toward the lower LRL.

The stricter measured profile produced only two trades on the same date: one
target and one stop (**0.00R**, -12.84 points after bid/ask effects). It is
more robust across the full sample but can miss profitable lower-timeframe
setups.

This is different from the creator fair-price replay, which entered four long
trades in that same Asia portion and lost 4R. The missing rule was the LRL
direction gate.

## Full fixed-parameter check

Using the profiles unchanged on 155 cached March–September sessions:

| Variant | Trades | Result |
|---|---:|---:|
| Literal LRL + all-timeframe iFVG retest | 1,310 | -21.43R |
| Four-touch LRL + 3-minute iFVG retest | 329 | **+9.58R** |

The measured profile had 146 target wins, 140 stop losses, and 43 time/EOD
exits across 123 active sessions. The literal version is overactive; it is
kept for comparison but is not the recommended configuration.

The recent 21-session slice was also checked: all-timeframe retest was +4.91R
and 3-minute retest was +3.55R. That slice alone was not used to promote the
profile; the full chronological replay is the promotion check.

The retest is therefore part of the actual setup, not an optional cosmetic
filter. These are preliminary results from one cached window, not a production
claim. Run the broader benchmark before changing the default again.

## Commands

```bash
.venv/bin/python experiments/lrl_liquidity_reversion.py \
  --date 2026-09-14 --entry-start 18:00 --entry-end 02:00

.venv/bin/python experiments/lrl_liquidity_reversion.py \
  --date 2026-09-14 --profile measured

.venv/bin/python experiments/research/nq_lrl_liquidity/benchmark_lrl.py \
  --start 2026-03-02 --end 2026-09-14
```
