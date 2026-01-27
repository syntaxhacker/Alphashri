#!/usr/bin/env python3
"""
52-Week High Strategy Visualization with ECharts - Including Trajectories
==========================================================================
Generates interactive ECharts-based visualizations with individual trajectory charts.
"""

import json
import pandas as pd
from datetime import datetime
from rich.console import Console

console = Console()

# Mock trajectory data for visualization
def generate_trajectory_data(ticker):
    """Generate mock trajectory data for a stock"""
    days = list(range(0, 31))  # 30 days of data
    prices = []

    # Start with a base price
    base_price = 100

    for i in range(len(days)):
        if i == 0:
            # Starting price
            price = base_price
        else:
            # Simulate price movement with some volatility
            change = (i - 15) * 0.5 + (i % 3) * 0.3 + (i % 7) * 0.2
            price = base_price + change + (i % 5) * 2

        # Add some random volatility
        volatility = 1 + ((-1) ** i) * (i % 3) * 0.3
        price = price * volatility

        # Ensure it approaches 52W high
        if i > 20:
            price = price + (i - 20) * 1.5

        prices.append(round(price, 2))

    return {
        'days': days,
        'prices': prices,
        'ticker': ticker,
        '52w_high': max(prices)
    }

# Mock data
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
        'overall_success_rate': 81.78
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
        'overall_success_rate': 81.78
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
        'overall_success_rate': 81.78
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
        'overall_success_rate': 81.78
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
        'overall_success_rate': 81.78
    }
]

def generate_trajectory_html(ticker, trajectory_data):
    """Generate individual trajectory HTML for a stock"""

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>52-Week Trajectory - {ticker}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }}
        .container {{
            max-width: 1200px;
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
        .chart-container {{
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }}
        #trajectoryChart {{
            width: 100%;
            height: 500px;
        }}
        .stats {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }}
        .stat-item {{
            background: white;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }}
        .stat-value {{
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
        }}
        .stat-label {{
            color: #666;
            margin-top: 5px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>52-Week Trajectory Analysis</h1>
            <p>{ticker} - Price Movement Towards 52-Week High</p>
        </div>

        <div class="stats">
            <div class="stat-item">
                <div class="stat-value">{trajectory_data['52w_high']:.2f}</div>
                <div class="stat-label">52-Week High</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">{len(trajectory_data['days'])}</div>
                <div class="stat-label">Days Tracked</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">{trajectory_data['prices'][0]:.2f}</div>
                <div class="stat-label">Start Price</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">{trajectory_data['prices'][-1]:.2f}</div>
                <div class="stat-label">Current Price</div>
            </div>
        </div>

        <div class="chart-container">
            <div id="trajectoryChart"></div>
        </div>
    </div>

    <script>
        const chart = echarts.init(document.getElementById('trajectoryChart'));

        const option = {{
            title: {{
                text: 'Stock Price Trajectory - {ticker}',
                left: 'center'
            }},
            tooltip: {{
                trigger: 'axis',
                formatter: function(params) {{
                    const dataIndex = params[0].dataIndex;
                    const day = params[0].name;
                    const price = params[0].data;
                    return 'Day ' + day + ': ₹' + price;
                }}
            }},
            grid: {{
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true
            }},
            xAxis: {{
                type: 'category',
                data: {json.dumps(trajectory_data['days'])},
                name: 'Days',
                nameTextStyle: {{ color: '#666' }}
            }},
            yAxis: {{
                type: 'value',
                name: 'Price (₹)',
                nameTextStyle: {{ color: '#666' }}
            }},
            series: [{{
                name: '{ticker}',
                type: 'line',
                data: {json.dumps(trajectory_data['prices'])},
                smooth: true,
                lineStyle: {{
                    width: 3,
                    color: '#667eea'
                }},
                areaStyle: {{
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        {{ offset: 0, color: 'rgba(102, 126, 234, 0.3)' }},
                        {{ offset: 1, color: 'rgba(102, 126, 234, 0.05)' }}
                    ])
                }},
                markLine: {{
                    data: [{{
                        yAxis: {trajectory_data['52w_high']},
                        name: '52-Week High',
                        lineStyle: {{ color: '#ff4444', type: 'dashed' }}
                    }}]
                }}
            }}]
        }};

        chart.setOption(option);

        window.addEventListener('resize', function() {{
            chart.resize();
        }});
    </script>
