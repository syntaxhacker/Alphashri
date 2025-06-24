#!/usr/bin/env python3
"""
🎯 TATAMOTORS Entry & Exit Chart
Shows actual entry/exit points with returns for each strategy
"""

import pandas as pd
import numpy as np
import json
from tatamotors_enhanced_daily import TATAMOTORSEnhancedDaily

def create_entry_exit_chart():
    print("🎨 Creating entry/exit chart with actual returns...")
    
    # Load data
    analyzer = TATAMOTORSEnhancedDaily()
    data = analyzer.load_data()
    filtered_data = analyzer.filter_data_by_period('2021-01-01', '2024-06-28')
    signals = analyzer.generate_multi_strategy_signals(filtered_data)
    enhanced_data = analyzer.enhanced_data
    
    # Find Golden Cross trades with exits
    golden_trades = []
    for i in range(1, len(enhanced_data)):
        current = enhanced_data.iloc[i]
        previous = enhanced_data.iloc[i-1]
        if (current['sma_10'] > current['sma_20'] and 
            previous['sma_10'] <= previous['sma_20'] and
            not pd.isna(current['sma_10']) and not pd.isna(current['sma_20'])):
            
            entry_date = current.name
            entry_price = current['close']
            
            # Find exit (10 days later)
            exit_idx = min(i + 10, len(enhanced_data) - 1)
            exit_data = enhanced_data.iloc[exit_idx]
            exit_date = exit_data.name
            exit_price = exit_data['close']
            
            return_pct = ((exit_price - entry_price) / entry_price) * 100
            
            golden_trades.append({
                'entry_date': entry_date.strftime('%Y-%m-%d'),
                'entry_price': entry_price,
                'exit_date': exit_date.strftime('%Y-%m-%d'),
                'exit_price': exit_price,
                'return_pct': return_pct,
                'strategy': 'Golden Cross'
            })
    
    # Find Momentum Breakout trades with exits
    momentum_trades = []
    for i in range(5, len(enhanced_data)):
        current = enhanced_data.iloc[i]
        recent_high = enhanced_data['high'].iloc[i-5:i].max()
        avg_volume = enhanced_data['volume'].iloc[i-20:i].mean()
        volume_spike = current['volume'] > (avg_volume * 1.5)
        rsi_strong = current['rsi'] > 60 if not pd.isna(current['rsi']) else False
        
        if (current['close'] > recent_high and volume_spike and rsi_strong):
            entry_date = current.name
            entry_price = current['close']
            
            # Find exit (5 days later)
            exit_idx = min(i + 5, len(enhanced_data) - 1)
            exit_data = enhanced_data.iloc[exit_idx]
            exit_date = exit_data.name
            exit_price = exit_data['close']
            
            return_pct = ((exit_price - entry_price) / entry_price) * 100
            
            momentum_trades.append({
                'entry_date': entry_date.strftime('%Y-%m-%d'),
                'entry_price': entry_price,
                'exit_date': exit_date.strftime('%Y-%m-%d'),
                'exit_price': exit_price,
                'return_pct': return_pct,
                'strategy': 'Momentum Breakout'
            })
    
    # Prepare chart data
    dates = [idx.strftime('%Y-%m-%d') for idx in enhanced_data.index]
    candlestick_data = [[float(row['open']), float(row['close']), 
                        float(row['low']), float(row['high'])] 
                       for _, row in enhanced_data.iterrows()]
    
    sma_10 = [float(x) if not pd.isna(x) else None for x in enhanced_data['sma_10']]
    sma_20 = [float(x) if not pd.isna(x) else None for x in enhanced_data['sma_20']]
    
    # Create entry markers
    entry_markers = []
    
    # Golden Cross entries (Buy signals)
    for trade in golden_trades:
        color = '#00FF00' if trade['return_pct'] > 0 else '#FF6B6B'
        entry_markers.append({
            'name': f"GC Entry\\n{trade['entry_date']}",
            'coord': [trade['entry_date'], trade['entry_price'] * 0.97],
            'value': f"Golden Cross BUY\\n₹{trade['entry_price']:.0f}\\nReturn: {trade['return_pct']:+.1f}%",
            'itemStyle': {'color': '#FFD700', 'borderColor': color, 'borderWidth': 3},
            'symbol': 'circle',
            'symbolSize': 15
        })
    
    # Momentum entries (Buy signals)
    for trade in momentum_trades:
        color = '#00FF00' if trade['return_pct'] > 0 else '#FF6B6B'
        entry_markers.append({
            'name': f"MB Entry\\n{trade['entry_date']}",
            'coord': [trade['entry_date'], trade['entry_price'] * 0.95],
            'value': f"Momentum BUY\\n₹{trade['entry_price']:.0f}\\nReturn: {trade['return_pct']:+.1f}%",
            'itemStyle': {'color': '#FF4500', 'borderColor': color, 'borderWidth': 3},
            'symbol': 'triangle',
            'symbolSize': 12
        })
    
    # Create exit markers  
    exit_markers = []
    
    # Golden Cross exits
    for trade in golden_trades:
        color = '#00FF00' if trade['return_pct'] > 0 else '#FF0000'
        exit_markers.append({
            'name': f"GC Exit\\n{trade['exit_date']}",
            'coord': [trade['exit_date'], trade['exit_price'] * 1.03],
            'value': f"Golden Cross SELL\\n₹{trade['exit_price']:.0f}\\nReturn: {trade['return_pct']:+.1f}%",
            'itemStyle': {'color': color},
            'symbol': 'diamond',
            'symbolSize': 12
        })
    
    # Momentum exits
    for trade in momentum_trades:
        color = '#00FF00' if trade['return_pct'] > 0 else '#FF0000'
        exit_markers.append({
            'name': f"MB Exit\\n{trade['exit_date']}",
            'coord': [trade['exit_date'], trade['exit_price'] * 1.05],
            'value': f"Momentum SELL\\n₹{trade['exit_price']:.0f}\\nReturn: {trade['return_pct']:+.1f}%",
            'itemStyle': {'color': color},
            'symbol': 'rect',
            'symbolSize': 10
        })
    
    # Calculate performance stats
    golden_returns = [t['return_pct'] for t in golden_trades]
    momentum_returns = [t['return_pct'] for t in momentum_trades]
    
    golden_avg = np.mean(golden_returns) if golden_returns else 0
    golden_win_rate = (np.array(golden_returns) > 0).sum() / len(golden_returns) * 100 if golden_returns else 0
    golden_best = max(golden_returns) if golden_returns else 0
    golden_worst = min(golden_returns) if golden_returns else 0
    
    momentum_avg = np.mean(momentum_returns) if momentum_returns else 0
    momentum_win_rate = (np.array(momentum_returns) > 0).sum() / len(momentum_returns) * 100 if momentum_returns else 0
    momentum_best = max(momentum_returns) if momentum_returns else 0
    momentum_worst = min(momentum_returns) if momentum_returns else 0
    
    html_content = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>TATAMOTORS Entry/Exit Analysis</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {{
            margin: 0;
            padding: 20px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%);
            color: white;
        }}
        
        .header {{
            text-align: center;
            margin-bottom: 30px;
        }}
        
        .title {{
            font-size: 3em;
            font-weight: bold;
            margin-bottom: 15px;
            background: linear-gradient(45deg, #FFD700, #FF4500, #00FF00, #FF0000);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 30px rgba(255, 215, 0, 0.5);
        }}
        
        .subtitle {{
            font-size: 1.3em;
            opacity: 0.9;
            margin-bottom: 20px;
        }}
        
        .performance-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 25px;
            margin-bottom: 30px;
            max-width: 1200px;
            margin-left: auto;
            margin-right: auto;
        }}
        
        .perf-card {{
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(15px);
            border-radius: 20px;
            padding: 25px;
            border: 2px solid;
            position: relative;
            overflow: hidden;
        }}
        
        .golden-perf {{
            border-color: #FFD700;
            box-shadow: 0 0 30px rgba(255, 215, 0, 0.3);
        }}
        
        .momentum-perf {{
            border-color: #FF4500;
            box-shadow: 0 0 30px rgba(255, 69, 0, 0.3);
        }}
        
        .perf-title {{
            font-size: 1.5em;
            font-weight: bold;
            margin-bottom: 20px;
            text-align: center;
        }}
        
        .perf-metrics {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }}
        
        .metric {{
            text-align: center;
            padding: 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
        }}
        
        .metric-value {{
            font-size: 1.4em;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        
        .metric-label {{
            font-size: 0.9em;
            opacity: 0.8;
        }}
        
        .chart-container {{
            background: rgba(255, 255, 255, 0.95);
            border-radius: 25px;
            box-shadow: 0 15px 50px rgba(0, 0, 0, 0.4);
            overflow: hidden;
            margin-top: 20px;
        }}
        
        .chart-header {{
            background: linear-gradient(45deg, #0c0c0c, #1a1a2e);
            color: white;
            padding: 25px;
            text-align: center;
        }}
        
        .chart-title {{
            font-size: 1.8em;
            font-weight: bold;
            margin-bottom: 10px;
        }}
        
        .chart {{
            width: 100%;
            height: 700px;
        }}
        
        .legend-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }}
        
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: bold;
            background: rgba(255, 255, 255, 0.1);
            padding: 8px 15px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
            font-size: 0.9em;
        }}
        
        .legend-symbol {{
            width: 16px;
            height: 16px;
            border-radius: 50%;
        }}
        
        .trades-summary {{
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 20px;
            margin: 20px 0;
            text-align: center;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="title">🎯 TATAMOTORS Entry/Exit Analysis</div>
        <div class="subtitle">Complete Trade Analysis with Returns (2021-2024)</div>
    </div>
    
    <div class="performance-grid">
        <div class="perf-card golden-perf">
            <div class="perf-title">💎 Golden Cross Performance</div>
            <div class="perf-metrics">
                <div class="metric">
                    <div class="metric-value" style="color: #FFD700;">{golden_avg:+.1f}%</div>
                    <div class="metric-label">Avg Return</div>
                </div>
                <div class="metric">
                    <div class="metric-value">{golden_win_rate:.0f}%</div>
                    <div class="metric-label">Win Rate</div>
                </div>
                <div class="metric">
                    <div class="metric-value" style="color: #00FF00;">{golden_best:+.1f}%</div>
                    <div class="metric-label">Best Trade</div>
                </div>
                <div class="metric">
                    <div class="metric-value" style="color: #FF6B6B;">{golden_worst:+.1f}%</div>
                    <div class="metric-label">Worst Trade</div>
                </div>
            </div>
        </div>
        
        <div class="perf-card momentum-perf">
            <div class="perf-title">🚀 Momentum Breakout Performance</div>
            <div class="perf-metrics">
                <div class="metric">
                    <div class="metric-value" style="color: #FF4500;">{momentum_avg:+.1f}%</div>
                    <div class="metric-label">Avg Return</div>
                </div>
                <div class="metric">
                    <div class="metric-value">{momentum_win_rate:.0f}%</div>
                    <div class="metric-label">Win Rate</div>
                </div>
                <div class="metric">
                    <div class="metric-value" style="color: #00FF00;">{momentum_best:+.1f}%</div>
                    <div class="metric-label">Best Trade</div>
                </div>
                <div class="metric">
                    <div class="metric-value" style="color: #FF6B6B;">{momentum_worst:+.1f}%</div>
                    <div class="metric-label">Worst Trade</div>
                </div>
            </div>
        </div>
    </div>
    
    <div class="trades-summary">
        <h3>📊 Trade Summary</h3>
        <p><strong>Golden Cross:</strong> {len(golden_trades)} trades | <strong>Momentum Breakout:</strong> {len(momentum_trades)} trades</p>
        <p><strong>Total Trades:</strong> {len(golden_trades) + len(momentum_trades)} | <strong>Overall Success Rate:</strong> {((len([t for t in golden_trades if t['return_pct'] > 0]) + len([t for t in momentum_trades if t['return_pct'] > 0])) / (len(golden_trades) + len(momentum_trades)) * 100):.0f}%</p>
    </div>
    
    <div class="legend-grid">
        <div class="legend-item">
            <div class="legend-symbol" style="background: #FFD700; border: 3px solid #00FF00;"></div>
            <span>Golden Cross Entry (Profitable)</span>
        </div>
        <div class="legend-item">
            <div class="legend-symbol" style="background: #FFD700; border: 3px solid #FF6B6B;"></div>
            <span>Golden Cross Entry (Loss)</span>
        </div>
        <div class="legend-item">
            <div class="legend-symbol" style="background: #FF4500; border: 3px solid #00FF00;"></div>
            <span>Momentum Entry (Profitable)</span>
        </div>
        <div class="legend-item">
            <div class="legend-symbol" style="background: #FF4500; border: 3px solid #FF6B6B;"></div>
            <span>Momentum Entry (Loss)</span>
        </div>
        <div class="legend-item">
            <div class="legend-symbol" style="background: #00FF00;"></div>
            <span>Profitable Exit</span>
        </div>
        <div class="legend-item">
            <div class="legend-symbol" style="background: #FF0000;"></div>
            <span>Loss Exit</span>
        </div>
    </div>
    
    <div class="chart-container">
        <div class="chart-header">
            <div class="chart-title">📈 Complete Entry/Exit Analysis</div>
            <div style="opacity: 0.9;">Hover over markers to see trade details and returns</div>
        </div>
        <div id="entryExitChart" class="chart"></div>
    </div>

    <script>
        const chart = echarts.init(document.getElementById('entryExitChart'));
        
        const option = {{
            animation: true,
            animationDuration: 1500,
            grid: {{ left: '4%', right: '4%', bottom: '15%', top: '5%' }},
            xAxis: {{
                type: 'category',
                data: {json.dumps(dates)},
                axisLabel: {{ 
                    color: '#666',
                    rotate: 45,
                    fontSize: 10
                }}
            }},
            yAxis: {{
                scale: true,
                axisLabel: {{ 
                    color: '#666',
                    formatter: '₹{{value}}'
                }},
                splitLine: {{
                    lineStyle: {{ color: '#eee', type: 'dashed' }}
                }}
            }},
            dataZoom: [
                {{ type: 'inside', start: 0, end: 100 }},
                {{ 
                    show: true, 
                    start: 0, 
                    end: 100, 
                    bottom: '5%',
                    height: 20
                }}
            ],
            tooltip: {{
                trigger: 'axis',
                backgroundColor: 'rgba(30, 30, 30, 0.95)',
                borderColor: '#555',
                borderWidth: 2,
                textStyle: {{ color: '#fff', fontSize: 12 }},
                formatter: function(params) {{
                    let result = '<b style="color: #FFD700;">' + params[0].name + '</b><br/>';
                    params.forEach(function(item) {{
                        if (item.seriesName === 'TATAMOTORS') {{
                            result += '📊 OHLC: ₹' + item.value.map(v => v.toFixed(0)).join(' / ') + '<br/>';
                        }} else if (item.value !== null) {{
                            result += item.marker + item.seriesName + ': ₹' + item.value.toFixed(0) + '<br/>';
                        }}
                    }});
                    return result;
                }}
            }},
            series: [
                {{
                    name: 'TATAMOTORS',
                    type: 'candlestick',
                    data: {json.dumps(candlestick_data)},
                    itemStyle: {{
                        color: '#26a69a',
                        color0: '#ef5350',
                        borderColor: '#26a69a',
                        borderColor0: '#ef5350'
                    }},
                    markPoint: {{
                        data: {json.dumps(entry_markers + exit_markers)},
                        symbolOffset: [0, 0],
                        label: {{
                            show: true,
                            position: 'top',
                            fontSize: 9,
                            fontWeight: 'bold',
                            backgroundColor: 'rgba(0,0,0,0.7)',
                            borderRadius: 3,
                            padding: 3
                        }}
                    }}
                }},
                {{
                    name: 'SMA 10',
                    type: 'line',
                    data: {json.dumps(sma_10)},
                    lineStyle: {{ color: '#2196f3', width: 2 }},
                    showSymbol: false,
                    smooth: true
                }},
                {{
                    name: 'SMA 20',
                    type: 'line',
                    data: {json.dumps(sma_20)},
                    lineStyle: {{ color: '#ff9800', width: 2 }},
                    showSymbol: false,
                    smooth: true
                }}
            ]
        }};
        
        chart.setOption(option);
        
        // Make responsive
        window.addEventListener('resize', () => {{
            chart.resize();
        }});
        
        // Enhanced click handler
        chart.on('click', function(params) {{
            if (params.componentType === 'markPoint') {{
                console.log('Trade clicked:', params.name, params.value);
            }}
        }});
    </script>
</body>
</html>'''
    
    # Save file
    with open('tatamotors_entry_exit_analysis.html', 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"✅ Entry/Exit analysis chart created!")
    print(f"🌐 Open tatamotors_entry_exit_analysis.html in your browser")
    
    print(f"\n📊 DETAILED TRADE ANALYSIS:")
    print(f"{'='*60}")
    
    print(f"\n💎 GOLDEN CROSS TRADES ({len(golden_trades)} total):")
    print(f"   Average Return: {golden_avg:+.1f}%")
    print(f"   Win Rate: {golden_win_rate:.0f}%")
    print(f"   Best Trade: {golden_best:+.1f}%")
    print(f"   Worst Trade: {golden_worst:+.1f}%")
    
    print(f"\n🚀 MOMENTUM BREAKOUT TRADES ({len(momentum_trades)} total):")
    print(f"   Average Return: {momentum_avg:+.1f}%")
    print(f"   Win Rate: {momentum_win_rate:.0f}%")
    print(f"   Best Trade: {momentum_best:+.1f}%")
    print(f"   Worst Trade: {momentum_worst:+.1f}%")
    
    # Show top 5 trades from each strategy
    print(f"\n🏆 TOP 5 GOLDEN CROSS TRADES:")
    golden_sorted = sorted(golden_trades, key=lambda x: x['return_pct'], reverse=True)
    for i, trade in enumerate(golden_sorted[:5], 1):
        print(f"   {i}. {trade['entry_date']} → {trade['exit_date']}: ₹{trade['entry_price']:.0f} → ₹{trade['exit_price']:.0f} ({trade['return_pct']:+.1f}%)")
    
    print(f"\n🏆 TOP 5 MOMENTUM BREAKOUT TRADES:")
    momentum_sorted = sorted(momentum_trades, key=lambda x: x['return_pct'], reverse=True)
    for i, trade in enumerate(momentum_sorted[:5], 1):
        print(f"   {i}. {trade['entry_date']} → {trade['exit_date']}: ₹{trade['entry_price']:.0f} → ₹{trade['exit_price']:.0f} ({trade['return_pct']:+.1f}%)")

if __name__ == "__main__":
    create_entry_exit_chart()
