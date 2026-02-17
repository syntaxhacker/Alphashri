import argparse
from tradingview_screener import Query, Column
from rich.console import Console
from rich.table import Table
import pandas as pd
from scanner_utils import display_tradingview_csv

console = Console()

def fetch_market_open_data(market='india', limit=50, min_gap=1.0, min_cap=1000000000, min_price=10):
    """Fetch stocks with significant gaps at market open."""
    try:
        query = (
            Query()
            .select(
                'name', 'close', 'open', 'gap', 'volume', 'premarket_change', 'change', 'change_abs', 'market_cap_basic'
            )
            .set_markets(market)
            .where(
                Column('volume') > 10000, # Basic volume filter
                Column('open') > min_price,
                Column('market_cap_basic') > min_cap
            )
            .order_by('volume', ascending=False) # Get liquid stocks first
            .limit(limit * 5) # Fetch more to filter locally if needed
        )
        
        _, df = query.get_scanner_data()
        
        if df.empty:
            return df
            
        # Deduplicate
        df = df.sort_values('volume', ascending=False).drop_duplicates(subset=['name'])
        
        # Filter for significant gaps (absolute value > min_gap)
        # Note: 'gap' field in TV is usually percentage
        df = df[df['gap'].abs() >= min_gap]
        
        # Sort by absolute gap size to find biggest movers
        df['abs_gap'] = df['gap'].abs()
        df = df.sort_values('abs_gap', ascending=False).head(limit)
        
        return df
    except Exception as e:
        console.print(f"[red]Error fetching data: {e}[/red]")
        return pd.DataFrame()

def display_gappers(df, market):
    """Display the table of gappers."""
    if df.empty:
        console.print("[yellow]No significant gappers found.[/yellow]")
        return

    currency = '₹' if market == 'india' else '$'
    table = Table(title=f"🌅 MARKET OPEN SCANNER ({market.upper()}) - Top Gappers", style="blue")
    
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column(f"Price {currency}", justify="right")
    table.add_column("Gap %", justify="right", style="bold")
    table.add_column("Open", justify="right")
    table.add_column("Pre-Mkt %", justify="right")
    table.add_column("Vol", justify="right")
    table.add_column("Cap (B)", justify="right")
    table.add_column("Signal", justify="center")

    for _, row in df.iterrows():
        # Gap Color
        gap_color = "bright_green" if row['gap'] > 0 else "bright_red"
        gap_str = f"[{gap_color}]{row['gap']:+.2f}%[/{gap_color}]"
        
        # Pre-market Color (if available)
        pre_val = row.get('premarket_change')
        if pd.isna(pre_val):
            pre_str = "-"
        else:
            pre_color = "green" if pre_val > 0 else "red"
            pre_str = f"[{pre_color}]{pre_val:+.2f}%[/{pre_color}]"
            
        # Signal
        signal = "GAP UP 🚀" if row['gap'] > 0 else "GAP DOWN 🔻"
        
        market_cap_billions = row.get('market_cap_basic', 0) / 1000000000
        
        table.add_row(
            row['name'],
            f"{row['close']:.2f}",
            gap_str,
            f"{row['open']:.2f}",
            pre_str,
            f"{row['volume']/1000:.0f}K",
            f"{market_cap_billions:.1f}B",
            f"[{gap_color}]{signal}[/{gap_color}]"
        )

    console.print(table)

    # TradingView-compatible CSV output
    if not df.empty:
        display_tradingview_csv(df)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Market Open Gap Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='india', help='Market to scan')
    parser.add_argument('--limit', type=int, default=20, help='Number of stocks to display')
    parser.add_argument('--min-gap', type=float, default=1.0, help='Minimum gap percentage (default: 1.0)')
    parser.add_argument('--min-cap', type=int, default=1000000000, help='Minimum market cap (default: 1,000,000,000)')
    parser.add_argument('--min-price', type=float, default=10.0, help='Minimum stock price (default: 10.0)')
    
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'

    with console.status(f"[bold green]Scanning for Gaps > {args.min_gap}% in {market}...[/bold green]"):
        df = fetch_market_open_data(market, args.limit, args.min_gap, args.min_cap, args.min_price)
    
    display_gappers(df, args.market)
