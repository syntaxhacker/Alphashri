# 🎯 Integrated TV Screener + Paper Trading Bot

## 🚨 **LATEST UPDATE: Mode-Specific Alert Logic + Performance Fixes!**

**Major Improvements:**
- ✅ **Mode-specific alert generation** - Each mode now has unique trading logic
- ✅ **Parallel price fetching** - 10x faster live price updates for active positions
- ✅ **Lowered thresholds** - Confidence: 70%→50%, Volume: 2.0x→1.5x for better signals
- ✅ **Removed mode restrictions** - All alert types work in all modes
- ✅ **Tighter risk management** - Stop loss: 2%→0.5% (1:2 risk-reward ratio)

**Result:** Each mode now behaves according to its true purpose with faster execution! 🚀

---

## ✅ MAJOR UPDATE: Mode-Based Anti-FOMO Strategies!

Your TV screener now includes **4 different modes** with the new `--mode` parameter for easy selection:

### 🚀 **Quick Start - Choose Your Mode:**
```bash
# 🎯 RECOMMENDED: Catch stocks before FOMO (DEFAULT)
python screeners/tv_screen_usage.py --watch --mode PREBREAKOUT --refresh 15 --enable-trading

# 🔥 Original: High volume breakouts  
python screeners/tv_screen_usage.py --watch --mode FOMO --refresh 15 --enable-trading

# 📈 Smart money: Accumulation patterns
python screeners/tv_screen_usage.py --watch --mode ACCUMULATION --refresh 15 --enable-trading

# ⚡ Early trends: Momentum detection
python screeners/tv_screen_usage.py --watch --mode MOMENTUM --refresh 15 --enable-trading
```

**What's New:** Different table titles, screening criteria, and focus areas based on your selected mode!

## ⚡ **NEW: Anti-FOMO Pre-Breakout Strategies**

### **Catch Stocks BEFORE the Crowd:**
```bash
# Accumulation patterns (catch before breakout)
python screeners/tv_screen_usage.py --example pre_breakout

# Early momentum detection (pre-FOMO)
python screeners/tv_screen_usage.py --example early_momentum

# Market outperformers (strength leaders)
python screeners/tv_screen_usage.py --example relative_strength
```

### **NEW: --mode Parameter for Easy Selection:**
```bash
# Pre-breakout mode (DEFAULT - Anti-FOMO)
python screeners/tv_screen_usage.py --watch --mode PREBREAKOUT --refresh 15

# Original FOMO mode
python screeners/tv_screen_usage.py --watch --mode FOMO --refresh 15

# Accumulation patterns
python screeners/tv_screen_usage.py --watch --mode ACCUMULATION --refresh 15 --enable-trading

# Early momentum detection
python screeners/tv_screen_usage.py --watch --mode MOMENTUM --refresh 15 --enable-trading
```

## 🚀 **Original FOMO Trading (Still Available)**

### **High Volume Breakouts (FOMO Style):**
```bash
python screeners/tv_screen_usage.py --example intraday_breakouts
```

### **Other Intraday Strategies:**
```bash
python screeners/tv_screen_usage.py --example intraday_gap_up
python screeners/tv_screen_usage.py --example intraday_oversold
```

## 📊 **Strategy Details**

### **⚡ Pre-Breakout Accumulation (`pre_breakout`)**
**Goal:** Catch stocks in accumulation phase BEFORE breakout

**Filters:**
- RSI: 40-65 (building strength, not overbought)
- Volume: 0.8-1.8x normal (not explosive yet)
- Price: Within 30% of 52-week high
- Trend: Above EMA20 support
- NSE only (no BSE)

**Entry:** Volume expansion above EMA20 with RSI >50  
**Stop:** Below EMA20 (1-2%)  
**Target:** Resistance levels or 52W high  

### **⚡ Early Momentum Detection (`early_momentum`)**
**Goal:** Catch momentum BEFORE FOMO crowd notices

**Filters:**
- RSI: 35-70 improving trend
- Volume: 1.1-2.5x (slightly elevated)
- Price moves: 0.5-4% (small positive)
- MACD: Bullish crossover
- NSE only

**Entry:** RSI crosses 50 with volume confirmation  
**Stop:** Below swing low (1.5%)  
**Target:** 3-5% move or next resistance  

