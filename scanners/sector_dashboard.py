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

# Add project root to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

console = Console()

class SectorDashboard:
    def __init__(self, refresh_interval=15):
        self.refresh_interval = refresh_interval
        self.prev_sector_data = {}
        self.start_app_time = datetime.now()
        self.alerts = []
        self.max_alerts = 10
        self.last_fetch_time = None

    def fetch_latest_data(self):
        """Fetch latest stock data and aggregate by sector."""
        try:
            # Fetch technical indicators as well
            query = (
                Query()
                .select('name', 'close', 'change', 'sector', 'market_cap_basic', 'RSI', 'ADX')
                .set_markets('india')
                .where(
                    col('sector') != '',
                    col('market_cap_basic') > 5_000_000_000 # > 500 Cr for more stability
                )
                .order_by('market_cap_basic', ascending=False)
                .limit(500)
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

    def generate_movement_bar(self, pct_change):
        """Create a visual bar for movement."""
        normalized = (pct_change + 3) / 6
        normalized = max(0, min(1, normalized))
        bar_width = 12
        filled = int(normalized * bar_width)
        color = "green" if pct_change >= 0 else "red"
        bar = "█" * filled + "░" * (bar_width - filled)
        return f"[{color}]{bar}[/{color}]"

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

    def run(self):
        """Run the dashboard with Layout."""
        layout = Layout()
        layout.split(
            Layout(name="header", size=3),
            Layout(name="summary", size=5),
            Layout(name="main", ratio=1),
            Layout(name="alerts", size=6)
        )

        def get_renderable():
            sector_df, stock_df = self.fetch_latest_data()
            
            # Header
            header = Panel(
                Text(f"Sector Dashboard V2 | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Refresh: {self.refresh_interval}s", justify="center", style="bold white"),
                border_style="blue"
            )
            
            layout["header"].update(header)
            layout["summary"].update(self.make_summary(sector_df, stock_df))
            layout["main"].update(Panel(self.make_table(sector_df), title="📊 Sector Performance", border_style="blue"))
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
    args = parser.parse_args()
    
    dashboard = SectorDashboard(refresh_interval=args.interval)
    try:
        dashboard.run()
    except KeyboardInterrupt:
        console.print("\n[yellow]Dashboard stopped.[/yellow]")
