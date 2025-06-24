#!/usr/bin/env python3
"""
📊 TATAMOTORS BEAUTIFUL EDA & VISUALIZATION SYSTEM

Complete exploratory data analysis with:
- Beautiful price charts
- Equity curves
- Performance metrics
- Pattern analysis
- Risk metrics
- Interactive visualizations
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.graph_objects as go
import plotly.subplots as sp
from plotly.subplots import make_subplots
import plotly.express as px
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# Set style
plt.style.use('seaborn-v0_8')
sns.set_palette("husl")

class TATAMOTORSBeautifulEDA:
    def __init__(self):
        self.data = None
        self.signals = None
        self.portfolio_values = None
        
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
    
    def create_15min_data(self, period_start='2023-01-01', period_end='2024-06-28'):
        """Simulate 15-minute data from daily data for more trading opportunities"""
        print("🕐 Creating 15-minute simulation from daily data...")
        
        # Filter to specific period
        mask = (self.data.index >= period_start) & (self.data.index <= period_end)
        daily_data = self.data[mask].copy()
        
        # Create 15-minute intervals (26 intervals per trading day: 9:15 AM to 3:30 PM)
        fifteen_min_data = []
        
        for date, row in daily_data.iterrows():
            # Create 26 15-minute intervals for each trading day
            base_time = date.replace(hour=9, minute=15)
            
            # Generate realistic intraday price movements
            np.random.seed(int(date.timestamp()) % 10000)  # Consistent but varied
            
            open_price = row['open']
            high_price = row['high']
            low_price = row['low']
            close_price = row['close']
            volume = row['volume']
            
            # Create price path
            price_range = high_price - low_price
            volatility = price_range / open_price * 100
            
            prices = []
            current_price = open_price
            
            for i in range(26):  # 26 intervals in trading day
                if i == 0:
                    interval_open = open_price
                else:
                    interval_open = prices[-1]['close']
                
                # Random walk with bias toward daily close
                bias_factor = (i / 25) * 0.3  # Gradually bias toward close
                random_move = np.random.normal(0, volatility * 0.15)  # 15% of daily volatility per interval
                close_bias = (close_price - interval_open) * bias_factor
                
                interval_close = interval_open + (interval_open * (random_move + close_bias) / 100)
                
                # Ensure we hit daily high/low
                if i == np.random.randint(5, 20):  # Random interval for high
                    interval_high = high_price
                    interval_low = min(interval_open, interval_close)
                elif i == np.random.randint(5, 20):  # Random interval for low
                    interval_low = low_price
                    interval_high = max(interval_open, interval_close)
                else:
                    interval_high = max(interval_open, interval_close) * (1 + np.random.uniform(0, 0.005))
                    interval_low = min(interval_open, interval_close) * (1 - np.random.uniform(0, 0.005))
                
                # Ensure final interval closes at daily close
                if i == 25:
                    interval_close = close_price
                
                interval_volume = volume / 26 * np.random.uniform(0.5, 2.0)  # Distribute volume
                
                timestamp = base_time + timedelta(minutes=15*i)
                
                prices.append({
                    'timestamp': timestamp,
                    'open': interval_open,
                    'high': interval_high,
                    'low': interval_low,
                    'close': interval_close,
                    'volume': interval_volume
                })
            
            fifteen_min_data.extend(prices)
        
        # Convert to DataFrame
        intraday_df = pd.DataFrame(fifteen_min_data)
        intraday_df.set_index('timestamp', inplace=True)
        
        print(f"✅ Created {len(intraday_df)} 15-minute intervals")
        print(f"   Period: {intraday_df.index[0]} to {intraday_df.index[-1]}")
        
        return intraday_df
    
    def generate_signals(self, data, momentum_candles=3, min_momentum_pct=0.2, engulf_ratio=1.1):
        """Generate trading signals using engulfing pattern"""
        print(f"🎯 Generating signals: {momentum_candles}-candle momentum, {min_momentum_pct}% threshold...")
        
        data = data.copy()
        data['is_green'] = data['close'] > data['open']
        data['body_size'] = abs(data['close'] - data['open'])
        
        signals = pd.DataFrame(index=data.index)
        signals['long_entry'] = False
        signals['long_exit'] = False
        signals['signal_strength'] = 0.0
        
        max_hold_periods = 20  # 5 hours for 15-min data
        
        # Pattern detection
        for i in range(momentum_candles + 1, len(data)):
            if momentum_candles == 1:
                previous = data.iloc[i-1]
                current = data.iloc[i]
                all_red = not previous['is_green']
            else:
                momentum_data = data.iloc[i-momentum_candles:i]
                current = data.iloc[i]
                
                all_red = all(~momentum_data['is_green'])
                
                if not all_red:
                    continue
                
                # Momentum strength check
                momentum_start = momentum_data['open'].iloc[0]
                momentum_end = momentum_data['close'].iloc[-1]
                momentum_pct = abs((momentum_end - momentum_start) / momentum_start) * 100
                
                if momentum_pct < min_momentum_pct:
                    continue
            
            # Bullish engulfing pattern
            current_body = current['body_size']
            previous_body = data.iloc[i-1]['body_size']
            
            if previous_body == 0:
                continue
            
            if (all_red and current['is_green'] and 
                current['open'] <= data.iloc[i-1]['close'] and
                current['close'] >= data.iloc[i-1]['open'] and
                current_body >= previous_body * engulf_ratio):
                
                signals.iloc[i, signals.columns.get_loc('long_entry')] = True
                signals.iloc[i, signals.columns.get_loc('signal_strength')] = current_body / previous_body
        
        # Generate exits
        entry_indices = signals[signals['long_entry']].index
        for entry_idx in entry_indices:
            entry_pos = signals.index.get_loc(entry_idx)
            exit_pos = min(entry_pos + max_hold_periods, len(signals) - 1)
            exit_idx = signals.index[exit_pos]
            signals.loc[exit_idx, 'long_exit'] = True
        
        print(f"✅ Generated {signals['long_entry'].sum()} entry signals")
        print(f"✅ Generated {signals['long_exit'].sum()} exit signals")
        
        self.signals = signals
        return signals
    
    def backtest_strategy(self, data, signals, initial_capital=100000, fees=0.015):
        """Backtest the strategy and create equity curve"""
        print(f"📈 Backtesting with ₹{initial_capital:,} initial capital...")
        
        portfolio = pd.DataFrame(index=data.index)
        portfolio['price'] = data['close']
        portfolio['position'] = 0.0
        portfolio['cash'] = initial_capital
        portfolio['total_value'] = initial_capital
        portfolio['returns'] = 0.0
        
        current_position = 0.0
        current_cash = initial_capital
        trades = []
        
        for i, (timestamp, signal_row) in enumerate(signals.iterrows()):
            price = data.loc[timestamp, 'close']
            
            if signal_row['long_entry'] and current_position == 0:
                # Buy signal
                shares_to_buy = current_cash / (price * (1 + fees))
                cost = shares_to_buy * price * (1 + fees)
                
                current_position = shares_to_buy
                current_cash -= cost
                
                trades.append({
                    'timestamp': timestamp,
                    'action': 'BUY',
                    'price': price,
                    'shares': shares_to_buy,
                    'cost': cost,
                    'strength': signal_row['signal_strength']
                })
                
            elif signal_row['long_exit'] and current_position > 0:
                # Sell signal
                proceeds = current_position * price * (1 - fees)
                
                trade_return = (proceeds - trades[-1]['cost']) / trades[-1]['cost'] * 100
                
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
            
            # Update portfolio values
            portfolio.loc[timestamp, 'position'] = current_position
            portfolio.loc[timestamp, 'cash'] = current_cash
            portfolio.loc[timestamp, 'total_value'] = current_cash + (current_position * price)
        
        # Calculate returns
        portfolio['returns'] = portfolio['total_value'].pct_change()
        portfolio['cumulative_returns'] = (1 + portfolio['returns']).cumprod()
        
        self.portfolio_values = portfolio
        self.trades = pd.DataFrame(trades)
        
        # Calculate performance metrics
        total_return = (portfolio['total_value'].iloc[-1] / initial_capital - 1) * 100
        num_trades = len(self.trades[self.trades['action'] == 'SELL'])
        
        if num_trades > 0:
            win_rate = (self.trades[self.trades['action'] == 'SELL']['return_pct'] > 0).sum() / num_trades * 100
            avg_return = self.trades[self.trades['action'] == 'SELL']['return_pct'].mean()
        else:
            win_rate = 0
            avg_return = 0
        
        print(f"✅ Backtest complete:")
        print(f"   Total Return: {total_return:+.2f}%")
        print(f"   Number of Trades: {num_trades}")
        print(f"   Win Rate: {win_rate:.1f}%")
        print(f"   Average Return per Trade: {avg_return:+.2f}%")
        
        return portfolio, self.trades
    
    def create_beautiful_charts(self, data, signals, portfolio, save_path='tatamotors_analysis.html'):
        """Create beautiful interactive charts"""
        print("🎨 Creating beautiful interactive charts...")
        
        # Create subplots
        fig = make_subplots(
            rows=4, cols=1,
            subplot_titles=['TATAMOTORS Price Action & Signals', 'Volume Analysis', 'Equity Curve', 'Trade Performance'],
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
        
        # Add buy signals
        buy_signals = signals[signals['long_entry']]
        if not buy_signals.empty:
            fig.add_trace(
                go.Scatter(
                    x=buy_signals.index,
                    y=data.loc[buy_signals.index, 'low'] * 0.995,
                    mode='markers',
                    marker=dict(symbol='triangle-up', size=12, color='lime'),
                    name='Buy Signal',
                    text=[f'Strength: {s:.2f}' for s in buy_signals['signal_strength']],
                    hovertemplate='<b>BUY SIGNAL</b><br>Date: %{x}<br>Price: ₹%{y:.2f}<br>%{text}<extra></extra>'
                ),
                row=1, col=1
            )
        
        # Add sell signals
        sell_signals = signals[signals['long_exit']]
        if not sell_signals.empty:
            fig.add_trace(
                go.Scatter(
                    x=sell_signals.index,
                    y=data.loc[sell_signals.index, 'high'] * 1.005,
                    mode='markers',
                    marker=dict(symbol='triangle-down', size=12, color='red'),
                    name='Sell Signal',
                    hovertemplate='<b>SELL SIGNAL</b><br>Date: %{x}<br>Price: ₹%{y:.2f}<extra></extra>'
                ),
                row=1, col=1
            )
        
        # 2. Volume chart
        colors = ['green' if close >= open else 'red' for close, open in zip(data['close'], data['open'])]
        fig.add_trace(
            go.Bar(
                x=data.index,
                y=data['volume'],
                name='Volume',
                marker_color=colors,
                opacity=0.7
            ),
            row=2, col=1
        )
        
        # 3. Equity curve
        fig.add_trace(
            go.Scatter(
                x=portfolio.index,
                y=portfolio['total_value'],
                mode='lines',
                name='Portfolio Value',
                line=dict(color='#1f77b4', width=2),
                hovertemplate='<b>Portfolio Value</b><br>Date: %{x}<br>Value: ₹%{y:,.0f}<extra></extra>'
            ),
            row=3, col=1
        )
        
        # Add benchmark (buy and hold)
        initial_price = data['close'].iloc[0]
        final_price = data['close'].iloc[-1]
        benchmark_multiplier = final_price / initial_price
        benchmark_value = portfolio['total_value'].iloc[0] * benchmark_multiplier
        
        fig.add_trace(
            go.Scatter(
                x=[portfolio.index[0], portfolio.index[-1]],
                y=[portfolio['total_value'].iloc[0], benchmark_value],
                mode='lines',
                name='Buy & Hold',
                line=dict(color='gray', width=2, dash='dash'),
                hovertemplate='<b>Buy & Hold</b><br>Date: %{x}<br>Value: ₹%{y:,.0f}<extra></extra>'
            ),
            row=3, col=1
        )
        
        # 4. Trade performance
        if hasattr(self, 'trades') and not self.trades.empty:
            sell_trades = self.trades[self.trades['action'] == 'SELL']
            if not sell_trades.empty:
                colors_trades = ['green' if ret > 0 else 'red' for ret in sell_trades['return_pct']]
                fig.add_trace(
                    go.Bar(
                        x=list(range(1, len(sell_trades) + 1)),
                        y=sell_trades['return_pct'],
                        name='Trade Returns',
                        marker_color=colors_trades,
                        hovertemplate='<b>Trade %{x}</b><br>Return: %{y:.2f}%<extra></extra>'
                    ),
                    row=4, col=1
                )
        
        # Update layout
        fig.update_layout(
            title=dict(
                text='<b>TATAMOTORS 15-Minute Trading Strategy Analysis</b>',
                x=0.5,
                font=dict(size=20)
            ),
            template='plotly_white',
            height=1200,
            showlegend=True,
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1)
        )
        
        # Update axes
        fig.update_xaxes(title_text="Date", row=4, col=1)
        fig.update_yaxes(title_text="Price (₹)", row=1, col=1)
        fig.update_yaxes(title_text="Volume", row=2, col=1)
        fig.update_yaxes(title_text="Portfolio Value (₹)", row=3, col=1)
        fig.update_yaxes(title_text="Return (%)", row=4, col=1)
        
        # Save chart
        fig.write_html(save_path)
        print(f"✅ Interactive chart saved to: {save_path}")
        
        return fig
    
    def create_performance_summary(self):
        """Create beautiful performance summary"""
        if not hasattr(self, 'portfolio_values') or not hasattr(self, 'trades'):
            print("❌ No backtest data available. Run backtest first.")
            return
        
        print("\n" + "="*80)
        print("📊 TATAMOTORS 15-MINUTE STRATEGY PERFORMANCE SUMMARY")
        print("="*80)
        
        portfolio = self.portfolio_values
        trades = self.trades
        
        # Basic metrics
        initial_value = portfolio['total_value'].iloc[0]
        final_value = portfolio['total_value'].iloc[-1]
        total_return = (final_value / initial_value - 1) * 100
        
        # Trade metrics
        sell_trades = trades[trades['action'] == 'SELL']
        num_trades = len(sell_trades)
        
        if num_trades > 0:
            win_trades = sell_trades[sell_trades['return_pct'] > 0]
            win_rate = len(win_trades) / num_trades * 100
            avg_return = sell_trades['return_pct'].mean()
            best_trade = sell_trades['return_pct'].max()
            worst_trade = sell_trades['return_pct'].min()
        else:
            win_rate = avg_return = best_trade = worst_trade = 0
        
        # Risk metrics
        returns = portfolio['returns'].dropna()
        if len(returns) > 0:
            volatility = returns.std() * np.sqrt(252 * 26) * 100  # Annualized for 15-min data
            sharpe_ratio = (total_return / volatility) if volatility > 0 else 0
            
            # Max drawdown
            rolling_max = portfolio['total_value'].expanding().max()
            drawdown = (portfolio['total_value'] / rolling_max - 1) * 100
            max_drawdown = drawdown.min()
        else:
            volatility = sharpe_ratio = max_drawdown = 0
        
        # Benchmark comparison
        initial_price = self.data['close'].iloc[0]
        final_price = self.data['close'].iloc[-1]
        benchmark_return = (final_price / initial_price - 1) * 100
        
        print(f"💰 RETURN METRICS:")
        print(f"   Strategy Return:     {total_return:+8.2f}%")
        print(f"   Buy & Hold Return:   {benchmark_return:+8.2f}%")
        print(f"   Alpha:               {total_return - benchmark_return:+8.2f}%")
        print(f"   Initial Capital:     ₹{initial_value:10,.0f}")
        print(f"   Final Value:         ₹{final_value:10,.0f}")
        print(f"   Profit/Loss:         ₹{final_value - initial_value:+10,.0f}")
        
        print(f"\n📈 TRADE METRICS:")
        print(f"   Total Trades:        {num_trades:8}")
        print(f"   Win Rate:            {win_rate:8.1f}%")
        print(f"   Average Return:      {avg_return:+8.2f}%")
        print(f"   Best Trade:          {best_trade:+8.2f}%")
        print(f"   Worst Trade:         {worst_trade:+8.2f}%")
        
        print(f"\n⚠️ RISK METRICS:")
        print(f"   Volatility (Ann.):   {volatility:8.2f}%")
        print(f"   Sharpe Ratio:        {sharpe_ratio:8.2f}")
        print(f"   Max Drawdown:        {max_drawdown:8.2f}%")
        
        print(f"\n🎯 STRATEGY ASSESSMENT:")
        if total_return > benchmark_return and num_trades >= 5:
            print("   ✅ OUTPERFORMING - Strategy beats buy & hold with sufficient trades")
        elif total_return > 0 and num_trades >= 3:
            print("   🟡 POSITIVE - Strategy profitable but needs more trades")
        elif num_trades < 3:
            print("   ⚠️ INSUFFICIENT DATA - Too few trades for reliable assessment")
        else:
            print("   ❌ UNDERPERFORMING - Strategy needs optimization")
        
        return {
            'total_return': total_return,
            'benchmark_return': benchmark_return,
            'num_trades': num_trades,
            'win_rate': win_rate,
            'sharpe_ratio': sharpe_ratio,
            'max_drawdown': max_drawdown
        }

def main():
    """Run complete TATAMOTORS EDA and analysis"""
    print("🚀 TATAMOTORS BEAUTIFUL EDA & 15-MINUTE ANALYSIS")
    print("="*60)
    
    # Initialize analyzer
    analyzer = TATAMOTORSBeautifulEDA()
    
    # Load data
    data = analyzer.load_data()
    
    # Create 15-minute data for more trading opportunities
    intraday_data = analyzer.create_15min_data('2023-01-01', '2024-06-28')
    
    # Test different configurations for more trades
    configs = [
        {'momentum_candles': 2, 'min_momentum_pct': 0.15, 'engulf_ratio': 1.05, 'name': 'Aggressive'},
        {'momentum_candles': 3, 'min_momentum_pct': 0.2, 'engulf_ratio': 1.1, 'name': 'Balanced'},
        {'momentum_candles': 1, 'min_momentum_pct': 0.1, 'engulf_ratio': 1.02, 'name': 'Ultra-Aggressive'},
    ]
    
    best_config = None
    best_performance = -999
    
    for config in configs:
        print(f"\n🔍 Testing {config['name']} configuration...")
        
        # Generate signals
        signals = analyzer.generate_signals(
            intraday_data, 
            momentum_candles=config['momentum_candles'],
            min_momentum_pct=config['min_momentum_pct'],
            engulf_ratio=config['engulf_ratio']
        )
        
        # Backtest
        portfolio, trades = analyzer.backtest_strategy(intraday_data, signals)
        
        # Quick performance check
        if len(trades[trades['action'] == 'SELL']) >= 3:  # Need minimum 3 trades
            total_return = (portfolio['total_value'].iloc[-1] / portfolio['total_value'].iloc[0] - 1) * 100
            if total_return > best_performance:
                best_performance = total_return
                best_config = config
                best_signals = signals
                best_portfolio = portfolio
    
    if best_config:
        print(f"\n🏆 BEST CONFIGURATION: {best_config['name']}")
        
        # Create beautiful charts
        fig = analyzer.create_beautiful_charts(
            intraday_data, 
            best_signals, 
            best_portfolio,
            'tatamotors_15min_analysis.html'
        )
        
        # Performance summary
        performance = analyzer.create_performance_summary()
        
        print(f"\n🎨 Beautiful interactive chart created: tatamotors_15min_analysis.html")
        print(f"📊 Open the HTML file in your browser to see the analysis!")
        
    else:
        print("\n⚠️ No configuration generated sufficient trades. Try adjusting parameters.")

if __name__ == "__main__":
    main() 