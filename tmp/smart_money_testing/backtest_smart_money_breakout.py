import sys
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, time
import time as time_module  # For sleep

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

def get_date_range(num_days: int):
    """Determines the date range for the backtest."""
    today = datetime.now()
    to_date = today.strftime('%Y-%m-%d')
    from_date = (today - timedelta(days=num_days)).strftime('%Y-%m-%d')
    return from_date, to_date

def overlaps(top1, bot1, top2, bot2):
    """Check if two y-ranges overlap."""
    return top1 > bot2 and bot1 < top2

def calc_bars_ago(series, window_size, is_highest=True):
    def func(window):
        arr = window.values
        n = min(len(arr), window_size)
        if n < window_size:
            return np.nan  # or 0, but use nan for safety
        sub_arr = arr[-window_size:]
        if is_highest:
            extrem_idx = np.argmax(sub_arr)
        else:
            extrem_idx = np.argmin(sub_arr)
        bars_ago = window_size - 1 - extrem_idx
        return bars_ago
    return series.rolling(window=window_size).apply(func, raw=False)

def fetch_intraday_data(ticker: str, screener):
    """Fetch intraday data using V3 intraday endpoint for current trading day candles."""
    import requests
    from datetime import datetime

    try:
        # Get instrument key for ticker (assume EQ for stocks)
        instrument_key = screener.upstox_api.get_instrument_key(ticker, instrument_type="EQ")
        if not instrument_key:
            console.print(f"[red]❌ Could not get instrument key for {ticker}.[/red]")
            return None

        url = f"https://api.upstox.com/v3/historical-candle/intraday/{instrument_key}/minutes/15"
        
        # Get access token from API (assuming it's accessible; adjust if needed)
        access_token = screener.upstox_api.access_token  # Assume API has this attribute
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}"
        }

        console.print(f"[dim]Fetching intraday 15-min data for {ticker} using V3 intraday API...[/dim]")
        response = requests.get(url, headers=headers, timeout=30)

        if response.status_code == 200:
            data = response.json()
            if data.get('status') == 'success' and 'data' in data and 'candles' in data['data']:
                candles = data['data']['candles']
                if not candles:
                    console.print(f"[yellow]No intraday candles available for {ticker} today.[/yellow]")
                    return None

                # Parse to DataFrame
                df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi'])
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df.set_index('timestamp', inplace=True)
                df = df.astype({'open': 'float', 'high': 'float', 'low': 'float', 'close': 'float', 'volume': 'float'})
                console.print(f"[green]✅ Fetched {len(df)} intraday 15-min candles for {ticker} (up to {df.index[-1]}).[/green]")
                return df
            else:
                console.print(f"[red]❌ Intraday API response error: {data}.[/red]")
                return None
        else:
            console.print(f"[red]❌ Intraday API HTTP error {response.status_code}: {response.text}.[/red]")
            return None
    except AttributeError:
        console.print("[red]❌ Access token not accessible from API. Check upstox_api implementation.[/red]")
        return None
    except Exception as e:
        console.print(f"[red]❌ Intraday fetch error: {e}.[/red]")
        return None

