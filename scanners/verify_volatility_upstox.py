import argparse
import pandas as pd
import pandas_ta as ta
from rich.console import Console
from rich.table import Table
from datetime import datetime, timedelta
import time

# Import existing modules
import high_volatility_scanner
from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
from upstox_trader.config import UPSTOX_CONFIG

console = Console()

def get_trend_status(df, period='EMA20'):
    """Determine trend based on Close vs EMA."""
    if df is None or df.empty or len(df) < 20:
        return "Unknown", False
    
    # Calculate EMA
    df.ta.ema(length=20, append=True)
    
    last_row = df.iloc[-1]
    ema_val = last_row['EMA_20']
    close_val = last_row['close']
    
    if pd.isna(ema_val):
        return "Unknown", False
        
    is_bullish = close_val > ema_val
    return ("Bullish" if is_bullish else "Bearish"), is_bullish

def verify_trends(limit=20):
    """Fetch volatile stocks and verify weekly/monthly trends."""
    
    # 1. Get Volatile Stocks
    with console.status("[bold yellow]Step 1: Scanning for high volatility stocks...[/bold yellow]"):
        df_volatile = high_volatility_scanner.fetch_volatile_stocks(limit=limit)
    
    if df_volatile.empty:
        console.print("[red]No volatile stocks found to verify.[/red]")
        return

    # 2. Initialize Upstox API
    try:
        api_key = UPSTOX_CONFIG.get('api_key')
        api_secret = UPSTOX_CONFIG.get('api_secret')
        upstox_api = UpstoxAPI(api_key, api_secret, quiet=True)
        console.print("[green]Using Upstox V3 historical data (no interactive auth required)[/green]")
    except Exception as e:
        console.print(f"[red]Failed to initialize Upstox API: {e}[/red]")
        return

    # 3. Verify Trends
    results = []
    
    console.print(f"\n[bold cyan]Verifying Trends for {len(df_volatile)} Stocks...[/bold cyan]")
    
    # Date range for historical data (enough for 20 candles)
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date_weekly = (datetime.now() - timedelta(weeks=30)).strftime('%Y-%m-%d')
    from_date_monthly = (datetime.now() - timedelta(weeks=100)).strftime('%Y-%m-%d')

    with console.status("[bold green]Fetching Weekly & Monthly Data...[/bold green]"):
        for _, row in df_volatile.iterrows():
            symbol = row['name']
            atr_pct = row['atr_pct']

            # Fetch Weekly
            df_week = upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='weeks', # Upstox API uses 'weeks'
                interval=1,
                to_date=to_date,
                from_date=from_date_weekly
            )

            # Fetch Monthly
            df_month = upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='months', # Upstox API uses 'months'
                interval=1,
                to_date=to_date,
                from_date=from_date_monthly
            )

            # Skip if data not available
            if df_week is None or df_month is None:
                console.print(f"[dim]⚠️ Skipping {symbol} - Data not available[/dim]")
                continue

            # Analyze Trends
            week_status, week_bullish = get_trend_status(df_week)
            month_status, month_bullish = get_trend_status(df_month)

            # Determine Rating
            rating = "⭐" # Base rating (C Setup)
            setup_type = "C (Scalp)"

            if week_bullish and month_bullish:
                rating = "⭐⭐⭐"
                setup_type = "A+ (Swing)"
            elif week_bullish:
                rating = "⭐⭐"
                setup_type = "B (Momtm)"

            results.append({
                'Symbol': symbol,
                'Price': row['close'],
                'ATR%': atr_pct,
                'Weekly': week_status,
                'Monthly': month_status,
                'Rating': rating,
                'Setup': setup_type
            })

            # Rate limit
            # time.sleep(0.2) 

    # 4. Display Results
    display_results(results)

def display_results(results):
    if not results:
        return

    table = Table(title="📊 MULTI-TIMEFRAME VOLATILITY ANALYSIS", style="bold white")
    
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("Price ₹", justify="right")
    table.add_column("Daily ATR%", justify="center", style="bold yellow")
    table.add_column("Weekly Trend", justify="center")
    table.add_column("Monthly Trend", justify="center")
    table.add_column("Rating", justify="center", style="bold magenta")
    table.add_column("Setup Type", style="dim")

    # Sort by Rating (A+ first) then ATR%
    results.sort(key=lambda x: (len(x['Rating']), x['ATR%']), reverse=True)

    for res in results:
        # Color codes
        w_color = "green" if res['Weekly'] == "Bullish" else "red"
        m_color = "green" if res['Monthly'] == "Bullish" else "red"
        
        table.add_row(
            res['Symbol'],
            f"{res['Price']:.2f}",
            f"{res['ATR%']:.2f}%",
            f"[{w_color}]{res['Weekly']}[/{w_color}]",
            f"[{m_color}]{res['Monthly']}[/{m_color}]",
            res['Rating'],
            res['Setup']
        )

    console.print(table)
    console.print("\n[dim]⭐⭐⭐ A+ Setup: Bullish on Daily, Weekly, AND Monthly (Best for Swing)[/dim]")
    console.print("[dim]⭐⭐ B Setup: Bullish on Daily and Weekly (Good for Multi-day)[/dim]")
    console.print("[dim]⭐ C Setup: Daily Volatility only (Strictly Intraday Scalping)[/dim]")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Verify Volatility Trends')
    parser.add_argument('--limit', type=int, default=20, help='Number of stocks to verify')
    args = parser.parse_args()

    verify_trends(args.limit)
