from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich import box
import pandas as pd
from typing import Dict, Optional

console = Console()

class TradingDisplay:
    """Class for handling all display-related functionality"""
    
    def display_backtest_results(self, trades_df: pd.DataFrame, symbol: str):
        """Display backtest results in a formatted table"""
        if trades_df is None or len(trades_df) == 0:
            console.print("[yellow]No trades to display[/yellow]")
            return
        
        # Create a summary table
        summary = Table(title=f"Backtest Summary for {symbol}", show_header=True, header_style="bold blue")
        summary.add_column("Metric", style="cyan")
        summary.add_column("Value", style="green")
        
        total_trades = len(trades_df)
        profitable_trades = len(trades_df[trades_df['pnl'] > 0])
        win_rate = (profitable_trades / total_trades) * 100 if total_trades > 0 else 0
        total_profit = trades_df['pnl'].sum() if 'pnl' in trades_df else 0
        max_profit = trades_df['pnl'].max() if 'pnl' in trades_df else 0
        max_loss = trades_df['pnl'].min() if 'pnl' in trades_df else 0
        
        # Calculate additional metrics
        avg_profit_per_trade = total_profit / total_trades if total_trades > 0 else 0
        avg_win = trades_df[trades_df['pnl'] > 0]['pnl'].mean() if profitable_trades > 0 else 0
        avg_loss = trades_df[trades_df['pnl'] < 0]['pnl'].mean() if (total_trades - profitable_trades) > 0 else 0
        profit_factor = abs(trades_df[trades_df['pnl'] > 0]['pnl'].sum() / trades_df[trades_df['pnl'] < 0]['pnl'].sum()) if trades_df[trades_df['pnl'] < 0]['pnl'].sum() != 0 else float('inf')
        
        summary.add_row("Initial Balance", f"${10000:.2f}")
        summary.add_row("Final Balance", f"${trades_df['balance'].iloc[-1]:.2f}")
        summary.add_row("Total Return", f"{((trades_df['balance'].iloc[-1] - 10000) / 10000 * 100):.2f}%")
        summary.add_row("Total Trades", str(total_trades))
        summary.add_row("Profitable Trades", str(profitable_trades))
        summary.add_row("Win Rate", f"{win_rate:.2f}%")
        summary.add_row("Total Profit/Loss", f"${total_profit:.2f}")
        summary.add_row("Average Profit/Trade", f"${avg_profit_per_trade:.2f}")
        summary.add_row("Average Win", f"${avg_win:.2f}")
        summary.add_row("Average Loss", f"${avg_loss:.2f}")
        summary.add_row("Max Profit", f"${max_profit:.2f}")
        summary.add_row("Max Loss", f"${max_loss:.2f}")
        summary.add_row("Profit Factor", f"{profit_factor:.2f}")
        
        console.print(summary)
        console.print()
        
        # Create trade history table
        table = Table(title="Trade History", show_header=True, header_style="bold magenta")
        table.add_column("Time", style="cyan")
        table.add_column("Action", style="green")
        table.add_column("Price", style="yellow")
        table.add_column("Size", style="blue")
        table.add_column("P&L", style="red")
        table.add_column("Balance", style="green")
        table.add_column("Return %", style="yellow")
        table.add_column("Exit Reason", style="cyan")
        
        # Show last 20 trades if there are more than 20
        display_trades = trades_df.tail(20) if len(trades_df) > 20 else trades_df
        
        for _, trade in display_trades.iterrows():
            action_color = "green" if trade['action'] == 'BUY' else "red"
            
            table.add_row(
                trade['timestamp'].strftime('%Y-%m-%d %H:%M'),
                f"[{action_color}]{trade['action']}[/{action_color}]",
                f"${float(trade['price']):.2f}",
                f"{float(trade['size']):.4f}",
                f"${float(trade['pnl']):.2f}" if 'pnl' in trade and not pd.isna(trade['pnl']) else "-",
                f"${float(trade['balance']):.2f}",
                f"{float(trade['return']):.2f}%" if 'return' in trade and not pd.isna(trade['return']) else "-",
                str(trade.get('reason', '')) if trade.get('reason') else "-"
            )
        
        if len(trades_df) > 20:
            console.print("[yellow]Showing last 20 trades...[/yellow]")
        console.print(table)
    
    def display_live_status(self, data: Dict) -> Optional[Panel]:
        """Display live trading status"""
        if not data:
            return None
            
        table = Table(show_header=True, header_style="bold magenta", box=box.ROUNDED)
        table.add_column("Symbol", style="cyan")
        table.add_column("Price", style="yellow")
        table.add_column("Change", style="green")
        table.add_column("Position", style="blue")
        table.add_column("P&L", style="red")
        table.add_column("Signal", style="magenta")
        table.add_column("Indicators", style="cyan")
        
        for symbol, info in data.items():
            price = info['price']
            prev_price = info.get('prev_price', price)
            price_change = ((price - prev_price) / prev_price) * 100
            
            position = "LONG" if info['position'] else "NONE"
            pnl = f"${info['pnl']:.2f}" if info['position'] else "-"
            
            indicators = info.get('indicators', {})
            indicator_str = ", ".join([
                f"{k}: {v:.2f}" if isinstance(v, float) else f"{k}: {v}"
                for k, v in indicators.items()
            ])
            
            table.add_row(
                symbol,
                f"${price:.2f}",
                f"{price_change:+.2f}%" if price_change else "0.00%",
                position,
                pnl,
                info.get('signal', 'NONE'),
                indicator_str
            )
            
        return Panel(table, title="Live Trading Status", border_style="green") 