#!/usr/bin/env python3
"""
HIGH VOLATILITY TREND RIDING SCANNER
====================================

STRATEGIC FRAMEWORK:
===================

1. VOLATILITY DETECTION METHODOLOGY:
   - VOLUME SPIKE: >150% above 20-day average volume
   - ATR BREAKOUT: Current ATR > 1.5x 14-day ATR average
   - PRICE VOLATILITY: Daily price range >3% from previous close
   - MOMENTUM CONFIRMATION: RSI between 30-70 (avoid extremes)

2. TREND RIDING STRATEGY:
   - ENTRY: Volatility spike + trend confirmation + volume surge
   - EXIT: RSI extreme (>75 or <25) OR volatility cooling down
   - STOP LOSS: 2x ATR below entry price (dynamic)
   - TAKE PROFIT: 3x ATR above entry price (risk-reward 1:1.5)

3. TIMEFRAME OPTIMIZATION:
   - PRIMARY: 15-minute for entry/exit timing
   - SECONDARY: 1-hour for trend confirmation
   - TERTIARY: Daily for overall market context

4. RISK MANAGEMENT:
   - MAX POSITION SIZE: 2% of capital per trade
   - MAX CONCURRENT POSITIONS: 3-5 stocks
   - VOLATILITY COOL-DOWN: Exit if volume drops <50% of spike level

5. TRADINGVIEW INTEGRATION:
   - Use tradingview-screener for real-time volatility scanning
   - Cross-reference with Upstox for execution compatibility
   - Leverage TradingView's 3000+ technical indicators

IMPLEMENTATION PHASES:
=====================
Phase 1: TradingView volatility screener integration
Phase 2: Upstox data validation and execution setup
Phase 3: Real-time entry/exit signal generation
Phase 4: Risk management and position sizing automation

This scanner focuses on MOMENTUM CAPTURE during volatility spikes
rather than traditional breakout patterns, optimizing for quick
trend-riding opportunities with defined risk parameters.
"""

import time
import json
import numpy as np
import pandas as pd
import threading
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional, Any
import logging
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
import os

# Core imports
from free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG, TELEGRAM_CONFIG

# Optional imports for enhanced functionality
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    print("⚠️ requests library not available - Telegram alerts disabled")

try:
    from tradingview_screener import Query, col
    TRADINGVIEW_SCREENER_AVAILABLE = True
    print("✅ TradingView screener library available")
except ImportError:
    TRADINGVIEW_SCREENER_AVAILABLE = False
    print("⚠️ tradingview-screener not available - install with: pip install tradingview-screener")

try:
    from tradingview_ta import TA_Handler, Interval, Exchange
    TRADINGVIEW_TA_AVAILABLE = True
    print("✅ TradingView technical analysis library available")
except ImportError:
    TRADINGVIEW_TA_AVAILABLE = False
    print("⚠️ tradingview-ta not available - install with: pip install tradingview-ta")

# Enhanced logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('volatility_trend_scanner.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('VolatilityTrendScanner')

@dataclass
class VolatilitySignal:
    """Data class for high volatility trend riding signals"""
    symbol: str
    price: float
    volume: int
    volume_ratio: float  # Current volume / 20-day average
    atr_current: float
    atr_ratio: float  # Current ATR / 14-day ATR average
    daily_volatility: float  # Daily price range %
    rsi: float
    trend_direction: str  # 'BULLISH', 'BEARISH', 'NEUTRAL'
    signal_type: str  # 'VOLATILITY_BREAKOUT', 'TREND_ACCELERATION', 'MOMENTUM_SURGE'
    confidence: float  # Signal confidence (0-1)
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward_ratio: float
    timestamp: datetime
    timeframe: str
    sector: str = ""
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'symbol': self.symbol,
            'price': self.price,
            'volume': self.volume,
            'volume_ratio': self.volume_ratio,
            'atr_current': self.atr_current,
            'atr_ratio': self.atr_ratio,
            'daily_volatility': self.daily_volatility,
            'rsi': self.rsi,
            'trend_direction': self.trend_direction,
            'signal_type': self.signal_type,
            'confidence': self.confidence,
            'entry_price': self.entry_price,
            'stop_loss': self.stop_loss,
            'take_profit': self.take_profit,
            'risk_reward_ratio': self.risk_reward_ratio,
            'timestamp': self.timestamp.isoformat(),
            'timeframe': self.timeframe,
            'sector': self.sector
        }

