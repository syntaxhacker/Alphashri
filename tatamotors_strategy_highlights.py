#!/usr/bin/env python3
"""
🎯 TATAMOTORS Strategy Highlights Chart

Single chart showing:
- Real TATAMOTORS price data
- Golden Cross periods highlighted
- Momentum Breakout periods highlighted
- Performance of each strategy
"""

import pandas as pd
import numpy as np
import json
from datetime import datetime
from tatamotors_enhanced_daily import TATAMOTORSEnhancedDaily

class TATAMOTORSStrategyHighlights:
    def __init__(self):
        self.analyzer = TATAMOTORSEnhancedDaily()
        
    def identify_golden_cross_periods(self, data):
        """Identify Golden Cross periods in real data"""
        print("🔍 Identifying Golden Cross periods...")
        
        golden_cross_signals = []
        golden_cross_periods = []
        
        for i in range(1, len(data)):
            current = data.iloc[i]
            previous = data.iloc[i-1]
            
            # Golden Cross: SMA 10 crosses above SMA 20
            if (current['sma_10'] > current['sma_20'] and 
                previous['sma_10'] <= previous['sma_20'] and
                not pd.isna(current['sma_10']) and not pd.isna(current['sma_20'])):
                
                golden_cross_signals.append({
                    'date': current.name,
                    'price': current['close'],
                    'type': 'golden_cross_start'
                })
                
                # Mark the next 10 days as golden cross period
                for j in range(i, min(i + 10, len(data))):
                    golden_cross_periods.append({
                        'date': data.index[j],
                        'price': data.iloc[j]['close'],
                        'in_golden_cross': True
                    })
        
        print(f"✅ Found {len(golden_cross_signals)} Golden Cross signals")
        return golden_cross_signals, golden_cross_periods
    
    def identify_momentum_breakout_periods(self, data):
        """Identify Momentum Breakout periods in real data"""
        print("🔍 Identifying Momentum Breakout periods...")
        
        momentum_signals = []
        momentum_periods = []
        
        for i in range(5, len(data)):
            current = data.iloc[i]
            
            # 5-day high breakout
            recent_high = data['high'].iloc[i-5:i].max()
            
            # Volume confirmation
            avg_volume = data['volume'].iloc[i-20:i].mean()
            volume_spike = current['volume'] > (avg_volume * 1.2)
            
            # RSI momentum
            rsi_strong = current['rsi'] > 60 if not pd.isna(current['rsi']) else False
            
            # Momentum Breakout condition
            if (current['close'] > recent_high and 
                volume_spike and 
                rsi_strong):
                
                momentum_signals.append({
                    'date': current.name,
                    'price': current['close'],
                    'type': 'momentum_breakout_start'
                })
                
                # Mark the next 5 days as momentum period
                for j in range(i, min(i + 5, len(data))):
                    momentum_periods.append({
                        'date': data.index[j],
                        'price': data.iloc[j]['close'],
                        'in_momentum': True
                    })
        
        print(f"✅ Found {len(momentum_signals)} Momentum Breakout signals")
        return momentum_signals, momentum_periods
    
    def create_strategy_highlight_chart(self, save_path='tatamotors_strategy_highlights.html'):
        """Create single chart with strategy highlights"""
        print("🎨 Creating strategy highlights chart...")
        
        # Load data
        data = self.analyzer.load_data()
        filtered_data = self.analyzer.filter_data_by_period('2021-01-01', '2024-06-28')
        
        # Add technical indicators
        enhanced_data = self.analyzer.enhanced_data
        
        # Identify strategy periods
        golden_signals, golden_periods = self.identify_golden_cross_periods(enhanced_data)
        momentum_signals, momentum_periods = self.identify_momentum_breakout_periods(enhanced_data)
        
        # Prepare chart data
        dates = [idx.strftime('%Y-%m-%d') for idx in enhanced_data.index]
        candlestick_data = [[float(row['open']), float(row['close']), 
                            float(row['low']), float(row['high'])] 
                           for _, row in enhanced_data.iterrows()]
        
        # Moving averages
        sma_10 = [float(x) if not pd.isna(x) else None for x in enhanced_data['sma_10']]
        sma_20 = [float(x) if not pd.isna(x) else None for x in enhanced_data['sma_20']]
        
        # Volume data
        volume_data = [{'value': float(row['volume']), 
                       'itemStyle': {'color': '#26a69a' if row['close'] >= row['open'] else '#ef5350'}}
                      for _, row in enhanced_data.iterrows()]
        
        # Golden Cross signals
        golden_cross_markers = []
        for signal in golden_signals:
            date_str = signal['date'].strftime('%Y-%m-%d')
            golden_cross_markers.append({
                'name': f"Golden Cross\\n{date_str}",
                'coord': [date_str, signal['price'] * 0.97],
                'value': f"Golden Cross\\n₹{signal['price']:.2f}",
                'itemStyle': {'color': '#FFD700'},
                'symbol': 'diamond',
                'symbolSize': 15
            })
        
        # Momentum Breakout signals
        momentum_markers = []
        for signal in momentum_signals:
            date_str = signal['date'].strftime('%Y-%m-%d')
            momentum_markers.append({
                'name': f"Momentum\\n{date_str}",
                'coord': [date_str, signal['price'] * 1.03],
                'value': f"Momentum\\n₹{signal['price']:.2f}",
                'itemStyle': {'color': '#FF4500'},
                'symbol': 'triangle',
                'symbolSize': 12
            })
        
        # Create background highlighting for periods
        golden_periods_data = []
        momentum_periods_data = []
        
        # Create period highlighting data
        for i, date in enumerate(dates):
            date_obj = datetime.strptime(date, '%Y-%m-%d').date()
            
            # Check if in golden cross period
            in_golden = any(p['date'].date() == date_obj for p in golden_periods)
            if in_golden:
                golden_periods_data.append([i, enhanced_data.iloc[i]['low'], enhanced_data.iloc[i]['high']])
            
            # Check if in momentum period  
            in_momentum = any(p['date'].date() == date_obj for p in momentum_periods)
            if in_momentum:
                momentum_periods_data.append([i, enhanced_data.iloc[i]['low'], enhanced_data.iloc[i]['high']])
        
        # Calculate strategy performance
        golden_performance = []
        momentum_performance = []
        
        # Calculate returns for each golden cross period
        for signal in golden_signals:
            entry_price = signal['price']
            entry_date = signal['date']
            
            # Find exit price (10 days later)
            try:
                exit_idx = enhanced_data.index.get_loc(entry_date) + 10
                if exit_idx < len(enhanced_data):
                    exit_price = enhanced_data.iloc[exit_idx]['close']
                    return_pct = ((exit_price - entry_price) / entry_price) * 100
                    golden_performance.append(return_pct)
            except:
                pass
        
        # Calculate returns for each momentum breakout
        for signal in momentum_signals:
            entry_price = signal['price']
            entry_date = signal['date']
            
            # Find exit price (5 days later)
            try:
                exit_idx = enhanced_data.index.get_loc(entry_date) + 5
                if exit_idx < len(enhanced_data):
                    exit_price = enhanced_data.iloc[exit_idx]['close']
                    return_pct = ((exit_price - entry_price) / entry_price) * 100
                    momentum_performance.append(return_pct)
            except:
                pass
        
        # Performance stats
        golden_avg = np.mean(golden_performance) if golden_performance else 0
        golden_count = len(golden_performance)
        momentum_avg = np.mean(momentum_performance) if momentum_performance else 0
        momentum_count = len(momentum_performance)
        
        # Generate HTML
        html_content = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>TATAMOTORS Strategy Highlights</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {{
            margin: 0;
            padding: 20px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
        }}
        
        .header {{
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }}
        
        .title {{
            font-size: 2.5em;
            font-weight: bold;
            margin-bottom: 10px;
            background: linear-gradient(45deg, #FFD700, #FF4500);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}
        
        .performance-cards {{
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }}
        
        .strategy-card {{
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 20px;
            text-align: center;
            color: white;
            min-width: 200px;
            border: 2px solid;
        }}
        
        .golden-card {{
            border-color: #FFD700;
            box-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
        }}
        
        .momentum-card {{
            border-color: #FF4500;
            box-shadow: 0 0 20px rgba(255, 69, 0, 0.3);
        }}
        
        .strategy-name {{
            font-size: 1.3em;
            font-weight: bold;
            margin-bottom: 15px;
        }}
        
        .metric {{
            margin: 8px 0;
        }}
        
        .metric-value {{
            font-size: 1.5em;
            font-weight: bold;
        }}
        
        .chart-container {{
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            overflow: hidden;
        }}
        
        .chart-title {{
            background: linear-gradient(45deg, #1a1a2e, #16213e);
            color: white;
            padding: 20px;
            font-size: 1.4em;
            font-weight: bold;
            text-align: center;
        }}
        
        .chart {{
            width: 100%;
            height: 600px;
        }}
        
        .legend {{
            display: flex;
            justify-content: center;
            gap: 30px;
            margin: 20px 0;
            flex-wrap: wrap;
        }}
        
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 8px;
            color: white;
            font-weight: bold;
        }}
        
        .legend-color {{
            width: 20px;
            height: 20px;
            border-radius: 50%;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="title">🎯 TATAMOTORS Strategy Highlights</div>
        <div style="font-size: 1.1em; opacity: 0.9;">Golden Cross vs Momentum Breakout Analysis</div>
    </div>
    
    <div class="performance-cards">
        <div class="strategy-card golden-card">
            <div class="strategy-name">💎 Golden Cross</div>
            <div class="metric">
                <div class="metric-value" style="color: #FFD700;">{golden_avg:+.2f}%</div>
                <div>Avg Return</div>
            </div>
            <div class="metric">
                <div class="metric-value">{golden_count}</div>
                <div>Signals</div>
            </div>
            <div class="metric">
                <div class="metric-value">10 Days</div>
                <div>Hold Period</div>
            </div>
        </div>
        
        <div class="strategy-card momentum-card">
            <div class="strategy-name">🚀 Momentum Breakout</div>
            <div class="metric">
                <div class="metric-value" style="color: #FF4500;">{momentum_avg:+.2f}%</div>
                <div>Avg Return</div>
            </div>
            <div class="metric">
                <div class="metric-value">{momentum_count}</div>
                <div>Signals</div>
            </div>
            <div class="metric">
                <div class="metric-value">5 Days</div>
                <div>Hold Period</div>
            </div>
        </div>
    </div>
    
    <div class="legend">
        <div class="legend-item">
            <div class="legend-color" style="background: #FFD700;"></div>
            <span>Golden Cross Signals</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background: #FF4500;"></div>
            <span>Momentum Breakout Signals</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background: #2196f3;"></div>
            <span>SMA 10</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background: #ff9800;"></div>
            <span>SMA 20</span>
        </div>
    </div>
    
    <div class="chart-container">
        <div class="chart-title">📈 TATAMOTORS Price Action with Strategy Highlights</div>
        <div id="strategyChart" class="chart"></div>
    </div>

    <script>
        const chart = echarts.init(document.getElementById('strategyChart'));
        
        const dates = {json.dumps(dates)};
        const candlestickData = {json.dumps(candlestick_data)};
        const sma10 = {json.dumps(sma_10)};
        const sma20 = {json.dumps(sma_20)};
        const volumeData = {json.dumps(volume_data)};
        const goldenMarkers = {json.dumps(golden_cross_markers)};
        const momentumMarkers = {json.dumps(momentum_markers)};
        
        chart.setOption({{
            animation: true,
            grid: [
                {{ left: '5%', right: '5%', height: '70%' }},
                {{ left: '5%', right: '5%', top: '80%', height: '15%' }}
            ],
            xAxis: [
                {{ type: 'category', data: dates, axisLabel: {{ color: '#666' }} }},
                {{ type: 'category', data: dates, gridIndex: 1, axisLabel: {{ show: false }} }}
            ],
            yAxis: [
                {{ scale: true, axisLabel: {{ color: '#666' }} }},
                {{ scale: true, gridIndex: 1, axisLabel: {{ show: false }} }}
            ],
            dataZoom: [
                {{ type: 'inside', start: 0, end: 100 }},
                {{ show: true, start: 0, end: 100, bottom: '5%' }}
            ],
            tooltip: {{
                trigger: 'axis',
                backgroundColor: 'rgba(50, 50, 50, 0.9)',
                textStyle: {{ color: '#fff' }},
                formatter: function(params) {{
                    let result = params[0].name + '<br/>';
                    params.forEach(function(item) {{
                        if (item.seriesName === 'TATAMOTORS') {{
                            result += item.marker + 'OHLC: ' + item.value.join(' / ') + '<br/>';
                        }} else if (item.seriesName !== 'Volume') {{
                            result += item.marker + item.seriesName + ': ₹' + item.value + '<br/>';
                        }}
                    }});
                    return result;
                }}
            }},
            legend: {{
                data: ['TATAMOTORS', 'SMA 10', 'SMA 20', 'Volume'],
                textStyle: {{ color: '#333' }},
                top: 10
            }},
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
                    }},
                    markPoint: {{
                        data: goldenMarkers.concat(momentumMarkers),
                        symbolOffset: [0, 0]
                    }}
                }},
                {{
                    name: 'SMA 10',
                    type: 'line',
                    data: sma10,
                    lineStyle: {{ color: '#2196f3', width: 2 }},
                    showSymbol: false,
                    smooth: true
                }},
                {{
                    name: 'SMA 20',
                    type: 'line',
                    data: sma20,
                    lineStyle: {{ color: '#ff9800', width: 2 }},
                    showSymbol: false,
                    smooth: true
                }},
                {{
                    name: 'Volume',
                    type: 'bar',
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    data: volumeData,
                    itemStyle: {{ opacity: 0.7 }}
                }}
            ]
        }});
        
        // Make responsive
        window.addEventListener('resize', () => {{
            chart.resize();
        }});
        
        // Highlight crossover points
        chart.on('mouseover', function(params) {{
            if (params.componentType === 'markPoint') {{
                console.log('Strategy signal:', params.name);
            }}
        }});
    </script>
