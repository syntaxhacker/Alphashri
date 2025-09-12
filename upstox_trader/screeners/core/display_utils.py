#!/usr/bin/env python3
"""
Display Utilities Functions
Extracted from TVScreenerUsage class
"""

from rich.console import Console
from rich.table import Table

console = Console()

class DisplayUtils:
    """Display utilities and UI components"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
    
    def display_table(self, df, title, max_rows=15):
        """Display table with formatted data"""
        # Use shared helper to display tables to avoid duplication
        from upstox_trader.screeners import tv_helpers
        helpers_display_table = tv_helpers.display_table
        return helpers_display_table(df, title, max_rows, self.parent.currency_symbol)

    def _display_watch_data(self, df, alerts=[]):
        """Display current watch data"""
        mode = getattr(self.parent, 'watch_mode', 'PREBREAKOUT')
        # Prefer instance-bound tv_display for reliability
        _tv_display = getattr(self.parent, 'tv_display', None) or self.parent.tv_display
        if _tv_display:
            table = _tv_display.render_watch_table(df, alerts or [], mode, self.parent.currency_symbol)
            console.print(table)
        else:
            # Keep a single concise message; upstream header already shows context
            console.print("[red]tv_display module unavailable[/red]")
            return

        # Preserve class-only extra sections
        if self.parent.paper_trading_enabled and self.parent.live_trades:
            if self.parent.tv_display:
                self.parent.tv_display.display_live_trades(self.parent.live_trades)
            else:
                # No fallback implementation needed as it's delegated to tv_display
                pass

        if self.parent.paper_trading_enabled:
            self._display_active_positions()

        if self.parent.paper_trading_enabled and self.parent.closed_trades:
            if self.parent.tv_display:
                self.parent.tv_display.display_closed_trades(self.parent.closed_trades)
            else:
                # No fallback implementation needed as it's delegated to tv_display
                pass

    def _display_alerts(self, alerts):
        """Display alerts in a formatted way and send to both Telegram and Paper Trading Bot - delegate to tv_display_utils module"""
        if self.parent.tv_display:
            return self.parent.tv_display._display_alerts(alerts)
    
    def _display_active_positions(self):
        """Display active positions with live P&L from Upstox - delegate to tv_display_utils module"""
        if self.parent.tv_display:
            return self.parent.tv_display._display_active_positions(self.parent.positions, 
                                                                    self.parent.current_prices, 
                                                                    self.parent.exchange_fallbacks,
                                                                    self.parent._fetch_live_prices_parallel,
                                                                    self.parent._calculate_trading_charges,
                                                                    self.parent._get_progressive_trailing_buffer)
    
    def _display_live_trades(self):
        """Display live trades"""
        # Deprecated: moved to tv_display.display_live_trades
        if self.parent.tv_display:
            return self.parent.tv_display.display_live_trades(self.parent.live_trades)
        # No fallback implementation needed as it's delegated to tv_display

    def _display_closed_trades(self):
        """Display closed trades"""
        # Deprecated: moved to tv_display.display_closed_trades
        if self.parent.tv_display:
            return self.parent.tv_display.display_closed_trades(self.parent.closed_trades)
        # If empty, original would silently return; keep behavior
        # No fallback implementation needed as it's delegated to tv_display
