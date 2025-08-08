# Upstox API V3 Historical Candle Data - Complete Documentation

## Overview

The Upstox Historical Candle Data API V3 provides OHLC (Open, High, Low, Close) data for financial instruments across multiple timeframes with enhanced flexibility compared to the standard API. It allows custom time intervals for each unit and is designed to handle large volumes of data efficiently.

## Key Features

- **Custom Intervals**: Unlike the standard API, V3 allows custom intervals within each unit
- **Multiple Timeframes**: Support for minutes, hours, days, weeks, and months
- **Historical Depth**: Data availability varies by unit (from January 2000 to January 2022)
- **Efficient Handling**: Designed for large volume data requests with quick response times
- **Consistent Format**: Maintains compatibility with existing applications

## API Endpoint

```
GET /v3/historical-candle/{instrument_key}/{unit}/{interval}/{to_date}/{from_date}
```

### Base URL
```
https://api.upstox.com/v3
```

## Supported Units and Intervals

| Unit | Interval Options | Historical Availability | Max Retrieval Limit |
|------|-----------------|------------------------|-------------------|
| **minutes** | 1, 2, 3, ..., 300 | January 2022 onwards | • 1 month (intervals 1-15 min)<br>• 1 quarter (intervals >15 min) |
| **hours** | 1, 2, 3, 4, 5 | January 2022 onwards | 1 quarter leading up to to_date |
| **days** | 1 | January 2000 onwards | 1 decade leading up to to_date |
| **weeks** | 1 | January 2000 onwards | No limit |
| **months** | 1 | January 2000 onwards | No limit |

## Critical Limitations for 1H Data

### 🚨 **1H (Hourly) Data Constraints**
- **Available Since**: January 2022 only (NOT historical like daily data)
- **Maximum Range**: 1 quarter (3 months) leading up to to_date
- **Intervals Supported**: 1, 2, 3, 4, 5 hours
- **Real Impact**: For 365-day backtests, 1H data is insufficient due to the 3-month limit

### Why 1H Backtests Fail for Long Periods
```python
# This will FAIL for 365 days because:
# - 1H data only goes back 3 months maximum
# - January 2022 start date means limited historical depth
fetch_data(symbol="RELIANCE", days=365, timeframe="1H")  # ❌ Will only get ~90 days

# This works because 15min has better availability:
fetch_data(symbol="RELIANCE", days=365, timeframe="15min")  # ✅ Works with chunking
```

## Parameters

### Header Parameters
| Name | Required | Type | Description |
|------|----------|------|-------------|
| Accept | Yes | string | Must be `application/json` |
| Authorization | Yes | string | Bearer token |

### Path Parameters
| Name | Required | Type | Description |
|------|----------|------|-------------|
| instrument_key | Yes | string | Unique identifier (e.g., `NSE_EQ\|INE002A01018`) |
| unit | Yes | string | `minutes`, `hours`, `days`, `weeks`, `months` |
| interval | Yes | string | Numeric interval (see table above) |
| to_date | Yes | string | End date in `YYYY-MM-DD` format |
| from_date | No | string | Start date in `YYYY-MM-DD` format |

## Response Format

### Successful Response (200)
```json
{
  "status": "success",
  "data": {
    "candles": [
      [
        "2025-01-01T00:00:00+05:30",  // Timestamp
        53.1,                         // Open
        53.95,                        // High
        51.6,                         // Low
        52.05,                        // Close
        235519861,                    // Volume
        0                             // Open Interest
      ]
    ]
  }
}
```

### Candle Array Structure
| Index | Field | Type | Description |
|-------|-------|------|-------------|
| [0] | Timestamp | string | ISO format with timezone |
| [1] | Open | number | Opening price |
| [2] | High | number | Highest price |
| [3] | Low | number | Lowest price |
| [4] | Close | number | Closing price |
| [5] | Volume | number | Trading volume |
| [6] | Open Interest | number | Outstanding contracts |

## Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| UDAPI1021 | Invalid instrument key format | Check instrument key pattern |
| UDAPI1022 | to_date is required | Always provide to_date |
| UDAPI100011 | Invalid instrument key | Verify key exists in system |
| UDAPI1015 | Invalid date format/range | Use YYYY-MM-DD, ensure to_date >= from_date |
| UDAPI1146 | Invalid unit | Use: minutes/hours/days/weeks/months |
| UDAPI1147 | Invalid interval | Check interval limits for each unit |
| UDAPI1148 | Invalid date range | Respect historical availability limits |

## Usage Examples

### 1. Fetching 1H Data (Limited Range)
```python
import requests

# ✅ This works - 1H data for 2 months
url = "https://api.upstox.com/v3/historical-candle/NSE_EQ|INE002A01018/hours/1/2025-07-20/2025-05-20"
headers = {
    "Accept": "application/json",
    "Authorization": "Bearer YOUR_ACCESS_TOKEN"
}
response = requests.get(url, headers=headers)
```

### 2. Fetching 15min Data (Extended Range)
```python
# ✅ This works - 15min data for longer periods with chunking
url = "https://api.upstox.com/v3/historical-candle/NSE_EQ|INE002A01018/minutes/15/2025-07-20/2025-04-20"
response = requests.get(url, headers=headers)
```

