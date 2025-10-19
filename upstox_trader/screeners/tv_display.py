from rich.console import Console
from rich.table import Table
from typing import List, Dict, Optional
import pandas as pd

console = Console()


def _fmt_change(change_val: float) -> str:
    color = "green" if change_val is not None and change_val > 0 else "red"
    return f"[{color}]{change_val:+.2f}%[/{color}]" if change_val is not None else "N/A"


def _fmt_vol_ratio(vol_ratio: Optional[float]) -> str:
    if vol_ratio is None:
        return "N/A"
    vol_color = "bold red" if vol_ratio > 3 else "red" if vol_ratio > 2 else "white"
    return f"[{vol_color}]{vol_ratio:.1f}x[/{vol_color}]"


def _fmt_rsi(rsi_val: Optional[float]) -> str:
    if rsi_val is None:
        return "N/A"
    rsi_color = "red" if rsi_val > 70 else "green" if rsi_val < 30 else "white"
    return f"[{rsi_color}]{rsi_val:.1f}[/{rsi_color}]"


def _trend_display(trend_val: Optional[str]) -> str:
    if not trend_val:
        return "[dim]—[/dim]"
    if trend_val == 'strong_bullish':
        return "[bold green]🚀[/bold green]"
    if trend_val == 'bullish':
        return "[green]📈[/green]"
    if trend_val == 'neutral':
        return "[yellow]➡️[/yellow]"
    if trend_val == 'bearish':
        return "[red]📉[/red]"
    if trend_val == 'strong_bearish':
        return "[bold red]💥[/bold red]"
    return f"[dim]{trend_val}[/dim]"


def display_gap_fill_results(gap_df: pd.DataFrame) -> None:
    """Display gap-fill analysis results in a formatted table (stateless)."""
    if gap_df.empty:
        console.print("[yellow]No gap-fill opportunities found[/yellow]")
        return

    table = Table(title="🎯 Gap-Fill Trading Opportunities (Historical Analysis)", show_header=True, header_style="bold magenta")
    table.add_column("Symbol", style="cyan", no_wrap=True)
    table.add_column("Gap", justify="right", style="yellow")
    table.add_column("Direction", justify="center", style="bold")
    table.add_column("Fill Prob", justify="right", style="green")
    table.add_column("Historical", justify="center", style="blue")
    table.add_column("Volume", justify="right", style="red")
    table.add_column("Trade Signal", justify="center", style="bold")

    high_prob_trades = 0

    for _, row in gap_df.head(15).iterrows():
        symbol = str(row.get('name', ''))[:12]
        gap_size = row.get('change', 0.0)
        gap_direction = row.get('gap_direction', 'UP' if gap_size and gap_size > 0 else 'DOWN')
        fill_prob = row.get('gap_fill_probability', 0.0)
        similar_gaps = row.get('historical_similar_gaps', 0)
        filled_gaps = row.get('historical_fills', 0)
        vol_ratio = row.get('relative_volume_10d_calc', 0.0)

        gap_color = "green" if gap_size > 0 else "red"
        gap_display = f"[{gap_color}]{gap_size:+.2f}%[/{gap_color}]"

        direction_display = "🔺 UP" if gap_direction == "UP" else "🔻 DOWN"

        if fill_prob >= 70:
            prob_color = "bold green"
        elif fill_prob >= 50:
            prob_color = "yellow"
        else:
            prob_color = "red"
        prob_display = f"[{prob_color}]{fill_prob:.1f}%[/{prob_color}]"

        historical_display = f"{filled_gaps}/{similar_gaps}" if similar_gaps and similar_gaps > 0 else "N/A"

        vol_color = "bold red" if vol_ratio > 3 else "red" if vol_ratio > 2 else "white"
        vol_display = f"[{vol_color}]{vol_ratio:.1f}x[/{vol_color}]"

        if fill_prob >= 60 and (similar_gaps or 0) >= 3:
            signal = "[bold red]📉 SHORT[/bold red]" if gap_direction == "UP" else "[bold green]📈 LONG[/bold green]"
            high_prob_trades += 1
        elif fill_prob >= 45:
            signal = "[yellow]⚠️ WATCH[/yellow]"
        else:
            signal = "[dim]❌ SKIP[/dim]"

        table.add_row(
            symbol,
            gap_display,
            direction_display,
            prob_display,
            historical_display,
            vol_display,
            signal
        )

    console.print(table)

    console.print(f"\n[bold yellow]📊 ANALYSIS SUMMARY:[/bold yellow]")
    console.print(f"• [green]High-probability trades:[/green] {high_prob_trades}")
    console.print(f"• [cyan]Total opportunities:[/cyan] {len(gap_df)}")
    console.print(f"• [blue]Analysis period:[/blue] 90-day historical lookback")

    console.print(f"\n[bold yellow]🎯 TRADING STRATEGY:[/bold yellow]")
    console.print("• [green]Entry:[/green] After 9:30 AM gap confirmation")
    console.print("• [green]TARGET:[/green] Previous day's closing price (gap fill)")
    console.print("• [green]STOP LOSS:[/green] Beyond gap extreme + 1-2% buffer")
    console.print("• [green]Position Size:[/green] Risk 0.5-1% of capital per trade")

    console.print(f"\n[bold yellow]📈 SIGNAL INTERPRETATION:[/bold yellow]")
    console.print("• [bold green]📈 LONG:[/bold green] Gap DOWN with high fill probability")
    console.print("• [bold red]📉 SHORT:[/bold red] Gap UP with high fill probability")
    console.print("• [yellow]⚠️ WATCH:[/yellow] Moderate probability - wait for confirmation")
    console.print("• [dim]❌ SKIP:[/dim] Low probability or insufficient historical data")

    top_trades = gap_df[gap_df.get('gap_fill_probability', pd.Series([])) >= 60].head(3) if not gap_df.empty else pd.DataFrame()
    if not top_trades.empty:
        console.print(f"\n[bold yellow]🏆 TOP RECOMMENDATIONS:[/bold yellow]")
        for i, (_, row) in enumerate(top_trades.iterrows(), 1):
            symbol = row.get('name', '')
            gap_size = row.get('change', 0.0)
            fill_prob = row.get('gap_fill_probability', 0.0)
            direction = "SHORT" if (row.get('gap_direction', 'UP') == "UP") else "LONG"
            console.print(f"{i}. [cyan]{symbol}[/cyan]: {direction} ({gap_size:+.2f}% gap, {fill_prob:.1f}% fill probability)")