class VolatilityAnalyzer:
    """Advanced volatility analysis for trend riding"""
    
    @staticmethod
    def calculate_atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> float:
        """Calculate Average True Range"""
        # Need at least 2 data points for TR calculation (current + previous)
        if len(highs) < 2 or len(lows) < 2 or len(closes) < 2:
            return 0.0
            
        true_ranges = []
        for i in range(1, len(highs)):
            tr1 = highs[i] - lows[i]
            tr2 = abs(highs[i] - closes[i-1])
            tr3 = abs(lows[i] - closes[i-1])
            true_ranges.append(max(tr1, tr2, tr3))
        
        # Use available TRs up to period length, or all if less than period
        atr_values = true_ranges[-period:] if len(true_ranges) >= period else true_ranges
        return np.mean(atr_values) if len(atr_values) > 0 else 0.0
    
    @staticmethod
    def calculate_rsi(prices: List[float], period: int = 14) -> float:
        """Calculate RSI (Relative Strength Index)"""
        if len(prices) < period + 1:
            return 50.0
            
        deltas = np.diff(prices)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        
        avg_gain = np.mean(gains[-period:])
        avg_loss = np.mean(losses[-period:])
        
        if avg_loss == 0:
            return 100.0
            
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    @staticmethod
    def detect_volatility_spike(candles: List[Dict], volume_threshold: float = 1.5, 
                               atr_threshold: float = 1.5, price_vol_threshold: float = 3.0) -> Tuple[str, float]:
        """Detect volatility spikes and return signal type with confidence"""
        if len(candles) < 21:  # Need at least 21 candles for analysis
            return "insufficient_data", 0.0
            
        # Extract OHLCV data
        opens = [c['open'] for c in candles]
        highs = [c['high'] for c in candles]
        lows = [c['low'] for c in candles]
        closes = [c['close'] for c in candles]
        volumes = [c['volume'] for c in candles]
        
        current_price = closes[-1]
        current_volume = volumes[-1]
        
        # Volume analysis
        avg_volume_20 = np.mean(volumes[-21:-1])  # Exclude current candle
        volume_ratio = current_volume / avg_volume_20 if avg_volume_20 > 0 else 1.0
        
        # ATR analysis
        current_atr = VolatilityAnalyzer.calculate_atr(highs[-15:], lows[-15:], closes[-15:])
        historical_atr = VolatilityAnalyzer.calculate_atr(highs[-29:-15], lows[-29:-15], closes[-29:-15])
        atr_ratio = current_atr / historical_atr if historical_atr > 0 else 1.0
        
        # Daily volatility (intraday range)
        daily_range = ((highs[-1] - lows[-1]) / closes[-2]) * 100 if len(closes) > 1 else 0.0
        
        # RSI calculation
        rsi = VolatilityAnalyzer.calculate_rsi(closes)
        
        # Trend detection (simple EMA crossover)
        if len(closes) >= 20:
            ema_fast = pd.Series(closes).ewm(span=8).mean().iloc[-1]
            ema_slow = pd.Series(closes).ewm(span=20).mean().iloc[-1]
            trend_direction = "BULLISH" if ema_fast > ema_slow else "BEARISH"
        else:
            trend_direction = "NEUTRAL"
        
        # Signal detection logic
        confidence = 0.0
        signal_type = "no_signal"
        
        # High volatility breakout
        if (volume_ratio >= volume_threshold and 
            atr_ratio >= atr_threshold and 
            daily_range >= price_vol_threshold and
            30 <= rsi <= 70):  # Avoid RSI extremes
            
            signal_type = "volatility_breakout"
            confidence = min(0.95, 0.3 + 
                           (volume_ratio - 1.0) * 0.2 + 
                           (atr_ratio - 1.0) * 0.2 + 
                           (daily_range / 10) * 0.1)
        
        # Trend acceleration (high volume + trending + moderate volatility)
        elif (volume_ratio >= 1.2 and 
              atr_ratio >= 1.2 and 
              daily_range >= 2.0 and
              ((trend_direction == "BULLISH" and rsi > 50) or 
               (trend_direction == "BEARISH" and rsi < 50))):
            
            signal_type = "trend_acceleration"
            confidence = min(0.85, 0.4 + 
                           (volume_ratio - 1.0) * 0.15 + 
                           (atr_ratio - 1.0) * 0.15 + 
                           abs(rsi - 50) / 100)
        
        # Momentum surge (volume spike + RSI momentum)
        elif (volume_ratio >= 2.0 and 
              atr_ratio >= 1.0 and
              ((rsi > 60 and trend_direction == "BULLISH") or 
               (rsi < 40 and trend_direction == "BEARISH"))):
            
            signal_type = "momentum_surge"
            confidence = min(0.8, 0.3 + 
                           (volume_ratio - 1.0) * 0.1 + 
                           abs(rsi - 50) / 100)
        
        return signal_type, confidence
    
    @staticmethod
    def calculate_risk_levels(entry_price: float, atr: float, trend_direction: str) -> Tuple[float, float]:
        """Calculate stop loss and take profit levels"""
        # Dynamic stop loss based on ATR
        stop_loss_distance = atr * 2.0
        take_profit_distance = atr * 3.0
        
        if trend_direction == "BULLISH":
            stop_loss = entry_price - stop_loss_distance
            take_profit = entry_price + take_profit_distance
        else:  # BEARISH
            stop_loss = entry_price + stop_loss_distance
            take_profit = entry_price - take_profit_distance
        
        return stop_loss, take_profit

