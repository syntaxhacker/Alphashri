"""
Price Fetching and Formatting Utilities for TradingView Screener
===============================================================

This module contains utility functions for fetching live prices,
formatting prices, and handling currency display.
"""

import asyncio
import concurrent.futures
from rich.console import Console

console = Console()


def format_price(price, currency_symbol='₹'):
    """Format price with currency symbol"""
    return f"{currency_symbol}{price:,.2f}"


def get_live_price_from_upstox(upstox_api, symbol):
    """Get live price from Upstox API with error handling"""
    try:
        if not upstox_api:
            console.print(f"[dim red]No Upstox API available for {symbol}[/dim red]")
            return None
        
        # Get live market data
        ltp_data = upstox_api.get_market_data_feed([symbol], "ltpc")
        
        if ltp_data and 'data' in ltp_data and symbol in ltp_data['data']:
            ltp = ltp_data['data'][symbol]['ltp']
            console.print(f"[dim green]✅ Got live price for {symbol}: ₹{ltp:.2f}[/dim green]")
            return ltp
        
        # Fallback: Try to get price from market quotes
        quotes = upstox_api.get_market_data_feed([symbol], "full")
        if quotes and 'data' in quotes and symbol in quotes['data']:
            quote_data = quotes['data'][symbol]
            ltp = quote_data.get('ltp', quote_data.get('close_price'))
            if ltp:
                console.print(f"[dim green]✅ Got fallback price for {symbol}: ₹{ltp:.2f}[/dim green]")
                return ltp
        
        console.print(f"[dim yellow]⚠️ No live price available for {symbol}[/dim yellow]")
        return None
        
    except Exception as e:
        console.print(f"[dim red]❌ Error fetching live price for {symbol}: {e}[/dim red]")
        return None


def fetch_live_prices_parallel(upstox_api, symbols, max_workers=5):
    """Fetch live prices for multiple symbols in parallel"""
    try:
        if not symbols:
            return {}
        
        prices = {}
        
        # Use ThreadPoolExecutor for parallel price fetching
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all price fetch tasks
            future_to_symbol = {
                executor.submit(get_live_price_from_upstox, upstox_api, symbol): symbol 
                for symbol in symbols
            }
            
            # Collect results as they complete
            for future in concurrent.futures.as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                try:
                    price = future.result(timeout=3.0)  # 3 second timeout per symbol
                    if price is not None:
                        prices[symbol] = price
                except Exception as e:
                    console.print(f"[dim red]⚠️ Failed to fetch price for {symbol}: {e}[/dim red]")
        
        console.print(f"[dim]Fetched {len(prices)} prices out of {len(symbols)} symbols[/dim]")
        return prices
        
    except Exception as e:
        console.print(f"[dim red]❌ Error in parallel price fetching: {e}[/dim red]")
        return {}


def fetch_price_from_exchange(upstox_api, symbol, exchange='NSE'):
    """Fetch price from specific exchange"""
    try:
        if not upstox_api:
            return None
        
        # Format symbol with exchange prefix if needed
        if not symbol.startswith(exchange + ':'):
            full_symbol = f"{exchange}:{symbol}"
        else:
            full_symbol = symbol
        
        # Get market data
        ltp_data = upstox_api.get_market_data_feed([full_symbol], "ltpc")
        
        if ltp_data and 'data' in ltp_data:
            data = ltp_data['data'].get(full_symbol) or ltp_data['data'].get(symbol)
            if data and 'ltp' in data:
                return data['ltp']
        
        # Try without exchange prefix
        if symbol != full_symbol:
            return get_live_price_from_upstox(upstox_api, symbol)
        
        return None
        
    except Exception as e:
        console.print(f"[dim red]❌ Error fetching price from {exchange} for {symbol}: {e}[/dim red]")
        return None