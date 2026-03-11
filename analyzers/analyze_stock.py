import argparse
import sys
from pathlib import Path
import pandas as pd
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
from upstox_trader.config import UPSTOX_CONFIG

console = Console()

def _calculate_rsi(close_series, length=14):
    """Calculate RSI using Wilder's smoothing (RMA)."""
    delta = close_series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / length, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / length, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))

def get_stock_analysis(symbol, api_instance=None):
    """
    Analyze a single stock and return metrics.
    Returns dict with metrics or None if failed.
    """
    # 1. Initialize API if not provided
    if api_instance is None:
        try:
            api_key = UPSTOX_CONFIG.get('api_key')
            api_secret = UPSTOX_CONFIG.get('api_secret')
            api_instance = UpstoxAPI(api_key, api_secret, quiet=True)
        except Exception as e:
            print(f"Failed to initialize Upstox API: {e}")
            return None

    # 2. Validate symbol and fetch data
    instrument_key = api_instance.get_instrument_key(symbol)
    if not instrument_key:
        return {'error': f"Symbol '{symbol}' not found in Upstox instruments"}

    # Use a wider lookback to survive weekends/holidays.
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    
    df = api_instance.fetch_historical_data_v3(
        symbol=symbol,
        unit='minutes',
        interval=1,
        to_date=to_date,
        from_date=from_date
    )

    if df is None or df.empty:
        # Fallback to intraday endpoint in case historical window yields no candles.
        df = api_instance.fetch_intraday_data_v3(symbol=symbol, interval='1')

    if df is None or df.empty:
        return {'error': f"No candles returned for {symbol} (lookback: {from_date} to {to_date})"}

    # 3. Calculate Indicators
    if len(df) < 50:
        return {'error': 'Not enough data'}
    
    # EMA 20 & 50
    df['EMA_20'] = df['close'].ewm(span=20, adjust=False).mean()
    df['EMA_50'] = df['close'].ewm(span=50, adjust=False).mean()

    # RSI 14
    df['RSI_14'] = _calculate_rsi(df['close'], length=14)

    # VWAP (session cumulative)
    typical_price = (df['high'] + df['low'] + df['close']) / 3
    cumulative_pv = (typical_price * df['volume']).cumsum()
    cumulative_volume = df['volume'].cumsum().replace(0, pd.NA)
    df['VWAP_D'] = cumulative_pv / cumulative_volume

    # Get latest candle
    last_row = df.iloc[-1]
    
    close = last_row['close']
    ema20 = last_row['EMA_20']
    ema50 = last_row['EMA_50']
    rsi = last_row['RSI_14']
    vwap = last_row.get('VWAP_D', None)
    
    # 4. Determine Status
    trend = "SIDEWAYS"
    if close > ema20 > ema50:
        trend = "BULLISH 🚀"
    elif close < ema20 < ema50:
        trend = "BEARISH 🐻"
    elif close > ema20:
        trend = "MILDLY BULLISH"
    elif close < ema20:
        trend = "MILDLY BEARISH"
        
    rsi_status = "NEUTRAL"
    if rsi > 70: rsi_status = "OVERBOUGHT"
    elif rsi < 30: rsi_status = "OVERSOLD"
    elif rsi > 60: rsi_status = "STRONG"
    elif rsi < 40: rsi_status = "WEAK"
    
    # Volume Analysis
    df['vol_sma20'] = df['volume'].rolling(20).mean()
    last_vol = df['volume'].iloc[-1]
    last_vol_sma = df['vol_sma20'].iloc[-1]
    
    vol_status = "NORMAL"
    if last_vol > last_vol_sma * 5:
        vol_status = "EXTREME BURST (5x) 💥"
    elif last_vol > last_vol_sma * 3:
        vol_status = "HIGH BURST (3x) ⚡"
    elif last_vol > last_vol_sma * 1.5:
        vol_status = "ELEVATED"
    elif last_vol < last_vol_sma * 0.5:
        vol_status = "LOW"

    # Check for recent bursts (last 30 mins)
    recent_bursts = []
    last_30 = df.tail(30)
    for idx, row in last_30.iterrows():
        if row['volume'] > row['vol_sma20'] * 3:
            time_str = idx.strftime('%H:%M')
            burst_size = row['volume'] / row['vol_sma20']
            recent_bursts.append(f"{time_str} ({burst_size:.1f}x)")
    
    burst_msg = ", ".join(recent_bursts) if recent_bursts else "None"
    
    # Day High/Low
    day_high = df[df.index.date == pd.to_datetime(last_row.name).date()]['high'].max()
    day_low = df[df.index.date == pd.to_datetime(last_row.name).date()]['low'].min()
    
    dist_high = ((day_high - close) / day_high) * 100
    dist_low = ((close - day_low) / day_low) * 100

    return {
        'symbol': symbol,
        'close': close,
        'trend': trend,
        'rsi': rsi,
        'rsi_status': rsi_status,
        'vwap': vwap,
        'vol_status': vol_status,
        'burst_msg': burst_msg,
        'day_high': day_high,
        'day_low': day_low,
        'dist_high': dist_high,
        'dist_low': dist_low,
        'last_5_candles': df.tail(5)
    }