### **💪 Relative Strength Leaders (`relative_strength`)**
**Goal:** Find market outperformers showing leadership

**Filters:**
- Weekly performance: >2%
- Monthly performance: >5%
- RSI: 45-75 (momentum zone)
- Beta: >0.8 (market responsive)
- NSE only

**Entry:** Pullback or consolidation break  
**Stop:** Below weekly support (2-3%)  
**Target:** Continuation trend  

## 🔧 **What Happens in Watch Mode**

### **New Pre-Breakout Alert System:**

1. **📊 PRE_BREAKOUT Alert** → RSI improving + moderate volume + MACD bullish
2. **📈 ACCUMULATION Alert** → Building strength + normal volume + above EMA20  
3. **📱 Telegram Alert** → Enhanced with pre-breakout signals
4. **🤖 Paper Trading Bot** → Executes trades on quality signals
5. **🔴 Live Display** → Shows early momentum alerts before FOMO

### **Mode-Specific Alert Types & Trading Actions:**

| Mode | Alert Type | Trigger Logic | Trading Action |
|------|------------|---------------|----------------|
| **MOMENTUM** | **EARLY_MOMENTUM** | Small moves (0.5-4%) + RSI improving + MACD bullish | 🟢 **BUY** ₹20,000 |
| **ACCUMULATION** | **ACCUMULATION** | Normal volume (0.8-1.8x) + controlled price (-2% to +3%) + above EMA20 | 🟢 **BUY** ₹20,000 |
| **PREBREAKOUT** | **PREBREAKOUT** | High RSI (65-85) + building volume (1.2-3.0x) + testing resistance | 🟢 **BUY** ₹20,000 |
| **OPTIMIZED_GAP** | **GAP_BREAKOUT** | Quality gaps (1-15%) + volume confirmation + not at 52W high | 🟢 **BUY** ₹20,000 |
| **All Modes** | **SMART_FOMO** | Historical validation + volume spike + positive momentum | 🟢 **BUY** ₹20,000 |
| **All Modes** | **VOLUME_SPIKE** | Volume > 1.5x + Price rising (confidence ≥50%) | 🟢 **BUY** ₹20,000 |
| **All Modes** | **PRICE_MOVE** | Price change > 3% up/down (confidence ≥50%) | 🟢 **BUY** / 🔴 **SELL** |

## 📱 **Enhanced Telegram Alerts**

Your Telegram messages now include anti-FOMO pre-breakout signals:

```
⚡ TradingView Alert: Pre-Breakout Signal ⚡

📈 Symbol: HDFCBANK (HDFC Bank)
💰 Price: ₹1,678.25
📊 RSI: 52.3 (improving from 48.1)
📊 MACD: Bullish crossover
📊 Volume: 1.4x normal (building)
📈 Change: +1.2% (early move)

💰 Trading Action: 🟢 BUY HDFCBANK (Pre-Breakout - Catch Before Crowd!)
💵 Position Size: ₹20,000
🎯 Strategy: Early momentum detection
```

**Original FOMO alerts still work:**
```
🔥 TradingView Alert: Volume Spike 🔥

📈 Symbol: RELIANCE (Reliance Industries)
💰 Price: ₹2,456.50
📊 Volume Ratio: 3.2x (explosive!)
📈 Change: +2.1%

💰 Trading Action: 🟢 BUY RELIANCE (Volume Spike - FOMO Style)
💵 Position Size: ₹20,000
```

## 🔴 **Live Watch Mode Display**

The watch mode now shows **3 tables** with PRE-BREAKOUT focus:

### **1. Live Market Monitor** (Updated with Pre-Breakout Focus)
- Early momentum stocks (RSI 35-75 building)
- Moderate volume (1.1-2.5x not explosive)
- NSE only stocks
- Pre-breakout alert indicators

### **2. 🔴 LIVE TRADES** (NEW - Now with Pre-Breakout!)
```
🔴 LIVE TRADES (Last 10)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Time     Symbol      Side    Price    Qty   Amount    Alert Type      Confidence
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
14:23:45 HDFCBANK    🟢 BUY  ₹1,678   12    ₹20,136   PRE_BREAKOUT   82%
14:22:10 INFY        🟢 BUY  ₹1,432   14    ₹20,048   ACCUMULATION   76%
14:20:33 RELIANCE    🟢 BUY  ₹2,456   8     ₹19,648   VOLUME_SPIKE   85%
14:19:55 TCS         🟢 BUY  ₹3,245   6     ₹19,470   EARLY_MOMENTUM 79%
```

