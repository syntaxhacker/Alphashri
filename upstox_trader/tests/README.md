# TV Modes Testing Suite

Comprehensive test suite for `screeners/tv_modes.py` module with historical data validation and best practices.

## 🗂️ Test Structure

```
tests/
├── conftest.py                 # Pytest configuration and fixtures
├── requirements.txt           # Test dependencies
├── test_runner.py            # Main test runner script
├── README.md                 # This file
├── unit/                     # Fast, isolated unit tests
│   ├── test_tv_modes_helpers.py     # Test helper functions
│   └── test_tv_modes_functions.py   # Test main functions
├── integration/              # Slower tests with real data
│   └── test_historical_data_validation.py
└── fixtures/                 # Test data and mocks
    ├── __init__.py
    ├── historical_data_fetcher.py    # Generate historical data
    ├── mock_factories.py             # Data factories
    └── data_cache/                   # Cached historical data
        ├── nifty50_historical.pkl
        └── test_scenarios.pkl
```

## 🚀 Quick Start

### Run Default Tests
```bash
python tests/test_runner.py
```

### Install Dependencies Only
```bash
python tests/test_runner.py --install
```

### Run Specific Test Types
```bash
# Unit tests only (fast)
python tests/test_runner.py --unit

# Integration tests only
python tests/test_runner.py --integration

# All tests with coverage
python tests/test_runner.py --all

# Quick validation (recommended)
python tests/test_runner.py --quick
```

## 📊 Test Categories

### Unit Tests (`tests/unit/`)
- **Fast execution** (< 1 second per test)
- **Isolated** - no external dependencies
- **Mocked data** - using factories and fixtures
- **High coverage** - test all code paths

**Files:**
- `test_tv_modes_helpers.py` - Helper function tests
- `test_tv_modes_functions.py` - Main function tests

### Integration Tests (`tests/integration/`)
- **Real data validation** - using historical market data
- **End-to-end scenarios** - complete function workflows
- **Performance testing** - large dataset handling
- **Edge case validation** - extreme market conditions

**Files:**
- `test_historical_data_validation.py` - Historical data integration tests

## 📈 Historical Data Testing

The test suite includes comprehensive historical data validation:

### Generated Data
- **50 Nifty stocks** - 365 days of daily data
- **1-minute intraday data** - for recent trading sessions
- **Realistic patterns** - volatility, volume, price movements
- **Business days only** - excludes weekends and holidays

### Test Scenarios
- **Breakout patterns** - stocks breaking out of consolidation
- **Gap up scenarios** - morning gap ups with follow-through
- **Accumulation patterns** - gradual volume increase
- **High volume breakouts** - institutional interest
- **Oversold bounce** - recovery from oversold conditions

### Data Quality Validation
- ✅ OHLC relationship consistency (High ≥ Low, etc.)
- ✅ Positive prices and reasonable price movements
- ✅ Volume consistency and realistic patterns
- ✅ Time series ordering and business day alignment
- ✅ No missing or corrupted data points

## 🔧 Test Configuration

### Pytest Configuration (`pytest.ini`)
```ini
[tool:pytest]
testpaths = tests
addopts = -v --cov=screeners --cov-report=html --cov-fail-under=80
markers =
    unit: Fast unit tests
    integration: Integration tests with real data
    slow: Slow running tests
    historical_data: Tests requiring historical market data
    performance: Performance and scalability tests
```

### Test Fixtures (`conftest.py`)
- `mock_tv_screener_usage` - Mock TVScreenerUsage instance
- `sample_stock_data` - Realistic stock data samples
- `historical_data_cache` - Cached historical data
- `mock_tradingview_query` - Mock TradingView responses
- `real_nifty50_data` - Real Nifty 50 symbols

## 📋 Test Coverage

### Helper Functions
- ✅ `_calculate_basic_momentum_metrics`
- ✅ `_calculate_intraday_momentum_metrics`
- ✅ `_add_heavy_breakout_analysis`
- ✅ `_add_intraday_momentum_analysis`
- ✅ `_analyze_sector_correlations`

