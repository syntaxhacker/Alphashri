from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich import box
from typing import Dict, List, Any
from datetime import datetime
import pandas as pd

console = Console()

class TradingDisplay:
    """Class to handle all trading-related display components"""
    
    def __init__(self):
        self.console = Console()
        
    def display_backtest_results(self, trades_df: pd.DataFrame):
        """Display backtest results in a rich table format"""
        try:
            # Summary table
            summary_table = Table(title="Backtest Results", box=box.ROUNDED)
            summary_table.add_column("Metric", style="cyan")
            summary_table.add_column("Value", justify="right")
            
            if not trades_df.empty:
                initial_balance = float(trades_df['balance'].iloc[0])
                final_balance = float(trades_df['balance'].iloc[-1])
                total_return = ((final_balance - initial_balance) / initial_balance) * 100
                total_trades = len(trades_df[trades_df['action'] == 'SELL'])
                profitable_trades = len(trades_df[
                    (trades_df['action'] == 'SELL') & 
                    (trades_df['pnl'] > 0)
                ])
                win_rate = (profitable_trades / total_trades * 100) if total_trades > 0 else 0
                
                summary_table.add_row("Initial Balance", f"${initial_balance:,.2f}")
                summary_table.add_row("Final Balance", f"${final_balance:,.2f}")
                summary_table.add_row("Total Return", f"{total_return:.2f}%")
                summary_table.add_row("Total Trades", str(total_trades))
                summary_table.add_row("Profitable Trades", str(profitable_trades))
                summary_table.add_row("Win Rate", f"{win_rate:.1f}%")
                
                # Trade history table
                trade_table = Table(title="\nDetailed Trade History", box=box.ROUNDED)
                trade_table.add_column("Time", style="cyan")
                trade_table.add_column("Action", style="green")
                trade_table.add_column("Price", justify="right")
                trade_table.add_column("Size", justify="right")
                trade_table.add_column("P&L", justify="right")
                trade_table.add_column("Balance", justify="right")
                trade_table.add_column("Return", justify="right")
                trade_table.add_column("Exit Reason", style="yellow")
                
                # Add trades to table
                for _, trade in trades_df[trades_df['action'].isin(['BUY', 'SELL'])].iterrows():
                    time = trade['timestamp'].strftime('%Y-%m-%d %H:%M')
                    action_color = "green" if trade['action'] == 'BUY' else "red"
                    price = float(trade['price'])
                    size = float(trade['size'])
                    balance = float(trade['balance'])
                    
                    pnl_str = f"${float(trade['pnl']):,.2f}" if 'pnl' in trade else ""
                    return_str = f"{float(trade['return']):.2f}%" if 'return' in trade else ""
                    reason = str(trade.get('reason', ''))
                    
                    trade_table.add_row(
                        str(time),
                        f"[{action_color}]{trade['action']}[/{action_color}]",
                        f"${price:,.2f}",
                        f"{size:.4f}",
                        pnl_str,
                        f"${balance:,.2f}",
                        return_str,
                        reason
                    )
                
                self.console.print(summary_table)
                self.console.print(trade_table)
                
            else:
                summary_table.add_row("No trades executed", "")
                self.console.print(summary_table)
                
        except Exception as e:
            self.console.print(f"[red]Error displaying backtest results: {str(e)}[/red]")
            self.console.print("[red]Debug info:[/red]")
            if not trades_df.empty:
                self.console.print(f"DataFrame columns: {trades_df.columns}")
                self.console.print(f"DataFrame types: {trades_df.dtypes}")
            
    def display_live_status(self, data: Dict[str, Any]):
        """Display live trading status"""
        try:
            # Create main table
            table = Table(
                title=f"Live Trading Status ({datetime.now().strftime('%H:%M:%S')})",
                title_style="bold cyan",
                show_header=True,
                header_style="bold magenta",
                box=box.ROUNDED
            )
            
            # Add columns
            table.add_column("Symbol", style="cyan")
            table.add_column("Price", justify="right")
            table.add_column("Position", justify="center")
            table.add_column("P&L", justify="right")
            table.add_column("Signals", justify="center")
            table.add_column("Indicators", justify="right")
            
            # Add rows
            for symbol, info in data.items():
                price_color = "white"
                if 'prev_price' in info and info['price'] != info['prev_price']:
                    price_color = "green" if info['price'] > info['prev_price'] else "red"
                
                position_text = "LONG" if info.get('position', False) else "FLAT"
                position_color = "green" if position_text == "LONG" else "white"
                
                pnl = info.get('pnl', 0)
                pnl_color = "green" if pnl > 0 else "red" if pnl < 0 else "white"
                
                table.add_row(
                    symbol,
                    f"[{price_color}]${info['price']:,.2f}[/{price_color}]",
                    f"[{position_color}]{position_text}[/{position_color}]",
                    f"[{pnl_color}]${pnl:,.2f}[/{pnl_color}]",
                    info.get('signal', 'HOLD'),
                    self._format_indicators(info.get('indicators', {}))
                )
            
            return table
            
        except Exception as e:
            self.console.print(f"[red]Error displaying live status: {str(e)}[/red]")
            return None
            
    def _format_indicators(self, indicators: Dict[str, float]) -> str:
        """Format technical indicators for display"""
        formatted = []
        for name, value in indicators.items():
            if name == 'rsi':
                color = "green" if value < 30 else "red" if value > 70 else "white"
                formatted.append(f"RSI: [{color}]{value:.1f}[/{color}]")
            elif name in ['ema_fast', 'ema_slow']:
                formatted.append(f"{name.upper()}: {value:.1f}")
            elif name == 'regime':
                color = "green" if value == 'UPTREND' else "red" if value == 'DOWNTREND' else "yellow"
                formatted.append(f"[{color}]{value}[/{color}]")
        return " | ".join(formatted)
        
    def display_optimization_progress(self, current: int, total: int, best_params: Dict[str, float] = None):
        """Display strategy optimization progress"""
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=self.console
        ) as progress:
            task = progress.add_task(
                f"Optimizing strategy... {current}/{total}",
                total=total
            )
            progress.update(task, completed=current)
            
            if best_params:
                self.console.print("\nCurrent best parameters:")
                for param, value in best_params.items():
                    self.console.print(f"{param}: {value}")
                    
    def display_cache_info(self, info: Dict[str, Any]):
        """Display cache information"""
        table = Table(
            title="Cache Information",
            title_style="bold cyan",
            show_header=True,
            header_style="bold magenta",
            box=box.ROUNDED
        )
        
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right")
        
        # Add general info
        table.add_row(
            "Total Size",
            f"{info['total_size'] / 1024 / 1024:.2f} MB"
        )
        table.add_row(
            "Last Updated",
            info.get('last_updated', 'Never')
        )
        table.add_row(
            "Cached Symbols",
            str(len(info.get('symbols', {})))
        )
        
        self.console.print("\n")
        self.console.print(table)
        
        # Display symbol details if any exist
        if info.get('symbols'):
            symbols_table = Table(
                title="Cached Symbols",
                show_header=True,
                header_style="bold magenta",
                box=box.ROUNDED
            )
            
            symbols_table.add_column("Symbol", style="cyan")
            symbols_table.add_column("Interval")
            symbols_table.add_column("Last Updated")
            symbols_table.add_column("Rows", justify="right")
            
            for symbol, details in info['symbols'].items():
                symbols_table.add_row(
                    symbol,
                    details['interval'],
                    details['last_updated'],
                    str(details['rows'])
                )
            
            self.console.print("\n")
            self.console.print(symbols_table) 