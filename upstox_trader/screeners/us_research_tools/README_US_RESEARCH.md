# US Market Research Toolkit

## Overview
This toolkit provides comprehensive research capabilities for US stocks without any trading functionality. It's designed specifically for research purposes as requested.

## Features
- **High Volume Screening** - Find stocks with unusual volume activity
- **Momentum Analysis** - Identify leading momentum stocks
- **Value Research** - Discover undervalued opportunities
- **Sector Performance** - Analyze sector rotation and leadership
- **Gap Detection** - Find stocks with significant price gaps
- **Technical Analysis** - Calculate key technical indicators

## Requirements
- Python 3.7+
- tradingview-screener
- rich
- pandas
- numpy
- talib (optional, for technical analysis)

## Installation
```bash
pip install tradingview-screener rich pandas numpy

# For technical analysis (optional)
# pip install TA-Lib
```

## Usage

### Comprehensive Research
```bash
python us_market_research.py --research
```

### Individual Screens
```bash
# High volume screening
python us_market_research.py --high-volume

# Momentum analysis
python us_market_research.py --momentum

# Value opportunities
python us_market_research.py --value

# Sector performance
python us_market_research.py --sectors

# Gap opportunities
python us_market_research.py --gaps
```

### Customized Screens
```bash
# High volume stocks over $50 with 100 results
python us_market_research.py --high-volume --min-price 50 --limit 100

# Momentum leaders over $100
python us_market_research.py --momentum --min-price 100 --limit 25

# Save research data to CSV files
python us_market_research.py --research --save-data
```

### Help
```bash
# Show detailed help
python us_market_research.py --help-tool
```

## Output
The toolkit displays results in formatted tables and can optionally save data to CSV files in the `research_data/` directory.

## Note
This tool is for research purposes only. It does not provide trading advice or execute trades. All financial decisions should be made independently with proper research and risk management.