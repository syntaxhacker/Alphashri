#!/usr/bin/env python3
"""
Sector Movement Dashboard V2
============================
Real-time dashboard tracking sector-wise movement, technical strength, 
and market alerts using TradingView data.
"""

import time
import os
import sys
import pandas as pd
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
from rich.live import Live
from rich.panel import Panel
from rich.layout import Layout
from rich.text import Text
from tradingview_screener import Query, col
import requests

# Add project root to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

console = Console()

class SectorDashboard:
    def __init__(self, refresh_interval=15, market='india'):
        self.refresh_interval = refresh_interval
        self.market = market
        self.prev_sector_data = {}
        self.start_app_time = datetime.now()
        self.alerts = []
        self.max_alerts = 10
        self.last_fetch_time = None
        self.prev_stock_change = {}

        # Market-specific configurations
        if market == 'america':
            self.stocks_limit = 200  # Top 200 for US (most liquid)
            self.market_name = "US"
            # Macros for US market
            self.macros = {
                'Gold': 'GC=F',
                'Silver': 'SI=F',
                'Crude Oil': 'CL=F',
                'Nat Gas': 'NG=F',
                'US 10Y': '^TNX',
                'VIX': '^VIX',
                'DXY': 'DX-Y.NYB'  # US Dollar Index
            }
        else:  # india
            self.market_cap_filter = 5_000_000_000  # ₹500 Cr for Indian stocks
            self.stocks_limit = 500  # More stocks for India
            self.market_name = "India"
            # Macros for India market
            self.macros = {
                'Gold': 'GC=F',
                'Silver': 'SI=F',
                'Crude Oil': 'CL=F',
                'USDINR': 'USDINR=X',
                'US 10Y': '^TNX',
                'Nifty 50': '^NSEI',
                'Bank Nifty': '^NSEBANK'
            }

        self.macro_data = {}
        self.prev_macro_data = {}

    def fetch_latest_data(self):
        """Fetch latest stock data and aggregate by sector."""
        try:
            # Build query based on market
            if self.market == 'america':
                # US: Top 200 by market cap (most liquid stocks)
                query = (
                    Query()
                    .select('name', 'close', 'change', 'sector', 'market_cap_basic', 'RSI', 'ADX')
                    .set_markets(self.market)
                    .where(col('sector') != '')
                    .order_by('market_cap_basic', ascending=False)
                    .limit(self.stocks_limit)
                )
            else:
                # India: Filter by market cap
                query = (
                    Query()
                    .select('name', 'close', 'change', 'sector', 'market_cap_basic', 'RSI', 'ADX')
                    .set_markets(self.market)
                    .where(
                        col('sector') != '',
                        col('market_cap_basic') > self.market_cap_filter
                    )
                    .order_by('market_cap_basic', ascending=False)
                    .limit(self.stocks_limit)
                )

            _, df = query.get_scanner_data()

            if df.empty:
                return pd.DataFrame(), pd.DataFrame()

            # Deduplicate by name for stock-level analysis
            df_unique = df.drop_duplicates(subset=['name']).copy()

            # Calculate weighted average change for each sector
            df_unique['weighted_change'] = df_unique['change'] * df_unique['market_cap_basic']
            
            # Grouping logic
            def aggregate_sector(group):
                total_mc = group['market_cap_basic'].sum()
                avg_change = (group['change'] * group['market_cap_basic']).sum() / total_mc if total_mc > 0 else 0
                advances = (group['change'] > 0).sum()
                declines = (group['change'] < 0).sum()
                avg_rsi = group['RSI'].mean()
                avg_adx = group['ADX'].mean()
                
                # Get top 3 movers
                top_3 = group.sort_values('change', ascending=False).head(3)
                movers = [f"{s['name']}({s['change']:+.1f}%)" for _, s in top_3.iterrows()]
                
                return pd.Series({
                    'avg_change': avg_change,
                    'stock_count': len(group),
                    'advances': advances,
                    'declines': declines,
                    'avg_rsi': avg_rsi,
                    'avg_adx': avg_adx,
                    'top_movers': " ".join(movers)
                })

            sector_agg = df_unique.groupby('sector', group_keys=False).apply(aggregate_sector, include_groups=False).reset_index()
            
            # Check for alerts (movements > 0.4% in one refresh)
            for _, row in sector_agg.iterrows():
                sector = row['sector']
                curr_change = row['avg_change']
                if sector in self.prev_sector_data:
                    delta = curr_change - self.prev_sector_data[sector]
                    if abs(delta) >= 0.3:
                        direction = "🚀 SURGING" if delta > 0 else "📉 DROPPING"
                        self.alerts.insert(0, f"[{datetime.now().strftime('%H:%M:%S')}] {sector}: {direction} ({delta:+.2f}%)")
                self.prev_sector_data[sector] = curr_change

            self.alerts = self.alerts[:self.max_alerts]
            self.last_fetch_time = datetime.now()
            
            return sector_agg.sort_values('avg_change', ascending=False), df_unique
            
        except Exception as e:
            return pd.DataFrame(), pd.DataFrame()

    def fetch_macro_data(self):
        """Fetch macro economic data using Yahoo Finance API."""
        try:
            macro_results = {}
            for name, ticker in self.macros.items():
                try:
                    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}'
                    response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=3)
                    if response.status_code == 200:
                        data = response.json()
                        result = data.get('chart', {}).get('result', [{}])[0]
                        meta = result.get('meta', {})
                        indicators = result.get('indicators', {}).get('quote', [{}])[0]

                        if meta:
                            close = indicators.get('close', [None])[-1]
                            prev_close = indicators.get('open', [None])[-1]

                            if close and prev_close:
                                change = ((close - prev_close) / prev_close) * 100
                                macro_results[name] = {
                                    'price': close,
                                    'change': change
                                }
                except Exception:
                    pass

            # Check for macro alerts
            for name, data in macro_results.items():
                if name in self.prev_macro_data:
                    delta = data['change'] - self.prev_macro_data[name]['change']
                    if abs(delta) >= 0.5:
                        direction = "🚀 SURGING" if delta > 0 else "📉 DROPPING"
                        self.alerts.insert(0, f"[{datetime.now().strftime('%H:%M:%S')}] 🌍 {name}: {direction} ({delta:+.2f}%)")

            self.prev_macro_data = macro_results
            return macro_results

        except Exception:
            return {}

    def generate_movement_bar(self, pct_change):
        """Create a visual bar for movement."""
        normalized = (pct_change + 3) / 6
        normalized = max(0, min(1, normalized))
        bar_width = 12
        filled = int(normalized * bar_width)
        color = "green" if pct_change >= 0 else "red"
        bar = "█" * filled + "░" * (bar_width - filled)
        return f"[{color}]{bar}[/{color}]"

    def make_macros_panel(self, macro_data):
        """Build the macros panel."""
        if not macro_data:
            return Panel("[dim]Loading macro data...[/dim]", title="🌍 Global Macros", border_style="cyan")

        table = Table(box=None, header_style="bold cyan", border_style="dim", expand=True)
        table.add_column("Asset", width=12)
        table.add_column("Price", justify="right", width=12)
        table.add_column("Change", justify="right", width=10)
        table.add_column("Movement", justify="center", width=14)

        for name, data in macro_data.items():
            price = data['price']
            change = data['change']

            # Format price based on asset type
            if name in ['Gold', 'Silver']:
                price_str = f"\${price:.2f}"
            elif name in ['Crude Oil', 'Nat Gas']:
                price_str = f"\${price:.2f}"
            elif name == 'USDINR':
                price_str = f"₹{price:.2f}"
            elif '10Y' in name:
                price_str = f"{price:.2f}%"
            else:
                price_str = f"{price:.2f}"

            change_color = "green" if change >= 0 else "red"
            table.add_row(
                name,
                price_str,
                f"[{change_color}]{change:+.2f}%[/{change_color}]",
                self.generate_movement_bar(change)
            )

        return Panel(table, title="🌍 Global Macros", border_style="cyan")

    def make_summary(self, sector_df, stock_df):
        """Build the human readable summary panel."""
        if sector_df.empty:
            return Panel("Waiting for data...", title="✨ Market Highlights", border_style="dim")

        # Booming Sectors
        booming_sectors = sector_df[sector_df['avg_change'] > 1.5].head(2)
        sector_text = ""
        if not booming_sectors.empty:
            for _, s in booming_sectors.iterrows():
                sector_text += f"🔥 [bold green]{s['sector']}[/bold green] is booming (+{s['avg_change']:.2f}%) with {s['advances']}/{s['stock_count']} stocks up. "
        else:
            top_s = sector_df.iloc[0]
            sector_text = f"📈 Top Sector: [bold cyan]{top_s['sector']}[/bold cyan] (+{top_s['avg_change']:.2f}%)."

        # Booming Stocks (RSI 40-70, ADX > 20, Change > 2%)
        booming_stocks = stock_df[
            (stock_df['change'] > 2) & 
            (stock_df['RSI'] > 40) & (stock_df['RSI'] < 75) & 
            (stock_df['ADX'] > 20)
        ].sort_values('change', ascending=False).head(3)

        stock_text = "\n💎 [bold yellow]High Strength Stocks:[/bold yellow] "
        if not booming_stocks.empty:
            stock_text += ", ".join([f"{r['name']} (+{r['change']:.1f}%)" for _, r in booming_stocks.iterrows()])
        else:
            stock_text += "No specific technical breakouts detected."

        return Panel(f"{sector_text}{stock_text}", title="✨ Market Summary", border_style="bold magenta")

    def make_table(self, sector_df):
        """Build the main sector data table."""
        table = Table(box=None, header_style="bold cyan", border_style="dim", expand=True)
        table.add_column("Sector", width=22)
        table.add_column("Change", justify="right", width=8)
        table.add_column("Movement", justify="center", width=14)
        table.add_column("A/D Ratio", justify="center", width=10)
        table.add_column("Strength", justify="center", width=12)
        table.add_column("Top Movers")

        for _, row in sector_df.iterrows():
            # A/D Ratio
            ad_color = "green" if row['advances'] > row['declines'] else "red"
            ad_ratio = f"[{ad_color}]{int(row['advances'])}:{int(row['declines'])}[/{ad_color}]"
            
            # Strength Logic
            strength = "Neutral"
            str_color = "white"
            if row['avg_adx'] > 25:
                strength = "Strong"
                str_color = "bold green"
            elif row['avg_adx'] < 15:
                strength = "Weak"
                str_color = "dim red"
            
            change_color = "green" if row['avg_change'] > 0 else "red"
            
            table.add_row(
                row['sector'],
                f"[{change_color}]{row['avg_change']:+.2f}%[/{change_color}]",
                self.generate_movement_bar(row['avg_change']),
                ad_ratio,
                f"[{str_color}]{strength}[/{str_color}]",
                row['top_movers']
            )
        return table

    def make_alerts(self):
        """Build the alerts panel."""
        if not self.alerts:
            return Panel("[dim]No major alerts yet...[/dim]", title="🔔 Real-time Alerts", border_style="blue")
        
        alert_text = "\n".join(self.alerts)
        return Panel(alert_text, title="🔔 Real-time Alerts", border_style="yellow")

    def make_interval_movers(self, stock_df):
        """Show stocks with the biggest change since last refresh."""
        if stock_df.empty:
            return Panel("[dim]No stock data yet...[/dim]", title="⏱ Interval Movers", border_style="magenta")

        if not self.prev_stock_change:
            for _, row in stock_df.iterrows():
                self.prev_stock_change[row['name']] = row['change']
            return Panel("[dim]Collecting baseline for interval moves...[/dim]", title="⏱ Interval Movers", border_style="magenta")

        movers = []
        for _, row in stock_df.iterrows():
            name = row['name']
            curr_change = row['change']
            prev_change = self.prev_stock_change.get(name)
            if prev_change is None:
                continue
            delta = curr_change - prev_change
            if abs(delta) >= 0.3:
                movers.append((name, curr_change, prev_change, delta))

        # Update previous change values AFTER calculating deltas
        for _, row in stock_df.iterrows():
            self.prev_stock_change[row['name']] = row['change']

        # Clean up stocks that are no longer in the dataset
        current_stocks = set(stock_df['name'])
        self.prev_stock_change = {k: v for k, v in self.prev_stock_change.items() if k in current_stocks}

        if not movers:
            return Panel("[dim]No interval changes detected...[/dim]", title="⏱ Interval Movers", border_style="magenta")

        movers.sort(key=lambda x: abs(x[3]), reverse=True)
        movers = movers[:10]

        table = Table(box=None, header_style="bold magenta", border_style="dim", expand=True)
        table.add_column("Stock", overflow="ellipsis")
        table.add_column("Prev", justify="right", width=8)
        table.add_column("Now", justify="right", width=8)
        table.add_column("Δ", justify="right", width=8)

        for name, curr_change, prev_change, delta in movers:
            delta_color = "green" if delta >= 0 else "red"
            table.add_row(
                name,
                f"{prev_change:+.2f}%",
                f"{curr_change:+.2f}%",
                f"[{delta_color}]{delta:+.2f}%[/{delta_color}]"
            )

        return Panel(table, title="⏱ Interval Movers", border_style="magenta")

    def run(self):
        """Run the dashboard with Layout."""
        layout = Layout()
        layout.split(
            Layout(name="header", size=3),
            Layout(name="top", size=5),
            Layout(name="main", ratio=1),
            Layout(name="bottom", size=10)
        )
        layout["top"].split_row(
            Layout(name="summary"),
            Layout(name="macros")
        )
        layout["bottom"].split_row(
            Layout(name="bottom_left"),
            Layout(name="alerts")
        )

        def get_renderable():
            sector_df, stock_df = self.fetch_latest_data()
            macro_data = self.fetch_macro_data()

            # Header
            header = Panel(
                Text(f"Sector Dashboard V2 | Market: {self.market_name} | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Refresh: {self.refresh_interval}s", justify="center", style="bold white"),
                border_style="blue"
            )

            layout["header"].update(header)
            layout["summary"].update(self.make_summary(sector_df, stock_df))
            layout["macros"].update(self.make_macros_panel(macro_data))
            layout["main"].update(Panel(self.make_table(sector_df), title="📊 Sector Performance", border_style="blue"))
            layout["bottom_left"].update(self.make_interval_movers(stock_df))
            layout["alerts"].update(self.make_alerts())
            return layout

        with Live(get_renderable(), refresh_per_second=1, screen=True) as live:
            while True:
                time.sleep(self.refresh_interval)
                live.update(get_renderable())

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Sector Movement Dashboard V2")
    parser.add_argument("--interval", type=int, default=15, help="Refresh interval in seconds")
    parser.add_argument("--market", type=str, default='india', choices=['india', 'america'], help="Market to track (india or america)")
    args = parser.parse_args()

    dashboard = SectorDashboard(refresh_interval=args.interval, market=args.market)
    try:
        dashboard.run()
    except KeyboardInterrupt:
        console.print("\n[yellow]Dashboard stopped.[/yellow]")
