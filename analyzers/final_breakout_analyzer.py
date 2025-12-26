#!/usr/bin/env python3
"""
Final Holdings Breakout Analyzer
Enhanced multi-timeframe breakout detection with detailed price levels and Smart Money concepts
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import yfinance as yf
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import warnings
warnings.filterwarnings('ignore')

class SmartMoneyBreakoutAnalyzer:
    """
    Advanced breakout analyzer using Smart Money concepts
    """
    
    def __init__(self, custom_holdings: List[str] = None):
        self.timeframes = {
            '1h': {'period': '30d', 'interval': '1h', 'lookback': 20},
            '4h': {'period': '60d', 'interval': '4h', 'lookback': 20}, 
            '1d': {'period': '1y', 'interval': '1d', 'lookback': 20}
        }
        
        self.holdings = custom_holdings or [
            'TATAMOTORS.NS',  # Your specified holdings
            'RELIANCE.NS',
            'TCS.NS',
            'INFY.NS',
            'HDFCBANK.NS',
            'ICICIBANK.NS',
            'BHARTIARTL.NS',
            'ITC.NS',
            'HINDUNILVR.NS',
            'ASIANPAINT.NS'
        ]
        
    def fetch_data(self, symbol: str, timeframe: str) -> Optional[pd.DataFrame]:
        """Fetch OHLCV data with enhanced error handling"""
        try:
            ticker = yf.Ticker(symbol)
            config = self.timeframes[timeframe]
            data = ticker.history(period=config['period'], interval=config['interval'])
            
            if data.empty or len(data) < 10:
                return None
                
            # Clean data
            data = data.dropna()
            return data
            
        except Exception as e:
            print(f"❌ Error fetching {symbol} {timeframe}: {e}")
            return None
    
    def calculate_smart_money_levels(self, df: pd.DataFrame, lookback: int = 20) -> Dict:
        """Calculate Smart Money breakout levels with enhanced analysis"""
        if len(df) < lookback:
            return {}
        
        recent_data = df.tail(lookback)
        
        # Key levels calculation
        resistance = recent_data['High'].max()
        support = recent_data['Low'].min()
        current_price = df['Close'].iloc[-1]
        
        # Enhanced volume analysis
        volume_sma_20 = df['Volume'].rolling(window=20).mean()
        volume_sma_50 = df['Volume'].rolling(window=50).mean() if len(df) >= 50 else volume_sma_20
        
        avg_volume = volume_sma_20.iloc[-1] if not pd.isna(volume_sma_20.iloc[-1]) else 1
        recent_volume = df['Volume'].iloc[-1]
        volume_ratio = recent_volume / avg_volume if avg_volume > 0 else 1
        
        # Volume trend (increasing/decreasing)
        volume_trend = "increasing" if volume_sma_20.iloc[-1] > volume_sma_50.iloc[-1] else "decreasing"
        
        # Enhanced ATR calculation
        high_low = df['High'] - df['Low']
        high_close = np.abs(df['High'] - df['Close'].shift())
        low_close = np.abs(df['Low'] - df['Close'].shift())
        true_range = np.maximum(high_low, np.maximum(high_close, low_close))
        atr = true_range.rolling(window=14).mean().iloc[-1]
        
        # Range analysis
        range_width = resistance - support
        range_position = (current_price - support) / range_width if range_width > 0 else 0.5
        
        # Smart Money breakout thresholds (more conservative)
        breakout_buffer = atr * 0.15  # Smaller buffer for more sensitive detection
        breakout_threshold_up = resistance + breakout_buffer
        breakout_threshold_down = support - breakout_buffer
        
        # Price momentum
        price_change_pct = ((current_price - df['Close'].iloc[-5]) / df['Close'].iloc[-5]) * 100 if len(df) >= 5 else 0
        
        # Consolidation strength (lower is tighter consolidation)
        consolidation_strength = (range_width / current_price) * 100
        
        return {
            'resistance': resistance,
            'support': support,
            'current_price': current_price,
            'atr': atr,
            'range_position': range_position,
            'volume_ratio': volume_ratio,
            'volume_trend': volume_trend,
            'range_width': range_width,
            'range_width_pct': consolidation_strength,
            'breakout_threshold_up': breakout_threshold_up,
            'breakout_threshold_down': breakout_threshold_down,
            'price_momentum_5d': price_change_pct,
            'avg_volume': avg_volume,
            'recent_volume': recent_volume
        }
    
    def detect_breakout_signals(self, levels: Dict) -> Dict:
        """Enhanced breakout signal detection with Smart Money concepts"""
        if not levels:
            return {'status': 'insufficient_data', 'signal': 'none', 'confidence': 0}
        
        current = levels['current_price']
        resistance = levels['resistance']
        support = levels['support']
        breakout_up = levels['breakout_threshold_up']
        breakout_down = levels['breakout_threshold_down']
        volume_ratio = levels['volume_ratio']
        range_pos = levels['range_position']
        momentum = levels['price_momentum_5d']
        consolidation = levels['range_width_pct']
        
        # Enhanced breakout conditions with Smart Money concepts
        
        # Strong breakouts (volume + price action)
        if current >= breakout_up and volume_ratio >= 2.0 and momentum > 2:
            confidence = min((volume_ratio * momentum) / 10, 0.95)
            return {
                'status': 'bullish_breakout',
                'signal': 'strong_buy',
                'confidence': confidence,
                'target': resistance + levels['atr'] * 1.5,
                'stop_loss': resistance - levels['atr'] * 0.5,
                'reason': f'Volume {volume_ratio:.1f}x, momentum +{momentum:.1f}%'
            }
        
        elif current <= breakout_down and volume_ratio >= 2.0 and momentum < -2:
            confidence = min((volume_ratio * abs(momentum)) / 10, 0.95)
            return {
                'status': 'bearish_breakout',
                'signal': 'strong_sell', 
                'confidence': confidence,
                'target': support - levels['atr'] * 1.5,
                'stop_loss': support + levels['atr'] * 0.5,
                'reason': f'Volume {volume_ratio:.1f}x, momentum {momentum:.1f}%'
            }
        
        # Medium strength signals
        elif current > resistance and volume_ratio >= 1.3:
            return {
                'status': 'above_resistance',
                'signal': 'buy',
                'confidence': 0.7,
                'target': resistance + levels['atr'],
                'stop_loss': resistance - levels['atr'] * 0.3,
                'reason': f'Above resistance, volume {volume_ratio:.1f}x'
            }
        
        elif current < support and volume_ratio >= 1.3:
            return {
                'status': 'below_support',
                'signal': 'sell',
                'confidence': 0.7,
                'target': support - levels['atr'],
                'stop_loss': support + levels['atr'] * 0.3,
                'reason': f'Below support, volume {volume_ratio:.1f}x'
            }
        
        # Watch signals (near levels with good setup)
        elif range_pos > 0.85 and consolidation < 5 and momentum >= 0:
            return {
                'status': 'near_resistance_tight',
                'signal': 'watch_buy',
                'confidence': 0.6,
                'target': breakout_up,
                'stop_loss': current - levels['atr'] * 0.5,
                'reason': f'Tight consolidation near resistance, range {consolidation:.1f}%'
            }
        
        elif range_pos < 0.15 and consolidation < 5 and momentum <= 0:
            return {
                'status': 'near_support_tight',
                'signal': 'watch_sell',
                'confidence': 0.6,
                'target': breakout_down,
                'stop_loss': current + levels['atr'] * 0.5,
                'reason': f'Tight consolidation near support, range {consolidation:.1f}%'
            }
        
        # Regular watch signals
        elif range_pos > 0.75:
            return {
                'status': 'near_resistance',
                'signal': 'watch_buy',
                'confidence': 0.4,
                'target': breakout_up,
                'stop_loss': current - levels['atr'] * 0.5,
                'reason': 'Near resistance level'
            }
        
        elif range_pos < 0.25:
            return {
                'status': 'near_support',
                'signal': 'watch_sell',
                'confidence': 0.4,
                'target': breakout_down,
                'stop_loss': current + levels['atr'] * 0.5,
                'reason': 'Near support level'
            }
        
        else:
            return {
                'status': 'consolidation',
                'signal': 'hold',
                'confidence': 0.2,
                'target': None,
                'stop_loss': None,
                'reason': f'Mid-range consolidation, range {consolidation:.1f}%'
            }
    
    def analyze_holding(self, symbol: str, verbose: bool = True) -> Dict:
        """Analyze breakouts for a single holding with detailed output"""
        results = {
            'symbol': symbol,
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'timeframes': {}
        }
        
        if verbose:
            print(f"\n🔍 Analyzing {symbol.replace('.NS', '')}...")
        
        for tf in self.timeframes.keys():
            if verbose:
                print(f"  📊 {tf} timeframe...")
            
            df = self.fetch_data(symbol, tf)
            
            if df is not None:
                lookback = self.timeframes[tf]['lookback']
                levels = self.calculate_smart_money_levels(df, lookback)
                breakout = self.detect_breakout_signals(levels)
                
                results['timeframes'][tf] = {
                    'levels': levels,
                    'breakout': breakout,
                    'bars_count': len(df),
                    'last_update': df.index[-1].strftime('%Y-%m-%d %H:%M') if not df.empty else 'N/A'
                }
                
                # Enhanced output
                if verbose and breakout['signal'] in ['strong_buy', 'strong_sell', 'buy', 'sell']:
                    signal_emoji = "🟢" if 'buy' in breakout['signal'] else "🔴"
                    print(f"    {signal_emoji} {tf}: {breakout['status']} - {breakout['signal']}")
                    print(f"       Confidence: {breakout['confidence']:.1f}, Target: {breakout['target']:.1f}")
                    print(f"       Reason: {breakout['reason']}")
                elif verbose and breakout['signal'] in ['watch_buy', 'watch_sell']:
                    watch_emoji = "👀"
                    print(f"    {watch_emoji} {tf}: {breakout['status']} - {breakout['signal']}")
                    print(f"       {breakout['reason']}")
                elif verbose:
                    print(f"    ⚪ {tf}: {breakout['status']}")
            else:
                results['timeframes'][tf] = None
                if verbose:
                    print(f"    ❌ {tf}: No data")
        
        return results
    
    def analyze_all_holdings(self) -> List[Dict]:
        """Analyze all holdings with enhanced reporting"""
        print("🚀 SMART MONEY BREAKOUT ANALYSIS")
        print("=" * 60)
        print(f"📅 Analysis Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"📊 Holdings Count: {len(self.holdings)}")
        print(f"⏱️  Timeframes: {', '.join(self.timeframes.keys())}")
        print("=" * 60)
        
        all_results = []
        
        for symbol in self.holdings:
            try:
                result = self.analyze_holding(symbol, verbose=True)
                all_results.append(result)
            except Exception as e:
                print(f"❌ Error analyzing {symbol}: {e}")
                continue
        
        return all_results
    
    def print_enhanced_summary(self, results: List[Dict]):
        """Enhanced summary with detailed breakout opportunities"""
        print("\n" + "=" * 80)
        print("📋 SMART MONEY BREAKOUT SUMMARY")
        print("=" * 80)
        
        # Collect all opportunities
        breakout_opportunities = []
        watch_opportunities = []
        signal_counts = {}
        
        for result in results:
            symbol = result['symbol'].replace('.NS', '')
            
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
                            'stop_loss': data['breakout']['stop_loss'],
                            'reason': data['breakout']['reason'],
                            'volume_ratio': data['levels']['volume_ratio'],
                            'range_pos': data['levels']['range_position']
                        })
                    elif signal in ['watch_buy', 'watch_sell']:
                        watch_opportunities.append({
                            'symbol': symbol,
                            'timeframe': tf,
                            'signal': signal,
                            'status': data['breakout']['status'],
                            'confidence': data['breakout']['confidence'],
                            'current_price': data['levels']['current_price'],
                            'reason': data['breakout']['reason'],
                            'range_pos': data['levels']['range_position']
                        })
        
        # Print signal distribution
        print(f"\n📊 SIGNAL DISTRIBUTION:")
        for signal, count in sorted(signal_counts.items()):
            emoji = "🟢" if 'buy' in signal else "🔴" if 'sell' in signal else "👀" if 'watch' in signal else "⚪"
            print(f"  {emoji} {signal.replace('_', ' ').title()}: {count}")
        
        # Print immediate breakout opportunities
        if breakout_opportunities:
            print(f"\n🎯 IMMEDIATE BREAKOUT OPPORTUNITIES ({len(breakout_opportunities)}):")
            print("-" * 95)
            print(f"{'Symbol':<12} {'TF':<4} {'Signal':<12} {'Conf%':<6} {'Price':<8} {'Target':<8} {'Vol':<5} {'Reason'}")
            print("-" * 95)
            
            breakout_opportunities.sort(key=lambda x: x['confidence'], reverse=True)
            
            for opp in breakout_opportunities:
                signal_emoji = "🟢" if 'buy' in opp['signal'] else "🔴"
                print(f"{opp['symbol']:<12} {opp['timeframe']:<4} {signal_emoji}{opp['signal']:<11} "
                      f"{opp['confidence']*100:<6.0f} {opp['current_price']:<8.1f} {opp['target']:<8.1f} "
                      f"{opp['volume_ratio']:<5.1f} {opp['reason']}")
        
        # Print watch opportunities
        if watch_opportunities:
            print(f"\n👀 WATCH LIST - POTENTIAL BREAKOUTS ({len(watch_opportunities)}):")
            print("-" * 85)
            print(f"{'Symbol':<12} {'TF':<4} {'Signal':<12} {'Price':<8} {'Range%':<7} {'Reason'}")
            print("-" * 85)
            
            watch_opportunities.sort(key=lambda x: x['confidence'], reverse=True)
            
            for opp in watch_opportunities:
                watch_emoji = "👀"
                range_pct = opp['range_pos'] * 100
                print(f"{opp['symbol']:<12} {opp['timeframe']:<4} {watch_emoji}{opp['signal']:<11} "
                      f"{opp['current_price']:<8.1f} {range_pct:<7.0f} {opp['reason']}")
        
        if not breakout_opportunities and not watch_opportunities:
            print("\n📝 No immediate opportunities found.")
            print("💡 Most holdings are in consolidation phase.")
        
        print(f"\n✅ Analysis completed at {datetime.now().strftime('%H:%M:%S')}")
        print("💡 Monitor 'watch' signals for breakout confirmations")


def main():
    """Main execution with customizable holdings"""
    
    # You can customize your holdings here
    my_holdings = [
        'TATAMOTORS.NS',
        'RELIANCE.NS',
        # Add your other holdings here
    ]
    
    # Initialize analyzer
    analyzer = SmartMoneyBreakoutAnalyzer(custom_holdings=my_holdings)
    
    # Run analysis
    results = analyzer.analyze_all_holdings()
    
    # Print detailed summary
    analyzer.print_enhanced_summary(results)


if __name__ == "__main__":
    main()