def display_sector_table(sector_df: pd.DataFrame, title: str) -> None:
    """Display sector performance table (stateless)."""
    if sector_df.empty:
        console.print(f"[red]No sector data available for {title}[/red]")
        return

    table = Table(title=title, show_header=True, header_style="bold magenta")
    table.add_column("Sector", style="cyan", no_wrap=True)
    table.add_column("Avg Change %", justify="right", style="magenta")
    table.add_column("Stock Count", justify="right", style="blue")
    table.add_column("Total MCap (₹Cr)", justify="right", style="green")
    table.add_column("Avg ROE %", justify="right", style="yellow")
    table.add_column("Avg PE", justify="right", style="red")
    table.add_column("Vol Ratio", justify="right", style="cyan")

    for _, row in sector_df.iterrows():
        change_val = row.get('avg_change', 0.0)
        change_color = "green" if change_val > 0 else "red"
        mcap_formatted = f"₹{row.get('total_mcap', 0)/1e7:,.0f}"

        avg_roe = row.get('avg_roe', float('nan'))
        avg_pe = row.get('avg_pe', float('nan'))
        avg_vol_ratio = row.get('avg_vol_ratio', float('nan'))

        table.add_row(
            str(row.get('sector', ''))[:20],
            f"[{change_color}]{change_val:+.2f}%[/{change_color}]",
            f"{int(row.get('stock_count', 0))}",
            mcap_formatted,
            f"{avg_roe:.1f}%" if pd.notna(avg_roe) and avg_roe > 0 else "N/A",
            f"{avg_pe:.1f}" if pd.notna(avg_pe) and avg_pe > 0 else "N/A",
            f"{avg_vol_ratio:.2f}x" if pd.notna(avg_vol_ratio) else "N/A"
        )

    console.print(table)
    console.print(f"[dim]Showing {len(sector_df)} sectors[/dim]")


