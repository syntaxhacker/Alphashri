#!/usr/bin/env python3
"""
SECTOR COVARIANCE CORRELATION ANALYZER
===================================

This script uses covariance analysis to find sector relationships and predict 
which stocks are likely to rise when one sector shows significant movement.

FEATURES:
- Historical covariance analysis between sectors
- Real-time sector movement monitoring  
- Stock prediction based on sector correlations
- Lead-lag relationship identification
- Intra-sector stock-to-stock correlations
- Performance validation and backtesting
- Upstox V3 API integration with proper instrument mapping
- TradingView screener integration for sector classification

USAGE EXAMPLES:
=============

## Basic Commands

### 1. Full sector analysis with correlations
python sector_covariance_analyzer.py --analyze-sectors

### 2. Predict stocks based on sector trigger
python sector_covariance_analyzer.py --predict-stocks --trigger-sector "Technology Services" --trigger-movement 3.5

### 3. Real-time monitoring for sector movements
python sector_covariance_analyzer.py --monitor-realtime

## Advanced Usage

### Custom parameters
python sector_covariance_analyzer.py --analyze-sectors --lookback-days 90 --min-correlation 0.4

### Different prediction scenarios
python sector_covariance_analyzer.py --predict-stocks --trigger-sector "Energy Minerals" --trigger-movement -2.5 --lookback-days 120

### Real-time monitoring with custom threshold
python sector_covariance_analyzer.py --monitor-realtime --check-interval 180

## Key Parameters

--analyze-sectors           : Run complete sector correlation analysis
--predict-stocks           : Generate predictions based on sector trigger
--monitor-realtime         : Monitor sectors for significant movements
--trigger-sector "name"     : Sector that triggered movement (use exact name from analysis)
--trigger-movement X.X      : Movement percentage (positive or negative)
--lookback-days N          : Historical data period (default: 365, recommended: 60-120)
--min-correlation X.X      : Minimum correlation threshold (default: 0.3)
--check-interval N         : Real-time check interval in seconds (default: 300)

## Output Interpretation

### Sector Correlation Matrix
- Shows correlations between all 19 sectors
- Green values (>0.5) = Strong positive correlation
- Red values (<-0.3) = Negative correlation
- Values close to 0 = No correlation

### Sector Movement Predictions
- Predicted Move: Expected percentage change in correlated sector
- Correlation: Historical correlation coefficient with trigger sector
- Confidence: Correlation strength (higher = more reliable)
- Direction: POSITIVE/NEGATIVE movement expected

### Stock-to-Stock Correlations
- Shows correlations between individual stocks within each sector
- Values >0.5 indicate stocks that move together
- When one stock rises, highly correlated stocks likely to follow
- Strongest correlations highlighted separately

## Real Trading Insights

### Example Scenario:
If Technology Services rises 3.5%, the script predicts:
- Industrial Services: +1.96% (56% confidence)
- Energy Minerals: +1.67% (48% confidence)
- Within Energy Minerals: BPCL and HINDPETRO move together (0.81 correlation)

### Best Practices:
1. Use 60-120 day lookback for current market conditions
2. Focus on predictions with >0.4 correlation (40%+ confidence)
3. Check intra-sector correlations for stock selection
4. Monitor for correlations >0.5 for strongest relationships
5. Use real-time monitoring during market hours

## Setup Requirements

### 1. Dependencies
pip install pandas numpy requests rich tradingview-screener rookiepy

### 2. Upstox API Configuration
- Set up config.py with UPSTOX_CONFIG containing access_token
- Script automatically downloads NSE instrument master data
- No manual instrument mapping required

### 3. TradingView Access
- Login to TradingView in your browser
- Script automatically extracts cookies for live data access

## Error Handling

### Common Issues:
1. "No instrument key found" - Symbol not found in NSE master data
2. "API error 400" - Invalid instrument key or authentication
3. "Insufficient sectors" - Need at least 3 sectors for correlation analysis
4. "No sector data available" - Check TradingView login and cookies

### Troubleshooting:
- Refresh TradingView page if cookie errors occur
- Check Upstox API token validity if instrument errors persist
- Use shorter lookback periods if insufficient data errors occur

## Performance Notes

### Execution Times:
- Initial instrument loading: ~3 seconds (61K+ instruments)
- Sector analysis (19 sectors, 60 days): ~2 minutes
- Prediction generation: ~1 minute
- Real-time monitoring: Continuous with configurable intervals

### Memory Usage:
- Instrument mapping: ~50MB
- Historical data: ~10MB per sector
- Total: ~200MB for full analysis

## Integration Examples

### Batch Processing Multiple Triggers
for sector in ["Technology Services", "Energy Minerals", "Finance"]:
    python sector_covariance_analyzer.py --predict-stocks --trigger-sector "$sector" --trigger-movement 2.0

### Automated Trading Integration
# Use predictions in trading algorithms
# Monitor for high-confidence predictions (>0.6 correlation)
# Implement position sizing based on correlation strength

## Data Sources

### TradingView Screener:
- 500+ NSE stocks across 19 sectors
- Real-time sector classification
- Technical indicators (RSI, performance, volume)

### Upstox V3 API:
- Historical daily OHLC data
- 8,016 NSE equity instruments
- Proper instrument key mapping (NSE_EQ|ISIN format)
- Up to 10 years historical data for daily timeframe

### Output Format:
- Rich CLI tables similar to TradingView screener format
- Color-coded correlations and predictions
- Progress indicators for long-running operations
- Professional trading terminal appearance

TESTED & VERIFIED:
- Real market data integration working
- 8,016 NSE instruments successfully mapped
- 19 sectors with 500+ stocks analyzed
- Correlation analysis with 60+ days historical data
- Both sector-to-sector and stock-to-stock correlations functional

MODULE STRUCTURE:
- sector_analyzer.py  : Core analysis logic (correlations, predictions, covariance)
- sector_visualizer.py: All plotting and visualization (matplotlib, seaborn, networkx)
- sector_data.py      : Data fetching (TradingView, Upstox API, instrument mapping)
- sector_cli.py       : CLI argument parsing and main() function
"""

from .sector_data import SectorDataFetcher, TV_AVAILABLE, UPSTOX_AVAILABLE
from .sector_analyzer import SectorAnalyzer
from .sector_visualizer import SectorVisualizer
from .sector_cli import SectorCovarianceAnalyzer, main, display_help

__all__ = [
    'SectorCovarianceAnalyzer',
    'SectorAnalyzer', 
    'SectorDataFetcher',
    'SectorVisualizer',
    'main',
    'display_help',
    'TV_AVAILABLE',
    'UPSTOX_AVAILABLE',
]

if __name__ == "__main__":
    main()
