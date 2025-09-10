#!/usr/bin/env python3
"""
TOP 5 STOCK RECOMMENDATIONS
===========================

This script identifies the TOP 5 stocks with the strongest bullish signals
for potential short-term upside based on technical analysis.

⚠️  WARNING: This is for educational/research purposes only.
⚠️  Never invest based solely on algorithmic signals.
⚠️  Always do your own research and risk management.
"""

import os
import sys
import time
from datetime import datetime
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.prompt import Prompt
import pandas as pd

# Import TradingView components
try:
    from tradingview_screener import Query, col
except ImportError:
    Query = None
    col = None

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

console = Console()

class TopStockRecommender:
    """Recommend top 5 stocks based on strong technical signals"""
    
    def __init__(self, market='america'):
        self.market = market
        self.currency_symbol = '$' if market == 'america' else '₹'
    
    def get_tradingview_cookies(self):
        """Get TradingView cookies for authenticated access"""
        try:
            import rookiepy
            cookies = rookiepy.get('https://www.tradingview.com/')
            return cookies
        except Exception as e:
            return None
    
    def fetch_top_momentum_stocks(self, limit=30):
        """Fetch stocks with strong momentum and technical signals"""
        if not TRADINGVIEW_AVAILABLE or Query is None or col is None:
            return pd.DataFrame()
        
        try:
            cookies = self.get_tradingview_cookies()
            
            query = (Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                           'RSI', 'market_cap_basic', 'Perf.W', 'Perf.3M', 'Perf.6M', 'Perf.Y',
                           'price_52_week_high', 'price_52_week_low', 'EMA5', 'EMA10', 'EMA20', 'EMA50',
                           'SMA20', 'SMA50', 'MACD.macd', 'MACD.signal', 'BB.upper', 'BB.lower')
                    .set_markets(self.market)
                    .where(
                        col('close') > 15,  # Minimum $15 stock price
                        col('volume') > 200000,  # Decent volume
                        col('market_cap_basic') > 100000000,  # $100M minimum market cap
                        col('relative_volume_10d_calc') > 1.0,  # Above average volume
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
            return pd.DataFrame()
    
    def calculate_confidence_scores(self, df):
        """Calculate confidence scores for each stock"""
        if df.empty:
            return df
        
        try:
            # Add technical scores
            df['technical_score'] = 0
            
            # RSI Analysis (50-70 is strong bullish)
            df['rsi_score'] = df['RSI'].apply(lambda x: 
                3 if 55 <= x <= 65 else  # Perfect bullish RSI
                2 if 50 <= x <= 70 else  # Strong bullish RSI
                1 if 45 <= x <= 75 else   # Moderate bullish RSI
                -1 if 25 <= x <= 45 else  # Moderate bearish RSI
                -2 if x < 25 else         # Strong bearish RSI
                0
            )
            
            # MACD Analysis
            df['macd_score'] = 0
            # Strong bullish crossover
            strong_bullish_macd = (df['MACD.macd'] > df['MACD.signal']) & (df['MACD.macd'] > 0) & (df['MACD.macd'].shift(1) <= df['MACD.signal'].shift(1))
            # Moderate bullish
            moderate_bullish_macd = (df['MACD.macd'] > df['MACD.signal']) & (df['MACD.macd'] > df['MACD.macd'].shift(1))
            # Bearish signals
            bearish_macd = (df['MACD.macd'] < df['MACD.signal']) & (df['MACD.macd'] < 0)
            
            df.loc[strong_bullish_macd, 'macd_score'] = 3
            df.loc[moderate_bullish_macd, 'macd_score'] = 2
            df.loc[bearish_macd, 'macd_score'] = -2
            
            # Moving Average Analysis
            df['ma_score'] = 0
            # Strong bullish alignment
            strong_ma_bullish = (df['close'] > df['EMA20']) & (df['EMA20'] > df['EMA50']) & (df['EMA20'] > df['EMA20'].shift(1))
            # Moderate bullish
            moderate_ma_bullish = (df['close'] > df['EMA20']) & (df['close'] > df['SMA20'])
            # Bearish alignment
            ma_bearish = (df['close'] < df['EMA20']) & (df['EMA20'] < df['EMA50'])
            
            df.loc[strong_ma_bullish, 'ma_score'] = 3
            df.loc[moderate_ma_bullish, 'ma_score'] = 2
            df.loc[ma_bearish, 'ma_score'] = -2
            
            # Volume Analysis
            df['volume_score'] = 0
            strong_volume = df['relative_volume_10d_calc'] > 2.0
            moderate_volume = df['relative_volume_10d_calc'] > 1.5
            low_volume = df['relative_volume_10d_calc'] < 0.8
            
            df.loc[strong_volume, 'volume_score'] = 2
            df.loc[moderate_volume, 'volume_score'] = 1
            df.loc[low_volume, 'volume_score'] = -1
            
            # Price Action Analysis
            df['price_action_score'] = 0
            strong_positive = df['change'] > 3
            moderate_positive = df['change'] > 1
            strong_negative = df['change'] < -3
            moderate_negative = df['change'] < -1
            
            df.loc[strong_positive, 'price_action_score'] = 3
            df.loc[moderate_positive, 'price_action_score'] = 2
            df.loc[strong_negative, 'price_action_score'] = -3
            df.loc[moderate_negative, 'price_action_score'] = -2
            
            # Momentum Analysis
            df['momentum_score'] = 0
            strong_momentum = df['Perf.W'] > 5
            moderate_momentum = df['Perf.W'] > 2
            weak_momentum = df['Perf.W'] < -2
            bearish_momentum = df['Perf.W'] < -5
            
            df.loc[strong_momentum, 'momentum_score'] = 3
            df.loc[moderate_momentum, 'momentum_score'] = 2
            df.loc[weak_momentum, 'momentum_score'] = -2
            df.loc[bearish_momentum, 'momentum_score'] = -3
            
            # Overall technical score
            df['total_score'] = (
                df['rsi_score'] + 
                df['macd_score'] + 
                df['ma_score'] + 
                df['volume_score'] + 
                df['price_action_score'] + 
                df['momentum_score']
            )
            
            return df
            
        except Exception as e:
            return df
    
    def identify_top_candiates(self, df, limit=10):
        """Identify top candidates with strong signals"""
        if df.empty:
            return pd.DataFrame()
        
        try:
            # Filter for strong bullish conditions
            bullish_conditions = (
                (df['total_score'] > 5) &  # Strong overall score
                (df['RSI'].between(45, 75)) &  # Healthy RSI range
                (df['MACD.macd'] > df['MACD.signal']) &  # MACD bullish
                (df['close'] > df['EMA20']) &  # Price above 20 EMA
                (df['relative_volume_10d_calc'] > 1.2) &  # Above average volume
                (df['change'] > -2) &  # Not crashing
                (df['Perf.W'] > -5)  # Not in strong downtrend
            )
            
            bullish_df = df[bullish_conditions].copy()
            
            if not bullish_df.empty:
                # Add composite score
                bullish_df['composite_score'] = (
                    bullish_df['total_score'] * 2 +
                    bullish_df['Perf.W'] * 0.5 +
                    bullish_df['Perf.3M'] * 0.3 +
                    bullish_df['relative_volume_10d_calc'] * 1.5 +
                    abs(bullish_df['change']) * 1.0
                )
                
                # Sort by composite score
                bullish_df = bullish_df.sort_values('composite_score', ascending=False)
            
            return bullish_df.head(limit)
            
        except Exception as e:
            return pd.DataFrame()
    
    def display_disclaimer(self):
        """Display investment disclaimer"""
        disclaimer = Panel.fit("""[bold red]⚠️  IMPORTANT DISCLAIMER ⚠️[/bold red]

[yellow]This tool is for EDUCATIONAL/RESEARCH PURPOSES ONLY.[/yellow]

[red]🚨 NEVER invest based solely on algorithmic signals.[/red]

[cyan]Before investing in ANY stock, you MUST:[/cyan]
• Do your own thorough research
• Understand the company fundamentals
• Consider your risk tolerance
• Never invest more than you can afford to lose
• Consult with qualified financial advisors

[bold yellow]Algorithmic trading involves significant risks including:[/bold yellow]
• Market volatility
• Technical failures
• Data delays
• Unexpected events
• Loss of capital

[green]The creators accept NO responsibility for any losses incurred.[/green]""",
style="bold red")
        console.print(disclaimer)
    
    def display_top_5_recommendations(self, df):
        """Display the top 5 stock recommendations"""
        if df.empty:
            console.print("[red]❌ No strong candidates found[/red]")
            return
        
        # Select top 5 based on composite score
        top_5 = df.head(5)
        
        table = Table(title="🏆 TOP 5 STOCK RECOMMENDATIONS", show_header=True, header_style="bold magenta")
        table.add_column("Rank", style="cyan", no_wrap=True)
        table.add_column("Symbol", style="bold", no_wrap=True)
        table.add_column("Price", justify="right", style="green")
        table.add_column("Change", justify="right", style="white")
        table.add_column("RSI", justify="right", style="blue")
        table.add_column("Volume", justify="right", style="yellow")
        table.add_column("Weekly", justify="right", style="magenta")
        table.add_column("Score", justify="right", style="bold")
        table.add_column("Confidence", justify="center", style="bold")
        
        rank = 1
        for _, row in top_5.iterrows():
            # Determine color for change
            change_color = "green" if row['change'] > 0 else "red"
            weekly_color = "green" if row['Perf.W'] > 0 else "red"
            
            # Determine confidence level
            score = row['composite_score']
            if score >= 20:
                confidence = "[bold green]🟢 VERY HIGH[/bold green]"
            elif score >= 15:
                confidence = "[green]🔵 HIGH[/green]"
            elif score >= 10:
                confidence = "[yellow]🟡 MEDIUM[/yellow]"
            else:
                confidence = "[red]🔴 LOW[/red]"
            
            table.add_row(
                f"#{rank}",
                row['name'][:12],
                f"${row['close']:.2f}",
                f"[{change_color}]{row['change']:+.2f}%[/{change_color}]",
                f"{row['RSI']:.1f}",
                f"{row['relative_volume_10d_calc']:.1f}x",
                f"[{weekly_color}]{row['Perf.W']:+.1f}%[/{weekly_color}]",
                f"{row['composite_score']:.1f}",
                confidence
            )
            rank += 1
        
        console.print(table)
        
        # Add risk warning
        warning = Panel.fit("""[bold yellow]⚠️  RISK WARNING[/bold yellow]

[yellow]These are POTENTIAL opportunities based on technical signals ONLY.[/yellow]

[red]🚨 Risks include:[/red]
• Stocks can drop despite strong technical signals
• Market conditions can change rapidly
• Technical analysis is not foolproof
• Past performance doesn't guarantee future results

[cyan]Recommended Actions:[/cyan]
1. Research each company thoroughly before investing
2. Never invest more than 2-5% of your portfolio in any single stock
3. Use stop-loss orders to limit potential losses
4. Consider position sizing based on volatility
5. Monitor positions actively if investing""",
style="bold yellow")
        console.print(warning)
    
    def display_detailed_analysis(self, df):
        """Display detailed analysis for top recommendations"""
        if df.empty:
            return
        
        top_5 = df.head(5)
        
        console.print("\n[bold blue]🔬 DETAILED TECHNICAL ANALYSIS[/bold blue]")
        
        for idx, (_, row) in enumerate(top_5.iterrows(), 1):
            panel_content = f"""[bold]{row['name']}[/bold] - Rank #{idx}

[cyan]Technical Signals:[/cyan]
• Price: ${row['close']:.2f} ({row['change']:+.2f}%)
• RSI: {row['RSI']:.1f} {'🟢 (Bullish)' if 50 <= row['RSI'] <= 70 else '🔴 (Extreme)' if row['RSI'] > 70 or row['RSI'] < 30 else '⚪ (Neutral)'}
• MACD: {row['MACD.macd']:.3f} vs Signal {row['MACD.signal']:.3f} {'🟢 (Bullish)' if row['MACD.macd'] > row['MACD.signal'] else '🔴 (Bearish)'}
• 20 EMA: ${row['EMA20']:.2f} {'🟢 (Above)' if row['close'] > row['EMA20'] else '🔴 (Below)'}
• 50 EMA: ${row['EMA50']:.2f} {'🟢 (Above)' if row['close'] > row['EMA50'] else '🔴 (Below)'}

[violet]Momentum Indicators:[/violet]
• Weekly Perf: {row['Perf.W']:+.1f}%
• Monthly Perf: {row['Perf.3M']:+.1f}%
• Volume: {row['relative_volume_10d_calc']:.1f}x average
• Market Cap: ${row['market_cap_basic']/1e6:.0f}M

[magenta]Composite Score: {row['composite_score']:.1f}[/magenta] {'(Very High)' if row['composite_score'] >= 20 else '(High)' if row['composite_score'] >= 15 else '(Medium)' if row['composite_score'] >= 10 else '(Low)'}"""
            
            style = "green" if row['composite_score'] >= 15 else "yellow" if row['composite_score'] >= 10 else "red"
            panel = Panel(panel_content, title=f"{row['name']} Analysis", style=style)
            console.print(panel)
    
    def run_recommendations(self):
        """Run the complete recommendation process"""
        console.print(Panel.fit("[bold blue]🤖 ALGORITHMIC STOCK RECOMMENDATIONS[/bold blue]\n[cyan]Identifying Top 5 Stocks with Strong Technical Signals[/cyan]", style="blue"))
        
        # Show disclaimer first
        self.display_disclaimer()
        
        # Add pause to read disclaimer
        try:
            console.print("\n[yellow]Press Enter to continue after reading the disclaimer...[/yellow]")
            input()
        except:
            pass
        
        console.print("[cyan]🔬 Analyzing market data for top opportunities...[/cyan]")
        
        # Fetch data
        base_df = self.fetch_top_momentum_stocks(limit=50)
        
        if base_df.empty:
            console.print("[red]❌ Unable to fetch market data[/red]")
            return
        
        console.print(f"[green]✅ Analyzed {len(base_df)} stocks[/green]")
        
        # Calculate scores
        scored_df = self.calculate_confidence_scores(base_df)
        
        # Identify top candidates
        top_candidates = self.identify_top_candiates(scored_df, limit=10)
        
        if top_candidates.empty:
            console.print("[yellow]⚠️ No strong candidates found with current criteria[/yellow]")
            return
        
        # Display top 5 recommendations
        console.print("\n" + "="*100)
        self.display_top_5_recommendations(top_candidates)
        
        # Display detailed analysis
        console.print("\n" + "="*100)
        self.display_detailed_analysis(top_candidates)
        
        # Final reminder
        console.print("\n" + "="*100)
        final_warning = Panel.fit("""[bold red]🚨 FINAL REMINDER 🚨[/bold red]

[yellow]These are NOT buy recommendations - they are POTENTIAL opportunities that require YOUR research.[/yellow]

[red]Before investing in ANY stock:[/red]
1. [red]DO YOUR OWN RESEARCH[/red] - Understand the business
2. [red]CHECK FINANCIALS[/red] - Revenue, earnings, debt levels
3. [red]ASSESS RISK TOLERANCE[/red] - Never risk more than you can afford to lose
4. [red]USE PROPER POSITION SIZING[/red] - Never put more than 2-5% in any single stock
5. [red]SET STOP-LOSSES[/red] - Protect your capital

[bold green]Remember: Algorithmic analysis can identify POTENTIAL opportunities, but SUCCESS depends on YOUR research and risk management.[/bold green]""",
style="bold red")
        console.print(final_warning)

def main():
    """Main entry point"""
    console.print(Panel.fit("[bold]🤖 TOP 5 STOCK RECOMMENDATIONS[/bold]\n[yellow]Based on Technical Analysis & Momentum Signals[/yellow]", style="blue"))
    
    # Initialize recommender
    recommender = TopStockRecommender(market='america')
    
    # Run recommendations
    recommender.run_recommendations()
    
    console.print("\n[bold green]Thank you for using the Stock Recommendation Tool![/bold green]")
    console.print("[dim]Remember to always do your own research before investing.[/dim]")

if __name__ == "__main__":
    # Import pandas here to avoid issues
    try:
        import pandas as pd
        main()
    except ImportError:
        console.print("[red]❌ Required packages not installed. Please install: pip install pandas[/red]")