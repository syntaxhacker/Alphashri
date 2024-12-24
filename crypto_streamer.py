import os
import time
from datetime import datetime
from rich.live import Live
from rich.table import Table
from rich.console import Console
from tradingview_screener import Query
import rookiepy

console = Console()

class CryptoStreamer:
    def __init__(self):
        self.query = Query()
        self.cookies = self.get_tradingview_cookies()
        self.previous_price = None
        
    def get_tradingview_cookies(self):
        """Get TradingView cookies from browser"""
        try:
            cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.tradingview.com']))
            console.print("[green]Successfully loaded cookies from Chrome[/green]")
            return cookies
        except Exception:
            try:
                cookies = rookiepy.to_cookiejar(rookiepy.firefox(['.tradingview.com']))
                console.print("[green]Successfully loaded cookies from Firefox[/green]")
                return cookies
            except Exception:
                console.print("[red]Could not load cookies. Using delayed data.[/red]")
                return None
        
    def get_crypto_data(self, symbol="BINANCE:BTCUSDT"):
        """Get real-time crypto data"""
        try:
            _, df = (
                self.query
                .select(
                    'name',
                    'close',                    # Current price
                    'change',                   # 24h change %
                    'volume',                   # 24h volume
                    'total_value_traded',       # 24h traded value
                    'RSI',                      # RSI(14)
                    'Volatility.D',             # Daily volatility
                    'update_mode'               # Data mode
                )
                .set_markets('crypto')          # Set market to crypto
                .set_tickers(symbol)            # Set specific crypto pair
                .get_scanner_data(cookies=self.cookies)
            )
            
            if df.empty:
                console.print(f"[yellow]No data found for {symbol}[/yellow]")
                return None
                
            return df.iloc[0]
            
        except Exception as e:
            console.print(f"[red]Error fetching data: {str(e)}[/red]")
            return None

    def create_table(self, data):
        """Create a rich table with crypto data"""
        table = Table(title=f"Bitcoin Price ({datetime.now().strftime('%H:%M:%S')})")
        
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right")
        
        if data is not None:
            price = float(data['close'])
            price_color = "green" if self.previous_price and price > self.previous_price else "red" if self.previous_price else "white"
            self.previous_price = price
            
            change = float(data['change'])
            change_color = "green" if change >= 0 else "red"
            
            table.add_row("Price", f"[{price_color}]${price:,.2f}[/{price_color}]")
            table.add_row("24h Change", f"[{change_color}]{change:.2f}%[/{change_color}]")
            table.add_row("24h Volume", f"{float(data['volume']):,.2f} BTC")
            table.add_row("RSI(14)", f"{float(data['RSI']):.2f}")
            table.add_row("Daily Volatility", f"{float(data['Volatility.D']):.2f}%")
            
        return table

    def stream(self, symbol="BINANCE:BTCUSDT", interval=1):
        """Stream crypto data with live updates"""
        console.print(f"Starting BTC Price Streamer...")
        
        try:
            with Live(self.create_table(None), refresh_per_second=4) as live:
                while True:
                    data = self.get_crypto_data(symbol)
                    if data is not None:
                        live.update(self.create_table(data))
                    time.sleep(interval)
                    
        except KeyboardInterrupt:
            console.print("\nStreaming stopped by user")
            end_time = time.time()
            
def main():
    start_time = time.time()
    try:
        streamer = CryptoStreamer()
        streamer.stream()
    except KeyboardInterrupt:
        elapsed = time.time() - start_time
        hours = int(elapsed // 3600)
        minutes = int((elapsed % 3600) // 60)
        seconds = int(elapsed % 60)
        console.print(f"\nExecution time: {hours}h:{minutes:02d}m:{seconds:02d}s sec")

if __name__ == "__main__":
    main() 