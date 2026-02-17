import argparse
from tradingview_screener import Query, Column
from rich.console import Console
from rich.table import Table
import pandas as pd
import sys
import os

# Add path to import utils modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from utils.tv_utils import clean_and_deduplicate, format_change

console = Console()

def fetch_nifty_data(limit=50):
    """Fetch top stocks by market cap to approximate Nifty 50."""
    try:
        # We use market_cap_basic to get the largest companies
        query = (
            Query()
            .select(
                'name', 'close', 'change', 'market_cap_basic', 'volume', 'description', 'sector'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') > 0,
                Column('close') > 0
            )
            .order_by('market_cap_basic', ascending=False)
            .limit(limit * 2)
        )
        
        _, df = query.get_scanner_data()
        
        if df.empty:
            return df

        # Deduplicate using helper
        df = clean_and_deduplicate(df)
        
        # Re-sort by market cap and take top 'limit'
        df = df.sort_values('market_cap_basic', ascending=False).head(limit)
        
        return df
    except Exception as e:
        console.print(f"[red]Error fetching data: {e}[/red]")
        return pd.DataFrame()

def calculate_impact(df):
    """Calculate impact score = Market Cap * Change %."""
    if df.empty:
        return df
    
    # Normalize market cap to Billions for easier reading
    df['market_cap_B'] = df['market_cap_basic'] / 1_000_000_000
    
    # Impact Score: A rough proxy for index contribution points
    # We divide by a constant just to make the numbers manageable/readable
    # The absolute value doesn't matter as much as the relative value
    df['impact_score'] = (df['market_cap_basic'] * df['change']) / 100_000_000_000
    
    return df

def display_movers(df):
    """Display the table sorted by impact."""
    if df.empty:
        console.print("[yellow]No data found.[/yellow]")
        return

    # Sort by absolute impact to see biggest movers (up or down)
    df['abs_impact'] = df['impact_score'].abs()
    df = df.sort_values('abs_impact', ascending=False)

    table = Table(title="📊 NIFTY 50 MOVERS (Weighted Impact)", style="blue")
    
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("Price ₹", justify="right")
    table.add_column("Change %", justify="right")
    table.add_column("Cap (B)", justify="right")
    table.add_column("Impact Score", justify="right", style="bold")
    table.add_column("Sector", style="dim")

    for _, row in df.iterrows():
        # Color code change
        change_str = format_change(row['change'])
        
        # Color code impact
        impact_color = "bright_green" if row['impact_score'] > 0 else "bright_red"
        impact_str = f"[{impact_color}]{row['impact_score']:+.2f}[/{impact_color}]"
        
        table.add_row(
            row['name'],
            f"{row['close']:.2f}",
            change_str,
            f"{row['market_cap_B']:.0f}B",
            impact_str,
            str(row['sector'])
        )

    console.print(table)
    
    # Summary
    total_impact = df['impact_score'].sum()
    sentiment = "BULLISH 🐂" if total_impact > 0 else "BEARISH 🐻"
    console.print(f"\n[bold]Market Sentiment:[/bold] {sentiment} (Net Impact: {total_impact:+.2f})")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Nifty Movers Analyzer')
    parser.add_argument('--limit', type=int, default=50, help='Number of top stocks to analyze (default: 50)')
    args = parser.parse_args()

    with console.status("[bold green]Fetching Nifty data...[/bold green]"):
        df = fetch_nifty_data(args.limit)
        df = calculate_impact(df)
    
    display_movers(df)
