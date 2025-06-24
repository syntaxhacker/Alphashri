# 🇮🇳 TATAMOTORS Walk Forward Analysis - Indian Stock Market Edition

## 📊 Overview

This project implements a comprehensive **Walk Forward Analysis** specifically designed for **Indian stocks** using TATAMOTORS as the primary example. The analysis adapts the existing VectorBT crypto infrastructure to work seamlessly with Indian equity markets, incorporating NSE/BSE trading specifics, Indian market hours, and appropriate trading costs.

## 🎯 What Makes This Different from Crypto Analysis?

### **Indian Market Adaptations**
- **Currency**: INR (₹) instead of USD
- **Exchanges**: NSE (.NS) and BSE (.BO) support
- **Trading Hours**: 9:15 AM - 3:30 PM IST
- **Trading Costs**: STT, brokerage, GST, and stamp duty
- **Direction**: Long-only for retail investors (short selling restrictions)
- **Timeframes**: Daily (1d) and hourly (1h) optimized for equity markets

### **Regulatory Considerations**
- **Securities Transaction Tax (STT)**: 0.1% on delivery, 0.025% on intraday
- **Brokerage**: Typically 0.03-0.05% per trade
- **Market Holidays**: Indian calendar integration
- **Position Limits**: Retail investor constraints

## 📁 Files Overview

### 1. **`indian_stock_config.py`** (Configuration Hub)
- **Trading costs**: STT, brokerage, GST calculations
- **Popular stocks**: TATAMOTORS, MARUTI, RELIANCE, etc.
- **Parameter grids**: Optimized for Indian equity volatility
- **Market sessions**: NSE/BSE trading hours
- **Default configs**: Daily and hourly setups

### 2. **`enhanced_data_fetcher.py`** (Modified)
- **Indian symbol support**: Automatic .NS/.BO handling
- **yfinance integration**: Enhanced for Indian stocks
- **Error handling**: Specific messages for Indian market data issues
- **Caching**: Intelligent data storage for faster analysis

### 3. **`vectorbt_tatamotors_analysis.py`** (Core Engine)
- **Walk forward framework**: Adapted for Indian stocks
- **VectorBT integration**: GPU-accelerated backtesting
- **Indian market parameters**: Fees, direction, position sizing
- **Breakout strategy**: Volume-confirmed breakouts for equity markets

### 4. **`test_tatamotors_data.py`** (Data Validation)
- **Symbol testing**: Both NSE and BSE formats
- **Data quality**: OHLCV relationship validation
- **Timeframe testing**: Daily and hourly data verification
- **Cache functionality**: Performance optimization testing

### 5. **`run_tatamotors_walkforward.py`** (Main Runner)
- **Command-line interface**: Easy parameter configuration
- **Multiple modes**: Quick test, standard, and full analysis
- **Flexible configuration**: Symbol, exchange, timeframe options
- **Progress monitoring**: Real-time analysis updates

### 6. **`requirements_indian_stocks.txt`** (Dependencies)
- **Core packages**: VectorBT, pandas, yfinance
- **Visualization**: matplotlib, seaborn, plotly
- **Optional packages**: TA-Lib, quantlib for advanced analysis

## 🚀 Quick Start

### **Installation**
```bash
# Clone the repository
git clone <repository-url>
cd earner

# Install dependencies
pip install -r requirements_indian_stocks.txt

# Verify installation
python test_tatamotors_data.py
```

### **Basic Usage**
```bash
# Run default TATAMOTORS analysis
python run_tatamotors_walkforward.py

# Quick test with limited data
python run_tatamotors_walkforward.py --quick

# Analyze different stock
python run_tatamotors_walkforward.py --symbol MARUTI

# Use BSE instead of NSE
python run_tatamotors_walkforward.py --exchange BSE

# Hourly analysis
python run_tatamotors_walkforward.py --timeframe 1h
```

## 📈 Strategy Details

### **Volume-Confirmed Breakout Strategy (Indian Adaptation)**

```python
# Entry Conditions (Long-only for retail)
if (price > recent_high * (1 + breakout_threshold) AND 
    volume > avg_volume * volume_multiplier):
    ENTER_LONG

# Exit Conditions
- Opposite signal generation
- Time-based exits (5-15 days for daily timeframe)
- Indian market session constraints
```