def render_watch_table(df: pd.DataFrame, alerts: List[Dict], mode: str, currency_symbol: str = '₹') -> Table:
    """
    Build and return the Rich Table for watch data (pure renderer).
    The caller is responsible for console.print(table) and any extra sections.
    """
    alert_tickers = [a.get('ticker') for a in (alerts or [])]

    mode_titles = {
        'PREBREAKOUT': "Live Market Monitor - Pre-Breakout Signals",
        'FOMO': "Live Market Monitor - Top Volume Movers",
        'SMART_FOMO': "Live Market Monitor - Smart FOMO (Historical Analysis)",
        'ACCUMULATION': "Live Market Monitor - Accumulation Patterns",
        'MOMENTUM': "Live Market Monitor - Early Momentum",
        'OPTIMIZED_GAP': "Live Market Monitor - Gap Strategy Signals",
        'GAP_FILL_SR': "Live Market Monitor - Gap Fill Analysis",
        'HEAVY_BREAKOUT': "Live Market Monitor - Heavy Breakout Patterns",
        'SCALPING': "Live Market Monitor - Ultra-Fast Scalping Signals",
        'MOMENTUM_SCALPER': "Live Market Monitor - Advanced Momentum Scalping",
        'SECTOR_SCALPER': "Live Market Monitor - Sector Correlation Trading",
        'SHORT_SQUEEZE': "Live Market Monitor - Short Squeeze Hunting",
        'BREAKOUT_FAILURE': "Live Market Monitor - Failed Breakout Shorts",
        'EXHAUSTION_REVERSAL': "Live Market Monitor - Exhaustion Reversal Shorts",
        'MORNING_FADE': "Live Market Monitor - Morning Gap Fade Shorts",
        'REVERSAL': "Live Market Monitor - Counter-Trend Reversals",
        'VOLUME_SURGE': "Live Market Monitor - Unusual Volume Activity",
        'CHANNEL_PLAY': "Live Market Monitor - Range-Bound Opportunities",
        'SECTOR_MOMENTUM': "Live Market Monitor - Sector Group Moves",
        'QUICK_PROFIT': "Live Market Monitor - Quick Profit Scalps",
        'FOMO_MOMENTUM': "Live Market Monitor - FOMO Momentum Trading",
        'REALTIME_MOMENTUM': "Live Market Monitor - Real-Time Momentum Detection"
    }
    title = mode_titles.get(mode, "Live Market Monitor")

    table = Table(title=title, show_header=True)
    table.add_column("Ticker", style="cyan", no_wrap=True)
    table.add_column("Name", style="green", max_width=12)
    table.add_column("Price", justify="right", style="yellow")
    table.add_column("Change %", justify="right", style="magenta")
    table.add_column("Volume", justify="right", style="blue")
    table.add_column("Vol Ratio", justify="right", style="red")
    table.add_column("RSI", justify="right", style="cyan")
    table.add_column("Trend", style="bold", justify="center")
    table.add_column("Alert", style="bold red")

    if df is None or df.empty:
        return table

    for _, row in df.head(15).iterrows():
        ticker = row.get('ticker', '')
        is_alert = ticker in alert_tickers if alert_tickers else False

        ticker_style = "[bold red]" if is_alert else ""
        alert_symbol = "🚨" if is_alert else ""

        change_val = row.get('change', 0.0)
        rsi_val = row.get('RSI', None)
        vol_ratio = row.get('relative_volume_10d_calc', None)

        trend_val = row.get('trend', None)
        trend_display = _trend_display(trend_val)

        # Extract symbol from ticker field (format: "NSE:SYMBOL" -> "SYMBOL")
        symbol = str(row.get('ticker', ''))
        if symbol.startswith('NSE:'):
            symbol = symbol.replace('NSE:', '')
        elif symbol.startswith('BSE:'):
            symbol = symbol.replace('BSE:', '')
        elif not symbol or symbol == 'N/A':
            # Fallback to name field if ticker is not available
            symbol = str(row.get('name', ''))[:12]

        table.add_row(
            f"{ticker_style}{ticker}",
            symbol[:12],  # Limit to 12 characters for display
            f"{currency_symbol}{row.get('close', 0):,.2f}",
            _fmt_change(change_val),
            f"{row.get('volume', 0):,.0f}",
            _fmt_vol_ratio(vol_ratio),
            _fmt_rsi(rsi_val),
            trend_display,
            alert_symbol
        )

    return table