class TradingViewScreener:
    """TradingView screener integration for volatility detection"""
    
    def __init__(self):
        self.screener_available = TRADINGVIEW_SCREENER_AVAILABLE
        self.ta_available = TRADINGVIEW_TA_AVAILABLE
        
    def scan_high_volatility_stocks(self, market: str = "india", limit: int = 100) -> List[Dict]:
        """Scan for high volatility stocks using TradingView screener"""
        if not self.screener_available:
            logger.error("❌ TradingView screener not available - install with: pip install tradingview-screener")
            return []
        
        try:
            # Create query for high volatility stocks with broader criteria
            query = (Query()
                    .select('name', 'close', 'volume', 'relative_volume_10d_calc', 
                           'Volatility.D', 'RSI', 'change', 'market_cap_basic')
                    .where(
                        col('market_cap_basic') > 100_000_000,   # Min 100M market cap (reduced from 1B)
                        col('relative_volume_10d_calc') > 1.1,   # 10% above average volume (reduced from 20%)
                        col('Volatility.D') > 0.02,              # >2% daily volatility (reduced from 3%)
                        col('RSI').between(20, 80),              # Wider RSI range (was 25-75)
                        col('close') > 5,                        # Price > ₹5 (reduced from ₹10)
                        col('volume') > 50000                    # Min volume threshold (reduced from 100k)
                    )
                    .order_by('relative_volume_10d_calc', ascending=False)
                    .limit(limit))
            
            results = query.get_scanner_data()
            
            if results:
                # Debug logging
                logger.info(f"📊 TradingView results type: {type(results)}")
                if hasattr(results, '__len__'):
                    logger.info(f"📊 TradingView results length: {len(results)}")
                
                # Try to get count from results
                if isinstance(results, tuple) and len(results) == 2:
                    columns, data = results
                    data_len = "unknown"
                    if hasattr(data, '__len__'):
                        data_len = len(data)
                    elif hasattr(data, '__iter__'):
                        try:
                            data_len = len(list(data))
                        except:
                            data_len = "unknown"
                    logger.info(f"✅ Found {data_len} high volatility stocks from TradingView")
                else:
                    logger.info(f"✅ Found TradingView results (format: {type(results)})")
                
                formatted_results = self._format_screener_results(results)
                if formatted_results:
                    logger.info(f"🎯 Successfully processed {len(formatted_results)} stocks from TradingView")
                    return formatted_results
                else:
                    logger.warning("⚠️ TradingView formatting returned no valid stocks - using fallback")
                    return []
            else:
                logger.warning("⚠️ No results from TradingView screener")
                return []
                
        except Exception as e:
            logger.error(f"❌ TradingView screener error: {str(e)}")
            logger.error(f"❌ Make sure tradingview-screener is installed: pip install tradingview-screener")
            return []
    
    def _format_screener_results(self, results: Any) -> List[Dict]:
        """Format TradingView screener results"""
        try:
            # Handle different result formats from TradingView screener
            if isinstance(results, tuple) and len(results) == 2:
                columns, data = results
                formatted_results = []
                
                # Debug logging for data structure
                logger.info(f"📊 TradingView columns type: {type(columns)}")
                logger.info(f"📊 TradingView data type: {type(data)}")
                
                # Handle DataFrame format (columns might be the DataFrame itself)
                if hasattr(columns, 'iterrows'):
                    logger.info("📊 TradingView returned DataFrame as first element")
                    df = columns
                    formatted_results = []
                    for _, row in df.iterrows():
                        tv_symbol = row.get('name', str(row.get(0, '')))
                        nse_symbol = self._convert_tv_to_nse_symbol(tv_symbol)
                        
                        if nse_symbol:
                            formatted_results.append({
                                'symbol': nse_symbol,
                                'price': float(row.get('close', row.get(1, 0))),
                                'volume_ratio': float(row.get('relative_volume_10d_calc', row.get(3, 1.0))),
                                'volatility': float(row.get('Volatility.D', row.get(4, 0))),
                                'rsi': float(row.get('RSI', row.get(5, 50))),
                                'change_percent': float(row.get('change', row.get(6, 0))),
                                'market_cap': float(row.get('market_cap_basic', row.get(7, 0)))
                            })
                    logger.info(f"✅ Successfully formatted {len(formatted_results)} stocks from TradingView DataFrame")
                    return formatted_results
                
                # Handle different data formats
                if isinstance(data, int):
                    logger.warning(f"⚠️ TradingView returned int instead of data rows: {data}")
                    return []
                
                # Ensure data is iterable
                if not hasattr(data, '__iter__') or isinstance(data, (str, bytes)):
                    logger.warning(f"⚠️ Unexpected data format: {type(data)}")
                    return []
                
                # Convert data to list if it's not already
                try:
                    data_list = list(data)
                    logger.info(f"📊 Processing {len(data_list)} rows from TradingView")
                except Exception as e:
                    logger.error(f"❌ Cannot convert data to list: {e}")
                    return []
                
                for i, row in enumerate(data_list):
                    try:
                        # Skip if row is not iterable or is a string/number
                        if not hasattr(row, '__iter__') or isinstance(row, (str, bytes, int, float)):
                            logger.warning(f"⚠️ Skipping non-iterable row {i}: {type(row)}")
                            continue
                        
                        # Convert row to list to ensure we can index it
                        row_list = list(row)
                        if len(row_list) != len(columns):
                            logger.warning(f"⚠️ Row {i} length {len(row_list)} doesn't match columns {len(columns)}")
                            continue
                            
                        stock_data = dict(zip(columns, row_list))
                        
                        # Convert TradingView symbol to NSE format
                        tv_symbol = stock_data.get('name', '')
                        nse_symbol = self._convert_tv_to_nse_symbol(tv_symbol)
                        
                        if nse_symbol:
                            formatted_results.append({
                                'symbol': nse_symbol,
                                'price': float(stock_data.get('close', 0)),
                                'volume_ratio': float(stock_data.get('relative_volume_10d_calc', 1.0)),
                                'volatility': float(stock_data.get('Volatility.D', 0)),
                                'rsi': float(stock_data.get('RSI', 50)),
                                'change_percent': float(stock_data.get('change', 0)),
                                'market_cap': float(stock_data.get('market_cap_basic', 0))
                            })
                            
                    except Exception as e:
                        logger.warning(f"⚠️ Error processing row {i}: {e}")
                        continue
                
                logger.info(f"✅ Successfully formatted {len(formatted_results)} stocks from TradingView")
                return formatted_results
            
            # Handle DataFrame format (if pandas DataFrame is returned directly)
            elif hasattr(results, 'iterrows'):
                logger.info("📊 TradingView returned DataFrame format directly")
                formatted_results = []
                for _, row in results.iterrows():
                    # Try different ways to extract symbol
                    tv_symbol = ''
                    if 'name' in row:
                        tv_symbol = str(row['name'])
                    elif len(row) > 0:
                        tv_symbol = str(row.iloc[0])
                    
                    nse_symbol = self._convert_tv_to_nse_symbol(tv_symbol)
                    
                    if nse_symbol:
                        formatted_results.append({
                            'symbol': nse_symbol,
                            'price': float(row.get('close', row.iloc[1] if len(row) > 1 else 0)),
                            'volume_ratio': float(row.get('relative_volume_10d_calc', row.iloc[3] if len(row) > 3 else 1.0)),
                            'volatility': float(row.get('Volatility.D', row.iloc[4] if len(row) > 4 else 0)),
                            'rsi': float(row.get('RSI', row.iloc[5] if len(row) > 5 else 50)),
                            'change_percent': float(row.get('change', row.iloc[6] if len(row) > 6 else 0)),
                            'market_cap': float(row.get('market_cap_basic', row.iloc[7] if len(row) > 7 else 0))
                        })
                logger.info(f"✅ Successfully formatted {len(formatted_results)} stocks from TradingView DataFrame")
                return formatted_results
            
            # Handle other formats or fallback
            elif isinstance(results, dict):
                logger.info("📊 TradingView returned dict format")
                return []
            
            else:
                logger.warning(f"⚠️ Unknown TradingView result format: {type(results)}")
                return []
            
        except Exception as e:
            logger.error(f"❌ Error formatting screener results: {str(e)}")
            logger.error(f"Results type: {type(results)}")
            if hasattr(results, '__len__'):
                logger.error(f"Results length: {len(results)}")
            return []
    
    def _convert_tv_to_nse_symbol(self, tv_symbol: str) -> Optional[str]:
        """Convert TradingView symbol to NSE format"""
        if not tv_symbol or not isinstance(tv_symbol, str):
            return None
            
        # Extract base symbol from TradingView format
        base_symbol = tv_symbol.replace('NSE:', '').replace('BSE:', '').strip()
        
        # Skip empty or invalid symbols
        if not base_symbol or len(base_symbol) < 2:
            return None
            
        # Common TradingView to NSE symbol mappings (expanded)
        symbol_map = {
            'RELIANCE': 'RELIANCE',
            'TCS': 'TCS',
            'HDFCBANK': 'HDFCBANK',
            'INFY': 'INFY',
            'ICICIBANK': 'ICICIBANK',
            'HINDUNILVR': 'HINDUNILVR',
            'ITC': 'ITC',
            'SBIN': 'SBIN',
            'BHARTIARTL': 'BHARTIARTL',
            'KOTAKBANK': 'KOTAKBANK',
            'ASIANPAINT': 'ASIANPAINT',
            'MARUTI': 'MARUTI',
            'LT': 'LT',
            'AXISBANK': 'AXISBANK',
            'TITAN': 'TITAN',
            'NESTLEIND': 'NESTLEIND',
            'ULTRACEMCO': 'ULTRACEMCO',
            'WIPRO': 'WIPRO',
            'HCLTECH': 'HCLTECH',
            'TATAMOTORS': 'TATAMOTORS',
            'TATASTEEL': 'TATASTEEL',
            'POWERGRID': 'POWERGRID',
            'NTPC': 'NTPC',
            'ONGC': 'ONGC',
            'COALINDIA': 'COALINDIA',
            'SUNPHARMA': 'SUNPHARMA',
            'DRREDDY': 'DRREDDY',
            'CIPLA': 'CIPLA',
            'JSWSTEEL': 'JSWSTEEL',
            'HINDALCO': 'HINDALCO',
            'INDUSINDBK': 'INDUSINDBK',
            'TECHM': 'TECHM',
            'ADANIPORTS': 'ADANIPORTS',
            'BAJFINANCE': 'BAJFINANCE',
            'BAJAJFINSV': 'BAJAJFINSV',
            'GRASIM': 'GRASIM',
            'EICHERMOT': 'EICHERMOT',
            'HEROMOTOCO': 'HEROMOTOCO',
            'BRITANNIA': 'BRITANNIA',
            'DIVISLAB': 'DIVISLAB',
            'APOLLOHOSP': 'APOLLOHOSP',
            'SHREECEM': 'SHREECEM',
            'BAJAJ-AUTO': 'BAJAJ-AUTO',
            'TATACONSUM': 'TATACONSUM',
            'UPL': 'UPL',
            'SBILIFE': 'SBILIFE',
            'HDFCLIFE': 'HDFCLIFE',
            'LTIM': 'LTIM',
            'ADANIENT': 'ADANIENT',
            'BPCL': 'BPCL',
            'EIEL': 'EIEL',  # Added EIEL mapping
            'YESBANK': 'YESBANK',
            'SUZLON': 'SUZLON',
            'RPOWER': 'RPOWER',
            'SAIL': 'SAIL',
            'BHEL': 'BHEL',
            'GMRINFRA': 'GMRINFRA',
            'IDEA': 'IDEA',
            'VEDL': 'VEDL',
            'HINDZINC': 'HINDZINC',
            'NATIONALUM': 'NATIONALUM',
            'IRCTC': 'IRCTC',
            'PAYTM': 'PAYTM',
            'ZOMATO': 'ZOMATO',
            'NYKAA': 'NYKAA'
        }
        
        # Return mapped symbol or original if valid NSE symbol pattern
        result = symbol_map.get(base_symbol, base_symbol)
        
        # Basic validation for NSE symbols (alphanumeric, reasonable length)
        if result and len(result) <= 20 and result.replace('-', '').replace('&', '').isalnum():
            return result
        else:
            return None
    
    def _get_comprehensive_stock_list(self) -> List[Dict]:
        """Get comprehensive list of NSE stocks for volatility scanning"""
        # This method provides a comprehensive list of NSE stocks when TradingView fails
        # In production, this should be replaced with a dynamic NSE symbol fetch
        
        comprehensive_stocks = [
            # Large Cap Stocks
            {'symbol': 'RELIANCE', 'sector': 'OIL_GAS'},
            {'symbol': 'TCS', 'sector': 'IT'},
            {'symbol': 'HDFCBANK', 'sector': 'BANKING'},
            {'symbol': 'INFY', 'sector': 'IT'},
            {'symbol': 'ICICIBANK', 'sector': 'BANKING'},
            {'symbol': 'HINDUNILVR', 'sector': 'FMCG'},
            {'symbol': 'ITC', 'sector': 'FMCG'},
            {'symbol': 'SBIN', 'sector': 'BANKING'},
            {'symbol': 'BHARTIARTL', 'sector': 'TELECOM'},
            {'symbol': 'KOTAKBANK', 'sector': 'BANKING'},
            {'symbol': 'ASIANPAINT', 'sector': 'PAINTS'},
            {'symbol': 'MARUTI', 'sector': 'AUTO'},
            {'symbol': 'LT', 'sector': 'INFRASTRUCTURE'},
            {'symbol': 'AXISBANK', 'sector': 'BANKING'},
            {'symbol': 'TITAN', 'sector': 'JEWELRY'},
            
            # Mid Cap High Volatility Stocks
            {'symbol': 'TATAMOTORS', 'sector': 'AUTO'},
            {'symbol': 'TATASTEEL', 'sector': 'STEEL'},
            {'symbol': 'JSWSTEEL', 'sector': 'STEEL'},
            {'symbol': 'HINDALCO', 'sector': 'METALS'},
            {'symbol': 'COALINDIA', 'sector': 'MINING'},
            {'symbol': 'ONGC', 'sector': 'OIL_GAS'},
            {'symbol': 'NTPC', 'sector': 'POWER'},
            {'symbol': 'SAIL', 'sector': 'STEEL'},
            {'symbol': 'ADANIPORTS', 'sector': 'INFRASTRUCTURE'},
            {'symbol': 'BANKBARODA', 'sector': 'BANKING'},
            {'symbol': 'PNB', 'sector': 'BANKING'},
            {'symbol': 'CANBK', 'sector': 'BANKING'},
            {'symbol': 'POWERGRID', 'sector': 'POWER'},
            {'symbol': 'INDUSINDBK', 'sector': 'BANKING'},
            {'symbol': 'BAJFINANCE', 'sector': 'FINANCE'},
            
            # Small/Mid Cap Volatile Stocks (including EIEL-like stocks)
            {'symbol': 'YESBANK', 'sector': 'BANKING'},
            {'symbol': 'RPOWER', 'sector': 'POWER'},
            {'symbol': 'SUZLON', 'sector': 'ENERGY'},
            {'symbol': 'BHEL', 'sector': 'HEAVY_ENGG'},
            {'symbol': 'GMRINFRA', 'sector': 'INFRASTRUCTURE'},
            {'symbol': 'IDEA', 'sector': 'TELECOM'},
            {'symbol': 'EICHERMOT', 'sector': 'AUTO'},
            {'symbol': 'HEROMOTOCO', 'sector': 'AUTO'},
            {'symbol': 'GAIL', 'sector': 'OIL_GAS'},
            {'symbol': 'IOCL', 'sector': 'OIL_GAS'},
            {'symbol': 'BPCL', 'sector': 'OIL_GAS'},
            {'symbol': 'HPCL', 'sector': 'OIL_GAS'},
            {'symbol': 'VEDL', 'sector': 'METALS'},
            {'symbol': 'HINDZINC', 'sector': 'METALS'},
            {'symbol': 'NATIONALUM', 'sector': 'METALS'},
            
            # Additional Stocks (Potential EIEL-like opportunities)
            {'symbol': 'IRCTC', 'sector': 'TRANSPORT'},
            {'symbol': 'PAYTM', 'sector': 'FINTECH'},
            {'symbol': 'ZOMATO', 'sector': 'FOOD_DELIVERY'},
            {'symbol': 'NYKAA', 'sector': 'E_COMMERCE'},
            {'symbol': 'POLICYBZR', 'sector': 'INSURANCE'},
            {'symbol': 'LTTS', 'sector': 'IT'},
            {'symbol': 'MPHASIS', 'sector': 'IT'},
            {'symbol': 'MINDTREE', 'sector': 'IT'},
            {'symbol': 'L&TFH', 'sector': 'FINANCE'},
            {'symbol': 'BAJAJHLDNG', 'sector': 'FINANCE'},
            {'symbol': 'MOTHERSUMI', 'sector': 'AUTO'},
            {'symbol': 'ASHOKLEY', 'sector': 'AUTO'},
            {'symbol': 'TVSMOTOR', 'sector': 'AUTO'},
            {'symbol': 'BALKRISIND', 'sector': 'AUTO'},
            {'symbol': 'APOLLOTYRE', 'sector': 'AUTO'},
            
            # Infrastructure & Construction
            {'symbol': 'IRB', 'sector': 'INFRASTRUCTURE'},
            {'symbol': 'NBCC', 'sector': 'CONSTRUCTION'},
            {'symbol': 'NCC', 'sector': 'CONSTRUCTION'},
            {'symbol': 'BEML', 'sector': 'CONSTRUCTION'},
            
            # Chemicals & Pharma Mid-caps
            {'symbol': 'UPL', 'sector': 'CHEMICALS'},
            {'symbol': 'PIDILITIND', 'sector': 'CHEMICALS'},
            {'symbol': 'AAVAS', 'sector': 'HOUSING_FINANCE'},
            {'symbol': 'LICHSGFIN', 'sector': 'HOUSING_FINANCE'},
            
            # Telecom & Media
            {'symbol': 'HFCL', 'sector': 'TELECOM'},
            {'symbol': 'GTPL', 'sector': 'MEDIA'},
            
            # Emerging Mid-caps with potential volatility
            {'symbol': 'EIEL', 'sector': 'INFRASTRUCTURE'},  # Added EIEL specifically
            {'symbol': 'RVNL', 'sector': 'RAILWAYS'},
            {'symbol': 'CONCOR', 'sector': 'LOGISTICS'},
            {'symbol': 'SJVN', 'sector': 'POWER'},
            {'symbol': 'NHPC', 'sector': 'POWER'},
            {'symbol': 'THDC', 'sector': 'POWER'},
            {'symbol': 'RECLTD', 'sector': 'FINANCE'},
            {'symbol': 'PFC', 'sector': 'FINANCE'},
            {'symbol': 'IRFC', 'sector': 'FINANCE'},
            {'symbol': 'HUDCO', 'sector': 'FINANCE'},
            {'symbol': 'INDIACEM', 'sector': 'CEMENT'},
            {'symbol': 'JKCEMENT', 'sector': 'CEMENT'},
            {'symbol': 'RAMCOCEM', 'sector': 'CEMENT'},
            {'symbol': 'ORIENTCEM', 'sector': 'CEMENT'}
        ]
        
        logger.warning(f"⚠️ Using comprehensive fallback stock list ({len(comprehensive_stocks)} symbols)")
        logger.warning("⚠️ For better coverage, fix TradingView integration or implement NSE symbol fetch")
        return comprehensive_stocks

