# Enhanced Buyer/Seller Interest Scanner

## Overview

This scanner identifies stocks with strong **buyer interest** (bullish setups) or **seller interest** (bearish setups) using comprehensive candlestick analysis, pattern recognition, and quant-optimized filters.

**Location:** `scanners/verify_buyer_interest_upstox_enhanced.py`

---

## Key Features

### 1. **Wick Close Analysis** (Core Signal)
- **Formula:** `((Close - Low) / (High - Low)) * 100`
- **Bullish:** Close in top 30% of range (≥70%)
- **Bearish:** Close in bottom 30% of range (≤30%)
- Tracks: Current, 3-day avg, 5-day avg

### 2. **Candlestick Pattern Recognition**
| Pattern | Signal | Description |
|---------|--------|-------------|
| HAMMER | STRONG_BULL | Small body at top, long lower shadow (reversal) |
| STRONG_BULL | STRONG_BULL | Large body, close near high (marubozu-like) |
| BULLISH | BULL | Generic bullish candle |
| SHOOTING_STAR | STRONG_BEAR | Small body at bottom, long upper shadow |
| STRONG_BEAR | STRONG_BEAR | Large body, close near low |
| BEARISH | BEAR | Generic bearish candle |
| DOJI | NEUTRAL | Small body (indecision) |
| BULL_ENGULF | STRONG_BULL | Bullish engulfing pattern |
| BEAR_ENGULF | STRONG_BEAR | Bearish engulfing pattern |

### 3. **Gap Analysis**
- Detects gap up/down > 2%
- Shows gap % in output
- Gaps add bonus points to score

### 4. **Trend Filter (EMA Alignment)**
- EMA 20 vs EMA 50
- Price position relative to EMAs
- Bullish setups: Price above EMA, EMA20 > EMA50
- Bearish setups: Price below EMA, EMA20 < EMA50

### 5. **Volume Validation**
- **Volume Surge:** Current / 10-period average
- **Minimum Liquidity:**
  - Avg volume ≥ 5,00,000 shares/day
  - Current volume ≥ 2,00,000 shares
- Skips illiquid stocks automatically

### 6. **Risk/Reward Calculation**
- **Entry:** Current close price
- **Stop-Loss:** Day's low (LONG) or Day's high (SHORT)
- **Targets:** 1:2 and 1:3 R:R levels
- **Risk %:** Calculated automatically

### 7. **Comprehensive Scoring (0-100)**

| Component | Points | Description |
|-----------|--------|-------------|
| Wick Position | 25 | Core buyer/seller interest |
| Candle Pattern | 20 | Pattern confirmation |
| Volume Surge | 15 | Institutional participation |
| Trend Alignment | 15 | EMA confirmation |
| Momentum (5d) | 10 | Price movement |
| RSI | 10 | Overbought/oversold check |
| ADX | 5 | Trend strength |

**Action Matrix:**
| Score | Bad Signals | Action |
|-------|-------------|--------|
| ≥75 | 0 | ENTER_LONG / ENTER_SHORT |
| ≥60 | ≤1 | WATCH_LONG / WATCH_SHORT |
| ≥40 | any | WAIT_LONG / WAIT_SHORT |
| <40 | any | AVOID |

---

## Quant-Optimized Thresholds

