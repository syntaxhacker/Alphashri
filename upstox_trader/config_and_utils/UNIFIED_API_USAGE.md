# Unified API Interface - Usage Examples

## ✅ All Tests Passed!

The unified interface has been successfully implemented and verified. Here's how to use it:

## 🚀 Quick Start

### 1. Import and Create Client

```python
from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

# Method 1: Create from config (recommended)
api = TradingAPIFactory.create_from_config('upstox', quiet=True)

# Method 2: Create with explicit credentials
api = TradingAPIFactory.create_client('upstox',
    api_key='your_key',
    api_secret='your_secret',
    quiet=True
)
```

### 2. Switch Providers - Just Change ONE Word!

```python
# Use Upstox
api = TradingAPIFactory.create_from_config('upstox')
price = api.get_price('RELIANCE')  # Returns: 2456.75

# Switch to INDMoney - SAME CODE!
api = TradingAPIFactory.create_from_config('indmoney')
price = api.get_price('RELIANCE')  # Returns: 2456.80
```

## 📋 Available Methods

Both providers support these **unified methods**:

```python
# Get current price
price = api.get_price('RELIANCE')
# Returns: float or None

# Get full quote
quote = api.get_quote('RELIANCE')
# Returns: dict with OHLC, volume, etc.

# Get instrument key
key = api.get_instrument_key('RELIANCE')
# Returns: str or None

# Get historical data (Upstox only)
df = api.get_historical_data(
    symbol='RELIANCE',
    interval='day',
    from_date='2024-01-01',
    to_date='2024-12-31'
)
# Returns: pandas.DataFrame
```

## 🔄 Provider Switching Examples

### Example 1: Configuration-Based Switching

```python
import os

# Set provider via environment variable
provider = os.getenv('TRADING_API_PROVIDER', 'upstox')

# Your code doesn't need to change!
api = TradingAPIFactory.create_from_config(provider)
prices = {s: api.get_price(s) for s in ['RELIANCE', 'TCS', 'INFY']}
```

### Example 2: Fallback Mechanism

```python
def get_price_with_fallback(symbol, primary='upstox', fallback='indmoney'):
    """Try primary, fallback to secondary if fails."""
    try:
        api = TradingAPIFactory.create_from_config(primary)
        price = api.get_price(symbol)
        if price:
            return price
    except:
        pass

    # Fallback
    api = TradingAPIFactory.create_from_config(fallback)
    return api.get_price(symbol)

# Use it
price = get_price_with_fallback('RELIANCE')
```

### Example 3: A/B Testing Providers

```python
def compare_providers(symbols):
    """Compare prices from both providers."""
    results = {}

    for provider in ['upstox', 'indmoney']:
        api = TradingAPIFactory.create_from_config(provider, quiet=True)
        results[provider] = {s: api.get_price(s) for s in symbols}

    return results

comparison = compare_providers(['RELIANCE', 'TCS'])
print(f"Upstox: {comparison['upstox']}")
print(f"INDMoney: {comparison['indmoney']}")
```

### Example 4: Provider Agnostic Function

```python
def fetch_portfolio_value(symbols, quantities, provider='upstox'):
    """
    Calculate portfolio value using any provider.

    Args:
        symbols: List of stock symbols
        quantities: Dict of symbol -> quantity
        provider: 'upstox' or 'indmoney'

    Returns:
        Total portfolio value
    """
    api = TradingAPIFactory.create_from_config(provider, quiet=True)

    total_value = 0
    for symbol in symbols:
        price = api.get_price(symbol)
        if price:
            total_value += price * quantities[symbol]

    return total_value

# Use with any provider
value = fetch_portfolio_value(
    symbols=['RELIANCE', 'TCS'],
    quantities={'RELIANCE': 10, 'TCS': 5},
    provider='upstox'  # Change to 'indmoney' to switch!
)
```

## 🎯 Key Benefits

| Feature | Before | After |
|---------|--------|-------|
| **Switch providers** | Rewrite entire code | Change ONE word |
| **Method names** | `fetch_ltp()`, `get_realtime_price()` | `get_price()` for both |
| **Learning curve** | Learn each API separately | Learn once, use everywhere |
| **Fallback support** | Manual implementation | Built-in with factory |
| **Type hints** | Inconsistent | Unified `BaseAPIClient` type |
| **Testing** | Hard to mock/test | Easy to swap implementations |

## 📊 Interface Signatures

```python
class BaseAPIClient(ABC):
    @abstractmethod
    def get_price(self, symbol: str, **kwargs) -> Optional[float]:
        """Get current/last traded price"""

    @abstractmethod
    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict]:
        """Get full market quote (OHLC, volume, etc.)"""

    @abstractmethod
    def get_instrument_key(self, symbol: str, **kwargs) -> Optional[str]:
        """Get instrument key for API calls"""

    def get_historical_data(self, symbol: str, interval: str,
                           from_date: str, to_date: str, **kwargs) -> Optional[pd.DataFrame]:
        """Get historical OHLCV data (Upstox only)"""
```

## 🔒 Validation

The factory provides automatic validation:

```python
# ✅ Valid - returns API client
api = TradingAPIFactory.create_client('upstox',
    api_key='key', api_secret='secret')

# ❌ Invalid - raises ValueError
api = TradingAPIFactory.create_client('upstox')  # Missing credentials
api = TradingAPIFactory.create_client('unknown')  # Unknown provider
```

## 📝 Migration Guide

### Old Code (Provider-Specific)

```python
# Upstox
from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
api = UpstoxAPI(api_key='...', api_secret='...')
price = api.get_realtime_price('RELIANCE')

# INDMoney (different API!)
from upstox_trader.config_and_utils.free_indian_apis import INDMONEYApi
api = INDMONEYApi(access_token='...')
price = api.fetch_ltp('RELIANCE')  # Different method!
```

### New Code (Unified)

```python
from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

# Works for BOTH providers!
api = TradingAPIFactory.create_from_config('upstox')  # or 'indmoney'
price = api.get_price('RELIANCE')  # Same method!
```

## ✅ Test Results

All 8 verification tests passed:

1. ✅ BaseAPIClient Abstract Methods
2. ✅ UpstoxAPI Implementation
3. ✅ INDMONEYApi Implementation
4. ✅ Factory Methods
5. ✅ Provider Validation
6. ✅ Credential Validation
7. ✅ Interface Consistency
8. ✅ Inheritance Chain

Run tests: `python -m upstox_trader.config_and_utils.test_api_interface`

## 🎉 Summary

You can now:

- ✅ Switch providers by changing ONE word
- ✅ Write provider-agnostic code
- ✅ Implement fallback mechanisms easily
- ✅ Test with mock implementations
- ✅ Extend to new providers seamlessly

**The future is unified!** 🚀