class VolatilityTrendScanner:
    """Main volatility trend riding scanner"""
    
    def __init__(self):
        # API Setup
        self.upstox_client = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'],
            api_secret=UPSTOX_CONFIG['api_secret']
        )
        
        # TradingView integration
        self.tv_screener = TradingViewScreener()
        
        # Configuration - Made more sensitive to catch stocks like EIEL
        self.scan_frequency = 120  # 2 minutes for faster volatility scanning
        self.min_volume = 25000    # Reduced from 100k to catch smaller stocks
        self.min_price = 5.0       # Reduced from 10 to catch more stocks
        self.max_price = 10000.0   # Increased max price
        self.min_confidence = 0.5  # Reduced from 0.6 to be more sensitive
        self.max_positions = 10    # Increased position limit
        
        # Volatility thresholds - Made more sensitive
        self.volume_threshold = 1.2  # 20% above average (reduced from 50%)
        self.atr_threshold = 1.2     # 20% above average (reduced from 50%)
        self.price_vol_threshold = 2.0  # 2% daily range (reduced from 3%)
        
        # Data storage
        self.volatility_signals: List[VolatilitySignal] = []
        self.cache = {}
        self.cache_timeout = 180  # 3 minutes
        
        # Signal deduplication - Reduced cooldown for faster alerts
        self.sent_signals = set()
        self.signal_cooldown = 900   # 15 minutes cooldown (reduced from 30m)
        self.last_signal_times = {}
        
        # Threading
        self.running = False
        self.scanner_thread = None
        
        # Telegram integration
        self.telegram_enabled = REQUESTS_AVAILABLE and TELEGRAM_CONFIG.get('bot_token')
        
    def authenticate(self) -> bool:
        """Authenticate with Upstox API"""
        try:
            if not self.upstox_client.access_token:
                logger.info("🔑 Authenticating with Upstox API...")
                if self.upstox_client.authenticate():
                    logger.info("✅ Upstox API authentication successful")
                    return True
                else:
                    logger.error("❌ Upstox API authentication failed")
                    return False
            return True
        except Exception as e:
            logger.error(f"❌ Authentication error: {str(e)}")
            return False
    
    def get_market_data(self, symbol: str, timeframe: str = "15min") -> Optional[List[Dict]]:
        """Fetch market data for volatility analysis"""
        cache_key = f"{symbol}_{timeframe}"
        current_time = time.time()
        
        # Check cache
        if (cache_key in self.cache and 
            current_time - self.cache[cache_key]['timestamp'] < self.cache_timeout):
            return self.cache[cache_key]['data']
        
        try:
            # Fetch data from Upstox
            to_date = datetime.now().strftime("%Y-%m-%d")
            from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")  # 7 days for better ATR
            
            df = self.upstox_client.fetch_historical_data(
                symbol=symbol,
                interval='1minute',
                from_date=from_date,
                to_date=to_date
            )
            
            if df is None or df.empty:
                logger.warning(f"⚠️ No data received for {symbol}")
                return None
            
            # Resample to target timeframe
            ohlc_dict = {
                'open': 'first',
                'high': 'max',
                'low': 'min',
                'close': 'last',
                'volume': 'sum'
            }
            df_resampled = df.resample(timeframe).apply(ohlc_dict)
            df_resampled.dropna(subset=['open'], inplace=True)
            
            # Convert to list of dicts
            candles = [
                {
                    'timestamp': int(row.name.timestamp() * 1000),
                    'open': row['open'],
                    'high': row['high'],
                    'low': row['low'],
                    'close': row['close'],
                    'volume': row['volume']
                } for _, row in df_resampled.iterrows()
            ]
            
            # Cache the result
            self.cache[cache_key] = {
                'data': candles,
                'timestamp': current_time
            }
            
            return candles
            
        except Exception as e:
            logger.error(f"❌ Error fetching data for {symbol}: {str(e)}")
            return None
    
    def scan_symbol_for_volatility(self, symbol: str) -> Optional[VolatilitySignal]:
        """Scan a single symbol for volatility trend riding opportunities"""
        try:
            # Get market data
            candles = self.get_market_data(symbol, "15min")
            if not candles or len(candles) < 30:
                return None
            
            # Current price and volume checks
            current_candle = candles[-1]
            current_price = current_candle['close']
            current_volume = current_candle['volume']
            
            # Basic filters
            if (current_price < self.min_price or 
                current_price > self.max_price or
                current_volume < self.min_volume):
                return None
            
            # Volatility analysis
            signal_type, confidence = VolatilityAnalyzer.detect_volatility_spike(
                candles, self.volume_threshold, self.atr_threshold, self.price_vol_threshold
            )
            
            if confidence < self.min_confidence:
                return None
            
            # Calculate additional metrics
            opens = [c['open'] for c in candles]
            highs = [c['high'] for c in candles]
            lows = [c['low'] for c in candles]
            closes = [c['close'] for c in candles]
            volumes = [c['volume'] for c in candles]
            
            # Technical calculations
            current_atr = VolatilityAnalyzer.calculate_atr(highs[-15:], lows[-15:], closes[-15:])
            historical_atr = VolatilityAnalyzer.calculate_atr(highs[-29:-15], lows[-29:-15], closes[-29:-15])
            atr_ratio = current_atr / historical_atr if historical_atr > 0 else 1.0
            
            avg_volume_20 = np.mean(volumes[-21:-1])
            volume_ratio = current_volume / avg_volume_20 if avg_volume_20 > 0 else 1.0
            
            daily_volatility = ((highs[-1] - lows[-1]) / closes[-2]) * 100 if len(closes) > 1 else 0.0
            rsi = VolatilityAnalyzer.calculate_rsi(closes)
            
            # Trend direction
            if len(closes) >= 20:
                ema_fast = pd.Series(closes).ewm(span=8).mean().iloc[-1]
                ema_slow = pd.Series(closes).ewm(span=20).mean().iloc[-1]
                trend_direction = "BULLISH" if ema_fast > ema_slow else "BEARISH"
            else:
                trend_direction = "NEUTRAL"
            
            # Risk management levels
            stop_loss, take_profit = VolatilityAnalyzer.calculate_risk_levels(
                current_price, current_atr, trend_direction
            )
            
            # Risk-reward ratio
            risk = abs(current_price - stop_loss)
            reward = abs(take_profit - current_price)
            risk_reward_ratio = reward / risk if risk > 0 else 0.0
            
            # Create volatility signal
            signal = VolatilitySignal(
                symbol=symbol,
                price=current_price,
                volume=current_volume,
                volume_ratio=volume_ratio,
                atr_current=current_atr,
                atr_ratio=atr_ratio,
                daily_volatility=daily_volatility,
                rsi=rsi,
                trend_direction=trend_direction,
                signal_type=signal_type,
                confidence=confidence,
                entry_price=current_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                risk_reward_ratio=risk_reward_ratio,
                timestamp=datetime.now(),
                timeframe="15min"
            )
            
            logger.info(f"🔥 VOLATILITY SIGNAL: {symbol} | {signal_type} | Confidence: {confidence:.1%} | R:R {risk_reward_ratio:.2f}")
            return signal
            
        except Exception as e:
            logger.error(f"❌ Error scanning {symbol}: {str(e)}")
            return None
    
    def scan_volatile_universe(self) -> List[VolatilitySignal]:
        """Scan for high volatility stocks from TradingView screener"""
        signals = []
        
        # Get volatile stocks from TradingView screener
        volatile_stocks = self.tv_screener.scan_high_volatility_stocks(limit=100)
        
        # If TradingView fails, use comprehensive fallback list
        if not volatile_stocks:
            logger.warning("⚠️ TradingView screener failed, using comprehensive fallback list")
            volatile_stocks = self.tv_screener._get_comprehensive_stock_list()
            
        if not volatile_stocks:
            logger.error("❌ No stocks available for scanning")
            return signals
        
        symbols = [stock['symbol'] for stock in volatile_stocks]
        logger.info(f"🔍 Scanning {len(symbols)} volatile stocks for trend riding opportunities...")
        
        start_time = time.time()
        
        # Use ThreadPoolExecutor for concurrent scanning
        with ThreadPoolExecutor(max_workers=5) as executor:
            # Submit all scanning tasks
            future_to_symbol = {
                executor.submit(self.scan_symbol_for_volatility, symbol): symbol 
                for symbol in symbols
            }
            
            # Collect results
            for future in as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                try:
                    signal = future.result(timeout=30)
                    if signal:
                        signals.append(signal)
                        logger.info(f"✅ {symbol}: {signal.signal_type} (confidence: {signal.confidence:.1%}, R:R: {signal.risk_reward_ratio:.2f})")
                except Exception as e:
                    logger.warning(f"⚠️ {symbol}: Scan failed - {str(e)}")
        
        scan_time = time.time() - start_time
        logger.info(f"🏁 Volatility scan completed in {scan_time:.1f}s | Found {len(signals)} signals")
        
        return signals
    
    def should_send_alert(self, signal: VolatilitySignal) -> bool:
        """Check if we should send an alert for this signal (deduplication)"""
        signal_key = f"{signal.symbol}_{signal.signal_type}_{signal.timeframe}"
        current_time = time.time()
        
        # Clean up old signal times
        if len(self.last_signal_times) > 100:
            cutoff_time = current_time - (self.signal_cooldown * 2)
            self.last_signal_times = {
                k: v for k, v in self.last_signal_times.items() 
                if v > cutoff_time
            }
        
        # Check if we've sent this signal recently
        if signal_key in self.last_signal_times:
            time_since_last = current_time - self.last_signal_times[signal_key]
            if time_since_last < self.signal_cooldown:
                remaining_cooldown = self.signal_cooldown - time_since_last
                logger.info(f"🔇 Skipping duplicate alert for {signal.symbol} ({signal.signal_type}) - cooldown: {remaining_cooldown/60:.1f}m remaining")
                return False
        
        # Update last signal time
        self.last_signal_times[signal_key] = current_time
        return True
    
    def send_telegram_alert(self, signal: VolatilitySignal) -> bool:
        """Send volatility alert via Telegram"""
        if not self.telegram_enabled:
            return False
            
        # Check if we should send this alert
        if not self.should_send_alert(signal):
            return False
            
        try:
            bot_token = TELEGRAM_CONFIG['bot_token']
            chat_id = TELEGRAM_CONFIG['chat_id']
            
            message = f"""
🔥 *VOLATILITY TREND ALERT* 🔥

📈 *Symbol:* {signal.symbol}
💰 *Price:* ₹{signal.price:,.2f}
🎯 *Signal:* {signal.signal_type.replace('_', ' ').title()}
📊 *Confidence:* {signal.confidence:.1%}
📈 *Trend:* {signal.trend_direction}
⚡ *Volatility:* {signal.daily_volatility:.1f}%
📊 *Volume:* {signal.volume_ratio:.1f}x
📈 *RSI:* {signal.rsi:.1f}
🎯 *ATR Ratio:* {signal.atr_ratio:.2f}

🔴 *Entry:* ₹{signal.entry_price:,.2f}
🛑 *Stop Loss:* ₹{signal.stop_loss:,.2f}
🎯 *Take Profit:* ₹{signal.take_profit:,.2f}
⚖️ *Risk:Reward:* 1:{signal.risk_reward_ratio:.2f}
⏰ *Time:* {signal.timestamp.strftime('%H:%M:%S')}

#Volatility #TrendRiding #NSE
            """
            
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': message,
                'parse_mode': 'Markdown'
            }
            
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                logger.info(f"📱 Telegram alert sent for {signal.symbol} ({signal.signal_type})")
                return True
            else:
                logger.warning(f"⚠️ Telegram alert failed: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Telegram alert error: {str(e)}")
            return False
    
    def save_signals_to_file(self, signals: List[VolatilitySignal]):
        """Save volatility signals to JSON file"""
        try:
            filename = f"volatility_signals_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = os.path.join(os.path.dirname(__file__), filename)
            
            signals_data = [signal.to_dict() for signal in signals]
            
            with open(filepath, 'w') as f:
                json.dump(signals_data, f, indent=2)
                
            logger.info(f"💾 Saved {len(signals)} volatility signals to {filename}")
            
        except Exception as e:
            logger.error(f"❌ Error saving signals: {str(e)}")
    
    def run_continuous_scan(self):
        """Run continuous volatility scanning loop"""
        logger.info("🔥 Starting continuous volatility trend scanning...")
        
        while self.running:
            try:
                # Scan for volatile stocks
                signals = self.scan_volatile_universe()
                
                # Process signals
                if signals:
                    self.volatility_signals.extend(signals)
                    
                    # Send alerts for new signals
                    new_alerts_sent = 0
                    for signal in signals:
                        if self.send_telegram_alert(signal):
                            new_alerts_sent += 1
                    
                    # Save to file
                    self.save_signals_to_file(signals)
                    
                    # Log alert summary
                    if new_alerts_sent > 0:
                        logger.info(f"📱 Sent {new_alerts_sent} new Telegram alerts (filtered {len(signals) - new_alerts_sent} duplicates)")
                    else:
                        logger.info("🔇 No new alerts sent - all signals were duplicates")
                    
                    # Print summary
                    print(f"\n{'='*70}")
                    print(f"🔥 VOLATILITY TREND SCAN SUMMARY - {datetime.now().strftime('%H:%M:%S')}")
                    print(f"{'='*70}")
                    for signal in signals:
                        print(f"📈 {signal.symbol:12s} | {signal.signal_type:20s} | {signal.confidence:5.1%} | ₹{signal.price:8.2f} | R:R 1:{signal.risk_reward_ratio:.2f}")
                    print(f"{'='*70}\n")
                else:
                    logger.info("🔍 No volatility signals found in this scan")
                
                # Wait for next scan
                if self.running:
                    logger.info(f"⏰ Next volatility scan in {self.scan_frequency} seconds... (Scanning {len(volatile_stocks) if 'volatile_stocks' in locals() else 'unknown'} stocks)")
                    time.sleep(self.scan_frequency)
                    
            except KeyboardInterrupt:
                logger.info("🛑 Scanning interrupted by user")
                break
            except Exception as e:
                logger.error(f"❌ Scanning error: {str(e)}")
                time.sleep(30)
        
        logger.info("🏁 Continuous volatility scanning stopped")
    
    def start_scanning(self):
        """Start the volatility trend scanner"""
        if self.running:
            logger.warning("⚠️ Scanner is already running")
            return
        
        # Authenticate first
        if not self.authenticate():
            logger.error("❌ Cannot start scanner - authentication failed")
            return
        
        # Start scanning in a separate thread
        self.running = True
        self.scanner_thread = threading.Thread(target=self.run_continuous_scan, daemon=True)
        self.scanner_thread.start()
        
        logger.info("✅ Volatility trend scanner started successfully")
    
    def stop_scanning(self):
        """Stop the volatility trend scanner"""
        if not self.running:
            logger.warning("⚠️ Scanner is not running")
            return
        
        self.running = False
        if self.scanner_thread:
            self.scanner_thread.join(timeout=10)
        
        logger.info("🛑 Volatility trend scanner stopped")
    
    def get_recent_signals(self, hours: int = 24) -> List[VolatilitySignal]:
        """Get volatility signals from the last N hours"""
        cutoff_time = datetime.now() - timedelta(hours=hours)
        recent_signals = [
            signal for signal in self.volatility_signals 
            if signal.timestamp >= cutoff_time
        ]
        return recent_signals

def main():
    """Main function to run the volatility trend scanner"""
    print(f"""
🔥 HIGH VOLATILITY TREND RIDING SCANNER
======================================
🎯 Strategy: Momentum capture during volatility spikes
📊 Data Source: TradingView screener + Upstox execution
⏰ Frequency: Every 3 minutes
🔔 Alerts: Telegram notifications with entry/exit levels

📈 Signal Types:
   - Volatility Breakout (Volume + ATR spike)
   - Trend Acceleration (Volume + trending)
   - Momentum Surge (Volume + RSI momentum)

🛡️ Risk Management:
   - Stop Loss: 2x ATR
   - Take Profit: 3x ATR
   - Risk:Reward: 1:1.5 minimum

Starting scanner...
    """)
    
    scanner = VolatilityTrendScanner()
    
    try:
        scanner.start_scanning()
        
        # Keep the main thread alive
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Stopping scanner...")
        scanner.stop_scanning()
        print("👋 Scanner stopped. Goodbye!")

if __name__ == "__main__":
    main()