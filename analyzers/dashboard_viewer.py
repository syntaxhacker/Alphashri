#!/usr/bin/env python3
"""
TV Alerts Dashboard Viewer
===========================
Standalone dashboard to monitor TV Alerts server positions and status.
Connects to the running server to display real-time information.
"""

import requests
import time
import os
import sys
from datetime import datetime
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.layout import Layout

console = Console()

class DashboardViewer:
    def __init__(self, server_url="http://localhost:5001"):
        self.server_url = server_url
        self.last_positions = []

    def get_server_health(self):
        """Get health status from server"""
        try:
            response = requests.get(f"{self.server_url}/health", timeout=5)
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            console.print(f"[red]❌ Cannot connect to server: {e}[/red]")
        return None

    def display_dashboard(self):
        """Display the full dashboard"""
        # Clear screen
        os.system('clear' if os.name == 'posix' else 'cls')

        console.print("[bold blue]📡 TV Alerts - Live Dashboard Viewer[/bold blue]")

        health = self.get_server_health()
        if not health:
            console.print("[red]❌ Server not available[/red]")
            return

        # Server Status Panel
        uptime = health.get('uptime', 'Unknown')
        positions_count = health.get('positions', 0)
        timestamp = health.get('timestamp', datetime.now().isoformat())

        status_text = f"""
🌐 Server: 🟢 RUNNING
📡 URL: {self.server_url}
💰 Active Positions: {positions_count}
📊 Status: 🟢 HEALTHY
⏰ Server Uptime: {uptime}
🕐 Last Update: {timestamp}
        """
        console.print(Panel(status_text.strip(), title="🖥️ Server Status", border_style="blue"))

        # Sample positions table (simulated data since we can't access the actual positions from API)
        console.print("\n[dim yellow]💡 Note: This viewer shows server status only.[/dim yellow]")
        console.print("[dim yellow]💡 Use the main script with --dashboard for full position details.[/dim yellow]")

        console.print(f"\n[dim]Refresh: {datetime.now().strftime('%H:%M:%S')} | Press Ctrl+C to exit[/dim]")

    def run_dashboard(self, refresh_interval=5):
        """Run the dashboard with auto-refresh"""
        console.print(f"[green]📊 Starting dashboard viewer (refresh every {refresh_interval}s)[/green]")
        console.print(f"[dim]Connected to: {self.server_url}[/dim]")

        try:
            while True:
                self.display_dashboard()
                time.sleep(refresh_interval)
        except KeyboardInterrupt:
            console.print("\n[yellow]👋 Dashboard viewer stopped[/yellow]")

def main():
    import argparse
    parser = argparse.ArgumentParser(description='TV Alerts Dashboard Viewer')
    parser.add_argument('--url', default='http://localhost:5001', help='Server URL (default: http://localhost:5001)')
    parser.add_argument('--refresh', type=int, default=5, help='Refresh interval in seconds (default: 5)')

    args = parser.parse_args()

    viewer = DashboardViewer(server_url=args.url)
    viewer.run_dashboard(refresh_interval=args.refresh)

if __name__ == "__main__":
    main()