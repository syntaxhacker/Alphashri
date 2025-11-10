# 📊 Sector Analysis Directory

This directory contains specialized tools for sector-based market analysis and correlation studies.

## 📁 Directory Structure

```
sector_analysis/
├── README.md                           # This file
├── sector_covariance_analyzer.py       # Main sector correlation analyzer
├── sector_momentum_analyzer.py         # Sector momentum analysis tool
├── visualizations/                     # Generated visualization files
│   ├── sector_correlation_heatmap_*.png
│   ├── sector_network_graph_*.png
│   ├── correlation_distribution_*.png
│   └── *stock_correlations_*.png
└── outputs/                           # Analysis output files
    ├── *_analysis_*.csv
    └── *_watchlist_*.csv
```

## 🛠️ Tools Overview

### **sector_covariance_analyzer.py**
Advanced sector correlation analysis tool that:
- **Calculates correlations** between 19 NSE sectors
- **Generates visualizations** (heatmaps, network graphs, distributions)
- **Predicts stock movements** based on sector triggers
- **Real-time monitoring** for intraday opportunities
- **Lead-lag relationship** identification

### **sector_momentum_analyzer.py**
Sector momentum analysis and rotation strategies:
- **Sector rotation** detection
- **Momentum ranking** across sectors
- **Relative strength** analysis
- **Sector breadth** indicators

## 🚀 Quick Start

### Generate Visualizations
```bash
cd upstox_trader/sector_analysis
python sector_covariance_analyzer.py --generate-images --lookback-days 90
```

### Run Full Analysis
```bash
python sector_covariance_analyzer.py --analyze-sectors
```

### Generate Predictions
```bash
python sector_covariance_analyzer.py --predict-stocks --trigger-sector "Technology Services" --trigger-movement 3.5
```

## 📊 Generated Visualizations

### 1. **Sector Correlation Heatmap**
- **File:** `sector_correlation_heatmap_*.png`
- **Size:** ~800KB high-resolution matrix
- **Shows:** All sector-to-sector correlations
- **Colors:** Red (negative) to Blue (positive)

### 2. **Sector Network Graph**
- **File:** `sector_network_graph_*.png`
- **Size:** ~2.5MB detailed network
- **Shows:** Sector relationships as connected nodes
- **Features:** Node size = market cap, line thickness = correlation

### 3. **Correlation Distribution**
- **File:** `correlation_distribution_*.png`
- **Size:** ~225KB histogram
- **Shows:** Distribution of correlation strengths
- **Includes:** Statistical summary (mean, median, std dev)

### 4. **Stock Correlation Heatmaps**
- **Files:** `{sector}_stock_correlations_*.png`
- **Size:** ~300-360KB per sector
- **Shows:** Stock-to-stock correlations within each sector
- **Coverage:** Top 5 sectors (Finance, Technology, Energy, etc.)

## 📈 Key Features

✅ **19 Sector Coverage** - Complete NSE sector analysis
✅ **High-Resolution Images** - 300 DPI for presentations
✅ **Dark Theme** - Professional appearance
✅ **Multiple Visualization Types** - Heatmaps, networks, distributions
✅ **Real-time Monitoring** - Intraday sector alerts
✅ **Stock Predictions** - Correlation-based trading signals
✅ **Lead-Lag Analysis** - Identify which sectors lead others

## 🎯 Trading Applications

### **Sector Rotation Strategy**
- Monitor sector correlations for rotation opportunities
- Use network graphs to identify leading sectors
- Generate stock watchlists based on sector predictions

### **Risk Management**
- Diversify across uncorrelated sectors
- Use correlation analysis for portfolio construction
- Monitor sector breadth for market timing

### **Intraday Trading**
- Real-time sector monitoring for quick opportunities
- Correlation-based entries when sectors move
- Stock selection within moving sectors

## 📋 Requirements

- **Python packages:** pandas, numpy, matplotlib, seaborn, networkx, rich
- **API access:** Upstox V3 API (for historical data)
- **Browser login:** TradingView (for live sector data)
- **Memory:** ~200MB for full analysis
- **Time:** 2-3 minutes for complete analysis

## 🔧 Configuration

1. **Upstox API:** Set `access_token` in `../config.py`
2. **TradingView:** Login in browser for live data access
3. **Dependencies:** Install required packages from `../requirements.txt`

## 📊 Output Organization

- **Visualizations:** Saved in `visualizations/` subdirectory
- **Analysis:** CSV files in `outputs/` subdirectory
- **Timestamps:** All files include date/time stamps
- **High Resolution:** All images at 300 DPI for quality

## 🚨 Important Notes

- **Data Sources:** Combines TradingView sector data + Upstox historical prices
- **Real-time Data:** Requires active TradingView session
- **Historical Depth:** Uses 60-120 days for current market conditions
- **Correlations:** Minimum 0.3 threshold for significant relationships
- **Sectors:** 19 NSE sectors with 500+ stocks analyzed

## 📚 Related Files

- **`../config.py`** - API configuration and credentials
- **`../requirements.txt`** - Python dependencies
- **`../upstox_trader/`** - Main trading analysis directory
- **`../docs/sector.md`** - Detailed sector analysis documentation

---

**💡 Pro Tip:** Use `--generate-images` for presentations and reports. The visualizations are optimized for both screen viewing and printing.