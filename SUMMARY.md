# Nifty 50 Technical Analysis Tools

## Overview

We've created a set of tools for performing technical analysis on the Nifty 50 index. The tools provide comprehensive insights into price action, technical indicators, volatility, and market regimes, with interactive visualizations and a summary report.

## Files Created

1. **eda.py**: The core engine that performs all technical analysis calculations and generates charts
2. **nifty_analysis.py**: A user-friendly wrapper script that creates a complete dashboard
3. **download_nifty_data.py**: A utility to download historical Nifty 50 data or generate synthetic data
4. **README.md**: Documentation on how to use the tools

## Features

- Comprehensive technical analysis with common indicators (RSI, MACD, Bollinger Bands, etc.)
- Interactive HTML visualizations using Plotly
- Market regime detection (trending, volatile, quiet)
- Automatic summary report generation
- HTML dashboard for easy navigation
- Support for both real Yahoo Finance data and synthetic data for demonstration

## How to Use

### Generate Data

First, download historical data or generate synthetic data:

```bash
# Download real data (requires Yahoo Finance API access)
python download_nifty_data.py --days 90 --interval 1d

# Generate synthetic data for demonstration/testing
python download_nifty_data.py --days 90 --interval 1d --synthetic
```

### Run Analysis

Run the analysis dashboard with default settings:

```bash
python nifty_analysis.py
```

This creates a complete dashboard in the `nifty_analysis` directory.

### Command Line Options

```bash
python nifty_analysis.py [--days DAYS] [--no-filter] [--output-dir OUTPUT_DIR]
```

- `--days`: Number of days to analyze (default: 7)
- `--no-filter`: Do not filter to current week
- `--output-dir`: Directory to save analysis results

## Output

The analysis generates the following outputs:

1. Interactive HTML charts:
   - Price action with Bollinger Bands and volume
   - Technical indicators (RSI, MACD, etc.)
   - Volatility analysis
   - Market regime analysis

2. A markdown summary report with key findings

3. An HTML dashboard for easy navigation of all charts

## Extending the Tools

The modular design allows for easy extension:

1. Add new technical indicators in `eda.py`
2. Create new visualization functions
3. Modify the market regime detection algorithm
4. Customize the summary report generation

## Troubleshooting

If you encounter issues downloading data from Yahoo Finance, use the synthetic data option:

```bash
python download_nifty_data.py --days 90 --interval 1d --synthetic
```

The synthetic data mimics the characteristics of the Nifty 50 index and provides a good demonstration of the analysis capabilities. 