#!/usr/bin/env python3
"""
Holdings Breakout Analyzer
Analyzes breakout patterns for your stock holdings across multiple timeframes
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import yfinance as yf
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import warnings
warnings.filterwarnings('ignore')

class MultiTimeframeBreakoutAnalyzer:
    """
    Analyzes breakout patterns across multiple timeframes using Smart Money concepts
    """
    
    def __init__(self):
        self.timeframes = {
            '1h': {'period': '30d', 'interval': '1h'},
            '4h': {'period': '60d', 'interval': '4h'}, 
            '1d': {'period': '1y', 'interval': '1d'}
        }
        self.holdings = [
            'TATAMOTORS.NS',
            'RELIANCE.NS', 
            'TCS.NS',
            'INFY.NS',
            'HDFCBANK.NS',
            'ICICIBANK.NS',
            'BHARTIARTL.NS',
            'ITC.NS'
        ]
        
    def fetch_data(self, symbol: str, timeframe: str) -> Optional[pd.DataFrame]:
        """Fetch OHLCV data for given symbol and timeframe"""
        try:
            ticker = yf.Ticker(symbol)
            config = self.timeframes[timeframe]
            data = ticker.history(period=config['period'], interval=config['interval'])
            
            if data.empty:
                print(f"❌ No data for {symbol} on {timeframe}")
                return None
                
            # Ensure we have required columns
            required_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
            if not all(col in data.columns for col in required_cols):
                print(f"❌ Missing required columns for {symbol}")
                return None
                
            return data
            
        except Exception as e:
            print(f"❌ Error fetching {symbol} {timeframe}: {e}")
            return None
    
    def calculate_breakout_levels(self, df: pd.DataFrame, lookback: int = 20) -> Dict:
        """Calculate key breakout levels"""
        if len(df) < lookback:
            return {}
        
        recent_data = df.tail(lookback)
        
        # Key levels
        resistance = recent_data['High'].max()
        support = recent_data['Low'].min()
        
        # Volume analysis
        avg_volume = df['Volume'].rolling(window=20).mean().iloc[-1]
        recent_volume = df['Volume'].iloc[-1]
        volume_ratio = recent_volume / avg_volume if avg_volume > 0 else 1
        
        # ATR for volatility
        high_low = df['High'] - df['Low']
        high_close = np.abs(df['High'] - df['Close'].shift())
        low_close = np.abs(df['Low'] - df['Close'].shift())
        true_range = np.maximum(high_low, np.maximum(high_close, low_close))
        atr = true_range.rolling(window=14).mean().iloc[-1]
        
        # Current position relative to range
        current_price = df['Close'].iloc[-1]
        range_position = (current_price - support) / (resistance - support) if resistance != support else 0.5
        
        return {
            'resistance': resistance,
            'support': support,
            'current_price': current_price,
            'atr': atr,
            'range_position': range_position,
            'volume_ratio': volume_ratio,
            'range_width': resistance - support,
            'breakout_threshold_up': resistance + (atr * 0.1),
            'breakout_threshold_down': support - (atr * 0.1)
        }
    
    def detect_breakout_status(self, levels: Dict) -> Dict:
        """Detect current breakout status"""
        if not levels:
            return {'status': 'insufficient_data', 'signal': 'none'}
        
        current = levels['current_price']
        resistance = levels['resistance']
        support = levels['support']
        breakout_up = levels['breakout_threshold_up']
        breakout_down = levels['breakout_threshold_down']
        volume_ratio = levels['volume_ratio']
        range_pos = levels['range_position']
        
        # Breakout conditions
        if current >= breakout_up and volume_ratio >= 1.5:
            return {
                'status': 'bullish_breakout',
                'signal': 'strong_buy',
                'confidence': min(volume_ratio / 2, 1.0),
                'target': resistance + levels['atr'],
                'stop_loss': resistance
            }
        elif current <= breakout_down and volume_ratio >= 1.5:
            return {
                'status': 'bearish_breakout', 
                'signal': 'strong_sell',
                'confidence': min(volume_ratio / 2, 1.0),
                'target': support - levels['atr'],
                'stop_loss': support
            }
        elif current > resistance:
            return {
                'status': 'above_resistance',
                'signal': 'buy',
                'confidence': 0.6,
                'target': resistance + levels['atr'],
                'stop_loss': resistance - levels['atr'] * 0.5
            }
        elif current < support:
            return {
                'status': 'below_support',
                'signal': 'sell', 
                'confidence': 0.6,
                'target': support - levels['atr'],
                'stop_loss': support + levels['atr'] * 0.5
            }
        elif range_pos > 0.8:
            return {
                'status': 'near_resistance',
                'signal': 'watch_buy',
                'confidence': 0.4,
                'target': breakout_up,
                'stop_loss': current - levels['atr'] * 0.5
            }
        elif range_pos < 0.2:
            return {
                'status': 'near_support',
                'signal': 'watch_sell',
                'confidence': 0.4,
                'target': breakout_down,
                'stop_loss': current + levels['atr'] * 0.5
            }
        else:
            return {
                'status': 'consolidation',
                'signal': 'hold',
                'confidence': 0.2,
                'target': None,
                'stop_loss': None
            }
    
    def analyze_holding(self, symbol: str) -> Dict:
        """Analyze breakouts for a single holding across all timeframes"""
        results = {
            'symbol': symbol,
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'timeframes': {}
        }
        
        print(f"\n🔍 Analyzing {symbol}...")
        
        for tf in self.timeframes.keys():
            print(f"  📊 Fetching {tf} data...")
            df = self.fetch_data(symbol, tf)
            
            if df is not None:
                levels = self.calculate_breakout_levels(df)
                breakout = self.detect_breakout_status(levels)
                
                results['timeframes'][tf] = {
                    'levels': levels,
                    'breakout': breakout,
                    'bars_count': len(df)
                }
                
                # Print summary for this timeframe
                if breakout['signal'] in ['strong_buy', 'strong_sell', 'buy', 'sell']:
                    signal_emoji = "🟢" if 'buy' in breakout['signal'] else "🔴"
                    print(f"    {signal_emoji} {tf}: {breakout['status']} - {breakout['signal']} (conf: {breakout['confidence']:.1f})")
                else:
                    print(f"    ⚪ {tf}: {breakout['status']}")
            else:
                results['timeframes'][tf] = None
                print(f"    ❌ {tf}: No data")
        
        return results
    
    def analyze_all_holdings(self) -> List[Dict]:
        """Analyze all holdings"""
        print("🚀 Starting Multi-Timeframe Breakout Analysis")
        print("=" * 50)
        
        all_results = []
        
        for symbol in self.holdings:
            try:
                result = self.analyze_holding(symbol)
                all_results.append(result)
            except Exception as e:
                print(f"❌ Error analyzing {symbol}: {e}")
                continue
        
        return all_results
    
    def print_summary(self, results: List[Dict]):
        """Print summary of breakout analysis"""
        print("\n" + "=" * 60)
        print("📋 BREAKOUT ANALYSIS SUMMARY")
        print("=" * 60)
        
        # Count signals by type
        signal_counts = {}
        breakout_opportunities = []
        
        for result in results:
            symbol = result['symbol']
            
            for tf, data in result['timeframes'].items():
                if data and data['breakout']:
                    signal = data['breakout']['signal']
                    signal_counts[signal] = signal_counts.get(signal, 0) + 1
                    
                    if signal in ['strong_buy', 'strong_sell', 'buy', 'sell']:
                        breakout_opportunities.append({
                            'symbol': symbol,
                            'timeframe': tf,
                            'signal': signal,
                            'status': data['breakout']['status'],
                            'confidence': data['breakout']['confidence'],
                            'current_price': data['levels']['current_price'],
                            'target': data['breakout']['target'],
                            'stop_loss': data['breakout']['stop_loss']
                        })
        
        # Print signal distribution
        print(f"\n📊 Signal Distribution:")
        for signal, count in sorted(signal_counts.items()):
            emoji = "🟢" if 'buy' in signal else "🔴" if 'sell' in signal else "⚪"
            print(f"  {emoji} {signal}: {count}")
        
        # Print top opportunities
        if breakout_opportunities:
            print(f"\n🎯 BREAKOUT OPPORTUNITIES ({len(breakout_opportunities)}):")
            print("-" * 80)
            print(f"{'Symbol':<12} {'TF':<4} {'Signal':<12} {'Status':<20} {'Conf':<6} {'Price':<8} {'Target':<8}")
            print("-" * 80)
            
            # Sort by confidence descending
            breakout_opportunities.sort(key=lambda x: x['confidence'], reverse=True)
            
            for opp in breakout_opportunities:
                symbol_short = opp['symbol'].replace('.NS', '')
                signal_emoji = "🟢" if 'buy' in opp['signal'] else "🔴"
                
                print(f"{symbol_short:<12} {opp['timeframe']:<4} {signal_emoji} {opp['signal']:<10} "
                      f"{opp['status']:<20} {opp['confidence']:.1f}{'%':<5} "
                      f"{opp['current_price']:<8.1f} {opp['target']:<8.1f}")
        else:
            print("\n📝 No immediate breakout opportunities found.")
            print("💡 Look for symbols in consolidation that are near support/resistance levels.")


def main():
    """Main execution function"""
    analyzer = MultiTimeframeBreakoutAnalyzer()
    
    # Analyze all holdings
    results = analyzer.analyze_all_holdings()
    
    # Print summary
    analyzer.print_summary(results)
    
    print(f"\n✅ Analysis complete at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("💡 Monitor symbols with 'watch_buy' or 'watch_sell' signals for potential breakouts")


if __name__ == "__main__":
    main()