def display_analysis(data):
    """Display the analysis result."""
    if not data:
        console.print("[red]No data to display.[/red]")
        return

    symbol = data['symbol']
    close = data['close']
    trend = data['trend']
    rsi = data['rsi']
    rsi_status = data['rsi_status']
    vwap = data['vwap']
    vol_status = data['vol_status']
    burst_msg = data['burst_msg']
    
    # Format Trend Color
    trend_str = trend
    if "BULLISH" in trend: trend_str = f"[bold green]{trend}[/bold green]"
    elif "BEARISH" in trend: trend_str = f"[bold red]{trend}[/bold red]"
    
    # Format RSI Color
    rsi_str = f"{rsi:.1f} ({rsi_status})"
    if "OVERBOUGHT" in rsi_status: rsi_str = f"[bold red]{rsi_str}[/bold red]"
    elif "OVERSOLD" in rsi_status: rsi_str = f"[bold green]{rsi_str}[/bold green]"
    
    # Format Vol Status
    vol_str = vol_status
    if "BURST" in vol_status: vol_str = f"[bold yellow]{vol_status}[/bold yellow]"
    
    # Header Panel
    last_date = data['last_5_candles'].index[-1].strftime('%Y-%m-%d')
    console.print(Panel(f"[bold white]{symbol} Intraday Analysis (1-min) [{last_date}][/bold white]", style="blue"))
    
    # Key Metrics Table
    table = Table(show_header=False, box=None)
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="bold white")
    
    table.add_row("Current Price", f"₹{close:.2f}")
    table.add_row("Trend (EMA)", trend_str)
    table.add_row("Momentum (RSI)", rsi_str)
    if vwap:
        vwap_signal = "[green]ABOVE[/green]" if close > vwap else "[red]BELOW[/red]"
        table.add_row("VWAP Status", f"{vwap_signal} (₹{vwap:.2f})")
    table.add_row("Volume Status", vol_str)
    table.add_row("Recent Bursts", burst_msg, style="yellow")
    
    table.add_row("Day Range", f"Low: ₹{data['day_low']:.2f} | High: ₹{data['day_high']:.2f}")
    table.add_row("Position", f"{data['dist_low']:.1f}% from Low | {data['dist_high']:.1f}% from High")

    console.print(table)
    
    # Recent Candles (Mini Tape)
    console.print("\n[dim]Last 5 Candles:[/dim]")
    tape_table = Table(box=None, show_edge=False)
    tape_table.add_column("Time", style="dim")
    tape_table.add_column("Price")
    tape_table.add_column("Vol")
    
    for i in range(5, 0, -1):
        row = data['last_5_candles'].iloc[-i]
        time_str = row.name.strftime('%H:%M')
        color = "green" if row['close'] > row['open'] else "red"
        tape_table.add_row(
            time_str, 
            f"[{color}]{row['close']:.2f}[/{color}]",
            str(int(row['volume']))
        )
    console.print(tape_table)

def analyze_stock(symbol):
    """Entry point for CLI."""
    console.print(f"[cyan]Fetching 1-min data for {symbol}...[/cyan]")
    data = get_stock_analysis(symbol)
    if data and data.get('error'):
        console.print(f"[red]{data['error']}[/red]")
    elif data:
        display_analysis(data)
    else:
        console.print(f"[red]No data found for {symbol}.[/red]")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Single Stock Analysis')
    parser.add_argument('symbol', type=str, help='Stock Symbol (e.g., TCS)')
    args = parser.parse_args()
    
    analyze_stock(args.symbol.upper())
