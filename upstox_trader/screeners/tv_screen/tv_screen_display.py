from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import time as time_module

console = Console()


class DisplayMixin:

    def display_table(self, df, title, max_rows=15):
        if df.empty:
            console.print(f"[red]No results found for {title}[/red]")
            return

        table = Table(title=title, show_header=True, header_style="bold magenta")

        for col_name in df.columns:
            if col_name == 'ticker':
                table.add_column("Ticker", style="cyan", no_wrap=True)
            elif col_name == 'name':
                table.add_column("Name", style="green", max_width=12)
            elif col_name == 'close':
                table.add_column("Price", justify="right", style="yellow")
            elif col_name == 'volume':
                table.add_column("Volume", justify="right", style="blue")
            elif col_name == 'change':
                table.add_column("Change %", justify="right", style="magenta")
            elif col_name == 'RSI':
                table.add_column("RSI", justify="right", style="cyan")
            elif col_name == 'relative_volume_10d_calc':
                table.add_column("Vol Ratio", justify="right", style="blue")
            elif col_name == 'Volatility.D':
                table.add_column("Volatility %", justify="right", style="red")
            elif col_name == 'market_cap_basic':
                table.add_column("MCap (₹Cr)", justify="right", style="green")
            elif col_name == 'price_earnings_ttm':
                table.add_column("PE", justify="right", style="yellow")
            elif col_name == 'return_on_equity':
                table.add_column("ROE %", justify="right", style="green")
            elif col_name == 'dividends_yield_current':
                table.add_column("Div Yield", justify="right", style="blue")
            elif col_name == 'debt_to_equity':
                table.add_column("D/E", justify="right", style="red")
            elif col_name == 'update_mode':
                table.add_column("Data", style="dim")
            elif col_name == 'trend':
                table.add_column("Trend", style="bold", justify="center")

        for i, (_, row) in enumerate(df.head(max_rows).iterrows()):
            row_data = []
            for col_name in df.columns:
                if col_name == 'ticker':
                    row_data.append(row[col_name])
                elif col_name == 'name':
                    row_data.append(row[col_name][:12])
                elif col_name == 'close':
                    row_data.append(f"₹{row[col_name]:,.2f}")
                elif col_name == 'volume':
                    row_data.append(f"{row[col_name]:,.0f}")
                elif col_name == 'change':
                    change_val = row[col_name]
                    color = "green" if change_val > 0 else "red"
                    row_data.append(f"[{color}]{change_val:+.2f}%[/{color}]")
                elif col_name == 'RSI':
                    rsi_val = row[col_name]
                    if rsi_val > 70:
                        row_data.append(f"[red]{rsi_val:.1f}[/red]")
                    elif rsi_val < 30:
                        row_data.append(f"[green]{rsi_val:.1f}[/green]")
                    else:
                        row_data.append(f"{rsi_val:.1f}")
                elif col_name == 'relative_volume_10d_calc':
                    row_data.append(f"{row[col_name]:.2f}x")
                elif col_name == 'Volatility.D':
                    row_data.append(f"{row[col_name]*100:.1f}%")
                elif col_name == 'market_cap_basic':
                    row_data.append(f"₹{row[col_name]/1e7:,.0f}")
                elif col_name == 'price_earnings_ttm':
                    pe_val = row[col_name]
                    if pd.isna(pe_val):
                        row_data.append("N/A")
                    else:
                        row_data.append(f"{pe_val:.1f}")
                elif col_name == 'return_on_equity':
                    roe_val = row[col_name]
                    if pd.isna(roe_val):
                        row_data.append("N/A")
                    else:
                        row_data.append(f"{roe_val:.1f}%")
                elif col_name == 'dividends_yield_current':
                    div_val = row[col_name]
                    if pd.isna(div_val):
                        row_data.append("N/A")
                    else:
                        row_data.append(f"{div_val:.2f}%")
                elif col_name == 'debt_to_equity':
                    de_val = row[col_name]
                    if pd.isna(de_val):
                        row_data.append("N/A")
                    else:
                        row_data.append(f"{de_val:.2f}")
                elif col_name == 'update_mode':
                    row_data.append(row[col_name])
                elif col_name == 'trend':
                    trend_val = row[col_name]
                    if trend_val == 'strong_bullish':
                        row_data.append("[bold green]🚀 Strong Bull[/bold green]")
                    elif trend_val == 'bullish':
                        row_data.append("[green]📈 Bullish[/green]")
                    elif trend_val == 'neutral':
                        row_data.append("[yellow]➡️ Neutral[/yellow]")
                    elif trend_val == 'bearish':
                        row_data.append("[red]📉 Bearish[/red]")
                    elif trend_val == 'strong_bearish':
                        row_data.append("[bold red]💥 Strong Bear[/bold red]")
                    else:
                        row_data.append(f"[dim]{trend_val}[/dim]")
                else:
                    row_data.append(str(row[col_name]))

            table.add_row(*row_data)

        console.print(table)
        console.print(f"[dim]Showing {min(len(df), max_rows)} of {len(df)} results[/dim]")

    def _display_sector_table(self, sector_df, title):
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
            change_val = row['avg_change']
            change_color = "green" if change_val > 0 else "red"

            mcap_formatted = f"₹{row['total_mcap']/1e7:,.0f}"

            avg_roe = row['avg_roe'] if pd.notna(row['avg_roe']) else 0
            avg_pe = row['avg_pe'] if pd.notna(row['avg_pe']) else 0
            avg_vol_ratio = row['avg_vol_ratio'] if pd.notna(row['avg_vol_ratio']) else 0

            table.add_row(
                row['sector'][:20],
                f"[{change_color}]{change_val:+.2f}%[/{change_color}]",
                f"{int(row['stock_count'])}",
                mcap_formatted,
                f"{avg_roe:.1f}%" if avg_roe > 0 else "N/A",
                f"{avg_pe:.1f}" if avg_pe > 0 else "N/A",
                f"{avg_vol_ratio:.2f}x"
            )

        console.print(table)
        console.print(f"[dim]Showing {len(sector_df)} sectors[/dim]")

    def _display_watch_data(self, df, alerts=[]):
        alert_tickers = [alert['ticker'] for alert in alerts]

        table = Table(title="Live Market Monitor - Top Volume Movers", show_header=True)
        table.add_column("Ticker", style="cyan", no_wrap=True)
        table.add_column("Name", style="green", max_width=12)
        table.add_column("Price", justify="right", style="yellow")
        table.add_column("Change %", justify="right", style="magenta")
        table.add_column("Volume", justify="right", style="blue")
        table.add_column("Vol Ratio", justify="right", style="red")
        table.add_column("RSI", justify="right", style="cyan")
        table.add_column("Alert", style="bold red")

        for _, row in df.head(15).iterrows():
            ticker = row['name']
            is_alert = ticker in alert_tickers

            ticker_style = "[bold red]" if is_alert else ""
            alert_symbol = "🚨" if is_alert else ""

            change_val = row['change']
            change_color = "green" if change_val > 0 else "red"

            rsi_val = row['RSI']
            rsi_color = "red" if rsi_val > 70 else "green" if rsi_val < 30 else "white"

            vol_ratio = row['relative_volume_10d_calc']
            vol_color = "bold red" if vol_ratio > 3 else "red" if vol_ratio > 2 else "white"

            table.add_row(
                f"{ticker_style}{ticker}",
                row['name'][:12],
                f"₹{row['close']:,.2f}",
                f"[{change_color}]{change_val:+.2f}%[/{change_color}]",
                f"{row['volume']:,.0f}",
                f"[{vol_color}]{vol_ratio:.1f}x[/{vol_color}]",
                f"[{rsi_color}]{rsi_val:.1f}[/{rsi_color}]",
                alert_symbol
            )

        console.print(table)

        if self.paper_trading_enabled and self.live_trades:
            self._display_live_trades()

        if self.paper_trading_enabled:
            self._display_active_positions()
            self._display_closed_trades()

    def _display_live_trades(self):
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

        for trade in reversed(self.live_trades[-10:]):
            time_str = trade['timestamp'].strftime("%H:%M:%S")
            side_style = "green" if trade['side'] == 'BUY' else "red"
            side_emoji = "🟢" if trade['side'] == 'BUY' else "🔴"

            trades_table.add_row(
                time_str,
                trade['symbol'],
                f"[{side_style}]{side_emoji} {trade['side']}[/{side_style}]",
                f"₹{trade['price']:,.0f}",
                str(trade['quantity']),
                f"₹{trade['amount']:,.0f}",
                trade['alert_type'],
                f"{trade['confidence']:.0%}"
            )

        console.print(trades_table)

    def _display_active_positions(self):
        active_positions = {k: v for k, v in self.positions.items() if v}

        if not active_positions:
            return

        symbols = list(active_positions.keys())
        batch_prices = self._get_live_prices_batch(symbols)

        console.print()
        positions_table = Table(title="📊 ACTIVE POSITIONS", show_header=True)
        positions_table.add_column("Symbol", style="bold", no_wrap=True)
        positions_table.add_column("Side", style="white")
        positions_table.add_column("Entry", justify="right", style="cyan")
        positions_table.add_column("Current", justify="right", style="white")
        positions_table.add_column("Qty", justify="right", style="blue")
        positions_table.add_column("P&L %", justify="right", style="bold")
        positions_table.add_column("P&L ₹ (Net)", justify="right", style="bold")
        positions_table.add_column("TSL", justify="right", style="magenta")
        positions_table.add_column("Source", style="dim")

        for symbol, position in active_positions.items():
            current_price = (batch_prices.get(symbol) or
                           self._get_live_price_from_upstox(symbol) or
                           self.current_prices.get(symbol, position['entry_price']))

            entry_charges = position.get('entry_charges', 0.0)
            current_value = current_price * position['qty']
            estimated_exit_charges = self._calculate_trading_charges(current_value, 'intraday')

            gross_pnl = (current_price - position['entry_price']) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1

            pnl_amount = gross_pnl - entry_charges - estimated_exit_charges
            entry_value = position['entry_price'] * position['qty']
            pnl_pct = (pnl_amount / entry_value) * 100 if entry_value else 0.0

            pnl_style = "green" if pnl_pct > 0 else "red"
            side_style = "green" if position['side'] == 'BUY' else "red"
            side_emoji = "🟢" if position['side'] == 'BUY' else "🔴"

            live_price = symbol in batch_prices or hasattr(self, 'upstox_api') and self.upstox_api
            if live_price:
                price_indicator = "🔄" if symbol in self.exchange_fallbacks else "🟢"
                current_price_display = f"{price_indicator}₹{current_price:,.2f}"
            else:
                current_price_display = f"🔴₹{current_price:,.2f}"

            if position.get('trailing_stop_active', False):
                current_buffer = self._get_progressive_trailing_buffer(abs(pnl_pct))
                tsl_display = f"🎯{position.get('trailing_stop_pct', 0):+.1f}% ({current_buffer:.1f}%)"
                tsl_style = "bold green"
            else:
                tsl_display = "OFF"
                tsl_style = "dim"

            positions_table.add_row(
                symbol,
                f"[{side_style}]{side_emoji} {position['side']}[/{side_style}]",
                f"₹{position['entry_price']:,.2f}",
                current_price_display,
                str(position['qty']),
                f"[{pnl_style}]{pnl_pct:+.2f}%[/{pnl_style}]",
                f"[{pnl_style}]₹{pnl_amount:+,.0f}[/{pnl_style}]",
                f"[{tsl_style}]{tsl_display}[/{tsl_style}]",
                position.get('source', 'MANUAL')[:10]
            )

        console.print(positions_table)
        console.print("[dim]🟢 = Live price | 🔄 = Fallback exchange | 🎯 = Trailing Stop[/dim]")

    def _display_closed_trades(self):
        if not self.closed_trades:
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

        recent_trades = self.closed_trades[-10:] if len(self.closed_trades) > 10 else self.closed_trades

        for trade in recent_trades:
            pnl_style = "green" if trade['pnl_pct'] > 0 else "red"
            side_style = "green" if trade['entry_side'] == 'BUY' else "red"
            side_emoji = "🟢" if trade['entry_side'] == 'BUY' else "🔴"

            hold_time = trade['hold_time']
            if hold_time.total_seconds() < 3600:
                hold_display = f"{int(hold_time.total_seconds() / 60)}m"
            elif hold_time.total_seconds() < 86400:
                hold_display = f"{int(hold_time.total_seconds() / 3600)}h"
            else:
                hold_display = f"{hold_time.days}d"

            total_pnl_amount += trade['pnl_amount']
            if trade['pnl_pct'] > 0:
                profitable_trades += 1

            closed_table.add_row(
                trade['symbol'],
                f"[{side_style}]{side_emoji} {trade['entry_side']}[/{side_style}]",
                f"₹{trade['entry_price']:,.2f}",
                f"₹{trade['exit_price']:,.2f}",
                str(trade['quantity']),
                f"[{pnl_style}]{trade['pnl_pct']:+.2f}%[/{pnl_style}]",
                f"[{pnl_style}]₹{trade['pnl_amount']:+,.0f}[/{pnl_style}]",
                hold_display,
                trade['reason'][:15]
            )

        console.print(closed_table)

        total_trades = len(self.closed_trades)
        win_rate = (profitable_trades / total_trades * 100) if total_trades > 0 else 0
        total_pnl_style = "green" if total_pnl_amount > 0 else "red"

        console.print(f"[dim]Total Trades: {total_trades} | Win Rate: {win_rate:.1f}% | "
                     f"Total P&L: [{total_pnl_style}]₹{total_pnl_amount:+,.0f}[/{total_pnl_style}][/dim]")

    def _display_alerts(self, alerts):
        for alert in alerts:
            self.send_telegram_alert(alert)
            self._process_paper_trading_alert(alert)

            if alert['type'] == 'VOLUME_SPIKE':
                console.print(f"[bold red]🔥 VOLUME SPIKE:[/bold red] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Volume: {alert['current_volume_ratio']:.1f}x (was {alert['previous_volume_ratio']:.1f}x)")
                console.print(f"   Price: ₹{alert['price']:.2f} ({alert['change']:+.2f}%)")

            elif alert['type'] == 'PRICE_MOVE':
                direction = "🚀" if alert['current_change'] > 0 else "📉"
                console.print(f"[bold yellow]{direction} PRICE MOVE:[/bold yellow] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Change: {alert['current_change']:+.2f}% (was {alert['previous_change']:+.2f}%)")
                console.print(f"   Price: ₹{alert['price']:.2f} | Volume: {alert['volume_ratio']:.1f}x")

            if self.paper_trading_enabled:
                trade_action = self._get_trading_action(alert)
                console.print(f"   [cyan]💰 Trading Action: {trade_action}[/cyan]")

    def _display_performance_metrics(self):
        perf_summary = self._get_batch_performance_summary()
        if not perf_summary:
            return

        current_time = time_module.time()
        if hasattr(self, '_last_perf_display') and current_time - self._last_perf_display < 30:
            return

        self._last_perf_display = current_time

        console.print(f"[dim]📊 Performance: {perf_summary['avg_throughput']:.1f} sym/s | "
                     f"Success: {perf_summary['success_rate']:.0f}% | "
                     f"Batches: {perf_summary['total_batches']}[/dim]")
