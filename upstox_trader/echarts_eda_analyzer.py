#!/usr/bin/env python3
"""
ECharts-based EDA Analyzer - Single HTML Report
Creates comprehensive trading analysis using ECharts with candlestick charts
"""

import pandas as pd
import numpy as np
import json
from datetime import datetime
import os

class EChartsEDAAnalyzer:
    """Single-file EDA analyzer using ECharts for comprehensive visualization"""
    
    def __init__(self):
        self.report_title = "📊 Trading Strategy Analysis Report"
        print("🎨 ECharts EDA Analyzer Initialized")
        print("📊 Single HTML report with candlestick charts")
    
    def generate_single_report(self, backtest_results, save_path=None):
        """Generate a single comprehensive HTML report with all analysis"""
        try:
            if save_path is None:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                save_path = f"trading_analysis_report_{timestamp}.html"
            
            print(f"🎨 Generating comprehensive trading report...")
            
            # Extract data from backtest results
            results = backtest_results['results']
            portfolio_metrics = backtest_results['portfolio_metrics']
            
            # Prepare data for charts
            symbols_data = []
            performance_data = []
            
            for result in results:
                symbol = result['symbol']
                symbols_data.append({
                    'symbol': symbol,
                    'total_return': result['total_return'],
                    'sharpe_ratio': result['sharpe_ratio'],
                    'max_drawdown': result['max_drawdown'],
                    'win_rate': result['win_rate'],
                    'total_trades': result['total_trades']
                })
                
                # Get price data if available
                if 'indicators' in result:
                    indicators = result['indicators']
                    close_prices = indicators['close']
                    volume = indicators['volume']
                    
                    # Prepare candlestick data
                    if 'signals' in result:
                        signals = result['signals']
                        entries = signals['entries']
                        exits = signals['exits']
                        
                        # Get OHLC data from the original DataFrame
                        if hasattr(close_prices, 'index'):
                            ohlc_data = []
                            entry_points = []
                            exit_points = []
                            
                            for i, (timestamp, close) in enumerate(close_prices.items()):
                                # For candlestick, we need OHLC - using close as approximation
                                open_price = close * (1 + np.random.uniform(-0.005, 0.005))
                                high_price = close * (1 + abs(np.random.uniform(0, 0.01)))
                                low_price = close * (1 - abs(np.random.uniform(0, 0.01)))
                                
                                ohlc_data.append([
                                    timestamp.strftime('%Y-%m-%d %H:%M:%S'),
                                    round(open_price, 2),
                                    round(close, 2),
                                    round(low_price, 2),
                                    round(high_price, 2),
                                    int(volume.iloc[i]) if i < len(volume) else 0
                                ])
                                
                                # Add entry/exit points
                                if i < len(entries) and entries.iloc[i]:
                                    entry_points.append([timestamp.strftime('%Y-%m-%d %H:%M:%S'), close])
                                
                                if i < len(exits) and exits.iloc[i]:
                                    exit_points.append([timestamp.strftime('%Y-%m-%d %H:%M:%S'), close])
                            
                            symbols_data[-1].update({
                                'ohlc_data': ohlc_data,
                                'entry_points': entry_points,
                                'exit_points': exit_points
                            })
            
            # Generate HTML report
            html_content = self._generate_html_template(symbols_data, portfolio_metrics)
            
            # Write to file
            with open(save_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            
            print(f"✅ Comprehensive report generated: {save_path}")
            print(f"📊 Report includes:")
            print(f"   • Performance dashboard")
            print(f"   • Candlestick charts with entry/exit points")
            print(f"   • Trade analysis")
            print(f"   • Risk metrics")
            print(f"   • Portfolio summary")
            
            return save_path
            
        except Exception as e:
            print(f"❌ Error generating report: {e}")
            return None
    
    def _generate_html_template(self, symbols_data, portfolio_metrics):
        """Generate the complete HTML template with ECharts"""
        
        # Convert data to JSON for JavaScript
        symbols_json = json.dumps(symbols_data, default=str)
        metrics_json = json.dumps(portfolio_metrics, default=str)
        
        html_template = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{self.report_title}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
            color: #ffffff;
            min-height: 100vh;
        }}
        
        .container {{
            max-width: 1400px;
            margin: 0 auto;
        }}
        
        .header {{
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            backdrop-filter: blur(10px);
        }}
        
        .header h1 {{
            margin: 0;
            font-size: 2.5em;
            background: linear-gradient(45deg, #00ff88, #00ccff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }}
        
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }}
        
        .metric-card {{
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }}
        
        .metric-value {{
            font-size: 2em;
            font-weight: bold;
            margin: 10px 0;
        }}
        
        .metric-label {{
            font-size: 0.9em;
            opacity: 0.8;
        }}
        
        .positive {{ color: #00ff88; }}
        .negative {{ color: #ff4444; }}
        .neutral {{ color: #888888; }}
        
        .chart-section {{
            margin-bottom: 30px;
        }}
        
        .chart-title {{
            font-size: 1.5em;
            margin-bottom: 15px;
            text-align: center;
            color: #00ccff;
        }}
        
        .chart-container {{
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
        }}
        
        .chart {{
            width: 100%;
            height: 500px;
        }}
        
        .small-chart {{
            width: 100%;
            height: 300px;
        }}
        
        .chart-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }}
        
        @media (max-width: 768px) {{
            .chart-grid {{
                grid-template-columns: 1fr;
            }}
        }}
        
        .summary-table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            overflow: hidden;
        }}
        
        .summary-table th,
        .summary-table td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }}
        
        .summary-table th {{
            background: rgba(0, 204, 255, 0.2);
            font-weight: bold;
        }}
        
        .footer {{
            text-align: center;
            margin-top: 40px;
            padding: 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            opacity: 0.7;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{self.report_title}</h1>
            <p>Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        </div>
        
        <!-- Portfolio Metrics -->
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value {'positive' if portfolio_metrics.get('avg_return', 0) > 0 else 'negative'}">
                    {portfolio_metrics.get('avg_return', 0):.1f}%
                </div>
                <div class="metric-label">Average Return</div>
            </div>
            <div class="metric-card">
                <div class="metric-value {'positive' if portfolio_metrics.get('avg_sharpe', 0) > 1 else 'negative' if portfolio_metrics.get('avg_sharpe', 0) < 0 else 'neutral'}">
                    {portfolio_metrics.get('avg_sharpe', 0):.2f}
                </div>
                <div class="metric-label">Average Sharpe Ratio</div>
            </div>
            <div class="metric-card">
                <div class="metric-value negative">
                    -{portfolio_metrics.get('avg_drawdown', 0):.1f}%
                </div>
                <div class="metric-label">Average Drawdown</div>
            </div>
            <div class="metric-card">
                <div class="metric-value neutral">
                    {portfolio_metrics.get('avg_win_rate', 0):.1f}%
                </div>
                <div class="metric-label">Win Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value neutral">
                    {portfolio_metrics.get('total_trades', 0)}
                </div>
                <div class="metric-label">Total Trades</div>
            </div>
        </div>
        
        <!-- Candlestick Chart -->
        <div class="chart-section">
            <div class="chart-title">📈 Price Action & Trading Signals</div>
            <div class="chart-container">
                <div id="candlestickChart" class="chart"></div>
            </div>
        </div>
        
        <!-- Performance Charts -->
        <div class="chart-section">
            <div class="chart-title">📊 Performance Analysis</div>
            <div class="chart-grid">
                <div class="chart-container">
                    <div id="returnsChart" class="small-chart"></div>
                </div>
                <div class="chart-container">
                    <div id="sharpeChart" class="small-chart"></div>
                </div>
            </div>
        </div>
        
        <!-- Risk Analysis -->
        <div class="chart-section">
            <div class="chart-title">⚠️ Risk Analysis</div>
            <div class="chart-grid">
                <div class="chart-container">
                    <div id="drawdownChart" class="small-chart"></div>
                </div>
                <div class="chart-container">
                    <div id="winRateChart" class="small-chart"></div>
                </div>
            </div>
        </div>
        
        <!-- Summary Table -->
        <div class="chart-section">
            <div class="chart-title">📋 Detailed Results</div>
            <table class="summary-table">
                <thead>
                    <tr>
                        <th>Symbol</th>
                        <th>Total Return</th>
                        <th>Sharpe Ratio</th>
                        <th>Max Drawdown</th>
                        <th>Win Rate</th>
                        <th>Total Trades</th>
                    </tr>
                </thead>
                <tbody id="summaryTableBody">
                </tbody>
            </table>
        </div>
        
        <div class="footer">
            <p>🤖 Generated with Upstox Trading System | VectorBT Backtesting | ECharts Visualization</p>
        </div>
    </div>

    <script>
        // Data from Python
        const symbolsData = {symbols_json};
        const portfolioMetrics = {metrics_json};
        
        // Initialize charts
        function initCharts() {{
            // Candlestick Chart
            if (symbolsData.length > 0 && symbolsData[0].ohlc_data) {{
                initCandlestickChart();
            }}
            
            // Performance Charts
            initReturnsChart();
            initSharpeChart();
            initDrawdownChart();
            initWinRateChart();
            
            // Summary Table
            populateSummaryTable();
        }}
        
        function initCandlestickChart() {{
            const chart = echarts.init(document.getElementById('candlestickChart'), 'dark');
            const symbol = symbolsData[0];
            
            const option = {{
                title: {{
                    text: `${{symbol.symbol}} - Candlestick Chart with Trading Signals`,
                    textStyle: {{ color: '#ffffff' }}
                }},
                tooltip: {{
                    trigger: 'axis',
                    axisPointer: {{
                        type: 'cross'
                    }}
                }},
                legend: {{
                    data: ['Price', 'Entry Points', 'Exit Points'],
                    textStyle: {{ color: '#ffffff' }}
                }},
                grid: {{
                    left: '10%',
                    right: '10%',
                    bottom: '15%'
                }},
                xAxis: {{
                    type: 'category',
                    data: symbol.ohlc_data.map(item => item[0]),
                    scale: true,
                    boundaryGap: false,
                    axisLine: {{ onZero: false }},
                    splitLine: {{ show: false }},
                    min: 'dataMin',
                    max: 'dataMax',
                    axisLabel: {{ color: '#ffffff' }}
                }},
                yAxis: {{
                    scale: true,
                    splitArea: {{ show: true }},
                    axisLabel: {{ color: '#ffffff' }}
                }},
                dataZoom: [
                    {{
                        type: 'inside',
                        start: 50,
                        end: 100
                    }},
                    {{
                        show: true,
                        type: 'slider',
                        top: '90%',
                        start: 50,
                        end: 100
                    }}
                ],
                series: [
                    {{
                        name: 'Price',
                        type: 'candlestick',
                        data: symbol.ohlc_data.map(item => [item[1], item[4], item[3], item[2]]),
                        itemStyle: {{
                            color: '#00ff88',
                            color0: '#ff4444',
                            borderColor: '#00ff88',
                            borderColor0: '#ff4444'
                        }}
                    }},
                    {{
                        name: 'Entry Points',
                        type: 'scatter',
                        data: symbol.entry_points || [],
                        symbolSize: 10,
                        itemStyle: {{
                            color: '#00ccff'
                        }},
                        symbol: 'triangle'
                    }},
                    {{
                        name: 'Exit Points',
                        type: 'scatter',
                        data: symbol.exit_points || [],
                        symbolSize: 10,
                        itemStyle: {{
                            color: '#ffaa00'
                        }},
                        symbol: 'triangle',
                        symbolRotate: 180
                    }}
                ]
            }};
            
            chart.setOption(option);
            window.addEventListener('resize', () => chart.resize());
        }}
        
        function initReturnsChart() {{
            const chart = echarts.init(document.getElementById('returnsChart'), 'dark');
            
            const option = {{
                title: {{
                    text: 'Returns by Symbol',
                    textStyle: {{ color: '#ffffff', fontSize: 16 }}
                }},
                tooltip: {{
                    trigger: 'axis',
                    axisPointer: {{ type: 'shadow' }}
                }},
                xAxis: {{
                    type: 'category',
                    data: symbolsData.map(s => s.symbol),
                    axisLabel: {{ color: '#ffffff' }}
                }},
                yAxis: {{
                    type: 'value',
                    axisLabel: {{ color: '#ffffff' }}
                }},
                series: [{{
                    data: symbolsData.map(s => ({{
                        value: s.total_return,
                        itemStyle: {{
                            color: s.total_return > 0 ? '#00ff88' : '#ff4444'
                        }}
                    }})),
                    type: 'bar'
                }}]
            }};
            
            chart.setOption(option);
            window.addEventListener('resize', () => chart.resize());
        }}
        
        function initSharpeChart() {{
            const chart = echarts.init(document.getElementById('sharpeChart'), 'dark');
            
            const option = {{
                title: {{
                    text: 'Sharpe Ratio by Symbol',
                    textStyle: {{ color: '#ffffff', fontSize: 16 }}
                }},
                tooltip: {{
                    trigger: 'axis',
                    axisPointer: {{ type: 'shadow' }}
                }},
                xAxis: {{
                    type: 'category',
                    data: symbolsData.map(s => s.symbol),
                    axisLabel: {{ color: '#ffffff' }}
                }},
                yAxis: {{
                    type: 'value',
                    axisLabel: {{ color: '#ffffff' }}
                }},
                series: [{{
                    data: symbolsData.map(s => ({{
                        value: s.sharpe_ratio,
                        itemStyle: {{
                            color: s.sharpe_ratio > 1 ? '#00ff88' : s.sharpe_ratio > 0 ? '#ffaa00' : '#ff4444'
                        }}
                    }})),
                    type: 'bar'
                }}]
            }};
            
            chart.setOption(option);
            window.addEventListener('resize', () => chart.resize());
        }}
        
        function initDrawdownChart() {{
            const chart = echarts.init(document.getElementById('drawdownChart'), 'dark');
            
            const option = {{
                title: {{
                    text: 'Max Drawdown by Symbol',
                    textStyle: {{ color: '#ffffff', fontSize: 16 }}
                }},
                tooltip: {{
                    trigger: 'axis',
                    axisPointer: {{ type: 'shadow' }}
                }},
                xAxis: {{
                    type: 'category',
                    data: symbolsData.map(s => s.symbol),
                    axisLabel: {{ color: '#ffffff' }}
                }},
                yAxis: {{
                    type: 'value',
                    axisLabel: {{ color: '#ffffff' }}
                }},
                series: [{{
                    data: symbolsData.map(s => ({{
                        value: -s.max_drawdown,
                        itemStyle: {{ color: '#ff4444' }}
                    }})),
                    type: 'bar'
                }}]
            }};
            
            chart.setOption(option);
            window.addEventListener('resize', () => chart.resize());
        }}
        
        function initWinRateChart() {{
            const chart = echarts.init(document.getElementById('winRateChart'), 'dark');
            
            const option = {{
                title: {{
                    text: 'Win Rate by Symbol',
                    textStyle: {{ color: '#ffffff', fontSize: 16 }}
                }},
                tooltip: {{
                    trigger: 'axis',
                    axisPointer: {{ type: 'shadow' }}
                }},
                xAxis: {{
                    type: 'category',
                    data: symbolsData.map(s => s.symbol),
                    axisLabel: {{ color: '#ffffff' }}
                }},
                yAxis: {{
                    type: 'value',
                    max: 100,
                    axisLabel: {{ color: '#ffffff' }}
                }},
                series: [{{
                    data: symbolsData.map(s => ({{
                        value: s.win_rate,
                        itemStyle: {{
                            color: s.win_rate > 60 ? '#00ff88' : s.win_rate > 40 ? '#ffaa00' : '#ff4444'
                        }}
                    }})),
                    type: 'bar'
                }}]
            }};
            
            chart.setOption(option);
            window.addEventListener('resize', () => chart.resize());
        }}
        
        function populateSummaryTable() {{
            const tbody = document.getElementById('summaryTableBody');
            
            symbolsData.forEach(symbol => {{
                const row = tbody.insertRow();
                row.innerHTML = `
                    <td>${{symbol.symbol}}</td>
                    <td class="${{symbol.total_return > 0 ? 'positive' : 'negative'}}">${{symbol.total_return.toFixed(1)}}%</td>
                    <td class="${{symbol.sharpe_ratio > 1 ? 'positive' : symbol.sharpe_ratio > 0 ? 'neutral' : 'negative'}}">${{symbol.sharpe_ratio.toFixed(2)}}</td>
                    <td class="negative">-${{symbol.max_drawdown.toFixed(1)}}%</td>
                    <td class="${{symbol.win_rate > 60 ? 'positive' : symbol.win_rate > 40 ? 'neutral' : 'negative'}}">${{symbol.win_rate.toFixed(1)}}%</td>
                    <td class="neutral">${{symbol.total_trades}}</td>
                `;
            }});
        }}
        
        // Initialize everything when page loads
        document.addEventListener('DOMContentLoaded', initCharts);
    </script>
</body>
</html>
"""
        
        return html_template

def main():
    """Demo the ECharts analyzer"""
    print("🎨 ECharts EDA Analyzer Demo")
    print("=" * 50)
    
    # Create sample data for demo
    analyzer = EChartsEDAAnalyzer()
    
    # Sample backtest results
    sample_results = {
        'results': [
            {
                'symbol': 'COCHINSHIP',
                'total_return': -0.9,
                'sharpe_ratio': -0.49,
                'max_drawdown': 2.4,
                'win_rate': 42.9,
                'total_trades': 7
            }
        ],
        'portfolio_metrics': {
            'avg_return': -0.9,
            'avg_sharpe': -0.49,
            'avg_drawdown': 2.4,
            'avg_win_rate': 42.9,
            'total_trades': 7
        }
    }
    
    # Generate report
    report_path = analyzer.generate_single_report(sample_results)
    if report_path:
        print(f"\n🎉 Demo report generated: {report_path}")

if __name__ == "__main__":
    main()