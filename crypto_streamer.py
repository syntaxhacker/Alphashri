import os
import time
from datetime import datetime
from rich.live import Live
from rich.table import Table
from rich.console import Console
from tradingview_screener import Query
import rookiepy

console = Console()

class MarketStreamer:
    def __init__(self, refresh_interval=1):
        self.query = Query()
        self.cookies = self.get_tradingview_cookies()
        self.previous_prices = {}
        self.refresh_interval = refresh_interval  # Time between data fetches in seconds
        
        # Define assets to track with their markets
        self.assets = {
            "BINANCE:BTCUSDT": "crypto",
            "NASDAQ:TSLA": "america",
            "BINANCE:DOGEUSDT": "crypto",
            "NSE:TATAMOTORS": "india",
            "MCX:GOLD1!": "india",     # Gold Futures (MCX)
            "MCX:SILVER1!": "india"    # Silver Futures (MCX)
        }
        
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
        
    def get_market_data(self, symbol, market):
        """Get real-time market data for any asset"""
        try:
            _, df = (
                self.query
                .select(
                    'name',
                    'close',                    # Current price
                    'change',                   # 24h change %
                    'volume',                   # 24h volume
                    'RSI',                      # RSI(14)
                    'Volatility.D',             # Daily volatility
                    'description',              # Full name
                    'currency'                  # Currency
                )
                .set_markets(market)            # Set market
                .set_tickers(symbol)            # Set symbol
                .get_scanner_data(cookies=self.cookies)
            )
            
            if df.empty:
                console.print(f"[yellow]No data found for {symbol}[/yellow]")
                return None
                
            return df.iloc[0]
            
        except Exception as e:
            console.print(f"[red]Error fetching data for {symbol}: {str(e)}[/red]")
            return None

    def create_table(self, data_dict):
        """Create a rich table with market data"""
        table = Table(title=f"Market Prices ({datetime.now().strftime('%H:%M:%S')})")
        
        table.add_column("Asset", style="cyan", width=15)
        table.add_column("Price", justify="right", width=15)
        table.add_column("24h Change", justify="right", width=12)
        table.add_column("Volume", justify="right", width=15)
        table.add_column("RSI", justify="right", width=8)
        table.add_column("Volatility", justify="right", width=12)
        
        # Sort assets by type: Commodities, Crypto, Stocks
        sorted_items = sorted(data_dict.items(), key=lambda x: (
            "1" if "MCX:" in x[0] else      # Commodities first
            "2" if "BINANCE:" in x[0] else  # Crypto second
            "3"                             # Stocks last
        ))
        
        for symbol, data in sorted_items:
            if data is not None:
                # Get asset name
                name = data.get('description', symbol.split(':')[1])
                if "MCX:" in symbol:  # Clean up MCX symbol names
                    name = name.replace("1!", "")
                
                # Get price and determine color
                price = float(data['close'])
                currency = data.get('currency', 'USD')
                price_color = "white"
                if symbol in self.previous_prices:
                    if price > self.previous_prices[symbol]:
                        price_color = "green"
                    elif price < self.previous_prices[symbol]:
                        price_color = "red"
                self.previous_prices[symbol] = price
                
                # Get change and color
                change = float(data['change'])
                change_color = "green" if change >= 0 else "red"
                
                # Format volume based on market
                volume = float(data['volume'])
                if "USDT" in symbol:
                    volume_str = f"{volume:,.0f} USDT"
                elif "MCX:" in symbol:
                    volume_str = f"{volume:,.0f} lots"
                else:
                    volume_str = f"{volume:,.0f}"
                
                # Get RSI and volatility
                rsi = float(data['RSI'])
                volatility = float(data['Volatility.D'])
                
                # Format price with appropriate currency
                if currency == "INR":
                    price_str = f"₹{price:,.2f}"
                elif currency == "USD":
                    price_str = f"${price:,.2f}"
                else:
                    price_str = f"{currency} {price:,.2f}"
                
                table.add_row(
                    name,
                    f"[{price_color}]{price_str}[/{price_color}]",
                    f"[{change_color}]{change:+.2f}%[/{change_color}]",
                    volume_str,
                    f"{rsi:.2f}",
                    f"{volatility:.2f}%"
                )
            
        return table

    def stream(self):
        """Stream market data with live updates"""
        console.print(f"Starting Market Data Streamer (Refresh: {self.refresh_interval}s)...")
        
        try:
            # Display refresh rate is 2x the data fetch rate for smooth updates
            with Live(self.create_table({}), refresh_per_second=2/self.refresh_interval) as live:
                while True:
                    # Fetch data for all assets
                    data_dict = {}
                    for symbol, market in self.assets.items():
                        data = self.get_market_data(symbol, market)
                        data_dict[symbol] = data
                    
                    # Update display
                    live.update(self.create_table(data_dict))
                    time.sleep(self.refresh_interval)
                    
        except KeyboardInterrupt:
            console.print("\nStreaming stopped by user")
            
def main():
    start_time = time.time()
    try:
        # Create streamer with custom refresh interval (in seconds)
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