def run_smart_money_backtest(ticker: str, num_days: int):
    console.print(f"\n[bold cyan]🚀 Running Smart Money Breakout Backtest for {ticker} | Duration: {num_days} days | R:R ~2.3:1 with Trailing Stop[/bold cyan]")

    from_date, to_date = get_date_range(num_days)
    console.print(f"[dim]Fetching data from {from_date} to {to_date}[/dim]")

    screener = TVScreenerUsage(enable_paper_trading=False)

    # Force download and cache of instrument file if not present
    console.print("[bold green]Attempting to load/download Upstox instrument data...[/bold green]")
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX")
    console.print("[bold green]Instrument data loading/downloading process initiated.[/bold green]")

    historical_df = None
    if num_days == 1:
        # Use intraday API for same-day real-time data
        historical_df = fetch_intraday_data(ticker, screener)
    else:
        # For multi-day, fetch historical for past days + intraday for today
        today = datetime.now().strftime('%Y-%m-%d')
        past_days = num_days - 1
        if past_days > 0:
            past_from, past_to = get_date_range(past_days)
            past_df = screener.upstox_api.fetch_historical_data_v3(
                symbol=ticker,
                unit="minutes",
                interval=15,
                from_date=past_from,
                to_date=past_to
            )
            today_df = fetch_intraday_data(ticker, screener)
            if past_df is not None and not past_df.empty:
                historical_df = pd.concat([past_df, today_df]) if today_df is not None and not today_df.empty else past_df
            else:
                historical_df = today_df
        else:
            historical_df = fetch_intraday_data(ticker, screener)
        
        # Sort by index
        if historical_df is not None and not historical_df.empty:
            historical_df = historical_df.sort_index(ascending=True)

    if historical_df is None or historical_df.empty:
        console.print(f"[red]❌ Could not fetch 15-minute data for {ticker} from {from_date} to {to_date}.[/red]")
        console.print("[yellow]Please ensure the market was open and data is available for this date.[/yellow]")
        return

    # Preprocess data
    df = historical_df.copy()
    if 'volume' not in df.columns:
        df['volume'] = 0  # If no volume, set to 0

    # Log data to file
    import os
    log_dir = "tmp/smart_money_testing"
    os.makedirs(log_dir, exist_ok=True)
    log_file = f"{log_dir}/{ticker}_smart_money_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    df.to_csv(log_file)
    console.print(f"[green]✅ Data logged to {log_file}[/green]")

    length_ = 100
    length = 14
    strong = True  # Default
    overlap = False  # Default

    # Normalization
    df['norm_low'] = df['low'].rolling(window=length_, min_periods=1).min()
    df['norm_high'] = df['high'].rolling(window=length_, min_periods=1).max()
    range_val = df['norm_high'] - df['norm_low']
    df['normalized_price'] = np.where(range_val != 0, (df['close'] - df['norm_low']) / range_val, 0.5)

    df['vol'] = df['normalized_price'].rolling(window=14, min_periods=1).std()

    lookback = length + 1
    df['highestbars'] = calc_bars_ago(df['vol'], lookback, is_highest=True)
    df['lowestbars'] = calc_bars_ago(df['vol'], lookback, is_highest=False)

    df['upper'] = (df['highestbars'] + length) / length
    df['lower'] = (df['lowestbars'] + length) / length

    # Crossovers
    df['cross_low_upper'] = (df['lower'] > df['upper']) & (df['lower'].shift(1) <= df['upper'].shift(1))
    df['cross_upper_low'] = (df['upper'] > df['lower']) & (df['upper'].shift(1) <= df['lower'].shift(1))

    # Smoothed volume for potential confirmation (not used in entry for simplicity)
    df['smoothedvol'] = df['volume'].rolling(20, min_periods=1).mean()

    # 3. Simulate Backtest
    trades = []
    current_position = None
    entry_price = 0
    entry_time = None
    highest_profit_pct = 0

    # Strategy parameters (tighter)
    # STOP_LOSS_PCT = -3  # Disabled; dynamic channel level
    TAKE_PROFIT_PCT = 2.5
    TRAILING_STOP_PCT = 0.2
    TRAILING_ACTIVATION_PCT = 0.5
    CAPITAL_PER_TRADE = 100000

    # Active channels: list of dicts {'top': float, 'bot': float}
    active_channels = []
    last_consol_start = -1000  # Far back

    console.print("\n[bold magenta]📈 Starting Smart Money Breakout Backtest Simulation...[/bold magenta]")

    for i in range(len(df)):
        row = df.iloc[i]
        timestamp = df.index[i]
        hour = timestamp.hour
        minute = timestamp.minute

        # Debug print for 09-22 around 10-12
        if timestamp.date() == datetime(2025, 9, 22).date() and 10 <= hour <= 12:
            debug_str = f"DEBUG {timestamp}: vol={df['vol'].iloc[i]:.4f}, upper={df['upper'].iloc[i]:.4f}, lower={df['lower'].iloc[i]:.4f}, cross_upper_low={df['cross_upper_low'].iloc[i]}, duration={duration}, strong_price={(row['open'] + row['close'])/2:.2f}, close={row['close']:.2f}, active_channels={len(active_channels)}"
            console.print(f"[yellow]{debug_str}[/yellow]")

        # No new entries after 3 PM
        if hour >= 15 and current_position is None:
            # But continue checking exits
            pass

        # Update consolidation start
        if df['cross_low_upper'].iloc[i]:
            last_consol_start = i

        duration = i - last_consol_start

        # Check for new channel formation
        if df['cross_upper_low'].iloc[i] and duration > 5:
            # Compute channel bounds (assuming h/l are price high/low over duration)
            start_idx = max(0, i - duration)
            channel_top = df['high'].iloc[start_idx:i+1].max()
            channel_bot = df['low'].iloc[start_idx:i+1].min()

            # Check if can create (no overlap with existing)
            can_create = True
            for ch in active_channels:
                if overlaps(channel_top, channel_bot, ch['top'], ch['bot']):
                    can_create = False
                    break

            if can_create:
                active_channels.append({'top': channel_top, 'bot': channel_bot})
                console.print(f"[blue]📦 New Channel Formed @ {timestamp} | Top: ₹{channel_top:.2f}, Bot: ₹{channel_bot:.2f}, Duration: {duration}[/blue]")

        # Check breakouts for active channels
        strong_price = (row['open'] + row['close']) / 2 if strong else row['close']

        # Volume confirmation
        vol_confirm = row['volume'] > 1.5 * df['smoothedvol'].iloc[i]

        for ch_idx in range(len(active_channels) - 1, -1, -1):
            ch = active_channels[ch_idx]
            if vol_confirm and row['high'] > ch['top']:
                # Bullish breakout (wick)
                breakout_level = ch['bot']
                del active_channels[ch_idx]
                console.print(f"[green]▲ Bullish Breakout @ {timestamp} | Level: ₹{breakout_level:.2f}, Price: ₹{row['close']:.2f}[/green]")
                current_time = timestamp.time()
                if current_position is None and current_time >= time(10, 0) and current_time <= time(14, 45):
                    entry_price = row['close']
                    tp_price = entry_price * (1 + TAKE_PROFIT_PCT / 100)
                    current_position = {
                        'side': 'LONG',
                        'entry_time': timestamp,
                        'entry_date': timestamp.date(),
                        'entry_price': entry_price,
                        'sl_level': ch['bot'],
                        'tp_price': tp_price,
                        'highest_pnl': 0
                    }
                    console.print(f"[green]⬆️ LONG Entry @ ₹{entry_price:.2f} | SL: ₹{ch['bot']:.2f}, TP: ₹{tp_price:.2f} | Time: {timestamp.strftime('%H:%M')}[/green]")
            elif vol_confirm and row['low'] < ch['bot']:
                # Bearish breakout (wick)
                breakout_level = ch['top']
                del active_channels[ch_idx]
                console.print(f"[red]▼ Bearish Breakout @ {timestamp} | Level: ₹{breakout_level:.2f}, Price: ₹{row['close']:.2f}[/red]")
                current_time = timestamp.time()
                if current_position is None and current_time >= time(10, 0) and current_time <= time(14, 45):
                    entry_price = row['close']
                    tp_price = entry_price * (1 - TAKE_PROFIT_PCT / 100)
                    current_position = {
                        'side': 'SHORT',
                        'entry_time': timestamp,
                        'entry_date': timestamp.date(),
                        'entry_price': entry_price,
                        'sl_level': ch['top'],
                        'tp_price': tp_price,
                        'highest_pnl': 0
                    }
                    console.print(f"[red]⬇️ SHORT Entry @ ₹{entry_price:.2f} | SL: ₹{ch['top']:.2f}, TP: ₹{tp_price:.2f} | Time: {timestamp.strftime('%H:%M')}[/red]")

        # Position management (if in trade)
        if current_position:
            side = current_position['side']
            entry_price = current_position['entry_price']
            sl_level = current_position['sl_level']
            tp_price = current_position['tp_price']
            entry_date = current_position['entry_date']
            current_price = row['close']
            current_time = timestamp.time()

            # Conditional multi-day hold: Exit next day open only if in loss
            if timestamp.date() > entry_date:
                current_price_for_check = row['open']
                pnl_pct_check = ((current_price_for_check - entry_price) / entry_price) * 100 if side == 'LONG' else ((entry_price - current_price_for_check) / entry_price) * 100
                if pnl_pct_check < 0:
                    exit_reason = 'NO_MULTIDAY_LOSS'
                    exit_price = current_price_for_check
                    pnl_amount = (pnl_pct_check / 100) * CAPITAL_PER_TRADE
                    trades.append({
                        'entry_time': current_position['entry_time'],
                        'exit_time': timestamp,
                        'side': side,
                        'entry_price': entry_price,
                        'exit_price': exit_price,
                        'pnl_pct': pnl_pct_check,
                        'pnl_amount': pnl_amount,
                        'reason': exit_reason
                    })
                    console.print(f"[yellow]🚫 No Multi-Day Loss Exit ({side}) @ ₹{exit_price:.2f} | P&L: {pnl_pct_check:+.2f}% (₹{pnl_amount:+,.0f})[/yellow]")
                    current_position = None
                    continue
                else:
                    # Hold position: update highest pnl with open price
                    if pnl_pct_check > current_position['highest_pnl']:
                        current_position['highest_pnl'] = pnl_pct_check

            # Update highest profit (only same day)
            pnl_pct = ((current_price - entry_price) / entry_price) * 100
            if side == 'SHORT':
                pnl_pct = -pnl_pct
            if pnl_pct > current_position['highest_pnl']:
                current_position['highest_pnl'] = pnl_pct

            # Time-based exit after 3:30 PM only if in loss (EOD on entry day)
            if current_time >= time(15, 30) and pnl_pct < 0:
                pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
                trades.append({
                    'entry_time': current_position['entry_time'],
                    'exit_time': timestamp,
                    'side': side,
                    'entry_price': entry_price,
                    'exit_price': current_price,
                    'pnl_pct': pnl_pct,
                    'pnl_amount': pnl_amount,
                    'reason': 'EOD_LOSS_EXIT'
                })
                console.print(f"[blue]⏰ EOD Loss Exit (3:30PM) ({side}) @ ₹{current_price:.2f} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})[/blue]")
                current_position = None
                continue  # Next bar

            exit_reason = None
            exit_price = current_price

            # Dynamic Stop Loss (channel level)
            if side == 'LONG' and row['low'] <= sl_level:
                exit_reason = 'SL'
                exit_price = sl_level  # Hit channel bottom
            elif side == 'SHORT' and row['high'] >= sl_level:
                exit_reason = 'SL'
                exit_price = sl_level  # Hit channel top

            # Take Profit
            if not exit_reason and ((side == 'LONG' and row['high'] >= tp_price) or (side == 'SHORT' and row['low'] <= tp_price)):
                exit_reason = 'TP'
                exit_price = tp_price

            # Trailing Stop (pct drop from high)
            if not exit_reason and current_position['highest_pnl'] >= TRAILING_ACTIVATION_PCT and (current_position['highest_pnl'] - pnl_pct) >= TRAILING_STOP_PCT:
                exit_reason = 'TRAILING_STOP'
                exit_price = current_price  # Exit at close for pct-based

            if exit_reason:
                if side == 'SHORT':
                    pnl_pct = ((entry_price - exit_price) / entry_price) * 100  # Recalc for short
                else:
                    pnl_pct = ((exit_price - entry_price) / entry_price) * 100
                pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
                trades.append({
                    'entry_time': current_position['entry_time'],
                    'exit_time': timestamp,
                    'side': side,
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'pnl_pct': pnl_pct,
                    'pnl_amount': pnl_amount,
                    'reason': exit_reason
                })
                console.print(f"[{ 'red' if 'SL' in exit_reason else 'green' if 'TP' in exit_reason else 'orange3' }] {exit_reason} ({side}) @ ₹{exit_price:.2f} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) {'(High: ' + str(current_position['highest_pnl']) + '%)' if 'TRAILING' in exit_reason else '' }[/]")
                current_position = None
                continue

    # EOD Close if any position still open (though time exit should handle, but safety)
    if current_position:
        last_row = df.iloc[-1]
        final_price = last_row['close']
        timestamp = df.index[-1]
        side = current_position['side']
        entry_price = current_position['entry_price']
        entry_time = current_position['entry_time']
        pnl_pct = ((final_price - entry_price) / entry_price) * 100
        if side == 'SHORT':
            pnl_pct = (entry_price - final_price) / entry_price * 100
        pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
        trades.append({
            'entry_time': entry_time,
            'exit_time': timestamp,
            'side': side,
            'entry_price': entry_price,
            'exit_price': final_price,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'reason': 'EOD_CLOSE'
        })
        console.print(f"[yellow]🏁 EOD Close ({side}) @ ₹{final_price:.2f} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})[/yellow]")

    # Report Results
    console.print("\n[bold cyan]📊 Backtest Results:[/bold cyan]")
    if not trades:
        console.print("[yellow]No trades were generated during the backtest period.[/yellow]")
        return

    results_table = Table(title="Simulated Trades", show_header=True, header_style="bold blue")
    results_table.add_column("Entry Time", style="cyan")
    results_table.add_column("Exit Time", style="cyan")
    results_table.add_column("Side", style="white")
    results_table.add_column("Entry Price", justify="right", style="green")
    results_table.add_column("Exit Price", justify="right", style="red")
    results_table.add_column("P&L %", justify="right", style="magenta")
    results_table.add_column("P&L ₹", justify="right", style="yellow")
    results_table.add_column("Reason", style="dim")

    total_pnl_pct = 0
    total_pnl_amount = 0
    winning_trades = 0
    losing_trades = 0

    for trade in trades:
        pnl_style = "green" if trade['pnl_pct'] > 0 else "red"
        total_pnl_pct += trade['pnl_pct']
        total_pnl_amount += trade['pnl_amount']
        if trade['pnl_pct'] > 0:
            winning_trades += 1
        else:
            losing_trades += 1

        entry_str = trade['entry_time'].strftime('%Y-%m-%d %H:%M') if trade['entry_time'] is not None else 'N/A'
        exit_str = trade['exit_time'].strftime('%Y-%m-%d %H:%M') if trade['exit_time'] is not None else 'N/A'
        results_table.add_row(
            entry_str,
            exit_str,
            trade['side'],
            f"₹{trade['entry_price']:.2f}",
            f"₹{trade['exit_price']:.2f}",
            f"[{pnl_style}]{trade['pnl_pct']:+.2f}%[/{pnl_style}]",
            f"[{pnl_style}]{trade['pnl_amount']:+,.0f}[/{pnl_style}]",
            trade['reason']
        )

    console.print(results_table)

    win_rate = (winning_trades / len(trades) * 100) if trades else 0

    console.print(f"\n[bold yellow]Summary for {ticker}:[/bold yellow]")
    console.print(f"Total Trades: {len(trades)}")
    console.print(f"Winning Trades: {winning_trades}")
    console.print(f"Losing Trades: {losing_trades}")
    console.print(f"Win Rate: {win_rate:.2f}%")
    console.print(f"Total P&L %: {total_pnl_pct:+.2f}%")
    console.print(f"Total P&L ₹: {total_pnl_amount:+,.0f}")
    console.print("\n[bold green]Backtest completed.[/bold green]")

# Main execution
if __name__ == "__main__":
    symbols = ["TATAMOTORS", "RELIANCE", "HDFCBANK", "INFY", "TCS", "ITC", "BHARTIARTL", "ICICIBANK"]
    num_days = 200  # Backtest period

    for ticker in symbols:
        run_smart_money_backtest(ticker, num_days)
        time_module.sleep(2)  # Small delay