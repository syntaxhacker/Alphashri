# Top 5 Stock Recommendations

## Overview
This tool identifies the TOP 5 stocks with the strongest bullish technical signals for potential short-term upside. It uses advanced technical analysis to screen for high-confidence opportunities.

## ⚠️ IMPORTANT DISCLAIMER
**This tool is for EDUCATIONAL/RESEARCH PURPOSES ONLY.**

**🚨 NEVER invest based solely on algorithmic signals.**

**Before investing in ANY stock, you MUST:**
- Do your own thorough research
- Understand the company fundamentals
- Consider your risk tolerance
- Never invest more than you can afford to lose
- Consult with qualified financial advisors

## Features
- **Advanced Technical Analysis** - RSI, MACD, Moving Averages, Bollinger Bands
- **Momentum Screening** - Volume, price action, and performance metrics
- **Confidence Scoring** - Composite scores for signal strength
- **Risk Assessment** - Technical analysis of potential downside
- **Beautiful Visualization** - Color-coded tables with rankings
- **Detailed Analysis** - Technical breakdown for each recommendation

## Requirements
- Python 3.7+
- tradingview-screener
- rich
- pandas
- numpy

## Installation
```bash
pip install tradingview-screener rich pandas numpy
```

## Usage
```bash
# Get top 5 stock recommendations
python top_5_stocks.py
```

## Output Format

### Top 5 Recommendations Table
- **Rank** - Position #1-5
- **Symbol** - Stock ticker
- **Price** - Current price
- **Change** - Daily % change (green/red)
- **RSI** - Momentum indicator
- **Volume** - Relative volume vs 10-day average
- **Weekly** - Weekly performance
- **Score** - Composite technical score
- **Confidence** - 🟢 Very High / 🔵 High / 🟡 Medium / 🔴 Low

### Detailed Analysis
For each recommended stock:
- Complete technical breakdown
- Momentum indicators
- Risk assessment
- Composite score interpretation

## Note
Algorithmic trading involves significant risks including:
- Market volatility
- Technical failures
- Data delays
- Unexpected events
- Loss of capital

The creators accept NO responsibility for any losses incurred.