### **Parameter Optimization for Indian Stocks**
| Parameter | Daily Range | Hourly Range | Description |
|-----------|-------------|--------------|-------------|
| **Lookback** | 5-25 days | 10-30 hours | Breakout detection period |
| **Volume Multiplier** | 1.2-2.5x | 1.5-3.0x | Volume confirmation threshold |
| **Breakout %** | 2-5% | 1.5-2.5% | Price breakout threshold |
| **Max Hold** | 5-15 days | 4-8 hours | Maximum position duration |

### **Indian Market Risk Management**
- **Position Sizing**: Conservative (₹1 Lakh standard)
- **Trading Costs**: Realistic 0.05% for delivery
- **Market Hours**: No overnight positions in intraday mode
- **Holiday Calendar**: Indian market holidays consideration

## 🔧 Configuration Options

### **Predefined Configurations**

#### **TATAMOTORS_DAILY** (Default)
```python
{
    'symbol': 'TATAMOTORS.NS',
    'timeframe': '1d',
    'train_days': 90,      # 3 months training
    'test_days': 30,       # 1 month testing
    'step_days': 15,       # 2 weeks forward step
    'fees': 0.05,          # 0.05% total costs
    'direction': 'longonly',
    'initial_cash': 100000  # ₹1 Lakh
}
```

#### **TATAMOTORS_HOURLY**
```python
{
    'symbol': 'TATAMOTORS.NS',
    'timeframe': '1h',
    'train_hours': 240,    # ~10 trading days
    'test_hours': 80,      # ~3 trading days
    'step_hours': 40,      # ~2 trading days step
    'fees': 0.04,          # 0.04% intraday costs
    'direction': 'longonly',
    'initial_cash': 100000
}
```

## 📊 Analysis Results Interpretation

### **Key Metrics for Indian Stocks**
- **Total Return**: Cumulative strategy performance (in ₹)
- **Sharpe Ratio**: Risk-adjusted returns (adjusted for Indian volatility)
- **Max Drawdown**: Worst peak-to-trough decline
- **Win Rate**: Percentage of profitable periods
- **Trading Frequency**: Trades per month (Indian market context)

### **Walk Forward Configuration**
- **Training Period**: 90 days (quarterly optimization)
- **Testing Period**: 30 days (monthly validation)
- **Step Size**: 15 days (bi-weekly rebalancing)
- **Total Periods**: Typically 12-20 periods for annual analysis

## 🎨 Visualization Dashboard

### **Generated Outputs**
1. **Cumulative Returns**: Strategy vs Buy & Hold comparison
2. **Period Returns**: Win/loss by testing period
3. **Risk-Adjusted Performance**: Sharpe ratio evolution
4. **Parameter Evolution**: How optimal parameters change over time
5. **Trading Activity**: Frequency and efficiency analysis
6. **Return Distribution**: Statistical performance analysis
7. **Indian Market Specifics**: Sector rotation, market regime analysis

### **Sample Dashboard Features**
- **Currency Display**: All values in INR (₹)
- **Market Sessions**: Visual indicators for Indian trading hours
- **Sector Context**: Auto vs broader Indian market performance
- **Regulatory Overlay**: Impact of Indian trading costs

## 🔍 Troubleshooting

### **Common Data Issues**
```bash
# Test data connectivity
python test_tatamotors_data.py

# Check symbol format
# Correct: TATAMOTORS.NS (NSE) or TATAMOTORS.BO (BSE)
# Incorrect: TATAMOTORS, TATA.MOTORS
```

### **Performance Optimization**
```python
# Use VectorBT for speed (if available)
pip install vectorbt

# Enable caching for faster repeated runs
# Cache is automatically managed in 'vectorbt_cache' directory

# For large datasets, consider:
pip install pyarrow  # Faster data I/O
pip install numba    # Numerical optimization
```

### **Memory Management**
- **Daily timeframe**: Can handle 2-3 years of data easily
- **Hourly timeframe**: Recommended 6-12 months maximum
- **Multiple stocks**: Process sequentially for memory efficiency

## 💡 Advanced Usage

