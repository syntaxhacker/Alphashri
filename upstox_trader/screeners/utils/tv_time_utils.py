"""
Time and Market Hours Utilities for TradingView Screener
======================================================

This module contains utility functions for handling market timing,
trading hours validation, and market open/close detection.
"""

import os
import time
from datetime import datetime
from rich.console import Console

console = Console()


def is_trading_hours(trading_start_time="09:15", trading_end_time="15:30", paper_trading_enabled=True):
    """Check if current time is within trading hours"""
    if not paper_trading_enabled:
        return True  # Always allow if paper trading is disabled
        
    try:
        now = datetime.now().time()
        
        # Parse trading hours
        start_time = datetime.strptime(trading_start_time, "%H:%M").time()
        end_time = datetime.strptime(trading_end_time, "%H:%M").time()
        
        # Check if current time is within trading hours
        return start_time <= now <= end_time
    except Exception as e:
        console.print(f"[red]Error checking trading hours: {e}[/red]")
        return True  # Default to allowing trading if check fails


def is_market_closed(trading_end_time="15:30"):
    """Check if market has closed (after specified end time)"""
    try:
        now = datetime.now().time()
        market_close = datetime.strptime(trading_end_time, "%H:%M").time()
        return now > market_close
    except Exception as e:
        return False  # If error, assume market is open


def wait_until_market_open(paper_trading_enabled=True, market='in'):
    """Wait until market open time before starting active monitoring"""
    # If paper trading is disabled, start monitoring immediately (just watching data)
    if not paper_trading_enabled:
        console.print("[green]✅ Paper trading disabled - starting monitoring immediately (watch mode)[/green]")
        return
        
    # Skip waiting for US market - always start immediately since US market hours are different
    if market == 'us':
        console.print("[green]✅ US Market - starting monitoring immediately (no wait)[/green]")
        return
        
    # For Indian market with paper trading enabled, wait until 9:20 AM IST
    target_time = datetime.now().replace(hour=9, minute=16, second=0, microsecond=0)
    current_time = datetime.now()
    
    # If we're past 9:20 AM today, start immediately
    if current_time >= target_time:
        console.print("[green]✅ Indian market open time reached - starting active monitoring[/green]")
        return
    
    # Calculate wait time
    wait_seconds = (target_time - current_time).total_seconds()
    wait_minutes = int(wait_seconds // 60)
    wait_secs = int(wait_seconds % 60)
    
    console.print(f"[yellow]⏰ Paper trading enabled - waiting until 9:20 AM IST to start trading...[/yellow]")
    console.print(f"[blue]Current time: {current_time.strftime('%H:%M:%S')} IST[/blue]")
    console.print(f"[blue]Target time: 9:20:00 IST[/blue]")
    console.print(f"[yellow]Time remaining: {wait_minutes}m {wait_secs}s[/yellow]")
    console.print()
    
    # Wait with periodic updates
    while datetime.now() < target_time:
        remaining = (target_time - datetime.now()).total_seconds()
        if remaining <= 0:
            break
            
        mins = int(remaining // 60)
        secs = int(remaining % 60)
        
        # Update every 30 seconds
        if int(remaining) % 30 == 0:
            # Clear screen and show countdown
            os.system('clear' if os.name == 'posix' else 'cls')
            console.print("[bold yellow]⏰ WAITING FOR TRADING HOURS (Paper Trading)[/bold yellow]")
            console.print(f"[dim]Current time: {datetime.now().strftime('%H:%M:%S')}[/dim]")
            console.print(f"[blue]🕘 {mins}m {secs}s until active monitoring starts (9:20 AM IST)[/blue]")
            console.print("[dim]Press Ctrl+C to stop[/dim]")
        
        time.sleep(1)
    
    # Clear screen and show start message
    os.system('clear' if os.name == 'posix' else 'cls')
    console.print("[green]🚀 9:20 AM IST reached - starting paper trading mode![/green]")
    time.sleep(2)