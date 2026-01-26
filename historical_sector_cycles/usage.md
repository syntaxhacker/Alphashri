# Sector Rotation Dashboard - Usage Guide

## Overview

The Sector Rotation Dashboard is a comprehensive web-based tool for analyzing sector performance trends, correlations, momentum, and risk metrics. It helps identify rotation opportunities, divergences, and potential trading signals in the Indian stock market.

## Getting Started

### Prerequisites

1. **Data File**: Ensure `rotation_dashboard_data.json` exists in the project directory
2. **Web Server**: Serve the files using a local web server:
   ```bash
   # Python 3
   python -m http.server 8001

   # Or Python 2
   python -m SimpleHTTPServer 8001
   ```
3. **Open Browser**: Navigate to `http://localhost:8001/dashboard-modular.html`

### Optional: Flask API for Volume Data

For volume-related features (Volume Calendar, Volume-Price Divergence):

```bash
python sector_contributors_api.py
```

The API runs on `http://localhost:5555` and provides:
- `/api/sectors` - List of available sectors
- `/api/sector-volume?sector=<NAME>&range=<PERIOD>` - Volume data for a sector
- `/api/all-sectors-volume?range=<PERIOD>` - Volume data for all sectors

## Dashboard Views

### 1. Overview

**Purpose**: Quick snapshot of sector performance and rankings

**Features**:
- Sector Performance (Cumulative) - Shows overall sector returns over time
- Momentum Ranking - Current sector rankings by performance
- Sector Performance Timeline - Historical performance of all sectors

**Key Metrics**:
- Color-coded lines for each sector
- Time range selector (Days, Weeks, Months, Years)
- YTD (Year-to-Date) quick filter

### 2. Rotation Heatmap

**Purpose**: Visualize sector ranking changes over time

**Features**:
- Sector Ranking Heatmap - Color grid showing sector positions by month
- Rotation Timeline - Top 3 sectors each quarter

**How to Read**:
- Green = Higher rank (better performance)
- Red = Lower rank (weaker performance)
- Look for sector rotations (color changes over time)

### 3. Correlation

**Purpose**: Understand sector relationships for diversification and pair trading

**Features**:
- Sector Correlation Matrix - Shows how sectors move together
- Correlation Insights - Auto-generated analysis
- Pair Trading Opportunities - Inverse correlations for rotation strategies
- **NEW**: Sector Correlation Clusters (Dendrogram) - Hierarchical view of sector families

**How to Use**:
- High positive correlation (> 0.7) = Sectors move together (not good for diversification)
- Negative correlation (< -0.3) = Rotation opportunities
- Cluster dendrogram helps identify sector groups

### 4. Momentum

**Purpose**: Track sector momentum across different timeframes

**Features**:
- 1M, 3M, 6M, 1Y returns for all sectors
- Color-coded by performance
- Sorted by 3M momentum

**Trading Signals**:
- Focus on top 3 sectors for long positions
- Bottom 3 sectors may be due for rotation

### 5. 📊 Volume

**Purpose**: Analyze trading volume patterns by calendar

**Features**:
- Sector selector dropdown
- Year selector (shows available years)
- Volume Calendar Heatmap - Daily volume intensity

**How to Read**:
- Blue = Low volume
- Green = Medium volume
- Red = High volume
- Click on calendar cells for detailed stats

**Requirements**: Flask API must be running

### 6. 📅 Seasonality

**Purpose**: Identify seasonal patterns in sector performance

**Features**:
- Historical monthly performance for each sector
- Best/Worst months highlighted
- Positive ratio (% of up months)

**How to Use**:
- Green months = Historically strong
- Red months = Historically weak
- Use for timing entries/exits

### 7. ⚠️ Risk Analysis

**Purpose**: Assess sector risk and identify mean reversion opportunities

**Features**:
- **Sector Drawdown Analysis**: Maximum peak-to-trough decline, recovery time, Sharpe ratio
- **Mean Reversion Signals (Z-Score & RSI)**: Overbought/oversold detection

**How to Read**:

**Drawdown**:
- Lower max drawdown = Lower risk
- Faster recovery = More resilient
- Sharpe ratio > 1 = Good risk-adjusted returns

**Mean Reversion**:
- Z-Score > 2 or RSI > 70 = Overbought (may pull back)
- Z-Score < -2 or RSI < 30 = Oversold (may bounce)
- Neutral zone (-1 to +1) = No clear signal

### 8. 🔬 Advanced

