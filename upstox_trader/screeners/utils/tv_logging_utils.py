"""
Logging and Journal Utilities for TradingView Screener
=====================================================

This module contains utility functions for trade journaling,
logging, and record keeping.
"""

import os
from datetime import datetime
from rich.console import Console
from ..tv_display_utils import Colors

console = Console()


def log_colored(message, level="info"):
    """Enhanced colored logging for console output."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    log_message = f"[{timestamp}] {message}"
    
    if level == "error":
        print(f"{Colors.RED}{log_message}{Colors.RESET}")
    elif level == "success":
        print(f"{Colors.GREEN}{log_message}{Colors.RESET}")
    elif level == "warning":
        print(f"{Colors.YELLOW}{log_message}{Colors.RESET}")
    elif level == "trade":
        print(f"{Colors.CYAN}{log_message}{Colors.RESET}")
    elif level == "profit":
        print(f"{Colors.BG_GREEN}{Colors.BOLD}{log_message}{Colors.RESET}")
    elif level == "loss":
        print(f"{Colors.BG_RED}{Colors.BOLD}{log_message}{Colors.RESET}")
    elif level == "level":
        print(f"{Colors.MAGENTA}{log_message}{Colors.RESET}")
    else:
        print(f"{Colors.WHITE}{log_message}{Colors.RESET}")


def setup_trade_journal(mode="intraday"):
    """Setup trade journal file with date and mode"""
    try:
        # Create logs directory if it doesn't exist
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)
        
        # Create journal filename with date and mode
        date_str = datetime.now().strftime("%Y%m%d")
        journal_file = f"{logs_dir}/trade_journal_{mode}_{date_str}.csv"
        
        # Create header if file doesn't exist
        if not os.path.exists(journal_file):
            header = "timestamp,symbol,action,price,quantity,reason,pnl,mode\n"
            with open(journal_file, 'w') as f:
                f.write(header)
            console.print(f"[dim green]✅ Trade journal created: {journal_file}[/dim green]")
        
        return journal_file
    
    except Exception as e:
        console.print(f"[dim red]❌ Error setting up trade journal: {e}[/dim red]")
        return None


def log_trade(journal_file, symbol, action, price, quantity=1, reason="", pnl=0.0, mode="intraday"):
    """Log trade to journal file"""
    try:
        if not journal_file or not os.path.exists(journal_file):
            console.print("[dim yellow]⚠️ No journal file available for logging[/dim yellow]")
            return False
        
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Format the trade entry
        trade_entry = f"{timestamp},{symbol},{action},{price:.2f},{quantity},{reason},{pnl:.2f},{mode}\n"
        
        # Append to journal file
        with open(journal_file, 'a') as f:
            f.write(trade_entry)
        
        console.print(f"[dim]📝 Logged: {action} {symbol} @ ₹{price:.2f} - {reason}[/dim]")
        return True
    
    except Exception as e:
        console.print(f"[dim red]❌ Error logging trade: {e}[/dim red]")
        return False


def create_session_log(mode="intraday"):
    """Create a session log file for the current trading session"""
    try:
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = f"{logs_dir}/session_{mode}_{timestamp}.log"
        
        # Create initial log entry
        with open(log_file, 'w') as f:
            f.write(f"Trading Session Started: {datetime.now()}\n")
            f.write(f"Mode: {mode}\n")
            f.write("-" * 50 + "\n")
        
        return log_file
    
    except Exception as e:
        console.print(f"[dim red]❌ Error creating session log: {e}[/dim red]")
        return None


def log_session_event(log_file, event_type, message):
    """Log an event to the session log file"""
    try:
        if not log_file or not os.path.exists(log_file):
            return False
        
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] {event_type}: {message}\n"
        
        with open(log_file, 'a') as f:
            f.write(log_entry)
        
        return True
    
    except Exception as e:
        console.print(f"[dim red]❌ Error logging session event: {e}[/dim red]")
        return False


def create_performance_summary(journal_file):
    """Create a performance summary from the journal file"""
    try:
        if not journal_file or not os.path.exists(journal_file):
            return None
        
        import pandas as pd
        
        # Read the journal file
        df = pd.read_csv(journal_file)
        
        if df.empty:
            return "No trades in journal"
        
        # Calculate basic statistics
        total_trades = len(df[df['action'].isin(['BUY', 'SELL'])])
        total_pnl = df['pnl'].sum()
        winning_trades = len(df[df['pnl'] > 0])
        losing_trades = len(df[df['pnl'] < 0])
        
        win_rate = (winning_trades / max(total_trades / 2, 1)) * 100  # Divide by 2 for buy/sell pairs
        
        summary = f"""