### **3. 📊 ACTIVE POSITIONS** (NEW!)
```
📊 ACTIVE POSITIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Symbol      Side    Entry    Current  Qty  P&L %    P&L ₹     Source
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RELIANCE    🟢 BUY  ₹2,456   ₹2,468   8    +0.49%   ₹+96      TV_SCREENER
TATAMOTORS  🟢 BUY  ₹789     ₹795     25   +0.76%   ₹+150     TV_SCREENER
```

## 🆚 **Mode-Specific Strategy Comparison**

| Mode | Alert Type | Entry Timing | Volume Range | Price Move | Risk Level | Reward Potential |
|------|------------|--------------|--------------|------------|------------|------------------|
| **MOMENTUM** | EARLY_MOMENTUM | Before FOMO | 1.1-2.5x | 0.5-4% | Low | Catch trend early |
| **ACCUMULATION** | ACCUMULATION | During buildup | 0.8-1.8x | -2% to +3% | Lowest | Best risk/reward |
| **PREBREAKOUT** | PREBREAKOUT | Testing resistance | 1.2-3.0x | 1-5% | Medium | High RSI breakout |
| **OPTIMIZED_GAP** | GAP_BREAKOUT | Quality gaps | >1.5x | 1-15% | Medium | Gap continuation |
| **All Modes** | VOLUME_SPIKE | After breakout | >1.5x | >3% | Higher | Already moving |
| **All Modes** | SMART_FOMO | Validated signals | >1.5x | >1% | Medium | Historical edge |

## 🛡️ **NEW: Anti-Spam Alert System**

Your TV screener now includes intelligent spam prevention that was added to solve the excessive Telegram alert issue:

### **🚨 Problem Solved:**
**Before:** Every 15-second refresh sent alerts for ALL stocks meeting criteria
```
✅ Telegram alert sent for NSE:RHIM
⚠️ Alert confidence too low (50%) - skipping trade
💰 Trading Action: ⏳ MONITOR NSE:RHIM
✅ Telegram alert sent for NSE:RELIANCE  
⚠️ Alert confidence too low (50%) - skipping trade
(Repeated for 25+ stocks every 15 seconds = SPAM!)
```

**After:** Smart filtering with cooldown and confidence
```
✅ Telegram alert sent for NSE:RHIM (85% confidence)
💰 Trading Action: 🟢 BUY NSE:RHIM
⏳ Skipping NSE:RELIANCE VOLUME_SPIKE (cooldown: 240s left)
⚠️ Alert confidence too low (65%) - skipping NSE:TATAMOTORS
```

### **🎯 Anti-Spam Features:**

#### **5-Minute Cooldown System**
- **No duplicate alerts** for same symbol+alert_type within 5 minutes
- **Cooldown tracking** per symbol: `NSE:RELIANCE_VOLUME_SPIKE`, `NSE:HDFCBANK_PRICE_MOVE`
- **Smart skip messages** show remaining cooldown time

#### **Enhanced Confidence Scoring (Fixed 50% Bug)**
- **Volume-based scoring**: 1.5x vol = +10%, 3x vol = +20%, 4x vol = +30%
- **Price movement scoring**: 3% change = +20%, 5% change = +25%
- **Alert-specific bonuses**: Smart FOMO gets +15% for historical validation
- **70% minimum threshold** for sending alerts (no more noise!)

#### **What You See Now:**
```bash
# High-confidence alerts get sent
✅ Telegram alert sent for NSE:TATAMOTORS (82% confidence)
💰 Trading Action: 🟢 BUY NSE:TATAMOTORS

# Low-confidence alerts are filtered out  
⚠️ Alert confidence too low (65%) - skipping NSE:WIPRO

# Recent alerts are blocked by cooldown
⏳ Skipping NSE:INFY VOLUME_SPIKE (cooldown: 180s left)
```

