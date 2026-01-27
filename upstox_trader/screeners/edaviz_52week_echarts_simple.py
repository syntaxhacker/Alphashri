#!/usr/bin/env python3
"""
52-Week High Strategy Visualization with ECharts - Simple Version
=============================================================
Generates interactive ECharts-based visualizations using existing data.
"""

import json
import pandas as pd
from datetime import datetime
from rich.console import Console

console = Console()

# Mock data based on the results from the original analyzer
mock_data = [
    {
        'ticker': 'EICHERMOT',
        'approaches': 249,
        'success_rate': 82.7,
        'avg_days_to_52w': 9.1,
        'best_factor': 'distance_pct',
        'best_factor_value': -0.14,
        'total_approaches': 719,
        'successful': 588,
        'failed': 131,
        'overall_success_rate': 81.78,
        'factor_correlations': {
            'distance_pct': -0.214,
            'trend_score': 0.161,
            'adx': 0.133,
            'momentum_5': 0.043,
            'vol_ratio': -0.014,
            'bb_width': -0.002
        }
    },
    {
        'ticker': 'BAJFINANCE',
        'approaches': 102,
        'success_rate': 75.5,
        'avg_days_to_52w': 5.0,
        'best_factor': 'bb_width',
        'best_factor_value': 0.25,
        'total_approaches': 719,
        'successful': 588,
        'failed': 131,
        'overall_success_rate': 81.78,
        'factor_correlations': {
            'distance_pct': -0.214,
            'trend_score': 0.161,
            'adx': 0.133,
            'momentum_5': 0.043,
            'vol_ratio': -0.014,
            'bb_width': -0.002
        }
    },
    {
        'ticker': 'HAVELLS',
        'approaches': 70,
        'success_rate': 74.3,
        'avg_days_to_52w': 6.1,
        'best_factor': 'trend_score',
        'best_factor_value': 0.34,
        'total_approaches': 719,
        'successful': 588,
        'failed': 131,
        'overall_success_rate': 81.78,
        'factor_correlations': {
            'distance_pct': -0.214,
            'trend_score': 0.161,
            'adx': 0.133,
            'momentum_5': 0.043,
            'vol_ratio': -0.014,
            'bb_width': -0.002
        }
    },
    {
        'ticker': 'TVSMOTOR',
        'approaches': 197,
        'success_rate': 91.4,
        'avg_days_to_52w': 6.7,
        'best_factor': 'trend_score',
        'best_factor_value': 0.19,
        'total_approaches': 719,
        'successful': 588,
        'failed': 131,
        'overall_success_rate': 81.78,
        'factor_correlations': {
            'distance_pct': -0.214,
            'trend_score': 0.161,
            'adx': 0.133,
            'momentum_5': 0.043,
            'vol_ratio': -0.014,
            'bb_width': -0.002
        }
    },
    {
        'ticker': 'LT',
        'approaches': 101,
        'success_rate': 72.3,
        'avg_days_to_52w': 8.6,
        'best_factor': 'adx',
        'best_factor_value': 0.27,
        'total_approaches': 719,
        'successful': 588,
        'failed': 131,
        'overall_success_rate': 81.78,
        'factor_correlations': {
            'distance_pct': -0.214,
            'trend_score': 0.161,
            'adx': 0.133,
            'momentum_5': 0.043,
            'vol_ratio': -0.014,
            'bb_width': -0.002
        }
    }
]

