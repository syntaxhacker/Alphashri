# 52-Week High Calculation Fix

## The Issue Identified

User correctly pointed out that we need to calculate the 52-week high **from the entry point**, not including the current day's data.

## Before vs After

### BEFORE (Incorrect):
```python
# This includes the CURRENT day in the 52-week calculation
historical_df['52w_high'] = historical_df['high'].rolling(window=252, min_periods=100).max()
```

**Problem:**
```
Day 252:
  - Today's High: ₹1500
  - 52w_high calculated as: max(high[0:252])  <- Includes today!
  - If today is the highest, 52w_high = ₹1500 (today's high)
  - Current Price: ₹1495
  - Distance: (1500-1495)/1495 = 0.33% ← We enter!

But we're chasing a high that was SET TODAY!
```

### AFTER (Correct):
```python
# shift(1) moves the calculation to use ONLY previous days
historical_df['52w_high'] = historical_df['high'].rolling(window=252, min_periods=100).max().shift(1)
```

**Fixed:**
```
Day 252:
  - Today's High: ₹1500
  - 52w_high calculated as: max(high[0:251])  <- Yesterday and before only!
  - If yesterday's high was ₹1480, 52w_high = ₹1480
  - Current Price: ₹1495
  - Distance: (1480-1495)/1495 = -1.0% ← We DON'T enter (already above!)

We wait for a NEW 52-week high to form tomorrow, THEN chase it.
```

---

## Visual Explanation

```
WITHOUT shift(1) (WRONG):
═════════════════════════

Price
  │
1500     ●─────── ← Current day (included in 52w calculation!)
  │    ╱
1480   ●──────── ← 52w-high includes today, so target = today's high!
  │
  │
1450
  │
  └───────────────→ Time

Entry signal: "Within 3% of 52w-high" even though we just hit it today!


WITH shift(1) (CORRECT):
════════════════════════

Price
  │
1500     ●─────── ← Current day (NOT included)
  │    ╱
1480   ●──────── ← 52w-high from PREVIOUS days only
  │             │ ← Target: ₹1480 (yesterday's 52w high)
  │
1450
  │
  └───────────────→ Time

Entry signal: Only enter when approaching YESTERDAY'S 52w-high.
Today's breakout creates a NEW target for TOMORROW.
```

---

## Impact on Strategy

### Old Behavior:
- Enter when current price is within 3% of rolling 52-week high (includes today)
- Could enter AFTER the high was already broken today
- Target might already be achieved at entry (false signal)

### New Behavior:
- Enter when current price is within 3% of **previous day's** 52-week high
- Only enter when APPROACHING a known resistance level
- Target is the 52-week high from yesterday (static during the trade)
- Today's breakout = new high for tomorrow's chase

---

## Example Trade Walkthrough

### Scenario: Stock breaks out to new 52-week high

```
Day 1 (Monday):
  - 52w-high (from previous): ₹1450
  - Price opens at: ₹1445
  - Distance: 0.34% → ENTRY SIGNAL! ✅
  - Entry Price: ₹1445
  - Target: ₹1450 (Monday's 52w-high from Sunday)

Day 1 (Monday) Intraday:
  - Price runs up to: ₹1465
  - Target hit! Exit at ₹1465 → +1.38% profit 🎯

Day 2 (Tuesday):
  - New 52w-high (from Monday): ₹1465
  - Price opens at: ₹1460
  - Distance: 0.34% → ENTRY SIGNAL! ✅
  - Entry Price: ₹1460
  - Target: ₹1465 (Tuesday's 52w-high from Monday)
```

This creates a proper "chase" behavior where we:
1. Identify a resistance level (yesterday's 52w high)
2. Enter when approaching it
3. Exit when breaking through
4. Wait for new high to form
5. Repeat

---

## Code Changes Made

Both files updated:
1. `backtest_52week_high_chaser.py` (original)
2. `backtest_52week_high_chaser_enhanced.py` (enhanced)

Changed from:
```python
historical_df['52w_high'] = historical_df['high'].rolling(window=252, min_periods=100).max()
```

To:
```python
historical_df['52w_high'] = historical_df['high'].rolling(window=252, min_periods=100).max().shift(1)
```

The `.shift(1)` is the key fix - it ensures we only use historical data available BEFORE the current trading day.
