#!/usr/bin/env python3
"""
Simple Gap Trading Paper Trading Bot
Monitors specific gap up/down watchlist and trades based on gap strategies
References: screeners/tv_screen_usage.py and trading_bots/upstox_paper_trading_bot.py
"""

import time
import sys
import os
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    RICH_AVAILABLE = True
except ImportError:
    print("Rich library not available, using basic printing")
    RICH_AVAILABLE = False

try:
    from config import UPSTOX_CONFIG
    from config_and_utils.free_indian_apis import UpstoxAPI
    DEPENDENCIES_AVAILABLE = True
except ImportError as e:
    print(f"❌ Import Error: {e}")
    DEPENDENCIES_AVAILABLE = False

console = Console() if RICH_AVAILABLE else None

def safe_print(message, style=None):
    """Safe printing with or without rich"""
    if RICH_AVAILABLE and console:
        console.print(message)
    else:
        # Strip rich formatting for basic print
        import re
        clean_message = re.sub(r'\[.*?\]', '', str(message))
        print(clean_message)

# Watchlist from user's trading plan
GAP_UP_WATCHLIST = [
    {"symbol": "VIJAYA", "score": 104.9, "price": 1121.2, "change": 10.2},
    {"symbol": "POCL", "score": 99.8, "price": 1095.3, "change": 15.5},
    {"symbol": "IPCALAB", "score": 90.9, "price": 1540.8, "change": 5.5},
    {"symbol": "SHYAMMETL", "score": 89.1, "price": 951.9, "change": 2.8},
    {"symbol": "WABAG", "score": 81.9, "price": 1640.0, "change": 3.0},
]

GAP_DOWN_WATCHLIST = [
    {"symbol": "COFORGE", "score": 122.2, "price": 1676.0, "change": -9.4},
    {"symbol": "PERSISTENT", "score": 113.4, "price": 5174.0, "change": -7.7},
    {"symbol": "NESTLEIND", "score": 99.4, "price": 2322.1, "change": -5.3},
    {"symbol": "VERANDA", "score": 91.7, "price": 221.6, "change": -9.6},
    {"symbol": "ACC", "score": 89.9, "price": 1890.0, "change": -3.1},
]

