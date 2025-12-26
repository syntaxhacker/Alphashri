#!/usr/bin/env python3
"""
Intraday Momentum Scanner
Continuously monitors TradingView data for sudden price and volume surges.
"""

import time
import argparse
import pandas as pd
from datetime import datetime
from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live

console = Console()

class MomentumScanner:
    def __init__(self, market='america', interval=60, threshold_pct=1.0, min_volume=500000, limit=30, min_cap=1000000000, min_price=5):
        self.market = market
        self.interval = interval
        self.threshold_pct = threshold_pct
        self.min_volume = min_volume
        self.limit_stocks = limit
        self.min_cap = min_cap
        self.min_price = min_price
        self.previous_snapshot = {}
        self.currency = '$' if market == 'america' else '₹'
        self.iteration = 0
        self.alerts_history = []

    def fetch_data(self):
        """Fetch current market data for active stocks."""
        try:
            query = (
                Query()
                .select(
                    'name', 'close', 'volume', 'change', 'RSI', 'ADX', 'description', 'sector', 'market_cap_basic'
                )
                .set_markets(self.market)
                .where(
                    col('volume') > self.min_volume,
                    col('market_cap_basic') > self.min_cap,
                    col('close') > self.min_price,
                    col('change').between(-20, 20)
                )
                .order_by(col('volume'), ascending=False)
                .limit(self.limit_stocks)  # User defined limit
            )
            
            _, df = query.get_scanner_data()
            
            if df.empty:
                return {}
            
            df = df.sort_values('volume', ascending=False).drop_duplicates(subset=['name'])
            snapshot = df.set_index('name').to_dict(orient='index')
            return snapshot
            
        except Exception as e:
            return {}

    def detect_momentum(self, current_snapshot):
        """Compare current snapshot with previous to find movers."""
        alerts = []
        
        if not self.previous_snapshot:
            return alerts

        for symbol, data in current_snapshot.items():
            if symbol in self.previous_snapshot:
                prev_data = self.previous_snapshot[symbol]
                
                prev_price = prev_data['close']
                curr_price = data['close']
                
                # Calculate percentage change since last poll
                price_change_pct = ((curr_price - prev_price) / prev_price) * 100
                
                # Check for volume surge (if volume increased significantly in this interval)
                prev_vol = prev_data['volume']
                curr_vol = data['volume']
                vol_delta = curr_vol - prev_vol
                
                # Logic: If price moved > threshold OR volume surged significantly
                if abs(price_change_pct) >= self.threshold_pct:
                    alerts.append({
                        'symbol': symbol,
                        'price': curr_price,
                        'change_since_last': price_change_pct,
                        'total_change': data['change'],
                        'volume_delta': vol_delta,
                        'rsi': data['RSI'],
                        'adx': data['ADX'],
                        'type': 'PRICE SURGE' if price_change_pct > 0 else 'PRICE DROP'
                    })
        
        return alerts

    def generate_table(self, current_snapshot, alerts):
        """Generate the main dashboard table."""
        table = Table(title=f"🚀 INTRADAY MOMENTUM SCANNER ({self.market.upper()})", style="blue")
        table.add_column("Symbol", style="cyan", width=10)
        table.add_column(f"Price {self.currency}", justify="right")
        table.add_column("Change %", justify="right")
        table.add_column("Vol (M)", justify="right")
        table.add_column("Cap (B)", justify="right")
        table.add_column("RSI", justify="right")
        table.add_column("Last Move", justify="right", style="bold")
        
        # Sort by most recent significant move or just volume
        # Let's sort by 'Last Move' magnitude if present, else volume
        
        rows = []
        for symbol, data in current_snapshot.items():
            last_move = 0.0
            move_color = "dim"
            
            # Check if this symbol has an active alert/move in this iteration
            matching_alert = next((a for a in alerts if a['symbol'] == symbol), None)
            if matching_alert:
                last_move = matching_alert['change_since_last']
                move_color = "bright_green" if last_move > 0 else "bright_red"
            
            market_cap_billions = data.get('market_cap_basic', 0) / 1000000000
            
            rows.append({
                'symbol': symbol,
                'price': data['close'],
                'change': data['change'],
                'volume': data['volume'] / 1000000,
                'market_cap': market_cap_billions,
                'rsi': data['RSI'],
                'last_move': last_move,
                'move_color': move_color
            })
            
        # Sort: Stocks with recent moves first, then by volume
        rows.sort(key=lambda x: (abs(x['last_move']), x['volume']), reverse=True)
        
        for row in rows:
            last_move_str = f"[{row['move_color']}]{row['last_move']:+.2f}%[/{row['move_color']}]" if row['last_move'] != 0 else "-"
            
            table.add_row(
                row['symbol'],
                f"{row['price']:.2f}",
                f"[green]{row['change']:+.2f}%[/green]" if row['change'] > 0 else f"[red]{row['change']:+.2f}%[/red]",
                f"{row['volume']:.2f}M",
                f"{row['market_cap']:.1f}B",
                f"{row['rsi']:.0f}",
                last_move_str
            )
            
        return table

    def run(self):
        with Live(console=console, refresh_per_second=4) as live:
            try:
                while True:
                    # Fetch and process data
                    current_snapshot = self.fetch_data()
                    alerts = []
                    
                    if self.iteration > 0:
                        alerts = self.detect_momentum(current_snapshot)
                        
                        if alerts:
                            timestamp = datetime.now().strftime("%H:%M:%S")
                            for alert in alerts:
                                self.alerts_history.insert(0, f"[{timestamp}] {alert['symbol']}: {alert['change_since_last']:+.2f}% ({alert['type']})")
                                self.alerts_history = self.alerts_history[:5]

                    # Update state
                    self.previous_snapshot = current_snapshot
                    self.iteration += 1
                    
                    # Countdown loop
                    for remaining in range(self.interval, 0, -1):
                        table = self.generate_table(current_snapshot, alerts)
                        
                        # Create status panel
                        timestamp = datetime.now().strftime("%H:%M:%S")
                        status = f"Last Scan: {timestamp} | Next Scan in: {remaining}s | Iteration: {self.iteration}"
                        
                        # Combine elements
                        elements = [table, Panel(status, style="dim")]
                        
                        if self.alerts_history:
                            history_text = "\n".join(self.alerts_history)
                            elements.append(Panel(history_text, title="🔥 Recent Alerts", style="yellow", height=7))
                        
                        from rich.console import Group
                        live.update(Group(*elements))
                        time.sleep(1)

            except KeyboardInterrupt:
                console.print("\n[yellow]🛑 Scanner stopped by user.[/yellow]")
            except Exception as e:
                console.print(f"\n[red]❌ Fatal Error: {e}[/red]")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Intraday Momentum Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='us', help='Market to scan')
    parser.add_argument('--interval', type=int, default=30, help='Polling interval in seconds (default: 30)')
    parser.add_argument('--threshold', type=float, default=0.2, help='Price change threshold % per interval (default: 0.2)')
    parser.add_argument('--min-volume', type=int, default=500000, help='Minimum daily volume filter')
    parser.add_argument('--limit', type=int, default=30, help='Number of stocks to monitor (default: 30)')
    parser.add_argument('--min-cap', type=int, default=1000000000, help='Minimum market cap (default: 1,000,000,000)')
    parser.add_argument('--min-price', type=float, default=5.0, help='Minimum stock price (default: 5.0)')
    
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    
    scanner = MomentumScanner(
        market=market,
        interval=args.interval,
        threshold_pct=args.threshold,
        min_volume=args.min_volume,
        limit=args.limit,
        min_cap=args.min_cap,
        min_price=args.min_price
    )
    scanner.run()
