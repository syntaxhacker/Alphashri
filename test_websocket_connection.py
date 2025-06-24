#!/usr/bin/env python3
"""
Test WebSocket Connection for Real-time Data
Quick test to verify we're receiving live data from Binance
"""

import json
import time
from datetime import datetime
from binance.websocket.um_futures.websocket_client import UMFuturesWebsocketClient
from rich.console import Console

console = Console()

# Counter for messages
message_count = 0
last_prices = []

def message_handler(_, message):
    """Handle WebSocket messages"""
    global message_count, last_prices
    
    try:
        if isinstance(message, str):
            data = json.loads(message)
        else:
            data = message
        
        message_count += 1
        
        # Handle different message formats
        if 'stream' in data and 'data' in data:
            stream_data = data['data']
            stream_name = data['stream']
            
            if 'aggTrade' in stream_name or stream_data.get('e') == 'aggTrade':
                price = float(stream_data['p'])
                quantity = float(stream_data['q'])
                timestamp = datetime.fromtimestamp(stream_data['T'] / 1000)
                
                last_prices.append(price)
                if len(last_prices) > 10:
                    last_prices.pop(0)
                
                console.print(f"[green]📈 Msg #{message_count}: Price=${price:.2f}, Vol={quantity:.4f}, Time={timestamp.strftime('%H:%M:%S')}[/green]")
                
        elif 'e' in data and data['e'] == 'aggTrade':
            price = float(data['p'])
            quantity = float(data['q'])
            timestamp = datetime.fromtimestamp(data['T'] / 1000)
            
            last_prices.append(price)
            if len(last_prices) > 10:
                last_prices.pop(0)
            
            console.print(f"[green]📈 Msg #{message_count}: Price=${price:.2f}, Vol={quantity:.4f}, Time={timestamp.strftime('%H:%M:%S')}[/green]")
        
        # Show price movement
        if len(last_prices) >= 2:
            price_change = last_prices[-1] - last_prices[-2]
            change_pct = (price_change / last_prices[-2]) * 100
            direction = "📈" if price_change > 0 else "📉" if price_change < 0 else "➡️"
            console.print(f"[cyan]{direction} Change: ${price_change:.2f} ({change_pct:+.3f}%)[/cyan]")
        
    except Exception as e:
        console.print(f"[red]❌ Error: {str(e)}[/red]")
        console.print(f"[yellow]Raw message: {str(message)[:200]}...[/yellow]")

def test_websocket_connection():
    """Test WebSocket connection"""
    console.print("[bold blue]🔌 Testing WebSocket Connection to Binance[/bold blue]")
    console.print("[cyan]Connecting to BTCUSDT aggregate trade stream...[/cyan]")
    
    try:
        # Initialize WebSocket client
        ws_client = UMFuturesWebsocketClient(
            on_message=message_handler,
            is_combined=True
        )
        
        # Subscribe to BTCUSDT aggregate trades
        ws_client.agg_trade(symbol='btcusdt')
        
        console.print("[green]✅ WebSocket connected successfully![/green]")
        console.print("[yellow]⏳ Listening for messages... (will run for 30 seconds)[/yellow]")
        
        # Run for 30 seconds
        start_time = time.time()
        while time.time() - start_time < 30:
            time.sleep(1)
            
            # Show periodic status
            if int(time.time() - start_time) % 5 == 0:
                elapsed = int(time.time() - start_time)
                console.print(f"[blue]⏰ {elapsed}s elapsed, {message_count} messages received[/blue]")
        
        # Close connection
        ws_client.stop()
        
        # Final report
        console.print(f"\n[bold green]📊 Test Complete![/bold green]")
        console.print(f"[green]✅ Received {message_count} messages in 30 seconds[/green]")
        console.print(f"[green]✅ Average: {message_count/30:.1f} messages per second[/green]")
        
        if message_count > 0:
            console.print(f"[green]✅ WebSocket connection is working properly![/green]")
            console.print(f"[cyan]📈 Latest price: ${last_prices[-1]:.2f}[/cyan]")
            if len(last_prices) >= 2:
                price_range = max(last_prices) - min(last_prices)
                console.print(f"[cyan]📊 Price range: ${price_range:.2f}[/cyan]")
        else:
            console.print(f"[red]❌ No messages received - connection issue![/red]")
        
    except Exception as e:
        console.print(f"[red]❌ WebSocket test failed: {str(e)}[/red]")

if __name__ == "__main__":
    test_websocket_connection() 