```python
class QuantThresholds:
    # Wick Percentages
    WICK_CLOSE_STRONG_BULLISH = 85.0    # Top 15%
    WICK_CLOSE_BULLISH = 70.0           # Top 30%
    WICK_CLOSE_WEAK_BULLISH = 60.0      # Top 40%
    WICK_CLOSE_STRONG_BEARISH = 15.0    # Bottom 15%
    WICK_CLOSE_BEARISH = 30.0           # Bottom 30%

    # Body Analysis
    BODY_STRONG = 60.0                  # Strong real body
    BODY_WEAK = 30.0                    # Weak body (doji)

    # Shadows
    UPPER_SHADOW_SMALL = 20.0           # < 20% of range
    UPPER_SHADOW_LARGE = 40.0           # > 40% of range
    LOWER_SHADOW_LARGE = 40.0           # > 40% of range

    # Gap
    GAP_SIGNIFICANT_PCT = 2.0           # 2% gap

    # Volume
    VOLUME_SURGE_STRONG = 2.5           # 2.5x avg
    VOLUME_SURGE_MODERATE = 1.5         # 1.5x avg
    MIN_VOLUME_AVG = 500000             # 5L avg shares
    MIN_VOLUME_CURRENT = 200000         # 2L current

    # RSI
    RSI_OVERBOUGHT = 75
    RSI_OVERSOLD = 25
    RSI_SWEET_SPOT_MIN = 50            # Ideal for longs
    RSI_SWEET_SPOT_MAX = 70

    # ADX
    ADX_STRONG = 35
    ADX_MODERATE = 25
    ADX_WEAK = 20

    # Risk
    MIN_RISK_REWARD = 2.0               # 1:2 R:R
    MAX_RISK_PCT = 2.0                  # Max 2% risk

    # Momentum
    MOMENTUM_STRONG = 5.0               # 5% move
    MOMENTUM_MODERATE = 2.0             # 2% move
```

---

## Usage

```bash
# Basic usage (daily data, score ≥ 50)
python scanners/verify_buyer_interest_upstox_enhanced.py

# Minimum score filter (only high-quality setups)
python scanners/verify_buyer_interest_upstox_enhanced.py --min-score 70

# Intraday mode (30-minute candles)
python scanners/verify_buyer_interest_upstox_enhanced.py --intraday

# Show only bearish setups
python scanners/verify_buyer_interest_upstox_enhanced.py --bearish

# INDMONEY API
python scanners/verify_buyer_interest_upstox_enhanced.py --provider indmoney

# Combined options
python scanners/verify_buyer_interest_upstox_enhanced.py --intraday --min-score 65 --bearish
```

### Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--intraday` | False | Use 30-min candles instead of daily |
| `--provider` | upstox | API provider (upstox/indmoney) |
| `--min-score` | 50 | Minimum score (0-100) to display |
| `--bullish` | True | Show bullish setups |
| `--bearish` | True | Show bearish setups |

---

## Output Format

```
📈 BULLISH SETUPS (Score >= 60.0, Price < 7k) 📉
┏──────┳────┳────────┬─────────┬─────┬─────┬────┬────┬──────┬────┬─────┬───┬───┬─────┬────────┓
┃Sym...┃Sc..┃Action  ┃Pattern  ┃Wick%┃Body%┃Vol x┃Gap ┃Entry ┃Stop┃R:R% ┃RSI┃ADX┃5d Mo┃Sector  ┃
┡──────╇────╇────────╇─────────╇─────╇─────╇────╇────╇──────╇────╇─────╇───╇───╇─────╇────────┩
│CUB   │88  │LONG    │BULL_ENGULF│88% │62%  │2.4x│+1.2│₹32..│₹31.│4.2% │68 │28 │+5.7 │Finance │
│AUBANK│75  │WATCH_L │STRONG_BULL│91% │55%  │1.8x│+0.8│₹98..│₹95.│2.1% │65 │43 │+3.8 │Finance │
└──────┴────┴────────┴─────────┴─────┴─────┴────┴────┴──────┴────┴─────┴───┴───┴─────┴────────┘

📋 BULLISH SYMBOL LISTS:

▶ ENTER (7):
CUB, JAYNECOIND, ASHOKLEY, M&MFIN, HSCL, NATIONALUM, IIFLCAPS

⏸ WATCH (3):
INFY, CANBK, MARICO
```

### Column Descriptions

