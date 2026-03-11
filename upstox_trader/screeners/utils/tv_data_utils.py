"""
Data Processing and Validation Utilities for TradingView Screener
================================================================

This module contains utility functions for data validation,
symbol processing, and position management.
"""

from rich.console import Console

console = Console()


def get_base_symbol(ticker):
    """Get base symbol from ticker (remove exchange prefix if present)"""
    try:
        if ':' in ticker:
            return ticker.split(':')[-1]  # Get symbol after colon
        return ticker
    except Exception:
        return ticker


def has_existing_position(positions_dict, ticker):
    """Check if position exists for ticker"""
    try:
        if not positions_dict:
            return False
        
        base_symbol = get_base_symbol(ticker)
        
        # Check both with and without base symbol
        return ticker in positions_dict or base_symbol in positions_dict
    
    except Exception as e:
        console.print(f"[dim red]Error checking existing position for {ticker}: {e}[/dim red]")
        return False


def should_skip_alert(symbol, daily_entry_count, config):
    """Check if alert should be skipped based on various criteria"""
    try:
        # Check daily entry limits
        max_daily_entries = getattr(config.risk_management, 'max_daily_entries', 10)
        if daily_entry_count >= max_daily_entries:
            console.print(f"[dim yellow]⚠️ {symbol}: Daily entry limit reached ({daily_entry_count}/{max_daily_entries})[/dim yellow]")
            return True
        
        # Add more skip criteria as needed
        return False
    
    except Exception as e:
        console.print(f"[dim red]Error checking skip criteria for {symbol}: {e}[/dim red]")
        return False


def check_daily_entry_limit(daily_entry_count, config):
    """Check if daily entry limit has been reached"""
    try:
        max_daily_entries = getattr(config.risk_management, 'max_daily_entries', 10)
        return daily_entry_count >= max_daily_entries
    
    except Exception:
        return False  # Conservative fallback


def increment_daily_entry_count(daily_entry_count):
    """Increment daily entry count and return new value"""
    try:
        return daily_entry_count + 1
    except Exception:
        return 1  # Start fresh if error


def check_loss_cooldown(symbol, loss_cooldown_dict, cooldown_minutes=30):
    """Check if symbol is in loss cooldown period"""
    try:
        from datetime import datetime, timedelta
        
        if symbol not in loss_cooldown_dict:
            return False  # No cooldown
        
        cooldown_until = loss_cooldown_dict[symbol]
        current_time = datetime.now()
        
        if current_time >= cooldown_until:
            # Cooldown expired, remove from dict
            del loss_cooldown_dict[symbol]
            return False
        
        # Still in cooldown
        remaining = cooldown_until - current_time
        console.print(f"[dim yellow]⚠️ {symbol}: In loss cooldown for {remaining.seconds // 60}m {remaining.seconds % 60}s[/dim yellow]")
        return True
    
    except Exception as e:
        console.print(f"[dim red]Error checking cooldown for {symbol}: {e}[/dim red]")
        return False  # Don't block if error


def validate_symbol_format(symbol):
    """Validate symbol format and return cleaned symbol"""
    try:
        if not symbol or not isinstance(symbol, str):
            return None
        
        # Remove extra whitespace
        symbol = symbol.strip()
        
        # Basic validation - symbol should be alphanumeric with possible separators
        if len(symbol) < 1 or len(symbol) > 50:
            return None
        
        # Allow letters, numbers, dots, hyphens, underscores
        allowed_chars = set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_:')
        if not all(c.upper() in allowed_chars for c in symbol):
            return None
        
        return symbol.upper()
    
    except Exception:
        return None


def filter_valid_symbols(symbols_list):
    """Filter list of symbols to only include valid ones"""
    try:
        if not symbols_list:
            return []
        
        valid_symbols = []
        for symbol in symbols_list:
            validated = validate_symbol_format(symbol)
            if validated:
                valid_symbols.append(validated)
        
        return valid_symbols
    
    except Exception as e:
        console.print(f"[dim red]Error filtering symbols: {e}[/dim red]")
        return []