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
                self._display_live_trades()

        if self.parent.paper_trading_enabled:
            self._display_active_positions()

        if self.parent.paper_trading_enabled and self.parent.closed_trades:
            if self.parent.tv_display:
                self.parent.tv_display.display_closed_trades(self.parent.closed_trades)
            else:
                self._display_closed_trades()

    def _display_alerts(self, alerts):
        """Display alerts in a formatted way and send to both Telegram and Paper Trading Bot"""
        for alert in alerts:
            # Process alert for paper trading (telegram alerts sent only on actual trades)
            self.parent._process_paper_trading_alert(alert)
            
            # Display alert
            if alert['type'] == 'VOLUME_SPIKE':
                console.print(f"[bold red]🔥 VOLUME SPIKE:[/bold red] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Volume: {alert['current_volume_ratio']:.1f}x (was {alert['previous_volume_ratio']:.1f}x)")
                console.print(f"   Price: {self.parent.format_price(alert['price'])} ({alert['change']:+.2f}%)")
                
            elif alert['type'] == 'PRICE_MOVE':
                direction = "🚀" if alert['current_change'] > 0 else "📉"
                console.print(f"[bold yellow]{direction} PRICE_MOVE:[/bold yellow] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Change: {alert['current_change']:+.2f}% (was {alert['previous_change']:+.2f}%)")
                console.print(f"   Price: {self.parent.format_price(alert['price'])} | Volume: {alert['volume_ratio']:.1f}x")
            
            elif alert['type'] == 'HEAVY_BREAKOUT':
                # Enhanced heavy breakout alert with trading levels
                direction_emoji = "🚀" if alert.get('trade_direction') == 'LONG' else "📉" if alert.get('trade_direction') == 'SHORT' else "⚡"
                console.print(f"[bold red]{direction_emoji} HEAVY BREAKOUT:[/bold red] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Pattern: {alert.get('pattern', 'Channel Breakout')} (Score: {alert.get('breakout_score', 0):.0f})")
                console.print(f"   Price: {self.parent.format_price(alert['price'])} ({alert['change']:+.2f}%) | Volume: {alert['volume_ratio']:.1f}x")
                
                # Show support/resistance levels
                support = alert.get('support_level')
                resistance = alert.get('resistance_level')
                if support and resistance:
                    console.print(f"   📊 Support: {self.parent.format_price(support)} | Resistance: {self.parent.format_price(resistance)}")
                
                # Show trading setup
                trade_direction = alert.get('trade_direction', 'WATCH')
                if trade_direction == 'LONG':
                    entry = alert.get('entry_level')
                    stop = alert.get('stop_loss')
                    target = alert.get('target')
                    console.print(f"   🎯 LONG SETUP: Entry {self.parent.format_price(entry)} | Stop {self.parent.format_price(stop)} | Target {self.parent.format_price(target)}")
                elif trade_direction == 'SHORT':
                    entry = alert.get('entry_level')
                    stop = alert.get('stop_loss')
                    target = alert.get('target')
                    console.print(f"   🎯 SHORT SETUP: Entry {self.parent.format_price(entry)} | Stop {self.parent.format_price(stop)} | Target {self.parent.format_price(target)}")
                else:
                    console.print(f"   👀 WATCH: Channel setup - wait for breakout above/below levels")
                
                # Show breakout strength if available
                strength = alert.get('breakout_strength', 0)
                if strength > 0:
                    console.print(f"   💪 Breakout Strength: {strength:.1f}%")
            
            elif alert['type'] == 'FOMO_MOMENTUM':
                # FOMO Momentum alert display
                direction = alert.get('direction', 'UNKNOWN')
                direction_emoji = "🚀" if direction == 'LONG' else "📉"
                direction_color = "green" if direction == 'LONG' else "red"
                
                console.print(f"[bold {direction_color}]{direction_emoji} FOMO MOMENTUM:[/bold {direction_color}] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Direction: {direction} | Change: {alert['change']:+.2f}% | Price: {self.parent.format_price(alert['price'])}")
                console.print(f"   Volume: {alert['volume_ratio']:.1f}x | RSI: {alert['rsi']:.1f} | Volatility: {alert['volatility']:.1f}%")
                console.print(f"   🎯 Momentum Confidence: {alert['confidence']:.0%}")
            
            elif alert['type'] == 'REALTIME_MOMENTUM':
                # Real-time momentum alert display
                direction = alert.get('direction', 'UNKNOWN')
                consecutive_moves = alert.get('consecutive_moves', 0)
                momentum_strength = alert.get('momentum_strength', 0)
                direction_emoji = "⚡🚀" if direction == 'UP' else "⚡📉"
                direction_color = "green" if direction == 'UP' else "red"
                
                console.print(f"[bold {direction_color}]{direction_emoji} REALTIME MOMENTUM:[/bold {direction_color}] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Direction: {direction} | Consecutive: {consecutive_moves} moves | Change: {alert['change']:+.2f}%")
                console.print(f"   Price: {self.parent.format_price(alert['price'])} | Volume: {alert['volume_ratio']:.1f}x")
                console.print(f"   🔥 Momentum Strength: {momentum_strength:.2f}% | Confidence: {alert['confidence']:.0%}")
            
            # Show trading action taken
            if self.parent.paper_trading_enabled:
                trade_action = self.parent._get_trading_action(alert)
                console.print(f"   [cyan]💰 Trading Action: {trade_action}[/cyan]")

    def _display_active_positions(self):
        """Display active positions with live P&L from Upstox"""
        active_positions = {k: v for k, v in self.parent.positions.items() if v}
        
        if not active_positions:
            return
        
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
        
        # Fetch all live prices in parallel
        live_prices = self.parent._fetch_live_prices_parallel(list(active_positions.keys()))
        
        for symbol, position in active_positions.items():
            # Use parallel fetched price or fallback to cached price
            live_price = live_prices.get(symbol)
            current_price = live_price if live_price else self.parent.current_prices.get(symbol, position['entry_price'])
            
            # Calculate P&L including charges
            entry_price = position['entry_price']
            entry_charges = position.get('entry_charges', 0)
            
            # Estimate exit charges for current P&L calculation
            current_value = current_price * position['qty']
            estimated_exit_charges = self.parent._calculate_trading_charges(current_value, 'intraday')
            
            # Calculate gross and net P&L
            gross_pnl = (current_price - entry_price) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1
                
            pnl_amount = gross_pnl - entry_charges - estimated_exit_charges
            entry_value = entry_price * position['qty']
            pnl_pct = (pnl_amount / entry_value) * 100
            
            # Color coding
            pnl_style = "green" if pnl_pct > 0 else "red"
            side_style = "green" if position['side'] == 'BUY' else "red"
            side_emoji = "🟢" if position['side'] == 'BUY' else "🔴"
            
            # Add price source indicator with exchange info
            if live_price:
                # Check if we used fallback exchange
                if symbol in self.parent.exchange_fallbacks:
                    price_indicator = "🔄"  # Fallback exchange indicator
                else:
                    price_indicator = "🟢"  # Original exchange
                current_price_display = f"{price_indicator}₹{current_price:,.2f}"
            else:
                price_indicator = "🔴"
                current_price_display = f"{price_indicator}₹{current_price:,.2f}"
            
            # Trailing stop display with progressive buffer info
            if position.get('trailing_stop_active', False):
                current_buffer = self.parent._get_progressive_trailing_buffer(abs(pnl_pct))
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
        console.print("[dim]🟢 = Live price | 🔄 = Fallback exchange | 🔴 = Cached | 🎯 = Trailing Stop[/dim]")

    def _display_live_trades(self):
        """Display live trades"""
        # Deprecated: moved to tv_display.display_live_trades
        if self.parent.tv_display:
            return self.parent.tv_display.display_live_trades(self.parent.live_trades)
        console.print("[red]tv_display module unavailable[/red]")

    def _display_closed_trades(self):
        """Display closed trades"""
        # Deprecated: moved to tv_display.display_closed_trades
        if self.parent.tv_display:
            return self.parent.tv_display.display_closed_trades(self.parent.closed_trades)
        # If empty, original would silently return; keep behavior
        if not self.parent.closed_trades:
            return
        console.print("[red]tv_display module unavailable[/red]")