class GapWatchlistTrader:
    def __init__(self):
        if not DEPENDENCIES_AVAILABLE:
            console.print("[red]❌ Required dependencies not available[/red]")
            return
            
        self.upstox_client = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'],
            api_secret=UPSTOX_CONFIG['api_secret']
        )
        
        # Extract symbols from watchlists
        self.gap_up_symbols = [stock["symbol"] for stock in GAP_UP_WATCHLIST]
        self.gap_down_symbols = [stock["symbol"] for stock in GAP_DOWN_WATCHLIST]
        self.all_symbols = self.gap_up_symbols + self.gap_down_symbols
        
        # Current positions and prices
        self.positions = {}
        self.current_prices = {}
        self.prev_close_prices = {}  # Previous day's closing prices
        self.opening_prices = {}  # Today's opening prices
        
        # Paper trading tracking
        self.trades = []
        self.total_pnl = 0.0
        
        # Strategy settings
        self.gap_threshold = 2.0  # Minimum 2% gap to confirm
        self.stop_loss_pct = 2.0  # 2% stop loss
        self.target_pct = 5.0  # 5% target
        self.max_position_size = 50000  # ₹50,000 per position
        
        console.print("[green]✅ Gap Watchlist Trader initialized[/green]")
        
    def display_watchlist(self):
        """Display the current watchlist"""
        # Gap Up table
        gap_up_table = Table(title="🔥 GAP UP WATCHLIST", show_header=True, header_style="bold green")
        gap_up_table.add_column("Symbol", style="cyan")
        gap_up_table.add_column("Score", justify="right")
        gap_up_table.add_column("Price", justify="right")
        gap_up_table.add_column("Expected Change", justify="right", style="green")
        
        for stock in GAP_UP_WATCHLIST:
            gap_up_table.add_row(
                stock["symbol"],
                f"{stock['score']:.1f}",
                f"₹{stock['price']:,.2f}",
                f"+{stock['change']:.1f}%"
            )
        
        # Gap Down table
        gap_down_table = Table(title="📉 GAP DOWN WATCHLIST", show_header=True, header_style="bold red")
        gap_down_table.add_column("Symbol", style="cyan")
        gap_down_table.add_column("Score", justify="right")
        gap_down_table.add_column("Price", justify="right")
        gap_down_table.add_column("Expected Change", justify="right", style="red")
        
        for stock in GAP_DOWN_WATCHLIST:
            gap_down_table.add_row(
                stock["symbol"],
                f"{stock['score']:.1f}",
                f"₹{stock['price']:,.2f}",
                f"{stock['change']:.1f}%"
            )
        
        console.print(gap_up_table)
        console.print(gap_down_table)
        
    def get_current_prices(self):
        """Fetch current prices and previous day's closing prices for gap calculation"""
        safe_print("📊 Fetching current prices...")
        
        for symbol in self.all_symbols:
            try:
                # Get today's data (1 minute intervals) using v3 API
                # Try today first, then fall back to last trading day
                current_date = datetime.now()
                today_df = None
                
                # Try current day and previous days until we get data
                for days_back in range(5):  # Try up to 5 days back for weekends/holidays
                    try_date = (current_date - timedelta(days=days_back)).strftime("%Y-%m-%d")
                    today_df = self.upstox_client.fetch_historical_data_v3(
                        symbol=symbol,
                        unit='minutes',
                        interval=1,
                        to_date=try_date,
                        from_date=try_date
                    )
                    if today_df is not None and not today_df.empty:
                        safe_print(f"Got data for {symbol} from {try_date}")
                        break
                
                # Get previous trading day's data for gap calculation
                prev_df = None
                for days_back in range(1, 10):  # Look back up to 10 days for previous trading day
                    try_date = (current_date - timedelta(days=days_back)).strftime("%Y-%m-%d")
                    prev_df = self.upstox_client.fetch_historical_data_v3(
                        symbol=symbol,
                        unit='days',
                        interval=1,
                        to_date=try_date,
                        from_date=try_date
                    )
                    if prev_df is not None and not prev_df.empty:
                        safe_print(f"Got previous data for {symbol} from {try_date}")
                        break
                
                # Process today's data
                if today_df is not None and not today_df.empty:
                    current_price = today_df['close'].iloc[-1]
                    self.current_prices[symbol] = current_price
                    
                    # Store opening price (first candle of the day)
                    if symbol not in self.opening_prices:
                        self.opening_prices[symbol] = today_df['open'].iloc[0]
                        
                    safe_print(f"{symbol}: ₹{current_price:,.2f}")
                else:
                    safe_print(f"⚠️ No recent data for {symbol}")
                
                # Process previous day's closing price
                if prev_df is not None and not prev_df.empty:
                    prev_close = prev_df['close'].iloc[-1]
                    self.prev_close_prices[symbol] = prev_close
                    safe_print(f"{symbol} Prev Close: ₹{prev_close:,.2f}")
                else:
                    safe_print(f"⚠️ No previous data for {symbol}")
                    
            except Exception as e:
                safe_print(f"❌ Error fetching {symbol}: {e}")
                # Log the full error for debugging
                import traceback
                print(f"Full error for {symbol}: {traceback.format_exc()}")
                
        time.sleep(1)  # Rate limiting
        
    def check_gap_confirmations(self):
        """Check if gaps are confirmed and generate signals based on opening vs previous close"""
        signals = []
        
        # Check gap up confirmations
        for stock in GAP_UP_WATCHLIST:
            symbol = stock["symbol"]
            
            # Need both opening price and previous close to calculate gap
            if symbol in self.opening_prices and symbol in self.prev_close_prices:
                opening_price = self.opening_prices[symbol]
                prev_close = self.prev_close_prices[symbol]
                current_price = self.current_prices.get(symbol, opening_price)
                
                # Calculate actual gap: (opening - prev_close) / prev_close * 100
                gap_pct = ((opening_price - prev_close) / prev_close) * 100
                
                # Gap up confirmed if gap is positive and significant
                if gap_pct >= self.gap_threshold:
                    signals.append({
                        "symbol": symbol,
                        "type": "GAP_UP",
                        "current_price": current_price,
                        "opening_price": opening_price,
                        "prev_close": prev_close,
                        "gap_pct": gap_pct,
                        "score": stock["score"]
                    })
                    
        # Check gap down confirmations  
        for stock in GAP_DOWN_WATCHLIST:
            symbol = stock["symbol"]
            
            # Need both opening price and previous close to calculate gap
            if symbol in self.opening_prices and symbol in self.prev_close_prices:
                opening_price = self.opening_prices[symbol]
                prev_close = self.prev_close_prices[symbol]
                current_price = self.current_prices.get(symbol, opening_price)
                
                # Calculate actual gap: (opening - prev_close) / prev_close * 100
                gap_pct = ((opening_price - prev_close) / prev_close) * 100
                
                # Gap down confirmed if gap is negative and significant
                if gap_pct <= -self.gap_threshold:
                    signals.append({
                        "symbol": symbol,
                        "type": "GAP_DOWN",
                        "current_price": current_price,
                        "opening_price": opening_price,
                        "prev_close": prev_close,
                        "gap_pct": gap_pct,
                        "score": stock["score"]
                    })
                    
        return signals
    
    def execute_paper_trade(self, signal):
        """Execute a paper trade based on signal"""
        symbol = signal["symbol"]
        gap_type = signal["type"]
        current_price = signal["current_price"]
        
        # Don't trade if already have position
        if symbol in self.positions:
            return False
            
        # Calculate position size
        quantity = int(self.max_position_size / current_price)
        if quantity == 0:
            return False
            
        # Determine trade direction based on gap strategy
        if gap_type == "GAP_UP":
            # Gap up strategy: Buy on pullback/support test
            side = "BUY"
            stop_loss = current_price * (1 - self.stop_loss_pct / 100)
            target = current_price * (1 + self.target_pct / 100)
        else:  # GAP_DOWN
            # Gap down strategy: Sell on bounce failure
            side = "SELL"
            stop_loss = current_price * (1 + self.stop_loss_pct / 100)
            target = current_price * (1 - self.target_pct / 100)
            
        # Create position
        position = {
            "symbol": symbol,
            "side": side,
            "quantity": quantity,
            "entry_price": current_price,
            "stop_loss": stop_loss,
            "target": target,
            "entry_time": datetime.now(),
            "gap_type": gap_type,
            "score": signal["score"]
        }
        
        self.positions[symbol] = position
        
        # Log trade
        trade_log = {
            "action": "ENTRY",
            "timestamp": datetime.now(),
            "symbol": symbol,
            "side": side,
            "quantity": quantity,
            "price": current_price,
            "gap_type": gap_type,
            "score": signal["score"]
        }
        self.trades.append(trade_log)
        
        console.print(f"[green]✅ TRADE EXECUTED[/green]")
        console.print(f"Symbol: {symbol} | Side: {side} | Qty: {quantity}")
        console.print(f"Entry: ₹{current_price:,.2f} | Stop: ₹{stop_loss:,.2f} | Target: ₹{target:,.2f}")
        console.print(f"Gap Type: {gap_type} | Score: {signal['score']:.1f}")
        
        return True
    
    def check_positions(self):
        """Check existing positions for stop loss or target hits"""
        positions_to_close = []
        
        for symbol, position in self.positions.items():
            if symbol not in self.current_prices:
                continue
                
            current_price = self.current_prices[symbol]
            entry_price = position["entry_price"]
            side = position["side"]
            stop_loss = position["stop_loss"]
            target = position["target"]
            
            # Calculate current P&L
            if side == "BUY":
                pnl_pct = ((current_price - entry_price) / entry_price) * 100
                # Check stop loss or target
                if current_price <= stop_loss:
                    positions_to_close.append((symbol, "STOP_LOSS"))
                elif current_price >= target:
                    positions_to_close.append((symbol, "TARGET"))
            else:  # SELL
                pnl_pct = ((entry_price - current_price) / entry_price) * 100
                # Check stop loss or target
                if current_price >= stop_loss:
                    positions_to_close.append((symbol, "STOP_LOSS"))
                elif current_price <= target:
                    positions_to_close.append((symbol, "TARGET"))
            
            # Display current P&L
            pnl_color = "green" if pnl_pct > 0 else "red"
            console.print(f"[cyan]{symbol}[/cyan] P&L: [{pnl_color}]{pnl_pct:+.2f}%[/{pnl_color}] | "
                         f"Entry: ₹{entry_price:,.2f} | Current: ₹{current_price:,.2f}")
        
        # Close positions
        for symbol, reason in positions_to_close:
            self.close_position(symbol, reason)
    
    def close_position(self, symbol, reason):
        """Close a position and calculate P&L"""
        if symbol not in self.positions:
            return
            
        position = self.positions[symbol]
        current_price = self.current_prices[symbol]
        entry_price = position["entry_price"]
        side = position["side"]
        quantity = position["quantity"]
        
        # Calculate P&L
        if side == "BUY":
            pnl_pct = ((current_price - entry_price) / entry_price) * 100
            pnl_amount = (current_price - entry_price) * quantity
        else:  # SELL
            pnl_pct = ((entry_price - current_price) / entry_price) * 100
            pnl_amount = (entry_price - current_price) * quantity
            
        self.total_pnl += pnl_amount
        
        # Log trade
        trade_log = {
            "action": "EXIT",
            "timestamp": datetime.now(),
            "symbol": symbol,
            "side": side,
            "quantity": quantity,
            "entry_price": entry_price,
            "exit_price": current_price,
            "pnl_pct": pnl_pct,
            "pnl_amount": pnl_amount,
            "reason": reason,
            "duration": datetime.now() - position["entry_time"]
        }
        self.trades.append(trade_log)
        
        # Remove position
        del self.positions[symbol]
        
        pnl_color = "green" if pnl_amount > 0 else "red"
        console.print(f"[{pnl_color}]🔴 POSITION CLOSED[/{pnl_color}]")
        console.print(f"Symbol: {symbol} | Reason: {reason}")
        console.print(f"Entry: ₹{entry_price:,.2f} | Exit: ₹{current_price:,.2f}")
        console.print(f"P&L: [{pnl_color}]{pnl_pct:+.2f}% (₹{pnl_amount:+,.2f})[/{pnl_color}]")
    
    def display_summary(self):
        """Display trading summary"""
        console.print("\n" + "="*60)
        console.print("[bold blue]📊 TRADING SUMMARY[/bold blue]")
        console.print("="*60)
        
        total_trades = len([t for t in self.trades if t["action"] == "EXIT"])
        if total_trades > 0:
            winning_trades = len([t for t in self.trades if t["action"] == "EXIT" and t["pnl_amount"] > 0])
            win_rate = (winning_trades / total_trades) * 100
            
            console.print(f"Total Trades: {total_trades}")
            console.print(f"Winning Trades: {winning_trades} ({win_rate:.1f}%)")
            console.print(f"Total P&L: ₹{self.total_pnl:+,.2f}")
        else:
            console.print("No completed trades yet.")
            
        console.print(f"Active Positions: {len(self.positions)}")
        console.print("="*60)
    
    def wait_until_market_open(self):
        """Wait until 9:20 AM before starting active trading"""
        target_time = datetime.now().replace(hour=9, minute=20, second=0, microsecond=0)
        current_time = datetime.now()
        
        # If we're past 9:20 AM today, start immediately
        if current_time >= target_time:
            console.print("[green]✅ Market open time reached - starting active monitoring[/green]")
            return
        
        # Calculate wait time
        wait_seconds = (target_time - current_time).total_seconds()
        wait_minutes = int(wait_seconds // 60)
        wait_secs = int(wait_seconds % 60)
        
        console.print(f"[yellow]⏰ Waiting until 9:20 AM to start active trading...[/yellow]")
        console.print(f"[blue]Current time: {current_time.strftime('%H:%M:%S')}[/blue]")
        console.print(f"[blue]Target time: 9:20:00[/blue]")
        console.print(f"[yellow]Time remaining: {wait_minutes}m {wait_secs}s[/yellow]")
        
        # Wait with periodic updates
        while datetime.now() < target_time:
            remaining = (target_time - datetime.now()).total_seconds()
            if remaining <= 0:
                break
                
            mins = int(remaining // 60)
            secs = int(remaining % 60)
            
            # Update every 30 seconds
            if int(remaining) % 30 == 0:
                console.print(f"[dim]⏳ {mins}m {secs}s until market open (9:20 AM)...[/dim]")
            
            time.sleep(1)
        
        console.print("[green]🚀 9:20 AM reached - starting active trading mode![/green]")
    
    def run(self):
        """Main trading loop with market open wait"""
        if not DEPENDENCIES_AVAILABLE:
            console.print("[red]❌ Cannot run due to missing dependencies[/red]")
            return
            
        console.print(Panel.fit(
            "[bold green]🎯 GAP WATCHLIST PAPER TRADER[/bold green]\n"
            "Monitoring gap up/down predictions from TradingView screener\n"
            "Paper trading mode - No real money at risk",
            border_style="green"
        ))
        
        # Display watchlist
        self.display_watchlist()
        
        # Authenticate
        if not self.upstox_client.access_token:
            console.print("[blue]🔑 Authenticating with Upstox...[/blue]")
            if not self.upstox_client.authenticate():
                console.print("[red]❌ Authentication failed[/red]")
                return
        
        console.print("[green]✅ Authentication successful[/green]")
        
        # Wait until 9:20 AM before active trading
        self.wait_until_market_open()
        
        try:
            while True:
                current_time = datetime.now()
                console.print(f"\n[blue]⏰ {current_time.strftime('%H:%M:%S')} - Monitoring watchlist...[/blue]")
                
                # Update prices
                self.get_current_prices()
                
                # Check for gap confirmations and new signals
                signals = self.check_gap_confirmations()
                for signal in signals:
                    console.print(f"[yellow]🚨 GAP CONFIRMED: {signal['symbol']} {signal['type']} "
                                f"({signal['gap_pct']:+.1f}%) | "
                                f"Open: ₹{signal['opening_price']:,.2f} vs Prev Close: ₹{signal['prev_close']:,.2f}[/yellow]")
                    self.execute_paper_trade(signal)
                
                # Check existing positions
                if self.positions:
                    console.print("[blue]📊 Checking positions...[/blue]")
                    self.check_positions()
                
                # Display summary
                self.display_summary()
                
                # Wait before next iteration
                console.print("[dim]Waiting 30 seconds...[/dim]")
                time.sleep(30)
                
        except KeyboardInterrupt:
            console.print("\n[yellow]🛑 Stopping trader...[/yellow]")
            
            # Close all positions
            for symbol in list(self.positions.keys()):
                self.close_position(symbol, "MANUAL_STOP")
            
            # Final summary
            self.display_summary()
            
            console.print("[green]✅ Gap Watchlist Trader stopped[/green]")

if __name__ == "__main__":
    trader = GapWatchlistTrader()
    trader.run()