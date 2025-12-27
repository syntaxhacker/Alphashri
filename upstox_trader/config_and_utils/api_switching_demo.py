#!/usr/bin/env python3
"""
Demo: Easy Provider Switching with Unified API Interface

This demonstrates how to switch between Upstox and INDMoney APIs
without changing your application code - just change the provider name!
"""

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

def demo_unified_interface():
    """
    Demo showing how the unified interface allows easy provider switching.
    """

    # ============================================================
    # Example 1: Switch between providers with ONE line change
    # ============================================================

    # Just change 'upstox' to 'indmoney' to switch providers!
    PROVIDER = 'upstox'  # Options: 'upstox', 'indmoney'

    # Create API client - works with ANY provider!
    api = TradingAPIFactory.create_from_config(PROVIDER, quiet=True)

    # Now you can use the same methods regardless of provider!
    symbol = 'RELIANCE'

    # Get current price (works for both providers)
    price = api.get_price(symbol)
    print(f"{PROVIDER.upper()} - {symbol} price: ₹{price}")

    # Get full quote (works for both providers)
    quote = api.get_quote(symbol)
    print(f"{PROVIDER.upper()} - {symbol} quote: {quote}")

    # ============================================================
    # Example 2: Runtime provider switching
    # ============================================================

    def fetch_portfolio_prices(symbols, provider='upstox'):
        """
        Fetch prices for multiple symbols using any provider.

        Args:
            symbols: List of stock symbols
            provider: 'upstox' or 'indmoney'
        """
        api = TradingAPIFactory.create_from_config(provider, quiet=True)

        results = {}
        for symbol in symbols:
            price = api.get_price(symbol)
            results[symbol] = price

        return results

    # Use with Upstox
    print("\n--- Using Upstox ---")
    prices_upstox = fetch_portfolio_prices(['RELIANCE', 'TCS', 'INFY'], provider='upstox')
    print(f"Upstox prices: {prices_upstox}")

    # Switch to INDMoney - same function!
    print("\n--- Using INDMoney ---")
    prices_indmoney = fetch_portfolio_prices(['RELIANCE', 'TCS', 'INFY'], provider='indmoney')
    print(f"INDMoney prices: {prices_indmoney}")

    # ============================================================
    # Example 3: Configuration-based provider selection
    # ============================================================

    import os

    # Get provider from environment variable (useful for deployments)
    # export TRADING_API_PROVIDER=indmoney
    current_provider = os.getenv('TRADING_API_PROVIDER', 'upstox')

    api = TradingAPIFactory.create_from_config(current_provider, quiet=True)

    # Your application code doesn't need to know which provider is being used!
    price = api.get_price('TCS')
    print(f"\nUsing {current_provider}: TCS price = ₹{price}")

    # ============================================================
    # Example 4: Fallback mechanism
    # ============================================================

    def get_price_with_fallback(symbol, primary_provider='upstox', fallback_provider='indmoney'):
        """
        Try primary provider, fallback to secondary if it fails.

        This provides resilience - if one API is down, use the other!
        """
        try:
            api = TradingAPIFactory.create_from_config(primary_provider, quiet=True)
            price = api.get_price(symbol)
            if price:
                print(f"✓ Got price from {primary_provider}")
                return price
        except Exception as e:
            print(f"✗ {primary_provider} failed: {e}")

        # Fallback
        try:
            api = TradingAPIFactory.create_from_config(fallback_provider, quiet=True)
            price = api.get_price(symbol)
            if price:
                print(f"✓ Got price from {fallback_provider} (fallback)")
                return price
        except Exception as e:
            print(f"✗ {fallback_provider} also failed: {e}")

        return None

    print("\n--- Fallback Demo ---")
    price = get_price_with_fallback('RELIANCE', 'upstox', 'indmoney')
    print(f"Final price: ₹{price}")

    # ============================================================
    # Example 5: Historical data (Upstox only in this example)
    # ============================================================

    print("\n--- Historical Data Demo ---")

    api_upstox = TradingAPIFactory.create_from_config('upstox', quiet=True)

    # Get historical data
    from datetime import datetime, timedelta
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')

    hist_data = api_upstox.get_historical_data(
        symbol='RELIANCE',
        interval='day',
        from_date=from_date,
        to_date=to_date
    )

    if hist_data is not None and not hist_data.empty:
        print(f"Retrieved {len(hist_data)} days of historical data")
        print(f"Date range: {hist_data.index[0]} to {hist_data.index[-1]}")
        print(f"Latest close: ₹{hist_data['close'].iloc[-1]:.2f}")


if __name__ == "__main__":
    print("=" * 70)
    print("UNIFIED API INTERFACE - Provider Switching Demo")
    print("=" * 70)

    demo_unified_interface()

    print("\n" + "=" * 70)
    print("Key Takeaways:")
    print("=" * 70)
    print("""
    1. ✓ Same method names across all providers (get_price, get_quote, etc.)
    2. ✓ Switch providers by changing ONE word ('upstox' <-> 'indmoney')
    3. ✓ No need to rewrite application code when switching APIs
    4. ✓ Easy to implement fallback mechanisms
    5. ✓ Configuration-driven provider selection
    6. ✓ All providers inherit from BaseAPIClient with guaranteed methods

    Available Unified Methods:
    - get_price(symbol, **kwargs) -> float
    - get_quote(symbol, **kwargs) -> dict
    - get_historical_data(symbol, interval, from_date, to_date, **kwargs) -> DataFrame
    - get_instrument_key(symbol, **kwargs) -> str
    """)
