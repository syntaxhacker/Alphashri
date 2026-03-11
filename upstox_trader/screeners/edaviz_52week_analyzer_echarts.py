#!/usr/bin/env python3
"""
52-Week High Strategy Visualization with ECharts
==============================================
Generates interactive ECharts-based visualizations for 52-week strategy analysis.
"""

import sys
import os
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
import time

# Add project root
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_project_root_dir = os.path.dirname(os.path.dirname(_current_file_dir))
if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from backtest_52week_batch_test import batch_test_nifty_50, quick_backtest
from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from rich.console import Console

console = Console()


def prepare_echarts_data(results: List[Dict]) -> Dict:
    """Prepare data for ECharts visualizations"""

    # Convert results to DataFrame
    df = pd.DataFrame(results)

    # 1. Performance Heatmap data
    heatmap_data = []
    for _, row in df.iterrows():
        if row['trades'] > 0:
            heatmap_data.append({
                'name': row['ticker'],
                'win_rate': row['win_rate'],
                'total_pnl': row['total_pnl'],
                'trades': row['trades'],
                'expectancy': row['expectancy']
            })

    # 2. Win Rate Distribution
    win_rate_bins = [0, 20, 40, 60, 80, 100]
    win_rate_labels = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%']
    hist, _ = np.histogram(df['win_rate'], bins=win_rate_bins)
    win_rate_dist = []
    for i, count in enumerate(hist):
        win_rate_dist.append({
            'range': win_rate_labels[i],
            'count': int(count)
        })

    # 3. P&L Distribution
    pnl_bins = [-50, -30, -10, 10, 30, 50]
    pnl_labels = ['-50 to -30%', '-30 to -10%', '-10 to 10%', '10 to 30%', '30 to 50%']
    hist, _ = np.histogram(df['total_pnl'], bins=pnl_bins)
    pnl_dist = []
    for i, count in enumerate(hist):
        pnl_dist.append({
            'range': pnl_labels[i],
            'count': int(count),
            'avg_pnl': np.mean(df[(df['total_pnl'] >= pnl_bins[i]) & (df['total_pnl'] < pnl_bins[i+1])]['total_pnl']) if count > 0 else 0
        })

    # 4. Top Performers (Scatter)
    top_performers = df[df['win_rate'] >= 70].sort_values('win_rate', ascending=False).head(20)
    scatter_data = []
    for _, row in top_performers.iterrows():
        scatter_data.append({
            'name': row['ticker'],
            'win_rate': row['win_rate'],
            'pnl': row['total_pnl'],
            'trades': row['trades'],
            'expectancy': row['expectancy']
        })

    # 5. Trade Frequency Leaders
    active_stocks = df.sort_values('trades', ascending=False).head(15)
    freq_data = []
    for _, row in active_stocks.iterrows():
        freq_data.append({
            'name': row['ticker'],
            'trades': row['trades'],
            'win_rate': row['win_rate'],
            'pnl': row['total_pnl']
        })

    # 6. Correlation Matrix
    numeric_cols = ['win_rate', 'trades', 'total_pnl', 'expectancy', 'best_trade', 'worst_trade']
    correlation_matrix = df[numeric_cols].corr().round(2)

    # Prepare correlation data for heatmap
    corr_data = []
    for i, col1 in enumerate(correlation_matrix.columns):
        for j, col2 in enumerate(correlation_matrix.columns):
            corr_data.append([col1, col2, correlation_matrix.iloc[i, j]])

    return {
        'heatmap': heatmap_data,
        'win_rate_dist': win_rate_dist,
        'pnl_dist': pnl_dist,
        'scatter': scatter_data,
        'frequency': freq_data,
        'correlation_matrix': correlation_matrix,
        'correlation_data': corr_data
    }