| Column | Description |
|--------|-------------|
| **Score** | Overall signal quality (0-100) |
| **Action** | ENTER/WATCH/WAIT for LONG or SHORT |
| **Pattern** | Recognized candlestick pattern |
| **Wick %** | Close position in day's range (100=high) |
| **Body %** | Real body as % of total range |
| **Vol x** | Volume surge multiplier vs 10-period avg |
| **Gap** | Gap % from previous close |
| **Entry** | Suggested entry price (current close) |
| **Stop** | Stop-loss level (day's low/high) |
| **R:R %** | Risk % from entry to stop-loss |
| **RSI** | Current RSI value |
| **ADX** | Trend strength indicator |
| **5d Mom** | 5-day price momentum |

---

## Edge Cases Handled

| Edge Case | Solution |
|-----------|----------|
| **Flat day** (high ≈ low) | Wick% = 50% (neutral) |
| **Illiquid stocks** | Filtered out (min volume check) |
| **Overbought RSI** (>75) | Penalty applied to score |
| **Counter-trend setups** | Reduced score, marked as WAIT |
| **Gap up/down** | Detected and shown in output |
| **Doji candles** | Recognized as NEUTRAL signal |
| **Engulfing patterns** | Special detection (2 candles) |
| **Upper shadow rejection** | Shooting Star pattern flagged |
| **Lower shadow support** | Hammer pattern flagged |

---

## Comparison: Original vs Enhanced

| Feature | Original | Enhanced |
|---------|----------|----------|
| Wick Analysis | ✅ | ✅ (Improved) |
| Bullish Only | ✅ | ✅ + Bearish |
| Pattern Recognition | ❌ | ✅ (10 patterns) |
| Gap Analysis | ❌ | ✅ |
| Trend Filter (EMA) | ❌ | ✅ |
| Volume Validation | Basic | ✅ (Min check + surge) |
| Risk/Reward | ❌ | ✅ (Entry/Stop/Target) |
| Scoring System | Basic | ✅ (100pt quant model) |
| ADX Trend Check | ✅ | ✅ (Enhanced) |
| RSI Zones | ✅ | ✅ (Sweet spot detection) |

---

## Trading Strategy Recommendations

### For ENTER_LONG signals:
1. **Entry:** At current close or slight pullback
2. **Stop-Loss:** Below day's low
3. **Target:** 1:2 or 1:3 R:R (shown in output)
4. **Position Size:** Risk ≤ 2% of capital

### For WATCH_LONG signals:
1. Add to watchlist
2. Wait for:
   - Pullback to support
   - Volume confirmation
   - Breakout confirmation
3. Re-evaluate next day

### For ENTER_SHORT signals:
1. **Entry:** At current close
2. **Stop-Loss:** Above day's high
3. **Target:** 1:2 or 1:3 R:R
4. **Caution:** Shorting has unlimited risk

---

## Regular Verification & Refinement

To maintain edge and adapt to market conditions:

### Weekly:
```bash
# Compare scanner results vs actual performance
# Track which scores led to winning trades
```

### Monthly:
```bash
# Review threshold effectiveness
# Adjust QuantThresholds based on backtest
# Consider seasonal factors
```

### Quarterly:
```bash
# Full backtest on different market regimes
# Optimize scoring weights
# Add new patterns if edge detected
```

---

## Files Created

1. **scanners/verify_buyer_interest_upstox_enhanced.py** - Main scanner
2. **scanners/verify_buyer_interest_upstox.py** - Original simplified version

---

## Future Enhancements

- [ ] Add multi-timeframe confirmation (daily + weekly)
- [ ] Machine learning for pattern weighting
- [ ] Sector rotation analysis
- [ ] Market regime detection (bull/bear/sideways)
- [ ] Automatic backtesting integration
- [ ] Alert system for high-score setups
- [ ] Performance tracking dashboard

---

## Disclaimer

This scanner is for educational purposes. Always:
1. Do your own research
2. Manage risk properly
3. Paper trade first
4. Consider market conditions
5. Use position sizing

**Past performance does not guarantee future results.**
