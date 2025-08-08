#!/usr/bin/env python3
"""
Expanded Timeframe Testing - Dynamic TradingView Integration
===========================================================

Test gap trading timeframes (5min, 15min) on 100 stocks dynamically fetched from TradingView:
- Large Cap: 50 stocks (market cap > ₹50,000 crores)
- Mid Cap: 30 stocks (market cap ₹5,000-50,000 crores)  
- Small Cap: 20 stocks (market cap ₹1,000-5,000 crores)

Features:
- Dynamic stock universe from TradingView screener
- Real-time market cap classification
- Comprehensive analysis across market segments
- Fallback to static list if TradingView unavailable

Validates optimal timeframe for gap trading strategy.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os
import warnings
import time
from typing import List, Dict, Optional, Tuple
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
warnings.filterwarnings('ignore')

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(os.path.join(os.path.dirname(__file__), 'TradingView-Screener', 'src'))

from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

# Import dynamic stock fetcher
try:
    from tradingview_screener import Query, col
    from dynamic_stock_fetcher import DynamicStockFetcher
    TV_AVAILABLE = True
except ImportError:
    print("⚠️ TradingView screener not available. Using fallback stock list.")
    TV_AVAILABLE = False

class ExpandedTimeframeTest:
    def __init__(self, config=None):
        self.api = UpstoxAPI(
            api_key=UPSTOX_CONFIG.get('api_key'),
            api_secret=UPSTOX_CONFIG.get('api_secret')
        )
        
        # Default configuration - EASY TO MODIFY FOR TESTING
        default_config = {
            # 🎯 STRATEGY DIRECTION CONTROLS (Easy Testing)
            'gap_up_enabled': False,      # ✅/❌ Enable/disable gap up trades
            'gap_down_enabled': True,    # ✅/❌ Enable/disable gap down trades
            'long_trades_enabled': True, # ✅/❌ Enable/disable long trades
            'short_trades_enabled': True, # ✅/❌ Enable/disable short trades
            
            # 📊 GAP PARAMETERS
            'gap_threshold': 0.6,        # Minimum gap to consider
            'max_gap_threshold': 5.0,    # Maximum gap (avoid news-driven)
            
            # 💰 RISK MANAGEMENT
            'stop_loss_pct': 1.0,       # Base stop loss percentage
            'target_pct': 1.5,           # Base target percentage
            'trade_amount': 20000,       # Trade amount in rupees
            
            # 📈 VOLUME VALIDATION
            'volume_validation_enabled': True,  # Enable volume confirmation
            'min_volume_multiplier': 1.2,       # Volume should be X times average
            
            # ⏰ TIME FILTERS
            'time_filters_enabled': True,       # Enable time-based filters
            'avoid_last_30_min': True,          # Avoid trades in last 30 minutes
            'market_open_buffer': 15,           # First 15 minutes special handling
            
            # 🔧 DYNAMIC RISK MANAGEMENT
            'dynamic_risk_enabled': True,       # Enable dynamic stop/target adjustment
            'gap_size_scaling': True,           # Scale risk with gap size
            'time_based_scaling': True,         # Scale risk with time of day
            
            # 🕯️ CANDLE VALIDATION
            'candle_strength_required': True,   # Require bullish/bearish candle confirmation
            'direction_confirmation_required': True,  # Require close above/below prev close
        }
        
        # Merge with provided config
        self.config = default_config.copy()
        if config:
            self.config.update(config)
        
        # Extract commonly used parameters for backward compatibility
        self.gap_threshold = self.config['gap_threshold']
        self.max_gap_threshold = self.config['max_gap_threshold']
        self.stop_loss_pct = self.config['stop_loss_pct']
        self.target_pct = self.config['target_pct']
        self.trade_amount = self.config['trade_amount']
        self.min_volume_multiplier = self.config['min_volume_multiplier']
        self.avoid_last_30_min = self.config['avoid_last_30_min']
        self.market_open_buffer = self.config['market_open_buffer']
        
        # Thread management for parallel execution
        self.print_lock = threading.Lock()
        self.max_workers = 50  # Parallel API calls
        
        print("🚀 Enhanced Gap Trading Strategy - Configurable Testing")
        print("="*80)
        print(f"🎯 Testing: 5min, 15min intervals (1min removed - too noisy)")
        print(f"📈 Gap Range: {self.gap_threshold}% - {self.max_gap_threshold}% (avoid news-driven)")
        print(f"🛑 Base Stop Loss: {self.stop_loss_pct}% | Target: {self.target_pct}%")
        print(f"⚡ Parallel Workers: {self.max_workers} (faster execution)")
        print("="*80)
        print("📋 CURRENT CONFIGURATION:")
        print(f"  🎯 Gap Up Trades: {'✅ ENABLED' if self.config['gap_up_enabled'] else '❌ DISABLED'}")
        print(f"  🎯 Gap Down Trades: {'✅ ENABLED' if self.config['gap_down_enabled'] else '❌ DISABLED'}")
        print(f"  📈 Long Trades: {'✅ ENABLED' if self.config['long_trades_enabled'] else '❌ DISABLED'}")
        print(f"  📉 Short Trades: {'✅ ENABLED' if self.config['short_trades_enabled'] else '❌ DISABLED'}")
        print(f"  📊 Volume Validation: {'✅ ENABLED' if self.config['volume_validation_enabled'] else '❌ DISABLED'}")
        print(f"  ⏰ Time Filters: {'✅ ENABLED' if self.config['time_filters_enabled'] else '❌ DISABLED'}")
        print(f"  🔧 Dynamic Risk: {'✅ ENABLED' if self.config['dynamic_risk_enabled'] else '❌ DISABLED'}")
        print(f"  🕯️ Candle Strength: {'✅ REQUIRED' if self.config['candle_strength_required'] else '❌ OPTIONAL'}")
        print("="*80)

    def get_comprehensive_stock_list(self, use_volatile_stocks: bool = False) -> List[Dict]:
        """Get comprehensive list dynamically from TradingView or fallback to static list"""
        
        if TV_AVAILABLE:
            try:
                print("🔍 Fetching stocks dynamically from TradingView...")
                fetcher = DynamicStockFetcher()
                
                # Test connection first
                if fetcher.test_connection():
                    if use_volatile_stocks:
                        # Fetch top volatile stocks for better gap trading opportunities
                        print("🔥 Using VOLATILE STOCKS mode for enhanced gap trading...")
                        volatile_stocks_dict = fetcher.get_top_volatile_stocks_by_category(limit_per_category=150)
                        
                        # Flatten the volatile stocks dictionary into a list
                        dynamic_stocks = []
                        for category, stocks_list in volatile_stocks_dict.items():
                            dynamic_stocks.extend(stocks_list)
                        
                        if dynamic_stocks:
                            print(f"✅ Successfully fetched {len(dynamic_stocks)} VOLATILE stocks from TradingView")
                            print(f"🔥 These stocks have higher volatility - ideal for gap trading!")
                            return dynamic_stocks
                        else:
                            print("⚠️ No volatile stocks returned. Falling back to comprehensive list...")
                    
                    # Fetch comprehensive stock list: 50 large cap, 30 mid cap, 20 small cap
                    dynamic_stocks = fetcher.get_comprehensive_stock_list(
                        large_cap_count=200,
                        mid_cap_count=150,
                        small_cap_count=0
                    )
                    
                    if dynamic_stocks:
                        print(f"✅ Successfully fetched {len(dynamic_stocks)} stocks from TradingView")
                        return dynamic_stocks
                    else:
                        print("⚠️ No stocks returned from TradingView. Using fallback list.")
                else:
                    print("⚠️ TradingView connection failed. Using fallback list.")
            except Exception as e:
                print(f"⚠️ Error with TradingView fetcher: {e}. Using fallback list.")
        
        # Fallback to static list if TradingView is not available
        print("📋 Using fallback static stock list...")
        
        # Large Cap Stocks (Nifty 50 + major stocks)
        large_cap = [
            'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'HINDUNILVR', 'INFY', 'ITC', 'SBIN',
            'BAJFINANCE', 'BHARTIARTL', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'AXISBANK', 'MARUTI',
            'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'NESTLEIND', 'WIPRO', 'NTPC', 'POWERGRID',
            'TATAMOTORS', 'TECHM', 'HCLTECH', 'COALINDIA', 'INDUSINDBK', 'BAJAJFINSV', 'GRASIM',
            'ADANIPORTS', 'JSWSTEEL', 'TATASTEEL', 'HINDALCO', 'DRREDDY', 'CIPLA', 'DIVISLAB',
            'BRITANNIA', 'EICHERMOT', 'HEROMOTOCO', 'ONGC', 'IOC', 'BPCL', 'APOLLOHOSP', 'DMART',
            'PIDILITIND', 'BERGEPAINT', 'GODREJCP', 'MARICO', 'DABUR', 'COLPAL'
        ]
        
        # Mid Cap Stocks
        mid_cap = [
            'HAVELLS', 'VOLTAS', 'BATAINDIA', 'PAGEIND', 'MUTHOOTFIN', 'MANAPPURAM', 'CHOLAFIN',
            'FEDERALBNK', 'BANDHANBNK', 'IDFCFIRSTB', 'RBLBANK', 'FORTIS', 'LALPATHLAB', 
            'BIOCON', 'TORNTPHARM', 'ALKEM', 'IPCA', 'LUPIN', 'CADILAHC', 'GLENMARK',
            'AUROPHARMA', 'ZYDUSLIFE', 'ABBOTINDIA', 'PFIZER', 'GLAXO', 'SANOFI', 'NOVARTIS',
            'JUBLFOOD', 'TATACONSUM', 'MCDOWELL'
        ]
        
        # Small Cap Stocks
        small_cap = [
            'BOMDYEING', 'MANAKSIA', 'PNBGILTS', 'GREENPANEL', 'CREDITACC', 'SAPPHIRE',
            'ARIHANTCAP', 'ORIENTCEM', 'SHALBY', 'GTPL', 'ELGIEQUIP', 'MASTERTR',
            'JMFINANCIL', 'MUTHOOTMF', 'PROTEAN', 'DAMCAPITAL', 'GODREJAGRO', 'MRPL',
            'RVNL', 'IRFC'
        ]
        
        # Combine all categories with metadata
        all_stocks = []
        
        # Add large cap stocks (take 50)
        for symbol in large_cap[:50]:
            all_stocks.append({
                'symbol': symbol,
                'category': 'Large Cap',
                'expected_volatility': 'Low',
                'priority': 1
            })
        
        # Add mid cap stocks (take 30)
        for symbol in mid_cap[:30]:
            all_stocks.append({
                'symbol': symbol,
                'category': 'Mid Cap',
                'expected_volatility': 'Medium',
                'priority': 2
            })
            
        # Add small cap stocks (take 20)
        for symbol in small_cap[:20]:
            all_stocks.append({
                'symbol': symbol,
                'category': 'Small Cap',
                'expected_volatility': 'High',
                'priority': 3
            })
        
        print(f"📊 Fallback stock list prepared:")
        print(f"  🏢 Large Cap: {len([s for s in all_stocks if s['category'] == 'Large Cap'])}")
        print(f"  🏬 Mid Cap: {len([s for s in all_stocks if s['category'] == 'Mid Cap'])}")
        print(f"  🏪 Small Cap: {len([s for s in all_stocks if s['category'] == 'Small Cap'])}")
        print(f"  📈 Total: {len(all_stocks)} stocks")
        
        return all_stocks

    def test_single_stock_all_timeframes(self, stock_info: Dict, trade_date: str = '2025-07-23') -> List[Dict]:
        """Test a single stock across all timeframes"""
        symbol = stock_info['symbol']
        category = stock_info['category']
        results = []
        
        # Test each timeframe (removed 1min - too noisy/unreliable)
        for interval in [5, 15]:
            try:
                # Get data for this timeframe
                df = self.api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=interval,
                    to_date=trade_date,
                    from_date=(pd.to_datetime(trade_date) - timedelta(days=2)).strftime('%Y-%m-%d')
                )
                
                if df is None or df.empty:
                    continue
                
                # Filter for trade date
                target_date = pd.to_datetime(trade_date).date()
                day_data = df[df.index.date == target_date].copy()
                
                if day_data.empty:
                    continue
                
                # Calculate gap
                prev_day_data = df[df.index.date < target_date]
                if prev_day_data.empty:
                    continue
                
                prev_close = prev_day_data['close'].iloc[-1]
                current_open = day_data['open'].iloc[0]
                actual_gap_pct = ((current_open - prev_close) / prev_close) * 100
                
                # Enhanced gap validation
                if abs(actual_gap_pct) < self.gap_threshold:
                    continue
                
                # Avoid news-driven gaps (too large)
                if abs(actual_gap_pct) > self.max_gap_threshold:
                    continue
                
                # Simulate trade
                trade_result = self.simulate_timeframe_trade(
                    day_data, actual_gap_pct, interval, symbol
                )
                
                if trade_result['success']:
                    result = {
                        'symbol': symbol,
                        'category': category,
                        'timeframe': f'{interval}min',
                        'interval': interval,
                        'gap_pct': actual_gap_pct,
                        'gap_direction': 'Up' if actual_gap_pct > 0 else 'Down',
                        **trade_result
                    }
                    results.append(result)
                
            except Exception as e:
                # Silently continue - many stocks won't have data
                continue
                
            # Rate limiting for API
            time.sleep(0.02)  # Reduced for parallel execution
        
        return results

    def test_stock_batch_parallel(self, stock_batch: List[Dict], trade_date: str = '2025-07-23') -> List[Dict]:
        """Test a batch of stocks in parallel"""
        batch_results = []
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all stock tests
            future_to_stock = {
                executor.submit(self.test_single_stock_all_timeframes, stock_info, trade_date): stock_info
                for stock_info in stock_batch
            }
            
            # Collect results as they complete
            for future in as_completed(future_to_stock):
                stock_info = future_to_stock[future]
                try:
                    stock_results = future.result()
                    if stock_results:
                        batch_results.extend(stock_results)
                        
                        # Thread-safe progress reporting
                        with self.print_lock:
                            symbol = stock_info['symbol']
                            category = stock_info['category']
                            print(f"  ✅ {symbol:12} ({category:<9}): {len(stock_results)} timeframes with gaps")
                            
                except Exception as e:
                    with self.print_lock:
                        symbol = stock_info['symbol']
                        print(f"  ❌ {symbol:12}: Error - {str(e)[:50]}")
        
        return batch_results

    def simulate_timeframe_trade(self, day_data: pd.DataFrame, gap_pct: float, interval: int, symbol: str) -> Dict:
        """Simulate trade for specific timeframe with enhanced validation logic"""
        try:
            # Get previous day close for comparison (passed via gap calculation)
            current_open = day_data['open'].iloc[0]
            prev_close = current_open / (1 + gap_pct/100)  # Reverse calculate prev close
            
            # Wait for first candle to close for confirmation
            if len(day_data) < 2:  # Need at least 2 candles for proper entry
                return {'success': False, 'reason': 'Insufficient data - need at least 2 candles'}
            
            # ENHANCED VALIDATION 1: Time-based filters
            first_candle_time = day_data.index[0]
            market_open_time = first_candle_time.replace(hour=9, minute=15, second=0, microsecond=0)
            market_close_time = first_candle_time.replace(hour=15, minute=30, second=0, microsecond=0)
            
            # Check if we're in the last 30 minutes (avoid end-of-day volatility)
            if self.config['time_filters_enabled'] and self.config['avoid_last_30_min']:
                last_30_min = market_close_time - pd.Timedelta(minutes=30)
                if first_candle_time >= last_30_min:
                    return {'success': False, 'reason': 'Avoiding trades in last 30 minutes (config enabled)'}
            
            # ENHANCED VALIDATION 2: Volume confirmation
            first_candle_volume = day_data['volume'].iloc[0]
            if self.config['volume_validation_enabled'] and len(day_data) >= 5:  # Calculate average volume from available data
                avg_volume = day_data['volume'].mean()
                if first_candle_volume < avg_volume * self.min_volume_multiplier:
                    return {'success': False, 'reason': f'Insufficient volume confirmation (need {self.min_volume_multiplier}x avg)'}
            
            # ENHANCED VALIDATION 3: Gap size limits (already checked in caller, but double-check)
            if abs(gap_pct) > self.max_gap_threshold:
                return {'success': False, 'reason': f'Gap too large ({gap_pct:.1f}%) - likely news driven'}
            
            first_candle_close = day_data['close'].iloc[0]
            first_candle_time = day_data.index[0]
            
            # ENHANCED DIRECTIONAL LOGIC:
            # Gap Up + First candle closes ABOVE prev close + First candle is BULLISH (close > open) = LONG
            # Gap Down + First candle closes BELOW prev close + First candle is BEARISH (close < open) = SHORT
            # Any other combination = NO TRADE (failed gap or weak candle)
            
            first_candle_open = day_data['open'].iloc[0]
            first_candle_bullish = first_candle_close > first_candle_open
            first_candle_bearish = first_candle_close < first_candle_open
            
            trade_direction = None
            entry_reason = ""
            
            # CONFIG-BASED DIRECTION FILTERING
            if gap_pct > 0:  # Gap UP
                if not self.config['gap_up_enabled']:
                    return {'success': False, 'reason': 'Gap up trades disabled in config'}
                
                if self.config['direction_confirmation_required'] and first_candle_close <= prev_close:
                    return {'success': False, 'reason': f'Gap up but 1st candle closed below prev close (failed gap)'}
                
                if self.config['candle_strength_required'] and not first_candle_bullish:
                    return {'success': False, 'reason': f'Gap up + closes above prev close but 1st candle is bearish (close < open)'}
                
                trade_direction = "LONG"
                if not self.config['long_trades_enabled']:
                    return {'success': False, 'reason': 'Long trades disabled in config'}
                
                entry_reason = f"Gap Up ({gap_pct:+.1f}%) + 1st candle closes above prev close + bullish candle"
                
            else:  # Gap DOWN
                if not self.config['gap_down_enabled']:
                    return {'success': False, 'reason': 'Gap down trades disabled in config'}
                
                if self.config['direction_confirmation_required'] and first_candle_close >= prev_close:
                    return {'success': False, 'reason': f'Gap down but 1st candle closed above prev close (failed gap)'}
                
                if self.config['candle_strength_required'] and not first_candle_bearish:
                    return {'success': False, 'reason': f'Gap down + closes below prev close but 1st candle is bullish (close > open)'}
                
                trade_direction = "SHORT"
                if not self.config['short_trades_enabled']:
                    return {'success': False, 'reason': 'Short trades disabled in config'}
                
                entry_reason = f"Gap Down ({gap_pct:+.1f}%) + 1st candle closes below prev close + bearish candle"
            
            # Entry after first candle confirmation
            if interval == 5:
                # For 5min: Enter at start of 2nd candle (after 1st candle confirmation)
                entry_idx = min(1, len(day_data) - 1)
                entry_price = day_data['open'].iloc[entry_idx] if entry_idx < len(day_data) else day_data['close'].iloc[0]
                entry_time = day_data.index[entry_idx] if entry_idx < len(day_data) else first_candle_time
            else:  # 15min
                # For 15min: Enter at start of 2nd candle (after 1st candle confirmation)
                entry_idx = min(1, len(day_data) - 1)
                entry_price = day_data['open'].iloc[entry_idx] if entry_idx < len(day_data) else day_data['close'].iloc[0]
                entry_time = day_data.index[entry_idx] if entry_idx < len(day_data) else first_candle_time
            
            # Position sizing
            qty = int(self.trade_amount / entry_price)
            if qty <= 0:
                return {'success': False, 'reason': 'Invalid quantity'}
            
            # ENHANCED VALIDATION 4: Dynamic risk management based on gap size and time
            if self.config['dynamic_risk_enabled']:
                # Adjust stop loss and target based on gap size and market conditions
                gap_size_factor = min(abs(gap_pct) / 2.0, 2.0) if self.config['gap_size_scaling'] else 1.0
                
                # Time-based adjustments
                minutes_from_open = (first_candle_time - market_open_time).total_seconds() / 60
                if self.config['time_based_scaling']:
                    if minutes_from_open <= self.market_open_buffer:
                        # First 15 minutes: wider stops due to higher volatility
                        time_factor = 1.5
                    elif minutes_from_open >= 300:  # After 5 hours (2:15 PM)
                        # Late day: tighter stops due to lower volume
                        time_factor = 0.8
                    else:
                        time_factor = 1.0
                else:
                    time_factor = 1.0
                
                # Calculate dynamic stop loss and target
                dynamic_stop_pct = self.stop_loss_pct * gap_size_factor * time_factor
                dynamic_target_pct = self.target_pct * gap_size_factor * time_factor
                
                # Apply minimum and maximum limits
                dynamic_stop_pct = max(dynamic_stop_pct, -2.5)  # Max 2.5% stop loss
                dynamic_stop_pct = min(dynamic_stop_pct, -0.5)  # Min 0.5% stop loss
                dynamic_target_pct = max(dynamic_target_pct, 1.0)  # Min 1% target
                dynamic_target_pct = min(dynamic_target_pct, 5.0)  # Max 5% target
            else:
                # Use fixed risk levels
                dynamic_stop_pct = self.stop_loss_pct
                dynamic_target_pct = self.target_pct
                gap_size_factor = 1.0
                time_factor = 1.0
                minutes_from_open = (first_candle_time - market_open_time).total_seconds() / 60
            
            # Calculate levels based on trade direction
            if trade_direction == "LONG":
                stop_loss_price = entry_price * (1 + dynamic_stop_pct/100)  # Stop below entry
                target_price = entry_price * (1 + dynamic_target_pct/100)   # Target above entry
            else:  # SHORT
                stop_loss_price = entry_price * (1 - dynamic_stop_pct/100)  # Stop above entry  
                target_price = entry_price * (1 - dynamic_target_pct/100)   # Target below entry
            
            # Track trade
            exit_price = None
            exit_time = None
            exit_reason = 'EOD'
            max_profit = 0
            max_loss = 0
            
            # Process candles after entry
            start_idx = max(entry_idx, 0)
            for i in range(start_idx, len(day_data)):
                row = day_data.iloc[i]
                current_high = row['high']
                current_low = row['low']
                
                if trade_direction == "LONG":
                    # Track max profit/loss for LONG
                    high_pct = ((current_high - entry_price) / entry_price) * 100
                    low_pct = ((current_low - entry_price) / entry_price) * 100
                    max_profit = max(max_profit, high_pct)
                    max_loss = min(max_loss, low_pct)
                    
                    # Check stop loss (price going down)
                    if current_low <= stop_loss_price:
                        exit_price = stop_loss_price
                        exit_time = day_data.index[i]
                        exit_reason = 'Stop Loss'
                        break
                    
                    # Check target (price going up)
                    if current_high >= target_price:
                        exit_price = target_price
                        exit_time = day_data.index[i]
                        exit_reason = 'Target Hit'
                        break
                
                else:  # SHORT trade
                    # Track max profit/loss for SHORT
                    # For short: profit when price goes down, loss when price goes up
                    profit_pct = ((entry_price - current_low) / entry_price) * 100  # Profit when price drops
                    loss_pct = ((current_high - entry_price) / entry_price) * 100   # Loss when price rises
                    max_profit = max(max_profit, profit_pct)
                    max_loss = max(max_loss, loss_pct)  # Track max loss as positive value
                    
                    # Check stop loss (price going up beyond stop)
                    if current_high >= stop_loss_price:
                        exit_price = stop_loss_price
                        exit_time = day_data.index[i]
                        exit_reason = 'Stop Loss'
                        break
                    
                    # Check target (price going down to target)
                    if current_low <= target_price:
                        exit_price = target_price
                        exit_time = day_data.index[i]
                        exit_reason = 'Target Hit'
                        break
            
            # EOD exit if no stop/target hit
            if exit_price is None:
                exit_price = day_data['close'].iloc[-1]
                exit_time = day_data.index[-1]
                exit_reason = 'EOD'
            
            # Calculate P&L based on trade direction
            if trade_direction == "LONG":
                gross_pnl = (exit_price - entry_price) * qty
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
            else:  # SHORT
                gross_pnl = (entry_price - exit_price) * qty
                pnl_pct = ((entry_price - exit_price) / entry_price) * 100
            
            net_pnl = gross_pnl - 40  # Brokerage
            
            # Trade duration
            duration_min = (exit_time - entry_time).total_seconds() / 60
            
            return {
                'success': True,
                'trade_direction': trade_direction,
                'entry_reason': entry_reason,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'entry_time': entry_time,
                'exit_time': exit_time,
                'exit_reason': exit_reason,
                'qty': qty,
                'gross_pnl': gross_pnl,
                'net_pnl': net_pnl,
                'pnl_pct': pnl_pct,
                'duration_min': duration_min,
                'max_profit_pct': max_profit,
                'max_loss_pct': max_loss,
                'total_candles': len(day_data),
                'prev_close': prev_close,
                'first_candle_open': first_candle_open,
                'first_candle_close': first_candle_close,
                'first_candle_bullish': first_candle_bullish,
                'first_candle_bearish': first_candle_bearish,
                'first_candle_volume': first_candle_volume,
                'avg_volume': avg_volume if len(day_data) >= 5 else None,
                'volume_ratio': first_candle_volume / avg_volume if len(day_data) >= 5 else None,
                'dynamic_stop_pct': dynamic_stop_pct,
                'dynamic_target_pct': dynamic_target_pct,
                'gap_size_factor': gap_size_factor,
                'time_factor': time_factor,
                'minutes_from_open': minutes_from_open,
                'gap_confirmed': True
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def run_expanded_test(self, use_volatile_stocks: bool = False) -> pd.DataFrame:
        """Run expanded test on stocks using parallel execution"""
        test_type = "VOLATILE STOCKS" if use_volatile_stocks else "COMPREHENSIVE"
        print(f"\n🚀 Starting Expanded Timeframe Test - {test_type} (Parallel)")
        print("="*60)
        
        stock_list = self.get_comprehensive_stock_list(use_volatile_stocks=use_volatile_stocks)
        all_results = []
        start_time = time.time()
        
        # Split stocks into batches for parallel processing
        batch_size = 20  # Process 20 stocks at a time
        stock_batches = [stock_list[i:i + batch_size] for i in range(0, len(stock_list), batch_size)]
        
        print(f"\n📊 Testing {len(stock_list)} stocks in {len(stock_batches)} parallel batches...")
        print(f"⚡ Batch size: {batch_size} | Max workers: {self.max_workers}")
        print("="*60)
        
        total_stocks_with_data = 0
        
        for batch_num, stock_batch in enumerate(stock_batches, 1):
            print(f"\n🔄 Processing Batch {batch_num}/{len(stock_batches)} ({len(stock_batch)} stocks)...")
            
            # Process batch in parallel
            batch_start_time = time.time()
            batch_results = self.test_stock_batch_parallel(stock_batch)
            batch_time = time.time() - batch_start_time
            
            # Update results
            all_results.extend(batch_results)
            stocks_with_data_in_batch = len(set(result['symbol'] for result in batch_results))
            total_stocks_with_data += stocks_with_data_in_batch
            
            # Batch summary
            print(f"  📊 Batch {batch_num} completed in {batch_time:.2f}s")
            print(f"  ✅ {stocks_with_data_in_batch}/{len(stock_batch)} stocks had usable data")
            print(f"  💼 {len(batch_results)} total trades found")
            
            # Show some sample results
            if batch_results:
                profitable_trades = [r for r in batch_results if r['net_pnl'] > 0]
                print(f"  📈 {len(profitable_trades)}/{len(batch_results)} trades profitable")
                
                # Show top performer from this batch
                best_trade = max(batch_results, key=lambda x: x['net_pnl'])
                print(f"  🏆 Best: {best_trade['symbol']} {best_trade['timeframe']} → ₹{best_trade['net_pnl']:+.0f}")
            
            # Rate limiting between batches
            if batch_num < len(stock_batches):
                time.sleep(0.5)
        
        # Final summary
        total_time = time.time() - start_time
        estimated_sequential_time = len(stock_list) * 0.5  # Rough estimate
        time_saved = max(0, estimated_sequential_time - total_time)
        
        print(f"\n📈 Parallel Test Completed!")
        print("="*60)
        print(f"🔍 Total stocks tested: {len(stock_list)}")
        print(f"✅ Stocks with data: {total_stocks_with_data}")
        print(f"💼 Total trades found: {len(all_results)}")
        print(f"⚡ Execution time: {total_time:.2f}s")
        print(f"🚀 Time saved vs sequential: ~{time_saved:.1f}s")
        print(f"📊 Average: {total_time/len(stock_list):.3f}s per stock")
        
        if all_results:
            results_df = pd.DataFrame(all_results)
            self.analyze_expanded_results(results_df)
            return results_df
        else:
            print("❌ No trades found in expanded test")
            return pd.DataFrame()

    def analyze_expanded_results(self, results_df: pd.DataFrame):
        """Comprehensive analysis of expanded results"""
        print("\n" + "="*80)
        print("📊 EXPANDED TIMEFRAME ANALYSIS - 50+ STOCKS")
        print("="*80)
        
        if results_df.empty:
            print("No results to analyze")
            return
        
        total_trades = len(results_df)
        unique_stocks = results_df['symbol'].nunique()
        
        print(f"📈 Total Trades Analyzed: {total_trades}")
        print(f"🏢 Unique Stocks: {unique_stocks}")
        print(f"⏱️  Timeframes: {', '.join(sorted(results_df['timeframe'].unique()))}")
        
        # Overall timeframe comparison
        print(f"\n🏆 OVERALL TIMEFRAME PERFORMANCE:")
        print("-" * 60)
        
        timeframe_summary = results_df.groupby('timeframe').agg({
            'net_pnl': ['count', 'sum', 'mean'],
            'pnl_pct': 'mean',
            'duration_min': 'mean',
            'max_profit_pct': 'mean',
            'max_loss_pct': 'mean'
        }).round(2)
        
        # Flatten column names
        timeframe_summary.columns = ['_'.join(col).strip() for col in timeframe_summary.columns]
        
        # Add win rate calculation
        win_rates = results_df.groupby('timeframe').apply(
            lambda x: (x['net_pnl'] > 0).sum() / len(x) * 100
        ).round(1)
        
        # Display summary table
        print(f"{'Timeframe':<10} {'Trades':<8} {'Win Rate':<10} {'Total P&L':<12} {'Avg P&L':<10} {'Avg Duration':<12}")
        print("-" * 60)
        
        for timeframe in ['5min', '15min']:
            if timeframe in timeframe_summary.index:
                trades = int(timeframe_summary.loc[timeframe, 'net_pnl_count'])
                win_rate = win_rates[timeframe]
                total_pnl = timeframe_summary.loc[timeframe, 'net_pnl_sum']
                avg_pnl = timeframe_summary.loc[timeframe, 'net_pnl_mean']
                avg_duration = timeframe_summary.loc[timeframe, 'duration_min_mean']
                
                print(f"{timeframe:<10} {trades:<8} {win_rate:<9.1f}% ₹{total_pnl:<10.0f} ₹{avg_pnl:<8.0f} {avg_duration:<10.0f}min")
        
        # Category-wise analysis
        print(f"\n📊 PERFORMANCE BY STOCK CATEGORY:")
        print("-" * 60)
        
        category_analysis = results_df.groupby(['category', 'timeframe']).agg({
            'net_pnl': ['count', 'mean', 'sum'],
            'pnl_pct': 'mean'
        }).round(2)
        
        for category in ['Large Cap', 'Mid Cap', 'Small Cap']:
            cat_data = results_df[results_df['category'] == category]
            if not cat_data.empty:
                print(f"\n{category.upper()}:")
                for timeframe in ['5min', '15min']:
                    tf_cat_data = cat_data[cat_data['timeframe'] == timeframe]
                    if not tf_cat_data.empty:
                        trades = len(tf_cat_data)
                        win_rate = (tf_cat_data['net_pnl'] > 0).sum() / trades * 100
                        avg_pnl = tf_cat_data['net_pnl'].mean()
                        total_pnl = tf_cat_data['net_pnl'].sum()
                        
                        print(f"  {timeframe}: {trades} trades, {win_rate:.1f}% win rate, ₹{avg_pnl:.0f} avg, ₹{total_pnl:.0f} total")
        
        # Trade direction analysis (NEW: Shows LONG vs SHORT performance)
        print(f"\n📈 TRADE DIRECTION ANALYSIS:")
        print("-" * 50)
        
        if 'trade_direction' in results_df.columns:
            direction_analysis = results_df.groupby(['trade_direction', 'timeframe']).agg({
                'net_pnl': ['count', 'mean', 'sum']
            }).round(2)
            
            for direction in ['LONG', 'SHORT']:
                dir_data = results_df[results_df['trade_direction'] == direction]
                if not dir_data.empty:
                    print(f"\n{direction} TRADES:")
                    for timeframe in ['5min', '15min']:
                        tf_dir_data = dir_data[dir_data['timeframe'] == timeframe]
                        if not tf_dir_data.empty:
                            trades = len(tf_dir_data)
                            win_rate = (tf_dir_data['net_pnl'] > 0).sum() / trades * 100
                            avg_pnl = tf_dir_data['net_pnl'].mean()
                            total_pnl = tf_dir_data['net_pnl'].sum()
                            
                            print(f"  {timeframe}: {trades} trades, {win_rate:.1f}% win rate, ₹{avg_pnl:.0f} avg, ₹{total_pnl:.0f} total")
        
        # Gap direction analysis (UPDATED: Shows gap direction vs trade direction)
        print(f"\n📊 GAP vs TRADE DIRECTION ANALYSIS:")
        print("-" * 50)
        
        for direction in ['Up', 'Down']:
            dir_data = results_df[results_df['gap_direction'] == direction]
            if not dir_data.empty:
                print(f"\nGAP {direction.upper()} TRADES:")
                for timeframe in ['5min', '15min']:
                    tf_dir_data = dir_data[dir_data['timeframe'] == timeframe]
                    if not tf_dir_data.empty:
                        trades = len(tf_dir_data)
                        win_rate = (tf_dir_data['net_pnl'] > 0).sum() / trades * 100
                        avg_pnl = tf_dir_data['net_pnl'].mean()
                        
                        # Show trade direction breakdown
                        if 'trade_direction' in tf_dir_data.columns:
                            long_trades = len(tf_dir_data[tf_dir_data['trade_direction'] == 'LONG'])
                            short_trades = len(tf_dir_data[tf_dir_data['trade_direction'] == 'SHORT'])
                            print(f"  {timeframe}: {trades} trades ({long_trades} LONG, {short_trades} SHORT), {win_rate:.1f}% win rate, ₹{avg_pnl:.0f} avg")
                        else:
                            print(f"  {timeframe}: {trades} trades, {win_rate:.1f}% win rate, ₹{avg_pnl:.0f} avg")
        
        # Best and worst performers by timeframe
        print(f"\n🏆 TOP 5 PERFORMERS BY TIMEFRAME:")
        
        for timeframe in ['5min', '15min']:
            tf_data = results_df[results_df['timeframe'] == timeframe]
            if not tf_data.empty:
                top_5 = tf_data.nlargest(5, 'net_pnl')
                print(f"\n{timeframe.upper()} TIMEFRAME:")
                for i, (_, trade) in enumerate(top_5.iterrows(), 1):
                    print(f"  {i}. {trade['symbol']:12} ({trade['category']:<9}) | Gap: {trade['gap_pct']:+5.1f}% → P&L: ₹{trade['net_pnl']:+6.0f} ({trade['pnl_pct']:+.1f}%)")
        
        # Statistical significance test
        print(f"\n📊 STATISTICAL ANALYSIS:")
        print("-" * 40)
        
        # Calculate confidence intervals for mean P&L
        for timeframe in ['5min', '15min']:
            tf_data = results_df[results_df['timeframe'] == timeframe]
            if len(tf_data) >= 3:  # Need at least 3 samples
                mean_pnl = tf_data['net_pnl'].mean()
                std_pnl = tf_data['net_pnl'].std()
                n = len(tf_data)
                
                # 95% confidence interval
                margin_error = 1.96 * (std_pnl / np.sqrt(n))
                ci_lower = mean_pnl - margin_error
                ci_upper = mean_pnl + margin_error
                
                print(f"{timeframe}: Mean ₹{mean_pnl:.0f} (95% CI: ₹{ci_lower:.0f} to ₹{ci_upper:.0f})")
        
        # Final recommendation
        print(f"\n💡 EXPANDED TEST CONCLUSIONS:")
        print("="*40)
        
        # Find best overall timeframe
        tf_totals = results_df.groupby('timeframe')['net_pnl'].sum()
        tf_win_rates = results_df.groupby('timeframe').apply(lambda x: (x['net_pnl'] > 0).sum() / len(x) * 100)
        tf_counts = results_df.groupby('timeframe').size()
        
        best_total_tf = tf_totals.idxmax()
        best_winrate_tf = tf_win_rates.idxmax()
        most_trades_tf = tf_counts.idxmax()
        
        print(f"🏆 Best Total P&L: {best_total_tf.upper()} (₹{tf_totals[best_total_tf]:,.0f})")
        print(f"🎯 Best Win Rate: {best_winrate_tf.upper()} ({tf_win_rates[best_winrate_tf]:.1f}%)")
        print(f"📊 Most Trades: {most_trades_tf.upper()} ({tf_counts[most_trades_tf]} trades)")
        
        # Overall recommendation
        if best_total_tf == best_winrate_tf:
            print(f"\n✅ CLEAR WINNER: {best_total_tf.upper()} timeframe dominates both profit and win rate!")
        else:
            print(f"\n⚖️  MIXED RESULTS: {best_total_tf.upper()} for profit, {best_winrate_tf.upper()} for win rate")
        
        # Save comprehensive results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"expanded_timeframe_test_{timestamp}.csv"
        results_df.to_csv(filename, index=False)
        print(f"\n💾 Comprehensive results saved to: {filename}")
        
        # Save summary statistics
        summary_stats = {
            'timeframe': [],
            'total_trades': [],
            'win_rate': [],
            'total_pnl': [],
            'avg_pnl': [],
            'avg_duration': []
        }
        
        for timeframe in ['5min', '15min']:
            if timeframe in tf_totals.index:
                summary_stats['timeframe'].append(timeframe)
                summary_stats['total_trades'].append(tf_counts[timeframe])
                summary_stats['win_rate'].append(tf_win_rates[timeframe])
                summary_stats['total_pnl'].append(tf_totals[timeframe])
                summary_stats['avg_pnl'].append(tf_totals[timeframe] / tf_counts[timeframe])
                avg_dur = results_df[results_df['timeframe'] == timeframe]['duration_min'].mean()
                summary_stats['avg_duration'].append(avg_dur)
        
        summary_df = pd.DataFrame(summary_stats)
        summary_filename = f"timeframe_summary_{timestamp}.csv"
        summary_df.to_csv(summary_filename, index=False)
        print(f"📈 Summary statistics saved to: {summary_filename}")


def main():
    """Run the expanded timeframe test with parallel execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Enhanced Gap Trading Strategy - Configurable Testing')
    
    # Testing modes
    parser.add_argument('--volatile', action='store_true', 
                       help='Use top 10 most volatile stocks per category instead of comprehensive list')
    parser.add_argument('--mode', choices=['comprehensive', 'volatile', 'both'], default='comprehensive',
                       help='Testing mode: comprehensive (default), volatile, or both')
    
    # Strategy direction controls
    parser.add_argument('--gap-up-only', action='store_true',
                       help='Test only gap up trades (disable gap down)')
    parser.add_argument('--gap-down-only', action='store_true',
                       help='Test only gap down trades (disable gap up)')
    parser.add_argument('--long-only', action='store_true',
                       help='Test only long trades (disable shorts)')
    parser.add_argument('--short-only', action='store_true',
                       help='Test only short trades (disable longs)')
    
    # Feature toggles
    parser.add_argument('--no-volume-validation', action='store_true',
                       help='Disable volume confirmation requirement')
    parser.add_argument('--no-time-filters', action='store_true',
                       help='Disable time-based filters')
    parser.add_argument('--no-candle-strength', action='store_true',
                       help='Disable candle strength requirement')
    parser.add_argument('--no-dynamic-risk', action='store_true',
                       help='Disable dynamic risk management')
    
    # Pre-defined configs
    parser.add_argument('--config', choices=['conservative', 'aggressive', 'basic', 'all-features'],
                       help='Use pre-defined configuration')
    
    args = parser.parse_args()
    
    # Build configuration based on arguments
    config = {}
    
    # Direction controls
    if args.gap_up_only:
        config.update({'gap_up_enabled': True, 'gap_down_enabled': False})
    if args.gap_down_only:
        config.update({'gap_up_enabled': False, 'gap_down_enabled': True})
    if args.long_only:
        config.update({'long_trades_enabled': True, 'short_trades_enabled': False})
    if args.short_only:
        config.update({'long_trades_enabled': False, 'short_trades_enabled': True})
    
    # Feature toggles
    if args.no_volume_validation:
        config['volume_validation_enabled'] = False
    if args.no_time_filters:
        config['time_filters_enabled'] = False
    if args.no_candle_strength:
        config['candle_strength_required'] = False
    if args.no_dynamic_risk:
        config['dynamic_risk_enabled'] = False
    
    # Pre-defined configs
    if args.config == 'conservative':
        config.update({
            'gap_threshold': 1.0, 'max_gap_threshold': 3.0,
            'stop_loss_pct': -0.5, 'target_pct': 1.5,
            'min_volume_multiplier': 1.5,
            'volume_validation_enabled': True,
            'time_filters_enabled': True,
            'candle_strength_required': True,
        })
    elif args.config == 'aggressive':
        config.update({
            'gap_threshold': 0.3, 'max_gap_threshold': 8.0,
            'stop_loss_pct': -2.0, 'target_pct': 4.0,
            'min_volume_multiplier': 1.0,
            'volume_validation_enabled': False,
            'time_filters_enabled': False,
            'candle_strength_required': False,
        })
    elif args.config == 'basic':
        config.update({
            'volume_validation_enabled': False,
            'time_filters_enabled': False,
            'dynamic_risk_enabled': False,
            'candle_strength_required': False,
        })
    elif args.config == 'all-features':
        config.update({
            'volume_validation_enabled': True,
            'time_filters_enabled': True,
            'dynamic_risk_enabled': True,
            'candle_strength_required': True,
            'gap_size_scaling': True,
            'time_based_scaling': True,
        })
    
    # Create tester with configuration
    tester = ExpandedTimeframeTest(config=config if config else None)
    
    # Determine which tests to run
    test_modes = []
    if args.mode == 'comprehensive' or args.mode == 'both':
        test_modes.append(('comprehensive', False))
    if args.mode == 'volatile' or args.mode == 'both' or args.volatile:
        test_modes.append(('volatile', True))
    
    all_results = []
    
    for mode_name, use_volatile in test_modes:
        print(f"\n{'='*80}")
        print(f"🚀 RUNNING {mode_name.upper()} MODE")
        print(f"{'='*80}")
        
        results = tester.run_expanded_test(use_volatile_stocks=use_volatile)
        
        if not results.empty:
            # Add mode identifier to results
            results['test_mode'] = mode_name
            all_results.append(results)
            
            print(f"\n🎉 {mode_name.title()} test completed successfully!")
            print(f"📊 {len(results)} trades analyzed across {results['symbol'].nunique()} stocks")
            print(f"⚡ Parallel execution significantly reduced testing time")
            
            # Quick summary of timeframe performance for this mode
            print(f"\n📈 {mode_name.upper()} MODE - TIMEFRAME SUMMARY:")
            for tf in ['5min', '15min']:
                if tf in results['timeframe'].values:
                    tf_data = results[results['timeframe'] == tf]
                    trades = len(tf_data)
                    win_rate = (tf_data['net_pnl'] > 0).sum() / trades * 100
                    total_pnl = tf_data['net_pnl'].sum()
                    avg_pnl = tf_data['net_pnl'].mean()
                    print(f"  {tf:>5}: {trades:3d} trades | {win_rate:5.1f}% win rate | ₹{total_pnl:8.0f} total | ₹{avg_pnl:6.0f} avg")
        else:
            print(f"\n⚠️ No trades found in {mode_name} mode - market conditions may not have suitable gaps")
    
    # Compare modes if both were run
    if len(all_results) > 1:
        print(f"\n{'='*80}")
        print(f"📊 COMPREHENSIVE vs VOLATILE STOCKS COMPARISON")
        print(f"{'='*80}")
        
        combined_results = pd.concat(all_results, ignore_index=True)
        
        mode_comparison = combined_results.groupby(['test_mode', 'timeframe']).agg({
            'net_pnl': ['count', 'sum', 'mean'],
            'pnl_pct': 'mean'
        }).round(2)
        
        print(f"\n📈 MODE COMPARISON SUMMARY:")
        for mode in ['comprehensive', 'volatile']:
            mode_data = combined_results[combined_results['test_mode'] == mode]
            if not mode_data.empty:
                total_trades = len(mode_data)
                total_pnl = mode_data['net_pnl'].sum()
                win_rate = (mode_data['net_pnl'] > 0).sum() / total_trades * 100
                avg_pnl = mode_data['net_pnl'].mean()
                unique_stocks = mode_data['symbol'].nunique()
                
                print(f"\n{mode.upper()} MODE:")
                print(f"  📊 Total Trades: {total_trades}")
                print(f"  🏢 Unique Stocks: {unique_stocks}")
                print(f"  💰 Total P&L: ₹{total_pnl:,.0f}")
                print(f"  📈 Win Rate: {win_rate:.1f}%")
                print(f"  💵 Avg P&L: ₹{avg_pnl:.0f}")
        
        # Save combined results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        combined_filename = f"expanded_timeframe_comparison_{timestamp}.csv"
        combined_results.to_csv(combined_filename, index=False)
        print(f"\n💾 Combined results saved to: {combined_filename}")
        
        # Recommendation
        comprehensive_pnl = all_results[0]['net_pnl'].sum() if len(all_results) > 0 else 0
        volatile_pnl = all_results[1]['net_pnl'].sum() if len(all_results) > 1 else 0
        
        if volatile_pnl > comprehensive_pnl:
            print(f"\n💡 RECOMMENDATION: VOLATILE STOCKS mode shows better performance!")
            print(f"   🔥 Volatile stocks generated ₹{volatile_pnl - comprehensive_pnl:,.0f} more profit")
        elif comprehensive_pnl > volatile_pnl:
            print(f"\n💡 RECOMMENDATION: COMPREHENSIVE mode shows better performance!")
            print(f"   📊 Comprehensive approach generated ₹{comprehensive_pnl - volatile_pnl:,.0f} more profit")
        else:
            print(f"\n💡 RESULT: Both modes performed similarly")
    
    elif all_results:
        print(f"\n🏆 Check the comprehensive analysis above for definitive timeframe conclusions")
    
    print(f"\n💡 CONFIGURATION USAGE EXAMPLES:")
    print("="*50)
    print("# Test only gap up trades")
    print("python expanded_timeframe_test.py --gap-up-only --mode volatile")
    print("")
    print("# Test only gap down trades")
    print("python expanded_timeframe_test.py --gap-down-only --mode volatile")
    print("")
    print("# Test only long trades (gap ups)")
    print("python expanded_timeframe_test.py --long-only --mode volatile")
    print("")
    print("# Test only short trades (gap downs)")
    print("python expanded_timeframe_test.py --short-only --mode volatile")
    print("")
    print("# Test basic strategy without advanced features")
    print("python expanded_timeframe_test.py --config basic --mode volatile")
    print("")
    print("# Test conservative strategy")
    print("python expanded_timeframe_test.py --config conservative --mode volatile")
    print("")
    print("# Test aggressive strategy")
    print("python expanded_timeframe_test.py --config aggressive --mode volatile")
    print("")
    print("# Disable specific features")
    print("python expanded_timeframe_test.py --no-volume-validation --no-time-filters")
    print("")
    print("💡 QUICK TESTING TIPS:")
    print("  • Use --mode volatile for faster testing (30 stocks vs 250+)")
    print("  • Use --gap-up-only or --gap-down-only to isolate direction performance")
    print("  • Use --config basic to test without advanced filters")
    print("  • Combine flags: --gap-up-only --no-volume-validation --mode volatile")


if __name__ == "__main__":
    main()