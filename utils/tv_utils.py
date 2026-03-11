import pandas as pd
import requests
from rich.console import Console
from rich.table import Table
from typing import List

console = Console()


def clean_and_deduplicate(df: pd.DataFrame, sort_col: str = 'volume') -> pd.DataFrame:
    """
    Clean the dataframe and remove duplicates.
    Keeps the row with the highest value in `sort_col` (default: volume) for each unique name.
    """
    if df.empty:
        return df

    # Sort by the specified column (descending) to keep the "best" entry (e.g. highest volume)
    df = df.sort_values(sort_col, ascending=False)

    # Drop duplicates based on 'name', keeping the first (highest sort_col)
    if 'name' in df.columns:
        df = df.drop_duplicates(subset=['name'], keep='first')

    return df


def format_change(val):
    """Format change percentage with color."""
    color = "green" if val > 0 else "red"
    return f"[{color}]{val:+.2f}%[/{color}]"


def format_rsi(val):
    """Format RSI with color."""
    color = "red" if val > 80 else ("green" if val > 60 else "yellow")
    return f"[{color}]{val:.1f}[/{color}]"


def get_nifty_stocks_from_nseindia() -> dict:
    """
    Fetch Nifty 50, Nifty 100, and Nifty 500 stock lists from NSE India website.

    Returns:
        dict: {
            'nifty_50': [list of stock symbols],
            'nifty_100': [list of stock symbols],
            'nifty_500': [list of stock symbols]
        }
    """
    indices = {
        'nifty_50': 'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050',
        'nifty_100': 'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20100',
        'nifty_500': 'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500'
    }

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/'
    }

    result = {}

    for index_name, url in indices.items():
        try:
            console.print(f"[cyan]Fetching {index_name} stocks from NSE...[/cyan]")
            response = requests.get(url, headers=headers, timeout=10)

            if response.status_code == 200:
                data = response.json()

                # Extract stock symbols from the response
                if 'data' in data:
                    stocks = []
                    for item in data['data']:
                        # Skip the index itself and include only stocks
                        if item.get('symbol') and item.get('symbol') != index_name.upper():
                            symbol = item['symbol'].replace('&', '_').strip()
                            stocks.append(symbol)

                    result[index_name] = stocks
                    console.print(f"[green]✅ Found {len(stocks)} stocks in {index_name}[/green]")
                else:
                    console.print(f"[yellow]⚠️  Unexpected data format for {index_name}[/yellow]")
                    result[index_name] = []
            else:
                console.print(f"[red]❌ Failed to fetch {index_name}: HTTP {response.status_code}[/red]")
                result[index_name] = []

        except Exception as e:
            console.print(f"[red]❌ Error fetching {index_name}: {e}[/red]")
            result[index_name] = []

    return result


def get_upstox_instrument_symbols(upstox_api, index_symbols: List[str]) -> List[str]:
    """
    Convert NSE symbols to Upstox trading symbols format.

    Args:
        upstox_api: UpstoxAPI instance
        index_symbols: List of NSE symbols (e.g., ['RELIANCE', 'TCS'])

    Returns:
        List of symbols ready for Upstox API
    """
    valid_symbols = []

    console.print(f"[dim]Validating {len(index_symbols)} symbols against Upstox instruments...[/dim]")

    for symbol in index_symbols:
        try:
            # Try to get the instrument key
            instrument_key = upstox_api.get_instrument_key(symbol, instrument_type="EQ")

            if instrument_key:
                # The symbol itself is what we need for trading
                # Don't extract from instrument_key, use the original symbol
                valid_symbols.append(symbol)
        except Exception:
            # Even if instrument_key lookup fails, try the symbol directly
            # Many symbols work even if get_instrument_key fails
            valid_symbols.append(symbol)

    console.print(f"[green]✅ Using {len(valid_symbols)} symbols for backtesting[/green]")
    return valid_symbols


def fetch_nifty_stocks(upstox_api=None, index: str = 'nifty_50') -> List[str]:
    """
    Main function to fetch Nifty stocks with Upstox validation.

    Args:
        upstox_api: UpstoxAPI instance (optional, for validation)
        index: 'nifty_50', 'nifty_100', or 'nifty_500'

    Returns:
        List of validated stock symbols ready for trading
    """
    # Fetch from NSE
    indices_data = get_nifty_stocks_from_nseindia()

    if index not in indices_data or not indices_data[index]:
        console.print(f"[red]❌ No data found for {index}[/red]")
        return []

    symbols = indices_data[index]

    # Validate against Upstox if API provided
    if upstox_api:
        symbols = get_upstox_instrument_symbols(upstox_api, symbols)

    return symbols


def print_nifty_stocks_summary(upstox_api=None):
    """
    Print a summary table of all Nifty indices with stock counts.
    """
    console.print("\n[bold cyan]╔════════════════════════════════════════════════════════════╗[/bold cyan]")
    console.print("[bold cyan]║           NIFTY INDICES - STOCK SUMMARY                    ║[/bold cyan]")
    console.print("[bold cyan]╚════════════════════════════════════════════════════════════╝[/bold cyan]\n")

    indices_data = get_nifty_stocks_from_nseindia()

    table = Table(title="Nifty Indices Stock Count")
    table.add_column("Index", style="cyan")
    table.add_column("NSE Count", justify="right")
    table.add_column("Upstox Valid", justify="right")
    table.add_column("Sample Stocks", style="dim")

    for index_name, stocks in indices_data.items():
        if upstox_api:
            valid_stocks = get_upstox_instrument_symbols(upstox_api, stocks)
            valid_count = len(valid_stocks)
            sample = ', '.join(valid_stocks[:5]) + ('...' if len(valid_stocks) > 5 else '')
        else:
            valid_count = len(stocks)
            sample = ', '.join(stocks[:5]) + ('...' if len(stocks) > 5 else '')

        table.add_row(
            index_name.upper(),
            str(len(stocks)),
            str(valid_count) if upstox_api else "N/A",
            sample
        )

    console.print(table)
    console.print("")


# Convenience functions for quick access
def get_nifty_50(upstox_api=None) -> List[str]:
    """Get Nifty 50 stocks list"""
    return fetch_nifty_stocks(upstox_api, 'nifty_50')


def get_nifty_100(upstox_api=None) -> List[str]:
    """Get Nifty 100 stocks list"""
    return fetch_nifty_stocks(upstox_api, 'nifty_100')


def get_nifty_500(upstox_api=None) -> List[str]:
    """Get Nifty 500 stocks list"""
    return fetch_nifty_stocks(upstox_api, 'nifty_500')
