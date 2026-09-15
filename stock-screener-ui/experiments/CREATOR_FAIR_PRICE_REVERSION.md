# Creator fair-price reversion variant

Updated: 2026-09-15

This is a separate implementation of the rules described in the supplied
creator transcript. The existing `timeless_reversion.py` production candidate
was not modified.

## Rules transcribed from the creator

- Reversion target is an explicit fair-price anchor.
- The fair price may be reset at news times such as 08:30, 09:45, or 10:00 ET.
- After a fair-price interaction, the creator may manually re-anchor to the
  regular 09:30 open.
- The setup uses BOS/structure reversion and both long and short trades.
- Default bracket is 25 points of risk and 1.5R, or 37.5 points.
- Asia, PM, and New York sessions can be enabled when there is sufficient
  volume.
- Session/volume selection and fair-price resets are discretionary in the
  transcript; they are therefore explicit configuration in the copy, not hidden
  assumptions.

## Implementation

`creator_fair_price_reversion.py` adds:

- symmetric long and short BOS entries;
- configurable overnight session windows;
- per-session fair-price anchors (Asia 18:00, PM 02:00, New York 09:30
  by default);
- explicit, non-lookahead `FairPriceEvent` anchors;
- creator-style 25-point / 1.5R defaults;
- an optional non-lookahead volume proxy: wait for the first activity window
  and require a configurable minimum raw-tick count;
- optional research filters, disabled by default.

Example command for the September 14 no-news New York profile:

```bash
DUKA_DIR=. python3 experiments/creator_fair_price_reversion.py \
  --date 2026-09-14 \
  --session new_york \
  --new-york-end 11:00 \
  --opening-range-max-points 175 \
  --max-signal-range-points 30
```

## Verification

The copied implementation matches the known September 14 creator sequence
under the comparable New York profile:

| Result | Creator transcript | Copied replay |
|---|---:|---:|
| Trades | 2 wins, 1 loss | 2 wins, 1 loss |
| R result | +2R | +2R |
| Point result | +50 points | +50 points |

At six MNQ contracts this is +$600 gross. The creator's stated $150-risk
account would show +$300 for the same +2R.

The literal all-session default is not a match: September 14 produced 22
trades and -175 points in this replay. That is not evidence the creator's
system loses; it identifies missing discretionary rules. The transcript says
to trade sessions only when volume is present, but it does not define a
mechanical volume threshold or exact session sub-windows. The implementation
now supports such a gate with `--min-session-ticks` and
`--activity-window-minutes`, but leaves it disabled until it is calibrated on
an independent sample.

The 08:30 news-anchor test also does not match every creator example. For
September 10 the copy produced -50 points and for September 11 it produced
0 points, while the creator describes different outcomes. The remaining gap
is the creator's manual fair-price re-anchoring, exact volume/session
selection, and any unrecorded execution discretion—not the 25-point/1.5R
bracket.

## Safety boundary

This copy is a research/backtest variant, not a production replacement. The
existing strategy remains the production candidate because its filters and
behavior are already tested across the larger March–September replay. Promote
the creator copy only after defining mechanical volume/session rules and
validating them on an independent period with costs and slippage.
