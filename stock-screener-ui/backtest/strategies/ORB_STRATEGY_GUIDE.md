# ORB Strategy - Complete Guide

## Table of Contents
1. [What is ORB?](#what-is-orb)
2. [Core Concepts](#core-concepts)
3. [Strategy Logic](#strategy-logic)
4. [Entry Rules](#entry-rules)
5. [Exit Rules](#exit-rules)
6. [Trend Filter](#trend-filter)
7. [Risk Management](#risk-management)
8. [Parameters Explained](#parameters-explained)
9. [Trading Examples](#trading-examples)
10. [Common Scenarios](#common-scenarios)
11. [Performance Tips](#performance-tips)
12. [FAQ](#faq)

---

## What is ORB?

**ORB (Opening Range Breakout)** is an intraday trading strategy that captures momentum moves when price breaks out of the initial trading range established at market open.

### The Philosophy

When markets open, there's often a period of price discovery where buyers and sellers establish their positions. The first 30-60 minutes typically see high volatility as:
- Overnight news is digested
- Pre-market orders are executed
- Institutional players establish positions

Once this "opening range" is established, a breakout from this range often signals the direction of the day's trend. The ORB strategy captures these directional moves.

---

## Core Concepts

### Opening Range (OR)

The Opening Range is defined by the **highest high** and **lowest low** during the first X minutes of trading.

```
Indian Market Hours: 9:15 AM - 3:30 PM IST

Example with 45-minute OR:
- Market Opens: 9:15 AM
- OR Period: 9:15 AM to 10:00 AM
- OR High: Highest price reached during 9:15-10:00
- OR Low: Lowest price reached during 9:15-10:00
```

### Visual Representation

```
Price
  │
  │    ┌────────────────────────────────────── OR High (Resistance)
  │    │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  │    │ ▓     OPENING RANGE (45 min)     ▓
  │    │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  │    └────────────────────────────────────── OR Low (Support)
  │
  └────────────────────────────────────────────────── Time
       9:15              10:00              10:05+
       │                  │                   │
       └── OR Building ───┘  └─ Breakout ────┘
```

---

## Strategy Logic

### Step-by-Step Process

```
┌─────────────────────────────────────────────────────────────┐
│                    MARKET OPENS (9:15 AM)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              PHASE 1: BUILD OPENING RANGE                    │
│                                                              │
│   • Track every 5-min candle from 9:15 to 10:00             │
│   • Update OR High = max(OR High, current high)             │
│   • Update OR Low = min(OR Low, current low)                │
│   • NO TRADING during this phase                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              PHASE 2: WAIT FOR BREAKOUT (10:00+)             │
│                                                              │
│   Calculate: OR_Range = OR_High - OR_Low                    │
│   Breakout_Threshold = OR_Range × 0.001 (0.1%)              │
│                                                              │
│   LONG Signal: Close > OR_High + Breakout_Threshold         │
│   SHORT Signal: Close < OR_Low - Breakout_Threshold         │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌─────────────┐      ┌─────────────┐
            │   BREAKOUT  │      │  BREAKDOWN  │
            │    ABOVE    │      │    BELOW    │
            │   OR HIGH   │      │   OR LOW    │
            └──────┬──────┘      └──────┬──────┘
                   │                    │
                   ▼                    ▼
            ┌─────────────┐      ┌─────────────┐
            │   GO LONG   │      │  GO SHORT   │
            │   (BUY)     │      │  (SELL)     │
            └──────┬──────┘      └──────┬──────┘
                   │                    │
                   └─────────┬──────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              PHASE 3: MANAGE POSITION                        │
│                                                              │
│   Stop Loss: Entry - 0.4%                                   │
│   Take Profit: Entry + 1.2%                                 │
│   Time Exit: Close all positions at 2:45 PM                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Entry Rules

### Long Entry (Buy)

A long position is taken when:

```
1. OR period is complete (after 10:00 AM for 45-min OR)
2. Price closes ABOVE OR High + (OR Range × 0.1%)
3. Trend filter conditions (if enabled):
   - Price > 20 EMA (bullish trend)
   - ADX > 25 (strong trend)
4. Within trading window: 10:00 AM to 12:00 PM
5. Cooldown period satisfied (3 bars since last exit)
```

**Example:**
```
Stock: RELIANCE
OR Period: 9:15 - 10:00 AM
OR High: ₹2,450
OR Low: ₹2,420
OR Range: ₹30

Breakout Threshold = ₹30 × 0.001 = ₹0.03
Entry Trigger = ₹2,450 + ₹0.03 = ₹2,450.03

At 10:15 AM, price closes at ₹2,452
→ ₹2,452 > ₹2,450.03 ✓
→ LONG ENTRY at ₹2,452
```

### Short Entry (Sell)

A short position is taken when:

```
1. OR period is complete
2. Price closes BELOW OR Low - (OR Range × 0.1%)
3. Trend filter conditions (if enabled):
   - Price < 20 EMA (bearish trend)
   - ADX > 25 (strong trend)
4. Within trading window: 10:00 AM to 12:00 PM
5. Cooldown period satisfied
```

**Example:**
```
Stock: HDFC
OR Period: 9:15 - 10:00 AM
OR High: ₹1,680
OR Low: ₹1,660
OR Range: ₹20

Breakdown Threshold = ₹20 × 0.001 = ₹0.02
Entry Trigger = ₹1,660 - ₹0.02 = ₹1,659.98

At 10:25 AM, price closes at ₹1,655
→ ₹1,655 < ₹1,659.98 ✓
→ SHORT ENTRY at ₹1,655
```

---

## Exit Rules

### Three Ways to Exit

```
┌─────────────────────────────────────────────────────────────┐
│                     EXIT CONDITIONS                          │
├──────────────────┬──────────────────────────────────────────┤
│  Take Profit     │  Price moves +1.2% from entry            │
│                  │  (Risk:Reward = 1:3)                      │
├──────────────────┼──────────────────────────────────────────┤
│  Stop Loss       │  Price moves -0.4% from entry            │
│                  │  (Maximum acceptable loss)               │
├──────────────────┼──────────────────────────────────────────┤
│  EOD Exit        │  Time reaches 2:45 PM IST                │
│                  │  (Close all positions before market end) │
└──────────────────┴──────────────────────────────────────────┘
```

### Why These Levels?

```
The 1:3 Risk-Reward Ratio:

Entry: ₹100
Stop Loss: ₹99.60 (0.4% loss = ₹0.40)
Take Profit: ₹101.20 (1.2% gain = ₹1.20)

Risk:Reward = 0.40:1.20 = 1:3

Win Rate Required to Break Even:
  With trading costs of ~0.15% per trade:
  If you win: +1.2% - 0.15% = +1.05% net
  If you lose: -0.4% - 0.15% = -0.55% net

  Break-even win rate = 0.55 / (1.05 + 0.55) = 34.4%

  So you need only 35%+ win rate to be profitable!
```

### EOD Exit Reason

We exit at 2:45 PM (45 minutes before market close) because:
1. **Avoid gap risk** - No overnight positions
2. **Reduced volatility** - Last 30 mins can be erratic
3. **Liquidity concerns** - Harder to exit at good prices near close
4. **Mental peace** - End the day flat, no overnight stress

---

## Trend Filter

### What is the Trend Filter?

The trend filter uses **EMA (Exponential Moving Average)** and **ADX (Average Directional Index)** to ensure we only trade in the direction of the prevailing trend.

```
┌─────────────────────────────────────────────────────────────┐
│                    TREND FILTER LOGIC                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  EMA (20-period):                                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Price > EMA = BULLISH bias                         │    │
│  │  Price < EMA = BEARISH bias                         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ADX (14-period):                                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ADX > 25 = STRONG trend (good for trading)        │    │
│  │  ADX < 25 = WEAK trend (avoid trading)              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Combined Rules:                                             │
│  • Allow LONG only if: Price > EMA AND ADX > 25            │
│  • Allow SHORT only if: Price < EMA AND ADX > 25           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why Use Trend Filter?

**Without Trend Filter:**
```
Day 1: OR High = 100, Breakout to 102 → Long at 102
       Price reverses, hits SL at 101.60 → LOSS

Day 2: OR High = 105, Breakout to 107 → Long at 107
       Price reverses, hits SL at 106.60 → LOSS

Day 3: OR High = 103, Breakout to 104 → Long at 104
       Price reverses, hits SL at 103.60 → LOSS

Problem: Trading in a choppy/range-bound market
```

**With Trend Filter:**
```
Day 1: Price < EMA, ADX = 18 → TREND FILTER BLOCKS TRADE
Day 2: Price < EMA, ADX = 20 → TREND FILTER BLOCKS TRADE
Day 3: Price < EMA, ADX = 22 → TREND FILTER BLOCKS TRADE

Result: Avoided 3 losing trades in choppy market!
```

### ADX Interpretation

```
ADX Value    │  Trend Strength
─────────────┼──────────────────
0-15         │  No trend / Very weak
15-25        │  Weak trend
25-50        │  Strong trend ← We trade here
50-75        │  Very strong trend
75-100       │  Extremely strong (rare)
```

---

## Risk Management

### Position Sizing

```python
# Example Calculation

Capital: ₹10,00,000
Risk per Trade: 1% = ₹10,000
Stop Loss: 0.4%

Entry Price: ₹500
Stop Loss Price: ₹498 (0.4% below entry)
Loss per Share: ₹2

Position Size = Risk Amount / Loss per Share
Position Size = ₹10,000 / ₹2 = 5,000 shares

Value per Trade = 5,000 × ₹500 = ₹2,50,000 (25% of capital)
```

### Maximum Daily Loss

```
Recommended: Stop trading after 3 consecutive losses

Day starts with ₹10,00,000

Trade 1: Loss -₹4,000 (0.4% of position)
Trade 2: Loss -₹4,000
Trade 3: Loss -₹4,000

Total Loss: -₹12,000 (1.2% of capital)
→ STOP TRADING for the day
```

### Cooldown Period

After exiting a trade, wait for 3 bars (15 minutes with 5-min timeframe) before entering again.

```
Why Cooldown?

10:00 - Enter Long at ₹100
10:15 - Hit Stop Loss at ₹99.60 (LOSS)

Without Cooldown:
10:20 - Re-enter at ₹100.50 (revenge trading)
10:30 - Hit Stop Loss again (LOSS)

With 3-bar Cooldown:
10:15 - Exit with loss
10:20 - COOLDOWN (no entry)
10:25 - COOLDOWN (no entry)
10:30 - COOLDOWN (no entry)
10:35 - Can trade again (with clearer mind)
```

---

## Parameters Explained

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `or_minutes` | 45 | 15-120 | Duration of opening range in minutes |
| `stop_loss_pct` | 0.4% | 0.1-2.0% | Maximum loss per trade |
| `take_profit_pct` | 1.2% | 0.2-3.0% | Target profit per trade |
| `trade_size` | 100 | 1-1000 | Number of shares per trade |
| `timeframe` | 5 min | 1/5/15 | Candle timeframe |
| `enable_shorts` | False | True/False | Allow short selling |
| `trend_filter` | False | True/False | Use EMA+ADX filter |
| `ema_period` | 20 | 5-50 | EMA lookback period |
| `adx_period` | 14 | 7-30 | ADX lookback period |
| `adx_threshold` | 25 | 15-40 | Minimum ADX for trend |
| `cooldown_bars` | 3 | 0-10 | Bars to wait after exit |

### Parameter Tuning Guide

**Conservative Setup (Lower risk, lower return):**
```
or_minutes: 60
stop_loss_pct: 0.3
take_profit_pct: 0.9
trend_filter: True
adx_threshold: 30
cooldown_bars: 5
```

**Aggressive Setup (Higher risk, higher return):**
```
or_minutes: 30
stop_loss_pct: 0.5
take_profit_pct: 1.5
trend_filter: False
cooldown_bars: 1
```

**Recommended (Balanced):**
```
or_minutes: 45
stop_loss_pct: 0.4
take_profit_pct: 1.2
trend_filter: True
adx_threshold: 25
cooldown_bars: 3
```

---

## Trading Examples

### Example 1: Successful Long Trade

```
Stock: TATASTEEL
Date: 2024-02-20

9:15 AM - Market Opens
   Opening Price: ₹145

9:15-10:00 AM - OR Building
   OR High formed at: ₹147.50
   OR Low formed at: ₹144.80
   OR Range: ₹2.70

10:00 AM - OR Complete
   Breakout threshold: ₹2.70 × 0.001 = ₹0.003
   Long trigger: ₹147.50 + ₹0.003 = ₹147.503

10:15 AM - Breakout!
   Candle close: ₹148.20
   ₹148.20 > ₹147.503 ✓
   Trend check: Price > EMA(₹146), ADX = 28 ✓

   ENTRY: LONG at ₹148.20

Position Management:
   Stop Loss: ₹148.20 × 0.996 = ₹147.61
   Take Profit: ₹148.20 × 1.012 = ₹149.98

10:45 AM - Price at ₹149.50
   Holding...

11:15 AM - Take Profit Hit!
   Price: ₹150.05
   ₹150.05 > ₹149.98 ✓

   EXIT: TP at ₹150.05

Result:
   Entry: ₹148.20
   Exit: ₹150.05
   Gross Profit: ₹1.85 (1.25%)
   Trading Costs: ₹0.22 (0.15%)
   Net Profit: ₹1.63 (1.10%)

   ✓ WINNER!
```

### Example 2: Failed Breakout (Stop Loss Hit)

```
Stock: SBIN
Date: 2024-02-21

9:15 AM - Market Opens
   Opening Price: ₹625

9:15-10:00 AM - OR Building
   OR High: ₹628.50
   OR Low: ₹622.00
   OR Range: ₹6.50

10:20 AM - Breakout!
   Candle close: ₹629.50
   Long trigger: ₹628.50 + ₹0.007 = ₹628.507
   ₹629.50 > ₹628.507 ✓

   ENTRY: LONG at ₹629.50

Position Management:
   Stop Loss: ₹629.50 × 0.996 = ₹626.98
   Take Profit: ₹629.50 × 1.012 = ₹637.05

10:35 AM - Price Reverses
   Candle close: ₹628.00

10:40 AM - Further Decline
   Candle close: ₹626.50
   ₹626.50 < ₹626.98 ✓

   EXIT: SL at ₹626.50

Result:
   Entry: ₹629.50
   Exit: ₹626.50
   Gross Loss: -₹3.00 (-0.48%)
   Trading Costs: ₹0.94 (0.15%)
   Net Loss: -₹3.94 (-0.63%)

   ✗ LOSER - But risk controlled!
```

### Example 3: Short Trade Success

```
Stock: MARUTI
Date: 2024-02-22

9:15 AM - Market Opens
   Opening Price: ₹10,500

9:15-10:00 AM - OR Building
   OR High: ₹10,550
   OR Low: ₹10,420
   OR Range: ₹130

10:05 AM - Trend Check
   Price: ₹10,425
   EMA: ₹10,480
   ADX: 32
   Price < EMA (Bearish) ✓
   ADX > 25 (Strong Trend) ✓

10:10 AM - Breakdown!
   Candle close: ₹10,410
   Short trigger: ₹10,420 - ₹0.13 = ₹10,419.87
   ₹10,410 < ₹10,419.87 ✓

   ENTRY: SHORT at ₹10,410

Position Management (for shorts):
   Stop Loss: ₹10,410 × 1.004 = ₹10,451.64
   Take Profit: ₹10,410 × 0.988 = ₹10,284.68

10:45 AM - Continued Decline
   Price: ₹10,350

11:30 AM - Take Profit Hit!
   Price: ₹10,280
   ₹10,280 < ₹10,284.68 ✓

   EXIT: TP at ₹10,280

Result:
   Entry: ₹10,410
   Exit: ₹10,280
   Gross Profit: ₹130 (1.25%)
   Trading Costs: ₹15.60 (0.15%)
   Net Profit: ₹114.40 (1.10%)

   ✓ WINNER on SHORT side!
```

---

## Common Scenarios

### Scenario 1: False Breakout

```
Problem: Price breaks OR High, triggers entry, then reverses

10:05 AM - Close at ₹151 (above OR High ₹150)
           ENTRY at ₹151

10:10 AM - Price drops to ₹149
10:15 AM - Price drops to ₹148
10:20 AM - Hits Stop Loss at ₹148.40

Solution: The 0.1% breakout threshold helps filter some false breakouts
          But not all can be avoided - this is why we have stop losses!
```

### Scenario 2: Gap Open

```
Problem: Stock opens with a large gap

Previous Close: ₹100
Today's Open: ₹105 (5% gap up)

9:15-10:00 AM - OR Building
   OR High: ₹106
   OR Low: ₹104.50

10:15 AM - Breakout at ₹106.50

Consideration:
   • Gap already represents 5% move
   • Further upside may be limited
   • Higher probability of reversal

Solution: Consider skipping stocks with >3% gap open
          (This can be added as an additional filter)
```

### Scenario 3: Low Volatility Day

```
Problem: OR Range is very small, leading to frequent triggers

OR High: ₹100.50
OR Low: ₹100.20
OR Range: ₹0.30 (0.3%)

Breakout threshold: ₹0.30 × 0.001 = ₹0.0003
Long trigger: ₹100.50 + ₹0.0003 = ₹100.5003

Any small move triggers a trade!

Solution: Add minimum OR Range filter
          Skip if OR Range < 1% of price
          OR Range % = (OR High - OR Low) / OR Low × 100
```

### Scenario 4: Strong Trend Day

```
Ideal Scenario: Everything aligns

Morning:
   Gap up 1% with strong global cues
   OR: ₹100 to ₹102 (2% range - good volatility)
   ADX: 35 (strong trend)
   Price > EMA (bullish)

10:05 AM - Breakout at ₹102.50
           ENTRY LONG

Rest of Day:
   Price continues higher
   11:30 AM - Hits TP at ₹103.73

Result: Clean +1.1% winner
```

---

## Performance Tips

### 1. Stock Selection

**Best Stocks for ORB:**
```
✓ High liquidity (volume > 1M shares/day)
✓ Moderate volatility (ATR > 1%)
✓ Not in ban period (F&O)
✓ No major announcements expected

✗ Avoid:
  - Penny stocks (manipulation risk)
  - Low volume stocks (slippage)
  - Stocks hitting circuit limits
```

### 2. Time of Day Matters

```
Best Entry Windows:
┌─────────────────────────────────────────────────────────────┐
│  10:00-10:30  │  ★★★★★  Best - Fresh breakouts              │
│  10:30-11:00  │  ★★★★☆  Good - Follow-through moves         │
│  11:00-11:30  │  ★★★☆☆  OK - Late morning moves            │
│  11:30-12:00  │  ★★☆☆☆  Avoid - Lunch doldrums             │
│  After 12:00  │  ★☆☆☆☆  Skip - Low probability             │
└─────────────────────────────────────────────────────────────┘
```

### 3. Market Context

```
Trade ORB when:
✓ Market is trending (Nifty above/below key averages)
✓ VIX is moderate (12-20)
✓ No major events scheduled (RBI, Fed, elections)

Avoid ORB when:
✗ Market is range-bound/ choppy
✗ VIX is very high (>25) - too volatile
✗ Major news events pending
```

### 4. Risk-Reward Optimization

```
For Indian Markets (with ~0.15% brokerage + taxes):

Conservative: 0.3% SL, 0.9% TP  (1:3 ratio)
Balanced:     0.4% SL, 1.2% TP  (1:3 ratio) ← Recommended
Aggressive:   0.5% SL, 1.5% TP  (1:3 ratio)

Never use 1:2 ratio (like 0.5% SL, 1.0% TP)
After costs, you'll need >45% win rate - very hard!
```

---

## FAQ

### Q1: Why 45 minutes for OR?

**A:** Based on backtesting and market structure:
- 15-30 mins: Too noisy, many false breakouts
- 45 mins: Sweet spot - enough data, not too late
- 60+ mins: Misses early moves, reduces trading opportunities

### Q2: Can I trade ORB on 1-minute timeframe?

**A:** Technically yes, but:
- More noise = more false breakouts
- Higher trading costs (more trades)
- Requires faster execution

5-minute is recommended for most traders.

### Q3: What if price breaks both OR High and OR Low same day?

**A:** This indicates high volatility and choppy market:
- First trade will likely hit SL
- Cooldown prevents immediate re-entry
- Often better to sit out such days

### Q4: Should I move stop loss to breakeven after some profit?

**A:** Generally NO for this strategy:
- Moving SL often results in early exits
- The 1:3 ratio depends on full TP being hit
- If you must, do it only after 0.8% profit

### Q5: How many stocks should I track simultaneously?

**A:** Depends on your capacity:
```
Beginner:     5-10 stocks
Intermediate: 10-20 stocks
Advanced:     20-50 stocks
```

Quality over quantity - better to track fewer stocks well.

### Q6: What about gap-up/gap-down opens?

**A:** Gaps >2% require special handling:
```
Gap > 3% UP:   Skip longs (overextended), look for shorts
Gap > 3% DOWN: Skip shorts (oversold), look for longs
Gap < 2%:      Normal ORB rules apply
```

### Q7: Can ORB be used for index trading (Nifty/BankNifty)?

**A:** Yes, ORB works well for indices:
- More liquid = tighter spreads
- Less manipulation
- But: Lower volatility per trade

Use slightly tighter SL (0.3%) for indices.

### Q8: How do trading costs affect profitability?

**A:** Indian equity intraday costs:
```
Brokerage:    0.03% (each side) = 0.06%
STT:          0.025% (sell side)
Exchange:     0.00325% (each side)
GST:          18% on brokerage
SEBI:         ₹10 per crore

Total: ~0.12-0.18% per round trip

This is why we use 1:3 ratio instead of 1:2!
```

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                    ORB QUICK REFERENCE                       │
├─────────────────────────────────────────────────────────────┤
│  ENTRY (LONG):                                               │
│    • Wait for OR to complete (45 mins)                      │
│    • Close > OR_High + (OR_Range × 0.1%)                    │
│    • Trend Filter ON: Price > EMA AND ADX > 25             │
│                                                              │
│  ENTRY (SHORT):                                              │
│    • Close < OR_Low - (OR_Range × 0.1%)                     │
│    • Trend Filter ON: Price < EMA AND ADX > 25             │
│                                                              │
│  EXIT:                                                       │
│    • Take Profit: +1.2%                                      │
│    • Stop Loss: -0.4%                                        │
│    • Time Exit: 2:45 PM IST                                  │
│                                                              │
│  RISK MANAGEMENT:                                            │
│    • Risk 1% per trade                                       │
│    • Max 3 trades per day                                    │
│    • 3-bar cooldown between trades                          │
│                                                              │
│  TIMING:                                                     │
│    • OR Period: 9:15 - 10:00 AM                             │
│    • Trading Window: 10:00 AM - 12:00 PM                    │
│    • Exit All: 2:45 PM                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-02 | Initial ORB implementation |
| 1.1 | 2024-02 | Added trend filter (EMA + ADX) |
| 1.2 | 2024-02 | Added short trading support |
| 1.3 | 2024-02 | Updated R:R to 1:3 (0.4% SL, 1.2% TP) |

---

*This document is for educational purposes. Past performance does not guarantee future results. Always backtest thoroughly before live trading.*
