import sys
import os
import pandas as pd

# Add project root to sys.path for absolute imports
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_screeners_dir = _current_file_dir
_upstox_trader_dir = os.path.dirname(_screeners_dir)
_project_root_dir = os.path.dirname(_upstox_trader_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from rich.console import Console
from rich.table import Table

console = Console()

def main():
    console.print("[bold cyan]🚀 Running S/R Levels Test Script[/bold cyan]")

    # List of tickers provided by the user
    tickers = [
        "JINDALPOLY", "ADVENZYMES", "PANACEABIO", "RELAXO",
        "SAMMAANCAP", "BALAJEE", "COMSYN", "GRANULES",
        "ELGIRUBCO", "RBLBANK", "CGPOWER", "COFFEEDAY",
        "GARUDA", "COLPAL", "GODFRYPHLP"
    ]

    screener = TVScreenerUsage(enable_paper_trading=False) # Paper trading not needed for S/R detection

    # Force download and cache of instrument file if not present
    # This ensures symbol_validator has data before it's needed
    console.print("[bold green]Attempting to load/download Upstox instrument data...[/bold green]")
    screener.upstox_api.get_instrument_key("NIFTY 50", instrument_type="INDEX")
    console.print("[bold green]Instrument data loading/downloading process initiated.[/bold green]")

    for ticker in tickers:
        console.print(f"\n[bold yellow]🔍 Analyzing S/R Levels for {ticker}[/bold yellow]")
        sr_analysis = screener._detect_support_resistance_levels(ticker, lookback_days=60)

        if sr_analysis['data_quality'] == 'unavailable':
            console.print(f"[red]❌ S/R levels unavailable for {ticker} (Upstox API not initialized or data issue)[/red]")
            continue
        elif sr_analysis['data_quality'] == 'error':
            console.print(f"[red]❌ Error fetching S/R levels for {ticker}: {sr_analysis.get('error', 'Unknown error')}[/red]")
            continue
        elif not sr_analysis['levels']:
            console.print(f"[yellow]⚠️ No significant S/R levels found for {ticker} in the last {sr_analysis.get('lookback_days', 60)} days.[/yellow]")
            continue

        console.print(f"[green]✅ Current Price for {ticker}: ₹{sr_analysis['current_price']:.2f}[/green]")

        table = Table(title=f"S/R Levels for {ticker}", show_header=True, header_style="bold magenta")
        table.add_column("Type", style="cyan")
        table.add_column("Price", justify="right", style="yellow")
        table.add_column("Distance (%)", justify="right", style="green")
        table.add_column("Strength", style="blue")
        table.add_column("Source Date/Type", style="dim")

        for level in sr_analysis['levels']:
            table.add_row(
                level['type'].capitalize(),
                f"₹{level['price']:.2f}",
                f"{level['distance_pct']:.2f}%",
                level['strength'].capitalize(),
                str(level['date'])
            )
        console.print(table)

if __name__ == "__main__":
    main()
