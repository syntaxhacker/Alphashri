#!/usr/bin/env python3
"""
Enhanced Data Fetcher with Intelligent Caching
Integrates with the EnhancedDataCache to minimize API calls
"""

import time
from datetime import datetime, timedelta
from typing import Optional
import pandas as pd
from rich.console import Console
from rich.progress import Progress

from enhanced_data_cache import EnhancedDataCache

try:
    from binance.client import Client
    HAS_BINANCE = True
except ImportError:
    HAS_BINANCE = False
    print("⚠️ Binance library not found. Install with: pip install python-binance")

try:
    import yfinance as yf
    HAS_YFINANCE = True
except ImportError:
    HAS_YFINANCE = False
    print("⚠️ yfinance library not found. Install with: pip install yfinance")

console = Console()

class EnhancedDataFetcher:
    """Enhanced data fetcher with intelligent caching system"""
    
    def __init__(self, api_key: str = None, api_secret: str = None, cache_dir: str = 'data_cache'):
        self.api_key = api_key
        self.api_secret = api_secret
        self.cache = EnhancedDataCache(cache_dir)
        
        # Initialize Binance client if credentials provided
        if HAS_BINANCE and api_key and api_secret:
            self.client = Client(api_key, api_secret)
            self.use_binance = True
            console.print("[green]✓ Enhanced DataFetcher with Binance API + Intelligent Caching[/green]")
        else:
            self.use_binance = False
            console.print("[yellow]⚠ Enhanced DataFetcher with yfinance + Intelligent Caching[/yellow]")
    
    def fetch_data(self, symbol: str, start_date: datetime, end_date: datetime, 
                   timeframe: str = '1m', force_refresh: bool = False) -> pd.DataFrame:
        """
        Fetch data with intelligent caching
        
        Args:
            symbol: Trading symbol (e.g., 'BTCUSDT')
            start_date: Start date for data
            end_date: End date for data
            timeframe: Data timeframe (default '1m')
            force_refresh: Force fresh download ignoring cache
        
        Returns:
            DataFrame with OHLCV data
        """
        
        console.print(f"[cyan]📊 Fetching {symbol} {timeframe} data: {start_date.date()} to {end_date.date()}[/cyan]")
        
        # Try cache first (unless forced refresh)
        if not force_refresh:
            cached_data = self.cache.get_data(symbol, start_date, end_date, timeframe)
            if cached_data is not None:
                return cached_data
        
        # Cache miss or forced refresh - fetch fresh data
        console.print(f"[yellow]⏬ Downloading fresh data for {symbol}...[/yellow]")
        
        if self.use_binance:
            df = self._fetch_binance_data(symbol, start_date, end_date, timeframe)
        else:
            df = self._fetch_yfinance_data(symbol, start_date, end_date, timeframe)
        
        # Cache the downloaded data
        if df is not None and not df.empty:
            self.cache.save_data(symbol, df, start_date, end_date, timeframe)
        
        return df
    
    def _fetch_binance_data(self, symbol: str, start_date: datetime, end_date: datetime, 
                           timeframe: str = '1m') -> pd.DataFrame:
        """Fetch data from Binance API with improved chunking"""
        
        # Map timeframe to Binance intervals
        interval_map = {
            '1m': Client.KLINE_INTERVAL_1MINUTE,
            '3m': Client.KLINE_INTERVAL_3MINUTE,
            '5m': Client.KLINE_INTERVAL_5MINUTE,
            '15m': Client.KLINE_INTERVAL_15MINUTE,
            '30m': Client.KLINE_INTERVAL_30MINUTE,
            '1h': Client.KLINE_INTERVAL_1HOUR,
            '2h': Client.KLINE_INTERVAL_2HOUR,
            '4h': Client.KLINE_INTERVAL_4HOUR,
            '6h': Client.KLINE_INTERVAL_6HOUR,
            '8h': Client.KLINE_INTERVAL_8HOUR,
            '12h': Client.KLINE_INTERVAL_12HOUR,
            '1d': Client.KLINE_INTERVAL_1DAY,
        }
        
        if timeframe not in interval_map:
            raise ValueError(f"Unsupported timeframe: {timeframe}")
        
        binance_interval = interval_map[timeframe]
        
        # Determine chunk size based on timeframe to respect API limits
        if timeframe == '1m':
            chunk_days = 1  # 1440 bars per day
        elif timeframe in ['3m', '5m']:
            chunk_days = 3  # ~500-1000 bars
        else:
            chunk_days = 30  # Longer timeframes can handle more days
        
        chunk_size = timedelta(days=chunk_days)
        all_klines = []
        current_start = start_date
        
        total_days = (end_date - start_date).days
        total_chunks = max(1, (total_days // chunk_days) + 1)
        
        with Progress(console=console) as progress:
            task = progress.add_task(f"[cyan]Downloading {symbol} {timeframe}...", total=total_chunks)
            
            while current_start < end_date:
                current_end = min(current_start + chunk_size, end_date)
                
                try:
                    start_ts = int(current_start.timestamp() * 1000)
                    end_ts = int(current_end.timestamp() * 1000)
                    
                    # Retry mechanism for API reliability
                    max_retries = 3
                    for attempt in range(max_retries):
                        try:
                            chunk_klines = self.client.get_historical_klines(
                                symbol=symbol,
                                interval=binance_interval,
                                start_str=str(start_ts),
                                end_str=str(end_ts)
                            )
                            break
                        except Exception as e:
                            if attempt == max_retries - 1:
                                raise e
                            console.print(f"[yellow]Retry {attempt + 1}/{max_retries} for {current_start.date()}[/yellow]")
                            time.sleep(2 ** attempt)  # Exponential backoff
                    
                    if chunk_klines:
                        all_klines.extend(chunk_klines)
                        console.print(f"[green]✓ {current_start.strftime('%Y-%m-%d')} → {len(chunk_klines):,} bars[/green]")
                    
                except Exception as e:
                    console.print(f"[red]✗ Failed {current_start.strftime('%Y-%m-%d')}: {str(e)}[/red]")
                
                current_start = current_end
                progress.update(task, advance=1)
                time.sleep(0.2)  # Rate limiting
        
        if not all_klines:
            raise ValueError(f"Failed to fetch any data for {symbol}")
        
        # Convert to DataFrame
        df = pd.DataFrame(all_klines, columns=[
            'timestamp', 'open', 'high', 'low', 'close', 'volume',
            'close_time', 'quote_asset_volume', 'number_of_trades',
            'taker_buy_base_asset_volume', 'taker_buy_quote_asset_volume', 'ignore'
        ])
        
        # Process data
        df['timestamp'] = pd.to_datetime(df['timestamp'].astype(float), unit='ms')
        df.set_index('timestamp', inplace=True)
        
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Clean and sort data
        df.sort_index(inplace=True)
        df = df[~df.index.duplicated(keep='first')]
        
        # Filter to requested date range (API sometimes returns extra data)
        df = df[(df.index >= start_date) & (df.index <= end_date)]
        
        console.print(f"[green]✓ Downloaded {len(df):,} {timeframe} bars for {symbol}[/green]")
        return df[['open', 'high', 'low', 'close', 'volume']]
    
    def _fetch_yfinance_data(self, symbol: str, start_date: datetime, end_date: datetime, 
                            timeframe: str = '1m') -> pd.DataFrame:
        """Fetch data from Yahoo Finance (fallback)"""
        
        if not HAS_YFINANCE:
            raise ImportError("yfinance is required but not installed")
        
        # Convert symbol for yfinance
        if symbol.endswith('USDT'):
            yf_symbol = symbol.replace('USDT', '-USD')
        elif symbol.endswith('USD'):
            yf_symbol = symbol + 'T'  # Some symbols need this
        else:
            yf_symbol = f"{symbol}-USD"
        
        # Map timeframe to yfinance intervals
        interval_map = {
            '1m': '1m',
            '2m': '2m',
            '5m': '5m',
            '15m': '15m',
            '30m': '30m',
            '1h': '1h',
            '1d': '1d',
        }
        
        if timeframe not in interval_map:
            # Default to closest available
            if 'm' in timeframe:
                yf_interval = '1m'
            else:
                yf_interval = '1h'
        else:
            yf_interval = interval_map[timeframe]
        
        try:
            console.print(f"[cyan]Fetching {yf_symbol} from Yahoo Finance...[/cyan]")
            ticker = yf.Ticker(yf_symbol)
            df = ticker.history(start=start_date, end=end_date, interval=yf_interval)
            
            if df.empty:
                raise ValueError(f"No data received for {yf_symbol}")
            
            # Rename columns to match our format
            df.columns = df.columns.str.lower()
            df = df[['open', 'high', 'low', 'close', 'volume']]
            
            console.print(f"[green]✓ Downloaded {len(df):,} {timeframe} bars for {symbol} (via yfinance)[/green]")
            return df
            
        except Exception as e:
            raise ValueError(f"Failed to fetch data from Yahoo Finance: {str(e)}")
    
    def get_multiple_symbols(self, symbols: list, start_date: datetime, end_date: datetime, 
                           timeframe: str = '1m', force_refresh: bool = False) -> dict:
        """
        Fetch data for multiple symbols efficiently
        
        Returns:
            dict: {symbol: DataFrame}
        """
        results = {}
        
        console.print(f"[bold cyan]📊 Fetching data for {len(symbols)} symbols...[/bold cyan]")
        
        for symbol in symbols:
            try:
                df = self.fetch_data(symbol, start_date, end_date, timeframe, force_refresh)
                results[symbol] = df
                console.print(f"[green]✓ {symbol}: {len(df):,} bars[/green]")
            except Exception as e:
                console.print(f"[red]✗ {symbol}: {str(e)}[/red]")
                results[symbol] = None
        
        return results
    
    def get_cache_summary(self):
        """Display cache summary"""
        self.cache.print_cache_stats()
    
    def clear_expired_cache(self, max_age_days: int = 7):
        """Clear expired cache entries"""
        return self.cache.clear_expired(max_age_days)
    
    def refresh_symbol_data(self, symbol: str, days_back: int = 30, timeframe: str = '1m'):
        """Refresh data for a specific symbol"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        console.print(f"[cyan]🔄 Refreshing {symbol} data (last {days_back} days)[/cyan]")
        return self.fetch_data(symbol, start_date, end_date, timeframe, force_refresh=True) 