def generate_html_page(data: Dict, results: List[Dict]) -> str:
    """Generate HTML page with ECharts"""

    # Calculate statistics
    total_stocks = len(results)
    stocks_with_trades = len([r for r in results if r['trades'] > 0])
    total_trades = sum(r.get('trades', 0) for r in results)
    elite_performers = len([r for r in results if r['win_rate'] >= 80])

    # Prepare JavaScript data strings
    win_rate_ranges = json.dumps([item["range"] for item in data["win_rate_dist"]])
    win_rate_counts = json.dumps([item["count"] for item in data["win_rate_dist"]])
    pnl_ranges = json.dumps([item["range"] for item in data["pnl_dist"]])
    pnl_counts = json.dumps([item["count"] for item in data["pnl_dist"]])
    scatter_data = json.dumps(data["scatter"])
    freq_data = json.dumps(data["frequency"])
    corr_data = json.dumps(data["correlation_data"])

    # Create HTML template
    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>52-Week Strategy Performance Dashboard with ECharts</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
            color: #333;
        }}
        .container {{
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            padding: 30px;
        }}
        .header {{
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e0e0e0;
        }}
        .header h1 {{
            color: #2c3e50;
            margin: 0;
            font-size: 32px;
        }}
        .header p {{
            color: #7f8c8d;
            margin: 10px 0 0 0;
        }}
        .stats {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }}
        .stat-card {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 25px;
            border-radius: 12px;
            text-align: center;
            color: white;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            transition: transform 0.3s ease;
        }}
        .stat-card:hover {{
            transform: translateY(-5px);
        }}
        .stat-value {{
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        .stat-label {{
            font-size: 14px;
            opacity: 0.9;
        }}
        .charts-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 40px;
        }}
        .chart-container {{
            background: #fafafa;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid #e0e0e0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }}
        .chart {{
            width: 100%;
            height: 400px;
        }}
        .chart-title {{
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 15px;
            color: #2c3e50;
            text-align: center;
        }}
        .full-width {{
            grid-column: 1 / -1;
        }}
        .table-container {{
            background: #fafafa;
            border-radius: 12px;
            padding: 20px;
            margin-top: 40px;
            border: 1px solid #e0e0e0;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        th {{
            background-color: #f8f9fa;
            font-weight: 600;
            color: #2c3e50;
            position: sticky;
            top: 0;
        }}
        .green {{
            color: #28a745;
            font-weight: bold;
        }}
        .red {{
            color: #dc3545;
        }}
        .yellow {{
            color: #ffc107;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>52-Week High Strategy Performance Dashboard</h1>
            <p>Interactive ECharts visualization of backtest results</p>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-value">{total_stocks}</div>
                <div class="stat-label">Total Stocks Tested</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{stocks_with_trades}</div>
                <div class="stat-label">Stocks with Trades</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{total_trades}</div>
                <div class="stat-label">Total Trades</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{elite_performers}</div>
                <div class="stat-label">Elite Performers (80%+)</div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-container">
                <div class="chart-title">Win Rate Distribution</div>
                <div id="winRateChart" class="chart"></div>
            </div>

            <div class="chart-container">
                <div class="chart-title">P&L Distribution</div>
                <div id="pnlChart" class="chart"></div>
            </div>

            <div class="chart-container full-width">
                <div class="chart-title">Top Performers (Win Rate vs P&L)</div>
                <div id="scatterChart" class="chart"></div>
            </div>

            <div class="chart-container">
                <div class="chart-title">Most Active Stocks</div>
                <div id="frequencyChart" class="chart"></div>
            </div>

            <div class="chart-container full-width">
                <div class="chart-title">Performance Correlations</div>
                <div id="correlationChart" class="chart"></div>
            </div>
        </div>

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Ticker</th>
                        <th>Trades</th>
                        <th>Win Rate</th>
                        <th>Total P&L %</th>
                        <th>Expectancy %</th>
                        <th>Best Trade</th>
                        <th>Worst Trade</th>
                    </tr>
                </thead>
                <tbody>
                    {generate_table_rows(results)}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        // Initialize charts
        const charts = {{}};
        charts.winRateChart = echarts.init(document.getElementById('winRateChart'));
        charts.pnlChart = echarts.init(document.getElementById('pnlChart'));
        charts.scatterChart = echarts.init(document.getElementById('scatterChart'));
        charts.frequencyChart = echarts.init(document.getElementById('frequencyChart'));
        charts.correlationChart = echarts.init(document.getElementById('correlationChart'));

        // Win Rate Distribution Chart
        const winRateOption = {{
            title: {{
                text: 'Win Rate Distribution',
                left: 'center',
                textStyle: {{
                    fontSize: 18,
                    fontWeight: 'bold'
                }}
            }},
            tooltip: {{
                trigger: 'axis',
                axisPointer: {{type: 'shadow'}}
            }},
            xAxis: {{
                type: 'category',
                data: {win_rate_ranges},
                axisLabel: {{
                    rotate: 45,
                    color: '#333'
                }}
            }},
            yAxis: {{
                type: 'value',
                name: 'Number of Stocks',
                nameTextStyle: {{
                    color: '#666'
                }},
                axisLabel: {{
                    color: '#333'
                }}
            }},
            series: [{{
                name: 'Win Rate Distribution',
                type: 'bar',
                data: {win_rate_counts},
                itemStyle: {{
                    color: ['#ff4444', '#ff8844', '#ffcc44', '#88cc44', '#44cc44']
                }},
                label: {{
                    show: true,
                    position: 'top',
                    formatter: '{{c}}',
                    color: '#333'
                }}
            }}]
        }};

        // P&L Distribution Chart
        const pnlOption = {{
            title: {{
                text: 'P&L Distribution',
                left: 'center',
                textStyle: {{
                    fontSize: 18,
                    fontWeight: 'bold'
                }}
            }},
            tooltip: {{
                trigger: 'axis',
                axisPointer: {{type: 'shadow'}}
            }},
            xAxis: {{
                type: 'category',
                data: {pnl_ranges},
                axisLabel: {{
                    rotate: 45,
                    color: '#333'
                }}
            }},
            yAxis: {{
                type: 'value',
                name: 'Number of Stocks',
                nameTextStyle: {{
                    color: '#666'
                }},
                axisLabel: {{
                    color: '#333'
                }}
            }},
            series: [{{
                name: 'P&L Distribution',
                type: 'bar',
                data: {pnl_counts},
                itemStyle: {{
                    color: ['#ff4444', '#ff8844', '#44cc44', '#88cc44', '#44cc44']
                }},
                label: {{
                    show: true,
                    position: 'top',
                    formatter: '{{c}}',
                    color: '#333'
                }}
            }}]
        }};

        // Top Performers Scatter Chart
        const scatterOption = {{
            title: {{
                text: 'Top Performers (Win Rate vs P&L)',
                left: 'center',
                textStyle: {{
                    fontSize: 18,
                    fontWeight: 'bold'
                }}
            }},
            tooltip: {{
                trigger: 'item'
            }},
            grid: {{
                left: '10%',
                right: '15%',
                bottom: '15%'
            }},
            xAxis: {{
                type: 'value',
                name: 'Win Rate (%)',
                min: 60,
                max: 100,
                nameTextStyle: {{
                    color: '#666'
                }},
                axisLabel: {{
                    color: '#333'
                }}
            }},
            yAxis: {{
                type: 'value',
                name: 'Total P&L (%)',
                nameTextStyle: {{
                    color: '#666'
                }},
                axisLabel: {{
                    color: '#333'
                }}
            }},
            series: [{{
                type: 'scatter',
                data: {scatter_data},
                symbolSize: function(data) {{
                    return Math.min(Math.max(data.trades * 3, 30), 80);
                }},
                itemStyle: {{
                    color: '#ff6b6b'
                }},
                label: {{
                    show: true,
                    position: 'top',
                    formatter: function(params) {{
                        return params.data.name;
                    }},
                    fontSize: 10,
                    color: '#333'
                }}
            }}]
        }};

        // Frequency Chart
        const freqOption = {{
            title: {{
                text: 'Most Active Stocks',
                left: 'center',
                textStyle: {{
                    fontSize: 18,
                    fontWeight: 'bold'
                }}
            }},
            tooltip: {{
                trigger: 'item'
            }},
            xAxis: {{
                type: 'value',
                name: 'Number of Trades',
                nameTextStyle: {{
                    color: '#666'
                }},
                axisLabel: {{
                    color: '#333'
                }}
            }},
            yAxis: {{
                type: 'value',
                name: 'Stock',
                nameTextStyle: {{
                    color: '#666'
                }},
                axisLabel: {{
                    color: '#333'
                }}
            }},
            series: [{{
                type: 'bar',
                data: {freq_data},
                label: {{
                    show: true,
                    position: 'right',
                    formatter: function(params) {{
                        return params.data.name;
                    }},
                    color: '#333'
                }},
                itemStyle: {{
                    color: '#ff8844'
                }}
            }}]
        }};

        // Correlation Heatmap
        const corrOption = {{
            title: {{
                text: 'Performance Correlations',
                left: 'center',
                textStyle: {{
                    fontSize: 18,
                    fontWeight: 'bold'
                }}
            }},
            tooltip: {{
                position: 'top'
            }},
            grid: {{
                height: '50%',
                top: '10%'
            }},
            xAxis: {{
                type: 'category',
                data: ['Win Rate', 'Trades', 'Total P&L', 'Expectancy', 'Best Trade', 'Worst Trade'],
                splitArea: {{
                    show: true
                }},
                axisLabel: {{
                    rotate: 45,
                    color: '#333'
                }}
            }},
            yAxis: {{
                type: 'category',
                data: ['Win Rate', 'Trades', 'Total P&L', 'Expectancy', 'Best Trade', 'Worst Trade'],
                splitArea: {{
                    show: true
                }},
                axisLabel: {{
                    color: '#333'
                }}
            }},
            visualMap: {{
                min: -1,
                max: 1,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: '15%',
                textStyle: {{
                    color: '#333'
                }},
                inRange: {{
                    color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
                }}
            }},
            series: [{{
                name: 'Correlation',
                type: 'heatmap',
                data: {corr_data},
                label: {{
                    show: true,
                    formatter: function(params) {{
                        return params.value[2];
                    }},
                    fontSize: 12
                }},
                emphasis: {{
                    itemStyle: {{
                        shadowBlur: 10,
                        shadowColor: 'rgba(0, 0, 0, 0.5)'
                    }}
                }}
            }}]
        }};

        // Set options
        charts.winRateChart.setOption(winRateOption);
        charts.pnlChart.setOption(pnlOption);
        charts.scatterChart.setOption(scatterOption);
        charts.frequencyChart.setOption(freqOption);
        charts.correlationChart.setOption(corrOption);

        // Responsive
        window.addEventListener('resize', function() {{
            Object.values(charts).forEach(chart => chart.resize());
        }});
    </script>
</body>
</html>"""

    return html_template


def generate_table_rows(results: List[Dict]) -> str:
    """Generate HTML table rows from results"""
    html = ""
    sorted_results = sorted(results, key=lambda x: (x.get('win_rate', 0), x.get('trades', 0)), reverse=True)

    for i, r in enumerate(sorted_results[:50], 1):
        wr_class = "green" if r['win_rate'] >= 80 else ("yellow" if r['win_rate'] >= 60 else "red")
        pnl_class = "green" if r['total_pnl'] > 0 else "red"

        html += f"""
            <tr>
                <td>{i}</td>
                <td><strong>{r['ticker']}</strong></td>
                <td>{r['trades']}</td>
                <td class="{wr_class}">{r['win_rate']:.1f}%</td>
                <td class="{pnl_class}">{r['total_pnl']:+.1f}%</td>
                <td>{r['expectancy']:+.2f}%</td>
                <td class="green">+{r.get('best_trade', 0):.1f}%</td>
                <td class="red">{r.get('worst_trade', 0):.1f}%</td>
            </tr>"""
    return html


def main():
    """Main function to run ECharts visualization"""
    import argparse

    parser = argparse.ArgumentParser(description="Generate 52-week strategy ECharts visualizations")
    parser.add_argument('--days', '-d', type=int, default=730, help='Backtest period in days')
    parser.add_argument('--nifty-100', '-n', action='store_true', help='Use Nifty 100 instead of Nifty 50')
    parser.add_argument('--filter', '-f', action='store_true', help='Filter out underperforming sectors')
    parser.add_argument('--output', '-o', default='52week_echarts_analysis.html', help='Output HTML file')

    args = parser.parse_args()

    console.print("[bold cyan]Running 52-week strategy backtest...[/bold cyan]")
    results = batch_test_nifty_50(args.days, use_nifty_100=args.nifty_100, filter_sectors=args.filter)

    if not results:
        console.print("[red]No results generated![/red]")
        return

    # Prepare chart data
    console.print("[green]Preparing ECharts data...[/green]")
    data = prepare_echarts_data(results)

    # Generate HTML
    console.print("[green]Generating HTML page...[/green]")
    html_content = generate_html_page(data, results)

    # Save to file
    with open(args.output, 'w') as f:
        f.write(html_content)

    console.print(f"\n✅ ECharts visualization generated: {args.output}")
    console.print(f"📊 Open {args.output} in your browser to view the interactive dashboard")


if __name__ == "__main__":
    main()