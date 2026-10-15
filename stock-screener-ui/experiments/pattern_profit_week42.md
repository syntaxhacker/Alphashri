# Week-42 pattern/strategy backtest (2026-10-05 → 2026-10-09)

Universe nifty500 (501); used 494, skipped 0, fetch-failed 7. Data through 2026-10-09…2026-10-09.
Protocol: signal on bar close → enter next bar open; SL = signal SL (1×ATR fallback); target = signal TP else 2×risk; exit target/SL/EOW; LONG only; ₹1,00,000/trade; costs via backtest/costs.py on every trade.

| strategy | trades | win% | gross | costs | NET | maxDD | PF | exp/trade |
|---|---|---|---|---|---|---|---|---|
| sr_breakout | 168 | 24.4 | -101541.15 | 13757.04 | -115298.19 | 135948.3 | 0.42 | -686.3 |
| orb_proxy | 102 | 19.6 | -46923.05 | 8351.44 | -55274.49 | 63362.95 | 0.32 | -541.91 |
| ema_cross | 27 | 11.1 | -19337.53 | 2216.01 | -21553.54 | 22193.48 | 0.18 | -798.28 |
| week52_chaser | 2 | 0.0 | -2225.0 | 163.96 | -2388.96 | 2388.96 | 0.0 | -1194.48 |
| week52_target | 10 | 10.0 | -17591.18 | 814.2 | -18405.38 | 19504.05 | 0.06 | -1840.54 |
| consolidation | 11 | 27.3 | -24666.16 | 897.65 | -25563.81 | 25594.83 | 0.07 | -2323.98 |
| adx_trend | 157 | 25.5 | -202334.49 | 12833.95 | -215168.44 | 252497.01 | 0.33 | -1370.5 |
| ema_stack | 16 | 31.2 | -9938.25 | 1311.85 | -11250.1 | 18629.19 | 0.66 | -703.13 |

TOTAL 493 trades, NET ₹-464902.91 (gross -424556.81, costs 40346.1), win 22.9% PF 0.35.

## Top-20 winners
| symbol | trades | net |
|---|---|---|
| KOTAKBANK | 7 | 9787.53 |
| PTCIL | 6 | 9368.07 |
| ANGELONE | 3 | 7382.85 |
| CUPID | 7 | 7020.71 |
| LICHSGFIN | 3 | 6580.84 |
| BBOX | 7 | 6048.52 |
| BSE | 2 | 4327.21 |
| NTPCGREEN | 2 | 3830.62 |
| PNB | 2 | 3579.39 |
| PWL | 3 | 3437.47 |
| TRENT | 3 | 3415.53 |
| ICICIGI | 3 | 2911.33 |
| RADICO | 1 | 2570.73 |
| CPPLUS | 2 | 2481.54 |
| ASTRAL | 1 | 2477.26 |
| ECLERX | 1 | 2429.62 |
| SUPREMEIND | 1 | 2307.38 |
| DEEPAKNTR | 3 | 2176.97 |
| STARHEALTH | 1 | 2145.06 |
| MRPL | 3 | 2116.3 |

## Top-20 losers
| symbol | trades | net |
|---|---|---|
| FINCABLES | 6 | -17231.58 |
| REDINGTON | 6 | -15931.48 |
| LGEINDIA | 8 | -15554.61 |
| ACE | 5 | -13710.15 |
| TEGA | 4 | -12893.11 |
| JYOTICNC | 4 | -12169.96 |
| CARBORUNIV | 4 | -11986.53 |
| TDPOWERSYS | 4 | -10941.25 |
| FIRSTCRY | 4 | -10873.18 |
| BHEL | 5 | -10603.14 |
| WHIRLPOOL | 4 | -10523.43 |
| LENSKART | 3 | -10096.58 |
| DIVISLAB | 6 | -10003.21 |
| MOTILALOFS | 3 | -9979.54 |
| KPIL | 4 | -9831.5 |
| LALPATHLAB | 3 | -9680.67 |
| HBLENGINE | 3 | -9635.19 |
| GRAPHITE | 6 | -9480.5 |
| ENGINERSIN | 3 | -9434.1 |
| MANKIND | 3 | -9225.56 |

## Market context
Week was broadly DOWN: 327/494 symbols (66%) fell Mon-open → Fri-close,
median -1.40%, mean -1.05%. All strategies here are LONG-only, so a
negative week for trend-following entries is the expected headwind —
read losses as week-conditional, not strategy verdicts.

## DEVIATIONS
- ORB is `orb_proxy`: prior-session high/low stands in for the intraday opening range (no intraday fetch; Upstox budget). Real ORB needs 5-min bars.
- SR breakout uses prior-session pivots + close-break confirmation (daily adaptation).
- week52_target TP=0 from generator → replaced with entry+2×risk per protocol.
- Same-day SL+TP ambiguity resolved SL-first (conservative).
- Consolidation + EMA-stack are custom proxies (no live generator exists).

## Spot-check (independent recompute from raw candles)
- sr_breakout ABB 2026-10-07@7122.5x14 → 2026-10-07@7015.66 SL: net -1577.68 recomputed -1577.68 match=True
- orb_proxy 360ONE 2026-10-07@1060.2x94 → 2026-10-07@1058.81 SL: net -212.95 recomputed -212.95 match=True
- ema_cross ADANIGREEN 2026-10-08@1342.7x74 → 2026-10-08@1327.99 SL: net -1170.45 recomputed -1170.45 match=True

## Skipped symbols (missing data)
0 skipped, 7 fetch-failed. Full lists in JSON.