### 3. Daily Data (Maximum Historical Depth)
```python
# ✅ This works - Daily data since 2000
url = "https://api.upstox.com/v3/historical-candle/NSE_EQ|INE002A01018/days/1/2025-07-20/2020-01-01"
response = requests.get(url, headers=headers)
```

## Best Practices for Different Timeframes

### For 1H Analysis (Limited Historical Data)
```python
def fetch_1h_data_safely(symbol, max_days=90):
    """
    Fetch 1H data with proper constraints
    Max 90 days due to API limitations
    """
    if max_days > 90:
        print("⚠️ 1H data limited to 90 days maximum")
        max_days = 90
    
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=max_days)).strftime('%Y-%m-%d')
    
    return fetch_historical_data_v3(symbol, "hours", 1, to_date, from_date)
```

### For Extended Historical Analysis
```python
def fetch_extended_historical_data(symbol, days=365):
    """
    Use 15min or daily data for long-term analysis
    """
    if days <= 90:
        # Use 15min for better granularity
        return fetch_data(symbol, days, "15min")
    else:
        # Use daily for extended periods
        return fetch_data(symbol, days, "1D")
```

## Chunking Strategy for Large Requests

For requests exceeding limits, implement chunking:

```python
def fetch_with_chunking(symbol, unit, interval, days, chunk_size=30):
    """
    Fetch data in chunks to respect API limits
    """
    all_data = []
    current_date = datetime.now()
    
    while days > 0:
        chunk_days = min(days, chunk_size)
        to_date = current_date.strftime('%Y-%m-%d')
        from_date = (current_date - timedelta(days=chunk_days)).strftime('%Y-%m-%d')
        
        chunk_data = fetch_historical_data_v3(symbol, unit, interval, to_date, from_date)
        if chunk_data:
            all_data.append(chunk_data)
        
        current_date -= timedelta(days=chunk_days)
        days -= chunk_days
    
    return combine_chunks(all_data)
```

## Recommended Timeframe Selection

| Use Case | Recommended Timeframe | Max Historical Period | Reason |
|----------|----------------------|----------------------|---------|
| **Scalping/Day Trading** | 1min, 5min | 15-30 days | High frequency, recent data |
| **Swing Trading** | 15min, 30min | 3-6 months | Good balance of detail/range |
| **Position Trading** | 1H, 4H | 1-2 years | ⚠️ Use 15min instead of 1H for >3 months |
| **Long-term Analysis** | Daily | 10+ years | Maximum historical depth |
| **Walk-forward Analysis** | 15min or Daily | 1+ years | Avoid 1H for extended periods |

## Integration with VectorBT

### Working Configuration
```python
# ✅ This configuration works for 365-day analysis
def run_vectorbt_walkforward_365_days():
    return run_walk_forward_analysis(
        symbol="RELIANCE",
        timeframe="15min",      # Not 1H!
        train_period=45,
        test_period=15,
        total_periods=12,
        optimize_params=True
    )
```

### Why 1H Fails in Walk-Forward
```python
# ❌ This fails because:
# - 365 days * 12 periods = need 4+ years of data
# - 1H data only available for 3 months maximum
# - API returns insufficient data for analysis

def failed_1h_analysis():
    return run_walk_forward_analysis(
        symbol="RELIANCE", 
        timeframe="1H",         # Limited to 90 days
        train_period=120,       # Needs 120 days training
        test_period=40,         # Plus 40 days testing
        total_periods=6         # = 960 days total required
    )
    # Result: "No equity curves generated - insufficient data"
```

## Migration Guide

### From Standard API to V3
1. **URL Change**: `/historical-candle/` → `/v3/historical-candle/`
2. **Custom Intervals**: Now supports intervals like 2, 3, 7, etc.
3. **Same Response Format**: No changes needed in parsing logic

### From 1H to 15min for Extended Analysis
```python
# Old approach (fails for long periods)
old_config = {
    "timeframe": "1H",
    "train_period": 120,
    "test_period": 40
}

# New approach (works reliably)
new_config = {
    "timeframe": "15min",
    "train_period": 45,    # Reduced due to more data points
    "test_period": 15,     # Proportionally adjusted
    "total_periods": 12    # More periods for same coverage
}
```

## Troubleshooting

### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|---------|
| "No data available" | 1H request > 3 months | Use 15min or daily timeframe |
| "Invalid date range" | Requesting data before Jan 2022 for 1H | Use daily for historical data |
| "Insufficient data for analysis" | Walk-forward needs more data than available | Reduce analysis period or change timeframe |
| Empty response | Invalid instrument key | Verify symbol format and existence |

### Debug Commands
```bash
# Test different timeframes to find what works
python vectorbt_walkforward_analysis.py --timeframe 15min --train-period 30 --test-period 10 --total-periods 4
python vectorbt_walkforward_analysis.py --timeframe 1D --train-period 60 --test-period 20 --total-periods 6
```

## Official Resources

