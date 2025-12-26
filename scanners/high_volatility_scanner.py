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

def fetch_volatile_stocks(limit=50):
    """Fetch stocks with high daily volatility (ATR% > 2%)."""
    try:
        # Criteria:
        # 1. Market Cap > 2000 Cr (Liquidity/Safety)
        # 2. Volatility: We'll fetch ATR and calculate % later, 
        #    but we can pre-filter for Volatility.D to reduce dataset size if needed.
        #    For now, let's just fetch liquid stocks and filter in Python.
        
        query = (
            Query()
            .select(
                'name', 'close', 'change', 'volume', 
                'ATR', 'Volatility.D', 'market_cap_basic', 'sector',
                'average_volume_10d_calc'
            )
            .set_markets('india')
            .where(
                Column('market_cap_basic') > 20_000_000_000,  # > 2000 Cr
                Column('close') > 50 # Avoid penny stocks
            )
            .order_by('Volatility.D', ascending=False)
            .limit(300) # Fetch a broad batch to filter
        )
        
        _, df = query.get_scanner_data()
        
        if df.empty:
            return df

        # Deduplicate
        df = clean_and_deduplicate(df)

        # Calculate Metrics
        # ATR % = (ATR / Close) * 100
        df['atr_pct'] = (df['ATR'] / df['close']) * 100
        
        # Turnover = Volume * Close
        df['turnover'] = df['volume'] * df['close']
        
        # Filter: ATR% > 2.0 AND Turnover > 10 Cr
        df = df[
            (df['atr_pct'] >= 2.0) & 
            (df['turnover'] > 100_000_000) # 10 Cr
        ].copy()
        
        # Sort by ATR % (Most volatile first)
        df = df.sort_values('atr_pct', ascending=False).head(limit)
        
        return df
    except Exception as e:
        console.print(f"[red]Error fetching data: {e}[/red]")
        return pd.DataFrame()

def display_volatile(df):
    """Display the volatile stocks."""
    if df.empty:
        console.print("[yellow]No high volatility stocks found matching criteria.[/yellow]")
        return

    table = Table(title="⚡ HIGH VOLATILITY SCALPERS (Avg Move > 2%)", style="yellow")
    
    table.add_column("Rank", style="dim", width=4)
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("Price ₹", justify="right")
    table.add_column("Change %", justify="right")
    table.add_column("Avg Daily Move", justify="center", style="bold yellow")
    table.add_column("Volatility.D", justify="right")
    table.add_column("Volume", justify="right")
    table.add_column("Sector", style="dim")

    rank = 1
    for _, row in df.iterrows():
        # Color code change
        change_str = format_change(row['change'])
        
        # ATR % visual
        atr_pct = row['atr_pct']
        atr_str = f"{atr_pct:.2f}%"
        if atr_pct >= 3.0: atr_str = f"[bold red]🔥 {atr_str}[/bold red]"
        elif atr_pct >= 2.5: atr_str = f"[bold yellow]{atr_str}[/bold yellow]"
        
        # Volume visual
        vol_str = f"{row['volume']/100000:.1f}L"

        table.add_row(
            f"#{rank}",
            row['name'],
            f"{row['close']:.2f}",
            change_str,
            atr_str,
            f"{row['Volatility.D']:.2f}",
            vol_str,
            str(row['sector'])
        )
        rank += 1

    console.print(table)
    console.print(f"\n[dim]Criteria: ATR% > 2% | Market Cap > 2000Cr | Turnover > 10Cr[/dim]")
    console.print(f"[dim]Avg Daily Move = (ATR / Price) * 100. This is how much it moves on an average day.[/dim]")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='High Volatility Scanner')
    parser.add_argument('--limit', type=int, default=50, help='Number of stocks to display')
    args = parser.parse_args()

    with console.status("[bold yellow]Scanning for volatile stocks...[/bold yellow]"):
        df = fetch_volatile_stocks(args.limit)
    
    display_volatile(df)
