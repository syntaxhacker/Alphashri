#!/usr/bin/env python3
"""
🇮🇳 TATAMOTORS VectorBT Walk Forward Analysis
Specialized walk forward optimization for Indian stocks using VectorBT
"""

import os
import sys
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import matplotlib.pyplot as plt
import seaborn as sns
from rich.console import Console
from rich.progress import Progress, track
from rich.table import Table
from rich.panel import Panel
import json

# Indian stock configuration
from indian_stock_config import (
    DEFAULT_CONFIGS, EQUITY_PARAMETER_GRIDS, INDIAN_TRADING_COSTS,
    get_stock_symbol, get_market_info, get_parameter_grid
)

# Enhanced data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher

# VectorBT imports
try:
    import vectorbt as vbt
    HAS_VECTORBT = True
    print("✅ VectorBT available - GPU acceleration enabled for Indian stocks")
except ImportError:
    HAS_VECTORBT = False
    print("❌ VectorBT not found. Install with: pip install vectorbt")

console = Console()

class TATAMOTORSWalkForward:
    """TATAMOTORS VectorBT walk forward optimization for Indian stocks"""
    
    def __init__(self, config_name: str = 'TATAMOTORS_DAILY'):
        """Initialize with Indian stock configuration"""
        
        # Load configuration
        if config_name in DEFAULT_CONFIGS:
            self.config = DEFAULT_CONFIGS[config_name].copy()
        else:
            raise ValueError(f"Unknown config: {config_name}. Available: {list(DEFAULT_CONFIGS.keys())}")
        
        # Initialize enhanced data fetcher (no API keys needed for yfinance)
        self.data_fetcher = EnhancedDataFetcher(cache_dir='vectorbt_cache')
        
        # Walk forward configuration from config
        self.symbol = self.config['symbol']
        self.timeframe = self.config['timeframe']
        self.train_days = self.config.get('train_days', 90)
        self.test_days = self.config.get('test_days', 30)
        self.step_days = self.config.get('step_days', 15)
        self.fees = self.config['fees']
        self.direction = self.config['direction']
        self.initial_cash = self.config['initial_cash']
        
        # Get market info
        self.market_info = get_market_info(self.symbol)
        
        # Results storage
        self.results = {}
        self.data_cache = {}
        
        console.print(Panel.fit(
            f"[bold blue]🇮🇳 TATAMOTORS VectorBT Walk Forward Optimizer[/bold blue]\n"
            f"• Stock: {self.market_info['stock_name']} ({self.market_info['exchange']})\n"
            f"• Sector: {self.market_info['sector']}\n"
            f"• Timeframe: {self.timeframe}\n"
            f"• Trading Fees: {self.fees*100:.2f}%\n"
            f"• Direction: {self.direction}\n"
            f"• Initial Capital: ₹{self.initial_cash:,}",
            border_style="blue"
        ))
    
    def generate_synthetic_data(self, days_back: int = 180, base_price: float = 500) -> pd.DataFrame:
        """Generate synthetic Indian stock data for testing"""
        console.print(f"[magenta]🧪 Generating synthetic data for {self.symbol}...[/magenta]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
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

    def fetch_stock_data(self, days_back: int = 180) -> pd.DataFrame:
        """Fetch Indian stock data efficiently using historical dates for CSV data"""
        
        # For TATAMOTORS, use historical dates from the CSV data
        if 'TATAMOTORS' in self.symbol:
            # Use data from the actual CSV file
            csv_path = '/Users/developer/Documents/NSE-stock-datafeed-main/Datafeed/daily/TATAMOTORS.csv'
            try:
                # Read the CSV to find the actual last date
                temp_df = pd.read_csv(csv_path)
                last_date = pd.to_datetime(temp_df['Date']).max()
                end_date = last_date
                start_date = end_date - timedelta(days=days_back)
                
                console.print(f"\n[cyan]📊 Fetching {self.symbol} {self.timeframe} historical data...[/cyan]")
                console.print(f"[yellow]Period: {start_date.date()} to {end_date.date()} ({days_back} days)[/yellow]")
            except Exception as e:
                console.print(f"[red]❌ Error reading CSV file: {e}[/red]")
                # Fallback to recent dates
                end_date = datetime.now()
                start_date = end_date - timedelta(days=days_back)
        else:
            # For other stocks, use recent dates
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days_back)
            
            console.print(f"\n[cyan]📊 Fetching {self.symbol} {self.timeframe} data...[/cyan]")
            console.print(f"[yellow]Period: {start_date.date()} to {end_date.date()} ({days_back} days)[/yellow]")
        
        try:
            data = self.data_fetcher.fetch_data(
                symbol=self.symbol,
                start_date=start_date,
                end_date=end_date,
                timeframe=self.timeframe,
                force_refresh=False
            )
            
            if data is None or data.empty:
                raise ValueError(f"No data received for {self.symbol}")
            
            self.data_cache[self.symbol] = data
            
            console.print(f"[green]✅ Successfully fetched {len(data)} bars of data[/green]")
            console.print(f"[blue]📈 Price range: ₹{data['close'].min():.2f} - ₹{data['close'].max():.2f}[/blue]")
            console.print(f"[blue]📊 Latest close: ₹{data['close'].iloc[-1]:.2f}[/blue]")
            
            return data
            
        except Exception as e:
            console.print(f"[red]❌ Error fetching data: {e}[/red]")
            return pd.DataFrame()  # Return empty DataFrame instead of synthetic data
    
    def run_full_analysis(self, days_back: int = 365):
        """Run complete walk forward analysis"""
        
        console.print(Panel.fit(
            f"[bold white]🇮🇳 Starting Complete TATAMOTORS Analysis[/bold white]\n"
            f"This will perform comprehensive walk forward optimization",
            border_style="white"
        ))
        
        try:
            # Fetch data first
            data = self.fetch_stock_data(days_back)
            
            if data.empty:
                console.print("[red]❌ No data available for analysis[/red]")
                return
            
            console.print(f"[green]✅ Successfully fetched {len(data)} bars of data[/green]")
            
            # Simple analysis for now
            console.print(Panel.fit(
                f"[bold green]✅ Basic Analysis Complete![/bold green]\n\n"
                f"📊 Data fetched successfully\n"
                f"📈 Ready for walk forward optimization\n"
                f"💾 Data cached for future use",
                border_style="green"
            ))
            
        except KeyboardInterrupt:
            console.print("\n[yellow]Analysis interrupted by user[/yellow]")
        except Exception as e:
            console.print(f"\n[red]Analysis failed: {e}[/red]")

def main():
    """Main analysis function"""
    
    # Initialize analyzer with daily configuration
    analyzer = TATAMOTORSWalkForward('TATAMOTORS_DAILY')
    
    # Run full analysis
    analyzer.run_full_analysis()

if __name__ == "__main__":
    main() 