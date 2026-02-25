# S/R Breakout Strategy - Complete Guide

## Table of Contents
1. [What is S/R Breakout?](#what-is-sr-breakout)
2. [Core Concepts](#core-concepts)
3. [Pivot Points Explained](#pivot-points-explained)
4. [Strategy Logic](#strategy-logic)
5. [Entry Rules](#entry-rules)
6. [Exit Rules](#exit-rules)
7. [Pivot Types](#pivot-types)
8. [Risk Management](#risk-management)
9. [Parameters Explained](#parameters-explained)
10. [Trading Examples](#trading-examples)
11. [Common Scenarios](#common-scenarios)
12. [Performance Tips](#performance-tips)
13. [FAQ](#faq)

---

## What is S/R Breakout?

**Support & Resistance Breakout** is an intraday trading strategy that uses pivot points calculated from the previous day's price action to identify key levels for breakout trades.

### The Philosophy

Pivot points are one of the oldest and most reliable methods for identifying support and resistance levels. They work because:

- **Self-fulfilling prophecy**: Many traders and algorithms watch these levels
- **Institutional usage**: Large players use pivots for position management
- **Mathematical significance**: Derived from previous day's equilibrium

When price breaks above resistance (R1), it often continues higher as:
- Shorts cover their positions
- Breakout traders enter longs
- Momentum traders jump on board

Similarly, when price breaks below support (S1), it often continues lower.

---

## Core Concepts

### Pivot Points

Pivot points are calculated using the previous trading day's High, Low, and Close (HLC):

```
Indian Market Hours: 9:15 AM - 3:30 PM IST

Previous Day Data:
- Previous High: ₹1,250
- Previous Low: ₹1,220
- Previous Close: ₹1,240

Today's Pivot Points (Classic):
- PP = (1250 + 1220 + 1240) / 3 = ₹1,236.67
- R1 = (2 × 1236.67) - 1220 = ₹1,253.33
- S1 = (2 × 1236.67) - 1250 = ₹1,223.33
- R2 = 1236.67 + (1250 - 1220) = ₹1,266.67
- S2 = 1236.67 - (1250 - 1220) = ₹1,206.67
```

### Visual Representation

```
Price
  │
  │    ┌───────── R2 (Extended Target)
  │    │
  │    ├───────── R1 (Resistance - Short trigger for shorts)
  │    │
  │    ├───────── PP (Pivot Point - Intraday bias)
  │    │
  │    ├───────── S1 (Support - Long trigger for longs)
  │    │
  │    └───────── S2 (Extended Target)
  │
  └────────────────────────────────────────────────── Time
       9:15              10:00              15:15
       │                  │                   │
       └── Wait for ──────┘  └─ Trade ────────┘
           Breakout            Breakouts
```

### Level Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    PIVOT POINT LEVELS                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   R3 ─────────────────────────────────────────── (Extreme)  │
│   R2 ─────────────────────────────────────── (Target 2)     │
│   R1 ─────────────────────────────────── (Entry Zone)       │
│   PP ─────────────────────────────── (Bias Indicator)       │
│   S1 ─────────────────────────────────── (Entry Zone)       │
│   S2 ─────────────────────────────────────── (Target 2)     │
│   S3 ─────────────────────────────────────────── (Extreme)  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Pivot Points Explained

### Classic Pivot Points (Default)

The most widely used method, standard across all trading platforms:

```python
PP = (High + Low + Close) / 3
R1 = (2 × PP) - Low
R2 = PP + (High - Low)
R3 = High + 2 × (PP - Low)
S1 = (2 × PP) - High
S2 = PP - (High - Low)
S3 = Low - 2 × (High - PP)
```

### Fibonacci Pivot Points

Uses Fibonacci ratios to calculate levels, popular among technical traders:

```python
PP = (High + Low + Close) / 3
Range = High - Low

R1 = PP + (0.382 × Range)
R2 = PP + (0.618 × Range)
R3 = PP + (1.000 × Range)
S1 = PP - (0.382 × Range)
S2 = PP - (0.618 × Range)
S3 = PP - (1.000 × Range)
```

### Camarilla Pivot Points

Designed for intraday trading with tighter levels:

```python
PP = (High + Low + Close) / 3
Range = High - Low

R1 = Close + (Range × 1.1 / 12)
R2 = Close + (Range × 1.1 / 6)
R3 = Close + (Range × 1.1 / 4)
S1 = Close - (Range × 1.1 / 12)
S2 = Close - (Range × 1.1 / 6)
S3 = Close - (Range × 1.1 / 4)
```

### Comparison

| Type | Best For | Characteristics |
|------|----------|-----------------|
| Classic | Most stocks | Standard levels, widely watched |
| Fibonacci | Trending markets | Wider levels, good for momentum |
| Camarilla | High volatility | Tighter levels, more signals |

---

## Strategy Logic

### Step-by-Step Process

```
┌─────────────────────────────────────────────────────────────┐
│                 PREVIOUS DAY CLOSE (3:30 PM)                 │
│                                                              │
│   Calculate Pivot Points from HLC:                          │
│   • PP, R1, R2, R3, S1, S2, S3                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MARKET OPENS (9:15 AM)                    │
│                                                              │
│   • Wait for market to establish direction                  │
│   • Watch price action around pivot levels                  │
│   • NO TRADING during first few minutes                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              WAIT FOR BREAKOUT CONFIRMATION                  │
│                                                              │
│   Calculate Breakout Buffer:                                │
│   Buffer = Level × (Buffer_Pct / 100)                       │
│   Example: R1 = ₹100, Buffer 0.1% = ₹0.10                   │
│                                                              │
│   LONG Signal: Close > R1 + Buffer                          │
│   SHORT Signal: Close < S1 - Buffer                         │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌─────────────┐      ┌─────────────┐
            │   BREAKOUT  │      │  BREAKDOWN  │
            │    ABOVE    │      │    BELOW    │
            │     R1      │      │     S1      │
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
│              MANAGE POSITION                                 │
│                                                              │
│   Stop Loss: Entry - 0.5%                                   │
│   Take Profit: Entry + 1.5%                                 │
│   Time Exit: Close all positions at 3:15 PM                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Entry Rules

### Long Entry (Buy)

A long position is taken when:

```
1. Price closes ABOVE R1 + Buffer%
2. Buffer confirms breakout (avoids false breakouts)
3. Within trading window: 9:15 AM to 3:15 PM
4. Cooldown period satisfied (3 bars since last exit)
5. Shorts disabled OR not already in short position
```

**Example:**
```
Stock: RELIANCE
Previous Day:
  High: ₹2,450
  Low: ₹2,420
  Close: ₹2,435

Today's Pivot Points (Classic):
  PP = (2450 + 2420 + 2435) / 3 = ₹2,435
  R1 = (2 × 2435) - 2420 = ₹2,450
  S1 = (2 × 2435) - 2450 = ₹2,420

Buffer: 0.1%
Entry Trigger = ₹2,450 × 1.001 = ₹2,452.45

At 10:30 AM, price closes at ₹2,455
→ ₹2,455 > ₹2,452.45 ✓
→ LONG ENTRY at ₹2,455
```

### Short Entry (Sell)

A short position is taken when (if shorts enabled):

```
1. Price closes BELOW S1 - Buffer%
2. Buffer confirms breakdown
3. Within trading window
4. Cooldown period satisfied
5. Enable shorts parameter is TRUE
```

**Example:**
```
Stock: HDFC
Previous Day:
  High: ₹1,680
  Low: ₹1,660
  Close: ₹1,670

Today's Pivot Points (Classic):
  PP = ₹1,670
  S1 = (2 × 1670) - 1680 = ₹1,660

Buffer: 0.1%
Entry Trigger = ₹1,660 × 0.999 = ₹1,658.34

At 11:00 AM, price closes at ₹1,655
→ ₹1,655 < ₹1,658.34 ✓
→ SHORT ENTRY at ₹1,655
```

### The Buffer Concept

The breakout buffer prevents false breakouts by requiring price to move beyond the level by a small percentage:

```
Without Buffer:
  R1 = ₹100
  Price touches ₹100.01 → Signal triggered
  Result: Often false breakout, price reverses

With 0.1% Buffer:
  R1 = ₹100
  Entry Trigger = ₹100 × 1.001 = ₹100.10
  Price must close above ₹100.10 → Signal triggered
  Result: More reliable breakouts
```

---

## Exit Rules

### Three Ways to Exit

```
┌─────────────────────────────────────────────────────────────┐
│                     EXIT CONDITIONS                          │
├──────────────────┬──────────────────────────────────────────┤
│  Take Profit     │  Price moves +1.5% from entry            │
│                  │  (Risk:Reward = 1:3)                      │
├──────────────────┼──────────────────────────────────────────┤
│  Stop Loss       │  Price moves -0.5% from entry            │
│                  │  (Maximum acceptable loss)               │
├──────────────────┼──────────────────────────────────────────┤
│  EOD Exit        │  Time reaches 3:15 PM IST                │
│                  │  (Close all positions before market end) │
└──────────────────┴──────────────────────────────────────────┘
```

### Why These Levels?

```
The 1:3 Risk-Reward Ratio:

Entry: ₹100
Stop Loss: ₹99.50 (0.5% loss = ₹0.50)
Take Profit: ₹101.50 (1.5% gain = ₹1.50)

Risk:Reward = 0.50:1.50 = 1:3

Win Rate Required to Break Even:
  With trading costs of ~0.15% per trade:
  If you win: +1.5% - 0.15% = +1.35% net
  If you lose: -0.5% - 0.15% = -0.65% net

  Break-even win rate = 0.65 / (1.35 + 0.65) = 32.5%

  So you need only 33%+ win rate to be profitable!
```

### EOD Exit Reason

We exit at 3:15 PM (15 minutes before market close) because:
1. **Avoid gap risk** - No overnight positions
2. **Reduced slippage** - Better fills before close
3. **Mental peace** - End the day flat
4. **Square-off time** - Many brokers auto square-off at 3:15 PM

---

## Pivot Types

### When to Use Each Type

**Classic Pivots (Recommended for most traders):**
```
✓ Works on most stocks
✓ Most widely watched levels
✓ Good for liquid stocks
✓ Standard across platforms
```

**Fibonacci Pivots:**
```
✓ Best for trending markets
✓ Wider levels = fewer but better signals
✓ Good for momentum stocks
✓ Use when ATR is high
```

**Camarilla Pivots:**
```
✓ Best for high volatility days
✓ Tighter levels = more signals
✓ Good for intraday scalping
✓ Use when VIX is elevated
```

### Level Comparison Example

```
Stock: INFY
Previous Day: H=₹1,500, L=₹1,470, C=₹1,485

               Classic    Fibonacci    Camarilla
               ─────────  ──────────   ──────────
R1             ₹1,500     ₹1,496.46    ₹1,488.00
PP             ₹1,485     ₹1,485       ₹1,485
S1             ₹1,470     ₹1,473.54    ₹1,482.00

Observation:
- Camarilla has tightest range (₹6)
- Fibonacci has moderate range (₹22.92)
- Classic has widest range (₹30)
```

---

## Risk Management

### Position Sizing

```python
# Example Calculation

Capital: ₹10,00,000
Risk per Trade: 1% = ₹10,000
Stop Loss: 0.5%

Entry Price: ₹500
Stop Loss Price: ₹497.50 (0.5% below entry)
Loss per Share: ₹2.50

Position Size = Risk Amount / Loss per Share
Position Size = ₹10,000 / ₹2.50 = 4,000 shares

Value per Trade = 4,000 × ₹500 = ₹20,00,000 (200% of capital)
# Note: Intraday margin allows this, but be cautious!
```

### Maximum Daily Loss

```
Recommended: Stop trading after 3 consecutive losses

Day starts with ₹10,00,000

Trade 1: Loss -₹5,000 (0.5% of position)
Trade 2: Loss -₹5,000
Trade 3: Loss -₹5,000

Total Loss: -₹15,000 (1.5% of capital)
→ STOP TRADING for the day
```

### Cooldown Period

After exiting a trade, wait for 3 bars (15 minutes with 5-min timeframe) before entering again.

```
Why Cooldown?

10:30 - Enter Long at ₹100
10:45 - Hit Stop Loss at ₹99.50 (LOSS)

Without Cooldown:
10:50 - Re-enter at ₹100.25 (revenge trading)
11:00 - Hit Stop Loss again (LOSS)

With 3-bar Cooldown:
10:45 - Exit with loss
10:50 - COOLDOWN (no entry)
10:55 - COOLDOWN (no entry)
11:00 - COOLDOWN (no entry)
11:05 - Can trade again (with clearer mind)
```

---

## Parameters Explained

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `pivot_type` | classic | classic/fibonacci/camarilla | Pivot point calculation method |
| `breakout_buffer_pct` | 0.1% | 0.0-0.5% | Buffer above/below level to confirm breakout |
| `stop_loss_pct` | 0.5% | 0.1-2.0% | Maximum loss per trade |
| `take_profit_pct` | 1.5% | 0.2-4.0% | Target profit per trade |
| `trade_size` | 100 | 1-5000 | Number of shares per trade |
| `timeframe` | 5 min | 1/5/15 | Candle timeframe |
| `enable_shorts` | False | True/False | Allow short selling |
| `cooldown_bars` | 3 | 0-20 | Bars to wait after exit |

### Parameter Tuning Guide

**Conservative Setup (Lower risk, fewer trades):**
```
pivot_type: classic
breakout_buffer_pct: 0.2
stop_loss_pct: 0.4
take_profit_pct: 1.2
enable_shorts: False
cooldown_bars: 5
```

**Aggressive Setup (Higher risk, more trades):**
```
pivot_type: camarilla
breakout_buffer_pct: 0.05
stop_loss_pct: 0.6
take_profit_pct: 1.8
enable_shorts: True
cooldown_bars: 2
```

**Recommended (Balanced):**
```
pivot_type: classic
breakout_buffer_pct: 0.1
stop_loss_pct: 0.5
take_profit_pct: 1.5
enable_shorts: False
cooldown_bars: 3
```

---

## Trading Examples

### Example 1: Successful Long Trade

```
Stock: TATASTEEL
Date: 2024-02-20

Previous Day:
   High: ₹147.50
   Low: ₹144.80
   Close: ₹146.20

Today's Pivot Points (Classic):
   PP = (147.50 + 144.80 + 146.20) / 3 = ₹146.17
   R1 = (2 × 146.17) - 144.80 = ₹147.54
   S1 = (2 × 146.17) - 147.50 = ₹144.84

9:15 AM - Market Opens
   Opening Price: ₹146.50

9:15-10:00 AM - Price Action
   Price consolidating around PP
   Testing R1 from below

10:15 AM - Breakout!
   Buffer: 0.1% = ₹0.15
   Entry Trigger: ₹147.54 + ₹0.15 = ₹147.69
   Candle close: ₹148.20
   ₹148.20 > ₹147.69 ✓

   ENTRY: LONG at ₹148.20

Position Management:
   Stop Loss: ₹148.20 × 0.995 = ₹147.46
   Take Profit: ₹148.20 × 1.015 = ₹150.42

10:45 AM - Price at ₹149.50
   Holding...

11:30 AM - Take Profit Hit!
   Price: ₹150.50
   ₹150.50 > ₹150.42 ✓

   EXIT: TP at ₹150.50

Result:
   Entry: ₹148.20
   Exit: ₹150.50
   Gross Profit: ₹2.30 (1.55%)
   Trading Costs: ₹0.22 (0.15%)
   Net Profit: ₹2.08 (1.40%)

   ✓ WINNER!
```

### Example 2: Failed Breakout (Stop Loss Hit)

```
Stock: SBIN
Date: 2024-02-21

Previous Day:
   High: ₹628.50
   Low: ₹622.00
   Close: ₹625.50

Today's Pivot Points (Classic):
   PP = ₹625.33
   R1 = (2 × 625.33) - 622.00 = ₹628.66

10:05 AM - Breakout!
   Buffer: 0.1% = ₹0.63
   Entry Trigger: ₹628.66 + ₹0.63 = ₹629.29
   Candle close: ₹630.00
   ₹630.00 > ₹629.29 ✓

   ENTRY: LONG at ₹630.00

Position Management:
   Stop Loss: ₹630.00 × 0.995 = ₹626.85
   Take Profit: ₹630.00 × 1.015 = ₹639.45

10:20 AM - Price Reverses
   Candle close: ₹628.00

10:35 AM - Further Decline
   Candle close: ₹626.50
   ₹626.50 < ₹626.85 ✓

   EXIT: SL at ₹626.50

Result:
   Entry: ₹630.00
   Exit: ₹626.50
   Gross Loss: -₹3.50 (-0.56%)
   Trading Costs: ₹0.94 (0.15%)
   Net Loss: -₹4.44 (-0.71%)

   ✗ LOSER - But risk controlled!
```

### Example 3: Short Trade Success

```
Stock: MARUTI
Date: 2024-02-22
Enable Shorts: True

Previous Day:
   High: ₹10,550
   Low: ₹10,420
   Close: ₹10,480

Today's Pivot Points (Classic):
   PP = ₹10,483.33
   S1 = (2 × 10483.33) - 10550 = ₹10,416.66

10:30 AM - Breakdown!
   Buffer: 0.1% = ₹10.42
   Entry Trigger: ₹10,416.66 - ₹10.42 = ₹10,406.24
   Candle close: ₹10,400
   ₹10,400 < ₹10,406.24 ✓

   ENTRY: SHORT at ₹10,400

Position Management (for shorts):
   Stop Loss: ₹10,400 × 1.005 = ₹10,452
   Take Profit: ₹10,400 × 0.985 = ₹10,244

11:00 AM - Continued Decline
   Price: ₹10,350

11:45 AM - Take Profit Hit!
   Price: ₹10,240
   ₹10,240 < ₹10,244 ✓

   EXIT: TP at ₹10,240

Result:
   Entry: ₹10,400
   Exit: ₹10,240
   Gross Profit: ₹160 (1.54%)
   Trading Costs: ₹15.60 (0.15%)
   Net Profit: ₹144.40 (1.39%)

   ✓ WINNER on SHORT side!
```

---

## Common Scenarios

### Scenario 1: False Breakout

```
Problem: Price breaks R1, triggers entry, then reverses

10:05 AM - Close at ₹148 (above R1 ₹147.50 + buffer)
           ENTRY at ₹148

10:15 AM - Price drops to ₹147
10:25 AM - Price drops to ₹146
10:35 AM - Hits Stop Loss at ₹147.26

Solution: The 0.1% buffer helps filter some false breakouts
          But not all can be avoided - this is why we have stop losses!

          Consider increasing buffer to 0.15-0.2% in choppy markets
```

### Scenario 2: Gap Open Above R1

```
Problem: Stock opens with a large gap above R1

Previous Close: ₹100
Today's R1: ₹102
Today's Open: ₹104 (2% gap up, already above R1)

Consideration:
   • Gap already represents significant move
   • R1 was broken at open (no entry signal)
   • Look for price to pull back to R1 as support

Solution: Skip trades when gap > 1.5%
          OR wait for pullback to R1 for long entry
```

### Scenario 3: Ranging Day

```
Problem: Price oscillates between R1 and S1 all day

R1: ₹102
S1: ₹98
PP: ₹100

10:00 AM - Price at ₹102.20 (above R1) → LONG
10:30 AM - Price at ₹99.80 (hits SL) → LOSS

11:00 AM - Price at ₹97.80 (below S1) → SHORT
11:30 AM - Price at ₹100.20 (hits SL) → LOSS

Result: Whipsawed both ways!

Solution: Add range filter
          Skip trading if (R1 - S1) / PP < 2%
          OR wait for clear directional move
```

### Scenario 4: Strong Trend Day

```
Ideal Scenario: Everything aligns

Morning:
   Gap up 0.5%
   Previous day was bullish
   R1: ₹102, PP: ₹100, S1: ₹98

10:15 AM - Price breaks R1 at ₹102.15
           ENTRY LONG

Rest of Day:
   Price continues higher
   11:00 AM - Reaches R2 at ₹104
   12:30 PM - Hits TP at ₹103.68

Result: Clean +1.4% winner
```

---

## Performance Tips

### 1. Stock Selection

**Best Stocks for S/R Breakout:**
```
✓ High liquidity (volume > 500K shares/day)
✓ Moderate volatility (ATR 1-3%)
✓ Follows technical levels well
✓ Not in ban period (F&O)

✗ Avoid:
  - Penny stocks (manipulation risk)
  - Low volume stocks (slippage)
  - Stocks with upcoming results/events
```

### 2. Time of Day Matters

```
Best Entry Windows:
┌─────────────────────────────────────────────────────────────┐
│  9:30-10:30   │  ★★★★★  Best - First breakouts of day       │
│  10:30-11:30  │  ★★★★☆  Good - Follow-through moves         │
│  11:30-13:00  │  ★★★☆☆  OK - Midday moves                   │
│  13:00-14:30  │  ★★☆☆☆  Avoid - Low momentum                │
│  14:30-15:15  │  ★☆☆☆☆  Skip - Exit window only             │
└─────────────────────────────────────────────────────────────┘
```

### 3. Market Context

```
Trade S/R Breakout when:
✓ Market is trending (Nifty directional)
✓ VIX is moderate (12-20)
✓ No major events scheduled

Avoid when:
✗ Market is range-bound/choppy
✗ VIX is very high (>25) - too volatile
✗ Major news events (RBI, Fed, elections)
```

### 4. Pivot Type Selection

```
Market Condition       → Pivot Type
─────────────────────────────────────
Normal/Unknown         → Classic
Strong Trend           → Fibonacci
High Volatility        → Camarilla
Low Volatility         → Classic (wider buffer)
```

---

## FAQ

### Q1: Why use previous day's data instead of weekly/monthly?

**A:** Daily pivots are most relevant for intraday trading:
- Fresh levels each day reflect current market sentiment
- Weekly/monthly pivots are too wide for intraday targets
- Most intraday traders watch daily pivots

### Q2: Should I trade both longs and shorts?

**A:** For beginners, start with longs only:
- Shorting requires margin and carries gap risk
- Markets naturally drift upward
- Add shorts only after mastering longs

### Q3: What if R1 and S1 are very close together?

**A:** This indicates low volatility:
```
R1 - S1 < 2% of PP = Low volatility day

Options:
1. Skip trading (recommended)
2. Increase buffer to 0.15-0.2%
3. Use Camarilla pivots for wider range
```

### Q4: Can I use this with other indicators?

**A:** Yes, pivot points work well with:
- Volume (confirm breakouts with high volume)
- Moving averages (trend direction)
- RSI (avoid overbought/oversold entries)

### Q5: How many pivot levels should I watch?

**A:** Focus on R1, PP, and S1:
- These are most significant
- R2/S2 are targets, not entry levels
- R3/S3 are extreme levels

### Q6: What's the ideal buffer percentage?

**A:** Depends on volatility:
```
Low Volatility (ATR < 1.5%):  0.05-0.1% buffer
Normal Volatility (ATR 1.5-3%): 0.1-0.15% buffer
High Volatility (ATR > 3%):    0.15-0.2% buffer
```

### Q7: Why 3:15 PM exit instead of 3:30 PM?

**A:** Several reasons:
- Many brokers auto square-off at 3:15 PM
- Avoid last-minute volatility
- Better liquidity for exits
- Prevents accidental overnight positions

### Q8: How do trading costs affect profitability?

**A:** Indian equity intraday costs:
```
Brokerage:    0.03% (each side) = 0.06%
STT:          0.025% (sell side)
Exchange:     0.00325% (each side)
GST:          18% on brokerage
SEBI:         ₹10 per crore

Total: ~0.12-0.18% per round trip

This is why we use 1:3 ratio (0.5% SL, 1.5% TP)!
```

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                S/R BREAKOUT QUICK REFERENCE                  │
├─────────────────────────────────────────────────────────────┤
│  ENTRY (LONG):                                               │
│    • Wait for: Close > R1 + Buffer%                         │
│    • Buffer: 0.1% (adjust for volatility)                   │
│    • Time: Any time before 3:15 PM                          │
│                                                              │
│  ENTRY (SHORT):                                              │
│    • Wait for: Close < S1 - Buffer%                         │
│    • Requires: enable_shorts = True                         │
│                                                              │
│  EXIT:                                                       │
│    • Take Profit: +1.5%                                      │
│    • Stop Loss: -0.5%                                        │
│    • Time Exit: 3:15 PM IST                                  │
│                                                              │
│  RISK MANAGEMENT:                                            │
│    • Risk 1% per trade                                       │
│    • Max 3 consecutive losses per day                       │
│    • 3-bar cooldown between trades                          │
│                                                              │
│  PIVOT TYPES:                                                │
│    • Classic: Most stocks, standard levels                  │
│    • Fibonacci: Trending markets, wider levels              │
│    • Camarilla: High volatility, tighter levels             │
│                                                              │
│  KEY LEVELS:                                                 │
│    • R1: Resistance (long entry trigger)                    │
│    • PP: Pivot Point (intraday bias)                        │
│    • S1: Support (short entry trigger)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-02 | Initial S/R Breakout implementation |
| 1.1 | 2024-02 | Added Fibonacci and Camarilla pivot types |
| 1.2 | 2024-02 | Added breakout buffer for false breakout prevention |
| 1.3 | 2024-02 | Added short trading support |

---

*This document is for educational purposes. Past performance does not guarantee future results. Always backtest thoroughly before live trading.*
