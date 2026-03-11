# Screeners Tools Directory Structure

## Overview
This directory contains various stock screening and research tools organized by functionality.

## Directory Structure

### 1. **Core Modules** (`/core/`)
Contains the modularized core functionality:
- `trading_core.py` - Trading and risk management functions
- `gap_analysis.py` - Gap trading strategies and analysis
- `technical_analysis.py` - Technical indicators and pattern detection
- `live_data.py` - Real-time price monitoring and data fetching
- `display_utils.py` - UI components and table rendering

### 2. **Strategy Modes** (`/modes/`)
Contains strategy-specific modules:
- `pre_breakout.py` - Pre-breakout accumulation strategies
- `intraday.py` - Intraday trading strategies
- `gap_trading.py` - Gap trading and gap-fill strategies
- `momentum.py` - Momentum-based trading strategies
- `swing.py` - Swing trading strategies
- `investment.py` - Long-term investment strategies
- `research.py` - Research and analysis functions
- `fomo.py` - FOMO-based trading strategies

### 3. **US Market Research Tools** (`/us_research_tools/`)
Contains tools specifically for US market research:
- `us_market_research.py` - Comprehensive US market research toolkit
- `README_US_RESEARCH.md` - Documentation for US market research
- `US_RESEARCH_SUMMARY.md` - Summary of US market research capabilities

### 4. **Top 5 Stock Recommendations** (`/top_5_recommendations/`)
Contains the focused stock recommendation tool:
- `top_5_stocks.py` - Top 5 stock recommendations with technical analysis
- `README_TOP_5.md` - Documentation for top 5 recommendations
- `TOP_5_SUMMARY.md` - Summary of top 5 stock recommendation features

### 5. **Bullish/Bearish Screener** (`/bull_bear_screener/`)
Contains the bullish/bearish stock screener:
- `bull_bear_screener.py` - Bullish/bearish stock identification tool
- `README_BULL_BEAR.md` - Documentation for bull/bear screener
- `BULL_BEAR_SUMMARY.md` - Summary of bull/bear screener features

## Usage

### Main TradingView Screener
The main `tv_screen_usage.py` file orchestrates all functionality and provides:
- Comprehensive trading strategies
- Real-time market screening
- Technical analysis and pattern detection
- Risk management and position monitoring
- Paper trading capabilities

### Specialized Tools
Each specialized directory contains standalone tools for specific purposes:
- **US Market Research** - For pure research on US stocks without trading
- **Top 5 Recommendations** - Focused tool for identifying top bullish stocks
- **Bull/Bear Screener** - Advanced technical analysis for market direction

## Note
All tools are designed for research and educational purposes. Trading functionality is provided for paper trading simulation only. Actual trading should be conducted through proper licensed platforms with appropriate risk management.