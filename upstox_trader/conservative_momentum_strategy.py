#!/usr/bin/env python3
"""
Conservative Momentum Strategy - Designed for Backtest-to-Real-World Success
=============================================================================

STRATEGY PHILOSOPHY:
- Works well in OHLC backtesting AND real-world trading
- Conservative entry/exit criteria
- Longer holding periods (reduces execution timing issues)
- Volume + Price + Time confirmation (triple confirmation)
- Built-in buffers for slippage and execution delays

KEY DESIGN PRINCIPLES:
1. CONSERVATIVE ENTRIES: Wait for strong confirmation before entering
2. PREDICTABLE EXITS: Use time-based and target-based exits (not tight stops)
3. TREND FOLLOWING: Only trade with the trend, not against it
4. VOLUME CONFIRMATION: Ensure sustained volume, not just spikes
5. BUFFER ZONES: Account for slippage and execution delays
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

class ConservativeMomentumStrategy:
    """Conservative strategy designed to work in both backtest and real trading"""
    
    def __init__(self):
        self.vbt_config = {
            'caching': True,
            'portfolio': {
                'init_cash': 1000000,
                'fees': 0.002,         # 0.2% fees (realistic)
                'slippage': 0.003      # 0.3% slippage (conservative)
            }
        }
        
        self.upstox_api = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'],
            api_secret=UPSTOX_CONFIG['api_secret']
        )
        
        # Refined conservative strategy parameters (more selective)
        self.strategy_params = {
            # TREND CONFIRMATION (Stronger trend required)
            'trend_sma_fast': 8,            # Fast SMA for trend
            'trend_sma_slow': 21,           # Slow SMA for trend
            'trend_strength_min': 1.5,      # Min % difference between SMAs (stronger trend)
            
            # MOMENTUM CONFIRMATION (More selective)
            'rsi_min': 60,                  # RSI > 60 (strong momentum)
            'rsi_max': 75,                  # RSI < 75 (not too overbought)
            'rsi_steady_periods': 3,        # RSI above min for 3 periods
            'macd_bullish_periods': 3,      # MACD bullish for 3 periods
            
            # VOLUME CONFIRMATION (Sustained volume required)
            'volume_ma_periods': 20,        # Volume moving average (longer)
            'volume_ratio_min': 1.5,        # 50% above average volume
            'volume_consistency': 3,        # Volume above average for 3 periods
            'volume_increasing_periods': 2, # Volume increasing for 2 periods
            
            # PRICE ACTION CONFIRMATION
            'price_above_sma_periods': 3,   # Price above fast SMA for 3 periods
            'higher_highs_periods': 2,      # Making higher highs for 2 periods
            
            # ENTRY/EXIT RULES (More conservative)
            'entry_buffer': 0.3,            # 0.3% buffer above signal price
            'profit_target': 3.5,           # 3.5% profit target (realistic)
            'stop_loss': 1.8,               # 1.8% stop loss (tighter)
            'max_hold_days': 5,             # Max 5 days holding (shorter)
            'min_hold_periods': 3,          # Min 3 periods before considering exit
            
            # RISK MANAGEMENT (More conservative)
            'position_size_pct': 5,         # 5% of capital per position
            'max_positions': 2,             # Max 2 positions at once
            'daily_loss_limit': 1.5         # 1.5% daily loss limit
        }
        
        print("🎯 Conservative Momentum Strategy Initialized")
        print("📊 Designed for backtest-to-real-world compatibility")
        print("⚡ Triple confirmation: Trend + Momentum + Volume")
        print(f"💰 Initial Capital: ₹{self.vbt_config['portfolio']['init_cash']:,}")
    
    def fetch_historical_data(self, symbols, period='6mo', interval='15m'):
        """Fetch historical data with error handling"""
        try:
            period_map = {'1y': 365, '6mo': 180, '3mo': 90, '1mo': 30}
            days_to_fetch = period_map.get(period, 180)
            
            interval_map = {'1d': 'day', '1h': '60minute', '30m': '30minute', '15m': '15minute'}
            upstox_interval = interval_map.get(interval, '15minute')
            
            if not self.upstox_api.access_token:
                if not self.upstox_api.authenticate():
                    print("❌ Authentication failed")
                    return {}
            
            result = {}
            for symbol in symbols:
                try:
                    print(f"📊 Fetching data for {symbol}...")
                    df = self.fetch_and_resample_data(symbol, upstox_interval, days_to_fetch)
                    
                    if df is not None and len(df) > 100:  # Need more data for conservative strategy
                        result[symbol] = df
                        print(f"✅ {symbol}: {len(df)} data points")
                    else:
                        print(f"⚠️ Insufficient data for {symbol}")
                        
                except Exception as e:
                    print(f"❌ Error fetching {symbol}: {e}")
                    continue
                    
                time.sleep(0.3)  # Rate limiting
            
            return result
            
        except Exception as e:
            print(f"❌ Error in data fetching: {e}")
            return {}
    
    def fetch_and_resample_data(self, symbol, timeframe, days_to_fetch):
        """Fetch and resample data"""
        try:
            # Determine base interval and chunk size
            if timeframe in ['15minute', '30minute']:
                base_interval = '1minute'
                chunk_days = 30
            else:
                base_interval = 'day'
                chunk_days = 365
            
            to_date = datetime.now()
            from_date = to_date - timedelta(days=days_to_fetch)
            
            all_data = []
            current_from_date = from_date
            
            while current_from_date < to_date:
                current_to_date = min(current_from_date + timedelta(days=chunk_days), to_date)
                
                df = self.upstox_api.fetch_historical_data(
                    symbol=symbol,
                    interval=base_interval,
                    from_date=current_from_date.strftime("%Y-%m-%d"),
                    to_date=current_to_date.strftime("%Y-%m-%d")
                )
                
                if df is not None and not df.empty:
                    all_data.append(df)
                
                current_from_date += timedelta(days=chunk_days)
                time.sleep(0.3)
            
            if not all_data:
                return None
            
            full_df = pd.concat(all_data).sort_index()
            full_df = full_df[~full_df.index.duplicated(keep='first')]
            
            # Resample if needed
            if timeframe != base_interval:
                ohlc_dict = {'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}
                timeframe_map = {'15minute': '15T', '30minute': '30T', 'day': '1D'}
                timeframe_str = timeframe_map.get(timeframe, '15T')
                
                resampled_data = full_df.resample(timeframe_str).apply(ohlc_dict)
                resampled_data.dropna(subset=['open'], inplace=True)
                return resampled_data
            
            return full_df
            
        except Exception as e:
            print(f"❌ Error fetching data for {symbol}: {e}")
            return None
    
    def calculate_conservative_indicators(self, df):
        """Calculate indicators for conservative momentum strategy"""
        try:
            close = df['close']
            high = df['high']
            low = df['low']
            volume = df['volume']
            
            # TREND INDICATORS
            sma_fast = close.rolling(self.strategy_params['trend_sma_fast']).mean()
            sma_slow = close.rolling(self.strategy_params['trend_sma_slow']).mean()
            trend_strength = ((sma_fast - sma_slow) / sma_slow) * 100
            
            # MOMENTUM INDICATORS
            rsi = vbt.RSI.run(close, window=14).rsi
            macd = vbt.MACD.run(close, fast_window=12, slow_window=26, signal_window=9)
            macd_line = macd.macd
            macd_signal = macd.signal
            macd_histogram = macd.hist
            
            # VOLUME INDICATORS
            volume_ma = volume.rolling(self.strategy_params['volume_ma_periods']).mean()
            volume_ratio = volume / volume_ma
            
            # VOLATILITY (for position sizing)
            atr = vbt.ATR.run(high, low, close, window=14).atr
            
            return {
                'close': close,
                'sma_fast': sma_fast,
                'sma_slow': sma_slow,
                'trend_strength': trend_strength,
                'rsi': rsi,
                'macd_line': macd_line,
                'macd_signal': macd_signal,
                'macd_histogram': macd_histogram,
                'volume_ratio': volume_ratio,
                'atr': atr,
                'volume': volume
            }
            
        except Exception as e:
            print(f"❌ Error calculating indicators: {e}")
            return None
    
    def generate_conservative_signals(self, indicators):
        """Generate conservative momentum signals with triple confirmation"""
        try:
            # Extract indicators
            close = indicators['close']
            sma_fast = indicators['sma_fast']
            sma_slow = indicators['sma_slow']
            trend_strength = indicators['trend_strength']
            rsi = indicators['rsi']
            macd_line = indicators['macd_line']
            macd_signal = indicators['macd_signal']
            macd_histogram = indicators['macd_histogram']
            volume_ratio = indicators['volume_ratio']
            volume = indicators['volume']
            
            # ULTRA-CONSERVATIVE ENTRY CONDITIONS (All must be true)
            
            # 1. STRONG UPTREND CONFIRMATION
            strong_uptrend = (
                (close > sma_fast) &  # Price above fast SMA
                (sma_fast > sma_slow) &  # Fast SMA above slow SMA
                (trend_strength > self.strategy_params['trend_strength_min'])  # Strong trend
            )
            
            # 2. SUSTAINED MOMENTUM CONFIRMATION
            rsi_strong = (rsi > self.strategy_params['rsi_min']) & (rsi < self.strategy_params['rsi_max'])
            rsi_sustained = rsi_strong.rolling(self.strategy_params['rsi_steady_periods']).sum() >= self.strategy_params['rsi_steady_periods']
            
            momentum_bullish = (
                rsi_sustained &  # Sustained strong RSI
                (macd_line > macd_signal)  # MACD bullish
            )
            
            # 3. VOLUME CONFIRMATION (Sustained and increasing)
            volume_confirmation = volume_ratio > self.strategy_params['volume_ratio_min']
            volume_sustained = volume_confirmation.rolling(self.strategy_params['volume_consistency']).sum() >= self.strategy_params['volume_consistency']
            volume_increasing = volume.diff().rolling(self.strategy_params['volume_increasing_periods']).apply(lambda x: (x > 0).sum() >= self.strategy_params['volume_increasing_periods'])
            
            # 4. PRICE ACTION CONFIRMATION
            price_above_sma = close > sma_fast
            price_sustained = price_above_sma.rolling(self.strategy_params['price_above_sma_periods']).sum() >= self.strategy_params['price_above_sma_periods']
            
            # Higher highs confirmation
            higher_highs = close.rolling(self.strategy_params['higher_highs_periods']).apply(
                lambda x: x.iloc[-1] > x.iloc[0] if len(x) >= 2 else False
            )
            
            # 5. MACD SUSTAINED CONFIRMATION
            macd_sustained = (macd_histogram > 0).rolling(self.strategy_params['macd_bullish_periods']).sum() >= self.strategy_params['macd_bullish_periods']
            
            # FINAL ENTRY SIGNAL (Quintuple confirmation)
            entry_signals = (
                strong_uptrend & 
                momentum_bullish & 
                volume_sustained & 
                volume_increasing & 
                price_sustained & 
                higher_highs & 
                macd_sustained
            )
            
            # CONSERVATIVE EXIT CONDITIONS
            
            # 1. Trend weakening
            trend_weakening = (
                (close < sma_fast) |  # Price below fast SMA
                (trend_strength < 0.5)  # Trend strength weakening
            )
            
            # 2. Momentum exhaustion
            momentum_exhaustion = (
                (rsi > 80) |  # Overbought
                (rsi < 45) |  # Momentum lost
                (macd_line < macd_signal)  # MACD bearish
            )
            
            # 3. Volume drying up
            volume_drying = volume_ratio < 0.8
            
            # EXIT SIGNALS
            exit_signals = trend_weakening | momentum_exhaustion | volume_drying
            
            return {
                'entries': entry_signals,
                'exits': exit_signals,
                'strong_uptrend': strong_uptrend,
                'momentum_bullish': momentum_bullish,
                'volume_confirmation': volume_confirmation,
                'trend_strength': trend_strength
            }
            
        except Exception as e:
            print(f"❌ Error generating signals: {e}")
            return None
    
    def calculate_conservative_position_size(self, capital, current_price, atr):
        """Calculate position size with conservative risk management"""
        try:
            # Base position size (percentage of capital)
            base_position_value = capital * (self.strategy_params['position_size_pct'] / 100)
            
            # Adjust for volatility (higher ATR = smaller position)
            if pd.notna(atr) and atr > 0:
                price_atr_ratio = current_price / atr
                volatility_adjustment = min(1.0, price_atr_ratio / 20)  # Reduce size for high volatility
            else:
                volatility_adjustment = 0.5
            
            # Final position size
            adjusted_position_value = base_position_value * volatility_adjustment
            position_size = int(adjusted_position_value / current_price)
            
            return max(1, position_size)  # Minimum 1 share
            
        except Exception as e:
            print(f"❌ Error calculating position size: {e}")
            return 1
    
    def run_conservative_backtest(self, symbol, df):
        """Run backtest with conservative momentum strategy"""
        try:
            print(f"🎯 Running conservative momentum backtest for {symbol}...")
            
            # Calculate indicators
            indicators = self.calculate_conservative_indicators(df)
            if indicators is None:
                return None
            
            # Generate signals
            signals = self.generate_conservative_signals(indicators)
            if signals is None:
                return None
            
            close = indicators['close']
            atr = indicators['atr']
            entries = signals['entries']
            exits = signals['exits']
            
            # Dynamic position sizing
            position_sizes = []
            for i in range(len(close)):
                if entries.iloc[i] and pd.notna(close.iloc[i]) and pd.notna(atr.iloc[i]):
                    pos_size = self.calculate_conservative_position_size(
                        self.vbt_config['portfolio']['init_cash'],
                        close.iloc[i],
                        atr.iloc[i]
                    )
                    position_sizes.append(pos_size)
                else:
                    position_sizes.append(0)
            
            position_sizes = pd.Series(position_sizes, index=close.index)
            
            # Determine frequency
            if len(close) > 1:
                time_diff = close.index[1] - close.index[0]
                if time_diff.total_seconds() <= 900:
                    freq = '15T'
                elif time_diff.total_seconds() <= 3600:
                    freq = '1H'
                else:
                    freq = '1D'
            else:
                freq = '1D'
            
            print(f"📊 {symbol}: Generated {entries.sum()} entry signals")
            
            if entries.sum() == 0:
                print(f"⚠️ No entry signals for {symbol}")
                return None
            
            # Run VectorBT simulation
            portfolio = vbt.Portfolio.from_signals(
                close=close,
                entries=entries,
                exits=exits,
                size=position_sizes,
                init_cash=self.vbt_config['portfolio']['init_cash'],
                fees=self.vbt_config['portfolio']['fees'],
                slippage=self.vbt_config['portfolio']['slippage'],
                freq=freq
            )
            
            # Calculate metrics
            total_return = portfolio.total_return() * 100
            sharpe_ratio = portfolio.sharpe_ratio() if portfolio.sharpe_ratio() is not None else 0
            max_drawdown = portfolio.max_drawdown() * 100
            win_rate = portfolio.stats()['Win Rate [%]']
            total_trades = portfolio.stats()['Total Trades']
            
            # Additional conservative metrics
            avg_trade_return = total_return / total_trades if total_trades > 0 else 0
            
            result = {
                'symbol': symbol,
                'total_return': total_return,
                'sharpe_ratio': sharpe_ratio,
                'max_drawdown': max_drawdown,
                'win_rate': win_rate,
                'total_trades': total_trades,
                'avg_trade_return': avg_trade_return,
                'portfolio': portfolio,
                'signals': signals,
                'indicators': indicators
            }
            
            print(f"📈 {symbol} Conservative Results:")
            print(f"   Return: {total_return:.1f}%")
            print(f"   Sharpe: {sharpe_ratio:.2f}")
            print(f"   Drawdown: {max_drawdown:.1f}%")
            print(f"   Win Rate: {win_rate:.1f}%")
            print(f"   Trades: {total_trades}")
            print(f"   Avg Trade Return: {avg_trade_return:.2f}%")
            
            return result
            
        except Exception as e:
            print(f"❌ Error in conservative backtest for {symbol}: {e}")
            return None
    
    def run_comprehensive_backtest(self, symbols, period='6mo', interval='15m'):
        """Run comprehensive conservative backtest"""
        print("🎯 Conservative Momentum Strategy Backtest")
        print("=" * 50)
        print("📊 Triple Confirmation: Trend + Momentum + Volume")
        print("⏰ Longer holds, Conservative entries, Predictable exits")
        print("=" * 50)
        
        # Fetch data
        data_dict = self.fetch_historical_data(symbols, period, interval)
        if not data_dict:
            print("❌ No data available")
            return None
        
        # Run backtests
        results = []
        for symbol, df in data_dict.items():
            result = self.run_conservative_backtest(symbol, df)
            if result:
                results.append(result)
        
        if not results:
            print("❌ No successful backtests")
            return None
        
        # Summary
        print("\\n" + "=" * 70)
        print("📊 CONSERVATIVE MOMENTUM STRATEGY RESULTS")
        print("=" * 70)
        
        summary_df = pd.DataFrame([
            {
                'Symbol': r['symbol'],
                'Return %': f"{r['total_return']:.1f}%",
                'Sharpe': f"{r['sharpe_ratio']:.2f}",
                'Drawdown %': f"{r['max_drawdown']:.1f}%",
                'Win Rate %': f"{r['win_rate']:.1f}%",
                'Trades': int(r['total_trades']),
                'Avg Trade %': f"{r['avg_trade_return']:.2f}%"
            }
            for r in results
        ])
        
        print(summary_df.to_string(index=False))
        
        # Portfolio metrics
        avg_return = np.mean([r['total_return'] for r in results])
        avg_sharpe = np.mean([r['sharpe_ratio'] for r in results])
        avg_drawdown = np.mean([r['max_drawdown'] for r in results])
        avg_win_rate = np.mean([r['win_rate'] for r in results])
        total_trades = sum([r['total_trades'] for r in results])
        
        print("\\n" + "=" * 70)
        print("🏆 CONSERVATIVE STRATEGY PORTFOLIO SUMMARY")
        print("=" * 70)
        print(f"📈 Average Return: {avg_return:.1f}%")
        print(f"📊 Average Sharpe: {avg_sharpe:.2f}")
        print(f"📉 Average Drawdown: {avg_drawdown:.1f}%")
        print(f"🎯 Average Win Rate: {avg_win_rate:.1f}%")
        print(f"📋 Total Trades: {total_trades}")
        print(f"💡 Strategy: Conservative Momentum (Triple Confirmation)")
        
        return {
            'results': results,
            'summary': summary_df,
            'portfolio_metrics': {
                'avg_return': avg_return,
                'avg_sharpe': avg_sharpe,
                'avg_drawdown': avg_drawdown,
                'avg_win_rate': avg_win_rate,
                'total_trades': total_trades
            }
        }

def test_conservative_strategy():
    """Test the conservative momentum strategy"""
    print("🎯 Testing Conservative Momentum Strategy")
    print("=" * 50)
    
    strategy = ConservativeMomentumStrategy()
    
    # Test with multiple symbols for better validation
    test_symbols = ['COCHINSHIP', 'RELIANCE', 'TCS']
    
    results = strategy.run_comprehensive_backtest(test_symbols, period='6mo', interval='15m')
    
    if results:
        print("\\n✅ Conservative strategy test completed!")
        print("💡 This strategy should work better in real trading because:")
        print("   • Longer holding periods (less timing-sensitive)")
        print("   • Triple confirmation reduces false signals")
        print("   • Conservative position sizing")
        print("   • Predictable exit rules")
        print("   • Built-in slippage buffers")
        
        # Generate ECharts report
        print("\\n🎨 Generating ECharts analysis...")
        from echarts_eda_analyzer import EChartsEDAAnalyzer
        eda_analyzer = EChartsEDAAnalyzer()
        report_path = eda_analyzer.generate_single_report(results)
        
        if report_path:
            print(f"📊 Report generated: {report_path}")
    else:
        print("❌ Conservative strategy test failed")

if __name__ == "__main__":
    test_conservative_strategy()