Performance Summary
==================
Total Trades: {total_trades // 2}  # Buy/Sell pairs
Total P&L: ₹{total_pnl:.2f}
Winning Trades: {winning_trades}
Losing Trades: {losing_trades}
Win Rate: {win_rate:.1f}%
"""
        
        return summary
    
    except Exception as e:
        console.print(f"[dim red]❌ Error creating performance summary: {e}[/dim red]")
        return None


def create_daily_trades_summary(daily_trades):
    """Create a beautiful daily trades summary table"""
    if not daily_trades:
        return "No trades executed today."
    
    # Calculate summary statistics
    total_trades = len(daily_trades)
    winning_trades = [t for t in daily_trades if t['pnl_pct'] > 0]
    losing_trades = [t for t in daily_trades if t['pnl_pct'] < 0]
    
    win_rate = len(winning_trades) / total_trades * 100 if total_trades > 0 else 0
    total_pnl_amount = sum(t['pnl_amount'] for t in daily_trades)
    avg_trade_duration = sum(t['duration'].total_seconds() for t in daily_trades) / total_trades / 60  # in minutes
    
    # Create beautiful table
    today = datetime.now().strftime("%d%B%Y")
    summary = f"""
{'='*100}
📊 DAILY TRADES SUMMARY - {today}
{'='*100}

📈 PERFORMANCE METRICS:
   Total Trades: {total_trades}
   Winning Trades: {len(winning_trades)} ({win_rate:.1f}%)
   Losing Trades: {len(losing_trades)} ({100-win_rate:.1f}%)
   Total P&L: ₹{total_pnl_amount:,.2f}
   Average Duration: {avg_trade_duration:.1f} minutes

{'='*100}
🎯 INDIVIDUAL TRADES:
{'='*100}
{'ID':<3} {'Symbol':<12} {'Side':<4} {'Entry':<10} {'Exit':<10} {'Qty':<5} {'P&L%':<8} {'P&L₹':<10} {'Duration':<10} {'Reason':<25}
{'-'*100}
"""
    
    for trade in daily_trades:
        duration_str = f"{int(trade['duration'].total_seconds()/60)}m{int(trade['duration'].total_seconds()%60)}s"
        pnl_color = "🟢" if trade['pnl_pct'] > 0 else "🔴"
        
        summary += f"{trade['id']:<3} {trade['symbol']:<12} {trade['side']:<4} "
        summary += f"₹{trade['entry_price']:<9.2f} ₹{trade['exit_price']:<9.2f} "
        summary += f"{trade['qty']:<5} {pnl_color}{trade['pnl_pct']:>+6.2f}% "
        summary += f"₹{trade['pnl_amount']:>+8.2f} {duration_str:<10} "
        summary += f"{trade['reason']:<25}\n"
    
    summary += f"\n{'-'*100}\n"
    summary += f"💰 NET P&L: ₹{total_pnl_amount:+,.2f} | Win Rate: {win_rate:.1f}%\n"
    summary += f"{'='*100}\n"
    
    return summary


def save_daily_summary(daily_trades, filename_prefix=""):
    """Save daily summary to a dated file"""
    try:
        today = datetime.now().strftime("%d%B%Y")
        filename = f"{filename_prefix}{today}_trades.log" if filename_prefix else f"{today}_trades.log"
        summary = create_daily_trades_summary(daily_trades)
        
        with open(filename, 'w') as f:
            f.write(summary)
        
        print(f"\n📄 Daily summary saved to: {filename}")
        print(summary)
        
    except Exception as e:
        print(f"Error saving daily summary: {e}")