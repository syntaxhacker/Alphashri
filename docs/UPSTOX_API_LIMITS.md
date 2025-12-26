# Upstox API Limits & Usage Guide

## 📊 Official API Limits

Based on Upstox official documentation and community reports (as of 2025):

### Symbol/Instrument Limits Per Request

| API Endpoint | Maximum Symbols | Purpose |
|--------------|----------------|---------|
| **LTP (Last Traded Price)** | 500 | Fast price queries |
| **Full Market Quote** | 500 | Complete market data (OHLC, depth, volume) |
| **OHLC Quotes** | 1000 | Historical OHLC data |

### Rate Limits

- **25 requests per second** across all API endpoints combined
- This means minimum ~40ms delay between requests
- Applies to all API calls from your account

### Token Validity

- **24 hours** - OAuth tokens expire daily
- Must re-authenticate once per day
- Token stored in `~/.upstox_token.json`

## 🔑 Symbol Formats

Upstox API supports multiple symbol formats:

### 1. Simple Symbol (NSE Equity)
```
HDFCBANK
TCS
RELIANCE
```

### 2. Exchange:Symbol Format
```
NSE_EQ:HDFCBANK
NSE_EQ:TCS
BSE_EQ:500325
```

### 3. Exchange|ISIN Format (Most Specific)
```
NSE_EQ|INE040A01034  (HDFC Bank ISIN)
NSE_EQ|INE467B01029  (TCS ISIN)
NSE_EQ|INE669E01016  (Reliance ISIN)
```

### 4. Derivatives Format
```
NSE_FO:NIFTY25MAY21600PE
NSE_FO:BANKNIFTY25MAY52000CE
```

## 📡 API Endpoints

### V2 APIs (Current - marked as deprecated, use V3 for new projects)

#### 1. LTP (Last Traded Price)
```
GET https://api.upstox.com/v2/market-quote/ltp
Parameters: symbol (comma-separated)
Response: last_price, instrument_token

Example:
https://api.upstox.com/v2/market-quote/ltp?symbol=NSE_EQ:HDFCBANK,NSE_EQ:TCS
```

#### 2. Full Market Quote
```
GET https://api.upstox.com/v2/market-quote/quotes
Parameters: symbol (comma-separated)
Response: OHLC, market depth, volume, circuit limits, OI

Example:
https://api.upstox.com/v2/market-quote/quotes?symbol=NSE_EQ:HDFCBANK
```

#### 3. OHLC Quotes
```
GET https://api.upstox.com/v2/market-quote/ohlc
Parameters: symbol, interval (1d, I1, I30)
Response: Open, High, Low, Close for the interval

Example:
https://api.upstox.com/v2/market-quote/ohlc?symbol=NSE_EQ:HDFCBANK&interval=1d
```

### V3 APIs (Recommended for new projects)

```
GET https://api.upstox.com/v3/market-quote/ltp
```

V3 adds additional fields like:
- `ltq` (last traded quantity)
- `volume` (volume traded today)
- `cp` (previous day's closing price)

## 🎯 Best Practices

### 1. Batch Your Requests
```python
# ✅ GOOD: Batch multiple symbols in one request
symbols = "HDFCBANK,TCS,RELIANCE,INFY,WIPRO"  # Up to 500
url = f"https://api.upstox.com/v2/market-quote/ltp?symbol={symbols}"

# ❌ BAD: Individual requests for each symbol
for symbol in symbols:
    # 5 separate API calls - wastes rate limit
```

### 2. Choose the Right Endpoint

```python
# For price monitoring (fastest)
LTP API → 500 symbols in ~0.5s

# For complete market data
Full Quote API → 500 symbols with OHLC, depth, volume

# For historical candles
OHLC API → 1000 symbols with interval data
```

### 3. Respect Rate Limits

```python
import time

# Safe approach: 20 requests/second (leaves buffer)
delay = 0.05  # 50ms between requests

for batch in batches:
    response = get_quotes(batch)
    time.sleep(delay)  # Rate limit protection
```

### 4. Handle Token Expiry

```python
# Token expires after 24 hours
# Implement automatic re-authentication

if not auth.validate_token():
    auth.refresh_token()  # Will trigger OAuth flow
```

### 5. Use WebSocket for Real-Time Data

For continuous monitoring, prefer WebSocket over polling:

```python
# ✅ GOOD: WebSocket (real-time push)
ws.subscribe(['NSE_EQ:HDFCBANK', 'NSE_EQ:TCS'])
# Receive updates as they happen

# ❌ BAD: Polling every second
while True:
    price = get_ltp('HDFCBANK')
    time.sleep(1)  # Wastes rate limit
```

## ⚠️ Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `UDAPI1087` | Invalid symbol/instrument_key | Check symbol format |
| `UDAPI100042` | Too many instruments (>500) | Reduce batch size |
| `UDAPI100043` | Too many instruments in LTP | Use max 500 symbols |
| `UDAPI100050` | Invalid/expired token | Re-authenticate |
| `429` | Rate limit exceeded | Add delays between requests |

## 📝 Example: Fetching 1000+ Symbols

```python
def fetch_prices_in_batches(symbols, batch_size=500):
    """Fetch prices for large symbol lists"""

    all_prices = {}

    # Split into batches
    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i+batch_size]
        symbols_str = ",".join(batch)

        url = f"https://api.upstox.com/v2/market-quote/ltp?symbol={symbols_str}"
        response = requests.get(url, headers=headers, timeout=30)

        if response.status_code == 200:
            data = response.json()
            if data['status'] == 'success':
                all_prices.update(data['data'])

        # Rate limit protection: 25 req/s max
        time.sleep(0.05)  # 50ms = 20 req/s (safe margin)

    return all_prices

# Usage
symbols = ["HDFCBANK", "TCS", ...] # 1000+ symbols
prices = fetch_prices_in_batches(symbols, batch_size=500)
# Makes 3 requests total (1000 symbols / 500 per request)
```

## 🔄 API Version Migration

**Current Status (2025):**
- V2 APIs are marked as "Deprecated"
- V3 APIs are recommended for new development
- Both versions currently work

**Migration Path:**
```python
# V2 (deprecated)
url = "https://api.upstox.com/v2/market-quote/ltp?symbol=HDFCBANK"

# V3 (recommended)
url = "https://api.upstox.com/v3/market-quote/ltp?instrument_key=NSE_EQ|INE040A01034"
```

## 📚 Additional Resources

- [Official API Documentation](https://upstox.com/developer/api-documentation/)
- [LTP Quotes V3](https://upstox.com/developer/api-documentation/ltp-v3/)
- [Market Quote V3](https://upstox.com/developer/api-documentation/market-quote/)
- [Upstox Community Forums](https://community.upstox.com/)

## 💡 Summary

**Maximum Capacity Per API Call:**
- ✅ LTP API: **500 stocks** at once
- ✅ Full Quote API: **500 stocks** at once
- ✅ OHLC API: **1000 stocks** at once

**Rate Limiting:**
- ✅ Maximum: **25 requests per second**
- ✅ Recommended: 20 requests/second (leaves buffer)

**Token Management:**
- ✅ Valid for **24 hours**
- ✅ Auto-refresh via OAuth flow

**For monitoring 1000+ stocks:**
- Split into 2 batches of 500 (LTP/Quote) or 1 batch (OHLC)
- Takes ~0.5-1 second total with proper rate limiting
- Consider WebSocket for real-time updates

