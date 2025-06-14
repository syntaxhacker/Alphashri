# Nifty 50 Technical Analysis Dashboard

This project provides a comprehensive technical analysis dashboard for the Nifty 50 index, generating interactive HTML visualizations and a detailed summary report.

## Features

- **Price Action Analysis**: Candlestick charts with Bollinger Bands and volume indicators
- **Technical Indicators**: RSI, MACD, Moving Averages, and other key indicators
- **Volatility Analysis**: Volatility regimes and patterns
- **Market Regime Detection**: Identification of market regimes (trending, volatile, quiet)
- **Summary Report**: Automated generation of a concise analysis summary
- **Interactive Dashboard**: An HTML dashboard to easily navigate all visualizations

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/nifty-analysis.git
   cd nifty-analysis
   ```

2. Install the required packages:
   ```
   pip install pandas numpy matplotlib seaborn plotly ta yfinance
   ```

3. Install TA-Lib (can be tricky on some platforms):
   ```
   # Windows
   pip install TA-Lib
   
   # Linux
   apt-get install ta-lib
   pip install TA-Lib
   
   # macOS
   brew install ta-lib
   pip install TA-Lib
   ```

## Usage

### Quick Start

Run the analysis with default settings:

```
python nifty_analysis.py
```

This will:
- Analyze Nifty 50 data for the current week
- Generate interactive charts in `nifty_analysis/figures/`
- Create a summary report in `nifty_analysis/reports/`
- Generate an HTML dashboard at `nifty_analysis/index.html`

### Command Line Options

```
python nifty_analysis.py [--days DAYS] [--no-filter] [--output-dir OUTPUT_DIR]
```

- `--days DAYS`: Number of days to analyze (default: 7)
- `--no-filter`: Do not filter to current week (analyze all data)
- `--output-dir OUTPUT_DIR`: Directory to save analysis results (default: nifty_analysis)

### Examples

Analyze data for the last 14 days:
```
python nifty_analysis.py --days 14
```

Save analysis in a custom directory:
```
python nifty_analysis.py --output-dir my_nifty_analysis
```

## Output

The script generates the following outputs:

1. **Interactive HTML Charts**:
   - `nifty_price_action.html`: Candlestick chart with Bollinger Bands and volume
   - `nifty_technical_indicators.html`: Key technical indicators dashboard
   - `nifty_volatility.html`: Volatility analysis
   - `nifty_regimes.html`: Market regime analysis

2. **Summary Report**:
   - `nifty_weekly_summary.md`: Markdown summary of the analysis

3. **Dashboard**:
   - `index.html`: Main dashboard to navigate all charts with embedded summary

## Data Sources

The script will attempt to download Nifty 50 data from Yahoo Finance. If the download fails, it will generate synthetic data for demonstration purposes.

## Customization

You can modify the `eda.py` script to:
- Add or remove technical indicators
- Change visualization parameters
- Adjust market regime detection thresholds
- Customize the summary report format

## Contributing

Contributions to improve the analysis or add new features are welcome! Please feel free to submit a pull request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 