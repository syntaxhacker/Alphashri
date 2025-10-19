#!/usr/bin/env python3
"""
Rich Active Positions Table - Live Updating Version
Shows active positions with live P&L using Rich library
Exactly like the Rich table in old_tv_screen.py but updates in place
"""

import time
import os
from datetime import datetime
import random

# Rich imports like in old_tv_screen.py
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live

class RichPositionsTable:
    def __init__(self):
        # Initialize Rich console like in old_tv_screen.py
        self.console = Console()

        # Mock active positions (in real implementation, this would come from your trading system)
        self.positions = {
            'RELIANCE': {
                'side': 'BUY',
                'qty': 10,
                'entry_price': 2450.50,
                'entry_time': datetime.now(),
                'source': 'TV_SCREENER',
                'trailing_stop_active': True,
                'trailing_stop_pct': -0.8
            },
            'TCS': {
                'side': 'SELL',
                'qty': 5,
                'entry_price': 3200.75,
                'entry_time': datetime.now(),
                'source': 'TV_ALERT',
                'trailing_stop_active': False,
                'trailing_stop_pct': 0.0
            },
            'INFY': {
                'side': 'BUY',
                'qty': 15,
                'entry_price': 1450.25,
                'entry_time': datetime.now(),
                'source': 'MANUAL',
                'trailing_stop_active': True,
                'trailing_stop_pct': -1.2
            }
        }

        # Mock current prices (in real implementation, these would be live prices)
        self.current_prices = {
            'RELIANCE': 2475.30,
            'TCS': 3185.60,
            'INFY': 1465.80
        }

    def calculate_pnl(self, symbol, position, current_price):
        """Calculate P&L for a position"""
        entry_price = position['entry_price']
        qty = position['qty']

        # Gross P&L
        if position['side'] == 'BUY':
            gross_pnl = (current_price - entry_price) * qty
        else:  # SELL
            gross_pnl = (entry_price - current_price) * qty

        # Estimate charges (simplified)
        entry_charges = entry_price * qty * 0.00035  # 0.035%
        exit_charges = current_price * qty * 0.00035  # 0.035%
        total_charges = entry_charges + exit_charges

        # Net P&L
        net_pnl = gross_pnl - total_charges
        pnl_pct = (net_pnl / (entry_price * qty)) * 100

        return gross_pnl, net_pnl, pnl_pct, total_charges

    def format_currency(self, amount):
        """Format currency in Indian format"""
        return f"₹{amount:,.0f}"

    def format_percentage(self, pct):
        """Format percentage with color indicator"""
        if pct > 0:
            return f"+{pct:.2f}%"
        else:
            return f"{pct:.2f}%"

    def create_rich_display(self):
        """Create Rich display like in old_tv_screen.py"""
        # Create table exactly like in original file
        table = Table(title="📊 ACTIVE POSITIONS - Live P&L Monitor", show_header=True, header_style="bold magenta")
        table.add_column("Symbol", style="bold", no_wrap=True)
        table.add_column("Side", style="white")
        table.add_column("Entry", justify="right", style="cyan")
        table.add_column("Current", justify="right", style="white")
        table.add_column("Qty", justify="right", style="blue")
        table.add_column("P&L %", justify="right", style="bold")
        table.add_column("P&L ₹ (Net)", justify="right", style="bold")
        table.add_column("TSL", justify="right", style="magenta")
        table.add_column("Source", style="dim")

        # Table rows
        total_pnl = 0
        profitable_positions = 0

        for symbol in self.positions:
            position = self.positions[symbol]
            current_price = self.current_prices.get(symbol, position['entry_price'])

            # Calculate P&L
            gross_pnl, net_pnl, pnl_pct, charges = self.calculate_pnl(symbol, position, current_price)

            total_pnl += net_pnl
            if net_pnl > 0:
                profitable_positions += 1

            # Color coding exactly like original
            pnl_style = "green" if pnl_pct > 0 else "red"
            side_style = "green" if position['side'] == 'BUY' else "red"
            side_emoji = "🟢" if position['side'] == 'BUY' else "🔴"

            # Price source indicator with exchange info (like original)
            live_price = True  # Simulated
            if live_price:
                price_indicator = "🔄" if symbol in getattr(self, 'exchange_fallbacks', {}) else "🟢"
                current_price_display = f"{price_indicator}₹{current_price:,.2f}"
            else:
                current_price_display = f"🔴₹{current_price:,.2f}"

            # Trailing stop display with progressive buffer info (like original)
            if position['trailing_stop_active']:
                tsl_display = f"🎯{position['trailing_stop_pct']:+.1f}%"
                tsl_style = "bold green"
            else:
                tsl_display = "OFF"
                tsl_style = "dim"

            table.add_row(
                symbol,
                f"[{side_style}]{side_emoji} {position['side']}[/{side_style}]",
                f"₹{position['entry_price']:,.2f}",
                current_price_display,
                str(position['qty']),
                f"[{pnl_style}]{pnl_pct:+.2f}%[/{pnl_style}]",
                f"[{pnl_style}]₹{net_pnl:+,.0f}[/{pnl_style}]",
                f"[{tsl_style}]{tsl_display}[/{tsl_style}]",
                position['source'][:10]
            )

        # Summary footer exactly like original
        total_positions = len(self.positions)
        win_rate = (profitable_positions / total_positions * 100) if total_positions > 0 else 0
        total_pnl_style = "green" if total_pnl > 0 else "red"

        summary = f"Total Positions: {total_positions} | Profitable: {profitable_positions} ({win_rate:.1f}%) | Total P&L: [{total_pnl_style}]₹{total_pnl:+,.0f}[/{total_pnl_style}]"

        # Return just the table (not wrapped in panel) and print summary separately
        return table, summary

    def update_prices(self):
        """Simulate live price updates (in real implementation, fetch from API)"""
        for symbol in self.current_prices:
            # Simulate small price movements
            change_pct = random.uniform(-0.5, 0.5)  # ±0.5% change
            current_price = self.current_prices[symbol]
            new_price = current_price * (1 + change_pct / 100)

            # Ensure price doesn't go negative or too extreme
            new_price = max(new_price, current_price * 0.95)  # Max 5% down
            new_price = min(new_price, current_price * 1.05)  # Max 5% up

            self.current_prices[symbol] = round(new_price, 2)

    def run_live_display(self, refresh_interval=2):
        """Run continuous live display with optimized Rich console updates"""
        self.console.print("🚀 Starting Rich Live Positions Monitor (Ctrl+C to stop)")

        try:
            while True:
                # Update prices
                self.update_prices()

                # Clear screen and move cursor to top for smooth updates
                print("\033[2J\033[H", end="")

                # Create and print the rich table and summary
                table, summary = self.create_rich_display()
                self.console.print(f"[dim]Last Updated: {datetime.now().strftime('%H:%M:%S')}[/dim]")
                self.console.print()
                self.console.print(table)
                self.console.print()
                self.console.print(f"[dim]{summary}[/dim]")
                self.console.print("[dim]🟢 = Live price | 🔄 = Fallback exchange | 🎯 = Trailing Stop[/dim]")

                # Wait for next refresh
                time.sleep(refresh_interval)

        except KeyboardInterrupt:
            self.console.print("\n👋 Live display stopped by user")
        except Exception as e:
            self.console.print(f"\n❌ Error: {e}")

def main():
    table = RichPositionsTable()
    table.run_live_display(refresh_interval=2)  # Update every 2 seconds like original

if __name__ == "__main__":
    main()