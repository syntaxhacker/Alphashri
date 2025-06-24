#!/usr/bin/env python3
"""
📊 TATAMOTORS DAILY EDA WITH IMPROVED STRATEGY

Focus on daily timeframe with:
- Better trade management  
- Multiple strategies
- Beautiful visualizations
- Realistic performance expectations
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

class TATAMOTORSDailyEDA:
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
    
    def calculate_rsi(self, prices, period=14):
        """Calculate RSI indicator"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    def generate_breakout_signals(self, data):
        """Generate breakout signals with volume confirmation"""
        print("🎯 Generating breakout signals...")
        
        data = data.copy()
        
        # Technical indicators
        data['sma_20'] = data['close'].rolling(window=20).mean()
        data['volume_sma'] = data['volume'].rolling(window=20).mean()
        data['rsi'] = self.calculate_rsi(data['close'], 14)
        
        # Store the enhanced data for later use
        self.enhanced_data = data
        
        signals = pd.DataFrame(index=data.index)
        signals['long_entry'] = False
        signals['long_exit'] = False
        signals['signal_strength'] = 0.0
        
        for i in range(50, len(data)):
            current = data.iloc[i]
            
            # Breakout conditions
            price_breakout = current['close'] > data['high'].iloc[i-10:i].max()  # 10-day high breakout
            volume_surge = current['volume'] > data['volume_sma'].iloc[i] * 1.3  # Volume 30% above average
            uptrend = current['close'] > current['sma_20']  # Price above 20-day MA
            rsi_momentum = 50 < current['rsi'] < 75  # RSI in momentum zone
            
            if price_breakout and volume_surge and uptrend and rsi_momentum:
                signals.iloc[i, signals.columns.get_loc('long_entry')] = True
                signals.iloc[i, signals.columns.get_loc('signal_strength')] = (current['volume'] / data['volume_sma'].iloc[i])
        
        # Generate exits with stop loss and profit target
        entry_indices = signals[signals['long_entry']].index
        for entry_idx in entry_indices:
            entry_pos = signals.index.get_loc(entry_idx)
            entry_price = data.loc[entry_idx, 'close']
            
            # Look for exit conditions (max 15 days hold)
            for j in range(entry_pos + 1, min(entry_pos + 15, len(signals))):
                exit_idx = signals.index[j]
                current_price = data.loc[exit_idx, 'close']
                
                # 8% stop loss or 15% profit target
                if current_price <= entry_price * 0.92 or current_price >= entry_price * 1.15:
                    signals.loc[exit_idx, 'long_exit'] = True
                    break
        
        print(f"✅ Generated {signals['long_entry'].sum()} entry signals")
        print(f"✅ Generated {signals['long_exit'].sum()} exit signals")
        
        return signals
    
    def backtest_strategy(self, data, signals, initial_capital=100000, fees=0.015):
        """Backtest the strategy"""
        print(f"📈 Backtesting with ₹{initial_capital:,} initial capital...")
        
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
                # Risk 3% of capital per trade
                risk_amount = current_cash * 0.03
                stop_loss_pct = 0.08  # 8% stop loss
                position_size = risk_amount / (price * stop_loss_pct)
                
                # Don't risk more than 25% of capital
                max_position_value = current_cash * 0.25
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
                        'strength': signal_row['signal_strength']
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
                        'return_pct': trade_return
                    })
                
                current_cash += proceeds
                current_position = 0.0
            
            # Update portfolio
            portfolio.loc[timestamp, 'position'] = current_position
            portfolio.loc[timestamp, 'cash'] = current_cash
            portfolio.loc[timestamp, 'total_value'] = current_cash + (current_position * price)
        
        trades_df = pd.DataFrame(trades)
        
        # Performance metrics
        total_return = (portfolio['total_value'].iloc[-1] / initial_capital - 1) * 100
        num_trades = len(trades_df[trades_df['action'] == 'SELL'])
        
        if num_trades > 0:
            sell_trades = trades_df[trades_df['action'] == 'SELL']
            win_rate = (sell_trades['return_pct'] > 0).sum() / num_trades * 100
            avg_return = sell_trades['return_pct'].mean()
            best_trade = sell_trades['return_pct'].max()
            worst_trade = sell_trades['return_pct'].min()
        else:
            win_rate = avg_return = best_trade = worst_trade = 0
        
        print(f"✅ Backtest Results:")
        print(f"   Total Return: {total_return:+.2f}%")
        print(f"   Number of Trades: {num_trades}")
        print(f"   Win Rate: {win_rate:.1f}%")
        print(f"   Average Return per Trade: {avg_return:+.2f}%")
        if num_trades > 0:
            print(f"   Best Trade: {best_trade:+.2f}%")
            print(f"   Worst Trade: {worst_trade:+.2f}%")
        
        return portfolio, trades_df
    
    def create_beautiful_charts(self, data, signals, portfolio, trades, save_path='tatamotors_daily_analysis.html'):
        """Create beautiful interactive charts"""
        print("🎨 Creating beautiful interactive charts...")
        
        fig = make_subplots(
            rows=4, cols=1,
            subplot_titles=[
                'TATAMOTORS Price Action & Signals', 
                'Volume Analysis', 
                'Portfolio Equity Curve', 
                'Individual Trade Performance'
            ],
            vertical_spacing=0.08,
            row_heights=[0.4, 0.2, 0.25, 0.15]
        )
        
        # 1. Price chart with signals
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
        
        # Add moving average
        fig.add_trace(
            go.Scatter(x=data.index, y=data['sma_20'], name='SMA 20', line=dict(color='orange', width=2)),
            row=1, col=1
        )
        
        # Buy signals
        buy_signals = signals[signals['long_entry']]
        if not buy_signals.empty:
            fig.add_trace(
                go.Scatter(
                    x=buy_signals.index,
                    y=data.loc[buy_signals.index, 'low'] * 0.98,
                    mode='markers',
                    marker=dict(symbol='triangle-up', size=12, color='lime'),
                    name='Buy Signal',
                    text=[f'Strength: {s:.1f}' for s in buy_signals['signal_strength']],
                    hovertemplate='<b>BUY</b><br>Date: %{x}<br>Price: ₹%{y:.2f}<br>%{text}<extra></extra>'
                ),
                row=1, col=1
            )
        
        # Sell signals
        sell_signals = signals[signals['long_exit']]
        if not sell_signals.empty:
            fig.add_trace(
                go.Scatter(
                    x=sell_signals.index,
                    y=data.loc[sell_signals.index, 'high'] * 1.02,
                    mode='markers',
                    marker=dict(symbol='triangle-down', size=12, color='red'),
                    name='Sell Signal',
                    hovertemplate='<b>SELL</b><br>Date: %{x}<br>Price: ₹%{y:.2f}<extra></extra>'
                ),
                row=1, col=1
            )
        
        # 2. Volume
        colors = ['green' if close >= open else 'red' for close, open in zip(data['close'], data['open'])]
        fig.add_trace(
            go.Bar(x=data.index, y=data['volume'], name='Volume', marker_color=colors, opacity=0.7),
            row=2, col=1
        )
        
        # Volume average
        fig.add_trace(
            go.Scatter(x=data.index, y=data['volume_sma'], name='Volume SMA', line=dict(color='blue', width=2)),
            row=2, col=1
        )
        
        # 3. Equity curve
        fig.add_trace(
            go.Scatter(
                x=portfolio.index,
                y=portfolio['total_value'],
                mode='lines',
                name='Strategy',
                line=dict(color='#1f77b4', width=3),
                hovertemplate='<b>Portfolio</b><br>Date: %{x}<br>Value: ₹%{y:,.0f}<extra></extra>'
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
                line=dict(color='gray', width=2, dash='dash'),
                hovertemplate='<b>Buy & Hold</b><br>Date: %{x}<br>Value: ₹%{y:,.0f}<extra></extra>'
            ),
            row=3, col=1
        )
        
        # 4. Trade performance
        if not trades.empty:
            sell_trades = trades[trades['action'] == 'SELL']
            if not sell_trades.empty:
                colors_trades = ['green' if ret > 0 else 'red' for ret in sell_trades['return_pct']]
                fig.add_trace(
                    go.Bar(
                        x=list(range(1, len(sell_trades) + 1)),
                        y=sell_trades['return_pct'],
                        name='Trade Returns',
                        marker_color=colors_trades,
                        hovertemplate='<b>Trade %{x}</b><br>Return: %{y:.2f}%<br>Date: %{text}<extra></extra>',
                        text=[d.strftime('%Y-%m-%d') for d in sell_trades['timestamp']]
                    ),
                    row=4, col=1
                )
        
        # Update layout
        fig.update_layout(
            title=dict(
                text='<b>TATAMOTORS Daily Breakout Strategy Analysis</b>',
                x=0.5,
                font=dict(size=20)
            ),
            template='plotly_white',
            height=1200,
            showlegend=True
        )
        
        # Update axes
        fig.update_yaxes(title_text="Price (₹)", row=1, col=1)
        fig.update_yaxes(title_text="Volume", row=2, col=1)
        fig.update_yaxes(title_text="Portfolio Value (₹)", row=3, col=1)
        fig.update_yaxes(title_text="Return (%)", row=4, col=1)
        fig.update_xaxes(title_text="Date", row=4, col=1)
        
        # Save chart
        fig.write_html(save_path)
        print(f"✅ Interactive chart saved to: {save_path}")
        
        return fig

