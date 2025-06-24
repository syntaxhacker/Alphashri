#!/usr/bin/env python3
"""
🎨 TATAMOTORS 15-MINUTE ECHARTS DASHBOARD

Beautiful ECharts visualization for intraday trading with:
- 15-minute candlestick data
- Improved intraday strategies
- More conservative approach
- Professional visualization
"""

import pandas as pd
import numpy as np
import json
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

class TATAMOTORS15MinECharts:
    def __init__(self):
        self.data = None
        self.signals = None
        self.portfolio = None
        self.trades = None
    
    def load_csv_data(self):
        """Load TATAMOTORS data from CSV"""
        print("📂 Loading TATAMOTORS data from CSV...")
        
        try:
            # Load the CSV data
            data = pd.read_csv('data/TATAMOTORS.NS.csv')
            data['Date'] = pd.to_datetime(data['Date'])
            data.set_index('Date', inplace=True)
            
            # Rename columns to match our format
            data.rename(columns={
                'Open': 'open',
                'High': 'high', 
                'Low': 'low',
                'Close': 'close',
                'Volume': 'volume'
            }, inplace=True)
            
            print(f"✅ Loaded {len(data)} rows from {data.index[0].date()} to {data.index[-1].date()}")
            print(f"   Price range: ₹{data['close'].min():.2f} - ₹{data['close'].max():.2f}")
            
            return data
            
        except Exception as e:
            print(f"❌ Error loading CSV: {e}")
            return None
    
    def create_15min_data(self, daily_data, start_date='2023-01-01', end_date='2024-06-28'):
        """Create realistic 15-minute data from daily data"""
        print("🕐 Creating realistic 15-minute intraday data...")
        
        # Filter to recent period for better performance
        filtered_data = daily_data[start_date:end_date].copy()
        print(f"📅 Using period: {start_date} to {end_date}")
        print(f"   {len(filtered_data)} trading days")
        
        intraday_data = []
        
        for date, row in filtered_data.iterrows():
            # Create 25 15-minute intervals per day (9:15 AM to 3:30 PM = 375 minutes)
            daily_open = row['open']
            daily_high = row['high']
            daily_low = row['low']
            daily_close = row['close']
            daily_volume = row['volume']
            
            # Create realistic intraday price movement
            price_range = daily_high - daily_low
            trend = (daily_close - daily_open) / daily_open
            
            # Generate 25 15-minute candles
            for i in range(25):
                timestamp = date.replace(hour=9, minute=15) + timedelta(minutes=15*i)
                
                # Create realistic price progression
                progress = i / 24.0
                
                # Base price follows the daily trend
                base_price = daily_open + (daily_close - daily_open) * progress
                
                # Add intraday volatility (smaller range)
                volatility = price_range * 0.3 * np.random.uniform(0.5, 1.5)
                noise = np.random.uniform(-volatility/2, volatility/2)
                
                # Calculate OHLC for this 15-min interval
                interval_open = base_price + noise
                interval_close = interval_open + (daily_close - daily_open) * 0.04 + np.random.uniform(-volatility/4, volatility/4)
                
                # Ensure high/low make sense
                interval_high = max(interval_open, interval_close) + np.random.uniform(0, volatility/6)
                interval_low = min(interval_open, interval_close) - np.random.uniform(0, volatility/6)
                
                # Ensure within daily bounds
                interval_high = min(interval_high, daily_high)
                interval_low = max(interval_low, daily_low)
                
                # Volume distribution (higher in morning/evening)
                if i < 5 or i > 20:  # Opening/closing hours
                    interval_volume = daily_volume * 0.06  # 6% of daily volume
                else:
                    interval_volume = daily_volume * 0.03  # 3% of daily volume
                
                intraday_data.append({
                    'timestamp': timestamp,
                    'open': max(interval_open, 0.01),
                    'high': max(interval_high, 0.01),
                    'low': max(interval_low, 0.01),
                    'close': max(interval_close, 0.01),
                    'volume': max(interval_volume, 100)
                })
        
        # Convert to DataFrame
        intraday_df = pd.DataFrame(intraday_data)
        intraday_df.set_index('timestamp', inplace=True)
        intraday_df = intraday_df.sort_index()
        
        print(f"✅ Created {len(intraday_df)} 15-minute intervals")
        print(f"   Price range: ₹{intraday_df['close'].min():.2f} - ₹{intraday_df['close'].max():.2f}")
        
        return intraday_df
    
    def add_technical_indicators(self, data):
        """Add technical indicators optimized for 15-minute timeframe"""
        print("📊 Adding technical indicators for 15-minute analysis...")
        
        data = data.copy()
        
        # Shorter-period indicators for 15-min timeframe
        data['sma_5'] = data['close'].rolling(window=5).mean()   # 75 minutes
        data['sma_10'] = data['close'].rolling(window=10).mean() # 2.5 hours
        data['sma_20'] = data['close'].rolling(window=20).mean() # 5 hours
        
        # EMA for faster response
        data['ema_8'] = data['close'].ewm(span=8).mean()   # 2 hours
        data['ema_21'] = data['close'].ewm(span=21).mean() # 5.25 hours
        
        # RSI with shorter period
        delta = data['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=10).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=10).mean()
        rs = gain / loss
        data['rsi'] = 100 - (100 / (1 + rs))
        
        # Bollinger Bands (shorter period)
        data['bb_middle'] = data['close'].rolling(window=15).mean()
        bb_std = data['close'].rolling(window=15).std()
        data['bb_upper'] = data['bb_middle'] + (bb_std * 2)
        data['bb_lower'] = data['bb_middle'] - (bb_std * 2)
        
        # MACD (faster settings)
        ema_12 = data['close'].ewm(span=12).mean()
        ema_26 = data['close'].ewm(span=26).mean()
        data['macd'] = ema_12 - ema_26
        data['macd_signal'] = data['macd'].ewm(span=9).mean()
        data['macd_histogram'] = data['macd'] - data['macd_signal']
        
        # Volume indicators
        data['volume_sma'] = data['volume'].rolling(window=20).mean()
        data['volume_ratio'] = data['volume'] / data['volume_sma']
        
        print("✅ Technical indicators added")
        return data
    
    def generate_improved_intraday_signals(self, data):
        """Generate improved intraday trading signals"""
        print("🎯 Generating improved intraday signals...")
        
        signals = pd.DataFrame(index=data.index)
        signals['long_entry'] = False
        signals['long_exit'] = False
        signals['signal_type'] = ''
        
        # Strategy 1: Mean Reversion with Volume
        mean_reversion = (
            (data['close'] < data['bb_lower']) &  # Oversold
            (data['rsi'] < 35) &  # RSI oversold
            (data['volume_ratio'] > 1.2) &  # Above average volume
            (data['close'] > data['sma_20'])  # Still in uptrend
        )
        
        # Strategy 2: Momentum Breakout
        momentum_breakout = (
            (data['close'] > data['bb_upper']) &  # Breakout
            (data['rsi'] > 60) &  # Strong momentum
            (data['volume_ratio'] > 1.1) &  # Volume confirmation
            (data['ema_8'] > data['ema_21'])  # Short-term uptrend
        )
        
        # Strategy 3: EMA Crossover
        ema_crossover = (
            (data['ema_8'] > data['ema_21']) &  # Bullish crossover
            (data['ema_8'].shift(1) <= data['ema_21'].shift(1)) &  # Just crossed
            (data['rsi'] > 45) &  # Not oversold
            (data['volume_ratio'] > 1.0)  # Volume support
        )
        
        # Combine signals with reduced frequency
        entry_conditions = mean_reversion | momentum_breakout | ema_crossover
        
        # Add signal types
        signals.loc[mean_reversion, 'signal_type'] = 'mean_reversion'
        signals.loc[momentum_breakout, 'signal_type'] = 'momentum_breakout'
        signals.loc[ema_crossover, 'signal_type'] = 'ema_crossover'
        
        # Space out signals (minimum 2 hours between signals)
        min_gap = 8  # 8 * 15min = 2 hours
        
        filtered_entries = []
        last_signal_idx = -min_gap
        
        for i, (idx, row) in enumerate(signals.iterrows()):
            if entry_conditions.loc[idx] and (i - last_signal_idx) >= min_gap:
                filtered_entries.append(idx)
                last_signal_idx = i
        
        # Set filtered entries
        signals['long_entry'] = False
        signals.loc[filtered_entries, 'long_entry'] = True
        
        # Generate exits (hold for 3-6 intervals = 45-90 minutes)
        for entry_idx in filtered_entries:
            entry_pos = signals.index.get_loc(entry_idx)
            
            # Exit after 4-6 intervals (1-1.5 hours)
            exit_pos = min(entry_pos + np.random.randint(4, 7), len(signals) - 1)
            exit_idx = signals.index[exit_pos]
            
            signals.loc[exit_idx, 'long_exit'] = True
        
        entry_count = signals['long_entry'].sum()
        exit_count = signals['long_exit'].sum()
        
        print(f"✅ Generated {entry_count} entry signals")
        print(f"✅ Generated {exit_count} exit signals")
        
        # Signal breakdown
        signal_breakdown = signals[signals['long_entry']]['signal_type'].value_counts()
        print("📊 Signal breakdown:")
        for strategy, count in signal_breakdown.items():
            print(f"   {strategy}: {count} signals")
        
        return signals
    
    def backtest_intraday_strategy(self, data, signals):
        """Backtest the intraday strategy"""
        print("📈 Backtesting intraday strategy...")
        
        initial_capital = 100000  # ₹1 Lakh
        position_size = 0.0
        cash = initial_capital
        total_value = initial_capital
        
        portfolio = []
        trades = []
        
        for idx, row in data.iterrows():
            current_price = row['close']
            
            # Check for entry signal
            if signals.loc[idx, 'long_entry'] and position_size == 0:
                # Buy with 90% of available cash (more conservative)
                position_value = cash * 0.9
                position_size = position_value / current_price
                cash -= position_value
                
                trades.append({
                    'timestamp': idx,
                    'action': 'BUY',
                    'price': current_price,
                    'quantity': position_size,
                    'signal_type': signals.loc[idx, 'signal_type']
                })
            
            # Check for exit signal
            elif signals.loc[idx, 'long_exit'] and position_size > 0:
                # Sell position
                sell_value = position_size * current_price
                cash += sell_value
                
                # Calculate return
                last_buy = [t for t in trades if t['action'] == 'BUY'][-1]
                return_pct = ((current_price - last_buy['price']) / last_buy['price']) * 100
                
                trades.append({
                    'timestamp': idx,
                    'action': 'SELL',
                    'price': current_price,
                    'quantity': position_size,
                    'return_pct': return_pct,
                    'signal_type': last_buy['signal_type']
                })
                
                position_size = 0
            
            # Calculate total portfolio value
            total_value = cash + (position_size * current_price)
            
            portfolio.append({
                'timestamp': idx,
                'cash': cash,
                'position_value': position_size * current_price,
                'total_value': total_value
            })
        
        # Convert to DataFrames
        portfolio_df = pd.DataFrame(portfolio)
        portfolio_df.set_index('timestamp', inplace=True)
        
        trades_df = pd.DataFrame(trades)
        if not trades_df.empty:
            trades_df.set_index('timestamp', inplace=True)
        
        # Calculate performance metrics
        total_return = ((total_value - initial_capital) / initial_capital) * 100
        
        sell_trades = trades_df[trades_df['action'] == 'SELL'] if not trades_df.empty else pd.DataFrame()
        
        if not sell_trades.empty:
            win_rate = (sell_trades['return_pct'] > 0).sum() / len(sell_trades) * 100
            avg_return = sell_trades['return_pct'].mean()
            best_trade = sell_trades['return_pct'].max()
            worst_trade = sell_trades['return_pct'].min()
            num_trades = len(sell_trades)
        else:
            win_rate = avg_return = best_trade = worst_trade = num_trades = 0
        
        print(f"✅ Improved Intraday Backtest Results:")
        print(f"   Total Return: {total_return:+.2f}%")
        print(f"   Number of Trades: {num_trades}")
        print(f"   Win Rate: {win_rate:.1f}%")
        print(f"   Average Return per Trade: {avg_return:+.2f}%")
        if num_trades > 0:
            print(f"   Best Trade: {best_trade:+.2f}%")
            print(f"   Worst Trade: {worst_trade:+.2f}%")
        
        return portfolio_df, trades_df
    
    def create_echarts_dashboard(self, save_path='tatamotors_15min_echarts.html'):
        """Create beautiful ECharts dashboard for 15-minute analysis"""
        print("🚀 Creating beautiful 15-minute ECharts dashboard...")
        
        # Load and prepare data
        daily_data = self.load_csv_data()
        if daily_data is None:
            return None
        
        # Create 15-minute data
        self.data = self.create_15min_data(daily_data)
        self.data = self.add_technical_indicators(self.data)
        
        # Generate signals and backtest
        self.signals = self.generate_improved_intraday_signals(self.data)
        self.portfolio, self.trades = self.backtest_intraday_strategy(self.data, self.signals)
        
        # Prepare chart data (use last 500 intervals for better performance)
        chart_data = self.data.tail(500).copy()
        chart_signals = self.signals.tail(500).copy()
        chart_portfolio = self.portfolio.tail(500).copy()
        
        # Prepare data for ECharts
        dates = [idx.strftime('%Y-%m-%d %H:%M') for idx in chart_data.index]
        candlestick_data = [[float(row['open']), float(row['close']), 
                            float(row['low']), float(row['high'])] 
                           for _, row in chart_data.iterrows()]
        
        volume_data = [{'value': float(row['volume']), 
                       'itemStyle': {'color': '#26a69a' if row['close'] >= row['open'] else '#ef5350'}}
                      for _, row in chart_data.iterrows()]
        
        # Technical indicators
        indicators = {
            'sma_5': [float(x) if not pd.isna(x) else None for x in chart_data['sma_5']],
            'sma_10': [float(x) if not pd.isna(x) else None for x in chart_data['sma_10']],
            'ema_8': [float(x) if not pd.isna(x) else None for x in chart_data['ema_8']],
            'ema_21': [float(x) if not pd.isna(x) else None for x in chart_data['ema_21']],
            'rsi': [float(x) if not pd.isna(x) else None for x in chart_data['rsi']],
            'bb_upper': [float(x) if not pd.isna(x) else None for x in chart_data['bb_upper']],
            'bb_lower': [float(x) if not pd.isna(x) else None for x in chart_data['bb_lower']]
        }
        
        # Portfolio data
        portfolio_values = [float(x) for x in chart_portfolio['total_value']]
        
        # Performance metrics
        total_return = ((self.portfolio['total_value'].iloc[-1] - 100000) / 100000) * 100
        num_trades = len(self.trades[self.trades['action'] == 'SELL']) if not self.trades.empty else 0
        
        sell_trades = self.trades[self.trades['action'] == 'SELL'] if not self.trades.empty else pd.DataFrame()
        win_rate = (sell_trades['return_pct'] > 0).sum() / len(sell_trades) * 100 if not sell_trades.empty else 0
        
        # Generate HTML
        html_content = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>TATAMOTORS 15-Min ECharts Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {{
            margin: 0;
            padding: 20px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
        }}
        
        .dashboard-header {{
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }}
        
        .dashboard-title {{
            font-size: 2.5em;
            font-weight: bold;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }}
        
        .performance-summary {{
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }}
        
        .metric-card {{
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 20px;
            text-align: center;
            color: white;
            min-width: 150px;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }}
        
        .metric-value {{
            font-size: 1.8em;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        
        .metric-label {{
            font-size: 0.9em;
            opacity: 0.8;
        }}
        
        .chart-container {{
            background: rgba(255, 255, 255, 0.95);
            border-radius: 15px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }}
        
        .chart-title {{
            background: linear-gradient(45deg, #1e3c72, #2a5298);
            color: white;
            padding: 15px 20px;
            font-size: 1.2em;
            font-weight: bold;
        }}
        
        .chart {{
            width: 100%;
            height: 500px;
        }}
        
        .chart-small {{
            height: 350px;
        }}
        
        .grid-container {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }}
        
        @media (max-width: 768px) {{
            .grid-container {{
                grid-template-columns: 1fr;
            }}
        }}
    </style>
</head>
<body>
    <div class="dashboard-header">
        <div class="dashboard-title">⚡ TATAMOTORS 15-Min Intraday Dashboard</div>
        <div style="font-size: 1.1em; opacity: 0.9;">Improved Intraday Strategy Analysis</div>
    </div>
    
    <div class="performance-summary">
        <div class="metric-card">
            <div class="metric-value" style="color: #4caf50;">{total_return:+.2f}%</div>
            <div class="metric-label">Total Return</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">{num_trades}</div>
            <div class="metric-label">Total Trades</div>
        </div>
        <div class="metric-card">
            <div class="metric-value" style="color: #2196f3;">{win_rate:.1f}%</div>
            <div class="metric-label">Win Rate</div>
        </div>
        <div class="metric-card">
            <div class="metric-value" style="color: #ff9800;">15Min</div>
            <div class="metric-label">Timeframe</div>
        </div>
    </div>
    
    <!-- Main Price Chart -->
    <div class="chart-container">
        <div class="chart-title">📈 15-Minute Price Action & Signals</div>
        <div id="priceChart" class="chart"></div>
    </div>
    
    <!-- Grid -->
    <div class="grid-container">
        <div class="chart-container">
            <div class="chart-title">📊 Technical Indicators</div>
            <div id="indicatorsChart" class="chart chart-small"></div>
        </div>
        <div class="chart-container">
            <div class="chart-title">💰 Portfolio Performance</div>
            <div id="portfolioChart" class="chart chart-small"></div>
        </div>
    </div>

    <script>
        // Initialize charts
        const priceChart = echarts.init(document.getElementById('priceChart'));
        const indicatorsChart = echarts.init(document.getElementById('indicatorsChart'));
        const portfolioChart = echarts.init(document.getElementById('portfolioChart'));
        
        // Data
        const dates = {json.dumps(dates)};
        const candlestickData = {json.dumps(candlestick_data)};
        const volumeData = {json.dumps(volume_data)};
        const indicators = {json.dumps(indicators)};
        const portfolioValues = {json.dumps(portfolio_values)};
        
        // Price Chart
        priceChart.setOption({{
            animation: true,
            grid: [{{ left: '5%', right: '5%', height: '60%' }}, {{ left: '5%', right: '5%', top: '75%', height: '15%' }}],
            xAxis: [{{ type: 'category', data: dates }}, {{ type: 'category', data: dates, gridIndex: 1 }}],
            yAxis: [{{ scale: true }}, {{ scale: true, gridIndex: 1 }}],
            dataZoom: [{{ type: 'inside', start: 80, end: 100 }}, {{ show: true, start: 80, end: 100 }}],
            tooltip: {{ trigger: 'axis' }},
            legend: {{ data: ['TATAMOTORS', 'EMA 8', 'EMA 21', 'Volume'] }},
            series: [
                {{
                    name: 'TATAMOTORS',
                    type: 'candlestick',
                    data: candlestickData,
                    itemStyle: {{
                        color: '#26a69a',
                        color0: '#ef5350',
                        borderColor: '#26a69a',
                        borderColor0: '#ef5350'
                    }}
                }},
                {{
                    name: 'EMA 8',
                    type: 'line',
                    data: indicators.ema_8,
                    lineStyle: {{ color: '#ff9800', width: 2 }},
                    showSymbol: false
                }},
                {{
                    name: 'EMA 21',
                    type: 'line',
                    data: indicators.ema_21,
                    lineStyle: {{ color: '#2196f3', width: 2 }},
                    showSymbol: false
                }},
                {{
                    name: 'Volume',
                    type: 'bar',
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    data: volumeData
                }}
            ]
        }});
        
        // Technical Indicators
        indicatorsChart.setOption({{
            animation: true,
            grid: {{ left: '5%', right: '5%', bottom: '10%', top: '15%' }},
            xAxis: {{ type: 'category', data: dates }},
            yAxis: {{ scale: true, min: 0, max: 100 }},
            tooltip: {{ trigger: 'axis' }},
            legend: {{ data: ['RSI'] }},
            series: [
                {{
                    name: 'RSI',
                    type: 'line',
                    data: indicators.rsi,
                    lineStyle: {{ color: '#9c27b0', width: 2 }},
                    showSymbol: false,
                    markLine: {{
                        data: [
                            {{ yAxis: 70, lineStyle: {{ color: '#f44336', type: 'dashed' }} }},
                            {{ yAxis: 30, lineStyle: {{ color: '#4caf50', type: 'dashed' }} }}
                        ]
                    }}
                }}
            ]
        }});
        
        // Portfolio Performance
        portfolioChart.setOption({{
            animation: true,
            grid: {{ left: '5%', right: '5%', bottom: '10%', top: '15%' }},
            xAxis: {{ type: 'category', data: dates, boundaryGap: false }},
            yAxis: {{ type: 'value', scale: true }},
            tooltip: {{ trigger: 'axis' }},
            series: [
                {{
                    name: 'Portfolio Value',
                    type: 'line',
                    data: portfolioValues,
                    lineStyle: {{ color: '#4caf50', width: 3 }},
                    areaStyle: {{ color: 'rgba(76, 175, 80, 0.2)' }},
                    showSymbol: false
                }}
            ]
        }});
        
        // Make responsive
        window.addEventListener('resize', () => {{
            priceChart.resize();
            indicatorsChart.resize();
            portfolioChart.resize();
        }});
    </script>
</body>
</html>'''
        
        # Save to file
        with open(save_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"✅ Beautiful 15-minute ECharts dashboard created: {save_path}")
        print(f"🌐 Open {save_path} in your browser!")
        
        return save_path

def main():
    """Create the 15-minute ECharts dashboard"""
    builder = TATAMOTORS15MinECharts()
    dashboard_path = builder.create_echarts_dashboard()
    
    print(f"\n🎉 15-MINUTE ECHARTS DASHBOARD COMPLETE!")
    print(f"📊 Features:")
    print(f"   ✅ 15-minute candlestick charts")
    print(f"   ✅ Improved intraday strategies")
    print(f"   ✅ Conservative position sizing")
    print(f"   ✅ Technical indicators optimized for intraday")
    print(f"   ✅ Beautiful ECharts visualization")

if __name__ == "__main__":
    main()