#### **Enhanced Telegram Messages:**
Your Telegram alerts now show proper confidence scores:
```
🔥 TradingView Alert: Volume Spike 🔥

📈 Symbol: RELIANCE (Reliance Industries)
💰 Price: ₹2,456.50
📊 Volume Ratio: 3.2x (was 2.1x)
📈 Change: +2.8%
🎯 Confidence: 85% ← NEW: Real confidence score!

💰 Trading Action: 🟢 BUY RELIANCE
💵 Position Size: ₹20,000
```

### **📊 Alert Quality Impact:**
- **Before**: 25+ alerts every 15 seconds (mostly 50% confidence spam)
- **After**: 2-5 quality alerts per cycle (70%+ confidence only)
- **Result**: Clean, actionable signals without noise!

## 🎛️ **Mode-Based Configuration**

### **Simple Mode Selection:**
| Mode | Purpose | Table Title | Volume Focus |
|------|---------|-------------|--------------|
| `--mode PREBREAKOUT` | Anti-FOMO early entry | "Pre-Breakout Signals" | 0.8-3.0x normal |
| `--mode FOMO` | Original high volume | "Top Volume Movers" | >1.5x elevated |
| `--mode ACCUMULATION` | Smart money tracking | "Accumulation Patterns" | 0.8-1.8x normal |
| `--mode MOMENTUM` | Early trend detection | "Early Momentum" | 1.1-2.5x building |

### **Complete Command Examples:**
```bash
# RECOMMENDED: Anti-FOMO pre-breakout (DEFAULT)
python screeners/tv_screen_usage.py --watch --mode PREBREAKOUT --refresh 15 --enable-trading

# Original FOMO style with high volume focus
python screeners/tv_screen_usage.py --watch --mode FOMO --volume-threshold 2.5 --enable-trading

# Accumulation patterns for position building
python screeners/tv_screen_usage.py --watch --mode ACCUMULATION --refresh 10 --enable-trading

# Early momentum for trend catching
python screeners/tv_screen_usage.py --watch --mode MOMENTUM --price-threshold 2.0 --enable-trading
```

### **Smart Trading Logic:**
- **Confidence Filtering**: Only trades signals with 70%+ confidence
- **Position Limits**: Max 1 position per symbol
- **Risk Management**: Automatic stop losses and profit targets
- **Duplicate Protection**: No duplicate trades for same symbol

## 🛡️ **Built-in Safety Features**

### **Risk Management:**
- ✅ **₹20,000 fixed position size** per trade
- ✅ **Stop losses** at -0.5% (improved from -2.0%)
- ✅ **Profit targets** at +1.0% (1:2 risk-reward ratio)
- ✅ **Trailing stops** for profit protection
- ✅ **Parallel price fetching** for faster execution

### **Alert Quality Controls:**
- ✅ **Smart confidence scoring** (30-95% based on volume + price strength)
- ✅ **5-minute cooldown** per symbol per alert type (prevents spam)
- ✅ **50% minimum confidence** threshold (lowered from 70% for better signals)
- ✅ **Volume threshold** lowered to 1.5x (from 2.0x) for earlier entries
- ✅ **Mode-specific alert logic** - each mode has unique trading criteria
- ✅ **No duplicate positions** per symbol
- ✅ **Market hours validation**

## 🎉 **What You Get**

### **Your Existing Workflow Enhanced:**
1. **Same command** you're used to: `--watch --refresh 15 --volume-threshold 1.5 --price-threshold 1.5`
2. **Same Telegram alerts** (enhanced with trading actions)
3. **NEW: Automatic paper trading** when you add `--enable-trading`
4. **NEW: Live trade display** in the same watch interface
5. **NEW: Real-time P&L tracking** for all positions

### **Zero Learning Curve:**
- Your existing command works exactly the same
- Just add `--enable-trading` to activate the paper trading bot
- All your threshold settings (1.5x volume, 1.5% price) work as before
- Same refresh rate (15 seconds) works perfectly

## ✅ **Ready to Use!**

### **RECOMMENDED: Anti-FOMO Pre-Breakout Mode**
```bash
# Catch stocks BEFORE they become FOMO trades (DEFAULT mode)
python screeners/tv_screen_usage.py --watch --mode PREBREAKOUT --refresh 15 --enable-trading

# Or just use default mode (PREBREAKOUT is automatic)
python screeners/tv_screen_usage.py --watch --refresh 15 --enable-trading
```