def main():
    """Run complete TATAMOTORS daily analysis"""
    print("🚀 TATAMOTORS DAILY BREAKOUT STRATEGY ANALYSIS")
    print("="*60)
    
    analyzer = TATAMOTORSDailyEDA()
    
    # Load and filter data to recent period with good volatility
    data = analyzer.load_data()
    filtered_data = analyzer.filter_data_by_period('2021-01-01', '2024-06-28')
    
    # Generate signals
    signals = analyzer.generate_breakout_signals(filtered_data)
    
    if signals['long_entry'].sum() > 0:
        # Backtest strategy
        portfolio, trades = analyzer.backtest_strategy(filtered_data, signals)
        
        # Create beautiful charts (use enhanced data with indicators)
        fig = analyzer.create_beautiful_charts(
            analyzer.enhanced_data, signals, portfolio, trades,
            'tatamotors_daily_analysis.html'
        )
        
        # Performance summary
        total_return = (portfolio['total_value'].iloc[-1] / portfolio['total_value'].iloc[0] - 1) * 100
        benchmark_return = ((filtered_data['close'].iloc[-1] / filtered_data['close'].iloc[0]) - 1) * 100
        
        print(f"\n{'='*60}")
        print("📊 FINAL PERFORMANCE SUMMARY")
        print(f"{'='*60}")
        print(f"Strategy Return:    {total_return:+8.2f}%")
        print(f"Buy & Hold Return:  {benchmark_return:+8.2f}%")
        print(f"Alpha:              {total_return - benchmark_return:+8.2f}%")
        
        if total_return > benchmark_return:
            print("✅ Strategy OUTPERFORMED buy & hold!")
        else:
            print("⚠️ Strategy underperformed buy & hold")
        
        print(f"\n🎉 ANALYSIS COMPLETE!")
        print(f"📊 Interactive chart: tatamotors_daily_analysis.html")
        print(f"🌐 Open in browser to see beautiful visualizations!")
    
    else:
        print("❌ No trading signals generated. Try adjusting parameters.")

if __name__ == "__main__":
    main()
