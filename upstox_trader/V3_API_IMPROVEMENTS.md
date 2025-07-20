# Upstox V3 API Improvements

## Overview

The Upstox API connector has been enhanced to support the V3 intraday candle data API, providing significantly better data coverage and more flexible interval options compared to the previous V2 implementation.

## Key Improvements

### 1. Enhanced Data Coverage
- **V3 API** provides comprehensive intraday data for the current trading day
- **Better reliability** with direct endpoint access
- **No date range limitations** for intraday data

### 2. Flexible Interval Support
The V3 API supports much more granular interval options:

#### Minutes (1-300)
- Any interval from 1 to 300 minutes
- Examples: 1min, 5min, 15min, 30min, 60min, 120min, etc.

#### Hours (1-5)
- 1-hour, 2-hour, 3-hour, 4-hour, 5-hour intervals

#### Days
- 1-day interval

### 3. API Endpoint Structure
**V3 Endpoint Format:**
```
GET /v3/historical-candle/intraday/{instrument_key}/{unit}/{interval}
```

**Example:**
```
GET /v3/historical-candle/intraday/NSE_EQ%7CINE002A01018/minutes/15
```

## Code Changes

### New Method: `fetch_intraday_data_v3()`

```python
def fetch_intraday_data_v3(self, symbol: str, unit: str, interval: int, 
                          instrument_type: str = 'EQ', 
                          expiry_date: Optional[str] = None, 
                          strike_price: Optional[float] = None, 
                          option_type: Optional[str] = None, 
                          exchange: str = 'NSE_EQ') -> Optional[pd.DataFrame]:
```

**Parameters:**
- `symbol`: Stock symbol (e.g., 'TATAMOTORS', 'RELIANCE')
- `unit`: Time unit - 'minutes', 'hours', or 'days'
- `interval`: Interval value based on unit
- `instrument_type`: 'EQ', 'INDEX', 'CE', 'PE'
- `expiry_date`: For options (YYYY-MM-DD format)
- `strike_price`: For options
- `option_type`: 'CE' or 'PE' for options
- `exchange`: Exchange segment (default: 'NSE_EQ')

### Updated Backtest Integration

The `backtest_upstox_strategy.py` has been updated to:
1. **Prioritize V3 API** for intraday data fetching
2. **Automatic fallback** to V2 API if V3 fails
3. **Smart interval mapping** to choose the best API endpoint
4. **Improved data resampling** when needed

## Usage Examples

### Basic V3 API Usage

```python
from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

# Initialize API
api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])

# Fetch 5-minute data
df_5min = api.fetch_intraday_data_v3(symbol="RELIANCE", unit="minutes", interval=5)

# Fetch 15-minute data
df_15min = api.fetch_intraday_data_v3(symbol="TATAMOTORS", unit="minutes", interval=15)

# Fetch 1-hour data
df_1hour = api.fetch_intraday_data_v3(symbol="INFY", unit="hours", interval=1)
```

### Running the Backtest with V3 Improvements

```bash
# Run backtest with 5-minute timeframe
python backtest_upstox_strategy.py --symbol RELIANCE --timeframe 5min --duration 180

# Run backtest with 15-minute timeframe
python backtest_upstox_strategy.py --symbol TATAMOTORS --timeframe 15min --duration 180

# Run backtest with 1-hour timeframe
python backtest_upstox_strategy.py --symbol INFY --timeframe 1H --duration 180
```

### Testing the V3 API

```bash
# Run the test script to verify V3 API functionality
python test_v3_api.py
```

## Data Structure

The V3 API returns data in the following format:

```json
{
  "status": "success",
  "data": {
    "candles": [
      [
        "2025-01-12T15:15:00+05:30",  // Timestamp
        2305.3,                       // Open
        2307.05,                      // High
        2301,                         // Low
        2304.65,                      // Close
        559982,                       // Volume
        0                             // Open Interest
      ]
    ]
  }
}
```

## Error Handling

The implementation includes robust error handling:
- **Token validation** with automatic re-authentication
- **API response validation** 
- **Fallback mechanisms** to V2 API when V3 fails
- **Input validation** for unit/interval combinations
- **Comprehensive error messages** with troubleshooting information

## Benefits for Backtesting

1. **More Data Points**: V3 API provides more comprehensive intraday data
2. **Better Accuracy**: More granular intervals lead to more accurate backtesting
3. **Reduced API Calls**: Single endpoint call vs. multiple chunked calls in V2
4. **Improved Performance**: Faster data fetching and processing
5. **Enhanced Reliability**: Better error handling and fallback mechanisms

## Troubleshooting

### Common Issues

1. **Invalid Interval Error**
   ```
   ❌ Invalid interval '61' for unit 'minutes'. Valid intervals: [1, 2, 3, ..., 300]
   ```
   **Solution**: Use valid intervals as specified in the documentation.

2. **No Data Returned**
   ```
   ⚠️ No intraday data returned for SYMBOL.
   ```
   **Solution**: Check if markets are open or try a different symbol.

3. **Authentication Errors**
   ```
   🟡 Token might be invalid. Re-authenticating...
   ```
   **Solution**: The system will automatically re-authenticate.

### Testing Your Setup

Run the test script to verify everything is working:

```bash
cd upstox_trader
python test_v3_api.py
```

This will test various intervals and provide detailed feedback on the API performance.

## Migration Notes

### From V2 to V3

If you're currently using the old `fetch_historical_data()` method, consider migrating to `fetch_intraday_data_v3()` for intraday data:

**Old (V2):**
```python
df = api.fetch_historical_data(symbol="RELIANCE", interval="15minute", 
                              from_date="2025-01-12", to_date="2025-01-12")
```

**New (V3):**
```python
df = api.fetch_intraday_data_v3(symbol="RELIANCE", unit="minutes", interval=15)
```

### Backward Compatibility

- V2 methods are still available and functional
- Automatic fallback ensures no disruption to existing code
- Both APIs can be used simultaneously

## Future Enhancements

- Support for historical data beyond current trading day in V3
- Additional asset classes (commodities, currencies)
- Real-time data streaming capabilities
- Advanced error recovery mechanisms

---

For questions or issues, refer to the [Upstox API Documentation](https://upstox.com/developer/api-documentation/v3/get-intra-day-candle-data) or check the error messages for troubleshooting guidance.
