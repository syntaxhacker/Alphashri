#!/usr/bin/env python3
"""
TV Alerts Display - Dashboard and status rendering
"""

from datetime import datetime
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

console = Console()


def display_status(self):
    """Display current status of positions and server with rich tables"""
    console.print(f"\n[bold blue]📡 TV Alerts Only - Live Trading Dashboard[/bold blue]")

    server_alive = self.server_thread.is_alive() if hasattr(self, 'server_thread') else False
    status_text = f"""
🌐 Server: {'🟢 RUNNING' if server_alive else '🔴 STOPPED'}
📡 Port: {self.port}
🔗 Health: http://localhost:{self.port}/health
💰 Trading: {'🟢 ENABLED' if self.enable_trading else '🔴 DISABLED'}
📈 Upstox: {'🟢 CONNECTED' if self.upstox_api else '🔴 DISCONNECTED'}
📡 Streaming: {'🟢 ACTIVE' if self.realtime_streaming_enabled else '🔴 INACTIVE'}
📱 Telegram: {'🟢 ENABLED' if self.telegram_enabled else '🔴 DISABLED'}
📊 Total Trades: {self.trade_count}
⏰ Uptime: {datetime.now() - self._start_time}
    """
    console.print(Panel(status_text.strip(), title="🖥️ System Status", border_style="blue"))

    if self.upstox_api and not self.realtime_streaming_enabled:
        console.print(f"\n[dim yellow]💡 Streaming Tips:[/dim yellow]")
        console.print(f"[dim]• Check your UPSTOX_CONFIG credentials[/dim]")
        console.print(f"[dim]• Ensure stable internet connection[/dim]")
        console.print(f"[dim]• Verify API permissions and limits[/dim]")
        console.print(f"[dim]• Try restarting if issue persists[/dim]")

    active_positions = {k: v for k, v in self.positions.items() if v}
    if active_positions:
        positions_table = Table(title=f"📊 Active Positions ({len(active_positions)})", show_header=True, header_style="bold magenta")
        positions_table.add_column("Symbol", style="cyan", no_wrap=True, width=12)
        positions_table.add_column("Side", style="bold", justify="center", width=6)
        positions_table.add_column("Entry Price", justify="right", style="yellow", width=12)
        positions_table.add_column("Current Price", justify="right", style="green", width=12)
        positions_table.add_column("Quantity", justify="right", style="blue", width=8)
        positions_table.add_column("P&L %", justify="right", width=8)
        positions_table.add_column("P&L Amount", justify="right", width=12)
        positions_table.add_column("Value", justify="right", style="white", width=12)
        positions_table.add_column("Time", justify="center", style="dim", width=8)

        for symbol, position in active_positions.items():
            current_price = self.current_prices.get(symbol, position['entry_price'])
            entry_price = position['entry_price']
            quantity = position['qty']
            side = position['side']

            if side == 'BUY':
                pnl_pct = (current_price - entry_price) / entry_price * 100
                pnl_amount = (current_price - entry_price) * quantity
            else:
                pnl_pct = (entry_price - current_price) / entry_price * 100
                pnl_amount = (entry_price - current_price) * quantity

            side_emoji = "🟢" if side == 'BUY' else "🔴"
            side_display = f"{side_emoji} {side}"

            pnl_color = "green" if pnl_pct >= 0 else "red"
            pnl_display = f"[{pnl_color}]{pnl_pct:+.2f}%[/{pnl_color}]"
            pnl_amount_display = f"[{pnl_color}]₹{pnl_amount:+,.0f}[/{pnl_color}]"

            entry_time = position['entry_time'].strftime('%H:%M:%S')

            current_color = "green" if current_price >= entry_price else "red"
            current_display = f"[{current_color}]₹{current_price:.2f}[/{current_color}]"

            position_value = current_price * quantity
            value_display = f"₹{position_value:,.0f}"

            positions_table.add_row(
                symbol,
                side_display,
                f"₹{entry_price:.2f}",
                current_display,
                f"{quantity:,}",
                pnl_display,
                pnl_amount_display,
                value_display,
                entry_time
            )

        console.print(positions_table)

        total_invested = sum(pos['entry_price'] * pos['qty'] for pos in active_positions.values())
        total_current = sum(self.current_prices.get(sym, pos['entry_price']) * pos['qty']
                          for sym, pos in active_positions.items())
        total_pnl = total_current - total_invested
        total_pnl_pct = (total_pnl / total_invested * 100) if total_invested > 0 else 0

        summary_color = "green" if total_pnl >= 0 else "red"
        summary_text = f"""
💰 Total Invested: ₹{total_invested:,.0f}
📈 Current Value: ₹{total_current:,.0f}
📊 Total P&L: [{summary_color}]₹{total_pnl:+,.0f} ({total_pnl_pct:+.2f}%)[/{summary_color}]
        """
        console.print(Panel(summary_text.strip(), title="📈 Portfolio Summary", border_style=summary_color))
    else:
        console.print(Panel("📊 No active positions\n\n[dim]Waiting for TradingView alerts...[/dim]",
                          title="📊 Active Positions", border_style="yellow"))

    if self.closed_trades:
        recent_trades = self.closed_trades[-10:]

        trades_table = Table(title=f"📈 Recent Trades ({len(recent_trades)})", show_header=True, header_style="bold yellow")
        trades_table.add_column("Symbol", style="cyan", no_wrap=True, width=10)
        trades_table.add_column("Side", style="bold", justify="center", width=6)
        trades_table.add_column("Entry", justify="right", style="yellow", width=10)
        trades_table.add_column("Exit", justify="right", style="green", width=10)
        trades_table.add_column("P&L %", justify="right", width=8)
        trades_table.add_column("P&L Amount", justify="right", width=10)
        trades_table.add_column("Reason", style="dim", width=15)
        trades_table.add_column("Hold Time", justify="center", width=10)

        for trade in recent_trades:
            pnl_emoji = "🟢" if trade['pnl_pct'] > 0 else "🔴"
            side_emoji = "🟢" if trade['entry_side'] == 'BUY' else "🔴"

            pnl_color = "green" if trade['pnl_pct'] > 0 else "red"
            pnl_display = f"[{pnl_color}]{trade['pnl_pct']:+.2f}%[/{pnl_color}]"
            pnl_amount_display = f"[{pnl_color}]₹{trade['pnl_amount']:+,.0f}[/{pnl_color}]"

            hold_time = trade['hold_time']
            if hold_time.total_seconds() < 3600:
                hold_display = f"{hold_time.total_seconds()/60:.0f}m"
            else:
                hold_display = f"{hold_time.total_seconds()/3600:.1f}h"

            trades_table.add_row(
                trade['symbol'],
                f"{side_emoji} {trade['entry_side']}",
                f"₹{trade['entry_price']:.2f}",
                f"₹{trade['exit_price']:.2f}",
                pnl_display,
                pnl_amount_display,
                trade['reason'],
                hold_display
            )

        console.print(trades_table)

    market_status = "🟢 MARKET OPEN" if self._is_market_open() else "🔴 MARKET CLOSED"
    console.print(f"\n[dim]Market Status: {market_status} | Last Updated: {datetime.now().strftime('%H:%M:%S')}[/dim]")
