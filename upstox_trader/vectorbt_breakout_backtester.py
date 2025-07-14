#!/usr/bin/env python3
"""
VectorBT Breakout Strategy Backtester
Advanced backtesting system using breakout patterns from breakout_stock_scanner.py
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
from breakout_stock_scanner import TechnicalAnalyzer

class BreakoutStrategyBacktester:
    """Advanced backtesting system using VectorBT with Breakout Strategy"""
    
    def __init__(self):
        self.vbt_config = {
            'caching': True,
            'portfolio': {
                'init_cash': 1000000,  # ₹10 Lakh starting capital
                'fees': 0.001,         # 0.1% fees
                'slippage': 0.002      # 0.2% slippage
            }
        }
        
        # Initialize data sources
        self.upstox_api = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'],
            api_secret=UPSTOX_CONFIG['api_secret']
        )
        
        # Breakout strategy parameters
        self.strategy_params = {
            'volume_threshold': 1.5,        # 1.5x average volume for breakout
            'min_confidence': 0.6,          # Minimum breakout confidence
            'rsi_min': 50,                  # RSI > 50 for bullish momentum
            'rsi_max': 80,                  # RSI < 80 to avoid overbought
            'resistance_buffer': 2.0,       # % buffer above resistance for breakout
            'support_buffer': 2.0,          # % buffer below support for bounce
            'stop_loss_atr': 2.0,          # Stop loss = 2x ATR
            'take_profit_atr': 3.0,        # Take profit = 3x ATR
            'holding_period_max': 5        # Max 5 days holding
        }
        
        print("🚀 VectorBT Breakout Strategy Backtester Initialized")
        print(f"💰 Initial Capital: ₹{self.vbt_config['portfolio']['init_cash']:,}")
    
    def fetch_historical_data(self, symbols, period='1y', interval='1d'):
        """Fetch historical data for multiple symbols using Upstox API"""
        print(f"📊 Fetching {period} data for {len(symbols)} symbols using Upstox API...")
        
        try:
            # Convert period to days
            period_map = {
                '1y': 365,
                '6mo': 180,
                '3mo': 90,
                '1mo': 30,
                '2y': 730
            }
            days_to_fetch = period_map.get(period, 365)
            
            # Convert interval to Upstox format
            interval_map = {
                '1d': 'day',
                '1h': '60minute',
                '30m': '30minute', 
                '15m': '15minute',
                '5m': '5minute',
                '1m': '1minute'
            }
            upstox_interval = interval_map.get(interval, 'day')
            
            # Authenticate Upstox API
            if not self.upstox_api.access_token:
                if not self.upstox_api.authenticate():
                    print("❌ Upstox authentication failed")
                    return {}
            
            result = {}
            
            for symbol in symbols:
                try:
                    print(f"🔍 Fetching data for {symbol}...")
                    
                    # Fetch data using the same method as backtest_upstox_strategy.py
                    df = self.fetch_and_resample_data(symbol, upstox_interval, days_to_fetch)
                    
                    if df is not None and len(df) > 50:  # Minimum data points
                        result[symbol] = df
                        print(f"✅ {symbol}: {len(df)} data points")
                    else:
                        print(f"⚠️ Insufficient data for {symbol}")
                        
                except Exception as e:
                    print(f"❌ Error fetching {symbol}: {e}")
                    continue
                    
                # Rate limiting
                time.sleep(0.5)
            
            print(f"✅ Successfully fetched data for {len(result)} symbols")
            return result
                
        except Exception as e:
            print(f"❌ Error in data fetching process: {e}")
            return {}
    
    def fetch_and_resample_data(self, symbol, timeframe, days_to_fetch):
        """Fetch and resample data using Upstox API (based on backtest_upstox_strategy.py)"""
        try:
            # Map timeframes properly
            if timeframe == 'day':
                base_interval = 'day'
                chunk_days = 365
            elif timeframe in ['60minute', '1h']:
                base_interval = '30minute'
                chunk_days = 180
            elif timeframe in ['30minute', '30m']:
                base_interval = '30minute'
                chunk_days = 180
            elif timeframe in ['15minute', '15m']:
                base_interval = '1minute'
                chunk_days = 30
            elif timeframe in ['5minute', '5m']:
                base_interval = '1minute'
                chunk_days = 30
            elif timeframe in ['1minute', '1m']:
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
                time.sleep(0.5)  # Be nice to the API
            
            if not all_data:
                return None
            
            # Combine all data
            full_df = pd.concat(all_data).sort_index()
            full_df = full_df[~full_df.index.duplicated(keep='first')]
            
            # Resample to target timeframe if needed
            if timeframe != base_interval:
                ohlc_dict = {
                    'open': 'first', 
                    'high': 'max', 
                    'low': 'min', 
                    'close': 'last', 
                    'volume': 'sum'
                }
                
                # Map timeframe to pandas resample rule
                timeframe_map = {
                    'day': '1D',
                    '60minute': '1H', '1h': '1H',
                    '30minute': '30T', '30m': '30T',
                    '15minute': '15T', '15m': '15T',
                    '5minute': '5T', '5m': '5T',
                    '1minute': '1T', '1m': '1T'
                }
                
                timeframe_str = timeframe_map.get(timeframe, '1D')
                
                resampled_data = full_df.resample(timeframe_str).apply(ohlc_dict)
                resampled_data.dropna(subset=['open'], inplace=True)
                return resampled_data
            
            return full_df
            
        except Exception as e:
            print(f"❌ Error fetching data for {symbol}: {e}")
            return None
    
    def calculate_technical_indicators(self, df):
        """Calculate technical indicators for breakout strategy"""
        try:
            # Price and volume data
            close = df['close']
            high = df['high']
            low = df['low']
            volume = df['volume']
            
            # VectorBT indicators
            rsi = vbt.RSI.run(close, window=14).rsi
            atr = vbt.ATR.run(high, low, close, window=14).atr
            
            # Volume indicators
            volume_ma = volume.rolling(20).mean()
            volume_ratio = volume / volume_ma
            
            # Price indicators
            sma_20 = close.rolling(20).mean()
            
            # Support and Resistance levels using custom logic
            support_levels = []
            resistance_levels = []
            
            # Calculate support/resistance for each point
            for i in range(len(df)):
                end_idx = i + 1
                start_idx = max(0, end_idx - 20)  # 20-period lookback
                
                if end_idx - start_idx >= 20:
                    highs_slice = high.iloc[start_idx:end_idx].tolist()
                    lows_slice = low.iloc[start_idx:end_idx].tolist()
                    
                    support, resistance = TechnicalAnalyzer.find_support_resistance(
                        highs_slice, lows_slice, lookback=min(20, len(highs_slice))
                    )
                    
                    support_levels.append(support)
                    resistance_levels.append(resistance)
                else:
                    support_levels.append(0.0)
                    resistance_levels.append(0.0)
            
            support_series = pd.Series(support_levels, index=close.index)
            resistance_series = pd.Series(resistance_levels, index=close.index)
            
            return {
                'rsi': rsi,
                'atr': atr,
                'volume_ratio': volume_ratio,
                'sma_20': sma_20,
                'support': support_series,
                'resistance': resistance_series,
                'close': close,
                'high': high,
                'low': low,
                'volume': volume
            }
            
        except Exception as e:
            print(f"❌ Error calculating indicators: {e}")
            return None
    
    def generate_breakout_signals(self, indicators):
        """Generate trading signals based on breakout strategy"""
        try:
            # Extract indicators
            rsi = indicators['rsi']
            atr = indicators['atr']
            volume_ratio = indicators['volume_ratio']
            close = indicators['close']
            support = indicators['support']
            resistance = indicators['resistance']
            
            # Breakout entry conditions
            volume_spike = volume_ratio > self.strategy_params['volume_threshold']
            rsi_bullish = (rsi > self.strategy_params['rsi_min']) & (rsi < self.strategy_params['rsi_max'])
            
            # Resistance breakout: Price breaks above resistance with volume
            resistance_distance = ((close - resistance) / resistance) * 100
            resistance_breakout = (
                (resistance_distance > -0.5) &  # Near resistance
                (resistance_distance < self.strategy_params['resistance_buffer']) &  # Within buffer
                volume_spike &  # High volume
                rsi_bullish  # Good RSI
            )
            
            # Support bounce: Price bounces from support with volume
            support_distance = ((support - close) / close) * 100
            support_bounce = (
                (support_distance > -self.strategy_params['support_buffer']) &  # Near support
                (support_distance < 0.5) &  # Close to support
                volume_spike &  # High volume
                rsi_bullish  # Good RSI
            )
            
            # Combine entry signals (either resistance breakout or support bounce)
            entry_signals = resistance_breakout | support_bounce
            
            # Exit conditions
            rsi_overbought = rsi > 80
            rsi_oversold = rsi < 30
            volume_dry_up = volume_ratio < 0.8
            
            # Exit signals
            exit_signals = rsi_overbought | rsi_oversold | volume_dry_up
            
            return {
                'entries': entry_signals,
                'exits': exit_signals,
                'resistance_breakout': resistance_breakout,
                'support_bounce': support_bounce,
                'volume_spike': volume_spike,
                'rsi_bullish': rsi_bullish
            }
            
        except Exception as e:
            print(f"❌ Error generating signals: {e}")
            return None
    
    def calculate_position_sizing(self, df, atr, entry_price):
        """Calculate position size based on ATR and risk management"""
        try:
            # Risk per trade (2% of capital)
            risk_per_trade = 0.02
            capital = self.vbt_config['portfolio']['init_cash']
            risk_amount = capital * risk_per_trade
            
            # Stop loss distance (2x ATR)
            stop_loss_distance = atr * self.strategy_params['stop_loss_atr']
            
            # Position size
            position_size = risk_amount / stop_loss_distance
            
            # Ensure we don't exceed available capital
            max_position_value = capital * 0.1  # Max 10% per position
            max_shares = max_position_value / entry_price
            
            final_position_size = min(position_size, max_shares)
            
            return final_position_size
            
        except Exception as e:
            print(f"❌ Error calculating position size: {e}")
            return 1000  # Default position size
    
    def run_backtest_single_symbol(self, symbol, df):
        """Run backtest for a single symbol"""
        try:
            print(f"🔍 Backtesting {symbol} with Breakout Strategy...")
            
            # Calculate indicators
            indicators = self.calculate_technical_indicators(df)
            if indicators is None:
                return None
            
            # Generate signals
            signals = self.generate_breakout_signals(indicators)
            if signals is None:
                return None
            
            # Get price data
            close = indicators['close']
            atr = indicators['atr']
            
            # Create VectorBT portfolio
            entries = signals['entries']
            exits = signals['exits']
            
            # Determine frequency based on data
            if len(close) > 1:
                time_diff = close.index[1] - close.index[0]
                if time_diff.total_seconds() <= 900:  # 15 minutes or less
                    freq = '15T'
                elif time_diff.total_seconds() <= 3600:  # 1 hour or less
                    freq = '1H'
                else:
                    freq = '1D'
            else:
                freq = '1D'
            
            # Dynamic position sizing
            position_sizes = []
            for i, entry in enumerate(entries):
                if entry and i < len(close) and i < len(atr):
                    pos_size = self.calculate_position_sizing(df, atr.iloc[i], close.iloc[i])
                    position_sizes.append(pos_size)
                else:
                    position_sizes.append(0)
            
            position_sizes = pd.Series(position_sizes, index=close.index)
            
            # Run VectorBT simulation
            portfolio = vbt.Portfolio.from_signals(
                close=close,
                entries=entries,
                exits=exits,
                size=position_sizes,
                init_cash=self.vbt_config['portfolio']['init_cash'],
                fees=self.vbt_config['portfolio']['fees'],
                slippage=self.vbt_config['portfolio']['slippage'],
                freq=freq  # Set frequency based on data
            )
            
            # Calculate metrics
            total_return = portfolio.total_return() * 100
            sharpe_ratio = portfolio.sharpe_ratio()
            max_drawdown = portfolio.max_drawdown() * 100
            win_rate = portfolio.stats()['Win Rate [%]']
            total_trades = portfolio.stats()['Total Trades']
            
            result = {
                'symbol': symbol,
                'total_return': total_return,
                'sharpe_ratio': sharpe_ratio,
                'max_drawdown': max_drawdown,
                'win_rate': win_rate,
                'total_trades': total_trades,
                'portfolio': portfolio,
                'signals': signals,
                'indicators': indicators
            }
            
            print(f"📈 {symbol}: Return={total_return:.1f}%, Sharpe={sharpe_ratio:.2f}, Drawdown={max_drawdown:.1f}%")
            
            return result
            
        except Exception as e:
            print(f"❌ Error backtesting {symbol}: {e}")
            return None
    
    def run_comprehensive_backtest(self, symbols, period='1y', interval='1d'):
        """Run comprehensive backtest across multiple symbols"""
        print("🚀 Starting Comprehensive Breakout Strategy Backtest")
        print("=" * 70)
        
        # Fetch historical data
        data_dict = self.fetch_historical_data(symbols, period=period, interval=interval)
        
        if not data_dict:
            print("❌ No data available for backtesting")
            return None
        
        # Run backtests
        results = []
        
        for symbol, df in data_dict.items():
            result = self.run_backtest_single_symbol(symbol, df)
            if result:
                results.append(result)
        
        if not results:
            print("❌ No successful backtests completed")
            return None
        
        # Aggregate results
        print("\\n" + "=" * 70)
        print("📊 BREAKOUT STRATEGY BACKTEST RESULTS")
        print("=" * 70)
        
        summary_df = pd.DataFrame([
            {
                'Symbol': r['symbol'],
                'Total Return %': f"{r['total_return']:.1f}%",
                'Sharpe Ratio': f"{r['sharpe_ratio']:.2f}",
                'Max Drawdown %': f"{r['max_drawdown']:.1f}%",
                'Win Rate %': f"{r['win_rate']:.1f}%",
                'Total Trades': int(r['total_trades'])
            }
            for r in results
        ])
        
        print(summary_df.to_string(index=False))
        
        # Calculate portfolio-level metrics
        avg_return = np.mean([r['total_return'] for r in results])
        avg_sharpe = np.mean([r['sharpe_ratio'] for r in results])
        avg_drawdown = np.mean([r['max_drawdown'] for r in results])
        avg_win_rate = np.mean([r['win_rate'] for r in results])
        total_trades = sum([r['total_trades'] for r in results])
        
        print("\\n" + "=" * 70)
        print("🏆 BREAKOUT STRATEGY PORTFOLIO SUMMARY")
        print("=" * 70)
        print(f"📈 Average Return: {avg_return:.1f}%")
        print(f"📊 Average Sharpe Ratio: {avg_sharpe:.2f}")
        print(f"📉 Average Max Drawdown: {avg_drawdown:.1f}%")
        print(f"🎯 Average Win Rate: {avg_win_rate:.1f}%")
        print(f"📋 Total Trades: {total_trades}")
        print(f"📅 Period: {period}")
        print(f"💰 Strategy: Breakout Detection + ATR Risk Management")
        
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
    
    def save_backtest_results(self, backtest_results, filename=None):
        """Save backtest results to files"""
        try:
            if filename is None:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"breakout_backtest_results_{timestamp}"
            
            # Save summary CSV
            summary_df = backtest_results['summary']
            summary_df.to_csv(f"{filename}_summary.csv", index=False)
            
            # Save detailed metrics
            metrics = backtest_results['portfolio_metrics']
            with open(f"{filename}_metrics.txt", 'w') as f:
                f.write("Breakout Strategy Backtest Results\\n")
                f.write("=" * 40 + "\\n")
                f.write(f"Average Return: {metrics['avg_return']:.1f}%\\n")
                f.write(f"Average Sharpe Ratio: {metrics['avg_sharpe']:.2f}\\n")
                f.write(f"Average Max Drawdown: {metrics['avg_drawdown']:.1f}%\\n")
                f.write(f"Average Win Rate: {metrics['avg_win_rate']:.1f}%\\n")
                f.write(f"Total Trades: {metrics['total_trades']}\\n")
                f.write(f"Timestamp: {datetime.now().isoformat()}\\n")
            
            print(f"💾 Results saved to {filename}_summary.csv and {filename}_metrics.txt")
            
        except Exception as e:
            print(f"❌ Error saving results: {e}")

def main():
    """Main function to run backtests"""
    print("🚀 VectorBT Breakout Strategy Backtester")
    print("=" * 50)
    
    # Initialize backtester
    backtester = BreakoutStrategyBacktester()
    
    # Define test universe (start with liquid stocks)
    test_symbols = [
        'COCHINSHIP',   # Our target stock
        'RELIANCE',     # Large cap
        'TCS',          # IT
        'INFY',         # IT
        'HDFCBANK',     # Banking
        'TATAMOTORS',   # Auto
        'DRREDDY',      # Pharma
        'SBIN',         # Banking
        'LT',           # Infrastructure
        'MARUTI'        # Auto
    ]
    
    print(f"📊 Testing {len(test_symbols)} symbols")
    print(f"🎯 Strategy: Breakout Detection + Support/Resistance")
    print(f"📅 Period: 6 months historical data")
    
    # Run comprehensive backtest
    results = backtester.run_comprehensive_backtest(test_symbols, period='6mo', interval='15m')
    
    if results:
        # Save results
        backtester.save_backtest_results(results)
        
        print("\\n✅ Backtest completed successfully!")
        print("📊 Check the generated CSV files for detailed results")
        print("💡 Next: Review results and optimize strategy parameters")
    else:
        print("❌ Backtest failed")

if __name__ == "__main__":
    main()