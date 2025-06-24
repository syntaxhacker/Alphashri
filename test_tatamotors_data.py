#!/usr/bin/env python3
"""
🧪 TATAMOTORS Data Validation Test
Test script to validate data fetching for TATAMOTORS from yfinance
"""

import sys
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from enhanced_data_fetcher import EnhancedDataFetcher
from indian_stock_config import get_stock_symbol, get_market_info

console = Console()

class TATAMOTORSDataTester:
    """Test data fetching for TATAMOTORS stock"""
    
    def __init__(self, use_synthetic_data=False):
        self.data_fetcher = EnhancedDataFetcher(cache_dir='test_cache')
        self.test_results = {}
        self.working_symbol = None
        self.use_synthetic_data = use_synthetic_data
        
        if use_synthetic_data:
            console.print("[yellow]⚠️ WARNING: Synthetic data generation is enabled. This should only be used for testing![/yellow]")
    
    def generate_synthetic_data(self, symbol, start_date, end_date, base_price=500):
        """Generate synthetic Indian stock data for testing"""
        console.print(f"[magenta]🧪 Generating synthetic data for {symbol}...[/magenta]")
        
        dates = pd.date_range(start=start_date, end=end_date, freq='D')
        dates = [d for d in dates if d.weekday() < 5]  # Remove weekends
        
        np.random.seed(42)  # For reproducible results
        
        # Generate realistic Indian stock price movements
        price = base_price
        data = []
        
        for date in dates:
            # Daily volatility for Indian stocks (2-4%)
            daily_return = np.random.normal(0.001, 0.025)  # 0.1% mean, 2.5% volatility
            price = price * (1 + daily_return)
            
            # Generate OHLC
            high = price * (1 + abs(np.random.normal(0, 0.01)))
            low = price * (1 - abs(np.random.normal(0, 0.01)))
            open_price = low + (high - low) * np.random.random()
            close_price = low + (high - low) * np.random.random()
            
            # Generate volume (Indian stock typical range)
            volume = int(np.random.lognormal(13, 0.5))  # Realistic volume range
            
            data.append({
                'open': open_price,
                'high': high,
                'low': low,
                'close': close_price,
                'volume': volume
            })
        
        df = pd.DataFrame(data, index=dates)
        df.index.name = 'Date'
        
        console.print(f"[green]✅ Generated {len(df)} days of synthetic data[/green]")
        return df
        
    def test_symbol_formats(self):
        """Test both NSE and BSE symbol formats with rate limit handling"""
        console.print(Panel.fit(
            "[bold blue]🔍 Testing Indian Stock Symbol Formats[/bold blue]",
            border_style="blue"
        ))
        
        # Try different Indian stocks - start with most reliable ones
        symbols_to_test = [
            'TATAMOTORS.NS',  # Original target
            'RELIANCE.NS',    # Most liquid Indian stock
            'TCS.NS',         # Large cap IT
            'INFY.NS',        # Alternative IT stock
            'HDFCBANK.NS',    # Banking sector
        ]
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)  # Last 30 days
        
        results_table = Table(title="Symbol Format Test Results")
        results_table.add_column("Symbol", style="cyan")
        results_table.add_column("Exchange", style="yellow")
        results_table.add_column("Status", style="white")
        results_table.add_column("Bars", style="green")
        results_table.add_column("Date Range", style="white")
        
        successful_symbol = None
        
        for i, symbol in enumerate(symbols_to_test):
            try:
                console.print(f"\n[cyan]Testing {symbol}... ({i+1}/{len(symbols_to_test)})[/cyan]")
                
                # Add delay to avoid rate limits
                if i > 0:
                    import time
                    console.print("[yellow]⏳ Waiting 3 seconds to avoid rate limits...[/yellow]")
                    time.sleep(3)
                
                data = self.data_fetcher.fetch_data(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=end_date,
                    timeframe='1d'
                )
                
                if data is not None and not data.empty:
                    exchange = "NSE" if symbol.endswith('.NS') else "BSE"
                    date_range = f"{data.index[0].date()} to {data.index[-1].date()}"
                    
                    results_table.add_row(
                        symbol,
                        exchange,
                        "✅ SUCCESS",
                        str(len(data)),
                        date_range
                    )
                    
                    self.test_results[symbol] = {
                        'status': 'success',
                        'data': data,
                        'bars': len(data)
                    }
                    
                    successful_symbol = symbol
                    console.print(f"[green]🎉 Found working symbol: {symbol}[/green]")
                    break  # Stop on first success
                    
                else:
                    results_table.add_row(
                        symbol,
                        "NSE" if symbol.endswith('.NS') else "BSE",
                        "❌ NO DATA",
                        "0",
                        "N/A"
                    )
                    
                    self.test_results[symbol] = {
                        'status': 'no_data',
                        'data': None,
                        'bars': 0
                    }
                    
            except Exception as e:
                error_msg = str(e)
                if "429" in error_msg or "Too Many Requests" in error_msg:
                    console.print(f"[yellow]⚠️ Rate limited. Waiting 10 seconds...[/yellow]")
                    import time
                    time.sleep(10)
                    
                results_table.add_row(
                    symbol,
                    "NSE" if symbol.endswith('.NS') else "BSE",
                    f"❌ ERROR",
                    "0",
                    str(e)[:50] + "..."
                )
                
                self.test_results[symbol] = {
                    'status': 'error',
                    'data': None,
                    'bars': 0,
                    'error': str(e)
                }
        
        if successful_symbol:
            # Update our working symbol for subsequent tests
            self.working_symbol = successful_symbol
        elif self.use_synthetic_data:
            # Only use synthetic data if explicitly enabled
            console.print(f"[yellow]⚠️ All real data sources failed. Using synthetic data for testing...[/yellow]")
            synthetic_symbol = 'TATAMOTORS.NS'
            synthetic_data = self.generate_synthetic_data(synthetic_symbol, start_date, end_date)
            
            results_table.add_row(
                synthetic_symbol + " (SYNTHETIC)",
                "NSE",
                "🧪 SYNTHETIC",
                str(len(synthetic_data)),
                f"{synthetic_data.index[0].date()} to {synthetic_data.index[-1].date()}"
            )
            
            self.test_results[synthetic_symbol] = {
                'status': 'synthetic',
                'data': synthetic_data,
                'bars': len(synthetic_data)
            }
            
            self.working_symbol = synthetic_symbol
        else:
            console.print("[red]❌ Failed to fetch data from all sources and synthetic data is disabled[/red]")
        
        console.print(results_table)
        
    def test_timeframes(self, symbol=None):
        """Test different timeframes for data fetching"""
        if symbol is None:
            symbol = self.working_symbol or 'RELIANCE.NS'
            
        console.print(Panel.fit(
            f"[bold green]⏰ Testing Timeframes for {symbol}[/bold green]",
            border_style="green"
        ))
        
        timeframes_to_test = ['1d', '1h']
        
        # Adjust date ranges based on timeframe
        timeframe_configs = {
            '1d': {'days': 60, 'description': '60 days'},
            '1h': {'days': 7, 'description': '7 days (hourly)'},
        }
        
        timeframe_table = Table(title="Timeframe Test Results")
        timeframe_table.add_column("Timeframe", style="cyan")
        timeframe_table.add_column("Period", style="yellow")
        timeframe_table.add_column("Status", style="white")
        timeframe_table.add_column("Bars", style="green")
        timeframe_table.add_column("Data Quality", style="white")
        
        for timeframe in timeframes_to_test:
            try:
                config = timeframe_configs[timeframe]
                end_date = datetime.now()
                start_date = end_date - timedelta(days=config['days'])
                
                console.print(f"\n[cyan]Testing {timeframe} timeframe...[/cyan]")
                
                data = self.data_fetcher.fetch_data(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=end_date,
                    timeframe=timeframe
                )
                
                if data is not None and not data.empty:
                    # Data quality checks
                    quality_issues = []
                    
                    # Check for missing values
                    if data.isnull().any().any():
                        quality_issues.append("Missing values")
                    
                    # Check OHLCV relationships
                    if not (data['low'] <= data['open']).all():
                        quality_issues.append("Low > Open")
                    if not (data['low'] <= data['close']).all():
                        quality_issues.append("Low > Close")
                    if not (data['high'] >= data['open']).all():
                        quality_issues.append("High < Open")
                    if not (data['high'] >= data['close']).all():
                        quality_issues.append("High < Close")
                    
                    # Check for zero/negative volumes
                    if (data['volume'] <= 0).any():
                        quality_issues.append("Zero/negative volume")
                    
                    quality_status = "✅ GOOD" if not quality_issues else f"⚠️ {len(quality_issues)} issues"
                    
                    timeframe_table.add_row(
                        timeframe,
                        config['description'],
                        "✅ SUCCESS",
                        str(len(data)),
                        quality_status
                    )
                    
                    # Store detailed results
                    self.test_results[f"{symbol}_{timeframe}"] = {
                        'status': 'success',
                        'data': data,
                        'bars': len(data),
                        'quality_issues': quality_issues
                    }
                    
                else:
                    timeframe_table.add_row(
                        timeframe,
                        config['description'],
                        "❌ NO DATA",
                        "0",
                        "N/A"
                    )
                    
            except Exception as e:
                timeframe_table.add_row(
                    timeframe,
                    config['description'],
                    "❌ ERROR",
                    "0",
                    str(e)[:30] + "..."
                )
        
        console.print(timeframe_table)
        
    def validate_data_quality(self, symbol=None):
        """Detailed data quality validation"""
        if symbol is None:
            symbol = self.working_symbol or 'RELIANCE.NS'
            
        console.print(Panel.fit(
            f"[bold yellow]🔬 Data Quality Analysis for {symbol}[/bold yellow]",
            border_style="yellow"
        ))
        
        # Get daily data for analysis
        end_date = datetime.now()
        start_date = end_date - timedelta(days=90)
        
        try:
            data = self.data_fetcher.fetch_data(
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
                timeframe='1d'
            )
            
            if data is None or data.empty:
                console.print("[red]❌ No data available for quality analysis[/red]")
                return
            
            # Create quality report
            quality_table = Table(title="Data Quality Report")
            quality_table.add_column("Metric", style="cyan")
            quality_table.add_column("Value", style="white")
            quality_table.add_column("Status", style="green")
            
            # Basic statistics
            total_bars = len(data)
            missing_values = data.isnull().sum().sum()
            date_range = f"{data.index[0].date()} to {data.index[-1].date()}"
            
            quality_table.add_row("Total Bars", str(total_bars), "✅" if total_bars > 0 else "❌")
            quality_table.add_row("Missing Values", str(missing_values), "✅" if missing_values == 0 else "⚠️")
            quality_table.add_row("Date Range", date_range, "✅")
            
            # Price relationships
            low_high_ok = (data['low'] <= data['high']).all()
            open_in_range = ((data['low'] <= data['open']) & (data['open'] <= data['high'])).all()
            close_in_range = ((data['low'] <= data['close']) & (data['close'] <= data['high'])).all()
            
            quality_table.add_row("Low ≤ High", str(low_high_ok), "✅" if low_high_ok else "❌")
            quality_table.add_row("Open in Range", str(open_in_range), "✅" if open_in_range else "❌")
            quality_table.add_row("Close in Range", str(close_in_range), "✅" if close_in_range else "❌")
            
            # Volume analysis
            positive_volume = (data['volume'] > 0).all()
            avg_volume = data['volume'].mean()
            
            quality_table.add_row("Positive Volume", str(positive_volume), "✅" if positive_volume else "❌")
            quality_table.add_row("Avg Daily Volume", f"{avg_volume:,.0f}", "✅")
            
            # Price statistics
            price_range = f"₹{data['low'].min():.2f} - ₹{data['high'].max():.2f}"
            avg_price = data['close'].mean()
            
            quality_table.add_row("Price Range", price_range, "✅")
            quality_table.add_row("Avg Close Price", f"₹{avg_price:.2f}", "✅")
            
            console.print(quality_table)
            
            # Market info
            market_info = get_market_info(symbol)
            console.print(f"\n[bold cyan]📊 Market Information:[/bold cyan]")
            console.print(f"Stock: {market_info['stock_name']}")
            console.print(f"Sector: {market_info['sector']}")
            console.print(f"Exchange: {market_info['exchange']}")
            
        except Exception as e:
            console.print(f"[red]❌ Error in data quality validation: {e}[/red]")
    
    def test_cache_functionality(self):
        """Test the enhanced data cache functionality"""
        console.print(Panel.fit(
            "[bold magenta]💾 Testing Cache Functionality[/bold magenta]",
            border_style="magenta"
        ))
        
        symbol = self.working_symbol or 'RELIANCE.NS'
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        
        try:
            # First fetch (should cache)
            console.print("[cyan]First fetch (should create cache)...[/cyan]")
            data1 = self.data_fetcher.fetch_data(
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
                timeframe='1d',
                force_refresh=False
            )
            
            # Second fetch (should use cache)
            console.print("[cyan]Second fetch (should use cache)...[/cyan]")
            data2 = self.data_fetcher.fetch_data(
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
                timeframe='1d',
                force_refresh=False
            )
            
            # Compare data
            if data1 is not None and data2 is not None:
                if data1.equals(data2):
                    console.print("[green]✅ Cache functionality working correctly[/green]")
                else:
                    console.print("[yellow]⚠️ Cache data differs from fresh data[/yellow]")
            
            # Display cache summary
            self.data_fetcher.get_cache_summary()
            
        except Exception as e:
            console.print(f"[red]❌ Error testing cache: {e}[/red]")
    
    def run_comprehensive_test(self):
        """Run all tests"""
        console.print(Panel.fit(
            "[bold white]🚀 TATAMOTORS Data Validation Test Suite[/bold white]\n"
            "Testing data fetching, quality, and cache functionality",
            border_style="white"
        ))
        
        # Test 1: Symbol formats
        self.test_symbol_formats()
        
        # Test 2: Timeframes
        self.test_timeframes()
        
        # Test 3: Data quality
        self.validate_data_quality()
        
        # Test 4: Cache functionality
        self.test_cache_functionality()
        
        # Summary
        console.print(Panel.fit(
            "[bold green]✅ Test Suite Completed[/bold green]\n"
            "Check results above for any issues",
            border_style="green"
        ))

def main():
    """Main test function"""
    try:
        tester = TATAMOTORSDataTester()
        tester.run_comprehensive_test()
        
    except KeyboardInterrupt:
        console.print("\n[yellow]Test interrupted by user[/yellow]")
    except Exception as e:
        console.print(f"\n[red]Test failed with error: {e}[/red]")
        sys.exit(1)

if __name__ == "__main__":
    main() 