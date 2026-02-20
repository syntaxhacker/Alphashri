import rookiepy
from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from datetime import datetime
import pandas as pd
import argparse

console = Console()

def get_tradingview_cookies():
    """Get TradingView cookies from browser"""
    try:
        cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.tradingview.com']))
        console.print("[green]Successfully loaded cookies from Chrome[/green]")
        return cookies
    except Exception as chrome_error:
        console.print("[yellow]Could not load cookies from Chrome, trying Firefox...[/yellow]")
        try:
            cookies = rookiepy.to_cookiejar(rookiepy.firefox(['.tradingview.com']))
            console.print("[green]Successfully loaded cookies from Firefox[/green]")
            return cookies
        except Exception as firefox_error:
            console.print("[red]Could not load cookies from any browser. Using delayed data.[/red]")
            console.print("[yellow]Please make sure you're logged into TradingView in your browser.[/yellow]")
            return None

class VolatilityTVScreener:
    def __init__(self):
        self.query = Query()
        self.decimals = 2
        self.cookies = get_tradingview_cookies()
        
    def test_connection(self):
        """Test API connection"""
        try:
            console.print("[yellow]Testing API connection...[/yellow]")
            total_rows, df = (
                self.query
                .select('name', 'close', 'volume', 'market_cap_basic', 'update_mode')
                .set_markets('india')
                .limit(5)
                .get_scanner_data(cookies=self.cookies)
            )
            
            console.print(f"[green]API connection successful![/green]")
            console.print(f"[blue]Total rows available: {total_rows}[/blue]")
            
            if self.cookies:
                console.print("[green]Real-time data streaming enabled![/green]")
            else:
                console.print("[yellow]Using delayed data (15-20 minutes delay)[/yellow]")
                
            return True
            
        except Exception as e:
            console.print(f"[red]API connection failed: {e}[/red]")
            return False
    
    def get_high_volatility_stocks(self, args):
        """Get stocks with high volatility using ATR% (ATR as % of price)"""
        console.print("[bold yellow]Screening for High Volatility Stocks (ATR%)...[/bold yellow]")

        try:
            # Build query for high volatility stocks
            # Fetch more than limit to calculate ATR% and filter/sort
            fetch_limit = max(args.limit * 3, 100)

            query = (
                self.query
                .select(
                    'name',
                    'close',
                    'volume',
                    'market_cap_basic',
                    'ATR',  # Average True Range
                    'relative_volume_10d_calc',  # Volume ratio
                    'RSI',
                    'change',
                    'price_earnings_ttm',
                    'return_on_equity',
                    'update_mode'
                )
                .set_markets('india')
                .where(
                    col('close') > args.min_price,
                    col('volume') > args.min_volume,
                    col('market_cap_basic') > args.min_market_cap,
                    col('ATR') > 0,
                    col('relative_volume_10d_calc') > args.min_volume_ratio,
                    col('price_earnings_ttm') < args.max_pe if args.max_pe else col('price_earnings_ttm') > 0,
                    col('return_on_equity') > args.min_roe if args.min_roe else col('return_on_equity') > 0
                )
                .order_by('ATR', ascending=False)
                .limit(fetch_limit)
            )

            total_rows, df = query.get_scanner_data(cookies=self.cookies)

            if df.empty:
                console.print("[red]No high volatility stocks found with current criteria[/red]")
                return df

            # Calculate ATR as percentage of price (same as high_volatility_scanner.py)
            df['atr_pct'] = (df['ATR'] / df['close']) * 100
            df['market_cap_cr'] = df['market_cap_basic'] / 1e7  # Convert to crores

            # Filter by minimum ATR% and sort by ATR%
            df = df[df['atr_pct'] >= args.min_volatility]
            df = df.sort_values('atr_pct', ascending=False).head(args.limit)

            console.print(f"[green]Successfully fetched {len(df)} high volatility stocks[/green]")
            return df

        except Exception as e:
            console.print(f"[red]Error fetching high volatility stocks: {e}[/red]")
            return pd.DataFrame()
    
    def get_breakout_candidates(self, args):
        """Get stocks showing breakout patterns"""
        console.print("[bold yellow]Screening for Breakout Candidates...[/bold yellow]")

        try:
            query = (
                self.query
                .select(
                    'name',
                    'close',
                    'volume',
                    'market_cap_basic',
                    'ATR',  # Added for ATR% calculation
                    'relative_volume_10d_calc',
                    'change',
                    'price_52_week_high',
                    'price_52_week_low',
                    'RSI',
                    'MACD.macd',
                    'MACD.signal',
                    'update_mode'
                )
                .set_markets('india')
                .where(
                    col('close') > args.min_price,
                    col('volume') > args.min_volume * 2,  # Higher volume for breakouts
                    col('market_cap_basic') > args.min_market_cap,
                    col('relative_volume_10d_calc') > 1.5,  # 50% above average volume
                    col('change') > 2,  # Positive momentum
                    col('RSI') > 50,  # Bullish RSI
                    col('MACD.macd') > col('MACD.signal')  # MACD bullish crossover
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(args.limit)
            )

            total_rows, df = query.get_scanner_data(cookies=self.cookies)

            if df.empty:
                console.print("[red]No breakout candidates found with current criteria[/red]")
                return df

            # Calculate additional metrics
            df['atr_pct'] = (df['ATR'] / df['close']) * 100
            df['market_cap_cr'] = df['market_cap_basic'] / 1e7
            df['dist_from_52w_high'] = ((df['price_52_week_high'] - df['close']) / df['close']) * 100

            console.print(f"[green]Successfully fetched {len(df)} breakout candidates[/green]")
            return df

        except Exception as e:
            console.print(f"[red]Error fetching breakout candidates: {e}[/red]")
            return pd.DataFrame()
    
    def display_results(self, df, title, score_col=None):
        """Display results in a formatted table"""
        if df.empty:
            return

        table = Table(title=title)

        # Add columns
        table.add_column("Ticker", style="cyan")
        table.add_column("Name", style="magenta")
        table.add_column("Close", justify="right", style="green")
        table.add_column("Volume", justify="right", style="blue")
        table.add_column("MCap (₹Cr)", justify="right", style="yellow")

        if 'atr_pct' in df.columns:
            table.add_column("ATR%", justify="right", style="red")
        if 'relative_volume_10d_calc' in df.columns:
            table.add_column("Vol Ratio", justify="right", style="blue")
        if 'change' in df.columns:
            table.add_column("Change %", justify="right", style="green")
        if 'RSI' in df.columns:
            table.add_column("RSI", justify="right", style="cyan")
        if 'dist_from_52w_high' in df.columns:
            table.add_column("52W High %", justify="right", style="magenta")

        table.add_column("Data", style="dim")

        # Add rows
        for _, row in df.iterrows():
            row_data = [
                row['ticker'],
                row['name'],
                f"{row['close']:,.2f}",
                f"{row['volume']:,.0f}",
                f"₹{row['market_cap_cr']:,.0f}"
            ]

            if 'atr_pct' in df.columns:
                row_data.append(f"{row['atr_pct']:.2f}%")
            if 'relative_volume_10d_calc' in df.columns:
                row_data.append(f"{row['relative_volume_10d_calc']:.2f}x")
            if 'change' in df.columns:
                change_style = "green" if row['change'] > 0 else "red"
                row_data.append(f"[{change_style}]{row['change']:+.2f}%[/{change_style}]")
            if 'RSI' in df.columns:
                row_data.append(f"{row['RSI']:.1f}")
            if 'dist_from_52w_high' in df.columns:
                row_data.append(f"{row['dist_from_52w_high']:.1f}%")

            row_data.append(row['update_mode'])

            table.add_row(*row_data)

        console.print(table)
    
    def save_results(self, df, filename_prefix):
        """Save results to CSV"""
        if df.empty:
            return
            
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{filename_prefix}_{timestamp}.csv"
        
        # Convert to human-readable format
        df_save = df.copy()
        if 'market_cap_basic' in df_save.columns:
            df_save['market_cap_cr'] = df_save['market_cap_basic'] / 1e7
        
        df_save.to_csv(filename, index=False)
        console.print(f"[green]Results saved to: {filename}[/green]")

def main():
    parser = argparse.ArgumentParser(description='TradingView Volatility Stock Screener')
    parser.add_argument('--min-price', type=float, default=100, help='Minimum stock price')
    parser.add_argument('--min-volume', type=int, default=500000, help='Minimum trading volume')
    parser.add_argument('--min-market-cap', type=float, default=1e9, help='Minimum market cap in rupees')
    parser.add_argument('--min-volatility', type=float, default=2.0, help='Minimum ATR as percentage of price (ATR%)')
    parser.add_argument('--min-volume-ratio', type=float, default=1.2, help='Minimum volume ratio (vs 10-day avg)')
    parser.add_argument('--max-pe', type=float, help='Maximum P/E ratio')
    parser.add_argument('--min-roe', type=float, help='Minimum ROE percentage')
    parser.add_argument('--limit', type=int, default=30, help='Maximum number of results')
    parser.add_argument('--screen-type', choices=['volatility', 'breakout', 'both'], 
                       default='both', help='Type of screening to perform')
    
    args = parser.parse_args()
    
    console.print("[bold blue]TradingView Volatility Stock Screener Starting...[/bold blue]")
    
    screener = VolatilityTVScreener()
    
    if not screener.test_connection():
        return
    
    start_time = datetime.now()
    
    if args.screen_type in ['volatility', 'both']:
        # Screen for high volatility stocks
        volatility_df = screener.get_high_volatility_stocks(args)
        if not volatility_df.empty:
            screener.display_results(volatility_df, "🔥 High Volatility Stocks")
            screener.save_results(volatility_df, "high_volatility_stocks")
    
    if args.screen_type in ['breakout', 'both']:
        # Screen for breakout candidates
        breakout_df = screener.get_breakout_candidates(args)
        if not breakout_df.empty:
            screener.display_results(breakout_df, "🚀 Breakout Candidates")
            screener.save_results(breakout_df, "breakout_candidates")
    
    end_time = datetime.now()
    execution_time = end_time - start_time
    
    console.print(f"[green]Execution time: {execution_time}[/green]")

if __name__ == "__main__":
    main()