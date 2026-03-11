#!/usr/bin/env python3
"""
US Market Research & Analysis Script
=====================================

This script is designed specifically for research purposes on US stocks.
It provides comprehensive screening and analysis tools without any trading functionality.

Features:
- Real-time market screening
- Technical analysis and pattern detection
- Sector and industry analysis
- Momentum and volatility analysis
- Gap analysis
- Market sentiment indicators
"""

import os
import sys
import time
import json
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress
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

class USMarketResearch:
    """US Market Research and Analysis Toolkit"""
    
    def __init__(self):
        self.market = 'america'  # US market
        self.currency_symbol = '$'
        self.research_data = {}
        console.print(Panel.fit("[bold blue]US Market Research Toolkit[/bold blue]", style="blue"))
        console.print(f"[green]Market: {self.market.upper()} | Currency: {self.currency_symbol}[/green]")
    
    def get_tradingview_cookies(self):
        """Get TradingView cookies for authenticated access"""
        try:
            import rookiepy
            cookies = rookiepy.chrome(['https://www.tradingview.com'])
            return cookies
        except Exception as e:
            console.print(f"[yellow]⚠️ Could not get TradingView cookies: {e}[/yellow]")
            return None
    
    def screen_high_volume_stocks(self, min_price=20, min_volume=1000000, limit=50):
        """Screen for high volume US stocks"""
        console.print(Panel.fit("📈 HIGH VOLUME SCREEN", style="cyan"))
        
        if not TRADINGVIEW_AVAILABLE:
            console.print("[red]❌ TradingView screener not available[/red]")
            return pd.DataFrame()
        
        try:
            cookies = self.get_tradingview_cookies()
            
            query = (Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'market_cap_basic', 'Perf.W', 'Perf.3M', 'Perf.6M', 'Perf.Y')
                    .set_markets(self.market)
                    .where(
                        col('close') > min_price,
                        col('volume') > min_volume,
                        col('market_cap_basic') > 1e9,  # $1B minimum market cap
                        col('exchange') == 'NASDAQ'
                    )
                    .order_by('relative_volume_10d_calc', ascending=False)
                    .limit(limit))
            
            if cookies:
                total_rows, df = query.get_scanner_data(cookies=cookies)
            else:
                total_rows, df = query.get_scanner_data()
            
            if not df.empty:
                console.print(f"[green]✅ Found {len(df)} high volume stocks[/green]")
                return df
            else:
                console.print("[yellow]⚠️ No stocks found matching criteria[/yellow]")
                return pd.DataFrame()
                
        except Exception as e:
            console.print(f"[red]❌ Error screening high volume stocks: {e}[/red]")
            return pd.DataFrame()
    
    def screen_momentum_leaders(self, min_price=30, min_volume=500000, limit=50):
        """Screen for momentum leading US stocks"""
        console.print(Panel.fit("🚀 MOMENTUM LEADERS", style="green"))
        
        if not TRADINGVIEW_AVAILABLE:
            console.print("[red]❌ TradingView screener not available[/red]")
            return pd.DataFrame()
        
        try:
            cookies = self.get_tradingview_cookies()
            
            query = (Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'market_cap_basic', 'Perf.W', 'Perf.3M', 'Perf.6M', 'Perf.Y',
                           'price_52_week_high', 'price_52_week_low')
                    .set_markets(self.market)
                    .where(
                        col('close') > min_price,
                        col('volume') > min_volume,
                        col('market_cap_basic') > 5e8,  # $500M minimum market cap
                        col('Perf.W') > 5,  # Weekly performance > 5%
                        col('RSI').between(50, 80),  # Healthy momentum
                        col('exchange').isin(['NASDAQ', 'NYSE'])
                    )
                    .order_by('Perf.W', ascending=False)
                    .limit(limit))
            
            if cookies:
                total_rows, df = query.get_scanner_data(cookies=cookies)
            else:
                total_rows, df = query.get_scanner_data()
            
            if not df.empty:
                # Add momentum score
                df['momentum_score'] = (
                    df['Perf.W'] * 0.4 +
                    df['Perf.3M'] * 0.3 +
                    df['Perf.6M'] * 0.2 +
                    df['change'] * 0.1
                )
                df = df.sort_values('momentum_score', ascending=False)
                console.print(f"[green]✅ Found {len(df)} momentum leaders[/green]")
                return df
            else:
                console.print("[yellow]⚠️ No stocks found matching criteria[/yellow]")
                return pd.DataFrame()
                
        except Exception as e:
            console.print(f"[red]❌ Error screening momentum leaders: {e}[/red]")
            return pd.DataFrame()
    
    def screen_value_opportunities(self, min_price=15, limit=50):
        """Screen for value opportunities in US stocks"""
        console.print(Panel.fit("💎 VALUE OPPORTUNITIES", style="magenta"))
        
        if not TRADINGVIEW_AVAILABLE:
            console.print("[red]❌ TradingView screener not available[/red]")
            return pd.DataFrame()
        
        try:
            cookies = self.get_tradingview_cookies()
            
            query = (Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'market_cap_basic', 'P/E', 'P/B', 'P/S', 'PEG', 'Dividend_yield',
                           'EPS.this.Y', 'EPS.next.Y', 'ROE', 'Debt/Equity')
                    .set_markets(self.market)
                    .where(
                        col('close') > min_price,
                        col('market_cap_basic') > 1e8,  # $100M minimum market cap
                        col('P/E').between(5, 25),  # Reasonable P/E ratio
                        col('P/B').between(0.5, 3),  # Reasonable P/B ratio
                        col('EPS.this.Y') > 0,  # Positive earnings
                        col('ROE') > 10,  # ROE > 10%
                        col('exchange').isin(['NASDAQ', 'NYSE'])
                    )
                    .order_by('P/E', ascending=True)
                    .limit(limit))
            
            if cookies:
                total_rows, df = query.get_scanner_data(cookies=cookies)
            else:
                total_rows, df = query.get_scanner_data()
            
            if not df.empty:
                # Add value score
                df['value_score'] = (
                    (30 - df['P/E']) * 0.3 +
                    (5 - df['P/B']) * 0.2 +
                    df['ROE'] * 0.2 +
                    df['EPS.this.Y'] * 0.2 +
                    df['Dividend_yield'] * 0.1
                )
                df = df.sort_values('value_score', ascending=False)
                console.print(f"[green]✅ Found {len(df)} value opportunities[/green]")
                return df
            else:
                console.print("[yellow]⚠️ No stocks found matching criteria[/yellow]")
                return pd.DataFrame()
                
        except Exception as e:
            console.print(f"[red]❌ Error screening value opportunities: {e}[/red]")
            return pd.DataFrame()
    
    def analyze_sector_performance(self):
        """Analyze sector performance in US market"""
        console.print(Panel.fit("🏭 SECTOR PERFORMANCE ANALYSIS", style="yellow"))
        
        if not TRADINGVIEW_AVAILABLE:
            console.print("[red]❌ TradingView screener not available[/red]")
            return pd.DataFrame()
        
        try:
            cookies = self.get_tradingview_cookies()
            
            # Get sector ETFs performance
            sector_etfs = ['XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLI', 'XLB', 'XLRE', 'XLC', 'XLP', 'XLU']
            
            query = (Query()
                    .select('name', 'close', 'change', 'Perf.W', 'Perf.3M', 'Perf.6M', 'Perf.Y',
                           'volume', 'relative_volume_10d_calc')
                    .set_markets(self.market)
                    .where(
                        col('name').isin(sector_etfs)
                    ))
            
            if cookies:
                total_rows, df = query.get_scanner_data(cookies=cookies)
            else:
                total_rows, df = query.get_scanner_data()
            
            if not df.empty:
                # Map ETFs to sector names
                sector_mapping = {
                    'XLK': 'Technology',
                    'XLF': 'Financials',
                    'XLV': 'Healthcare',
                    'XLE': 'Energy',
                    'XLY': 'Consumer Discretionary',
                    'XLI': 'Industrials',
                    'XLB': 'Materials',
                    'XLRE': 'Real Estate',
                    'XLC': 'Communication Services',
                    'XLP': 'Consumer Staples',
                    'XLU': 'Utilities'
                }
                
                df['sector'] = df['name'].map(sector_mapping)
                df = df.sort_values('Perf.W', ascending=False)
                
                console.print(f"[green]✅ Analyzed {len(df)} sector ETFs[/green]")
                return df
            else:
                console.print("[yellow]⚠️ No sector ETFs found[/yellow]")
                return pd.DataFrame()
                
        except Exception as e:
            console.print(f"[red]❌ Error analyzing sector performance: {e}[/red]")
            return pd.DataFrame()
    
    def detect_gap_opportunities(self, min_gap_pct=2.0, limit=30):
        """Detect gap opportunities in US stocks"""
        console.print(Panel.fit("갭 GAP ANALYSIS", style="blue"))
        
        if not TRADINGVIEW_AVAILABLE:
            console.print("[red]❌ TradingView screener not available[/red]")
            return pd.DataFrame()
        
        try:
            cookies = self.get_tradingview_cookies()
            
            query = (Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'market_cap_basic', 'Perf.W', 'price_52_week_high')
                    .set_markets(self.market)
                    .where(
                        col('close') > 20,
                        col('volume') > 500000,
                        col('market_cap_basic') > 5e8,  # $500M minimum market cap
                        (col('change') > min_gap_pct) | (col('change') < -min_gap_pct),
                        col('exchange').isin(['NASDAQ', 'NYSE'])
                    )
                    .order_by('change', ascending=False)
                    .limit(limit * 2))  # Get more to filter later
            
            if cookies:
                total_rows, df = query.get_scanner_data(cookies=cookies)
            else:
                total_rows, df = query.get_scanner_data()
            
            if not df.empty:
                # Filter for quality gaps
                df['gap_quality'] = abs(df['change']) * df['relative_volume_10d_calc']
                df = df[df['gap_quality'] > (min_gap_pct * 1.5)]
                df = df.sort_values('gap_quality', ascending=False).head(limit)
                
                console.print(f"[green]✅ Found {len(df)} quality gap opportunities[/green]")
                return df
            else:
                console.print("[yellow]⚠️ No gap opportunities found[/yellow]")
                return pd.DataFrame()
                
        except Exception as e:
            console.print(f"[red]❌ Error detecting gap opportunities: {e}[/red]")
            return pd.DataFrame()
    
    def calculate_technical_indicators(self, df):
        """Calculate technical indicators for stocks in the dataframe"""
        if not TECHNICAL_ANALYSIS_AVAILABLE or df.empty:
            return df
        
        try:
            # This is a simplified version - in practice, you'd fetch historical data
            # and calculate indicators using TA-Lib
            console.print("[dim]Calculating technical indicators...[/dim]")
            
            # Add placeholder indicators (in a real implementation, you'd calculate these)
            df['SMA_20'] = df['close'] * 1.01  # Placeholder
            df['SMA_50'] = df['close'] * 0.99  # Placeholder
            df['BB_upper'] = df['close'] * 1.05  # Placeholder
            df['BB_lower'] = df['close'] * 0.95  # Placeholder
            
            return df
            
        except Exception as e:
            console.print(f"[yellow]⚠️ Error calculating technical indicators: {e}[/yellow]")
            return df
    
    def display_results(self, df, title, columns=None):
        """Display research results in a formatted table"""
        if df.empty:
            console.print(f"[yellow]⚠️ No data to display for {title}[/yellow]")
            return
        
        if columns is None:
            columns = ['name', 'close', 'change', 'volume', 'relative_volume_10d_calc']
        
        # Limit columns to those that exist in the dataframe
        available_columns = [col for col in columns if col in df.columns]
        
        table = Table(title=title, show_header=True, header_style="bold magenta")
        
        # Add columns to table
        for col in available_columns:
            table.add_column(col.replace('_', ' ').title(), justify="right" if col not in ['name', 'sector'] else "left")
        
        # Add rows to table (limit to 20 rows for readability)
        for _, row in df.head(20).iterrows():
            table_row = []
            for col in available_columns:
                if col in ['close', 'volume']:
                    if pd.notna(row[col]):
                        table_row.append(f"{row[col]:,.0f}")
                    else:
                        table_row.append("N/A")
                elif col in ['change', 'Perf.W', 'Perf.3M', 'Perf.6M', 'Perf.Y']:
                    if pd.notna(row[col]):
                        table_row.append(f"{row[col]:+.2f}%")
                    else:
                        table_row.append("N/A")
                elif col in ['relative_volume_10d_calc', 'RSI']:
                    if pd.notna(row[col]):
                        table_row.append(f"{row[col]:.2f}")
                    else:
                        table_row.append("N/A")
                else:
                    table_row.append(str(row[col])[:20] if pd.notna(row[col]) else "N/A")
            table.add_row(*table_row)
        
        console.print(table)
    
    def save_research_data(self, df, filename):
        """Save research data to CSV file"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filepath = f"research_data/{filename}_{timestamp}.csv"
            
            # Create directory if it doesn't exist
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            
            df.to_csv(filepath, index=False)
            console.print(f"[green]✅ Research data saved to {filepath}[/green]")
            
        except Exception as e:
            console.print(f"[red]❌ Error saving research data: {e}[/red]")
    
    def run_comprehensive_research(self):
        """Run comprehensive US market research"""
        console.print(Panel.fit("[bold]🔬 COMPREHENSIVE US MARKET RESEARCH[/bold]", style="bold blue"))
        
        with Progress() as progress:
            task = progress.add_task("[cyan]Running research...", total=5)
            
            # 1. High Volume Analysis
            progress.update(task, description="[cyan]Analyzing high volume stocks...")
            high_volume_stocks = self.screen_high_volume_stocks()
            self.display_results(high_volume_stocks, "📈 HIGH VOLUME STOCKS", 
                               ['name', 'close', 'change', 'volume', 'relative_volume_10d_calc'])
            if not high_volume_stocks.empty:
                self.save_research_data(high_volume_stocks, "high_volume_stocks")
            progress.advance(task)
            
            # 2. Momentum Analysis
            progress.update(task, description="[green]Analyzing momentum leaders...")
            momentum_leaders = self.screen_momentum_leaders()
            self.display_results(momentum_leaders, "🚀 MOMENTUM LEADERS", 
                               ['name', 'close', 'change', 'Perf.W', 'Perf.3M', 'RSI'])
            if not momentum_leaders.empty:
                self.save_research_data(momentum_leaders, "momentum_leaders")
            progress.advance(task)
            
            # 3. Value Analysis
            progress.update(task, description="[magenta]Analyzing value opportunities...")
            value_opportunities = self.screen_value_opportunities()
            self.display_results(value_opportunities, "💎 VALUE OPPORTUNITIES", 
                               ['name', 'close', 'P/E', 'P/B', 'ROE', 'EPS.this.Y'])
            if not value_opportunities.empty:
                self.save_research_data(value_opportunities, "value_opportunities")
            progress.advance(task)
            
            # 4. Sector Analysis
            progress.update(task, description="[yellow]Analyzing sector performance...")
            sector_performance = self.analyze_sector_performance()
            self.display_results(sector_performance, "🏭 SECTOR PERFORMANCE", 
                               ['name', 'sector', 'change', 'Perf.W', 'Perf.3M'])
            if not sector_performance.empty:
                self.save_research_data(sector_performance, "sector_performance")
            progress.advance(task)
            
            # 5. Gap Analysis
            progress.update(task, description="[blue]Analyzing gap opportunities...")
            gap_opportunities = self.detect_gap_opportunities()
            self.display_results(gap_opportunities, "갭 GAP OPPORTUNITIES", 
                               ['name', 'close', 'change', 'volume'])
            if not gap_opportunities.empty:
                self.save_research_data(gap_opportunities, "gap_opportunities")
            progress.advance(task)
            
            progress.update(task, description="[green]Research complete!")
        
        console.print("\n[bold green]🔬 COMPREHENSIVE US MARKET RESEARCH COMPLETE[/bold green]")
        console.print("[dim]Data saved in research_data/ directory[/dim]")

def show_help():
    """Show help information"""
    console.print(Panel.fit("[bold]US Market Research Toolkit - Help[/bold]", style="blue"))
    console.print("""