**Purpose**: Deep dive analysis with volume-price relationships and relative strength

**Features**:
- **Volume vs Price Divergence Analysis**: Detects bullish/bearish divergences
- **Relative Strength Matrix (vs Market)**: Sector outperformance/underperformance

**How to Read**:

**Divergence**:
- Bullish Divergence: Price falling, volume rising → Potential reversal up
- Bearish Divergence: Price rising, volume falling → Potential reversal down
- Confirmation: Price and volume aligned → Trend likely to continue

**Relative Strength**:
- RS Score > 0: Outperforming market
- RS Score < 0: Underperforming market
- Strong Outperformers: Best for long positions
- RS Momentum: Recent trend in relative strength

**Requirements**: Flask API must be running

### 9. 🔮 Forecast

**Purpose**: AI-powered predictions and outlier analysis

**Features**:
- Sector rotation predictions
- Outlier stocks analysis
- Trend forecasts

## Color Coding Guide

### Performance Colors
- **Green (#22c55e)**: Positive returns, outperformance
- **Red (#ef4444)**: Negative returns, underperformance
- **Yellow/Orange (#f59e0b)**: Neutral/cautionary signals
- **Gray (#8b949e)**: Neutral zone, insufficient data

### Intensity Levels
- Darker colors = Stronger signal
- Lighter colors = Weaker signal

## Keyboard Shortcuts

None currently implemented. Use mouse for all interactions.

## Time Range Selector

Located at top of dashboard:

1. **Custom Range**: Enter number and select unit
   - Example: `3` + `Months` = Last 3 months

2. **Quick Filters**:
   - `YTD` = Year to Date
   - `Go` button = Apply custom range

## Data Filtering

The dashboard filters data based on selected time range:
- **timeSeriesPoints**: Number of data points per sector
- **heatmapPoints**: Number of monthly data points
- **quarterlyPoints**: Number of quarterly data points

## API Integration

### For Volume Data

Start the API server:
```bash
python sector_contributors_api.py
```

The following endpoints are available:

1. **Get available sectors**:
   ```
   GET http://localhost:5555/api/sectors
   ```

2. **Get volume data for a sector**:
   ```
   GET http://localhost:5555/api/sector-volume?sector=Metals&range=2y
   ```

3. **Get volume data for all sectors**:
   ```
   GET http://localhost:5555/api/all-sectors-volume?range=2y
   ```

**Supported ranges**: `1m`, `3m`, `6m`, `1y`, `2y`, `3y`, `5y`

## Troubleshooting

### No data showing
- Ensure `rotation_dashboard_data.json` exists
- Check browser console for errors (F12)
- Verify JSON file is not corrupted

### Volume features not working
- Check if Flask API is running on port 5555
- Look for CORS errors in browser console
- Verify API endpoints are accessible

### NaN or Infinity values
- Refresh the page
- Check browser console for error messages
- Data may be loading - wait a few seconds

### Charts not rendering
- Clear browser cache
- Try a different browser
- Check if all JS files are loaded (Network tab in DevTools)

## Sectors Tracked

The dashboard tracks the following 15 sectors:

1. Finance
2. Technology
3. Energy
4. Automotive
5. Pharma (Pharmaceuticals)
6. Consumer (Consumer Durables)
7. Infrastructure
8. Metals
9. FMCG (Fast Moving Consumer Goods)
10. Healthcare
11. Telecom
12. Chemicals
13. OilGas (Oil & Gas)
14. Power
15. RealEstate (Real Estate)

## Tips for Traders

### 1. Sector Rotation Strategy
- Use the **Rotation Heatmap** to identify which sectors are gaining/losing strength
- Look for sectors moving from red (bottom) to green (top) over consecutive months
- Enter positions when sector shows consistent improvement over 2-3 months

### 2. Pair Trading
- Use **Correlation** tab to find negatively correlated sectors
- Go long on strong sector, short on weak sector
- Close positions when correlation reverts to mean

### 3. Momentum Trading
- Focus on **Momentum** tab
- Target top 3 sectors with strong 3M and 6M momentum
- Exit when momentum drops below 1M

### 4. Mean Reversion
- Use **Risk Analysis** → Mean Reversion Signals
- Buy oversold sectors (Z-Score < -2, RSI < 30)
- Sell overbought sectors (Z-Score > 2, RSI > 70)
- Use position sizing based on volatility

### 5. Diversification
- Use **Correlation** → Dendrogram
- Pick sectors from different clusters
- Avoid picking multiple sectors from the same cluster

### 6. Volume Confirmation
- Use **Volume** tab to check if price moves are supported by volume
- High volume + Price up = Strong uptrend
- Low volume + Price up = Weak uptrend (potential reversal)

### 7. Seasonal Patterns
- Use **Seasonality** tab to identify favorable months
- Enter positions at start of historically strong months
- Exit or reduce positions before historically weak months

## Data Refresh

The dashboard uses static JSON data. To update:

### Method 1: Run the Data Generator Script

```bash
cd /Users/developer/Documents/algos/personal/earner
python scanners/enhanced_sector_rotation_analyzer.py
```

This script will:
1. Fetch 5 years of historical data from Upstox API
2. Calculate sector rankings, correlations, and quarterly data
3. Generate `rotation_dashboard_data.json` in the `historical_sector_cycles/` directory
4. Display summary statistics

**Output**:
```
📊 Fetching 5 years of historical data from Upstox...
  📈 Finance... ✅ 5 stocks, 1248 days
  📈 Technology... ✅ 5 stocks, 1248 days
  ...

✅ Dashboard data saved to historical_sector_cycles/rotation_dashboard_data.json

📊 Current Sector Performance (3M):
  Metals: +15.2%
  Telecom: +12.8%
  ...
```

### Method 2: Customize Data Range

Edit the `enhanced_sector_rotation_analyzer.py` script:

```python
# Line ~170, change the years parameter
if __name__ == '__main__':
    analyzer = SectorRotationAnalyzer()
    analyzer.run(years=5)  # Change to 3, 5, 7, etc.
```

### Method 3: Manual Refresh

After running the script:
1. Go to your browser
2. Press `F5` or `Ctrl+R` (Windows/Linux) / `Cmd+R` (Mac) to refresh
3. The dashboard will load the updated data

### Data Update Frequency

Recommended update frequency:
- **Daily**: For active traders (run script after market close)
- **Weekly**: For swing traders
- **Monthly**: For long-term investors

### Troubleshooting Data Updates

**Issue**: Script fails with API error
```bash
# Solution: Check Upstox credentials
# File: upstox_trader/config_and_utils/
# Ensure API keys are valid
```

**Issue**: No data for certain sectors
```bash
# Solution: Check SECTOR_REPRESENTATIVES list
# Some stocks may be delisted or renamed
# Edit the script to add new symbols
```

**Issue**: Dashboard shows old data after refresh
```bash
# Solution: Clear browser cache
# Chrome: Ctrl+Shift+R (hard refresh)
# Or clear cache in DevTools (F12) → Application → Clear storage
```

## Technical Details

### File Structure
```
historical_sector_cycles/
├── dashboard-modular.html          # Main HTML file
├── dashboard-ui.js                  # UI controller
├── dashboard-data-processor.js      # Data processing logic
├── dashboard-chart-utils.js         # Chart utilities
├── charts/                          # Modular chart components
│   ├── performance-chart.js
│   ├── momentum-chart.js
│   ├── timeline-chart.js
│   ├── rotation-heatmap.js
│   ├── rotation-timeline-chart.js
│   ├── correlation-chart.js
│   ├── rotation-pairs-chart.js
│   ├── momentum-detail-chart.js
│   ├── volume-calendar-chart.js
│   ├── seasonality-chart.js
│   ├── drawdown-chart.js
│   ├── mean-reversion-chart.js
│   ├── volume-price-divergence-chart.js
│   ├── relative-strength-chart.js
│   └── correlation-dendrogram-chart.js
└── sector_contributors_api.py      # Flask API for volume data
```

### Browser Compatibility
- Chrome/Edge: Best experience
- Firefox: Good support
- Safari: Good support
- Requires ES6+ support

### Performance
- Optimized for 5 years of daily data
- Loads in ~1-2 seconds
- Renders charts using D3.js v7

## Support

For issues or questions:
1. Check browser console (F12) for error messages
2. Verify all files are present and correctly named
3. Ensure JSON data file is valid
4. Check Flask API if using volume features

## Version History

### v2.0 (Current)
- Added Seasonality Analysis
- Added Risk Analysis (Drawdown, Mean Reversion)
- Added Advanced Analysis (Volume-Price Divergence, Relative Strength)
- Added Correlation Dendrogram
- Fixed NaN/Infinity issues
- Improved data validation

### v1.0
- Initial release
- Overview, Rotation, Correlation, Momentum views
- Basic Forecast tab