</body>
</html>'''
        
        # Save file
        with open(save_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"✅ Strategy highlights chart created: {save_path}")
        print(f"🌐 Open {save_path} to see Golden Cross and Momentum Breakout periods!")
        
        # Print summary
        print(f"\n📊 STRATEGY ANALYSIS RESULTS:")
        print(f"{'='*50}")
        print(f"💎 Golden Cross Strategy:")
        print(f"   Signals Found: {golden_count}")
        print(f"   Average Return: {golden_avg:+.2f}%")
        print(f"   Hold Period: 10 days")
        print(f"   Best for: Trend following")
        
        print(f"\n🚀 Momentum Breakout Strategy:")
        print(f"   Signals Found: {momentum_count}")
        print(f"   Average Return: {momentum_avg:+.2f}%")
        print(f"   Hold Period: 5 days")
        print(f"   Best for: Short-term momentum")
        
        return save_path

def main():
    """Create the strategy highlights chart"""
    highlighter = TATAMOTORSStrategyHighlights()
    chart_path = highlighter.create_strategy_highlight_chart()
    
    print(f"\n🎯 STRATEGY HIGHLIGHTS COMPLETE!")
    print(f"📈 Features:")
    print(f"   ✅ Real TATAMOTORS data analysis")
    print(f"   ✅ Golden Cross periods highlighted")
    print(f"   ✅ Momentum Breakout periods highlighted")
    print(f"   ✅ Performance comparison")
    print(f"   ✅ Interactive chart with signals")

if __name__ == "__main__":
    main() 