### **Custom Stock Analysis**
```python
from vectorbt_tatamotors_analysis import TATAMOTORSWalkForward
from indian_stock_config import get_stock_symbol

# Analyze MARUTI with custom settings
analyzer = TATAMOTORSWalkForward('TATAMOTORS_DAILY')
analyzer.symbol = get_stock_symbol('MARUTI', 'NSE')
analyzer.run_full_analysis(days_back=500)
```

### **Batch Analysis**
```python
# Analyze multiple auto sector stocks
auto_stocks = ['TATAMOTORS.NS', 'MARUTI.NS', 'M&M.NS', 'BAJAJ-AUTO.NS']

for stock in auto_stocks:
    analyzer = TATAMOTORSWalkForward('TATAMOTORS_DAILY')
    analyzer.symbol = stock
    analyzer.run_full_analysis()
```

### **Parameter Sensitivity Analysis**
```python
# Test different training periods
for train_days in [60, 90, 120]:
    config = DEFAULT_CONFIGS['TATAMOTORS_DAILY'].copy()
    config['train_days'] = train_days
    # Run analysis...
```

## 🏦 Indian Market Context

### **Why TATAMOTORS?**
- **Large-cap auto stock**: High liquidity and volume
- **Sector representation**: Auto sector cyclical behavior
- **Data availability**: Consistent historical data
- **Volatility**: Good for breakout strategy testing
- **Market correlation**: Representative of broader Indian market

### **Sector Analysis Extensions**
The framework can be extended to analyze:
- **IT Sector**: TCS, INFY, WIPRO, HCLTECH
- **Banking**: HDFCBANK, ICICIBANK, SBIN
- **FMCG**: HINDUNILVR, ITC, NESTLEIND
- **Pharma**: SUNPHARMA, DRREDDY

### **Market Regime Considerations**
- **Bull Markets**: Higher breakout success rates
- **Bear Markets**: Increased stop-loss frequency
- **Sideways Markets**: Reduced signal generation
- **Event-driven**: Budget, RBI policy, global events

## 🔮 Future Enhancements

### **Planned Features**
1. **Multi-stock portfolio**: Sector rotation strategies
2. **Options strategies**: Limited scope due to retail restrictions
3. **Fundamental filters**: P/E, debt ratios integration
4. **News sentiment**: Event-driven modifications
5. **Real-time alerts**: Live signal generation

### **Technical Improvements**
1. **GPU optimization**: Enhanced VectorBT utilization
2. **Cloud deployment**: AWS/GCP integration
3. **Database storage**: PostgreSQL for large datasets
4. **API integration**: Real-time data feeds
5. **Mobile dashboard**: Responsive visualization

## 📞 Support & Community

### **Documentation**
- **API Reference**: Detailed function documentation
- **Examples**: Jupyter notebooks with use cases
- **Video Tutorials**: Step-by-step walkthroughs
- **FAQ**: Common questions and solutions

### **Contributing**
- **Issues**: Bug reports and feature requests
- **Pull Requests**: Code contributions welcome
- **Testing**: Help with additional stock testing
- **Documentation**: Improvements and translations

## 🎉 Conclusion

The TATAMOTORS Walk Forward Analysis represents a sophisticated adaptation of modern backtesting methodologies to the Indian stock market. By incorporating market-specific parameters, regulatory constraints, and cultural trading patterns, this tool provides Indian investors with a robust framework for strategy development and validation.

**Key Benefits:**
- ✅ **Market-specific**: Designed for Indian equity characteristics
- ✅ **Regulatory compliant**: Incorporates all Indian trading costs
- ✅ **Performance optimized**: VectorBT GPU acceleration
- ✅ **User-friendly**: Rich console interface and visualizations
- ✅ **Extensible**: Easy adaptation to other Indian stocks
- ✅ **Educational**: Demonstrates walk forward methodology

**Perfect for:**
- 📈 **Individual investors**: Portfolio strategy development
- 🏢 **Fund managers**: Systematic strategy research
- 🎓 **Students**: Learning quantitative finance
- 💼 **Consultants**: Client strategy development
- 🔬 **Researchers**: Academic and commercial research

---

*Built with ❤️ for the Indian trading community*

**Disclaimer**: This tool is for educational and research purposes. Past performance does not guarantee future results. Please consult with financial advisors before making investment decisions. 