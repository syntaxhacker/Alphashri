#!/usr/bin/env python3
"""
Scanner Utilities
Common utility functions for stock scanners.
"""

from rich.console import Console
from rich.panel import Panel

console = Console()

def display_tradingview_csv(stock_list, title="📋 TradingView CSV (copy below)"):
    """
    Display a TradingView-compatible CSV output for copy-paste.

    Args:
        stock_list: List of stock symbols or DataFrame with 'name' column
        title: Title for the CSV output section
    """
    console.print()
    console.print(Panel.fit(title, style='bold cyan'))

    # Handle both DataFrame and list inputs
    if hasattr(stock_list, 'name'):
        # DataFrame with 'name' column
        symbols = stock_list['name'].tolist()
    elif isinstance(stock_list, list):
        # Already a list
        symbols = stock_list
    else:
        console.print("[yellow]Invalid input format for CSV output[/yellow]")
        return

    # Remove duplicates while preserving order
    seen = set()
    unique_symbols = []
    for symbol in symbols:
        if symbol not in seen:
            seen.add(symbol)
            unique_symbols.append(symbol)

    # Generate CSV output
    tv_csv = ",".join(unique_symbols)
    console.print(tv_csv)
    console.print(Panel.fit('─────────────────────────────', style='dim'))