def generate_html_page(data):
    """Generate HTML page with ECharts visualizations"""

    # Prepare data for charts
    tickers = [item['ticker'] for item in data]
    success_rates = [item['success_rate'] for item in data]
    avg_days = [item['avg_days_to_52w'] for item in data]
    approaches = [item['approaches'] for item in data]

    # Factor correlations data
    factors = list(data[0]['factor_correlations'].keys())
    correlations = [data[0]['factor_correlations'][factor] for factor in factors]

    # Prepare win rate distribution data
    win_rate_ranges = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%']
    win_rate_counts = [0, 0, 0, 0, 0]

    for rate in success_rates:
        if rate < 20:
            win_rate_counts[0] += 1
        elif rate < 40:
            win_rate_counts[1] += 1
        elif rate < 60:
            win_rate_counts[2] += 1
        elif rate < 80:
            win_rate_counts[3] += 1
        else:
            win_rate_counts[4] += 1

    # P&L distribution (mock data for visualization)
    pnl_ranges = ['-10%', '-5%', '0%', '5%', '10%']
    pnl_distribution = [2, 3, 5, 8, 4]

    # Create HTML with ECharts
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>52-Week High Strategy - ECharts Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }}
        .container {{
            max-width: 1400px;
            margin: 0 auto;
        }}
        .header {{
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 10px;
        }}
        .dashboard {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
            gap: 20px;
        }}
        .chart-container {{
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        .chart-title {{
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            color: #333;
            text-align: center;
        }}
        #chart1, #chart2, #chart3, #chart4, #chart5 {{
            width: 100%;
            height: 400px;
        }}
        .summary {{
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        .summary-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
        }}
        .summary-item {{
            text-align: center;
        }}
        .summary-value {{
            font-size: 28px;
            font-weight: bold;
            color: #667eea;
        }}
        .summary-label {{
            color: #666;
            margin-top: 5px;
        }}
        .table-container {{
            overflow-x: auto;
            margin-top: 20px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        th {{
            background-color: #667eea;
            color: white;
        }}
        tr:nth-child(even) {{
            background-color: #f9f9f9;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>52-Week High Strategy Analysis</h1>
            <p>Interactive dashboard with ECharts visualizations</p>
        </div>

        <div class="summary">
            <h2>Overall Statistics</h2>
            <div class="summary-grid">
                <div class="summary-item">
                    <div class="summary-value">{data[0]['total_approaches']}</div>
                    <div class="summary-label">Total Approaches</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">{data[0]['successful']}</div>
                    <div class="summary-label">Successful</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">{data[0]['failed']}</div>
                    <div class="summary-label">Failed</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">{data[0]['overall_success_rate']:.1f}%</div>
                    <div class="summary-label">Success Rate</div>
                </div>
            </div>
        </div>

        <div class="dashboard">
            <div class="chart-container">
                <div class="chart-title">Success Rate by Stock</div>
                <div id="chart1"></div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Average Days to 52W High</div>
                <div id="chart2"></div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Approaches Count</div>
                <div id="chart3"></div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Win Rate Distribution</div>
                <div id="chart4"></div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Factor Correlations</div>
                <div id="chart5"></div>
            </div>
        </div>

        <div class="chart-container">
            <div class="chart-title">Detailed Results</div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Ticker</th>
                            <th>Approaches</th>
                            <th>Success Rate</th>
                            <th>Avg Days to 52W</th>
                            <th>Best Factor</th>
                            <th>Best Factor Value</th>
                        </tr>
                    </thead>
                    <tbody>
        """

    # Add table rows
    for item in data:
        html_content += f"""
                        <tr>
                            <td>{item['ticker']}</td>
                            <td>{item['approaches']}</td>
                            <td>{item['success_rate']:.1f}%</td>
                            <td>{item['avg_days_to_52w']}</td>
                            <td>{item['best_factor']}</td>
                            <td>{item['best_factor_value']:.2f}</td>
                        </tr>
        """

    # Continue with ECharts initialization
    html_content += """
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        // Initialize ECharts
        const chart1 = echarts.init(document.getElementById('chart1'));
        const chart2 = echarts.init(document.getElementById('chart2'));
        const chart3 = echarts.init(document.getElementById('chart3'));
        const chart4 = echarts.init(document.getElementById('chart4'));
        const chart5 = echarts.init(document.getElementById('chart5'));

        // Chart 1: Success Rate by Stock
        const option1 = {
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: """ + json.dumps(tickers) + """,
                axisLabel: { rotate: 45 }
            },
            yAxis: {
                type: 'value',
                name: 'Success Rate (%)',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: """ + json.dumps(success_rates) + """,
                type: 'bar',
                itemStyle: { color: '#667eea' }
            }]
        };

        // Chart 2: Average Days to 52W
        const option2 = {
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: """ + json.dumps(tickers) + """,
                axisLabel: { rotate: 45 }
            },
            yAxis: {
                type: 'value',
                name: 'Days',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: """ + json.dumps(avg_days) + """,
                type: 'bar',
                itemStyle: { color: '#764ba2' }
            }]
        };

        // Chart 3: Approaches Count
        const option3 = {
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: """ + json.dumps(tickers) + """,
                axisLabel: { rotate: 45 }
            },
            yAxis: {
                type: 'value',
                name: 'Number of Approaches',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: """ + json.dumps(approaches) + """,
                type: 'bar',
                itemStyle: { color: '#ff6b6b' }
            }]
        };

        // Chart 4: Win Rate Distribution
        const option4 = {
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: """ + json.dumps(win_rate_ranges) + """,
                axisLabel: { color: '#333' }
            },
            yAxis: {
                type: 'value',
                name: 'Number of Stocks',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: """ + json.dumps(win_rate_counts) + """,
                type: 'bar',
                itemStyle: {
                    color: function(params) {
                        const colors = ['#ff4444', '#ff8844', '#ffcc44', '#88cc44', '#44cc44'];
                        return colors[params.dataIndex];
                    }
                }
            }]
        };

        // Chart 5: Factor Correlations
        const option5 = {
            tooltip: {
                trigger: 'axis',
                formatter: function(params) {
                    return params[0].name + ': ' + params[0].value;
                }
            },
            xAxis: {
                type: 'category',
                data: """ + json.dumps(factors) + """,
                axisLabel: { color: '#333' }
            },
            yAxis: {
                type: 'value',
                name: 'Correlation',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: """ + json.dumps(correlations) + """,
                type: 'bar',
                itemStyle: {
                    color: function(params) {
                        return params.value >= 0 ? '#44cc44' : '#ff4444';
                    }
                }
            }]
        };

        // Set options
        chart1.setOption(option1);
        chart2.setOption(option2);
        chart3.setOption(option3);
        chart4.setOption(option4);
        chart5.setOption(option5);

        // Responsive
        window.addEventListener('resize', function() {
            chart1.resize();
            chart2.resize();
            chart3.resize();
            chart4.resize();
            chart5.resize();
        });

        console.log('ECharts dashboard loaded successfully!');
    </script>
</body>
</html>
"""

    return html_content

def main():
    console.print("Generating ECharts dashboard...")

    # Generate HTML
    html_content = generate_html_page(mock_data)

    # Save to file
    filename = "52week_echarts_analysis.html"
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(html_content)

    console.print(f"✅ ECharts dashboard saved to {filename}")
    console.print("📊 Open the file in your browser to view interactive visualizations")

if __name__ == "__main__":
    main()