#!/usr/bin/env python3
"""
Standalone Support & Resistance Trading Bot - 15min Timeframe
- Clean implementation without complex inheritance
- Identifies key support and resistance levels
- Trades bounces off these levels
- Uses 15-minute candlesticks for better signals
- Risk management with proper S&L levels
"""

import time
import numpy as np
import pandas as pd
import websocket
import json
import threading
from datetime import datetime, timedelta
from binance.um_futures import UMFutures
from config import BINANCE_API_CONFIG
import os
import logging
import re
from telegram_sender import send_telegram_message

# ANSI Color codes for terminal
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    RESET = '\033[0m'
    BG_RED = '\033[101m'
    BG_GREEN = '\033[102m'
    BG_YELLOW = '\033[103m'

# Logging setup
log_formatter = logging.Formatter('%(message)s')
log_handler = logging.FileHandler('trades.log', mode='w')
log_handler.setFormatter(log_formatter)
logger = logging.getLogger('trade_logger')
logger.addHandler(log_handler)
logger.setLevel(logging.INFO)

def strip_ansi_codes(text):
    """Removes ANSI color codes from a string."""
    return re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)

class SimpleSupportResistanceBot:
    """Simple Support & Resistance Trading Bot with 15min timeframe"""
    
    def __init__(self, api_key, api_secret, use_testnet=True):
        # API Setup
        if use_testnet:
            self.client = UMFutures(
                key=api_key,
                secret=api_secret,
                base_url="https://testnet.binancefuture.com"
            )
        else:
            self.client = UMFutures(key=api_key, secret=api_secret)
        
        self.use_testnet = use_testnet
        self.trading_symbol = "BTCUSDT"
        
        # LEVERAGE SETTING
        self.leverage = 20  # Conservative 20x leverage for S&R trading
        
        # SUPPORT/RESISTANCE SETTINGS
        self.lookback_periods = 50  # Periods to analyze for S&R levels
        self.min_touches = 2        # Minimum touches to confirm level
        self.level_threshold = 0.5  # 0.5% price difference to group levels
        self.bounce_threshold = 0.25 # 0.25% bounce to enter trade (tighter entries)
        self.max_entry_distance = 0.15  # Maximum 0.15% away from level for entry
        
        # RISK MANAGEMENT
        self.risk_reward_ratio = 2.5    # Target 2.5:1 R:R
        self.max_risk_pct = 1.5         # Max 1.5% risk per trade
        # NO MAX POSITION TIME - Let winners run for days/weeks!
        
        # Position tracking
        self.highest_profit = 0.0
        self.position_start_time = None
        self.last_profit_check = time.time()
        self.actual_position_size = 0.0
        self.position_side = None
        self.entry_reason = ""
        
        # Strategy state
        self.support_levels = []
        self.resistance_levels = []
        self.last_level_update = 0
        self.trade_count = 0
        self.session_trades = []
        self.total_pnl = 0.0
        
        # 15min candle data
        self.candle_data = []
        self.last_candle_time = 0
        
        # SIGNAL DEDUPLICATION
        self.last_signal_time = {}  # Track when each signal type was last triggered
        self.signal_cooldown = 1200  # 20 minutes cooldown per signal type (increased from 15min)
        self.last_executed_signal = None
        self.signal_execution_lock = False
        
        # TREND FILTER
        self.trend_ema_period = 20
        self.trend_direction = None
        self.trend_ema = 0.0  # Store EMA value for trend strength calculation
        
        # POSITION SIZING
        self.min_position_size = 0.01   # Minimum 0.01 BTC
        self.max_position_size = 0.1    # Maximum 0.1 BTC
        
        # Price tracking
        self.current_bid = 0.0
        self.current_ask = 0.0
        self.current_price = 0.0
        
        # WebSocket
        self.ws = None
        self.ws_thread = None
        self.running = False
        
        # Position tracking
        self.position_entry_price = 0.0
        self.position_entry_time = None
        self.last_trade_time = 0
        
        # POST-TRADE COOLDOWN to prevent immediate re-entry
        self.last_trade_close_time = 0
        self.trade_cooldown_until = 0
        
        # FAILED LEVEL TRACKING to avoid repeated failures
        self.failed_levels = {}  # Track levels that resulted in losses
        self.level_failure_cooldown = 3600  # 1 hour cooldown for failed levels
        
        # LOG SPAM PREVENTION & ENHANCED TRENDING MARKET SUPPORT  
        self.last_logged_threshold = None  # Track last logged threshold to prevent spam
        self.last_trend_message_time = 0  # Track when we last logged trend message
        self.last_ema_bounce_check = 0  # Track EMA bounce signal timing
        self.last_move_warning_time = 0  # Track when we last logged move warning
    
    def log_colored(self, message, level="info"):
        """Enhanced colored logging that also writes to a file."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        log_message = f"[{timestamp}] {message}"
        
        # Log to console with colors
        if level == "error":
            print(f"{Colors.RED}{log_message}{Colors.RESET}")
        elif level == "success":
            print(f"{Colors.GREEN}{log_message}{Colors.RESET}")
        elif level == "warning":
            print(f"{Colors.YELLOW}{log_message}{Colors.RESET}")
        elif level == "trade":
            print(f"{Colors.CYAN}{log_message}{Colors.RESET}")
        elif level == "profit":
            print(f"{Colors.BG_GREEN}{Colors.BOLD}{log_message}{Colors.RESET}")
        elif level == "loss":
            print(f"{Colors.BG_RED}{Colors.BOLD}{log_message}{Colors.RESET}")
        elif level == "level":
            print(f"{Colors.MAGENTA}{log_message}{Colors.RESET}")
        else:
            print(f"{Colors.WHITE}{log_message}{Colors.RESET}")
            
        # Log to file without colors
        logger.info(strip_ansi_codes(message))
    
    def set_leverage_safely(self, leverage: int):
        """Set leverage with proper error handling"""
        try:
            # First check if we have any open positions
            try:
                positions = self.client.get_position_risk(symbol=self.trading_symbol)
                has_positions = any(float(pos['positionAmt']) != 0 for pos in positions)
                
                if has_positions:
                    self.log_colored(f"⚠️  Open positions detected - cannot change leverage", "warning")
                    return False
            except:
                pass  # If we can't check positions, continue anyway
            
            # Try to set leverage
            response = self.client.change_leverage(
                symbol=self.trading_symbol,
                leverage=leverage
            )
            self.leverage = leverage
            self.log_colored(f"✅ Leverage set to {leverage}x for {self.trading_symbol}", "success")
            return True
            
        except Exception as e:
            error_msg = str(e)
            if "Leverage reduction is not supported" in error_msg:
                self.log_colored(f"⚠️  Cannot change leverage due to open positions", "warning")
            elif "No need to change leverage" in error_msg:
                self.log_colored(f"✅ Leverage already set to {leverage}x", "success")
                return True
            else:
                self.log_colored(f"⚠️  Leverage setting failed: {error_msg}", "warning")
            return False
    
    def get_15min_candles(self):
        """Fetch 15-minute candlestick data with retry logic"""
        max_retries = 3
        retry_delay = 5  # seconds
        
        for attempt in range(max_retries):
            try:
                # Add delay between retries
                if attempt > 0:
                    self.log_colored(f"Retry attempt {attempt+1}/{max_retries} after {retry_delay} seconds...", "warning")
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                
                klines = self.client.klines(
                    symbol=self.trading_symbol,
                    interval='15m',
                    limit=100  # Last 100 15min candles (25 hours)
                )
                
                # Validate response
                if not klines or len(klines) < 10:  # Minimum 10 candles required
                    raise ValueError(f"Insufficient candle data received: {len(klines) if klines else 0} candles")
                
                candles = []
                for kline in klines:
                    candles.append({
                        'timestamp': int(kline[0]),
                        'open': float(kline[1]),
                        'high': float(kline[2]),
                        'low': float(kline[3]),
                        'close': float(kline[4]),
                        'volume': float(kline[5])
                    })
                
                # Only update if we got valid data
                if len(candles) >= 10:
                    self.candle_data = candles
                    self.log_colored(f"✅ Successfully fetched {len(candles)} 15min candles", "success")
                    return True
                    
            except Exception as e:
                if "Max retries exceeded" in str(e) or "nodename nor servname provided" in str(e):
                    self.log_colored(f"Network error (attempt {attempt+1}/{max_retries}): {e}", "error")
                else:
                    self.log_colored(f"Error fetching candles (attempt {attempt+1}/{max_retries}): {e}", "error")
                
                # On last attempt, if we have existing data, keep using it
                if attempt == max_retries - 1 and self.candle_data:
                    self.log_colored("⚠️ Using existing candle data after failed fetches", "warning")
                    return True
                
                # If it's the last retry and we have no data, return False
                if attempt == max_retries - 1:
                    return False
        
        return False  # Should never reach here but just in case
    
    def identify_support_resistance_levels(self):
        """Identify support and resistance levels from candlestick data"""
        if len(self.candle_data) < self.lookback_periods:
            return
        
        # Extract highs and lows
        highs = [candle['high'] for candle in self.candle_data[-self.lookback_periods:]]
        lows = [candle['low'] for candle in self.candle_data[-self.lookback_periods:]]
        
        # Find local maxima (resistance) and minima (support)
        resistance_candidates = []
        support_candidates = []
        
        # Look for swing highs and lows
        for i in range(2, len(highs) - 2):
            # Resistance: high[i] > high[i-1], high[i-2] and high[i] > high[i+1], high[i+2]
            if (highs[i] > highs[i-1] and highs[i] > highs[i-2] and 
                highs[i] > highs[i+1] and highs[i] > highs[i+2]):
                resistance_candidates.append(highs[i])
            
            # Support: low[i] < low[i-1], low[i-2] and low[i] < low[i+1], low[i+2]
            if (lows[i] < lows[i-1] and lows[i] < lows[i-2] and 
                lows[i] < lows[i+1] and lows[i] < lows[i+2]):
                support_candidates.append(lows[i])
        
        # Group similar levels together
        self.resistance_levels = self._group_levels(resistance_candidates)
        self.support_levels = self._group_levels(support_candidates)
        
        # Filter levels by number of touches
        self.resistance_levels = self._filter_by_touches(self.resistance_levels, highs)
        self.support_levels = self._filter_by_touches(self.support_levels, lows)
        
        # Sort levels
        self.resistance_levels.sort(reverse=True)  # Highest first
        self.support_levels.sort(reverse=True)     # Highest first
        
        # DETAILED LOGGING OF FOUND LEVELS
        if self.resistance_levels or self.support_levels:
            self.log_colored(
                f"S&R Update: {len(self.support_levels)} Support, {len(self.resistance_levels)} Resistance levels found",
                "level"
            )
            
            # Print Support Levels
            if self.support_levels:
                print(f"\n{Colors.GREEN}🛡️  SUPPORT LEVELS FOUND:{Colors.RESET}")
                for i, level in enumerate(self.support_levels, 1):
                    if self.current_price > 0:
                        distance = ((self.current_price - level) / level) * 100
                        status = "🎯 ACTIVE" if abs(distance) <= self.bounce_threshold else "⏳ MONITORING"
                        print(f"  {Colors.GREEN}S{i}: ${level:,.2f}{Colors.RESET} | Distance: {distance:+.2f}% | {status}")
                    else:
                        print(f"  {Colors.GREEN}S{i}: ${level:,.2f}{Colors.RESET} | Distance: Waiting for price data | ⏳ MONITORING")
            
            # Print Resistance Levels  
            if self.resistance_levels:
                print(f"\n{Colors.RED}🛡️  RESISTANCE LEVELS FOUND:{Colors.RESET}")
                for i, level in enumerate(self.resistance_levels, 1):
                    if self.current_price > 0:
                        distance = ((level - self.current_price) / self.current_price) * 100
                        status = "🎯 ACTIVE" if abs(distance) <= self.bounce_threshold else "⏳ MONITORING"
                        print(f"  {Colors.RED}R{i}: ${level:,.2f}{Colors.RESET} | Distance: {distance:+.2f}% | {status}")
                    else:
                        print(f"  {Colors.RED}R{i}: ${level:,.2f}{Colors.RESET} | Distance: Waiting for price data | ⏳ MONITORING")
            
            print(f"\n{Colors.CYAN}💰 Current Price: ${self.current_price:,.2f}{Colors.RESET}")
            print(f"{Colors.YELLOW}📏 Bounce Threshold: ±{self.bounce_threshold}%{Colors.RESET}")
            print(f"{Colors.MAGENTA}════════════════════════════════════════{Colors.RESET}")
        else:
            self.log_colored("No valid S&R levels found - need more data or lower thresholds", "warning")
    
    def _group_levels(self, levels):
        """Group similar price levels together"""
        if not levels:
            return []
        
        grouped = []
        levels.sort()
        
        current_group = [levels[0]]
        
        for level in levels[1:]:
            # If within threshold, add to current group
            if abs(level - current_group[0]) / current_group[0] * 100 < self.level_threshold:
                current_group.append(level)
            else:
                # Average the group and start new group
                grouped.append(sum(current_group) / len(current_group))
                current_group = [level]
        
        # Don't forget the last group
        grouped.append(sum(current_group) / len(current_group))
        
        return grouped
    
    def _filter_by_touches(self, levels, price_data):
        """Filter levels by minimum number of touches"""
        filtered_levels = []
        
        for level in levels:
            touches = 0
            for price in price_data:
                if abs(price - level) / level * 100 < self.level_threshold:
                    touches += 1
            
            if touches >= self.min_touches:
                filtered_levels.append(level)
        
        return filtered_levels
    
    def calculate_trend_direction(self):
        """Calculate trend direction using EMA"""
        if len(self.candle_data) < self.trend_ema_period:
            self.trend_direction = None
            return
        
        # Get closing prices
        closes = [candle['close'] for candle in self.candle_data[-self.trend_ema_period:]]
        
        # Calculate EMA
        multiplier = 2 / (self.trend_ema_period + 1)
        self.trend_ema = closes[0]
        
        for price in closes[1:]:
            self.trend_ema = (price * multiplier) + (self.trend_ema * (1 - multiplier))
        
        # Determine trend with dynamic threshold based on volatility
        volatility = self._calculate_recent_volatility()
        trend_threshold = max(0.2, min(0.5, volatility * 0.5))  # 0.2% to 0.5% based on volatility
        
        if self.current_price > self.trend_ema * (1 + trend_threshold/100):
            self.trend_direction = "BULLISH"
        elif self.current_price < self.trend_ema * (1 - trend_threshold/100):
            self.trend_direction = "BEARISH"
        else:
            self.trend_direction = "NEUTRAL"
        
        self.log_colored(f"📈 Trend: {self.trend_direction} | EMA: ${self.trend_ema:,.2f} | Price: ${self.current_price:,.2f}", "level")
    
    def _calculate_recent_volatility(self):
        """Calculate recent volatility for dynamic trailing stop buffer"""
        if len(self.candle_data) < 10:
            return 0.5  # Default 0.5% buffer if insufficient data
        
        # Get last 10 candles (2.5 hours of 15min data)
        recent_candles = self.candle_data[-10:]
        
        # Calculate price changes (high-low) as percentage of close
        volatilities = []
        for candle in recent_candles:
            candle_volatility = (candle['high'] - candle['low']) / candle['close'] * 100
            volatilities.append(candle_volatility)
        
        # Use 75th percentile of recent volatility as buffer
        volatilities.sort()
        percentile_75 = volatilities[int(len(volatilities) * 0.75)]
        
        # Apply leverage adjustment (higher leverage = need more buffer)
        leverage_multiplier = min(2.0, self.leverage / 10)  # Cap at 2x adjustment
        volatility_buffer = percentile_75 * leverage_multiplier
        
        # Reasonable bounds: 0.3% to 2.0%
        volatility_buffer = max(0.3, min(2.0, volatility_buffer))
        
        return volatility_buffer
    
    def find_nearest_levels(self):
        """Find nearest support and resistance levels with EMA support for trending markets"""
        nearest_support = None
        nearest_resistance = None
        
        # Find nearest support (below current price)
        for level in self.support_levels:
            if level < self.current_price:
                if nearest_support is None or level > nearest_support:
                    nearest_support = level
        
        # Find nearest resistance (above current price)
        for level in self.resistance_levels:
            if level > self.current_price:
                if nearest_resistance is None or level < nearest_resistance:
                    nearest_resistance = level
        
        # ENHANCED: In trending markets, use EMA as dynamic support/resistance when levels aren't available
        if self.trend_direction and self.trend_ema > 0:
            ema_distance = abs(self.current_price - self.trend_ema) / self.trend_ema * 100
            
            # If EMA is close (within 1%) and we're in a strong trend, use it as dynamic level
            if ema_distance <= 1.0:
                if self.trend_direction == "BEARISH" and self.current_price < self.trend_ema:
                    # In bearish trend, EMA acts as resistance if price is below it
                    if nearest_resistance is None or self.trend_ema < nearest_resistance:
                        nearest_resistance = self.trend_ema
                elif self.trend_direction == "BULLISH" and self.current_price > self.trend_ema:
                    # In bullish trend, EMA acts as support if price is above it
                    if nearest_support is None or self.trend_ema > nearest_support:
                        nearest_support = self.trend_ema
        
        # ENHANCED: Look for broken level retests (previous support becomes resistance in bear trends)
        if self.trend_direction == "BEARISH" and nearest_resistance is None:
            # Look for broken support levels that can act as resistance on retests
            for level in self.support_levels:
                if level > self.current_price:  # Above current price (broken support)
                    level_distance = (level - self.current_price) / self.current_price * 100
                    if level_distance <= 2.0:  # Within 2% - reasonable retest distance
                        if nearest_resistance is None or level < nearest_resistance:
                            nearest_resistance = level
        
        return nearest_support, nearest_resistance
    
    def check_support_resistance_signals(self):
        """Check for support/resistance bounce signals with deduplication"""
        current_time = time.time()
        signals = []
        
        # Clean up old failed levels
        self.failed_levels = {level: fail_time for level, fail_time in self.failed_levels.items() 
                             if current_time - fail_time < self.level_failure_cooldown}
        
        # Don't open new positions if we already have one
        if self.actual_position_size != 0:
            return signals
        
        # Don't check signals if execution is locked
        if self.signal_execution_lock:
            return signals
        
        nearest_support, nearest_resistance = self.find_nearest_levels()
        
        # SUPPORT BOUNCE SIGNAL (BUY) - Enhanced for bullish trends
        if nearest_support and self.trend_direction in ["BULLISH", "NEUTRAL"]:
            # Check if this support level has failed recently
            level_failed_recently = False
            for failed_level, fail_time in self.failed_levels.items():
                if (abs(failed_level - nearest_support) / nearest_support * 100 < 0.2 and  # Within 0.2% of failed level
                    current_time - fail_time < self.level_failure_cooldown):
                    level_failed_recently = True
                    break
            
            if level_failed_recently:
                return signals  # Skip this level
            
            distance_to_support = (self.current_price - nearest_support) / nearest_support * 100
            
            # ENHANCED: More aggressive entry in strong bullish trend
            effective_threshold = self.bounce_threshold
            if self.trend_direction == "BULLISH":
                # Calculate trend strength
                ema_distance = (self.current_price - self.trend_ema) / self.trend_ema * 100
                if ema_distance > 0.5:  # Strong bullish trend
                    effective_threshold = self.bounce_threshold * 1.5  # 50% more lenient
                    
                    # PREVENT LOG SPAM: Only log when threshold changes or every 5 minutes
                    current_time = time.time()
                    should_log_threshold = (
                        self.last_logged_threshold != effective_threshold or 
                        (current_time - self.last_trend_message_time) > 300  # 5 minutes
                    )
                    
                    if should_log_threshold:
                        self.log_colored(f"🎯 Enhanced entry threshold: {effective_threshold:.2f}% (Strong bull trend)", "success")
                        self.last_logged_threshold = effective_threshold
                        self.last_trend_message_time = current_time
            
            # Check signal cooldown
            signal_key = f"support_bounce_{nearest_support:.2f}"
            last_signal_time = self.last_signal_time.get(signal_key, 0)
            
            if current_time - last_signal_time < self.signal_cooldown:
                return signals
            
            # If price is near support (within effective threshold)
            if 0 < distance_to_support <= effective_threshold:
                # Check if we've moved too much already (avoid chasing)
                recent_move = 0
                if len(self.candle_data) >= 4:
                    for i in range(1, 4):  # Check last 3 candles
                        candle = self.candle_data[-i]
                        recent_move += (candle['close'] - candle['open']) / candle['open'] * 100
                    
                    # Skip if we've already moved significantly
                    if abs(recent_move) > 0.8:  # More than 0.8% move
                        # PREVENT LOG SPAM: Only log warning every 30 seconds
                        current_time = time.time()
                        if current_time - self.last_move_warning_time > 30:
                            self.log_colored(f"⚠️ Skipping signal - Recent move too large: {recent_move:.2f}%", "warning")
                            self.last_move_warning_time = current_time
                        return signals

                # Check if price is bouncing up (recent candle shows bounce)
                if len(self.candle_data) >= 2:
                    last_candle = self.candle_data[-1]
                    prev_candle = self.candle_data[-2]
                    
                    # PRECISE Bullish conditions
                    if (last_candle['close'] > last_candle['open'] and  # Green candle
                        last_candle['low'] <= nearest_support * (1 + self.max_entry_distance/100) and  # Very close to support
                        last_candle['low'] >= nearest_support * 0.998 and  # But not broken down too much
                        last_candle['close'] > prev_candle['close'] and  # Higher close
                        last_candle['close'] > last_candle['low'] * 1.001):  # Strong bounce (closed well off lows)
                        
                        # Base confidence from distance
                        confidence = min(0.8, 1.0 - distance_to_support / self.bounce_threshold)
                        
                        # ENHANCED CONFIRMATION FACTORS
                        # 1. Volume Profile Analysis
                        bullish_volume = bearish_volume = 0
                        for i in range(1, min(4, len(self.candle_data))):
                            c = self.candle_data[-i]
                            if c['close'] > c['open']:
                                bullish_volume += c['volume']
                            else:
                                bearish_volume += c['volume']
                        
                        # For LONG entries: Want more bullish volume
                        volume_ratio = bullish_volume / (bearish_volume + 1e-10)
                        if volume_ratio > 1.2:  # 20% more bullish volume
                            confidence += 0.15
                        elif volume_ratio < 0.8:  # Too much bearish volume
                            confidence -= 0.2  # Reduce confidence significantly
                        
                        # 2. Candle strength
                        candle_range = last_candle['high'] - last_candle['low']
                        body_size = last_candle['close'] - last_candle['open']
                        if body_size > candle_range * 0.6:  # Strong bullish candle
                            confidence += 0.1  # Increased from 0.05
                        
                        # 3. Trend alignment bonus
                        if self.trend_direction == "BULLISH":
                            confidence += 0.05
                        
                        signals.append(('BUY', 'support_bounce', confidence, nearest_support, signal_key))
        
        # RESISTANCE REJECTION SIGNAL (SELL) - Enhanced for bearish trends
        if nearest_resistance and self.trend_direction in ["BEARISH", "NEUTRAL"]:
            # Check if this resistance level has failed recently
            level_failed_recently = False
            for failed_level, fail_time in self.failed_levels.items():
                if (abs(failed_level - nearest_resistance) / nearest_resistance * 100 < 0.2 and  # Within 0.2% of failed level
                    current_time - fail_time < self.level_failure_cooldown):
                    level_failed_recently = True
                    break
            
            if level_failed_recently:
                return signals  # Skip this level
            
            distance_to_resistance = (nearest_resistance - self.current_price) / self.current_price * 100
            
            # ENHANCED: More aggressive entry in strong bearish trend
            effective_threshold = self.bounce_threshold
            if self.trend_direction == "BEARISH":
                # Calculate trend strength
                ema_distance = (self.trend_ema - self.current_price) / self.trend_ema * 100
                if ema_distance > 0.5:  # Strong bearish trend
                    effective_threshold = self.bounce_threshold * 1.5  # 50% more lenient
                    
                    # PREVENT LOG SPAM: Only log when threshold changes or every 5 minutes
                    current_time = time.time()
                    should_log_threshold = (
                        self.last_logged_threshold != effective_threshold or 
                        (current_time - self.last_trend_message_time) > 300  # 5 minutes
                    )
                    
                    if should_log_threshold:
                        self.log_colored(f"🎯 Enhanced entry threshold: {effective_threshold:.2f}% (Strong bear trend)", "success")
                        self.last_logged_threshold = effective_threshold
                        self.last_trend_message_time = current_time
            
            # Check signal cooldown
            signal_key = f"resistance_rejection_{nearest_resistance:.2f}"
            last_signal_time = self.last_signal_time.get(signal_key, 0)
            
            if current_time - last_signal_time < self.signal_cooldown:
                return signals
            
            # ENHANCED: Check previous price action
            if 0 < distance_to_resistance <= effective_threshold:
                # Check if we've moved too much already (avoid chasing)
                recent_move = 0
                if len(self.candle_data) >= 4:
                    for i in range(1, 4):  # Check last 3 candles
                        candle = self.candle_data[-i]
                        recent_move += (candle['close'] - candle['open']) / candle['open'] * 100
                    
                    # Skip if we've already moved significantly
                    if abs(recent_move) > 0.8:  # More than 0.8% move
                        # PREVENT LOG SPAM: Only log warning every 30 seconds
                        current_time = time.time()
                        if current_time - self.last_move_warning_time > 30:
                            self.log_colored(f"⚠️ Skipping signal - Recent move too large: {recent_move:.2f}%", "warning")
                            self.last_move_warning_time = current_time
                        return signals
                # Check if price is rejecting resistance (recent candle shows rejection)
                if len(self.candle_data) >= 2:
                    last_candle = self.candle_data[-1]
                    prev_candle = self.candle_data[-2]
                    
                    # PRECISE Bearish conditions
                    if (last_candle['close'] < last_candle['open'] and  # Red candle
                        last_candle['high'] >= nearest_resistance * 0.998 and  # Must test resistance
                        last_candle['high'] <= nearest_resistance * (1 + self.max_entry_distance/100) and  # But not too far above
                        last_candle['close'] < prev_candle['close'] and  # Lower close
                        last_candle['close'] < last_candle['high'] * 0.998 and  # Strong rejection
                        last_candle['close'] <= last_candle['low'] * 1.002):  # Closed near lows
                        
                        # Base confidence from distance
                        confidence = min(0.8, 1.0 - distance_to_resistance / self.bounce_threshold)
                        
                        # ENHANCED CONFIRMATION FACTORS
                        # 1. Volume Profile Analysis
                        bullish_volume = bearish_volume = 0
                        for i in range(1, min(4, len(self.candle_data))):
                            c = self.candle_data[-i]
                            if c['close'] > c['open']:
                                bullish_volume += c['volume']
                            else:
                                bearish_volume += c['volume']
                        
                        # For SHORT entries: Want more bearish volume
                        volume_ratio = bearish_volume / (bullish_volume + 1e-10)
                        if volume_ratio > 1.2:  # 20% more bearish volume
                            confidence += 0.15
                        elif volume_ratio < 0.8:  # Too much bullish volume
                            confidence -= 0.2  # Reduce confidence significantly
                        
                        # 2. Candle strength
                        candle_range = last_candle['high'] - last_candle['low']
                        body_size = abs(last_candle['close'] - last_candle['open'])
                        if body_size > candle_range * 0.6:  # Strong bearish candle
                            confidence += 0.1  # Increased from 0.05
                        
                        # 3. Trend alignment bonus
                        if self.trend_direction == "BEARISH":
                            confidence += 0.05
                        
                        signals.append(('SELL', 'resistance_rejection', confidence, nearest_resistance, signal_key))
        
        # ENHANCED: EMA BOUNCE SIGNALS for trending markets (when S/R levels aren't available)
        if (self.trend_direction in ["BULLISH", "BEARISH"] and 
            self.trend_ema > 0 and 
            len(signals) == 0 and  # Only if no S/R signals found
            current_time - self.last_ema_bounce_check > 300):  # Check every 5 minutes
            
            ema_distance = abs(self.current_price - self.trend_ema) / self.trend_ema * 100
            
            # EMA BULLISH BOUNCE (price dips to EMA in uptrend)
            if (self.trend_direction == "BULLISH" and 
                self.current_price > self.trend_ema * 0.995 and  # Close to EMA (within 0.5%)
                self.current_price < self.trend_ema * 1.005 and
                len(self.candle_data) >= 3):
                
                last_candle = self.candle_data[-1]
                prev_candle = self.candle_data[-2]
                
                # Look for bullish bounce signals
                if (last_candle['close'] > last_candle['open'] and  # Green candle
                    last_candle['low'] <= self.trend_ema * 1.002 and  # Touched EMA
                    last_candle['close'] > prev_candle['close']):  # Higher close
                    
                    confidence = 0.75  # Good confidence for EMA bounces in trends
                    signal_key = f"ema_bounce_bullish_{self.trend_ema:.2f}"
                    
                    self.log_colored(f"📈 EMA BOUNCE SIGNAL: Bullish bounce off EMA {self.trend_ema:.2f} (confidence: {confidence:.2f})", "success")
                    signals.append(('BUY', 'ema_bounce', confidence, self.trend_ema, signal_key))
                    self.last_ema_bounce_check = current_time
            
            # EMA BEARISH REJECTION (price rallies to EMA in downtrend)  
            elif (self.trend_direction == "BEARISH" and
                  self.current_price < self.trend_ema * 1.005 and  # Close to EMA (within 0.5%)
                  self.current_price > self.trend_ema * 0.995 and
                  len(self.candle_data) >= 3):
                
                last_candle = self.candle_data[-1]
                prev_candle = self.candle_data[-2]
                
                # Look for bearish rejection signals
                if (last_candle['close'] < last_candle['open'] and  # Red candle
                    last_candle['high'] >= self.trend_ema * 0.998 and  # Tested EMA
                    last_candle['close'] < prev_candle['close']):  # Lower close
                    
                    confidence = 0.75  # Good confidence for EMA rejections in trends
                    signal_key = f"ema_rejection_bearish_{self.trend_ema:.2f}"
                    
                    self.log_colored(f"📉 EMA REJECTION SIGNAL: Bearish rejection at EMA {self.trend_ema:.2f} (confidence: {confidence:.2f})", "success")
                    signals.append(('SELL', 'ema_rejection', confidence, self.trend_ema, signal_key))
                    self.last_ema_bounce_check = current_time
        
        return signals
    
    def execute_trade(self, side: str, size: float) -> bool:
        """Execute trade with proper position tracking"""
        try:
            size = round(size, 3)
            
            # Prevent multiple positions in same direction
            if side == "BUY" and self.actual_position_size > 0:
                self.log_colored(f"⚠️  Already LONG {self.actual_position_size} BTC - Skipping BUY", "warning")
                return False
            elif side == "SELL" and self.actual_position_size < 0:
                self.log_colored(f"⚠️  Already SHORT {abs(self.actual_position_size)} BTC - Skipping SELL", "warning")
                return False
            
            if side == "BUY":
                order = self.client.new_order(
                    symbol=self.trading_symbol,
                    side='BUY',
                    type='MARKET',
                    quantity=size
                )
                self.actual_position_size = size
                self.position_side = 'LONG'
                
            elif side == "SELL":
                order = self.client.new_order(
                    symbol=self.trading_symbol,
                    side='SELL', 
                    type='MARKET',
                    quantity=size
                )
                self.actual_position_size = -size
                self.position_side = 'SHORT'
                
            elif side == "CLOSE":
                if self.actual_position_size > 0:  # Close long
                    order = self.client.new_order(
                        symbol=self.trading_symbol,
                        side='SELL',
                        type='MARKET',
                        quantity=self.actual_position_size
                    )
                elif self.actual_position_size < 0:  # Close short
                    order = self.client.new_order(
                        symbol=self.trading_symbol,
                        side='BUY',
                        type='MARKET',
                        quantity=abs(self.actual_position_size)
                    )
                
                self.actual_position_size = 0.0
                self.position_side = None
            
            order_id = order.get('orderId', 'Unknown')
            fill_price = order.get('fills', [{}])[0].get('price', '0.00') if order.get('fills') else '0.00'
            
            self.log_colored(
                f"TESTNET ORDER: {side} {size} BTC @ ${float(fill_price):,.2f} (ID: {order_id})", 
                "success"
            )
            
            # Update internal tracking
            if side in ['BUY', 'SELL']:
                self.position_entry_price = self.current_price
                self.position_entry_time = time.time()
                self.last_trade_time = time.time()
                
                self.session_trades.append({
                    'side': side,
                    'size': size,
                    'price': self.current_price,
                    'time': time.time(),
                    'order_id': order_id,
                    'reason': self.entry_reason
                })
            
            return True
                    
        except Exception as e:
            self.log_colored(f"Trade execution error: {e}", "error")
            return False
    
    def calculate_position_pnl(self):
        """Calculate current position P&L percentage with leverage"""
        if self.actual_position_size == 0 or self.position_entry_price == 0:
            return 0.0
        
        if self.actual_position_size > 0:  # Long position
            pnl_pct = ((self.current_price - self.position_entry_price) / self.position_entry_price) * 100
        else:  # Short position
            pnl_pct = ((self.position_entry_price - self.current_price) / self.position_entry_price) * 100
        
        return pnl_pct * self.leverage
    
    def should_close_position(self):
        """Enhanced S&R position management with volatility-aware trailing"""
        if self.actual_position_size == 0:
            return False, "No position"
        
        current_pnl_pct = self.calculate_position_pnl()
        current_time = time.time()
        hold_time = current_time - self.position_start_time if self.position_start_time else 0
        
        # Update highest profit
        if current_pnl_pct > self.highest_profit:
            self.highest_profit = current_pnl_pct
        
        # 1. HARD STOP LOSS
        if current_pnl_pct <= -self.max_risk_pct:
            return True, f"🛑 STOP LOSS: {current_pnl_pct:.2f}%"
        
        # 2. PROFIT TARGET (Risk:Reward based)
        target_profit = self.max_risk_pct * self.risk_reward_ratio
        if current_pnl_pct >= target_profit:
            return True, f"🎯 PROFIT TARGET: {current_pnl_pct:.2f}%"
        
        # 3. LEVEL BREAKOUT (Stop loss if support/resistance breaks significantly)
        nearest_support, nearest_resistance = self.find_nearest_levels()
        
        if self.actual_position_size > 0:  # Long position
            if nearest_support:
                # Use more conservative breakout threshold for profitable trades
                breakout_threshold = 0.99 if current_pnl_pct < target_profit * 0.5 else 0.985  # 1% vs 1.5% breakout
                if self.current_price < nearest_support * breakout_threshold:
                    return True, f"💥 SUPPORT BROKEN: {current_pnl_pct:.2f}%"
        else:  # Short position
            if nearest_resistance:
                # Use more conservative breakout threshold for profitable trades
                breakout_threshold = 1.01 if current_pnl_pct < target_profit * 0.5 else 1.015  # 1% vs 1.5% breakout
                if self.current_price > nearest_resistance * breakout_threshold:
                    return True, f"💥 RESISTANCE BROKEN: {current_pnl_pct:.2f}%"
        
        # 4A. BREAKEVEN PROTECTION - Critical fix for profitable trades becoming losers
        if self.highest_profit > target_profit * 0.4:  # If we reached 40%+ of target profit
            # Never let profitable trades become big losers
            breakeven_stop = max(-0.1, self.highest_profit * 0.2)  # Keep at least 20% of peak or -0.1% max loss
            if current_pnl_pct <= breakeven_stop:
                return True, f"🛡️ BREAKEVEN PROTECTION: {current_pnl_pct:.2f}% (peak: {self.highest_profit:.2f}%)"
        
        # 4B. VOLATILITY-AWARE TRAILING STOP (much more conservative)
        if current_pnl_pct > target_profit * 0.65:  # Start trailing after 65% of target reached
            # Calculate recent volatility for dynamic trailing distance
            volatility_buffer = self._calculate_recent_volatility()
            
            # More conservative: keep 80% of highest profit + volatility buffer
            trailing_stop_loss = self.highest_profit * 0.8 - volatility_buffer
            
            # ENHANCED: Near target trailing (90%+)
            if self.highest_profit >= target_profit * 0.9:  # Very close to target
                trailing_stop_loss = max(
                    trailing_stop_loss,
                    self.highest_profit * 0.9  # Keep 90% of profit when near target
                )
            
            if current_pnl_pct <= trailing_stop_loss:
                return True, f"📉 VOLATILITY TRAILING: {current_pnl_pct:.2f}% (peak: {self.highest_profit:.2f}%, buffer: {volatility_buffer:.2f}%)"
        
        # 4C. EARLY TRAILING for significant profits (address Trade 2 scenario)
        elif current_pnl_pct > target_profit * 0.3 and self.highest_profit > target_profit * 0.6:
            # If we reached 60%+ of target but pulled back significantly
            early_trailing_stop = self.highest_profit * 0.7  # Keep 70% of peak profit (was 50%)
            if current_pnl_pct <= early_trailing_stop:
                return True, f"🔄 EARLY TRAILING: {current_pnl_pct:.2f}% (peak: {self.highest_profit:.2f}%)"
        
        # 5. ENHANCED TREND REVERSAL EXIT
        if self.trend_direction:
            # Base conditions for trend reversal exit
            trend_against_position = (
                (self.actual_position_size > 0 and self.trend_direction == "BEARISH") or
                (self.actual_position_size < 0 and self.trend_direction == "BULLISH")
            )
            
            if trend_against_position:
                # More aggressive exit if in loss
                if current_pnl_pct < 0:
                    return True, f"📊 TREND REVERSAL (Loss): {current_pnl_pct:.2f}% (trend: {self.trend_direction})"
                
                # Conservative exit for profitable trades
                elif current_pnl_pct < target_profit * 0.75:  # Below 75% of target
                    # Only exit if we've pulled back from peak
                    if current_pnl_pct < self.highest_profit * 0.7:  # Lost 30% of peak profit
                        return True, f"📊 TREND REVERSAL (Profit Pullback): {current_pnl_pct:.2f}% (peak: {self.highest_profit:.2f}%)"
        
        # 6. IMPROVED TIMEOUT LOGIC - Consider peak profit, not just current P&L
        if self.highest_profit <= 0 and current_pnl_pct < 0:
            # Only apply timeout if trade was NEVER profitable
            if hold_time > 1200:
                return True, f"⏰ LOSS TIMEOUT: {current_pnl_pct:.2f}% ({hold_time/60:.1f}min)"
        elif self.highest_profit > 0 and current_pnl_pct < 0:
            # Trade was profitable but now losing - apply breakeven protection
            if hold_time > 1800:  # 30 minutes for previously profitable trades
                return True, f"⏰ PROFIT PROTECTION TIMEOUT: {current_pnl_pct:.2f}% (peak: {self.highest_profit:.2f}%) ({hold_time/60:.1f}min)"
        elif current_pnl_pct < target_profit * 0.25:  # Less than 25% of target
            # Break-even/small profit: 45 minutes max
            if hold_time > 2700:
                return True, f"⏰ BREAKEVEN TIMEOUT: {current_pnl_pct:.2f}% ({hold_time/60:.1f}min)"
        # NO TIME LIMITS FOR PROFITABLE TRADES - LET WINNERS RUN!
        # Profitable trades will only exit on:
        # - Profit target hit
        # - Support/Resistance level broken  
        # - Trailing stop triggered
        # - Trend reversal (if not too profitable)
        
        return False, f"Hold: {current_pnl_pct:.2f}% ({hold_time/60:.1f}min)"
    
    def execute_sr_trade(self, action, signal_type, confidence, level):
        """Execute support/resistance trade with improved position sizing"""
        
        # IMPROVED POSITION SIZING FOR $5K ACCOUNT
        if action == "BUY":
            # Stop loss below support level
            stop_loss_price = level * 0.995  # 0.5% below support
            risk_per_unit = (self.current_price - stop_loss_price) / self.current_price
        else:  # SELL
            # Stop loss above resistance level  
            stop_loss_price = level * 1.005  # 0.5% above resistance
            risk_per_unit = (stop_loss_price - self.current_price) / self.current_price
        
        # DYNAMIC Position sizing based on confidence
        account_balance = 5000  # $5k account
        base_risk_pct = self.max_risk_pct * confidence  # Scale risk by confidence
        risk_amount = account_balance * (base_risk_pct / 100)
        
        # Calculate position size
        position_value = risk_amount / risk_per_unit
        position_size = position_value / self.current_price
        
        # IMPROVED POSITION LIMITS: 0.01 to 0.1 BTC (larger meaningful trades)
        position_size = round(max(min(position_size, self.max_position_size), self.min_position_size), 4)
        
        self.entry_reason = f"{signal_type} @ {level:,.2f} (conf: {confidence*100:.1f}%)"
        
        success = self.execute_trade(action, position_size)
        
        if success:
            self.position_start_time = time.time()
            self.highest_profit = 0.0
            self.trade_count += 1

            trade_message = f"🎯 {signal_type.upper()} | {action} {position_size} BTC @ ${self.current_price:,.2f} | Level: ${level:,.2f} | Conf: {confidence*100:.1f}% | Trend: {self.trend_direction}"
            self.log_colored(trade_message, "trade")
            send_telegram_message(strip_ansi_codes(trade_message))

            # Log position sizing details
            risk_message = f"💰 Risk: ${risk_amount:.2f} ({base_risk_pct:.2f}%) | Stop: ${stop_loss_price:,.2f} | R/R: {self.risk_reward_ratio}:1"
            self.log_colored(risk_message, "success")
            send_telegram_message(strip_ansi_codes(risk_message))
        
        return success
    
    def close_position(self, reason):
        """Close position and track performance"""
        if self.actual_position_size == 0:
            return
        
        try:
            position_size = abs(self.actual_position_size)
            final_pnl = self.calculate_position_pnl()
            
            if self.execute_trade("CLOSE", position_size):
                close_message = f"CLOSED: {reason} | P&L: {final_pnl:+.2f}%"
                log_level = "profit" if final_pnl > 0 else "loss"
                self.log_colored(close_message, log_level)
                send_telegram_message(strip_ansi_codes(close_message))

                self.total_pnl += final_pnl
                
                # Track failed levels for future avoidance
                if final_pnl < 0 and self.entry_reason:
                    # Extract the level from entry reason if it's a resistance/support trade
                    if "resistance_rejection" in self.entry_reason or "support_bounce" in self.entry_reason:
                        try:
                            # Extract level from entry reason (format: "resistance_rejection @ 107445.88")
                            level_str = self.entry_reason.split("@ ")[1].split(" ")[0]
                            failed_level = float(level_str.replace(",", ""))
                            self.failed_levels[failed_level] = time.time()
                            self.log_colored(f"🚫 Level ${failed_level:,.2f} marked as failed for {self.level_failure_cooldown/3600:.1f} hours", "warning")
                        except:
                            pass  # If parsing fails, just continue
                
                # Reset tracking
                self.position_entry_price = 0
                self.position_entry_time = None
                self.highest_profit = 0.0
                self.position_start_time = None
                self.entry_reason = ""
                
                # ADD POST-TRADE COOLDOWN
                self.last_trade_close_time = time.time()
                cooldown_minutes = 15 if final_pnl > 0 else 10  # Longer cooldown for profitable trades
                self.trade_cooldown_until = self.last_trade_close_time + (cooldown_minutes * 60)
                self.log_colored(f"🕒 Trade cooldown active for {cooldown_minutes} minutes", "warning")
                
        except Exception as e:
            self.log_colored(f"Error closing position: {e}", "error")
    
    def on_message(self, ws, message):
        """Handle WebSocket messages"""
        try:
            data = json.loads(message)
            
            # Handle ticker price updates
            if 'c' in data:  # 24hr ticker
                self.current_price = float(data['c'])
            elif 'b' in data and 'a' in data:  # Book ticker
                self.current_bid = float(data['b'])
                self.current_ask = float(data['a'])
                self.current_price = (self.current_bid + self.current_ask) / 2
                
        except Exception as e:
            self.log_colored(f"Error processing WebSocket message: {e}", "error")
    
    def on_error(self, ws, error):
        """Handle WebSocket errors"""
        self.log_colored(f"WebSocket error: {error}", "error")
    
    def on_close(self, ws, close_status_code, close_msg):
        """Handle WebSocket close"""
        self.log_colored("WebSocket connection closed", "warning")
    
    def on_open(self, ws):
        """Handle WebSocket open"""
        self.log_colored("WebSocket connected successfully", "success")
    
    def start_websocket(self):
        """Start WebSocket connection for real-time price updates"""
        try:
            if self.use_testnet:
                ws_url = f"wss://stream.binancefuture.com/ws/{self.trading_symbol.lower()}@bookTicker"
            else:
                ws_url = f"wss://fstream.binance.com/ws/{self.trading_symbol.lower()}@bookTicker"
            
            self.ws = websocket.WebSocketApp(
                ws_url,
                on_message=self.on_message,
                on_error=self.on_error,
                on_close=self.on_close,
                on_open=self.on_open
            )
            
            self.ws_thread = threading.Thread(target=self.ws.run_forever)
            self.ws_thread.daemon = True
            self.ws_thread.start()
            
            self.log_colored("WebSocket thread started", "success")
            
        except Exception as e:
            self.log_colored(f"Error starting WebSocket: {e}", "error")
    
    def run_strategy(self):
        """Main strategy loop"""
        self.running = True
        
        # Initial setup
        self.log_colored("Setting up Support & Resistance Bot...", "success")
        
        # Set leverage
        self.set_leverage_safely(self.leverage)
        
        # Start WebSocket for real-time prices
        self.start_websocket()
        
        # Wait for initial price data from WebSocket
        self.log_colored("Waiting for real-time price data...", "success")
        wait_count = 0
        while self.current_price == 0 and wait_count < 10:
            time.sleep(1)
            wait_count += 1
        
        if self.current_price == 0:
            self.log_colored("⚠️  No real-time price data received, using candle data", "warning")
        else:
            self.log_colored(f"✅ Real-time price: ${self.current_price:,.2f}", "success")
        
        # Get initial candle data
        if not self.get_15min_candles():
            self.log_colored("Failed to get initial candle data", "error")
            return
        
        self.log_colored("🚀 Support & Resistance Bot started!", "success")
        
        try:
            while self.running:
                current_time = time.time()
                
                # Update candle data every 15 minutes
                if current_time - self.last_candle_time > 60:  # Check every minute for new candle
                    if self.get_15min_candles():
                        self.last_candle_time = current_time
                        # Calculate trend after getting new candles
                        self.calculate_trend_direction()
                
                # Update S&R levels every 5 minutes
                if current_time - self.last_level_update > 300:
                    self.identify_support_resistance_levels()
                    self.last_level_update = current_time
                
                # Check if we should close existing position
                if self.actual_position_size != 0:
                    should_close, reason = self.should_close_position()
                    
                    if should_close:
                        self.close_position(reason)
                        continue
                    
                    # Log position status
                    if time.time() - self.last_profit_check > 10:
                        current_pnl = self.calculate_position_pnl()
                        hold_time = time.time() - self.position_start_time if self.position_start_time else 0
                        target_profit = self.max_risk_pct * self.risk_reward_ratio
                        
                        # Calculate trailing stop status
                        trailing_info = ""
                        if current_pnl > target_profit * 0.4:  # Show trailing info when we're getting close
                            volatility_buffer = self._calculate_recent_volatility()
                            
                            if current_pnl > target_profit * 0.65:
                                trailing_stop = self.highest_profit * 0.8 - volatility_buffer
                                trailing_info = f" | 📉Trail: {trailing_stop:.2f}% (buf: {volatility_buffer:.2f}%)"
                            elif self.highest_profit > target_profit * 0.8:
                                emergency_stop = self.highest_profit * 0.65
                                trailing_info = f" | 🚨Emergency: {emergency_stop:.2f}%"
                            else:
                                progress = (current_pnl / target_profit) * 100
                                trailing_info = f" | 📊Progress: {progress:.0f}% to trailing"
                        
                        # Add "letting it run" indicator for long-term profitable trades
                        time_display = f"{hold_time/60:.1f}min"
                        if current_pnl >= target_profit * 0.25 and hold_time > 3600:  # Profitable & >1 hour
                            hours = hold_time / 3600
                            time_display = f"{hours:.1f}h 🚀 LETTING IT RUN!"
                        
                        if current_pnl > 0:
                            self.log_colored(
                                f"Position: {Colors.GREEN}{current_pnl:.2f}%{Colors.RESET} | Peak: {self.highest_profit:.2f}% | {self.position_side} {abs(self.actual_position_size):.3f} BTC | {time_display}{trailing_info}", 
                                "profit"
                            )
                        else:
                            self.log_colored(
                                f"Position: {Colors.RED}{current_pnl:.2f}%{Colors.RESET} | Peak: {self.highest_profit:.2f}% | {self.position_side} {abs(self.actual_position_size):.3f} BTC | {time_display}{trailing_info}", 
                                "loss"
                            )
                        self.last_profit_check = time.time()
                    
                    time.sleep(1)
                    continue
                
                # CHECK POST-TRADE COOLDOWN before looking for new signals
                if time.time() < self.trade_cooldown_until:
                    remaining_cooldown = (self.trade_cooldown_until - time.time()) / 60
                    if int(time.time()) % 30 == 0:  # Log every 30 seconds
                        self.log_colored(f"🕒 Trade cooldown active: {remaining_cooldown:.1f} minutes remaining", "warning")
                    time.sleep(1)
                    continue
                
                # Check for new S&R signals
                signals = self.check_support_resistance_signals()
                
                # Enhanced logging when no signals found (every 2 minutes)
                if len(signals) == 0 and int(current_time) % 120 == 0:
                    nearest_support, nearest_resistance = self.find_nearest_levels()
                    
                    status_parts = []
                    if self.trend_direction:
                        status_parts.append(f"Trend: {self.trend_direction}")
                    if nearest_support:
                        support_dist = (self.current_price - nearest_support) / nearest_support * 100
                        status_parts.append(f"Support: ${nearest_support:.2f} ({support_dist:+.2f}%)")
                    if nearest_resistance:
                        resistance_dist = (nearest_resistance - self.current_price) / self.current_price * 100
                        status_parts.append(f"Resistance: ${nearest_resistance:.2f} (+{resistance_dist:.2f}%)")
                    if self.trend_ema > 0:
                        ema_dist = (self.current_price - self.trend_ema) / self.trend_ema * 100
                        status_parts.append(f"EMA: ${self.trend_ema:.2f} ({ema_dist:+.2f}%)")
                    
                    status = " | ".join(status_parts) if status_parts else "No levels detected"
                    self.log_colored(f"🔍 No signals | Price: ${self.current_price:,.2f} | {status}", "info")
                
                for signal in signals:
                    action, signal_type, confidence, level, signal_key = signal
                    
                    # Only trade high confidence signals (70%+ instead of 60%+)
                    if confidence >= 0.7:
                        print(f"\n{Colors.BG_GREEN}{Colors.BOLD}🚨 TRADE SIGNAL TRIGGERED! 🚨{Colors.RESET}")
                        
                        # LOCK SIGNAL EXECUTION to prevent duplicates
                        self.signal_execution_lock = True
                        
                        success = self.execute_sr_trade(action, signal_type, confidence, level)
                        
                        if success:
                            # Record this signal to prevent duplicates
                            self.last_signal_time[signal_key] = current_time
                            self.last_executed_signal = signal_key
                            self.log_colored(f"🔒 Signal {signal_key} locked for {self.signal_cooldown/60:.0f} minutes", "warning")
                        
                        # Unlock after execution attempt
                        self.signal_execution_lock = False
                        break  # Only take one trade at a time
                
                time.sleep(1)  # Main loop delay
                
        except KeyboardInterrupt:
            self.log_colored("🛑 Support & Resistance bot stopped by user", "warning")
            if self.actual_position_size != 0:
                self.close_position("Manual Stop")
        except Exception as e:
            self.log_colored(f"Error in main loop: {e}", "error")
        finally:
            self.running = False
            if self.ws:
                self.ws.close()

def run_simple_support_resistance_bot():
    """Run the simple support & resistance trading bot"""
    
    # Clear terminal and show header
    os.system('clear' if os.name == 'posix' else 'cls')
    
    print(f"""
{Colors.BOLD}{Colors.BLUE}📊 SIMPLE SUPPORT & RESISTANCE BOT{Colors.RESET}
{Colors.BLUE}{'=' * 55}{Colors.RESET}
{Colors.GREEN}📈 Timeframe: 15 minutes{Colors.RESET}
{Colors.CYAN}🎯 Strategy: S&R Level Bounces{Colors.RESET}
{Colors.YELLOW}💰 Risk/Reward: 1:2.5{Colors.RESET}
{Colors.RED}🛑 Max Risk: 1.5% per trade{Colors.RESET}
{Colors.MAGENTA}⚡ Leverage: 20x{Colors.RESET}
{Colors.WHITE}📊 Lookback: 50 periods (12.5 hours){Colors.RESET}
{Colors.CYAN}🔍 Min Touches: 2 per level{Colors.RESET}
{Colors.BG_GREEN}{Colors.BOLD}🌐 REAL BINANCE TESTNET{Colors.RESET}
{Colors.BG_YELLOW}{Colors.BOLD}💼 Account Size: $5,000{Colors.RESET}
{Colors.CYAN}{Colors.BOLD}📉 VOLATILITY-AWARE TRAILING{Colors.RESET}
{Colors.MAGENTA}{Colors.BOLD}🚀 LETS WINNERS RUN FOR DAYS/WEEKS!{Colors.RESET}
    """)
    
    # Get testnet credentials
    testnet_config = BINANCE_API_CONFIG['testnet']
    
    # Create bot instance
    bot = SimpleSupportResistanceBot(
        api_key=testnet_config['api_key'],
        api_secret=testnet_config['api_secret'], 
        use_testnet=True
    )
    
    try:
        bot.run_strategy()
        
        # Show session summary
        print(f"""
{Colors.BOLD}{Colors.BLUE}📊 SESSION SUMMARY{Colors.RESET}
{Colors.BLUE}{'=' * 35}{Colors.RESET}
{Colors.WHITE}Total Trades: {len(bot.session_trades)}{Colors.RESET}
{Colors.GREEN if bot.total_pnl > 0 else Colors.RED}Total P&L: {bot.total_pnl:+.2f}%{Colors.RESET}
{Colors.CYAN}Support Levels: {len(bot.support_levels)}{Colors.RESET}
{Colors.MAGENTA}Resistance Levels: {len(bot.resistance_levels)}{Colors.RESET}
        """)
        
    except Exception as e:
        print(f"\n{Colors.RED}❌ Error: {e}{Colors.RESET}")

if __name__ == "__main__":
    run_simple_support_resistance_bot()