- **Main Documentation**: https://upstox.com/developer/api-documentation/v3/get-historical-candle-data
- **Examples**: https://upstox.com/developer/api-documentation/example-code/historical-data/v3/historical-candle-data
- **Intraday API**: https://upstox.com/developer/api-documentation/v3/get-intra-day-candle-data
- **Developer Portal**: https://upstox.com/developer/

## 🔑 Instrument Key Mapping - Critical Implementation Details

### **NSE Instrument Master Data**

#### **Download URL**
```
https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
```

#### **Key Features**
- **61,667+ instruments** (includes F&O, equity, currency derivatives)
- **8,016 NSE equity instruments** specifically 
- **Daily refresh** at ~6 AM
- **Gzipped JSON format** - requires decompression
- **No authentication** required for download

#### **Critical Data Structure**
```json
{
  "weekly": false,
  "segment": "NSE_EQ",
  "name": "RELIANCE INDUSTRIES LTD", 
  "exchange": "NSE",
  "instrument_type": "EQ",
  "tradingsymbol": "RELIANCE",
  "instrument_key": "NSE_EQ|INE002A01018",
  "lot_size": 1,
  "isin": "INE002A01018"
}
```

#### **Working Implementation**
```python
import requests
import gzip  
import json

def load_nse_instruments():
    """Load NSE equity instruments with proper mapping"""
    url = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
    response = requests.get(url, timeout=30)
    
    if response.status_code == 200:
        # Decompress gzipped content
        decompressed_data = gzip.decompress(response.content)
        instruments_data = json.loads(decompressed_data.decode('utf-8'))
        
        # Create symbol → instrument_key mapping
        mapping = {}
        for instrument in instruments_data:
            if (instrument.get('segment') == 'NSE_EQ' and 
                instrument.get('instrument_type') == 'EQ'):
                
                symbol = instrument.get('tradingsymbol', '')
                key = instrument.get('instrument_key', '')
                
                if symbol and key:
                    mapping[symbol] = {
                        'instrument_key': key,
                        'name': instrument.get('name', ''),
                        'isin': instrument.get('isin', ''),
                        'lot_size': instrument.get('lot_size', 1)
                    }
        
        return mapping
    return {}

# Usage
instruments = load_nse_instruments()
reliance_key = instruments['RELIANCE']['instrument_key']  # NSE_EQ|INE002A01018
```

#### **Common Symbol Variations**
Many TradingView symbols don't match Upstox exactly:
```python
def get_instrument_key(symbol, mapping):
    """Handle symbol variations"""
    if symbol in mapping:
        return mapping[symbol]['instrument_key']
    
    # Try common variations
    variations = [
        symbol.replace('&', '_'),    # M&M → M_M (doesn't work)
        symbol.replace('-', ''),     # Remove hyphens  
        symbol.upper(),
        symbol.replace('.', '')      # Remove dots
    ]
    
    for variation in variations:
        if variation in mapping:
            return mapping[variation]['instrument_key']
    
    return None
```

#### **Performance Notes**
- **Initial load**: ~2-3 seconds for 61K+ instruments
- **Memory usage**: ~50MB for full mapping
- **Cache locally** for production use
- **Update daily** to get new listings

### **Proper API Usage with Instrument Keys**

#### **Before (Wrong)**
```python
# ❌ This fails with UDAPI100011 error
symbol = "RELIANCE"
instrument_key = f"NSE_EQ|{symbol}"  # Invalid format
url = f"https://api.upstox.com/v3/historical-candle/{instrument_key}/days/1/{to_date}/{from_date}"
```

#### **After (Correct)**
```python  
# ✅ This works with proper mapping
symbol = "RELIANCE"
instruments = load_nse_instruments()
instrument_key = instruments[symbol]['instrument_key']  # NSE_EQ|INE002A01018
url = f"https://api.upstox.com/v3/historical-candle/{instrument_key}/days/1/{to_date}/{from_date}"
```

#### **Error Handling**
```python
def fetch_historical_data_safe(symbol, days=365):
    """Safe historical data fetching with proper error handling"""
    instruments = load_nse_instruments()
    
    instrument_key = get_instrument_key(symbol, instruments)
    if not instrument_key:
        print(f"❌ No instrument key found for {symbol}")
        return pd.DataFrame()
    
    try:
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        
        url = f"https://api.upstox.com/v3/historical-candle/{instrument_key}/days/1/{to_date}/{from_date}"
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}"
        }
        
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            data = response.json()
            if data.get('status') == 'success':
                candles = data['data']['candles']
                df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi'])
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                return df
        
        print(f"❌ API error {response.status_code}: {response.text}")
        return pd.DataFrame()
        
    except Exception as e:
        print(f"❌ Exception: {e}")
        return pd.DataFrame()
```

---

## Summary

**✅ For 365-day backtests**: Use `15min` or `daily` timeframes
**❌ Avoid 1H for extended periods**: Limited to 3-month historical data  
**🔧 Optimal Configuration**: 15min with chunking for the best balance of granularity and historical depth
**🔑 Critical**: Always use proper instrument key mapping from NSE master data - never assume symbol format
