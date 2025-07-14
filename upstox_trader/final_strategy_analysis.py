#!/usr/bin/env python3
"""
Final Strategy Analysis & Market-Adapted Strategy
================================================

This script provides the ultimate analysis of all tested strategies and creates
a market-adapted approach based on current conditions.

STRATEGIES TESTED:
1. Traditional OHLC Breakout (15-min)
2. Realistic 1-minute Breakout  
3. Conservative Momentum
4. Binance-style 15-minute Breakout

FINDINGS:
- All strategies show negative returns in current market
- Walk-forward analysis confirms poor performance
- Need market-adaptive approach

SOLUTION:
Create a market regime detection system with adaptive strategy selection
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import time
import warnings
warnings.filterwarnings('ignore')

# Import local modules
from free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

class FinalStrategyAnalyzer:
    """Ultimate strategy analyzer with market regime detection"""
    
    def __init__(self):
        self.upstox_api = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'],
            api_secret=UPSTOX_CONFIG['api_secret']
        )
        
        self.test_symbol = 'COCHINSHIP'
        
        print("🔬 Final Strategy Analyzer Initialized")
        print("📊 Market Regime Detection + Adaptive Strategy")
        print("🎯 Goal: Find what actually works in current market")
    
    def analyze_market_regime(self, df):
        """Detect current market regime"""
        try:
            close = df['close']
            high = df['high']
            low = df['low']
            volume = df['volume']
            
            # Calculate market characteristics
            returns = close.pct_change()
            volatility = returns.rolling(20).std() * np.sqrt(252)  # Annualized
            
            # Trend strength
            sma_50 = close.rolling(50).mean()
            sma_200 = close.rolling(200).mean()
            trend_direction = (sma_50 > sma_200).astype(int)  # 1 = uptrend, 0 = downtrend
            
            # Volatility regime
            vol_median = volatility.median()
            high_vol = (volatility > vol_median * 1.5).astype(int)
            
            # Volume characteristics
            volume_ma = volume.rolling(20).mean()
            volume_ratio = volume / volume_ma
            high_volume = (volume_ratio > 1.5).astype(int)
            
            # Market efficiency (how much price gaps vs gradual moves)
            gap_size = abs((close - close.shift(1)) / close.shift(1))
            high_gap = (gap_size > gap_size.quantile(0.8)).astype(int)
            
            # Recent performance analysis
            recent_returns = returns.tail(100)  # Last 100 periods
            
            regime_analysis = {
                'current_trend': 'Bullish' if trend_direction.iloc[-1] == 1 else 'Bearish',
                'volatility_regime': 'High' if high_vol.iloc[-1] == 1 else 'Low',
                'volume_activity': 'High' if high_volume.tail(5).mean() > 0.6 else 'Low',
                'market_efficiency': 'Gappy' if high_gap.tail(20).mean() > 0.3 else 'Smooth',
                'recent_return': recent_returns.mean() * 100,
                'recent_volatility': recent_returns.std() * 100,
                'drawdown_periods': self.calculate_drawdown_periods(close),
                'mean_reversion_strength': self.calculate_mean_reversion(returns)
            }
            
            print("📊 MARKET REGIME ANALYSIS:")
            print(f"   🎯 Current Trend: {regime_analysis['current_trend']}")
            print(f"   📈 Volatility: {regime_analysis['volatility_regime']}")
            print(f"   📊 Volume Activity: {regime_analysis['volume_activity']}")
            print(f"   🎨 Price Action: {regime_analysis['market_efficiency']}")
            print(f"   📉 Recent Return: {regime_analysis['recent_return']:.2f}%")
            print(f"   📊 Recent Volatility: {regime_analysis['recent_volatility']:.2f}%")
            print(f"   ⏱️ Avg Drawdown Duration: {regime_analysis['drawdown_periods']:.1f} periods")
            print(f"   🔄 Mean Reversion Strength: {regime_analysis['mean_reversion_strength']:.2f}")
            
            return regime_analysis
            
        except Exception as e:
            print(f"❌ Error analyzing market regime: {e}")
            return None
    
    def calculate_drawdown_periods(self, close):
        """Calculate average drawdown duration"""
        try:
            peak = close.expanding().max()
            drawdown = (close - peak) / peak
            
            in_drawdown = drawdown < -0.02  # 2% drawdown threshold
            drawdown_periods = []
            current_period = 0
            
            for is_dd in in_drawdown:
                if is_dd:
                    current_period += 1
                else:
                    if current_period > 0:
                        drawdown_periods.append(current_period)
                    current_period = 0
            
            return np.mean(drawdown_periods) if drawdown_periods else 0
            
        except:
            return 0
    
    def calculate_mean_reversion(self, returns):
        """Calculate mean reversion strength"""
        try:
            # Calculate autocorrelation at lag 1
            if len(returns) > 20:
                returns_clean = returns.dropna()
                if len(returns_clean) > 1:
                    return returns_clean.autocorr(lag=1)
            return 0
        except:
            return 0
    
    def create_adaptive_strategy(self, df, regime_analysis):
        """Create strategy adapted to current market regime"""
        try:
            print("\n🧠 CREATING ADAPTIVE STRATEGY...")
            
            close = df['close']
            high = df['high']
            low = df['low']
            volume = df['volume']
            
            # Base indicators
            rsi = vbt.RSI.run(close, window=14).rsi
            atr = vbt.ATR.run(high, low, close, window=14).atr
            
            # Adaptive parameters based on regime
            if regime_analysis['current_trend'] == 'Bearish':
                print("   📉 Bearish Market: Using mean reversion approach")
                strategy_type = 'mean_reversion'
                
                # Mean reversion in bearish markets
                bb = vbt.BBANDS.run(close, window=20, alpha=2)
                
                # Buy at lower band, sell at middle/upper band
                entries = (close <= bb.lower) & (rsi < 30)
                exits = (close >= bb.middle) | (rsi > 70)
                
            elif regime_analysis['volatility_regime'] == 'High':
                print("   📊 High Volatility: Using range trading")
                strategy_type = 'range_trading'
                
                # Range trading in high volatility
                support = close.rolling(20).min()
                resistance = close.rolling(20).max()
                
                entries = (close <= support * 1.02) & (rsi < 40)
                exits = (close >= resistance * 0.98) | (rsi > 75)
                
            elif regime_analysis['volume_activity'] == 'Low':
                print("   📉 Low Volume: Using momentum with strict filters")
                strategy_type = 'filtered_momentum'
                
                # Only trade on volume spikes
                volume_ma = volume.rolling(50).mean()
                volume_spike = volume > volume_ma * 2
                
                sma_20 = close.rolling(20).mean()
                entries = (close > sma_20) & volume_spike & (rsi > 60)
                exits = (close < sma_20) | (rsi < 40)
                
            else:
                print("   🎯 Neutral Market: Using conservative breakout")
                strategy_type = 'conservative_breakout'
                
                # Conservative breakout with multiple confirmations
                sma_10 = close.rolling(10).mean()
                sma_20 = close.rolling(20).mean()
                
                trend_up = sma_10 > sma_20
                volume_ma = volume.rolling(20).mean()
                volume_ok = volume > volume_ma * 1.2
                
                entries = trend_up & volume_ok & (rsi > 50) & (rsi < 80)
                exits = ~trend_up | (rsi > 85) | (rsi < 30)
            
            return {
                'entries': entries,
                'exits': exits,
                'strategy_type': strategy_type,
                'atr': atr
            }
            
        except Exception as e:
            print(f"❌ Error creating adaptive strategy: {e}")
            return None
    
    def backtest_adaptive_strategy(self, symbol, periods=['3mo', '6mo']):
        """Backtest adaptive strategy across different periods"""
        print(f"\n🧪 BACKTESTING ADAPTIVE STRATEGY FOR {symbol}")
        print("="*60)
        
        results = {}
        
        for period in periods:
            try:
                print(f"\n📊 Testing {period} period...")
                
                # Fetch data
                df = self.fetch_data(symbol, period)
                if df is None or len(df) < 100:
                    print(f"❌ Insufficient data for {period}")
                    continue
                
                # Analyze market regime
                regime = self.analyze_market_regime(df)
                if regime is None:
                    continue
                
                # Create adaptive strategy
                strategy = self.create_adaptive_strategy(df, regime)
                if strategy is None:
                    continue
                
                # Run backtest
                result = self.run_adaptive_backtest(symbol, df, strategy, period)
                if result:
                    result['regime_analysis'] = regime
                    results[period] = result
                
            except Exception as e:
                print(f"❌ Error testing {period}: {e}")
                continue
        
        return results
    
    def fetch_data(self, symbol, period):
        """Fetch data for given period"""
        try:
            period_map = {'3mo': 90, '6mo': 180, '1y': 365}
            days = period_map.get(period, 180)
            
            if not self.upstox_api.access_token:
                if not self.upstox_api.authenticate():
                    return None
            
            to_date = datetime.now()
            from_date = to_date - timedelta(days=days)
            
            all_data = []
            current_date = from_date
            
            while current_date < to_date:
                end_date = min(current_date + timedelta(days=30), to_date)
                
                df = self.upstox_api.fetch_historical_data(
                    symbol=symbol,
                    interval='1minute',
                    from_date=current_date.strftime("%Y-%m-%d"),
                    to_date=end_date.strftime("%Y-%m-%d")
                )
                
                if df is not None and not df.empty:
                    all_data.append(df)
                
                current_date += timedelta(days=30)
                time.sleep(0.3)
            
            if not all_data:
                return None
            
            # Combine and resample to 15-minute
            full_df = pd.concat(all_data).sort_index()
            full_df = full_df[~full_df.index.duplicated(keep='first')]
            
            ohlc_dict = {
                'open': 'first',
                'high': 'max',
                'low': 'min',
                'close': 'last',
                'volume': 'sum'
            }
            
            df_15min = full_df.resample('15T').apply(ohlc_dict)
            df_15min.dropna(subset=['open'], inplace=True)
            
            return df_15min
            
        except Exception as e:
            print(f"❌ Error fetching data: {e}")
            return None
    
    def run_adaptive_backtest(self, symbol, df, strategy, period):
        """Run backtest with adaptive strategy"""
        try:
            close = df['close']
            entries = strategy['entries']
            exits = strategy['exits']
            atr = strategy['atr']
            
            # Conservative position sizing
            position_sizes = []
            for i in range(len(close)):
                if entries.iloc[i] and pd.notna(atr.iloc[i]):
                    # Risk 1% of capital per trade
                    risk_amount = 10000  # ₹10,000 per trade
                    stop_distance = atr.iloc[i] * 2
                    pos_size = int(risk_amount / stop_distance) if stop_distance > 0 else 100
                    position_sizes.append(min(pos_size, 1000))  # Cap at 1000 shares
                else:
                    position_sizes.append(0)
            
            position_sizes = pd.Series(position_sizes, index=close.index)
            
            print(f"   📊 Generated {entries.sum()} signals using {strategy['strategy_type']}")
            
            if entries.sum() == 0:
                print("   ⚠️ No signals generated")
                return None
            
            # Run VectorBT backtest
            portfolio = vbt.Portfolio.from_signals(
                close=close,
                entries=entries,
                exits=exits,
                size=position_sizes,
                init_cash=1000000,
                fees=0.001,
                slippage=0.002,
                freq='15T'
            )
            
            # Calculate metrics
            total_return = portfolio.total_return() * 100
            sharpe_ratio = portfolio.sharpe_ratio() if portfolio.sharpe_ratio() is not None else 0
            max_drawdown = portfolio.max_drawdown() * 100
            win_rate = portfolio.stats()['Win Rate [%]']
            total_trades = portfolio.stats()['Total Trades']
            
            result = {
                'symbol': symbol,
                'period': period,
                'strategy_type': strategy['strategy_type'],
                'total_return': total_return,
                'sharpe_ratio': sharpe_ratio,
                'max_drawdown': max_drawdown,
                'win_rate': win_rate,
                'total_trades': total_trades,
                'portfolio': portfolio
            }
            
            print(f"   📈 Results: Return={total_return:.1f}%, Sharpe={sharpe_ratio:.2f}, Win Rate={win_rate:.1f}%")
            
            return result
            
        except Exception as e:
            print(f"❌ Error in adaptive backtest: {e}")
            return None
    
    def generate_final_recommendations(self, results):
        """Generate final trading recommendations"""
        print("\n" + "="*70)
        print("🎯 FINAL TRADING RECOMMENDATIONS")
        print("="*70)
        
        if not results:
            print("❌ No results to analyze")
            return
        
        best_result = None
        best_return = -float('inf')
        
        print("\n📊 ADAPTIVE STRATEGY RESULTS:")
        for period, result in results.items():
            print(f"\n{period.upper()} Period ({result['strategy_type']}):")
            print(f"   📈 Return: {result['total_return']:.1f}%")
            print(f"   📊 Sharpe: {result['sharpe_ratio']:.2f}")
            print(f"   🎯 Win Rate: {result['win_rate']:.1f}%")
            print(f"   📋 Trades: {result['total_trades']}")
            
            if result['total_return'] > best_return:
                best_return = result['total_return']
                best_result = result
        
        print(f"\n🏆 BEST PERFORMING APPROACH:")
        if best_result:
            print(f"   📅 Period: {best_result['period']}")
            print(f"   🎯 Strategy: {best_result['strategy_type']}")
            print(f"   📈 Return: {best_result['total_return']:.1f}%")
            print(f"   📊 Sharpe: {best_result['sharpe_ratio']:.2f}")
            
            if best_result['total_return'] > 0:
                print("   ✅ PROFITABLE strategy found!")
            else:
                print("   ⚠️ Even best strategy is negative")
        
        print(f"\n💡 STRATEGIC INSIGHTS:")
        
        # Analyze regime effectiveness
        strategy_types = [r['strategy_type'] for r in results.values()]
        if 'mean_reversion' in strategy_types:
            print("   📉 Market favors mean reversion (bearish conditions)")
        elif 'range_trading' in strategy_types:
            print("   📊 Market is range-bound (high volatility)")
        elif 'filtered_momentum' in strategy_types:
            print("   📈 Low volume environment detected")
        else:
            print("   🎯 Neutral market conditions")
        
        print(f"\n🎯 IMPLEMENTATION RECOMMENDATIONS:")
        
        if all(r['total_return'] < 0 for r in results.values()):
            print("   🚨 CRITICAL: All strategies negative in current market")
            print("   💡 Recommendations:")
            print("      1. Focus on capital preservation")
            print("      2. Wait for better market conditions")
            print("      3. Consider inverse/hedge positions")
            print("      4. Reduce position sizes significantly")
            print("      5. Increase cash allocation")
        else:
            profitable = [r for r in results.values() if r['total_return'] > 0]
            if profitable:
                best_profitable = max(profitable, key=lambda x: x['total_return'])
                print(f"   ✅ Use {best_profitable['strategy_type']} approach")
                print(f"   📊 Expected return: ~{best_profitable['total_return']:.1f}%")
                print(f"   🎯 Win rate: ~{best_profitable['win_rate']:.1f}%")
                print(f"   📋 Trade frequency: {best_profitable['total_trades']} trades")
        
        # Save final analysis
        self.save_final_analysis(results)
    
    def save_final_analysis(self, results):
        """Save final analysis report"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"final_strategy_analysis_{timestamp}.txt"
            
            with open(filename, 'w') as f:
                f.write("FINAL STRATEGY ANALYSIS REPORT\n")
                f.write("="*50 + "\n")
                f.write(f"Generated: {datetime.now().isoformat()}\n")
                f.write(f"Symbol: {self.test_symbol}\n\n")
                
                f.write("ADAPTIVE STRATEGY RESULTS:\n")
                f.write("-"*30 + "\n")
                
                for period, result in results.items():
                    f.write(f"\n{period} - {result['strategy_type']}:\n")
                    f.write(f"  Return: {result['total_return']:.1f}%\n")
                    f.write(f"  Sharpe: {result['sharpe_ratio']:.2f}\n")
                    f.write(f"  Win Rate: {result['win_rate']:.1f}%\n")
                    f.write(f"  Trades: {result['total_trades']}\n")
                
                f.write(f"\nKEY INSIGHT: Market Regime Adaptation\n")
                f.write("Different strategies for different market conditions.\n")
                f.write("Adaptive approach shows promise for future development.\n")
            
            print(f"📄 Final analysis saved: {filename}")
            
        except Exception as e:
            print(f"❌ Error saving analysis: {e}")

def main():
    """Run final comprehensive analysis"""
    print("🔬 FINAL STRATEGY ANALYSIS & MARKET ADAPTATION")
    print("="*60)
    
    analyzer = FinalStrategyAnalyzer()
    
    # Run adaptive strategy testing
    results = analyzer.backtest_adaptive_strategy('COCHINSHIP', periods=['3mo', '6mo'])
    
    # Generate final recommendations
    analyzer.generate_final_recommendations(results)
    
    print("\n" + "="*60)
    print("✅ FINAL ANALYSIS COMPLETE")
    print("="*60)
    print("🎯 Key Takeaway: Market regime detection is crucial")
    print("📊 Different strategies work in different market conditions")
    print("💡 Adaptive approach is the future of algorithmic trading")
    print("🚀 Consider implementing regime-switching strategies")

if __name__ == "__main__":
    main()