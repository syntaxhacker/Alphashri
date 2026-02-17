import argparse
import time
from rich.console import Console
from rich.table import Table
from rich.progress import Progress
from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI, UPSTOX_CONFIG
from analyze_stock import get_stock_analysis

console = Console()

# Nifty 50 Symbols (Hardcoded for reliability)
NIFTY_50_SYMBOLS = [
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
    "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BPCL",
    "BHARTIARTL", "BRITANNIA", "CIPLA", "COALINDIA", "DIVISLAB",
    "DRREDDY", "EICHERMOT", "GRASIM", "HCLTECH", "HDFCBANK",
    "HDFCLIFE", "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK",
    "ITC", "INDUSINDBK", "INFY", "JSWSTEEL", "KOTAKBANK",
    "LT", "LTIM", "M&M", "MARUTI", "NESTLEIND",
    "NTPC", "ONGC", "POWERGRID", "RELIANCE", "SBILIFE",
    "SBIN", "SUNPHARMA", "TCS", "TATACONSUM", "TATAMOTORS",
    "TATASTEEL", "TECHM", "TITAN", "ULTRACEMCO", "WIPRO"
]

def scan_nifty50():
    """Scan all Nifty 50 stocks for bursts and activity."""
    
    # 1. Initialize API
    try:
        api_key = UPSTOX_CONFIG.get('api_key')
        api_secret = UPSTOX_CONFIG.get('api_secret')
        upstox_api = UpstoxAPI(api_key, api_secret, quiet=True)
        console.print("[green]Using Upstox V3 market data (no interactive auth required)[/green]")
    except Exception as e:
        console.print(f"[red]Failed to initialize Upstox API: {e}[/red]")
        return

    results = []
    
    # 2. Scan Loop
    console.print(f"[bold cyan]🚀 Scanning Nifty 50 for Volume Bursts...[/bold cyan]")
    
    with Progress() as progress:
        task = progress.add_task("[cyan]Scanning...", total=len(NIFTY_50_SYMBOLS))
        
        for symbol in NIFTY_50_SYMBOLS:
            data = get_stock_analysis(symbol, upstox_api)
            
            if data and 'error' not in data:
                # Filter for interesting stocks only?
                # Let's keep all but highlight interesting ones
                results.append(data)
            
            progress.advance(task)
            # time.sleep(0.1) # Rate limit protection if needed

    # 3. Display Results (Sorted by "Interestingness")
    # Interesting = Burst detected OR Strong Trend
    
    def score_interest(row):
        score = 0
        if "BURST" in row['vol_status']: score += 100
        if "ELEVATED" in row['vol_status']: score += 20
        if "ROCKET" in row['trend'] or "BEAR" in row['trend']: score += 10
        if "OVER" in row['rsi_status']: score += 10
        return score

    results.sort(key=score_interest, reverse=True)
    
    # Filter to show only active stocks (Score > 0) or top 20
    active_results = [r for r in results if score_interest(r) > 0]
    
    if not active_results:
        console.print("[yellow]No significant activity found in Nifty 50 right now.[/yellow]")
        return

    table = Table(title="🔥 NIFTY 50 ACTIVITY SCANNER", style="bold blue")
    
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("Price", justify="right")
    table.add_column("Trend", justify="center")
    table.add_column("RSI", justify="right")
    table.add_column("Volume Status", justify="center", style="bold yellow")
    table.add_column("Recent Bursts", style="dim")

    for res in active_results:
        # Format Trend
        trend_str = res['trend'].replace("BULLISH", "BULL").replace("BEARISH", "BEAR").replace("MILDLY", "MILD")
        if "BULL" in trend_str: trend_str = f"[green]{trend_str}[/green]"
        elif "BEAR" in trend_str: trend_str = f"[red]{trend_str}[/red]"
        
        # Format RSI
        rsi_val = res['rsi']
        rsi_str = f"{rsi_val:.0f}"
        if rsi_val > 70: rsi_str = f"[red]{rsi_str}[/red]"
        elif rsi_val < 30: rsi_str = f"[green]{rsi_str}[/green]"
        
        # Format Vol
        vol_str = res['vol_status'].replace("EXTREME BURST", "💥 EXTREME").replace("HIGH BURST", "⚡ HIGH")
        if "BURST" in res['vol_status']: vol_str = f"[bold yellow]{vol_str}[/bold yellow]"
        
        table.add_row(
            res['symbol'],
            f"{res['close']:.1f}",
            trend_str,
            rsi_str,
            vol_str,
            res['burst_msg']
        )

    console.print(table)
    console.print(f"\n[dim]Showing {len(active_results)} active stocks out of {len(NIFTY_50_SYMBOLS)} scanned.[/dim]")

if __name__ == "__main__":
    scan_nifty50()
