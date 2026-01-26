import argparse
from tradingview_screener import Query, Column
from rich.console import Console
from rich.table import Table
import pandas as pd
import sys
import os

# Add path to import utils modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from utils.tv_utils import clean_and_deduplicate, format_change, format_rsi

console = Console()

def fetch_trending_stocks(limit=50):
    """Fetch stocks matching 'trending upside' criteria."""
    try:
        # Criteria:
        # 1. Trend: Price > EMA20 > EMA50
        # 2. Momentum: RSI > 50
        # 3. Strength: ADX > 20
        # 4. Volume: Relative Volume > 1.0
        
        query = (
            Query()
            .select(
                'name', 'close', 'change', 'volume',
                'RSI', 'ADX', 'EMA20', 'EMA50', 'Mom',
                'relative_volume_10d_calc', 'sector', 'market_cap_basic',
                'price_52_week_high', 'Perf.W', 'Volatility.D',
                'return_on_equity', 'debt_to_equity',
                'MACD.macd', 'MACD.signal', 'Perf.1M', 'earnings_release_next_date',
                'ATR'  # Added for volatility-based time estimates
            )
            .set_markets('india')
            .where(
                Column('close') > Column('EMA20'),
                Column('EMA20') > Column('EMA50'),
                Column('RSI') > 50,
                Column('ADX') > 20,
                Column('relative_volume_10d_calc') > 0.5,  # Relaxed from >1.0 to allow more candidates
                Column('market_cap_basic') > 50_000_000_000,  # > 5000 Cr (Mid/Large Cap)
                Column('return_on_equity') > 10               # Quality Check
            )
            .order_by('Mom', ascending=False)
            .limit(limit)
        )
        
        _, df = query.get_scanner_data()
        
        if df.empty:
            return df

        # Deduplicate using helper
        df = clean_and_deduplicate(df)

        # Calculate Swing Score
        df['dist_52w'] = ((df['price_52_week_high'] - df['close']) / df['price_52_week_high']) * 100
        
        def calculate_score(row):
            score = 0
            
            # 1. RSI (30 pts) - Momentum
            rsi = row['RSI']
            if 50 <= rsi <= 70: score += 30
            elif 70 < rsi <= 80: score += 25
            else: score += 10
            
            # 2. ADX (20 pts) - Trend Strength
            adx = row['ADX']
            if adx > 30: score += 20
            elif adx > 25: score += 15
            elif adx > 20: score += 10
            
            # 3. Volume (20 pts) - Participation
            rvol = row['relative_volume_10d_calc']
            if rvol > 2.0: score += 20
            elif rvol > 1.5: score += 15
            else: score += 10
            
            # 4. 52W High (30 pts) - Breakout Potential
            dist = row['dist_52w']
            if dist < 2: score += 30      # At or very near high (Breakout)
            elif dist < 5: score += 25    # Near high
            elif dist < 10: score += 15   # Within striking distance
            else: score += 5

            # 5. MACD (10 pts) - Trend Confirmation
            if row['MACD.macd'] > row['MACD.signal']:
                score += 10

            # 6. Monthly Momentum (10 pts)
            if row['Perf.1M'] > 5:
                score += 10
            
            # 7. Earnings Penalty (Avoid binary events)
            # earnings_release_next_date is unix timestamp
            if pd.notnull(row['earnings_release_next_date']):
                import time
                days_to_earnings = (row['earnings_release_next_date'] - time.time()) / 86400
                if 0 <= days_to_earnings < 3:
                    score -= 50 # Heavy penalty for imminent earnings
            
            return score

        df['swing_score'] = df.apply(calculate_score, axis=1)
        df = df.sort_values('swing_score', ascending=False)
        
        return df
    except Exception as e:
        console.print(f"[red]Error fetching data: {e}[/red]")
        return pd.DataFrame()

def display_trending(df):
    """Display the trending stocks."""
    if df.empty:
        console.print("[yellow]No trending stocks found matching criteria.[/yellow]")
        return

    table = Table(title="🎯 TOP SWING TRADE CANDIDATES (Scored)", style="blue")
    
    table.add_column("Rank", style="dim", width=4)
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("Price ₹", justify="right")
    table.add_column("Change %", justify="right")
    table.add_column("Score", justify="center", style="bold magenta")
    table.add_column("52W Dist", justify="right")
    table.add_column("RSI", justify="right")
    table.add_column("MACD", justify="center")
    table.add_column("Perf.1M", justify="right")
    table.add_column("ROE", justify="right")
    table.add_column("Sector", style="dim")

    rank = 1
    for _, row in df.iterrows():
        # Color code change
        change_str = format_change(row['change'])
        
        # Score visual
        score = row['swing_score']
        score_str = f"{score}/100"
        if score >= 80: score_str = f"[bold green]{score_str}[/bold green]"
        elif score >= 60: score_str = f"[yellow]{score_str}[/yellow]"
        
        # 52W Dist visual
        dist = row['dist_52w']
        dist_str = f"{dist:.1f}%"
        if dist < 2: dist_str = f"[bold green]🚀 {dist_str}[/bold green]"
        
        # RSI visual
        rsi_str = format_rsi(row['RSI'])

        # MACD visual
        macd_val = "Bullish" if row['MACD.macd'] > row['MACD.signal'] else "Bearish"
        macd_str = f"[green]{macd_val}[/green]" if macd_val == "Bullish" else f"[red]{macd_val}[/red]"

        # Perf 1M visual
        perf_1m = row['Perf.1M']
        perf_str = f"[green]+{perf_1m:.1f}%[/green]" if perf_1m > 0 else f"[red]{perf_1m:.1f}%[/red]"

        table.add_row(
            f"#{rank}",
            row['name'],
            f"{row['close']:.2f}",
            change_str,
            score_str,
            dist_str,
            rsi_str,
            macd_str,
            perf_str,
            f"{row['return_on_equity']:.1f}%",
            str(row['sector'])
        )
        rank += 1

    console.print(table)
    console.print(f"\n[dim]Score based on: Trend (ADX, MACD), Momentum (RSI, Perf.1M), Volume, and 52W Proximity.[/dim]")
    console.print(f"[dim]Filters: Market Cap > 5000Cr | ROE > 10% | Earnings Penalty applied (<3 days)[/dim]")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Trending Upside Scanner')
    parser.add_argument('--limit', type=int, default=50, help='Number of stocks to display')
    args = parser.parse_args()

    with console.status("[bold green]Scanning for trending stocks...[/bold green]"):
        df = fetch_trending_stocks(args.limit)
    
    display_trending(df)