</body>
</html>
"""

    return html_content

def generate_main_html():
    """Generate main dashboard HTML"""

    tickers = [item['ticker'] for item in mock_data]
    success_rates = [item['success_rate'] for item in mock_data]
    avg_days = [item['avg_days_to_52w'] for item in mock_data]
    approaches = [item['approaches'] for item in mock_data]

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
        #chart1, #chart2, #chart3, #chart4 {{
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
        .links {{
            margin-top: 30px;
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        .links h3 {{
            margin-top: 0;
            color: #333;
        }}
        .link-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
        }}
        .link-item {{
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
            text-align: center;
            text-decoration: none;
            color: #333;
            transition: all 0.3s ease;
        }}
        .link-item:hover {{
            background: #667eea;
            color: white;
            transform: translateY(-2px);
        }}
        .link-item strong {{
            display: block;
            margin-bottom: 5px;
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
                    <div class="summary-value">{mock_data[0]['total_approaches']}</div>
                    <div class="summary-label">Total Approaches</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">{mock_data[0]['successful']}</div>
                    <div class="summary-label">Successful</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">{mock_data[0]['failed']}</div>
                    <div class="summary-label">Failed</div>
                </div>
                <div class="summary-item">
                    <div class="summary-value">{mock_data[0]['overall_success_rate']:.1f}%</div>
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
        </div>

        <div class="links">
            <h3>Individual Stock Trajectories</h3>
            <div class="link-grid">
"""

    # Add trajectory links
    for item in mock_data:
        ticker = item['ticker']
        trajectory_data = generate_trajectory_data(ticker)
        html_content += f"""
                <a href="52w_trajectory_{ticker}.html" class="link-item">
                    <strong>{ticker}</strong>
                    {item['success_rate']:.1f}% Success Rate
                </a>
"""

    html_content += """
            </div>
        </div>
    </div>

    <script>
        const chart1 = echarts.init(document.getElementById('chart1'));
        const chart2 = echarts.init(document.getElementById('chart2'));
        const chart3 = echarts.init(document.getElementById('chart3'));
        const chart4 = echarts.init(document.getElementById('chart4'));

        const tickers = """ + json.dumps(tickers) + """;
        const success_rates = """ + json.dumps(success_rates) + """;
        const avg_days = """ + json.dumps(avg_days) + """;
        const approaches = """ + json.dumps(approaches) + """;

        // Chart 1: Success Rate
        const option1 = {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: tickers, axisLabel: { rotate: 45 } },
            yAxis: {
                type: 'value',
                name: 'Success Rate (%)',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: success_rates,
                type: 'bar',
                itemStyle: { color: '#667eea' }
            }]
        };

        // Chart 2: Average Days
        const option2 = {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: tickers, axisLabel: { rotate: 45 } },
            yAxis: {
                type: 'value',
                name: 'Days',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: avg_days,
                type: 'bar',
                itemStyle: { color: '#764ba2' }
            }]
        };

        // Chart 3: Approaches Count
        const option3 = {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: tickers, axisLabel: { rotate: 45 } },
            yAxis: {
                type: 'value',
                name: 'Number of Approaches',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: approaches,
                type: 'bar',
                itemStyle: { color: '#ff6b6b' }
            }]
        };

        // Chart 4: Win Rate Distribution
        const win_rate_ranges = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
        const win_rate_counts = [0, 0, 0, 0, 0];

        success_rates.forEach(rate => {
            if (rate < 20) win_rate_counts[0]++;
            else if (rate < 40) win_rate_counts[1]++;
            else if (rate < 60) win_rate_counts[2]++;
            else if (rate < 80) win_rate_counts[3]++;
            else win_rate_counts[4]++;
        });

        const option4 = {
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: win_rate_ranges,
                axisLabel: { color: '#333' }
            },
            yAxis: {
                type: 'value',
                name: 'Number of Stocks',
                nameTextStyle: { color: '#666' }
            },
            series: [{
                data: win_rate_counts,
                type: 'bar',
                itemStyle: {
                    color: function(params) {
                        const colors = ['#ff4444', '#ff8844', '#ffcc44', '#88cc44', '#44cc44'];
                        return colors[params.dataIndex];
                    }
                }
            }]
        };

        chart1.setOption(option1);
        chart2.setOption(option2);
        chart3.setOption(option3);
        chart4.setOption(option4);

        window.addEventListener('resize', function() {
            chart1.resize();
            chart2.resize();
            chart3.resize();
            chart4.resize();
        });
    </script>
</body>
</html>
"""

    return html_content

def main():
    console.print("Generating ECharts dashboard with trajectories...")

    # Generate main dashboard
    main_html = generate_main_html()
    with open("52week_echarts_dashboard.html", 'w', encoding='utf-8') as f:
        f.write(main_html)

    # Generate individual trajectory files
    for item in mock_data:
        ticker = item['ticker']
        trajectory_data = generate_trajectory_data(ticker)
        trajectory_html = generate_trajectory_html(ticker, trajectory_data)

        filename = f"52w_trajectory_{ticker}.html"
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(trajectory_html)

        console.print(f"✅ Generated {filename}")

    console.print("✅ Main dashboard saved to 52week_echarts_dashboard.html")
    console.print("📊 Open the main dashboard in your browser to view all visualizations")

if __name__ == "__main__":
    main()