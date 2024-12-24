import os
import time
from datetime import datetime
from rich.live import Live
from rich.table import Table
from rich.console import Console
from rich.panel import Panel
from rich.layout import Layout
from rich.text import Text
from tradingview_screener import Query
import rookiepy

console = Console()

class MarketStreamer:
    def __init__(self, refresh_interval=1):
        self.refresh_interval = refresh_interval
        self.log_messages = []  # Initialize log messages first
        self.start_time = datetime.now()
        self.previous_prices = {}
        self.alerts = {}  # Store price alerts
        
        # Define assets to track with their markets and alert thresholds
        self.assets = {
            "BINANCE:BTCUSDT": {
                "market": "crypto",
                "alerts": {"above": 95000, "below": 90000}
            },
            "NASDAQ:TSLA": {
                "market": "america",
                "alerts": {"above": 200, "below": 150}
            },
            "BINANCE:DOGEUSDT": {
                "market": "crypto",
                "alerts": {"above": 0.15, "below": 0.10}
            },
            "NSE:TATAMOTORS": {
                "market": "india",
                "alerts": {"above": 1000, "below": 800}
            },
            "MCX:GOLD1!": {
                "market": "india",
                "alerts": {"above": 65000, "below": 60000}
            },
            "MCX:SILVER1!": {
                "market": "india",
                "alerts": {"above": 75000, "below": 70000}
            }
        }
        
        self.query = Query()
        self.cookies = self.get_tradingview_cookies()

    def log(self, message, level="info"):
        """Add a log message with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        color = {
            "info": "dim",
            "success": "green",
            "warning": "yellow",
            "error": "red"
        }.get(level, "white")
        self.log_messages.append(f"[{color}][{timestamp}] {message}[/{color}]")
        # Keep only last 5 messages
        self.log_messages = self.log_messages[-5:]
        
    def get_tradingview_cookies(self):
        """Get TradingView cookies from browser"""
        try:
            cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.tradingview.com']))
            self.log("Successfully loaded cookies from Chrome", "success")
            return cookies
        except Exception:
            try:
                cookies = rookiepy.to_cookiejar(rookiepy.firefox(['.tradingview.com']))
                self.log("Successfully loaded cookies from Firefox", "success")
                return cookies
            except Exception:
                self.log("Could not load cookies. Using delayed data.", "error")
                return None

    def get_market_data(self, symbol, market):
        """Get real-time market data for any asset"""
        try:
            self.log(f"Fetching data for {symbol}...")
            _, df = (
                self.query
                .select(
                    'name', 'close', 'change', 'volume', 'RSI',
                    'Volatility.D', 'description', 'currency',
                    'exchange', 'EMA20', 'SMA50', 'Stoch.K',
                    'Stoch.D', 'market_status'
                )
                .set_markets(market)
                .set_tickers(symbol)
                .get_scanner_data(cookies=self.cookies)
            )
            
            if df.empty:
                self.log(f"No data found for {symbol}", "warning")
                return None
                
            self.log(f"Successfully fetched data for {symbol}", "success")
            return df.iloc[0]
            
        except Exception as e:
            self.log(f"Error fetching data for {symbol}: {str(e)}", "error")
            return None

    def check_alerts(self, symbol, price, currency):
        """Check if price crosses alert thresholds"""
        if symbol not in self.alerts:
            self.alerts[symbol] = set()  # Store triggered alerts
            
        alerts = self.assets[symbol]["alerts"]
        alert_messages = []
        
        if price >= alerts["above"] and "above" not in self.alerts[symbol]:
            msg = f"🔔 {symbol} crossed above {currency}{alerts['above']:,.2f}"
            alert_messages.append(f"[yellow]{msg}[/yellow]")
            self.alerts[symbol].add("above")
        elif price <= alerts["below"] and "below" not in self.alerts[symbol]:
            msg = f"🔔 {symbol} crossed below {currency}{alerts['below']:,.2f}"
            alert_messages.append(f"[yellow]{msg}[/yellow]")
            self.alerts[symbol].add("below")
            
        return alert_messages

    def get_technical_signals(self, data):
        """Generate technical analysis signals"""
        signals = []
        
        # RSI signals
        rsi = float(data['RSI'])
        if rsi > 70:
            signals.append("[red]Overbought[/red]")
        elif rsi < 30:
            signals.append("[green]Oversold[/green]")
            
        # Moving Average signals
        price = float(data['close'])
        ema20 = float(data['EMA20'])
        sma50 = float(data['SMA50'])
        
        if price > ema20 > sma50:
            signals.append("[green]Bullish MA[/green]")
        elif price < ema20 < sma50:
            signals.append("[red]Bearish MA[/red]")
            
        # Stochastic signals
        stoch_k = float(data['Stoch.K'])
        stoch_d = float(data['Stoch.D'])
        
        if stoch_k > 80 and stoch_d > 80:
            signals.append("[red]Stoch Overbought[/red]")
        elif stoch_k < 20 and stoch_d < 20:
            signals.append("[green]Stoch Oversold[/green]")
            
        return " | ".join(signals) if signals else ""

    def create_display(self, data_dict):
        """Create the complete display with table and logs"""
        layout = Layout()
        
        # Create main table
        table = Table(
            title=f"Market Prices ({datetime.now().strftime('%H:%M:%S')})",
            title_style="bold cyan",
            show_header=True,
            header_style="bold magenta",
            border_style="blue"
        )
        
        # Add columns
        table.add_column("Asset", style="cyan", width=15)
        table.add_column("Price", justify="right", width=15)
        table.add_column("24h Change", justify="right", width=12)
        table.add_column("Volume", justify="right", width=15)
        table.add_column("RSI", justify="right", width=8)
        table.add_column("EMA20", justify="right", width=12)
        table.add_column("Status", justify="center", width=15)
        table.add_column("Signals", width=30)
        
        if not data_dict:
            table.add_row("[yellow]Waiting for data...[/yellow]")
        else:
            # Sort and add rows (existing code remains the same)
            sorted_items = sorted(data_dict.items(), key=lambda x: (
                "1" if "MCX:" in x[0] else
                "2" if "BINANCE:" in x[0] else
                "3"
            ))
            
            for symbol, data in sorted_items:
                if data is not None:
                    try:
                        # Get asset name and clean it
                        name = data.get('description', symbol.split(':')[1])
                        if "MCX:" in symbol:
                            name = name.replace("1!", "")
                        
                        # Price formatting and coloring
                        price = float(data['close'])
                        currency = data.get('currency', 'USD')
                        price_color = "white"
                        if symbol in self.previous_prices:
                            if price > self.previous_prices[symbol]:
                                price_color = "green"
                            elif price < self.previous_prices[symbol]:
                                price_color = "red"
                        self.previous_prices[symbol] = price
                        
                        # Check for price alerts
                        alerts = self.check_alerts(symbol, price, "₹" if currency == "INR" else "$")
                        if alerts:
                            for alert in alerts:
                                self.log(alert, "warning")
                        
                        # Format price with currency
                        if currency == "INR":
                            price_str = f"₹{price:,.2f}"
                        elif currency == "USD":
                            price_str = f"${price:,.2f}"
                        else:
                            price_str = f"{currency} {price:,.2f}"
                        
                        # Other data formatting
                        change = float(data['change'])
                        change_color = "green" if change >= 0 else "red"
                        
                        volume = float(data['volume'])
                        volume_str = (f"{volume:,.0f} USDT" if "USDT" in symbol else
                                    f"{volume:,.0f} lots" if "MCX:" in symbol else
                                    f"{volume:,.0f}")
                        
                        # Get market status and color
                        status = data.get('market_status', 'unknown')
                        status_color = ("green" if status == "open" else
                                      "yellow" if status in ["pre", "post"] else
                                      "red")
                        
                        # Get technical signals
                        signals = self.get_technical_signals(data)
                        
                        table.add_row(
                            name,
                            f"[{price_color}]{price_str}[/{price_color}]",
                            f"[{change_color}]{change:+.2f}%[/{change_color}]",
                            volume_str,
                            f"{float(data['RSI']):.2f}",
                            f"{float(data['EMA20']):.2f}",
                            f"[{status_color}]{status}[/{status_color}]",
                            signals
                        )
                    except Exception as e:
                        self.log(f"Error processing {symbol}: {str(e)}", "error")
                        continue
        
        # Create log panel
        log_panel = Panel(
            "\n".join(self.log_messages),
            title="System Log",
            border_style="blue",
            title_align="left",
            padding=(1, 2)
        )
        
        # Add session time
        session_time = datetime.now() - self.start_time
        hours = int(session_time.total_seconds() // 3600)
        minutes = int((session_time.total_seconds() % 3600) // 60)
        seconds = int(session_time.total_seconds() % 60)
        time_text = Text(f"Session Time: {hours:02d}:{minutes:02d}:{seconds:02d}", style="dim")
        
        # Combine everything in the layout
        layout.split_column(
            Layout(table, size=15),
            Layout(log_panel, size=8),
            Layout(time_text, size=1)
        )
        
        return layout

    def stream(self):
        """Stream market data with live updates"""
        self.log("Starting Market Data Streamer...", "info")
        self.log(f"Refresh interval: {self.refresh_interval}s", "info")
        self.log("Press Ctrl+C to stop", "info")
        
        try:
            with Live(self.create_display({}), refresh_per_second=2/self.refresh_interval, auto_refresh=False) as live:
                while True:
                    try:
                        data_dict = {}
                        for symbol, info in self.assets.items():
                            data = self.get_market_data(symbol, info["market"])
                            if data is not None:
                                data_dict[symbol] = data
                        
                        live.update(self.create_display(data_dict), refresh=True)
                        time.sleep(self.refresh_interval)
                        
                    except Exception as e:
                        self.log(f"Error in stream loop: {str(e)}", "error")
                        time.sleep(self.refresh_interval)
                    
        except KeyboardInterrupt:
            self.log("Streaming stopped by user", "warning")

def main():
    start_time = time.time()
    try:
        refresh_rate = 2  # Refresh every 2 seconds
        streamer = MarketStreamer(refresh_interval=refresh_rate)
        streamer.stream()
    except KeyboardInterrupt:
        elapsed = time.time() - start_time
        hours = int(elapsed // 3600)
        minutes = int((elapsed % 3600) // 60)
        seconds = int(elapsed % 60)
        console.print(f"\nExecution time: {hours}h:{minutes:02d}m:{seconds:02d}s sec")

if __name__ == "__main__":
    main() 