def display_live_trades(trades: List[Dict]) -> None:
    """Display recent live trades (stateless)."""
    console.print()
    trades_table = Table(title="🔴 LIVE TRADES (Last 10)", show_header=True)
    trades_table.add_column("Time", style="cyan", no_wrap=True)
    trades_table.add_column("Symbol", style="bold", no_wrap=True)
    trades_table.add_column("Side", style="white")
    trades_table.add_column("Price", justify="right", style="yellow")
    trades_table.add_column("Qty", justify="right", style="blue")
    trades_table.add_column("Amount", justify="right", style="green")
    trades_table.add_column("Alert Type", style="magenta")
    trades_table.add_column("Confidence", justify="right", style="cyan")

    if not trades:
        console.print(trades_table)
        return

    recent = list(reversed(trades[-10:]))
    for trade in recent:
        ts = trade.get('timestamp')
        time_str = ts.strftime("%H:%M:%S") if ts else "—"
        side = trade.get('side', '')
        side_style = "green" if side == 'BUY' else "red"
        side_emoji = "🟢" if side == 'BUY' else "🔴"

        trades_table.add_row(
            time_str,
            trade.get('symbol', ''),
            f"[{side_style}]{side_emoji} {side}[/{side_style}]",
            f"₹{trade.get('price', 0):,.0f}",
            str(trade.get('quantity', '')),
            f"₹{trade.get('amount', 0):,.0f}",
            trade.get('alert_type', ''),
            f"{trade.get('confidence', 0):.0%}"
        )

    console.print(trades_table)


def display_closed_trades(closed_trades: List[Dict]) -> None:
    """Display closed trades table with P&L (stateless)."""
    if not closed_trades:
        return

    console.print()
    closed_table = Table(title="📈 CLOSED TRADES P&L", show_header=True)
    closed_table.add_column("Symbol", style="bold", no_wrap=True)
    closed_table.add_column("Side", style="white")
    closed_table.add_column("Entry ₹", justify="right", style="cyan")
    closed_table.add_column("Exit ₹", justify="right", style="white")
    closed_table.add_column("Qty", justify="right", style="blue")
    closed_table.add_column("P&L %", justify="right", style="bold")
    closed_table.add_column("P&L ₹", justify="right", style="bold")
    closed_table.add_column("Hold Time", justify="right", style="dim")
    closed_table.add_column("Reason", style="yellow")

    total_pnl_amount = 0
    profitable_trades = 0

    recent_trades = closed_trades[-10:] if len(closed_trades) > 10 else closed_trades

    for trade in recent_trades:
        pnl_pct = trade.get('pnl_pct', 0.0)
        pnl_amount = trade.get('pnl_amount', 0.0)
        total_pnl_amount += pnl_amount
        if pnl_pct > 0:
            profitable_trades += 1

        pnl_style = "green" if pnl_pct > 0 else "red"
        side = trade.get('side', '')
        side_style = "green" if side == 'BUY' else "red"
        side_emoji = "🟢" if side == 'BUY' else "🔴"

        # Hold time formatting
        hold_display = "—"
        entry_time = trade.get('entry_time')
        exit_time = trade.get('exit_time')
        if entry_time and exit_time:
            hold_time = exit_time - entry_time
            total_secs = hold_time.total_seconds()
            if total_secs < 3600:
                hold_display = f"{int(total_secs / 60)}m"
            elif total_secs < 86400:
                hold_display = f"{int(total_secs / 3600)}h"
            else:
                hold_display = f"{hold_time.days}d"

        closed_table.add_row(
            trade.get('symbol', ''),
            f"[{side_style}]{side_emoji} {side}[/{side_style}]",
            f"₹{trade.get('entry_price', 0):,.2f}",
            f"₹{trade.get('exit_price', 0):,.2f}",
            str(trade.get('quantity', '')),
            f"[{pnl_style}]{pnl_pct:+.2f}%[/{pnl_style}]",
            f"[{pnl_style}]₹{pnl_amount:+,.0f}[/{pnl_style}]",
            hold_display,
            str(trade.get('exit_reason', ''))[:15]
        )

    console.print(closed_table)

    total_trades = len(closed_trades)
    win_rate = (profitable_trades / total_trades * 100) if total_trades > 0 else 0
    total_pnl_style = "green" if total_pnl_amount > 0 else "red"

    console.print(f"[dim]Total Trades: {total_trades} | Win Rate: {win_rate:.1f}% | "
                  f"Total P&L: [{total_pnl_style}]₹{total_pnl_amount:+,.0f}[/{total_pnl_style}][/dim]")