### Main Functions
- ✅ `pre_breakout_accumulation`
- ✅ `early_momentum_detection`
- ✅ `heavy_breakout`
- ✅ `intraday_high_volume_breakouts`
- ✅ `intraday_gap_up_stocks`
- ✅ `gap_fill_trading_strategy`
- ✅ `research_sector_performance`
- ✅ `intraday_watch_mode`
- ✅ `optimized_gap_strategy_15min`
- ✅ `swing_bullish_reversal`
- ✅ `swing_breakout_consolidation`
- ✅ `invest_quality_growth`
- ✅ `invest_dividend_aristocrats`

### Edge Cases
- ✅ Empty DataFrames
- ✅ Missing columns
- ✅ Extreme values (inf, nan)
- ✅ API failures
- ✅ Network timeouts
- ✅ Low liquidity stocks
- ✅ Circuit limit conditions

## 🎯 Testing Best Practices

### 1. Test Structure
- **Arrange** - Set up test data and mocks
- **Act** - Execute the function under test  
- **Assert** - Verify expected outcomes

### 2. Data Validation
- Test with **realistic market data**
- Validate **edge cases and extremes**
- Ensure **data consistency** across time series
- Test **performance with large datasets**

### 3. Mocking Strategy
- Mock **external API calls** (TradingView)
- Use **factories for data generation**
- Create **predictable test scenarios**
- Avoid **side effects** in unit tests

### 4. Coverage Goals
- **80%+ code coverage** required
- **100% function coverage** for main functions
- **Edge case coverage** for error conditions
- **Integration coverage** for end-to-end flows

## 📊 Performance Benchmarks

### Unit Tests
- **Target**: < 1 second total execution
- **Individual tests**: < 100ms each
- **Memory usage**: < 100MB total

### Integration Tests  
- **Historical data loading**: < 5 seconds
- **Large dataset processing** (500+ stocks): < 30 seconds
- **Memory efficiency**: No memory leaks in repeated runs

### Coverage Requirements
- **Minimum**: 80% line coverage
- **Target**: 90%+ line coverage
- **Function coverage**: 100% of public functions

## 🐛 Debugging Failed Tests

### Common Issues
1. **Import errors** - Check Python path and module structure
2. **Missing dependencies** - Run `--install` first
3. **Data generation failures** - Check disk space and permissions
4. **API mock failures** - Verify mock setup in conftest.py

### Debug Commands
```bash
# Verbose output with stack traces
python -m pytest tests/ -v --tb=long

# Run specific test
python -m pytest tests/unit/test_tv_modes_helpers.py::TestHelperFunctions::test_calculate_basic_momentum_metrics -v

# Debug with print statements
python -m pytest tests/ -v -s

# Run with debugger
python -m pytest tests/ --pdb
```

## 📈 Continuous Integration

### Pre-commit Hooks (Recommended)
```bash
# Install pre-commit
pip install pre-commit

# Add to .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: tv-modes-tests
        name: TV Modes Tests
        entry: python tests/test_runner.py --quick
        language: system
        pass_filenames: false
```

### GitHub Actions (Example)
```yaml
name: TV Modes Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      - name: Run tests
        run: python tests/test_runner.py --all
```

## 🔍 Test Data Management

### Cached Data Location
- `tests/fixtures/data_cache/`
- Automatically generated on first run
- ~50MB total size for full historical data

### Regenerating Test Data
```bash
# Delete cache and regenerate
rm -rf tests/fixtures/data_cache/
python tests/fixtures/historical_data_fetcher.py
```

### Custom Test Scenarios
```python
# Add to mock_factories.py
def create_custom_scenario():
    return pd.DataFrame({
        'name': ['CUSTOM_STOCK'],
        'close': [100],
        # ... your custom data
    })
```

## 📚 References

- [pytest documentation](https://docs.pytest.org/)
- [pandas testing utilities](https://pandas.pydata.org/docs/reference/general.html#testing)
- [factory-boy for test data](https://factoryboy.readthedocs.io/)
- [TradingView Screener API](https://github.com/shayneobrien/tradingview-screener)

## 🤝 Contributing

1. **Add tests** for any new functions
2. **Maintain 80%+ coverage** 
3. **Follow naming conventions** (`test_function_name_scenario`)
4. **Add fixtures** for reusable test data
5. **Document edge cases** and assumptions
6. **Run full test suite** before committing

---

**Happy Testing! 🧪📈**