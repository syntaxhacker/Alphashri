#!/usr/bin/env python3
"""
Bullish & Bearish Stock Screener
================================

This script identifies stocks that are showing bullish or bearish signals
for potential upcoming moves based on technical analysis and momentum.

Features:
- Technical indicator analysis (RSI, MACD, Moving Averages)
- Momentum and trend detection
- Volume analysis
- Support/Resistance level identification
- Bullish/Bearish pattern recognition
"""

import os
import sys
import time
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import numpy as np

# Add project paths
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)

# Import TradingView screener
try:
    from tradingview_screener import Query, col
    TRADINGVIEW_AVAILABLE = True
except ImportError:
    TRADINGVIEW_AVAILABLE = False
    print("⚠️ TradingView screener not available")

# Import technical analysis libraries
try:
    import talib
    TECHNICAL_ANALYSIS_AVAILABLE = True
except ImportError:
    TECHNICAL_ANALYSIS_AVAILABLE = False
    print("⚠️ TA-Lib not available for technical analysis")

console = Console()

class BullBearScreener:
    """Bullish & Bearish Stock Screener for upcoming moves"""
    
    def __init__(self, market='america'):
        self.market = market
        self.currency_symbol = '$' if market == 'america' else '₹'
        console.print(Panel.fit(f"[bold blue]🐂🐻 BULLISH & BEARISH STOCK SCREENER[/bold blue]\n[cyan]Market: {market.upper()} | Currency: {self.currency_symbol}[/cyan]", style="blue"))
    
    def get_tradingview_cookies(self):
        """Get TradingView cookies for authenticated access"""
        try:
            import rookiepy
            cookies = rookiepy.get('https://www.tradingview.com/')
            return cookies
        except Exception as e:
            console.print(f"[yellow]⚠️ Could not get TradingView cookies: {e}[/yellow]")
            return None
    
    def fetch_base_data(self, limit=100):
        """Fetch base stock data for analysis"""
        if not TRADINGVIEW_AVAILABLE:
            console.print("[red]❌ TradingView screener not available[/red]")
            return pd.DataFrame()
        
        try:
            cookies = self.get_tradingview_cookies()
            
            # Fetch stocks with good fundamentals and momentum
            query = (Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                           'RSI', 'market_cap_basic', 'Perf.W', 'Perf.3M', 'Perf.6M', 'Perf.Y',
                           'price_52_week_high', 'price_52_week_low', 'EMA5', 'EMA10', 'EMA20', 'EMA50',
                           'SMA20', 'SMA50', 'MACD.macd', 'MACD.signal', 'BB.upper', 'BB.lower')
                    .set_markets(self.market)
                    .where(
                        col('close') > 10,  # Minimum $10 stock price
                        col('volume') > 100000,  # Minimum volume
                        col('market_cap_basic') > 50000000,  # $50M minimum market cap
                        col('relative_volume_10d_calc') > 0.5,  # Some volume activity
                        col('exchange').isin(['NASDAQ', 'NYSE']) if self.market == 'america' else col('exchange') == 'NSE'
                    )
                    .order_by('relative_volume_10d_calc', ascending=False)
                    .limit(limit))
            
            if cookies:
                total_rows, df = query.get_scanner_data(cookies=cookies)
            else:
                total_rows, df = query.get_scanner_data()
            
            return df if not df.empty else pd.DataFrame()
            
        except Exception as e:
            console.print(f"[red]❌ Error fetching base data: {e}[/red]")
            return pd.DataFrame()
    
    def calculate_technical_indicators(self, df):
        """Calculate additional technical indicators"""
        if df.empty:
            return df
        
        try:
            # Add technical scores
            df['technical_score'] = 0
            
            # RSI Analysis (30-70 is healthy range)
            df['rsi_score'] = df['RSI'].apply(lambda x: 
                2 if 50 <= x <= 65 else  # Strong bullish RSI
                1 if 45 <= x <= 70 else  # Moderate bullish RSI
                -1 if 30 <= x <= 45 else  # Moderate bearish RSI
                -2 if x < 30 else  # Strong bearish RSI (oversold - potential bounce)
                0
            )
            
            # MACD Analysis
            df['macd_score'] = 0
            macd_bullish = (df['MACD.macd'] > df['MACD.signal']) & (df['MACD.macd'] > 0)
            macd_bearish = (df['MACD.macd'] < df['MACD.signal']) & (df['MACD.macd'] < 0)
            df.loc[macd_bullish, 'macd_score'] = 2
            df.loc[macd_bearish, 'macd_score'] = -2
            
            # Moving Average Analysis
            df['ma_score'] = 0
            # Price above key MAs with upward trend
            ma_bullish = (df['close'] > df['EMA20']) & (df['EMA20'] > df['EMA50']) & (df['EMA20'] > df['EMA20'].shift(1))
            # Price below key MAs with downward trend
            ma_bearish = (df['close'] < df['EMA20']) & (df['EMA20'] < df['EMA50']) & (df['EMA20'] < df['EMA20'].shift(1))
            df.loc[ma_bullish, 'ma_score'] = 2
            df.loc[ma_bearish, 'ma_score'] = -2
            
            # Volume Analysis
            df['volume_score'] = 0
            high_volume = df['relative_volume_10d_calc'] > 1.5
            low_volume = df['relative_volume_10d_calc'] < 0.8
            df.loc[high_volume, 'volume_score'] = 1
            df.loc[low_volume, 'volume_score'] = -1
            
            # Price Action Analysis
            df['price_action_score'] = 0
            # Strong positive moves
            strong_positive = df['change'] > 3
            # Strong negative moves
            strong_negative = df['change'] < -3
            df.loc[strong_positive, 'price_action_score'] = 2
            df.loc[strong_negative, 'price_action_score'] = -2
            
            # Bollinger Band Analysis
            df['bb_score'] = 0
            # Near upper band (potential overbought)
            near_upper_bb = (df['close'] > df['BB.upper'] * 0.95) & (df['close'] < df['BB.upper'] * 1.05)
            # Near lower band (potential oversold)
            near_lower_bb = (df['close'] < df['BB.lower'] * 1.05) & (df['close'] > df['BB.lower'] * 0.95)
            df.loc[near_upper_bb, 'bb_score'] = -1  # Potential reversal
            df.loc[near_lower_bb, 'bb_score'] = 1   # Potential bounce
            
            # Overall technical score
            df['technical_score'] = (
                df['rsi_score'] + 
                df['macd_score'] + 
                df['ma_score'] + 
                df['volume_score'] + 
                df['price_action_score'] + 
                df['bb_score']
            )
            
            return df
            
        except Exception as e:
            console.print(f"[yellow]⚠️ Error calculating technical indicators: {e}[/yellow]")
            return df
    
    def identify_bullish_stocks(self, df, limit=20):
        """Identify stocks with bullish signals for upcoming moves"""
        if df.empty:
            return pd.DataFrame()
        
        try:
            # Filter for bullish conditions
            bullish_conditions = (
                (df['technical_score'] > 2) &  # Overall bullish technical score
                (df['RSI'].between(45, 70)) &  # Healthy RSI range
                (df['MACD.macd'] > df['MACD.signal']) &  # MACD bullish crossover
                (df['close'] > df['EMA20']) &  # Price above 20 EMA
                (df['EMA20'] > df['EMA50']) &  # Bullish MA alignment
                (df['Perf.W'] > -5) &  # Not recently crashing
                (df['relative_volume_10d_calc'] > 1.0)  # Above average volume
            )
            
            bullish_df = df[bullish_conditions].copy()
            
            if not bullish_df.empty:
                # Add bullish strength score
                bullish_df['bullish_strength'] = (
                    bullish_df['technical_score'] * 2 +
                    bullish_df['Perf.W'] * 0.5 +
                    bullish_df['Perf.3M'] * 0.3 +
                    bullish_df['relative_volume_10d_calc'] * 2
                )
                
                # Sort by bullish strength
                bullish_df = bullish_df.sort_values('bullish_strength', ascending=False)
            
            return bullish_df.head(limit)
            
        except Exception as e:
            console.print(f"[red]❌ Error identifying bullish stocks: {e}[/red]")
            return pd.DataFrame()
    
    def identify_bearish_stocks(self, df, limit=20):
        """Identify stocks with bearish signals for upcoming moves"""
        if df.empty:
            return pd.DataFrame()
        
        try:
            # Filter for bearish conditions
            bearish_conditions = (
                (df['technical_score'] < -2) &  # Overall bearish technical score
                ((df['RSI'] < 35) | (df['RSI'] > 80)) &  # Oversold bounce OR overbought failure
                (df['MACD.macd'] < df['MACD.signal']) &  # MACD bearish crossover
                (df['close'] < df['EMA20']) &  # Price below 20 EMA
                (df['EMA20'] < df['EMA50']) &  # Bearish MA alignment
                (df['Perf.W'] < 5) &  # Not recently exploding
                (df['relative_volume_10d_calc'] > 1.0)  # Above average volume
            )
            
            bearish_df = df[bearish_conditions].copy()
            
            if not bearish_df.empty:
                # Add bearish strength score (more negative = stronger bearish signal)
                bearish_df['bearish_strength'] = (
                    abs(bearish_df['technical_score']) * 2 +
                    abs(bearish_df['Perf.W']) * 0.5 +
                    abs(bearish_df['Perf.3M']) * 0.3 +
                    bearish_df['relative_volume_10d_calc'] * 2
                )
                
                # Sort by bearish strength
                bearish_df = bearish_df.sort_values('bearish_strength', ascending=False)
            
            return bearish_df.head(limit)
            
        except Exception as e:
            console.print(f"[red]❌ Error identifying bearish stocks: {e}[/red]")
            return pd.DataFrame()
    
    def identify_consensus_stocks(self, df, limit=15):
        """Identify stocks with strong consensus signals"""
        if df.empty:
            return pd.DataFrame()
        
        try:
            # Look for stocks with very strong technical scores and momentum
            consensus_conditions = (
                (abs(df['technical_score']) > 4) &  # Very strong technical signals
                (df['relative_volume_10d_calc'] > 2.0) &  # High volume confirmation
                (abs(df['change']) > 2) &  # Significant moves
                (abs(df['Perf.W']) > 5)  # Strong weekly performance
            )
            
            consensus_df = df[consensus_conditions].copy()
            
            if not consensus_df.empty:
                # Add consensus strength score
                consensus_df['consensus_strength'] = (
                    abs(consensus_df['technical_score']) * 3 +
                    consensus_df['relative_volume_10d_calc'] * 2 +
                    abs(consensus_df['change']) * 2 +
                    abs(consensus_df['Perf.W']) * 1
                )
                
                # Sort by consensus strength
                consensus_df = consensus_df.sort_values('consensus_strength', ascending=False)
            
            return consensus_df.head(limit)
            
        except Exception as e:
            console.print(f"[red]❌ Error identifying consensus stocks: {e}[/red]")
            return pd.DataFrame()
    
    def display_bullish_stocks(self, df):
        """Display bullish stocks in a formatted table"""
        if df.empty:
            console.print("[yellow]⚠️ No bullish stocks identified[/yellow]")
            return
        
        table = Table(title="🐂 BULLISH STOCKS (Potential Upside)", show_header=True, header_style="bold green")
        table.add_column("Symbol", style="cyan", no_wrap=True)
        table.add_column("Price", justify="right", style="green")
        table.add_column("Change", justify="right", style="green")
        table.add_column("RSI", justify="right", style="white")
        table.add_column("Volume", justify="right", style="blue")
        table.add_column("Weekly", justify="right", style="yellow")
        table.add_column("Score", justify="right", style="bold")
        
        for _, row in df.head(15).iterrows():
            change_color = "green" if row['change'] > 0 else "red"
            weekly_color = "green" if row['Perf.W'] > 0 else "red"
            
            table.add_row(
                row['name'][:12],
                f"${row['close']:.2f}",
                f"[{change_color}]{row['change']:+.2f}%[/{change_color}]",
                f"{row['RSI']:.1f}",
                f"{row['relative_volume_10d_calc']:.1f}x",
                f"[{weekly_color}]{row['Perf.W']:+.1f}%[/{weekly_color}]",
                f"{row['bullish_strength']:.1f}"
            )
        
        console.print(table)
    
    def display_bearish_stocks(self, df):
        """Display bearish stocks in a formatted table"""
        if df.empty:
            console.print("[yellow]⚠️ No bearish stocks identified[/yellow]")
            return
        
        table = Table(title="🐻 BEARISH STOCKS (Potential Downside)", show_header=True, header_style="bold red")
        table.add_column("Symbol", style="cyan", no_wrap=True)
        table.add_column("Price", justify="right", style="red")
        table.add_column("Change", justify="right", style="red")
        table.add_column("RSI", justify="right", style="white")
        table.add_column("Volume", justify="right", style="blue")
        table.add_column("Weekly", justify="right", style="yellow")
        table.add_column("Score", justify="right", style="bold")
        
        for _, row in df.head(15).iterrows():
            change_color = "green" if row['change'] > 0 else "red"
            weekly_color = "green" if row['Perf.W'] > 0 else "red"
            
            table.add_row(
                row['name'][:12],
                f"${row['close']:.2f}",
                f"[{change_color}]{row['change']:+.2f}%[/{change_color}]",
                f"{row['RSI']:.1f}",
                f"{row['relative_volume_10d_calc']:.1f}x",
                f"[{weekly_color}]{row['Perf.W']:+.1f}%[/{weekly_color}]",
                f"{row['bearish_strength']:.1f}"
            )
        
        console.print(table)
    
    def display_consensus_stocks(self, df):
        """Display stocks with strong consensus signals"""
        if df.empty:
            console.print("[yellow]⚠️ No consensus stocks identified[/yellow]")
            return
        
        table = Table(title="🎯 STRONG CONSENSUS STOCKS", show_header=True, header_style="bold magenta")
        table.add_column("Symbol", style="cyan", no_wrap=True)
        table.add_column("Price", justify="right", style="white")
        table.add_column("Change", justify="right", style="white")
        table.add_column("Signal", justify="center", style="bold")
        table.add_column("Volume", justify="right", style="blue")
        table.add_column("Strength", justify="right", style="bold")
        
        for _, row in df.head(10).iterrows():
            # Determine consensus signal
            if row['technical_score'] > 0:
                signal = "🟢 BULLISH"
                signal_style = "green"
            else:
                signal = "🔴 BEARISH"
                signal_style = "red"
            
            change_color = "green" if row['change'] > 0 else "red"
            
            table.add_row(
                row['name'][:12],
                f"${row['close']:.2f}",
                f"[{change_color}]{row['change']:+.2f}%[/{change_color}]",
                f"[{signal_style}]{signal}[/{signal_style}]",
                f"{row['relative_volume_10d_calc']:.1f}x",
                f"{row['consensus_strength']:.1f}"
            )
        
        console.print(table)
    
    def save_results(self, bullish_df, bearish_df, consensus_df):
        """Save results to CSV files"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_dir = "bull_bear_analysis"
            os.makedirs(output_dir, exist_ok=True)
            
            if not bullish_df.empty:
                bullish_df.to_csv(f"{output_dir}/bullish_stocks_{timestamp}.csv", index=False)
                console.print(f"[green]✅ Bullish stocks saved to {output_dir}/bullish_stocks_{timestamp}.csv[/green]")
            
            if not bearish_df.empty:
                bearish_df.to_csv(f"{output_dir}/bearish_stocks_{timestamp}.csv", index=False)
                console.print(f"[green]✅ Bearish stocks saved to {output_dir}/bearish_stocks_{timestamp}.csv[/green]")
            
            if not consensus_df.empty:
                consensus_df.to_csv(f"{output_dir}/consensus_stocks_{timestamp}.csv", index=False)
                console.print(f"[green]✅ Consensus stocks saved to {output_dir}/consensus_stocks_{timestamp}.csv[/green]")
                
        except Exception as e:
            console.print(f"[red]❌ Error saving results: {e}[/red]")
    
    def run_analysis(self, save_data=False):
        """Run complete bullish/bearish analysis"""
        console.print(Panel.fit("[bold]🔬 RUNNING BULLISH & BEARISH STOCK ANALYSIS[/bold]", style="bold blue"))
        
        # Step 1: Fetch base data
        console.print("[cyan]📥 Fetching stock data...[/cyan]")
        base_df = self.fetch_base_data(limit=200)
        
        if base_df.empty:
            console.print("[red]❌ No data available for analysis[/red]")
            return
        
        console.print(f"[green]✅ Fetched {len(base_df)} stocks for analysis[/green]")
        
        # Step 2: Calculate technical indicators
        console.print("[cyan]🧮 Calculating technical indicators...[/cyan]")
        tech_df = self.calculate_technical_indicators(base_df)
        
        # Step 3: Identify bullish stocks
        console.print("[cyan]🐂 Identifying bullish stocks...[/cyan]")
        bullish_df = self.identify_bullish_stocks(tech_df, limit=25)
        
        # Step 4: Identify bearish stocks
        console.print("[cyan]🐻 Identifying bearish stocks...[/cyan]")
        bearish_df = self.identify_bearish_stocks(tech_df, limit=25)
        
        # Step 5: Identify consensus stocks
        console.print("[cyan]🎯 Identifying consensus stocks...[/cyan]")
        consensus_df = self.identify_consensus_stocks(tech_df, limit=20)
        
        # Step 6: Display results
        console.print("\n" + "="*80)
        self.display_bullish_stocks(bullish_df)
        console.print("\n" + "="*80)
        self.display_bearish_stocks(bearish_df)
        console.print("\n" + "="*80)
        self.display_consensus_stocks(consensus_df)
        
        # Step 7: Save data if requested
        if save_data:
            console.print("\n[cyan]💾 Saving results to CSV files...[/cyan]")
            self.save_results(bullish_df, bearish_df, consensus_df)
        
        # Summary
        console.print(f"\n[bold green]🎉 ANALYSIS COMPLETE[/bold green]")
        console.print(f"[green]📊 Results Summary:[/green]")
        console.print(f"   🐂 Bullish Stocks: {len(bullish_df)}")
        console.print(f"   🐻 Bearish Stocks: {len(bearish_df)}")
        console.print(f"   🎯 Consensus Stocks: {len(consensus_df)}")
        
        if save_data:
            console.print(f"[green]📁 Data saved in bull_bear_analysis/ directory[/green]")

def show_help():
    """Show help information"""
    console.print(Panel.fit("[bold]Bullish & Bearish Stock Screener - Help[/bold]", style="blue"))
    console.print("""
