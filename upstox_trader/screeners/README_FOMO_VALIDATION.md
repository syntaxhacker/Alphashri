# FOMO Trading Strategy Validation Suite

A complete toolkit for validating FOMO trading strategies based on technical pattern analysis.

## Overview

This suite provides tools to:
1. Analyze today's top FOMO stocks using real-time data
2. Create trade plans for tomorrow based on pattern recognition
3. Execute and validate trades with real market data
4. Generate performance reports and refine strategies

## Tools Included

### 1. Pattern Analyzer (`fomo_pattern_analyzer.py`)
Analyzes today's FOMO stocks using 1-minute intraday data to identify technical patterns.

**Run:** `python fomo_pattern_analyzer.py`

### 2. Tomorrow's Trade Planner (`show_tomorrow_trades.py`)
Displays pre-configured trade plans for tomorrow's trading session.

**Run:** `python show_tomorrow_trades.py`

### 3. Tomorrow's Validator (`tomorrow_fomo_validator.py`)
**Main tool to run tomorrow** - automatically executes and monitors trades.

**Run:** `python tomorrow_fomo_validator.py`

### 4. Strategy Validator (`fomo_validator.py`)
Simulates strategy performance for backtesting and optimization.

**Run:** `python fomo_validator.py`

## Quick Start Guide

### Today (Pattern Analysis Day)

1. **Run Pattern Analysis:**
   ```bash
   python fomo_pattern_analyzer.py
   ```
   This analyzes today's top FOMO stocks and identifies trading patterns.

2. **Review Tomorrow's Trades:**
   ```bash
   python show_tomorrow_trades.py
   ```
   Shows the pre-configured trade plans based on today's analysis.

### Tomorrow (Execution Day)

1. **Run the Validator at Market Open:**
   ```bash
   python tomorrow_fomo_validator.py
   ```
   
   The script will:
   - Wait for market open (9:15 AM IST)
   - Monitor trade setups automatically
   - Enter trades when conditions are met
   - Track performance in real-time
   - Generate exit signals
   - Create performance report

## Trade Setup Types

### Extreme Mean Reversion
- **Symbols**: RATEGAIN (RSI 4.3)
- **Setup**: Buy at market open or on first pullback
- **Time Frame**: First 30 minutes

### Mean Reversion
- **Symbols**: SAFARI, NEWGEN
- **Setup**: Buy on recovery signal
- **Time Frame**: First hour

### Trend Continuation
- **Symbols**: APOLLO
- **Setup**: Buy on strong morning move
- **Time Frame**: First hour

### Volume Breakout
- **Symbols**: ACMESOLAR
- **Setup**: Buy on volume confirmation
- **Time Frame**: Any time

## Risk Management

- **Position Size**: Max 2% portfolio per trade
- **Total Exposure**: Max 5% portfolio
- **Exit Time**: All positions by 3:15 PM
- **Stop Loss**: Based on yesterday's key levels
- **Profit Taking**: 1:1 and 1:2 risk-reward targets

## Performance Tracking

The validator tracks:
- Win rate percentage
- Average return per trade
- Risk-reward ratios
- Strategy accuracy (actual vs. expected returns)
- Setup success rates

## Files Generated

- `tomorrow_fomo_validation_YYYYMMDD_HHMMSS.json` - Detailed trade results
- Console output with performance metrics
- Strategy assessment and recommendations

## Prerequisites

- Upstox API credentials configured
- Python 3.7+
- Required packages installed
- Market data access

## Support

For issues or questions:
1. Check error messages in console output
2. Verify Upstox credentials
3. Ensure internet connectivity
4. Confirm market hours (9:15 AM - 3:30 PM IST)

## Next Steps

1. Run `python fomo_pattern_analyzer.py` to analyze today's patterns
2. Review `python show_tomorrow_trades.py` for tomorrow's plans
3. Run `python tomorrow_fomo_validator.py` tomorrow at market open
4. Analyze results and refine strategy