[cyan]Overview:[/cyan]
This toolkit provides comprehensive research capabilities for US stocks without any trading functionality.

[yellow]Main Features:[/yellow]
• High Volume Screening - Find stocks with unusual volume activity
• Momentum Analysis - Identify leading momentum stocks
• Value Research - Discover undervalued opportunities
• Sector Performance - Analyze sector rotation and leadership
• Gap Detection - Find stocks with significant price gaps
• Technical Analysis - Calculate key technical indicators

[green]Usage Examples:[/green]
python us_market_research.py --research                     Run comprehensive research
python us_market_research.py --high-volume                 High volume screening only
python us_market_research.py --momentum                    Momentum analysis only
python us_market_research.py --value                       Value opportunities only
python us_market_research.py --sectors                    Sector performance analysis
python us_market_research.py --gaps                       Gap opportunity detection

[magenta]Customization:[/magenta]
--min-price [price]          Minimum stock price (default: varies by screen)
--limit [number]             Number of results to return (default: 50)
--save-data                  Save research data to CSV files

[red]Note:[/red] This tool is for research purposes only. It does not provide trading advice or execute trades.
""")

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='US Market Research Toolkit')
    parser.add_argument('--research', action='store_true', help='Run comprehensive research')
    parser.add_argument('--high-volume', action='store_true', help='High volume screening')
    parser.add_argument('--momentum', action='store_true', help='Momentum analysis')
    parser.add_argument('--value', action='store_true', help='Value opportunities')
    parser.add_argument('--sectors', action='store_true', help='Sector performance analysis')
    parser.add_argument('--gaps', action='store_true', help='Gap opportunity detection')
    parser.add_argument('--help-tool', action='store_true', help='Show detailed help')
    parser.add_argument('--min-price', type=float, default=None, help='Minimum stock price')
    parser.add_argument('--limit', type=int, default=50, help='Number of results to return')
    parser.add_argument('--save-data', action='store_true', help='Save research data to files')
    
    args = parser.parse_args()
    
    if args.help_tool:
        show_help()
        return
    
    # Initialize research tool
    researcher = USMarketResearch()
    
    # Run selected analysis
    if args.research:
        researcher.run_comprehensive_research()
    elif args.high_volume:
        min_price = args.min_price or 20
        df = researcher.screen_high_volume_stocks(min_price=min_price, limit=args.limit)
        researcher.display_results(df, f"📈 HIGH VOLUME STOCKS (${min_price}+)")
        if args.save_data and not df.empty:
            researcher.save_research_data(df, "high_volume_stocks_custom")
    elif args.momentum:
        min_price = args.min_price or 30
        df = researcher.screen_momentum_leaders(min_price=min_price, limit=args.limit)
        researcher.display_results(df, f"🚀 MOMENTUM LEADERS (${min_price}+)")
        if args.save_data and not df.empty:
            researcher.save_research_data(df, "momentum_leaders_custom")
    elif args.value:
        min_price = args.min_price or 15
        df = researcher.screen_value_opportunities(min_price=min_price, limit=args.limit)
        researcher.display_results(df, f"💎 VALUE OPPORTUNITIES (${min_price}+)")
        if args.save_data and not df.empty:
            researcher.save_research_data(df, "value_opportunities_custom")
    elif args.sectors:
        df = researcher.analyze_sector_performance()
        researcher.display_results(df, "🏭 SECTOR PERFORMANCE")
        if args.save_data and not df.empty:
            researcher.save_research_data(df, "sector_performance_custom")
    elif args.gaps:
        df = researcher.detect_gap_opportunities(limit=args.limit)
        researcher.display_results(df, "갭 GAP OPPORTUNITIES")
        if args.save_data and not df.empty:
            researcher.save_research_data(df, "gap_opportunities_custom")
    else:
        # Show help if no arguments provided
        show_help()

if __name__ == "__main__":
    main()