#!/usr/bin/env python3
"""
Automated Trading Bot - Live Execution System
Integrates News Analyzer + Volume Scanner + Risk Management
"""

import time
import json
import logging
from datetime import datetime, time as dt_time
import pandas as pd
import numpy as np
from typing import Dict, List, Optional
import threading
from dataclasses import dataclass

# Import local modules
from free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
from volatility_trend_scanner import VolatilityTrendScanner
from news_sentiment_analyzer import NewsAnalyzer
from live_news_monitor import LiveNewsMonitor

@dataclass
class TradingSignal:
    """Trading signal data structure"""
    symbol: str
    signal_type: str  # 'news_bullish', 'volume_spike', 'combined'
    entry_price: float
    stop_loss: float
    take_profit: float
    confidence: float
    timestamp: datetime
    source: str  # 'news' or 'volume' or 'combined'
    position_size: int
    risk_reward_ratio: float

@dataclass
class Position:
    """Active position data structure"""
    symbol: str
    entry_price: float
    current_price: float
    quantity: int
    stop_loss: float
    take_profit: float
    entry_time: datetime
    unrealized_pnl: float
    status: str  # 'open', 'closed', 'pending'

class AutomatedTradingBot:
    """Complete automated trading system"""
    
    def __init__(self, paper_trading=True):
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(f'trading_bot_{datetime.now().strftime("%Y%m%d")}.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger('TradingBot')
        
        # Trading mode
        self.paper_trading = paper_trading
        self.logger.info(f"🤖 Trading Bot initialized in {'PAPER' if paper_trading else 'LIVE'} mode")
        
        # Initialize components
        self.upstox_api = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'],
            api_secret=UPSTOX_CONFIG['api_secret']
        )
        
        self.volume_scanner = VolatilityTrendScanner()
        self.news_analyzer = NewsAnalyzer()
        self.news_monitor = LiveNewsMonitor()
        
        # Trading state
        self.active_positions: Dict[str, Position] = {}
        self.pending_signals: List[TradingSignal] = []
        self.trading_capital = 1000000  # ₹10 Lakh
        self.max_positions = 5
        self.risk_per_trade = 0.02  # 2% risk per trade
        
        # Strategy parameters
        self.strategy_config = {
            'volume_threshold': 1.5,
            'news_confidence_min': 0.7,
            'rsi_min': 50,
            'rsi_max': 75,
            'atr_multiplier_sl': 2.0,
            'atr_multiplier_tp': 3.0,
            'max_holding_days': 5
        }
        
        # Watchlist
        self.watchlist = [
            'EIEL', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK',
            'TATAMOTORS', 'DRREDDY', 'SBIN', 'LT', 'MARUTI'
        ]
        
        # Threading control
        self.running = False
        self.threads = []
        
        self.logger.info(f"💰 Trading Capital: ₹{self.trading_capital:,}")
        self.logger.info(f"📊 Watchlist: {', '.join(self.watchlist)}")
    
    def authenticate(self):
        """Authenticate with Upstox"""
        try:
            if self.upstox_api.authenticate():
                self.logger.info("✅ Upstox authentication successful")
                return True
            else:
                self.logger.error("❌ Upstox authentication failed")
                return False
        except Exception as e:
            self.logger.error(f"❌ Authentication error: {e}")
            return False
    
    def is_market_hours(self):
        """Check if market is open"""
        now = datetime.now()
        if now.weekday() > 4:  # Weekend
            return False
        
        current_time = now.time()
        market_open = dt_time(9, 15)
        market_close = dt_time(15, 30)
        
        return market_open <= current_time <= market_close
    
    def calculate_position_size(self, entry_price: float, stop_loss: float) -> int:
        """Calculate position size based on risk management"""
        try:
            # Available capital (considering existing positions)
            used_capital = sum(pos.entry_price * pos.quantity for pos in self.active_positions.values())
            available_capital = self.trading_capital - used_capital
            
            # Risk amount per trade
            risk_amount = self.trading_capital * self.risk_per_trade
            
            # Stop loss distance
            stop_loss_distance = abs(entry_price - stop_loss)
            
            # Calculate position size
            if stop_loss_distance > 0:
                position_size = int(risk_amount / stop_loss_distance)
                
                # Ensure we don't exceed available capital
                max_affordable = int(available_capital * 0.8 / entry_price)  # 80% of available
                final_size = min(position_size, max_affordable)
                
                return max(final_size, 1)  # Minimum 1 share
            else:
                return 1
                
        except Exception as e:
            self.logger.error(f"❌ Error calculating position size: {e}")
            return 1
    
    def generate_trading_signal(self, symbol: str, signal_source: str) -> Optional[TradingSignal]:
        """Generate trading signal with entry/exit levels"""
        try:
            # Get current market data
            current_price = self.get_current_price(symbol)
            if not current_price:
                return None
            
            # Get historical data for technical analysis
            historical_data = self.get_historical_data(symbol, days=30)
            if historical_data is None or len(historical_data) < 20:
                return None
            
            # Calculate ATR for stop loss/take profit
            high = historical_data['high']
            low = historical_data['low']
            close = historical_data['close']
            
            # Simple ATR calculation
            true_range = np.maximum(
                high - low,
                np.maximum(
                    np.abs(high - close.shift(1)),
                    np.abs(low - close.shift(1))
                )
            )
            atr = true_range.rolling(14).mean().iloc[-1]
            
            # Calculate RSI
            delta = close.diff()
            gain = (delta.where(delta > 0, 0)).rolling(14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs))
            current_rsi = rsi.iloc[-1]
            
            # Signal validation
            if not (self.strategy_config['rsi_min'] <= current_rsi <= self.strategy_config['rsi_max']):
                self.logger.info(f"⚠️ {symbol} RSI {current_rsi:.1f} outside acceptable range")
                return None
            
            # Calculate entry levels
            stop_loss = current_price - (atr * self.strategy_config['atr_multiplier_sl'])
            take_profit = current_price + (atr * self.strategy_config['atr_multiplier_tp'])
            
            # Position sizing
            position_size = self.calculate_position_size(current_price, stop_loss)
            
            # Risk-reward ratio
            risk = abs(current_price - stop_loss)
            reward = abs(take_profit - current_price)
            rr_ratio = reward / risk if risk > 0 else 0
            
            # Signal confidence based on source
            if signal_source == 'news':
                confidence = 0.8
            elif signal_source == 'volume':
                confidence = 0.7
            elif signal_source == 'combined':
                confidence = 0.9
            else:
                confidence = 0.6
            
            signal = TradingSignal(
                symbol=symbol,
                signal_type=f'{signal_source}_bullish',
                entry_price=current_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                confidence=confidence,
                timestamp=datetime.now(),
                source=signal_source,
                position_size=position_size,
                risk_reward_ratio=rr_ratio
            )
            
            self.logger.info(f"📊 {symbol} Signal Generated: Entry=₹{current_price:.2f}, SL=₹{stop_loss:.2f}, TP=₹{take_profit:.2f}, R:R={rr_ratio:.2f}")
            
            return signal
            
        except Exception as e:
            self.logger.error(f"❌ Error generating signal for {symbol}: {e}")
            return None
    
    def get_current_price(self, symbol: str) -> Optional[float]:
        """Get current market price"""
        try:
            # In paper trading mode, we can use last available price
            if self.paper_trading:
                # Simulate getting current price (in real implementation, use Upstox API)
                historical_data = self.get_historical_data(symbol, days=1)
                if historical_data is not None and len(historical_data) > 0:
                    return float(historical_data['close'].iloc[-1])
            else:
                # Real trading: Use Upstox API to get LTP
                instrument_key = self.upstox_api.get_instrument_key(symbol)
                if instrument_key:
                    # Get LTP from Upstox
                    # This would be implemented with actual Upstox API call
                    pass
            
            return None
            
        except Exception as e:
            self.logger.error(f"❌ Error getting current price for {symbol}: {e}")
            return None
    
    def get_historical_data(self, symbol: str, days: int = 30) -> Optional[pd.DataFrame]:
        """Get historical data for analysis"""
        try:
            # Use the existing Upstox API to fetch historical data
            from datetime import timedelta
            
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            
            # Format dates for Upstox API
            start_date_str = start_date.strftime("%Y-%m-%d")
            end_date_str = end_date.strftime("%Y-%m-%d")
            
            # Get instrument key
            instrument_key = self.upstox_api.get_instrument_key(symbol)
            if not instrument_key:
                return None
            
            # Fetch historical data
            data = self.upstox_api.get_historical_candle_data(
                instrument_key=instrument_key,
                interval="day",
                from_date=start_date_str,
                to_date=end_date_str
            )
            
            if data and len(data) > 0:
                df = pd.DataFrame(data)
                df['datetime'] = pd.to_datetime(df['datetime'])
                df.set_index('datetime', inplace=True)
                return df
            
            return None
            
        except Exception as e:
            self.logger.error(f"❌ Error getting historical data for {symbol}: {e}")
            return None
    
    def execute_trade(self, signal: TradingSignal) -> bool:
        """Execute trading signal"""
        try:
            if len(self.active_positions) >= self.max_positions:
                self.logger.warning(f"⚠️ Maximum positions ({self.max_positions}) reached. Skipping {signal.symbol}")
                return False
            
            if signal.symbol in self.active_positions:
                self.logger.warning(f"⚠️ Already have position in {signal.symbol}")
                return False
            
            if self.paper_trading:
                # Paper trading execution
                position = Position(
                    symbol=signal.symbol,
                    entry_price=signal.entry_price,
                    current_price=signal.entry_price,
                    quantity=signal.position_size,
                    stop_loss=signal.stop_loss,
                    take_profit=signal.take_profit,
                    entry_time=signal.timestamp,
                    unrealized_pnl=0.0,
                    status='open'
                )
                
                self.active_positions[signal.symbol] = position
                
                self.logger.info(f"📈 PAPER TRADE EXECUTED:")
                self.logger.info(f"   Symbol: {signal.symbol}")
                self.logger.info(f"   Entry: ₹{signal.entry_price:.2f}")
                self.logger.info(f"   Quantity: {signal.position_size}")
                self.logger.info(f"   Stop Loss: ₹{signal.stop_loss:.2f}")
                self.logger.info(f"   Take Profit: ₹{signal.take_profit:.2f}")
                
                return True
            else:
                # Real trading execution (implement Upstox order placement)
                self.logger.info(f"🚀 LIVE TRADE: Would execute {signal.symbol} at ₹{signal.entry_price:.2f}")
                # TODO: Implement actual Upstox order placement
                return False
                
        except Exception as e:
            self.logger.error(f"❌ Error executing trade for {signal.symbol}: {e}")
            return False
    
    def monitor_positions(self):
        """Monitor and manage active positions"""
        while self.running:
            try:
                if not self.is_market_hours():
                    time.sleep(300)  # Check every 5 minutes outside market hours
                    continue
                
                for symbol, position in list(self.active_positions.items()):
                    # Get current price
                    current_price = self.get_current_price(symbol)
                    if not current_price:
                        continue
                    
                    # Update position
                    position.current_price = current_price
                    position.unrealized_pnl = (current_price - position.entry_price) * position.quantity
                    
                    # Check exit conditions
                    should_exit = False
                    exit_reason = ""
                    
                    # Stop loss hit
                    if current_price <= position.stop_loss:
                        should_exit = True
                        exit_reason = "Stop Loss"
                    
                    # Take profit hit
                    elif current_price >= position.take_profit:
                        should_exit = True
                        exit_reason = "Take Profit"
                    
                    # Time-based exit (holding too long)
                    elif (datetime.now() - position.entry_time).days >= self.strategy_config['max_holding_days']:
                        should_exit = True
                        exit_reason = "Time Limit"
                    
                    if should_exit:
                        self.close_position(symbol, current_price, exit_reason)
                
                time.sleep(30)  # Check every 30 seconds during market hours
                
            except Exception as e:
                self.logger.error(f"❌ Error monitoring positions: {e}")
                time.sleep(60)
    
    def close_position(self, symbol: str, exit_price: float, reason: str):
        """Close an active position"""
        try:
            if symbol not in self.active_positions:
                return
            
            position = self.active_positions[symbol]
            
            # Calculate P&L
            pnl = (exit_price - position.entry_price) * position.quantity
            pnl_percent = (pnl / (position.entry_price * position.quantity)) * 100
            
            # Update position status
            position.status = 'closed'
            position.current_price = exit_price
            position.unrealized_pnl = pnl
            
            # Log the trade
            self.logger.info(f"🔚 POSITION CLOSED:")
            self.logger.info(f"   Symbol: {symbol}")
            self.logger.info(f"   Reason: {reason}")
            self.logger.info(f"   Entry: ₹{position.entry_price:.2f}")
            self.logger.info(f"   Exit: ₹{exit_price:.2f}")
            self.logger.info(f"   Quantity: {position.quantity}")
            self.logger.info(f"   P&L: ₹{pnl:.2f} ({pnl_percent:.1f}%)")
            
            # Remove from active positions
            del self.active_positions[symbol]
            
            # Save trade record
            self.save_trade_record(position, exit_price, reason, pnl)
            
        except Exception as e:
            self.logger.error(f"❌ Error closing position for {symbol}: {e}")
    
    def save_trade_record(self, position: Position, exit_price: float, reason: str, pnl: float):
        """Save completed trade to file"""
        try:
            trade_record = {
                'symbol': position.symbol,
                'entry_time': position.entry_time.isoformat(),
                'exit_time': datetime.now().isoformat(),
                'entry_price': position.entry_price,
                'exit_price': exit_price,
                'quantity': position.quantity,
                'pnl': pnl,
                'exit_reason': reason,
                'holding_period_hours': (datetime.now() - position.entry_time).total_seconds() / 3600
            }
            
            # Append to daily trade log
            filename = f"trades_{datetime.now().strftime('%Y%m%d')}.json"
            
            try:
                with open(filename, 'r') as f:
                    trades = json.load(f)
            except FileNotFoundError:
                trades = []
            
            trades.append(trade_record)
            
            with open(filename, 'w') as f:
                json.dump(trades, f, indent=2)
                
        except Exception as e:
            self.logger.error(f"❌ Error saving trade record: {e}")
    
    def scan_for_signals(self):
        """Continuously scan for trading signals"""
        while self.running:
            try:
                if not self.is_market_hours():
                    time.sleep(300)  # Check every 5 minutes outside market hours
                    continue
                
                self.logger.info("🔍 Scanning for trading signals...")
                
                for symbol in self.watchlist:
                    # Skip if we already have a position
                    if symbol in self.active_positions:
                        continue
                    
                    # Check for news signals
                    news_alert = self.check_news_signals(symbol)
                    
                    # Check for volume signals
                    volume_alert = self.check_volume_signals(symbol)
                    
                    # Generate trading signal if conditions met
                    signal_source = None
                    
                    if news_alert and volume_alert:
                        signal_source = 'combined'
                    elif news_alert:
                        signal_source = 'news'
                    elif volume_alert:
                        signal_source = 'volume'
                    
                    if signal_source:
                        signal = self.generate_trading_signal(symbol, signal_source)
                        if signal and signal.confidence >= self.strategy_config['news_confidence_min']:
                            self.execute_trade(signal)
                
                time.sleep(180)  # Scan every 3 minutes
                
            except Exception as e:
                self.logger.error(f"❌ Error scanning for signals: {e}")
                time.sleep(300)
    
    def check_news_signals(self, symbol: str) -> bool:
        """Check for bullish news signals"""
        try:
            news_items = self.news_analyzer.scan_stock_news(symbol, hours_back=1)
            if news_items:
                alert = self.news_analyzer.generate_alert(symbol, news_items)
                if alert and alert['volume_prediction'] == 'HIGH_VOLUME_EXPECTED':
                    return True
            return False
        except Exception as e:
            self.logger.error(f"❌ Error checking news for {symbol}: {e}")
            return False
    
    def check_volume_signals(self, symbol: str) -> bool:
        """Check for volume spike signals"""
        try:
            signal = self.volume_scanner.scan_symbol_for_volatility(symbol)
            if signal and signal.confidence >= 0.7:
                return True
            return False
        except Exception as e:
            self.logger.error(f"❌ Error checking volume for {symbol}: {e}")
            return False
    
    def start_trading(self):
        """Start the automated trading system"""
        if not self.authenticate():
            self.logger.error("❌ Cannot start trading without authentication")
            return
        
        self.running = True
        self.logger.info("🚀 Starting Automated Trading Bot")
        
        # Start monitoring threads
        position_monitor_thread = threading.Thread(target=self.monitor_positions, daemon=True)
        signal_scanner_thread = threading.Thread(target=self.scan_for_signals, daemon=True)
        
        position_monitor_thread.start()
        signal_scanner_thread.start()
        
        self.threads = [position_monitor_thread, signal_scanner_thread]
        
        self.logger.info("✅ All trading threads started")
        
        # Main loop
        try:
            while self.running:
                # Print status every 5 minutes
                self.print_status()
                time.sleep(300)
                
        except KeyboardInterrupt:
            self.logger.info("🛑 Shutdown requested by user")
            self.stop_trading()
    
    def stop_trading(self):
        """Stop the trading system"""
        self.running = False
        self.logger.info("🛑 Stopping Automated Trading Bot")
        
        # Wait for threads to finish
        for thread in self.threads:
            thread.join(timeout=5)
        
        self.logger.info("✅ Trading bot stopped")
    
    def print_status(self):
        """Print current trading status"""
        total_pnl = sum(pos.unrealized_pnl for pos in self.active_positions.values())
        
        self.logger.info("📊 TRADING STATUS")
        self.logger.info(f"   Active Positions: {len(self.active_positions)}")
        self.logger.info(f"   Total Unrealized P&L: ₹{total_pnl:.2f}")
        
        for symbol, pos in self.active_positions.items():
            pnl_percent = (pos.unrealized_pnl / (pos.entry_price * pos.quantity)) * 100
            self.logger.info(f"   {symbol}: ₹{pos.current_price:.2f} ({pnl_percent:+.1f}%)")

def main():
    """Main function"""
    print("🤖 Automated Trading Bot")
    print("=" * 50)
    
    # Create trading bot (paper trading by default)
    bot = AutomatedTradingBot(paper_trading=True)
    
    try:
        # Start trading
        bot.start_trading()
    except KeyboardInterrupt:
        print("\n🛑 Stopping trading bot...")
        bot.stop_trading()

if __name__ == "__main__":
    main()