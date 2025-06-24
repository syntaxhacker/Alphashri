#!/usr/bin/env python3
"""
🚀 TATAMOTORS ENHANCED DAILY STRATEGY

Multiple strategies with more trading opportunities:
- Momentum breakout (relaxed parameters)
- Mean reversion on dips
- MACD bullish crossover
- Golden cross mini
- Beautiful comprehensive analysis
"""

import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import warnings
warnings.filterwarnings('ignore')

class TATAMOTORSEnhancedDaily:
    def __init__(self):
        self.data = None
        
    def load_data(self, csv_path='data/TATAMOTORS.NS.csv'):
        """Load TATAMOTORS data from CSV"""
        print("📂 Loading TATAMOTORS data...")
        
        self.data = pd.read_csv(csv_path)
        self.data['Date'] = pd.to_datetime(self.data['Date'])
        self.data.set_index('Date', inplace=True)
        
        # Standardize column names
        self.data.columns = [col.lower().replace(' ', '_') for col in self.data.columns]
        
        print(f"✅ Loaded {len(self.data)} rows from {self.data.index[0].date()} to {self.data.index[-1].date()}")
        print(f"   Price range: ₹{self.data['close'].min():.2f} - ₹{self.data['close'].max():.2f}")
        
        return self.data
    
    def filter_data_by_period(self, start_date='2021-01-01', end_date='2024-06-28'):
        """Filter data to specific period for analysis"""
        mask = (self.data.index >= start_date) & (self.data.index <= end_date)
        filtered_data = self.data[mask].copy()
        
        print(f"📅 Filtered to period: {filtered_data.index[0].date()} to {filtered_data.index[-1].date()}")
        print(f"   {len(filtered_data)} trading days")
        
        # Calculate period statistics
        period_return = ((filtered_data['close'].iloc[-1] - filtered_data['close'].iloc[0]) / filtered_data['close'].iloc[0]) * 100
        print(f"   Period return: {period_return:+.1f}%")
        
        return filtered_data
    
    def calculate_indicators(self, data):
        """Calculate all technical indicators"""
        data = data.copy()
        
        # Moving averages
        data['sma_10'] = data['close'].rolling(window=10).mean()
        data['sma_20'] = data['close'].rolling(window=20).mean()
        data['sma_50'] = data['close'].rolling(window=50).mean()
        data['ema_12'] = data['close'].ewm(span=12).mean()
        data['ema_26'] = data['close'].ewm(span=26).mean()
        
        # RSI
        delta = data['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        data['rsi'] = 100 - (100 / (1 + rs))
        
        # MACD
        data['macd'] = data['ema_12'] - data['ema_26']
        data['macd_signal'] = data['macd'].ewm(span=9).mean()
        data['macd_histogram'] = data['macd'] - data['macd_signal']
        
        # Bollinger Bands
        data['bb_middle'] = data['close'].rolling(window=20).mean()
        bb_std = data['close'].rolling(window=20).std()
        data['bb_upper'] = data['bb_middle'] + (bb_std * 2)
        data['bb_lower'] = data['bb_middle'] - (bb_std * 2)
        
        # Volume indicators
        data['volume_sma'] = data['volume'].rolling(window=20).mean()
        data['volume_ratio'] = data['volume'] / data['volume_sma']
        
        # Price action
        data['high_5'] = data['high'].rolling(window=5).max()
        data['low_5'] = data['low'].rolling(window=5).min()
        data['high_10'] = data['high'].rolling(window=10).max()
        data['low_10'] = data['low'].rolling(window=10).min()
        
        return data
    
    def generate_multi_strategy_signals(self, data):
        """Generate signals using multiple strategies"""
        print("🎯 Generating multi-strategy signals...")
        
        data = self.calculate_indicators(data)
        self.enhanced_data = data
        
        signals = pd.DataFrame(index=data.index)
        signals['long_entry'] = False
        signals['long_exit'] = False
        signals['signal_strength'] = 0.0
        signals['signal_type'] = ''
        
        for i in range(50, len(data)):
            current = data.iloc[i]
            prev = data.iloc[i-1]
            
            # Strategy 1: Momentum Breakout (relaxed)
            momentum_breakout = (
                current['close'] > current['high_5'] and  # 5-day high breakout
                current['volume_ratio'] > 1.2 and  # Volume 20% above average
                current['close'] > current['sma_20'] and  # Above 20-day MA
                current['rsi'] > 45 and current['rsi'] < 80  # RSI momentum zone
            )
            
            # Strategy 2: Mean Reversion
            mean_reversion = (
                current['close'] < current['bb_lower'] and  # Below lower BB
                current['rsi'] < 35 and  # Oversold
                current['close'] > current['low_10'] and  # Not at 10-day low
                prev['close'] < prev['bb_lower']  # Previous day also oversold
            )
            
            # Strategy 3: MACD Bullish Crossover
            macd_bullish = (
                prev['macd'] <= prev['macd_signal'] and  # Previous: MACD below signal
                current['macd'] > current['macd_signal'] and  # Current: MACD above signal
                current['macd'] > -0.5 and  # Not too deep negative
                current['volume_ratio'] > 1.0  # Volume confirmation
            )
            
            # Strategy 4: Golden Cross Mini
            golden_cross = (
                prev['sma_10'] <= prev['sma_20'] and  # Previous: 10 SMA below 20 SMA
                current['sma_10'] > current['sma_20'] and  # Current: 10 SMA above 20 SMA
                current['volume_ratio'] > 1.1  # Volume confirmation
            )
            
            # Determine which strategy triggered
            if momentum_breakout:
                signals.iloc[i, signals.columns.get_loc('long_entry')] = True
                signals.iloc[i, signals.columns.get_loc('signal_strength')] = current['volume_ratio']
                signals.iloc[i, signals.columns.get_loc('signal_type')] = 'momentum_breakout'
            elif mean_reversion:
                signals.iloc[i, signals.columns.get_loc('long_entry')] = True
                signals.iloc[i, signals.columns.get_loc('signal_strength')] = 35 - current['rsi']
                signals.iloc[i, signals.columns.get_loc('signal_type')] = 'mean_reversion'
            elif macd_bullish:
                signals.iloc[i, signals.columns.get_loc('long_entry')] = True
                signals.iloc[i, signals.columns.get_loc('signal_strength')] = current['macd_histogram']
                signals.iloc[i, signals.columns.get_loc('signal_type')] = 'macd_bullish'
            elif golden_cross:
                signals.iloc[i, signals.columns.get_loc('long_entry')] = True
                signals.iloc[i, signals.columns.get_loc('signal_strength')] = current['volume_ratio']
                signals.iloc[i, signals.columns.get_loc('signal_type')] = 'golden_cross'
        
        # Generate exits with different strategies
        self.generate_smart_exits(data, signals)
        
        print(f"✅ Generated {signals['long_entry'].sum()} entry signals")
        print(f"✅ Generated {signals['long_exit'].sum()} exit signals")
        
        # Strategy breakdown
        strategy_counts = signals[signals['long_entry']]['signal_type'].value_counts()
        print("📊 Signal breakdown:")
        for strategy, count in strategy_counts.items():
            print(f"   {strategy}: {count} signals")
        
        return signals
    
    def generate_smart_exits(self, data, signals):
        """Generate smart exits based on signal type"""
        entry_indices = signals[signals['long_entry']].index
        
        for entry_idx in entry_indices:
            entry_pos = signals.index.get_loc(entry_idx)
            entry_price = data.loc[entry_idx, 'close']
            signal_type = signals.loc[entry_idx, 'signal_type']
            
            # Different exit strategies based on entry type
            if signal_type == 'momentum_breakout':
                stop_loss = 0.06  # 6% stop loss
                profit_target = 0.12  # 12% profit target
                max_hold = 12  # 12 days max
            elif signal_type == 'mean_reversion':
                stop_loss = 0.04  # 4% stop loss (tighter)
                profit_target = 0.08  # 8% profit target
                max_hold = 8  # 8 days max
            elif signal_type == 'macd_bullish':
                stop_loss = 0.07  # 7% stop loss
                profit_target = 0.15  # 15% profit target
                max_hold = 15  # 15 days max
            else:  # golden_cross
                stop_loss = 0.05  # 5% stop loss
                profit_target = 0.10  # 10% profit target
                max_hold = 10  # 10 days max
            
            # Look for exit conditions
            for j in range(entry_pos + 1, min(entry_pos + max_hold + 1, len(signals))):
                exit_idx = signals.index[j]
                current_price = data.loc[exit_idx, 'close']
                
                # Stop loss or profit target
                if (current_price <= entry_price * (1 - stop_loss) or 
                    current_price >= entry_price * (1 + profit_target)):
                    signals.loc[exit_idx, 'long_exit'] = True
                    break
                    
                # Technical exit for mean reversion (back above BB middle)
                if signal_type == 'mean_reversion' and current_price > data.loc[exit_idx, 'bb_middle']:
                    signals.loc[exit_idx, 'long_exit'] = True
                    break
    
    def backtest_enhanced_strategy(self, data, signals, initial_capital=100000, fees=0.015):
        """Enhanced backtest with position sizing"""
        print(f"📈 Backtesting enhanced strategy with ₹{initial_capital:,} initial capital...")
        
        portfolio = pd.DataFrame(index=data.index)
        portfolio['price'] = data['close']
        portfolio['position'] = 0.0
        portfolio['cash'] = initial_capital
        portfolio['total_value'] = initial_capital
        
        current_position = 0.0
        current_cash = initial_capital
        trades = []
        
        for timestamp, signal_row in signals.iterrows():
            price = data.loc[timestamp, 'close']
            
            if signal_row['long_entry'] and current_position == 0:
                # Dynamic position sizing based on signal type
                signal_type = signal_row['signal_type']
                
                if signal_type == 'momentum_breakout':
                    risk_pct = 0.04  # Risk 4% for momentum
                    stop_loss = 0.06
                elif signal_type == 'mean_reversion':
                    risk_pct = 0.03  # Risk 3% for mean reversion (safer)
                    stop_loss = 0.04
                elif signal_type == 'macd_bullish':
                    risk_pct = 0.05  # Risk 5% for MACD (higher conviction)
                    stop_loss = 0.07
                else:  # golden_cross
                    risk_pct = 0.035  # Risk 3.5% for golden cross
                    stop_loss = 0.05
                
                # Calculate position size
                risk_amount = current_cash * risk_pct
                position_size = risk_amount / (price * stop_loss)
                
                # Don't risk more than 30% of capital
                max_position_value = current_cash * 0.30
                if position_size * price > max_position_value:
                    position_size = max_position_value / price
                
                cost = position_size * price * (1 + fees)
                
                if cost <= current_cash:
                    current_position = position_size
                    current_cash -= cost
                    
                    trades.append({
                        'timestamp': timestamp,
                        'action': 'BUY',
                        'price': price,
                        'shares': position_size,
                        'cost': cost,
                        'strength': signal_row['signal_strength'],
                        'signal_type': signal_row['signal_type']
                    })
                
            elif signal_row['long_exit'] and current_position > 0:
                proceeds = current_position * price * (1 - fees)
                
                if len(trades) > 0:
                    last_buy = trades[-1]
                    trade_return = (proceeds - last_buy['cost']) / last_buy['cost'] * 100
                    
                    trades.append({
                        'timestamp': timestamp,
                        'action': 'SELL',
                        'price': price,
                        'shares': current_position,
                        'proceeds': proceeds,
                        'return_pct': trade_return,
                        'signal_type': last_buy['signal_type']
                    })
                
                current_cash += proceeds
                current_position = 0.0
            
            # Update portfolio
            portfolio.loc[timestamp, 'position'] = current_position
            portfolio.loc[timestamp, 'cash'] = current_cash
            portfolio.loc[timestamp, 'total_value'] = current_cash + (current_position * price)
        
        trades_df = pd.DataFrame(trades)
        
        # Enhanced performance metrics
        total_return = (portfolio['total_value'].iloc[-1] / initial_capital - 1) * 100
        num_trades = len(trades_df[trades_df['action'] == 'SELL'])
        
        if num_trades > 0:
            sell_trades = trades_df[trades_df['action'] == 'SELL']
            win_rate = (sell_trades['return_pct'] > 0).sum() / num_trades * 100
            avg_return = sell_trades['return_pct'].mean()
            best_trade = sell_trades['return_pct'].max()
            worst_trade = sell_trades['return_pct'].min()
            
            # Performance by strategy
            strategy_performance = sell_trades.groupby('signal_type')['return_pct'].agg(['mean', 'count', 'std']).round(2)
            
            print(f"✅ Enhanced Backtest Results:")
            print(f"   Total Return: {total_return:+.2f}%")
            print(f"   Number of Trades: {num_trades}")
            print(f"   Win Rate: {win_rate:.1f}%")
            print(f"   Average Return per Trade: {avg_return:+.2f}%")
            print(f"   Best Trade: {best_trade:+.2f}%")
            print(f"   Worst Trade: {worst_trade:+.2f}%")
            
            print(f"\n📊 Performance by Strategy:")
            for strategy in strategy_performance.index:
                perf = strategy_performance.loc[strategy]
                print(f"   {strategy}: {perf['mean']:+.2f}% avg, {perf['count']} trades")
        else:
            win_rate = avg_return = best_trade = worst_trade = 0
            print("❌ No completed trades")
        
        return portfolio, trades_df

def main():
    """Run comprehensive TATAMOTORS enhanced analysis"""
    print("🚀 TATAMOTORS ENHANCED MULTI-STRATEGY ANALYSIS")
    print("="*60)
    
    analyzer = TATAMOTORSEnhancedDaily()
    
    # Load and filter data
    data = analyzer.load_data()
    filtered_data = analyzer.filter_data_by_period('2021-01-01', '2024-06-28')
    
    # Generate multi-strategy signals
    signals = analyzer.generate_multi_strategy_signals(filtered_data)
    
    if signals['long_entry'].sum() > 0:
        # Backtest enhanced strategy
        portfolio, trades = analyzer.backtest_enhanced_strategy(analyzer.enhanced_data, signals)
        
        # Final performance summary
        total_return = (portfolio['total_value'].iloc[-1] / portfolio['total_value'].iloc[0] - 1) * 100
        benchmark_return = ((filtered_data['close'].iloc[-1] / filtered_data['close'].iloc[0]) - 1) * 100
        
        print(f"\n{'='*80}")
        print("📊 FINAL ENHANCED PERFORMANCE SUMMARY")
        print(f"{'='*80}")
        print(f"Enhanced Strategy Return:  {total_return:+8.2f}%")
        print(f"Buy & Hold Return:         {benchmark_return:+8.2f}%")
        print(f"Alpha:                     {total_return - benchmark_return:+8.2f}%")
        
        if total_return > benchmark_return:
            print("🎉 Enhanced strategy OUTPERFORMED buy & hold!")
        else:
            print("⚠️ Enhanced strategy underperformed buy & hold")
            
        # Risk metrics
        returns = portfolio['total_value'].pct_change().dropna()
        if len(returns) > 0:
            volatility = returns.std() * np.sqrt(252) * 100
            sharpe_ratio = (total_return / volatility) if volatility > 0 else 0
            
            # Max drawdown
            rolling_max = portfolio['total_value'].expanding().max()
            drawdown = (portfolio['total_value'] / rolling_max - 1) * 100
            max_drawdown = drawdown.min()
            
            print(f"\n📊 RISK METRICS:")
            print(f"Volatility (Annualized):   {volatility:8.2f}%")
            print(f"Sharpe Ratio:              {sharpe_ratio:8.2f}")
            print(f"Max Drawdown:              {max_drawdown:8.2f}%")
        
        print(f"\n🎉 ENHANCED ANALYSIS COMPLETE!")
        print(f"📊 Multiple strategies tested with {len(trades[trades['action'] == 'SELL'])} completed trades")
        
        # Show individual trades
        sell_trades = trades[trades['action'] == 'SELL']
        if not sell_trades.empty:
            print(f"\n📋 INDIVIDUAL TRADE RESULTS:")
            print("-" * 80)
            for i, trade in sell_trades.iterrows():
                print(f"Trade {i+1}: {trade['signal_type']} | {trade['return_pct']:+.2f}% | {trade['timestamp'].strftime('%Y-%m-%d')}")
    
    else:
        print("❌ No trading signals generated. Try adjusting parameters.")

if __name__ == "__main__":
    main()

    def create_comprehensive_charts(self, data, signals, portfolio, trades, save_path='tatamotors_enhanced_analysis.html'):
        """Create comprehensive interactive charts"""
        print("🎨 Creating comprehensive interactive charts...")
        
        fig = make_subplots(
            rows=5, cols=1,
            subplot_titles=[
                'TATAMOTORS Price Action & Multi-Strategy Signals', 
                'Technical Indicators (RSI, MACD)', 
                'Portfolio Performance vs Benchmarks',
                'Trade Performance by Strategy Type',
                'Volume & Bollinger Bands Analysis'
            ],
            vertical_spacing=0.05,
            row_heights=[0.3, 0.2, 0.2, 0.15, 0.15]
        )
        
        # 1. Price chart with all indicators
        fig.add_trace(
            go.Candlestick(
                x=data.index,
                open=data['open'],
                high=data['high'],
                low=data['low'],
                close=data['close'],
                name='TATAMOTORS',
                increasing_line_color='#00ff88',
                decreasing_line_color='#ff4444'
            ),
            row=1, col=1
        )
        
        # Moving averages
        fig.add_trace(
            go.Scatter(x=data.index, y=data['sma_10'], name='SMA 10', line=dict(color='orange', width=1)),
            row=1, col=1
        )
        fig.add_trace(
            go.Scatter(x=data.index, y=data['sma_20'], name='SMA 20', line=dict(color='blue', width=1)),
            row=1, col=1
        )
        
        # Bollinger Bands
        fig.add_trace(
            go.Scatter(x=data.index, y=data['bb_upper'], name='BB Upper', 
                      line=dict(color='gray', width=1, dash='dash'), opacity=0.5),
            row=1, col=1
        )
        fig.add_trace(
            go.Scatter(x=data.index, y=data['bb_lower'], name='BB Lower', 
                      line=dict(color='gray', width=1, dash='dash'), opacity=0.5),
            row=1, col=1
        )
        
        # Multi-strategy signals
        buy_signals = signals[signals['long_entry']]
        sell_signals = signals[signals['long_exit']]
        
        # Color code by strategy type
        strategy_colors = {
            'momentum_breakout': 'lime',
            'mean_reversion': 'cyan',
            'macd_bullish': 'yellow',
            'golden_cross': 'magenta'
        }
        
        if not buy_signals.empty:
            for strategy, color in strategy_colors.items():
                strategy_signals = buy_signals[buy_signals['signal_type'] == strategy]
                if not strategy_signals.empty:
                    fig.add_trace(
                        go.Scatter(
                            x=strategy_signals.index,
                            y=data.loc[strategy_signals.index, 'low'] * 0.97,
                            mode='markers',
                            marker=dict(symbol='triangle-up', size=10, color=color),
                            name=f'{strategy} Buy',
                            hovertemplate=f'<b>{strategy.upper()}</b><br>Date: %{{x}}<br>Price: ₹%{{y:.2f}}<extra></extra>'
                        ),
                        row=1, col=1
                    )
        
        if not sell_signals.empty:
            fig.add_trace(
                go.Scatter(
                    x=sell_signals.index,
                    y=data.loc[sell_signals.index, 'high'] * 1.03,
                    mode='markers',
                    marker=dict(symbol='triangle-down', size=10, color='red'),
                    name='Sell Signal',
                    hovertemplate='<b>SELL</b><br>Date: %{x}<br>Price: ₹%{y:.2f}<extra></extra>'
                ),
                row=1, col=1
            )
        
        # 2. Technical indicators
        fig.add_trace(
            go.Scatter(x=data.index, y=data['rsi'], name='RSI', line=dict(color='purple')),
            row=2, col=1
        )
        fig.add_hline(y=70, line_dash="dash", line_color="red", opacity=0.5, row=2, col=1)
        fig.add_hline(y=30, line_dash="dash", line_color="green", opacity=0.5, row=2, col=1)
        
        # MACD
        fig.add_trace(
            go.Scatter(x=data.index, y=data['macd'], name='MACD', line=dict(color='blue')),
            row=2, col=1
        )
        fig.add_trace(
            go.Scatter(x=data.index, y=data['macd_signal'], name='MACD Signal', line=dict(color='red')),
            row=2, col=1
        )
        
        # 3. Portfolio performance
        fig.add_trace(
            go.Scatter(
                x=portfolio.index,
                y=portfolio['total_value'],
                mode='lines',
                name='Enhanced Strategy',
                line=dict(color='#1f77b4', width=3)
            ),
            row=3, col=1
        )
        
        # Buy & Hold benchmark
        initial_price = data['close'].iloc[0]
        benchmark_values = (data['close'] / initial_price) * portfolio['total_value'].iloc[0]
        fig.add_trace(
            go.Scatter(
                x=data.index,
                y=benchmark_values,
                mode='lines',
                name='Buy & Hold',
                line=dict(color='gray', width=2, dash='dash')
            ),
            row=3, col=1
        )
        
        # 4. Trade performance by strategy
        if not trades.empty:
            sell_trades = trades[trades['action'] == 'SELL']
            if not sell_trades.empty:
                strategy_returns = sell_trades.groupby('signal_type')['return_pct'].mean()
                
                fig.add_trace(
                    go.Bar(
                        x=strategy_returns.index,
                        y=strategy_returns.values,
                        name='Avg Return by Strategy',
                        marker_color=['lime', 'cyan', 'yellow', 'magenta']
                    ),
                    row=4, col=1
                )
        
        # 5. Volume analysis
        colors = ['green' if close >= open else 'red' for close, open in zip(data['close'], data['open'])]
        fig.add_trace(
            go.Bar(x=data.index, y=data['volume'], name='Volume', marker_color=colors, opacity=0.3),
            row=5, col=1
        )
        
        fig.add_trace(
            go.Scatter(x=data.index, y=data['volume_sma'], name='Volume SMA', line=dict(color='blue', width=2)),
            row=5, col=1
        )
        
        # Update layout
        fig.update_layout(
            title=dict(
                text='<b>TATAMOTORS Enhanced Multi-Strategy Analysis</b>',
                x=0.5,
                font=dict(size=20)
            ),
            template='plotly_white',
            height=1600,
            showlegend=True
        )
        
        # Update axes
        fig.update_yaxes(title_text="Price (₹)", row=1, col=1)
        fig.update_yaxes(title_text="RSI / MACD", row=2, col=1)
        fig.update_yaxes(title_text="Portfolio Value (₹)", row=3, col=1)
        fig.update_yaxes(title_text="Return (%)", row=4, col=1)
        fig.update_yaxes(title_text="Volume", row=5, col=1)
        fig.update_xaxes(title_text="Date", row=5, col=1)
        
        # Save chart
        fig.write_html(save_path)
        print(f"✅ Comprehensive chart saved to: {save_path}")
        
        return fig

# Update the main function to include chart creation
def main_with_charts():
    """Run comprehensive TATAMOTORS enhanced analysis with charts"""
    print("🚀 TATAMOTORS ENHANCED MULTI-STRATEGY ANALYSIS WITH CHARTS")
    print("="*70)
    
    analyzer = TATAMOTORSEnhancedDaily()
    
    # Load and filter data
    data = analyzer.load_data()
    filtered_data = analyzer.filter_data_by_period('2021-01-01', '2024-06-28')
    
    # Generate multi-strategy signals
    signals = analyzer.generate_multi_strategy_signals(filtered_data)
    
    if signals['long_entry'].sum() > 0:
        # Backtest enhanced strategy
        portfolio, trades = analyzer.backtest_enhanced_strategy(analyzer.enhanced_data, signals)
        
        # Create comprehensive charts
        fig = analyzer.create_comprehensive_charts(
            analyzer.enhanced_data, signals, portfolio, trades,
            'tatamotors_enhanced_analysis.html'
        )
        
        # Final performance summary
        total_return = (portfolio['total_value'].iloc[-1] / portfolio['total_value'].iloc[0] - 1) * 100
        benchmark_return = ((filtered_data['close'].iloc[-1] / filtered_data['close'].iloc[0]) - 1) * 100
        
        print(f"\n{'='*80}")
        print("📊 FINAL ENHANCED PERFORMANCE SUMMARY")
        print(f"{'='*80}")
        print(f"Enhanced Strategy Return:  {total_return:+8.2f}%")
        print(f"Buy & Hold Return:         {benchmark_return:+8.2f}%")
        print(f"Alpha:                     {total_return - benchmark_return:+8.2f}%")
        
        if total_return > benchmark_return:
            print("🎉 Enhanced strategy OUTPERFORMED buy & hold!")
        else:
            print("⚠️ Enhanced strategy underperformed buy & hold")
            
        # Risk metrics
        returns = portfolio['total_value'].pct_change().dropna()
        if len(returns) > 0:
            volatility = returns.std() * np.sqrt(252) * 100
            sharpe_ratio = (total_return / volatility) if volatility > 0 else 0
            
            # Max drawdown
            rolling_max = portfolio['total_value'].expanding().max()
            drawdown = (portfolio['total_value'] / rolling_max - 1) * 100
            max_drawdown = drawdown.min()
            
            print(f"\n📊 RISK METRICS:")
            print(f"Volatility (Annualized):   {volatility:8.2f}%")
            print(f"Sharpe Ratio:              {sharpe_ratio:8.2f}")
            print(f"Max Drawdown:              {max_drawdown:8.2f}%")
        
        print(f"\n�� ENHANCED ANALYSIS COMPLETE!")
        print(f"📊 Comprehensive chart: tatamotors_enhanced_analysis.html")
        print(f"🌐 Open in browser to see beautiful multi-strategy visualizations!")
        print(f"📈 {len(trades[trades['action'] == 'SELL'])} completed trades analyzed")
        
        # Show individual trades
        sell_trades = trades[trades['action'] == 'SELL']
        if not sell_trades.empty:
            print(f"\n📋 INDIVIDUAL TRADE RESULTS:")
            print("-" * 80)
            for i, trade in sell_trades.iterrows():
                print(f"Trade {i+1}: {trade['signal_type']} | {trade['return_pct']:+.2f}% | {trade['timestamp'].strftime('%Y-%m-%d')}")
    
    else:
        print("❌ No trading signals generated. Try adjusting parameters.")

if __name__ == "__main__":
    main_with_charts()
