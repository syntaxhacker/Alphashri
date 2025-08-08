#!/usr/bin/env python3
"""
Comprehensive Trade Analyzer
Analyzes losing trades to identify exact failure reasons using:
- Technical indicators (RSI, MACD, Bollinger Bands, etc.)
- Short, medium, and long-term trends
- Market structure (support/resistance)
- Volume and liquidity analysis
- Entry timing and market conditions
"""

import pandas as pd
import numpy as np
import requests
import json
import gzip
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import talib
import argparse
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'config_and_utils'))
from free_indian_apis import UpstoxAPI
import warnings
warnings.filterwarnings('ignore')

console = Console()

# Load Upstox config
try:
    from config import UPSTOX_CONFIG
except ImportError:
    console.print("[red]❌ config.py not found. Please create it from config_template.py with your Upstox API credentials.[/red]")
    UPSTOX_CONFIG = {'api_key': None, 'api_secret': None}

class TechnicalAnalyzer:
    """Technical indicators and market analysis"""
    
    @staticmethod
    def calculate_indicators(df: pd.DataFrame) -> pd.DataFrame:
        """Calculate comprehensive technical indicators"""
        if df.empty:
            return df
            
        try:
            # Ensure we have numeric data
            for col in ['open', 'high', 'low', 'close', 'volume']:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
            
            # Only calculate if we have sufficient data
            min_periods = min(14, len(df) // 2)  # Adaptive minimum periods
            
            # Price-based indicators with shorter periods if needed
            df['sma_5'] = talib.SMA(df['close'], timeperiod=min(5, len(df)-1)) if len(df) >= 2 else df['close']
            df['sma_20'] = talib.SMA(df['close'], timeperiod=min(20, len(df)-1)) if len(df) >= 2 else df['close']
            df['ema_9'] = talib.EMA(df['close'], timeperiod=min(9, len(df)-1)) if len(df) >= 2 else df['close']
            
            # Volatility indicators
            if len(df) >= 2:
                try:
                    df['bb_upper'], df['bb_middle'], df['bb_lower'] = talib.BBANDS(
                        df['close'], 
                        timeperiod=min(20, len(df)-1),
                        nbdevup=2, 
                        nbdevdn=2, 
                        matype=0
                    )
                except:
                    # Fallback: simple moving average ± 2 std dev
                    sma = df['close'].rolling(window=min(10, len(df))).mean()
                    std = df['close'].rolling(window=min(10, len(df))).std()
                    df['bb_middle'] = sma
                    df['bb_upper'] = sma + (2 * std)
                    df['bb_lower'] = sma - (2 * std)
                    
                df['atr'] = talib.ATR(df['high'], df['low'], df['close'], timeperiod=min(14, len(df)-1))
            
            # Momentum indicators
            if len(df) >= min_periods:
                df['rsi'] = talib.RSI(df['close'], timeperiod=min(14, len(df)-1))
                df['macd'], df['macd_signal'], df['macd_histogram'] = talib.MACD(
                    df['close'], 
                    fastperiod=min(12, len(df)//3), 
                    slowperiod=min(26, len(df)//2), 
                    signalperiod=min(9, len(df)//4)
                ) if len(df) >= 12 else (pd.Series([0]*len(df)), pd.Series([0]*len(df)), pd.Series([0]*len(df)))
                
                if len(df) >= 14:
                    df['stoch_k'], df['stoch_d'] = talib.STOCH(df['high'], df['low'], df['close'])
                else:
                    df['stoch_k'] = df['stoch_d'] = pd.Series([50]*len(df))  # Neutral
            else:
                # Fill with neutral values for small datasets
                df['rsi'] = pd.Series([50]*len(df))  # Neutral RSI
                df['macd'] = pd.Series([0]*len(df))
                df['macd_signal'] = pd.Series([0]*len(df))
                df['macd_histogram'] = pd.Series([0]*len(df))
                df['stoch_k'] = df['stoch_d'] = pd.Series([50]*len(df))
            
            # Volume indicators
            if 'volume' in df.columns and len(df) >= 2:
                df['volume_sma'] = df['volume'].rolling(window=min(10, len(df))).mean()
                df['volume_ratio'] = df['volume'] / df['volume_sma'].fillna(df['volume'].mean())
                df['volume_ratio'] = df['volume_ratio'].fillna(1.0)  # Fill NaN with 1.0
                
                if len(df) >= min_periods:
                    try:
                        df['obv'] = talib.OBV(df['close'], df['volume'])
                    except:
                        df['obv'] = df['volume'].cumsum()  # Fallback
                else:
                    df['obv'] = df['volume'].cumsum()
            else:
                df['volume_ratio'] = pd.Series([1.0]*len(df))  # Default ratio
                df['volume_sma'] = df.get('volume', pd.Series([1000]*len(df)))
                df['obv'] = df.get('volume', pd.Series([1000]*len(df))).cumsum()
            
            # Support/Resistance levels
            df['pivot'] = (df['high'] + df['low'] + df['close']) / 3
            df['resistance_1'] = 2 * df['pivot'] - df['low']
            df['support_1'] = 2 * df['pivot'] - df['high']
            
            # Fill any remaining NaN values with forward fill then backward fill
            for col in ['rsi', 'macd', 'macd_signal', 'bb_upper', 'bb_middle', 'bb_lower', 'atr']:
                if col in df.columns:
                    df[col] = df[col].ffill().bfill()
                    # If still NaN, fill with reasonable defaults
                    if col == 'rsi':
                        df[col] = df[col].fillna(50)  # Neutral RSI
                    elif col in ['bb_upper', 'bb_middle', 'bb_lower']:
                        df[col] = df[col].fillna(df['close'])  # Use close price as fallback
                        
            console.print(f"[dim]✅ Calculated indicators for {len(df)} candles[/dim]")
            
        except Exception as e:
            console.print(f"[red]⚠️ Error calculating indicators: {e}[/red]")
            # Provide fallback values to prevent NaN
            df['rsi'] = pd.Series([50]*len(df))
            df['volume_ratio'] = pd.Series([1.0]*len(df))
            df['bb_middle'] = df['close']
            df['bb_upper'] = df['close'] * 1.02
            df['bb_lower'] = df['close'] * 0.98
            df['atr'] = df['high'] - df['low']
            
        return df
    
    @staticmethod
    def determine_trend(df: pd.DataFrame, fast_col: str, slow_col: str) -> pd.Series:
        """Determine trend based on moving averages"""
        if fast_col not in df.columns or slow_col not in df.columns:
            return pd.Series(['neutral'] * len(df))
            
        conditions = [
            (df[fast_col] > df[slow_col]) & (df[fast_col] > df[fast_col].shift(1)),
            (df[fast_col] > df[slow_col]) & (df[fast_col] <= df[fast_col].shift(1)),
            (df[fast_col] < df[slow_col]) & (df[fast_col] < df[fast_col].shift(1)),
            (df[fast_col] < df[slow_col]) & (df[fast_col] >= df[fast_col].shift(1))
        ]
        
        choices = ['strong_bullish', 'bullish', 'strong_bearish', 'bearish']
        
        return pd.Series(np.select(conditions, choices, default='neutral'))

class TradeLogParser:
    """Parse trade logs and extract trade information"""
    
    @staticmethod
    def parse_log_file(log_path: str) -> List[Dict]:
        """Parse trade log file and return list of trades"""
        trades = []
        open_trades = {}  # Track multiple open trades by symbol + timestamp
        
        try:
            with open(log_path, 'r') as f:
                lines = f.readlines()
            
            for line in lines:
                line = line.strip()
                if not line or line.startswith('#') or line.startswith('-'):
                    continue
                
                parts = [p.strip() for p in line.split('|')]
                if len(parts) < 6:
                    continue
                
                timestamp = parts[0].strip()
                action = parts[1].strip()
                symbol_raw = parts[2].strip()
                price = float(parts[3].replace('₹', '').replace(',', ''))
                qty = int(parts[4])
                amount = float(parts[5].replace('₹', '').replace(',', ''))
                alert_type = parts[6].strip() if len(parts) > 6 else ''
                
                # Extract symbol from NSE:SYMBOL format
                symbol = symbol_raw.replace('NSE:', '') if ':' in symbol_raw else symbol_raw
                
                if action == 'ENTRY':
                    trade_key = f"{symbol}_{timestamp}"
                    open_trades[trade_key] = {
                        'symbol': symbol,
                        'entry_time': timestamp,
                        'entry_price': price,
                        'quantity': qty,
                        'entry_amount': amount,
                        'alert_type': alert_type,
                        'trade_side': 'BUY'  # Default, can be enhanced
                    }
                
                elif action == 'EXIT':
                    # Find the most recent open trade for this symbol
                    matching_key = None
                    for key in reversed(list(open_trades.keys())):
                        if key.startswith(f"{symbol}_"):
                            matching_key = key
                            break
                    
                    if matching_key:
                        current_trade = open_trades[matching_key]
                        
                        # Extract P&L from the entire line (after the last |)
                        pnl_info = ''
                        pnl_pct = 0.0
                        pnl_amount = 0.0
                        
                        # Find P&L in the original line
                        if 'P&L:' in line:
                            try:
                                pnl_part = line.split('P&L:')[1].strip()
                                if '%' in pnl_part and '₹' in pnl_part:
                                    pct_part = pnl_part.split('%')[0].strip()
                                    amt_part = pnl_part.split('₹')[1].replace(')', '').replace(',', '').strip()
                                    pnl_pct = float(pct_part)
                                    # Handle the sign correctly
                                    if amt_part.startswith('+'):
                                        pnl_amount = float(amt_part[1:])  # Remove + sign
                                    elif amt_part.startswith('-'):
                                        pnl_amount = -float(amt_part[1:])  # Remove - sign and make negative
                                    else:
                                        pnl_amount = float(amt_part)
                            except Exception as e:
                                # Fallback: calculate P&L from entry/exit prices
                                pnl_amount = (price * qty) - current_trade['entry_amount']
                                pnl_pct = (pnl_amount / current_trade['entry_amount']) * 100
                        
                        current_trade.update({
                            'exit_time': timestamp,
                            'exit_price': price,
                            'exit_amount': amount,
                            'exit_reason': alert_type,
                            'pnl_pct': pnl_pct,
                            'pnl_amount': pnl_amount,
                            'is_profit': pnl_pct > 0
                        })
                        
                        trades.append(current_trade.copy())
                        del open_trades[matching_key]
            
            console.print(f"[blue]📊 Parsed {len(trades)} completed trades[/blue]")
            return trades
            
        except Exception as e:
            console.print(f"[red]❌ Error parsing log file: {e}[/red]")
            return []

class TradeAnalyzer:
    """Main trade analysis engine"""
    
    def __init__(self, api_key: str = None, api_secret: str = None):
        # Use provided credentials or fall back to config
        if api_key and api_secret:
            self.upstox = UpstoxAPI(api_key=api_key, api_secret=api_secret)
        elif UPSTOX_CONFIG.get('api_key') and UPSTOX_CONFIG.get('api_secret'):
            self.upstox = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
        else:
            console.print("[red]❌ No Upstox credentials provided[/red]")
            self.upstox = None
        
        self.technical = TechnicalAnalyzer()
        
        # Authenticate if we have an API instance
        if self.upstox and not self.upstox.access_token:
            console.print("[blue]🔐 Authenticating with Upstox...[/blue]")
            if not self.upstox.authenticate():
                console.print("[red]❌ Upstox authentication failed[/red]")
                self.upstox = None
    
    def _fetch_smart_data(self, symbol: str, from_date: str, to_date: str, entry_time: pd.Timestamp, exit_time: pd.Timestamp) -> pd.DataFrame:
        """
        Smart data fetching that combines historical and intraday data
        Uses V3 intraday API for current day data and historical API for previous days
        """
        from datetime import datetime
        
        today = datetime.now().date()
        trade_date = entry_time.date()
        
        all_dataframes = []
        
        # If trade is from today, we need intraday data
        if trade_date == today:
            console.print(f"[dim]Trade from today - fetching intraday data for {symbol}[/dim]")
            
            # Get intraday data for today (1-minute for maximum precision)
            intraday_df = self.upstox.fetch_intraday_data_v3(
                symbol=symbol,
                unit="minutes",
                interval=1
            )
            
            if intraday_df is not None and not intraday_df.empty:
                console.print(f"[dim]✅ Got {len(intraday_df)} intraday records for today[/dim]")
                all_dataframes.append(intraday_df)
            else:
                console.print(f"[dim]⚠️ No intraday data available for {symbol} today[/dim]")
        
        # Get historical data for previous days (including today if intraday failed)
        if trade_date < today or not all_dataframes:
            console.print(f"[dim]Fetching historical data for {symbol}[/dim]")
            
            # For same-day trades, get at least previous day's data for context
            hist_to_date = to_date
            hist_from_date = from_date
            
            # If we have intraday data, we only need historical up to yesterday
            if all_dataframes and trade_date == today:
                yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
                hist_to_date = yesterday
            
            historical_df = self.upstox.fetch_historical_data_v3(
                symbol=symbol,
                unit="minutes",
                interval=1,  # Use 1-min for consistency with intraday
                to_date=hist_to_date,
                from_date=hist_from_date
            )
            
            if historical_df is not None and not historical_df.empty:
                console.print(f"[dim]✅ Got {len(historical_df)} historical records[/dim]")
                all_dataframes.append(historical_df)
        
        # Combine all dataframes
        if not all_dataframes:
            return pd.DataFrame()
        
        if len(all_dataframes) == 1:
            combined_df = all_dataframes[0]
        else:
            # Combine and sort by timestamp
            combined_df = pd.concat(all_dataframes)
            combined_df = combined_df.sort_index()
            
            # Remove duplicates (keep first occurrence)
            combined_df = combined_df[~combined_df.index.duplicated(keep='first')]
        
        console.print(f"[dim]📊 Combined dataset: {len(combined_df)} records total[/dim]")
        
        # Resample to 15-minute intervals for consistent analysis
        # This gives us the granularity we need while reducing noise
        if len(combined_df) > 0:
            resampled_df = combined_df.resample('15min').agg({
                'open': 'first',
                'high': 'max', 
                'low': 'min',
                'close': 'last',
                'volume': 'sum',
                'oi': 'last'
            }).dropna()
            
            console.print(f"[dim]📈 Resampled to 15-min intervals: {len(resampled_df)} candles[/dim]")
            return resampled_df
        
        return combined_df
        
    def analyze_trade(self, trade: Dict) -> Dict:
        """Analyze individual trade for failure reasons"""
        symbol = trade['symbol']
        entry_time = pd.to_datetime(trade['entry_time'])
        exit_time = pd.to_datetime(trade['exit_time'])
        
        if not self.upstox:
            return {'error': 'No Upstox API connection available'}
        
        # Fetch historical data around trade period using V3 API
        days_buffer = 5
        start_date = entry_time - timedelta(days=days_buffer)
        end_date = exit_time + timedelta(days=1)
        
        from_date = start_date.strftime('%Y-%m-%d')
        to_date = end_date.strftime('%Y-%m-%d')
        
        # Smart data fetching: combine historical + intraday for better coverage
        console.print(f"[dim]Fetching data for {symbol} from {from_date} to {to_date}[/dim]")
        df = self._fetch_smart_data(symbol, from_date, to_date, entry_time, exit_time)
        
        if df is None or df.empty:
            console.print(f"[yellow]⚠️ No data available for {symbol}[/yellow]")
            return {'error': 'No data available'}
        
        console.print(f"[dim]Data range: {df.index[0]} to {df.index[-1]} ({len(df)} records)[/dim]")
        console.print(f"[dim]Looking for entry: {entry_time}, exit: {exit_time}[/dim]")
        
        # Calculate indicators
        df = self.technical.calculate_indicators(df)
        
        # Find entry and exit points
        entry_idx = self._find_closest_timestamp(df, entry_time)
        exit_idx = self._find_closest_timestamp(df, exit_time)
        
        if entry_idx is None or exit_idx is None:
            return {'error': 'Cannot locate trade timestamps in data'}
        
        # Analyze market conditions at entry
        entry_analysis = self._analyze_entry_conditions(df, entry_idx, trade)
        
        # Analyze market conditions at exit  
        exit_analysis = self._analyze_exit_conditions(df, exit_idx, trade)
        
        # Determine failure reasons
        failure_reasons = self._categorize_failure(entry_analysis, exit_analysis, trade, df, entry_idx)
        
        return {
            'symbol': symbol,
            'trade_summary': trade,
            'entry_analysis': entry_analysis,
            'exit_analysis': exit_analysis,
            'failure_reasons': failure_reasons,
            'recommendations': self._generate_recommendations(failure_reasons, entry_analysis)
        }
    
    def _find_closest_timestamp(self, df: pd.DataFrame, target_time: pd.Timestamp) -> Optional[int]:
        """Find closest timestamp in DataFrame"""
        if df.empty:
            return None
        
        try:
            # Convert target_time to timezone-naive if df.index is timezone-naive
            if df.index.tz is None and target_time.tz is not None:
                target_time = target_time.tz_localize(None)
            elif df.index.tz is not None and target_time.tz is None:
                target_time = target_time.tz_localize(df.index.tz)
            
            # Calculate time differences manually to avoid pandas version issues
            best_idx = 0
            min_diff = abs((df.index[0] - target_time).total_seconds())
            
            for i, ts in enumerate(df.index):
                diff = abs((ts - target_time).total_seconds())
                if diff < min_diff:
                    min_diff = diff
                    best_idx = i
            
            # Only return if within reasonable timeframe (2 hours = 7200 seconds)
            if min_diff <= 7200:
                return best_idx
            else:
                return None
                
        except Exception as e:
            console.print(f"[red]⚠️ Error finding timestamp: {e}[/red]")
            return None
    
    def _analyze_entry_conditions(self, df: pd.DataFrame, entry_idx: int, trade: Dict) -> Dict:
        """Analyze market conditions at trade entry"""
        if entry_idx >= len(df):
            return {}
        
        row = df.iloc[entry_idx]
        
        # Look at previous candles for context
        lookback = min(20, entry_idx)
        prev_data = df.iloc[max(0, entry_idx-lookback):entry_idx+1]
        
        analysis = {
            'timestamp': row.name,  # Index is the timestamp
            'price': row['close'],
            'entry_price': trade['entry_price'],
            'price_accuracy': abs(row['close'] - trade['entry_price']) / trade['entry_price'] * 100,
            
            # Technical indicators at entry
            'rsi': row.get('rsi', 0),
            'macd': row.get('macd', 0),
            'macd_signal': row.get('macd_signal', 0),
            'bb_position': self._get_bb_position(row),
            'volume_ratio': row.get('volume_ratio', 1),
            
            # Trend analysis
            'trend_short': row.get('trend_short', 'neutral'),
            'trend_medium': row.get('trend_medium', 'neutral'),
            'trend_long': row.get('trend_long', 'neutral'),
            
            # Support/Resistance
            'near_support': self._is_near_level(row['close'], row.get('support_1', 0)),
            'near_resistance': self._is_near_level(row['close'], row.get('resistance_1', 0)),
            
            # Market structure
            'recent_high': prev_data['high'].max(),
            'recent_low': prev_data['low'].min(),
            'volatility': row.get('atr', 0),
            
            # Entry timing quality
            'entry_quality': self._assess_entry_quality(row, prev_data)
        }
        
        return analysis
    
    def _analyze_exit_conditions(self, df: pd.DataFrame, exit_idx: int, trade: Dict) -> Dict:
        """Analyze market conditions at trade exit"""
        if exit_idx >= len(df):
            return {}
        
        row = df.iloc[exit_idx]
        
        analysis = {
            'timestamp': row.name,  # Index is the timestamp
            'price': row['close'],
            'exit_price': trade['exit_price'],
            'exit_reason': trade.get('exit_reason', ''),
            'price_accuracy': abs(row['close'] - trade['exit_price']) / trade['exit_price'] * 100,
            
            # Market conditions at exit
            'rsi': row.get('rsi', 0),
            'trend_short': row.get('trend_short', 'neutral'),
            'volume_ratio': row.get('volume_ratio', 1),
            
            # Exit timing assessment
            'exit_timing': self._assess_exit_timing(trade.get('exit_reason', ''))
        }
        
        return analysis
    
    def _categorize_failure(self, entry_analysis: Dict, exit_analysis: Dict, trade: Dict, df: pd.DataFrame, entry_idx: int) -> List[str]:
        """Categorize reasons for trade failure"""
        reasons = []
        
        if not trade.get('is_profit', True):
            # Entry-related failures
            if entry_analysis.get('rsi', 50) > 80:
                reasons.append("OVERBOUGHT_ENTRY - RSI > 80 at entry")
            elif entry_analysis.get('rsi', 50) < 20:
                reasons.append("OVERSOLD_ENTRY - RSI < 20 at entry")
            
            if entry_analysis.get('near_resistance', False):
                reasons.append("RESISTANCE_ENTRY - Entered near resistance level")
            
            if entry_analysis.get('bb_position') == 'above_upper':
                reasons.append("BB_OVEREXTENDED - Entry above Bollinger Band upper")
            
            if entry_analysis.get('volume_ratio', 1) < 0.5:
                reasons.append("LOW_VOLUME - Poor volume support at entry")
            
            # Trend-related failures
            trends = [entry_analysis.get('trend_short'), entry_analysis.get('trend_medium'), entry_analysis.get('trend_long')]
            bearish_trends = sum(1 for t in trends if t in ['bearish', 'strong_bearish'])
            
            if bearish_trends >= 2 and trade.get('trade_side') == 'BUY':
                reasons.append("COUNTER_TREND - Buying against multiple bearish trends")
            
            # Market structure failures
            if entry_analysis.get('entry_quality', 'poor') == 'poor':
                reasons.append("POOR_ENTRY_TIMING - Suboptimal entry conditions")
            
            # Exit-related failures
            exit_reason = trade.get('exit_reason', '')
            if 'STOP LOSS' in exit_reason:
                reasons.append("STOP_LOSS_HIT - Trade hit stop loss")
            elif 'TRAILING STOP' in exit_reason:
                reasons.append("TRAILING_STOP - Profit given back to trailing stop")
            
            # Price movement analysis
            pnl_pct = trade.get('pnl_pct', 0)
            if pnl_pct < -2:
                reasons.append("LARGE_LOSS - Loss > 2%")
            elif pnl_pct < -0.5:
                reasons.append("MODERATE_LOSS - Loss 0.5-2%")
        
        return reasons if reasons else ["UNKNOWN_FAILURE"]
    
    def _generate_recommendations(self, failure_reasons: List[str], entry_analysis: Dict) -> List[str]:
        """Generate actionable recommendations"""
        recommendations = []
        
        for reason in failure_reasons:
            if "OVERBOUGHT" in reason:
                recommendations.append("Wait for RSI to drop below 70 before entering long positions")
            elif "OVERSOLD" in reason:
                recommendations.append("Wait for RSI to rise above 30 before entering short positions")
            elif "RESISTANCE" in reason:
                recommendations.append("Avoid entries near resistance levels, wait for breakout confirmation")
            elif "BB_OVEREXTENDED" in reason:
                recommendations.append("Avoid entries when price is extended beyond Bollinger Bands")
            elif "LOW_VOLUME" in reason:
                recommendations.append("Ensure volume is at least 50% above average before entry")
            elif "COUNTER_TREND" in reason:
                recommendations.append("Trade with the trend - wait for trend alignment across timeframes")
            elif "POOR_ENTRY_TIMING" in reason:
                recommendations.append("Improve entry timing using confluence of multiple indicators")
        
        return recommendations
    
    def _get_bb_position(self, row: pd.Series) -> str:
        """Determine position relative to Bollinger Bands"""
        close = row.get('close', 0)
        bb_upper = row.get('bb_upper', 0)
        bb_lower = row.get('bb_lower', 0)
        bb_middle = row.get('bb_middle', 0)
        
        if close > bb_upper:
            return 'above_upper'
        elif close < bb_lower:
            return 'below_lower'
        elif close > bb_middle:
            return 'upper_half'
        else:
            return 'lower_half'
    
    def _is_near_level(self, price: float, level: float, threshold: float = 0.5) -> bool:
        """Check if price is near support/resistance level"""
        if level == 0:
            return False
        return abs(price - level) / level * 100 <= threshold
    
    def _assess_entry_quality(self, row: pd.Series, prev_data: pd.DataFrame) -> str:
        """Assess quality of entry timing"""
        score = 0
        
        # RSI in reasonable range
        rsi = row.get('rsi', 50)
        if 30 <= rsi <= 70:
            score += 1
        
        # Volume support
        volume_ratio = row.get('volume_ratio', 1)
        if volume_ratio > 1.2:
            score += 1
        
        # Not overextended
        bb_pos = self._get_bb_position(row)
        if bb_pos in ['upper_half', 'lower_half']:
            score += 1
        
        # Trend alignment
        trends = [row.get('trend_short'), row.get('trend_medium'), row.get('trend_long')]
        bullish_trends = sum(1 for t in trends if t in ['bullish', 'strong_bullish'])
        if bullish_trends >= 2:
            score += 1
        
        if score >= 3:
            return 'excellent'
        elif score >= 2:
            return 'good'
        elif score >= 1:
            return 'fair'
        else:
            return 'poor'
    
    def _assess_exit_timing(self, exit_reason: str) -> str:
        """Assess quality of exit timing"""
        if 'STOP LOSS' in exit_reason:
            return 'forced_exit'
        elif 'TRAILING STOP' in exit_reason:
            return 'profit_protection'
        elif 'QUICK EXIT' in exit_reason:
            return 'quick_profit'
        elif 'SCRIPT_STOPPED' in exit_reason:
            return 'manual_exit'
        else:
            return 'unknown'

def generate_analysis_report(analyses: List[Dict]) -> None:
    """Generate comprehensive analysis report"""
    if not analyses:
        console.print("[red]No analyses to report[/red]")
        return
    
    # Summary statistics
    total_trades = len(analyses)
    losing_trades = [a for a in analyses if not a.get('trade_summary', {}).get('is_profit', True)]
    winning_trades = [a for a in analyses if a.get('trade_summary', {}).get('is_profit', True)]
    
    console.print(Panel.fit(f"📊 Trade Analysis Summary", style="bold blue"))
    
    # Summary table
    summary_table = Table(title="Overall Statistics", box=box.ROUNDED)
    summary_table.add_column("Metric", style="cyan")
    summary_table.add_column("Value", style="magenta")
    
    summary_table.add_row("Total Trades", str(total_trades))
    summary_table.add_row("Winning Trades", str(len(winning_trades)))
    summary_table.add_row("Losing Trades", str(len(losing_trades)))
    summary_table.add_row("Win Rate", f"{len(winning_trades)/total_trades*100:.1f}%" if total_trades > 0 else "0%")
    
    console.print(summary_table)
    
    # Failure reasons analysis
    if losing_trades:
        console.print(Panel.fit("❌ Losing Trade Analysis", style="bold red"))
        
        all_reasons = []
        for analysis in losing_trades:
            all_reasons.extend(analysis.get('failure_reasons', []))
        
        reason_counts = {}
        for reason in all_reasons:
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
        
        # Failure reasons table
        failure_table = Table(title="Common Failure Reasons", box=box.ROUNDED)
        failure_table.add_column("Failure Reason", style="red")
        failure_table.add_column("Count", style="yellow")
        failure_table.add_column("% of Losses", style="green")
        
        for reason, count in sorted(reason_counts.items(), key=lambda x: x[1], reverse=True):
            pct = count / len(losing_trades) * 100
            failure_table.add_row(reason, str(count), f"{pct:.1f}%")
        
        console.print(failure_table)
        
        # Detailed losing trades
        console.print(Panel.fit("🔍 Detailed Losing Trade Analysis", style="bold yellow"))
        
        for i, analysis in enumerate(losing_trades[:5], 1):  # Show top 5 losing trades
            trade = analysis.get('trade_summary', {})
            entry_analysis = analysis.get('entry_analysis', {})
            failure_reasons = analysis.get('failure_reasons', [])
            recommendations = analysis.get('recommendations', [])
            
            console.print(f"\n[bold cyan]Trade #{i}: {trade.get('symbol', 'Unknown')}[/bold cyan]")
            console.print(f"Entry: ₹{trade.get('entry_price', 0):.2f} → Exit: ₹{trade.get('exit_price', 0):.2f}")
            console.print(f"P&L: {trade.get('pnl_pct', 0):+.2f}% (₹{trade.get('pnl_amount', 0):+,.0f})")
            console.print(f"RSI at Entry: {entry_analysis.get('rsi', 0):.1f}")
            console.print(f"Trends: Short={entry_analysis.get('trend_short', 'N/A')}, Medium={entry_analysis.get('trend_medium', 'N/A')}")
            
            console.print("[red]Failure Reasons:[/red]")
            for reason in failure_reasons:
                console.print(f"  • {reason}")
            
            console.print("[green]Recommendations:[/green]")
            for rec in recommendations:
                console.print(f"  → {rec}")
    
    # Winning trades analysis
    if winning_trades:
        console.print(Panel.fit("✅ Winning Trade Analysis", style="bold green"))
        
        # Analyze success patterns - Technical factors beyond timing
        success_patterns = {}
        technical_factors = {}
        
        for analysis in winning_trades:
            entry_analysis = analysis.get('entry_analysis', {})
            trade = analysis.get('trade_summary', {})
            
            # RSI ranges (detailed)
            rsi = entry_analysis.get('rsi', 50)
            if not pd.isna(rsi):
                if rsi < 30:
                    success_patterns['RSI_OVERSOLD_<30'] = success_patterns.get('RSI_OVERSOLD_<30', 0) + 1
                elif rsi < 50:
                    success_patterns['RSI_NEUTRAL_30-50'] = success_patterns.get('RSI_NEUTRAL_30-50', 0) + 1
                elif rsi < 70:
                    success_patterns['RSI_BULLISH_50-70'] = success_patterns.get('RSI_BULLISH_50-70', 0) + 1
                elif rsi < 80:
                    success_patterns['RSI_OVERBOUGHT_70-80'] = success_patterns.get('RSI_OVERBOUGHT_70-80', 0) + 1
                else:
                    success_patterns['RSI_EXTREME_>80'] = success_patterns.get('RSI_EXTREME_>80', 0) + 1
                    
                # Collect actual RSI values
                technical_factors.setdefault('rsi_values', []).append(rsi)
            
            # Volume analysis
            volume_ratio = entry_analysis.get('volume_ratio', 1)
            if not pd.isna(volume_ratio):
                if volume_ratio > 2.0:
                    success_patterns['HIGH_VOLUME_>2x'] = success_patterns.get('HIGH_VOLUME_>2x', 0) + 1
                elif volume_ratio > 1.5:
                    success_patterns['GOOD_VOLUME_1.5-2x'] = success_patterns.get('GOOD_VOLUME_1.5-2x', 0) + 1
                elif volume_ratio > 1.0:
                    success_patterns['ABOVE_AVG_VOLUME'] = success_patterns.get('ABOVE_AVG_VOLUME', 0) + 1
                else:
                    success_patterns['LOW_VOLUME_<1x'] = success_patterns.get('LOW_VOLUME_<1x', 0) + 1
                    
                technical_factors.setdefault('volume_ratios', []).append(volume_ratio)
            
            # Bollinger Band position
            bb_position = entry_analysis.get('bb_position', 'unknown')
            if bb_position != 'unknown':
                success_patterns[f'BB_{bb_position.upper()}'] = success_patterns.get(f'BB_{bb_position.upper()}', 0) + 1
            
            # Support/Resistance proximity
            near_support = entry_analysis.get('near_support', False)
            near_resistance = entry_analysis.get('near_resistance', False)
            if near_support:
                success_patterns['NEAR_SUPPORT'] = success_patterns.get('NEAR_SUPPORT', 0) + 1
            if near_resistance:
                success_patterns['NEAR_RESISTANCE'] = success_patterns.get('NEAR_RESISTANCE', 0) + 1
            if not near_support and not near_resistance:
                success_patterns['AWAY_FROM_LEVELS'] = success_patterns.get('AWAY_FROM_LEVELS', 0) + 1
            
            # Entry quality assessment
            entry_quality = entry_analysis.get('entry_quality', 'unknown')
            if entry_quality != 'unknown':
                success_patterns[f'ENTRY_{entry_quality.upper()}'] = success_patterns.get(f'ENTRY_{entry_quality.upper()}', 0) + 1
            
            # MACD signal
            macd = entry_analysis.get('macd', 0)
            macd_signal = entry_analysis.get('macd_signal', 0)
            if not pd.isna(macd) and not pd.isna(macd_signal):
                if macd > macd_signal:
                    success_patterns['MACD_BULLISH'] = success_patterns.get('MACD_BULLISH', 0) + 1
                else:
                    success_patterns['MACD_BEARISH'] = success_patterns.get('MACD_BEARISH', 0) + 1
            
            # Volatility (ATR based)
            volatility = entry_analysis.get('volatility', 0)
            if not pd.isna(volatility) and volatility > 0:
                if volatility > 5:  # High volatility threshold
                    success_patterns['HIGH_VOLATILITY'] = success_patterns.get('HIGH_VOLATILITY', 0) + 1
                else:
                    success_patterns['LOW_VOLATILITY'] = success_patterns.get('LOW_VOLATILITY', 0) + 1
            
            # Time patterns (keeping but less emphasis)
            entry_time = pd.to_datetime(trade.get('entry_time', ''))
            hour = entry_time.hour
            if 9 <= hour < 12:
                success_patterns['MORNING_SESSION'] = success_patterns.get('MORNING_SESSION', 0) + 1
            elif 12 <= hour < 15:
                success_patterns['AFTERNOON_SESSION'] = success_patterns.get('AFTERNOON_SESSION', 0) + 1
            elif hour >= 15:
                success_patterns['LATE_SESSION'] = success_patterns.get('LATE_SESSION', 0) + 1
        
        # Success patterns table
        success_table = Table(title="Success Patterns", box=box.ROUNDED)
        success_table.add_column("Success Factor", style="green")
        success_table.add_column("Count", style="yellow")
        success_table.add_column("% of Wins", style="cyan")
        
        for pattern, count in sorted(success_patterns.items(), key=lambda x: x[1], reverse=True):
            pct = count / len(winning_trades) * 100
            success_table.add_row(pattern.replace('_', ' ').title(), str(count), f"{pct:.1f}%")
        
        console.print(success_table)
        
        # Detailed winning trades
        console.print(f"\n[bold green]Top Performing Trades:[/bold green]")
        
        for i, analysis in enumerate(winning_trades[:3], 1):  # Show top 3 winning trades
            trade = analysis.get('trade_summary', {})
            entry_analysis = analysis.get('entry_analysis', {})
            
            console.print(f"\n[bold green]Winning Trade #{i}: {trade.get('symbol', 'Unknown')}[/bold green]")
            console.print(f"Entry: ₹{trade.get('entry_price', 0):.2f} → Exit: ₹{trade.get('exit_price', 0):.2f}")
            console.print(f"P&L: {trade.get('pnl_pct', 0):+.2f}% (₹{trade.get('pnl_amount', 0):+,.0f})")
            console.print(f"RSI at Entry: {entry_analysis.get('rsi', 0):.1f}")
            console.print(f"Volume Ratio: {entry_analysis.get('volume_ratio', 1):.2f}x")
            console.print(f"Entry Quality: {entry_analysis.get('entry_quality', 'Unknown')}")
            console.print(f"BB Position: {entry_analysis.get('bb_position', 'Unknown')}")
            console.print(f"Near Support: {entry_analysis.get('near_support', False)}")
            console.print(f"Near Resistance: {entry_analysis.get('near_resistance', False)}")
            
            # Technical success factors
            success_factors = []
            rsi = entry_analysis.get('rsi', 50)
            if not pd.isna(rsi):
                if 30 <= rsi <= 70:
                    success_factors.append("OPTIMAL_RSI_RANGE (30-70)")
                elif rsi > 80:
                    success_factors.append("OVERBOUGHT_BUT_WORKED (RSI>80)")
            
            volume_ratio = entry_analysis.get('volume_ratio', 1)
            if not pd.isna(volume_ratio):
                if volume_ratio > 1.5:
                    success_factors.append("STRONG_VOLUME_SUPPORT")
                elif volume_ratio > 1.0:
                    success_factors.append("ABOVE_AVERAGE_VOLUME")
                else:
                    success_factors.append("LOW_VOLUME_ENTRY")
            
            bb_position = entry_analysis.get('bb_position', '')
            if bb_position in ['upper_half', 'lower_half']:
                success_factors.append("BB_MIDDLE_BANDS")
            elif bb_position == 'above_upper':
                success_factors.append("BB_BREAKOUT_ABOVE")
            elif bb_position == 'below_lower':
                success_factors.append("BB_OVERSOLD")
            
            entry_quality = entry_analysis.get('entry_quality', '')
            if entry_quality in ['excellent', 'good']:
                success_factors.append(f"HIGH_QUALITY_ENTRY ({entry_quality.upper()})")
            
            if entry_analysis.get('near_support', False):
                success_factors.append("SUPPORT_LEVEL_BOUNCE")
            elif not entry_analysis.get('near_resistance', False):
                success_factors.append("CLEAR_OF_RESISTANCE")
            
            if success_factors:
                console.print("[green]Technical Success Factors:[/green]")
                for factor in success_factors:
                    console.print(f"  ✓ {factor}")
            
            # Add MACD and other technical details
            macd = entry_analysis.get('macd', 0)
            macd_signal = entry_analysis.get('macd_signal', 0)
            volatility = entry_analysis.get('volatility', 0)
            
            console.print(f"[dim]MACD: {macd:.3f}, Signal: {macd_signal:.3f}, ATR: {volatility:.2f}[/dim]")
    
    # Overall insights
    console.print(Panel.fit("🧠 Key Insights", style="bold blue"))
    
    if winning_trades and losing_trades:
        # Compare average RSI
        win_rsi = [w.get('entry_analysis', {}).get('rsi', 50) for w in winning_trades]
        lose_rsi = [l.get('entry_analysis', {}).get('rsi', 50) for l in losing_trades]
        
        avg_win_rsi = sum(win_rsi) / len(win_rsi) if win_rsi else 50
        avg_lose_rsi = sum(lose_rsi) / len(lose_rsi) if lose_rsi else 50
        
        console.print(f"[green]✅ Avg RSI for Wins: {avg_win_rsi:.1f}[/green]")
        console.print(f"[red]❌ Avg RSI for Losses: {avg_lose_rsi:.1f}[/red]")
        
        # Time-based insights
        win_times = [pd.to_datetime(w.get('trade_summary', {}).get('entry_time', '')).hour for w in winning_trades]
        lose_times = [pd.to_datetime(l.get('trade_summary', {}).get('entry_time', '')).hour for l in losing_trades]
        
        win_morning = sum(1 for h in win_times if 9 <= h < 12)
        lose_afternoon = sum(1 for h in lose_times if h >= 15)
        
        if win_morning > 0:
            console.print(f"[green]✅ Morning trades (9-12): {win_morning}/{len(winning_trades)} wins[/green]")
        if lose_afternoon > 0:
            console.print(f"[red]❌ Late trades (15+): {lose_afternoon}/{len(losing_trades)} losses[/red]")
        
        console.print(f"\n[bold]💡 Optimization Recommendations:[/bold]")
        if avg_win_rsi < avg_lose_rsi:
            console.print("• Enter when RSI is closer to neutral (30-70) rather than overbought")
        if win_morning > 0 and lose_afternoon > 0:
            console.print("• Focus on morning session entries (9-12 AM)")
            console.print("• Avoid new entries after 3 PM")

def main():
    parser = argparse.ArgumentParser(description='Comprehensive Trade Analyzer')
    parser.add_argument('--log-file', required=True, help='Path to trade log file')
    parser.add_argument('--api-key', help='Upstox API key (optional if config.py exists)')
    parser.add_argument('--api-secret', help='Upstox API secret (optional if config.py exists)')
    parser.add_argument('--losing-only', action='store_true', help='Analyze only losing trades')
    parser.add_argument('--demo', action='store_true', help='Demo mode - parse log only without technical analysis')
    
    args = parser.parse_args()
    
    console.print(Panel.fit("🔍 Comprehensive Trade Analyzer", style="bold blue"))
    
    # Parse trade log
    parser = TradeLogParser()
    trades = parser.parse_log_file(args.log_file)
    
    if not trades:
        console.print("[red]No trades found in log file[/red]")
        return
    
    # Filter losing trades if requested
    if args.losing_only:
        trades = [t for t in trades if not t.get('is_profit', True)]
        console.print(f"[yellow]Focusing on {len(trades)} losing trades[/yellow]")
    
    # Demo mode - just show parsed trades
    if args.demo:
        console.print(Panel.fit("📊 Demo Mode - Log Parsing Only", style="bold yellow"))
        
        for i, trade in enumerate(trades, 1):
            console.print(f"\n[cyan]Trade {i}: {trade['symbol']}[/cyan]")
            console.print(f"Entry: {trade['entry_time']} at ₹{trade['entry_price']}")
            console.print(f"Exit: {trade['exit_time']} at ₹{trade['exit_price']}")
            console.print(f"P&L: {trade.get('pnl_pct', 0):+.2f}% (₹{trade.get('pnl_amount', 0):+,.0f})")
            console.print(f"Result: {'✅ Profit' if trade.get('is_profit', True) else '❌ Loss'}")
        
        console.print(f"\n[blue]Summary: {len(trades)} trades parsed from log file[/blue]")
        return
    
    # Check if we have credentials
    if not args.api_key and not args.api_secret and not (UPSTOX_CONFIG.get('api_key') and UPSTOX_CONFIG.get('api_secret')):
        console.print("[red]API credentials required for full analysis. Use --demo for log parsing only.[/red]")
        console.print("[yellow]Either provide --api-key and --api-secret or configure config.py[/yellow]")
        return
    
    # Analyze trades
    analyzer = TradeAnalyzer(api_key=args.api_key, api_secret=args.api_secret)
    analyses = []
    
    for i, trade in enumerate(trades, 1):
        console.print(f"[blue]Analyzing trade {i}/{len(trades)}: {trade['symbol']}[/blue]")
        analysis = analyzer.analyze_trade(trade)
        
        if 'error' not in analysis:
            analyses.append(analysis)
        else:
            console.print(f"[red]⚠️ Skipped {trade['symbol']}: {analysis['error']}[/red]")
    
    # Generate report
    generate_analysis_report(analyses)
    
    console.print(Panel.fit("✅ Analysis Complete", style="bold green"))

if __name__ == "__main__":
    main()