[cyan]Overview:[/cyan]
This tool identifies stocks showing bullish or bearish signals for potential upcoming moves
based on technical analysis and momentum indicators.

[yellow]Features:[/yellow]
• Bullish Stock Identification - Stocks with positive technical signals
• Bearish Stock Identification - Stocks with negative technical signals  
• Consensus Stocks - Stocks with very strong directional signals
• Technical Analysis - RSI, MACD, Moving Averages, Bollinger Bands
• Momentum Analysis - Volume, Price Action, Performance Metrics

[green]Usage:[/green]
python bull_bear_screener.py                      Run complete analysis
python bull_bear_screener.py --bullish           Bullish stocks only
python bull_bear_screener.py --bearish           Bearish stocks only
python bull_bear_screener.py --consensus         Strong consensus stocks
python bull_bear_screener.py --save              Save results to CSV files
python bull_bear_screener.py --limit 50          Limit results to 50 stocks

[magenta]Requirements:[/magenta]
• tradingview-screener
• rich
• pandas
• numpy
• talib (optional, for advanced technical analysis)

[red]Note:[/red] This tool is for research purposes only. It does not provide trading advice.
All financial decisions should be made independently with proper research and risk management.
""")

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Bullish & Bearish Stock Screener')
    parser.add_argument('--bullish', action='store_true', help='Show bullish stocks only')
    parser.add_argument('--bearish', action='store_true', help='Show bearish stocks only')
    parser.add_argument('--consensus', action='store_true', help='Show consensus stocks only')
    parser.add_argument('--save', action='store_true', help='Save results to CSV files')
    parser.add_argument('--limit', type=int, default=25, help='Limit results (default: 25)')
    parser.add_argument('--market', type=str, default='america', choices=['america', 'india'], 
                       help='Market to analyze (default: america)')
    parser.add_argument('--help-tool', action='store_true', help='Show detailed help')
    
    args = parser.parse_args()
    
    if args.help_tool:
        show_help()
        return
    
    # Initialize screener
    screener = BullBearScreener(market=args.market)
    
    # Run selected analysis
    if args.bullish:
        console.print("[cyan]🐂 Analyzing bullish stocks only...[/cyan]")
        base_df = screener.fetch_base_data(limit=100)
        if not base_df.empty:
            tech_df = screener.calculate_technical_indicators(base_df)
            bullish_df = screener.identify_bullish_stocks(tech_df, limit=args.limit)
            screener.display_bullish_stocks(bullish_df)
            if args.save and not bullish_df.empty:
                bullish_df.to_csv(f"bullish_stocks_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv", index=False)
    elif args.bearish:
        console.print("[cyan]🐻 Analyzing bearish stocks only...[/cyan]")
        base_df = screener.fetch_base_data(limit=100)
        if not base_df.empty:
            tech_df = screener.calculate_technical_indicators(base_df)
            bearish_df = screener.identify_bearish_stocks(tech_df, limit=args.limit)
            screener.display_bearish_stocks(bearish_df)
            if args.save and not bearish_df.empty:
                bearish_df.to_csv(f"bearish_stocks_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv", index=False)
    elif args.consensus:
        console.print("[cyan]🎯 Analyzing consensus stocks only...[/cyan]")
        base_df = screener.fetch_base_data(limit=100)
        if not base_df.empty:
            tech_df = screener.calculate_technical_indicators(base_df)
            consensus_df = screener.identify_consensus_stocks(tech_df, limit=args.limit)
            screener.display_consensus_stocks(consensus_df)
            if args.save and not consensus_df.empty:
                consensus_df.to_csv(f"consensus_stocks_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv", index=False)
    else:
        # Run complete analysis
        screener.run_analysis(save_data=args.save)

if __name__ == "__main__":
    main()