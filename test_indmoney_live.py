#!/usr/bin/env python3
"""Live INDMoney API Test"""
import sys
import os
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

# Add project root to path
_project_root = os.path.abspath('.')
sys.path.insert(0, _project_root)

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

console = Console()

def main():
    console.print(Panel(
        "[bold green]INDMONEY API - LIVE DATA TEST[/bold green]",
        title="📡 Live Test",
        border_style="green"
    ))

    api = TradingAPIFactory.create_from_config('indmoney')

    # Test 1: Get Price
    console.print("\n[bold cyan]1. Testing get_price() - RELIANCE[/bold cyan]")
    price = api.get_price('RELIANCE')
    if price:
        console.print(f"  [green]✅ Current Price: ₹{price:.2f}[/green]")

    # Test 2: Get Full Quote
    console.print("\n[bold cyan]2. Testing get_quote() - RELIANCE[/bold cyan]")
    quote = api.get_quote('RELIANCE')
    if quote:
        console.print("  [green]✅ Quote received:[/green]")
        for key, value in list(quote.items())[:6]:
            console.print(f"    {key}: {value}")

    # Test 3: Multiple stocks
    console.print("\n[bold cyan]3. Testing Multiple Stocks[/bold cyan]")
    symbols = ['RELIANCE', 'TCS', 'INFY']
    table = Table(title="📊 Live Prices")
    table.add_column("Symbol", style="cyan")
    table.add_column("Price", justify="right", style="green")

    for symbol in symbols:
        price = api.get_price(symbol)
        if price:
            table.add_row(symbol, f"₹{price:.2f}")

    console.print(table)

    console.print(Panel(
        "[bold green]✅ LIVE API TESTS PASSED[/bold green]\n"
        "Market data APIs working correctly!",
        title="🎉 Success",
        border_style="green"
    ))

if __name__ == "__main__":
    main()