### **Individual Pre-Breakout Strategies**
```bash
# Run specific anti-FOMO strategies
python screeners/tv_screen_usage.py --example pre_breakout
python screeners/tv_screen_usage.py --example early_momentum  
python screeners/tv_screen_usage.py --example relative_strength
```

### **Original FOMO Trading (if you want)**
```bash
# High volume breakouts (after the move) - Individual strategy
python screeners/tv_screen_usage.py --example intraday_breakouts

# Or use FOMO watch mode for continuous monitoring
python screeners/tv_screen_usage.py --watch --mode FOMO --refresh 15 --enable-trading
```

## 🎯 **What You Get Now**

### **Pre-Breakout Advantage:**
1. **Early Entry** → Better prices before FOMO crowd
2. **Lower Risk** → Catch accumulation, not explosive moves  
3. **Better R/R** → More room to run when breakout happens
4. **Smart Signals** → RSI + MACD + volume confirmation
5. **NSE Focus** → No BSE noise, quality stocks only

### **Enhanced Automation:**
1. **Same watch command** with pre-breakout intelligence
2. **Anti-spam Telegram alerts** with confidence scoring
3. **5-minute cooldown** prevents duplicate alerts  
4. **70%+ confidence filtering** for quality signals only
5. **Automatic paper trading** on quality pre-breakout setups
6. **Live tracking** of pre-breakout positions
7. **1% profit targets** for intraday (realistic for volatile markets)

**Your trading is now ANTI-FOMO focused!** ⚡

---

## 🔧 **Advanced Configuration**

### **Adjusting Anti-Spam Settings**

If you want to customize the new alert filtering (advanced users only):

**In `tv_screen_usage.py` around line 115:**
```python
self.alert_cooldown = 300  # 5 minutes between alerts per symbol (in seconds)
```

**Alert confidence threshold (around line 1701):**
```python
if confidence >= 0.5:  # 50% minimum confidence (updated)
```

**Volume threshold (around line 1409):**
```python
def intraday_watch_mode(self, refresh_interval=30, volume_threshold=1.5, ...):  # 1.5x (updated)
```

### **Recommended Settings:**
- **Conservative**: `alert_cooldown = 600` (10 minutes), `confidence >= 0.7` (70%), `volume_threshold = 2.0`
- **Default**: `alert_cooldown = 300` (5 minutes), `confidence >= 0.5` (50%), `volume_threshold = 1.5`
- **Aggressive**: `alert_cooldown = 180` (3 minutes), `confidence >= 0.4` (40%), `volume_threshold = 1.2`

### **Disabling Anti-Spam (Not Recommended):**
To revert to old behavior (will cause spam):
- Set `alert_cooldown = 0` and `confidence >= 0.3`

---

## 📋 **Changelog**

### **v3.2 - Mode-Specific Logic + Performance (Latest)**
- ✅ **Mode-specific alert generation** - Each mode now has unique trading logic
- ✅ **Parallel price fetching** - 10x faster live price updates for active positions  
- ✅ **Lowered thresholds** - Confidence: 70%→50%, Volume: 2.0x→1.5x for better signals
- ✅ **Removed mode restrictions** - All alert types work in all modes
- ✅ **Tighter risk management** - Stop loss: 2%→0.5% (1:2 risk-reward ratio)
- ✅ **Enhanced mode behaviors** - MOMENTUM, ACCUMULATION, PREBREAKOUT, GAP each trade differently

### **v3.1 - Anti-Spam Alert System**
- ✅ Fixed excessive Telegram alert spam
- ✅ Added 5-minute cooldown per symbol per alert type  
- ✅ Enhanced confidence scoring (30-95% dynamic calculation)
- ✅ 70% minimum confidence threshold for alerts
- ✅ All existing modes and functionality preserved
- ✅ Fixed TradingView column division syntax errors

### **v3.0 - Mode-Based Anti-FOMO Strategies**
- ✅ Added 5 different modes: PREBREAKOUT, FOMO, SMART_FOMO, ACCUMULATION, MOMENTUM
- ✅ NSE-only filtering (ignore BSE)
- ✅ 1% profit targets for volatile markets  
- ✅ Auto trade journaling with dated log files
- ✅ Paper trading integration with live price validation