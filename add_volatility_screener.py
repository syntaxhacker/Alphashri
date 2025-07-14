#!/usr/bin/env python3
"""
Add volatility screening capability to TV screener
"""

import sys
import os

# Add the volatility screening method to tv_screener.py
volatility_method = '''
    def get_volatile_stocks(self, min_volume_ratio=1.2, min_volatility=0.02, min_price=5, limit=100):
        """Screen for high volatility stocks - perfect for momentum trading"""
        try:
            total_rows, df = (
                self.query
                .select(
                    'name',
                    'close',
                    'volume',
                    'relative_volume_10d_calc',     # Volume ratio vs 10-day average
                    'Volatility.D',                 # Daily volatility
                    'change',                       # Daily change %
                    'RSI',                         # RSI(14)
                    'market_cap_basic',            # Market cap
                    'Recommend.All',               # Overall recommendation
                    'ADR',                         # Average Daily Range
                    'MACD.macd',                   # MACD signal
                    'update_mode'                  # Data freshness
                )
                .where(
                    {'left': 'market_cap_basic', 'operation': 'greater', 'right': 100_000_000},       # Min ₹10 Cr market cap
                    {'left': 'relative_volume_10d_calc', 'operation': 'greater', 'right': min_volume_ratio},  # Volume spike
                    {'left': 'Volatility.D', 'operation': 'greater', 'right': min_volatility},       # High volatility
                    {'left': 'close', 'operation': 'greater', 'right': min_price},                   # Min price filter
                    {'left': 'volume', 'operation': 'greater', 'right': 50000}                       # Min volume
                )
                .order_by('relative_volume_10d_calc', ascending=False)  # Sort by volume surge
                .set_markets('india')
                .limit(limit)
                .get_scanner_data(cookies=self.cookies)
            )
            
            console.print(f"[green]Successfully fetched {len(df)} volatile stocks[/green]")
            console.print(f"[blue]Total stocks meeting criteria: {total_rows}[/blue]")
            return df
            
        except Exception as e:
            console.print(f"[red]Error in get_volatile_stocks: {str(e)}[/red]")
            return pd.DataFrame()  # Return empty DataFrame on error
    
    def get_breakout_stocks(self, min_change=3.0, min_volume_ratio=1.5, limit=50):
        """Screen for stocks breaking out with volume - catching surges like EIEL"""
        try:
            total_rows, df = (
                self.query
                .select(
                    'name',
                    'close', 
                    'volume',
                    'change',                       # Daily change %
                    'relative_volume_10d_calc',     # Volume ratio
                    'Volatility.D',                 # Daily volatility
                    'RSI',                         # RSI
                    'market_cap_basic',            # Market cap
                    'Perf.W',                      # Weekly performance
                    'Perf.1M',                     # Monthly performance
                    'high',                        # Daily high
                    'low'                          # Daily low
                )
                .where(
                    {'left': 'change', 'operation': 'greater', 'right': min_change},                 # Min 3% daily move
                    {'left': 'relative_volume_10d_calc', 'operation': 'greater', 'right': min_volume_ratio},  # Volume surge
                    {'left': 'market_cap_basic', 'operation': 'greater', 'right': 50_000_000},       # Min ₹5 Cr market cap
                    {'left': 'volume', 'operation': 'greater', 'right': 100000},                     # Min volume
                    {'left': 'close', 'operation': 'greater', 'right': 5}                           # Min price
                )
                .order_by('change', ascending=False)  # Sort by biggest moves
                .set_markets('india')
                .limit(limit)
                .get_scanner_data(cookies=self.cookies)
            )
            
            console.print(f"[green]Successfully fetched {len(df)} breakout stocks[/green]")
            console.print(f"[blue]Stocks with >{min_change}% moves and >{min_volume_ratio}x volume: {total_rows}[/blue]")
            return df
            
        except Exception as e:
            console.print(f"[red]Error in get_breakout_stocks: {str(e)}[/red]")
            return pd.DataFrame()
'''

command_line_args = '''
    parser.add_argument('--volatile', action='store_true', help='Screen for volatile stocks')
    parser.add_argument('--breakout', action='store_true', help='Screen for breakout stocks')
    parser.add_argument('--min-volume-ratio', type=float, default=1.2, help='Minimum volume ratio vs average')
    parser.add_argument('--min-volatility', type=float, default=0.02, help='Minimum daily volatility (2% = 0.02)')
    parser.add_argument('--min-change', type=float, default=3.0, help='Minimum daily change % for breakouts')
'''

main_function_addition = '''
        # Screen for volatile stocks if requested
        if args.volatile:
            console.print("\\n[yellow]Screening for High Volatility Stocks...[/yellow]")
            volatile_df = screener.get_volatile_stocks(
                min_volume_ratio=args.min_volume_ratio,
                min_volatility=args.min_volatility,
                limit=100
            )
            screener.display_results(volatile_df, "High Volatility Stocks")
            export_results(volatile_df, "High Volatility Stocks", args.export_format)
        
        # Screen for breakout stocks if requested  
        if args.breakout:
            console.print("\\n[yellow]Screening for Breakout Stocks...[/yellow]")
            breakout_df = screener.get_breakout_stocks(
                min_change=args.min_change,
                min_volume_ratio=args.min_volume_ratio,
                limit=50
            )
            screener.display_results(breakout_df, "Breakout Stocks")
            export_results(breakout_df, "Breakout Stocks", args.export_format)
'''

print("🔧 Here's how to add volatility screening to your TV screener:")
print("\n1. Add these methods to the TVScreener class:")
print(volatility_method)
print("\n2. Add these command line arguments:")
print(command_line_args)
print("\n3. Add this to the main() function after the existing screening:")
print(main_function_addition)
print("\n4. Then you can use it like:")
print("   python tv_screener.py --volatile --min-volume-ratio 1.5 --min-volatility 0.03")
print("   python tv_screener.py --breakout --min-change 5.0 --min-volume-ratio 2.0")