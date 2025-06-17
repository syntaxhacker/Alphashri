#!/usr/bin/env python3
"""
Enhanced HTML Generator for Trading Strategy Analysis
Features:
- Full-width responsive layout
- Candlestick charts instead of line charts
- Full-width tables
- Modern UI with improved UX
"""

import json
import pandas as pd
from datetime import datetime
from typing import Dict, List
from rich.console import Console

console = Console()

def generate_enhanced_html_report(optimization_results: Dict, output_file: str = "bar_updn_analysis.html"):
    """Generate enhanced full-width HTML report with candlestick charts"""
    
    console.print("[cyan]🎨 Generating enhanced full-width HTML report with candlesticks...[/cyan]")
    
    # Get best results for visualization
    best_params = optimization_results['best_parameters']
    best_results = best_params['results']
    
    # Prepare chart data with OHLCV for candlesticks
    chart_data = {
        'symbols': [],
        'ohlcv_data': {},  # For candlestick charts
        'equity_curves': {},
        'trades': {},
        'parameters': best_params['parameters'],
        'summary': best_params['metrics']
    }
    
    def format_trades_for_enhanced_table(trades_list):
        """Format trades for enhanced full-width table"""
        if not trades_list:
            return []
        
        formatted_trades = []
        for i, trade in enumerate(trades_list, 1):
            # Calculate duration
            entry_time = pd.to_datetime(trade['entry_time'])
            exit_time = pd.to_datetime(trade['exit_time'])
            duration = exit_time - entry_time
            
            # Format duration
            if duration.days > 0:
                duration_str = f"{duration.days}d {duration.seconds//3600}h {(duration.seconds%3600)//60}m"
            elif duration.seconds >= 3600:
                duration_str = f"{duration.seconds//3600}h {(duration.seconds%3600)//60}m"
            else:
                duration_str = f"{duration.seconds//60}m {duration.seconds%60}s"
            
            formatted_trades.append({
                'trade_number': i,
                'entry_time': trade['entry_time'],
                'exit_time': trade['exit_time'],
                'side': trade['side'],
                'entry_price': trade['entry_price'],
                'exit_price': trade['exit_price'],
                'pnl': trade['pnl'],
                'pnl_percent': trade['pnl_percent'],
                'exit_reason': trade['exit_reason'],
                'duration': duration_str,
                'quantity': trade.get('quantity', 1)
            })
        
        return formatted_trades
    
    # Process each symbol
    for result in best_results:
        symbol = result.symbol
        chart_data['symbols'].append(symbol)
        
        # Get OHLCV data for candlestick charts (from the backtest data)
        if hasattr(result, 'raw_data') and result.raw_data is not None:
            ohlcv_df = result.raw_data.reset_index()
            chart_data['ohlcv_data'][symbol] = {
                'timestamps': ohlcv_df['timestamp'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist(),
                'open': ohlcv_df['open'].tolist(),
                'high': ohlcv_df['high'].tolist(),
                'low': ohlcv_df['low'].tolist(),
                'close': ohlcv_df['close'].tolist(),
                'volume': ohlcv_df['volume'].tolist()
            }
        else:
            # Fallback to equity curve data for line chart
            chart_data['ohlcv_data'][symbol] = None
        
        # Equity curve data
        equity_df = result.equity_curve.reset_index()
        chart_data['equity_curves'][symbol] = {
            'timestamps': equity_df['timestamp'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist(),
            'equity': equity_df['equity'].tolist(),
            'initial_capital': result.initial_capital,
            'final_capital': result.final_capital,
            'return_percent': result.total_return_percent
        }
        
        # Process trades
        trades_data = []
        for trade in result.trades:
            trades_data.append({
                'entry_time': trade.entry_time.strftime('%Y-%m-%d %H:%M:%S'),
                'exit_time': trade.exit_time.strftime('%Y-%m-%d %H:%M:%S'),
                'side': trade.side,
                'entry_price': trade.entry_price,
                'exit_price': trade.exit_price,
                'pnl': trade.pnl,
                'pnl_percent': trade.pnl_percent,
                'exit_reason': trade.exit_reason,
                'quantity': trade.quantity if hasattr(trade, 'quantity') else 1
            })
        
        chart_data['trades'][symbol] = format_trades_for_enhanced_table(trades_data)
    
    # Generate enhanced HTML
    html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BarUpDn Strategy - Enhanced Full-Width Analysis</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/dist/ag-grid-community.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-grid.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-theme-alpine.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
            line-height: 1.6;
        }}
        
        .main-container {{
            width: 100%;
            max-width: none;
            margin: 0;
            padding: 20px;
            background: transparent;
        }}
        
        .content-wrapper {{
            background: white;
            border-radius: 15px;
            padding: 40px;
            box-shadow: 0 25px 50px rgba(0,0,0,0.15);
            margin-bottom: 20px;
        }}
        
        .header {{
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
        }}
        
        .header h1 {{
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 25px;
            margin-bottom: 40px;
        }}
        
        .metric-card {{
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            border: 1px solid #e0e0e0;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }}
        
        .metric-card::before {{
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 4px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }}
        
        .metric-card:hover {{
            transform: translateY(-5px);
            box-shadow: 0 15px 30px rgba(0,0,0,0.1);
        }}
        
        .metric-value {{
            font-size: 2rem;
            font-weight: 700;
            color: #667eea;
            margin-bottom: 8px;
        }}
        
        .metric-label {{
            font-size: 0.9rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 500;
        }}
        
        .chart-section {{
            margin: 40px 0;
            background: #fafafa;
            padding: 30px;
            border-radius: 15px;
            border: 1px solid #e0e0e0;
        }}
        
        .section-title {{
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 25px;
            color: #333;
            display: flex;
            align-items: center;
            gap: 10px;
        }}
        
        .symbol-tabs {{
            display: flex;
            margin-bottom: 25px;
            border-bottom: 2px solid #e0e0e0;
            gap: 5px;
            flex-wrap: wrap;
        }}
        
        .tab {{
            padding: 12px 24px;
            cursor: pointer;
            border: none;
            background: none;
            font-size: 1rem;
            color: #666;
            border-bottom: 3px solid transparent;
            transition: all 0.3s ease;
            font-weight: 500;
            border-radius: 8px 8px 0 0;
        }}
        
        .tab.active {{
            color: #667eea;
            border-bottom-color: #667eea;
            background: rgba(102, 126, 234, 0.05);
            font-weight: 600;
        }}
        
        .tab:hover {{
            color: #667eea;
            background: rgba(102, 126, 234, 0.1);
        }}
        
        .chart-container {{
            width: 100%;
            height: 500px;
            border-radius: 10px;
            overflow: hidden;
            border: 1px solid #e0e0e0;
        }}
        
        .trades-section {{
            margin: 40px 0;
        }}
        
        .ag-theme-alpine {{
            width: 100%;
            height: 500px;
            border-radius: 10px;
            border: 1px solid #e0e0e0;
        }}
        
        .positive {{ 
            color: #28a745; 
            font-weight: 600; 
        }}
        
        .negative {{ 
            color: #dc3545; 
            font-weight: 600; 
        }}
        
        .long {{ 
            color: #28a745;
            background: rgba(40, 167, 69, 0.1);
            padding: 4px 8px;
            border-radius: 6px;
            font-weight: 600;
        }}
        
        .short {{ 
            color: #dc3545;
            background: rgba(220, 53, 69, 0.1);
            padding: 4px 8px;
            border-radius: 6px;
            font-weight: 600;
        }}
        
        .footer {{
            text-align: center;
            margin-top: 40px;
            padding: 20px;
            color: rgba(255,255,255,0.8);
            font-size: 0.9rem;
        }}
        
        .responsive-table {{
            overflow-x: auto;
            width: 100%;
        }}
        
        @media (max-width: 768px) {{
            .main-container {{
                padding: 10px;
            }}
            
            .content-wrapper {{
                padding: 20px;
            }}
            
            .header h1 {{
                font-size: 2rem;
            }}
            
            .metrics-grid {{
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
            }}
            
            .metric-value {{
                font-size: 1.5rem;
            }}
            
            .symbol-tabs {{
                flex-wrap: wrap;
            }}
            
            .tab {{
                padding: 10px 16px;
                font-size: 0.9rem;
            }}
        }}
    </style>
</head>
<body>
    <div class="main-container">
        <div class="content-wrapper">
            <div class="header">
                <h1>🚀 BarUpDn Strategy Analysis</h1>
                <p>Enhanced Full-Width Analysis with Candlestick Charts</p>
                <p><small>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</small></p>
            </div>

            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">{best_params['parameters']['sl_percent']}%</div>
                    <div class="metric-label">Stop Loss</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{best_params['parameters']['trailing_stop_percent']:.1f}%</div>
                    <div class="metric-label">Trailing Stop</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{best_params['parameters']['position_size_percent']}%</div>
                    <div class="metric-label">Position Size</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{best_params['metrics']['avg_return_percent']:.2f}%</div>
                    <div class="metric-label">Average Return</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{best_params['metrics']['avg_win_rate']:.1f}%</div>
                    <div class="metric-label">Win Rate</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{best_params['metrics']['avg_sharpe_ratio']:.2f}</div>
                    <div class="metric-label">Sharpe Ratio</div>
                </div>
            </div>

            <div class="chart-section">
                <h2 class="section-title">📈 Equity Curves Comparison</h2>
                <div id="equity-chart" class="chart-container"></div>
            </div>

            <div class="chart-section">
                <h2 class="section-title">🕯️ Candlestick Charts & Analysis</h2>
                <div class="symbol-tabs">
                    {' '.join([f'<button class="tab" onclick="showSymbolAnalysis(\'{symbol}\', this)">{symbol}</button>' for symbol in chart_data['symbols']])}
                </div>
                
                <div id="symbol-content">
                    <div id="price-chart" class="chart-container"></div>
                </div>
            </div>

            <div class="chart-section trades-section">
                <h2 class="section-title">📊 Trade Analysis</h2>
                <div class="symbol-tabs">
                    {' '.join([f'<button class="tab" onclick="showTradeAnalysis(\'{symbol}\', this)">{symbol}</button>' for symbol in chart_data['symbols']])}
                </div>
                
                <div class="responsive-table">
                    <div id="trades-grid" class="ag-theme-alpine"></div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Enhanced BarUpDn Strategy Analysis • Full-Width Layout with Candlestick Charts</p>
        </div>
    </div>

    <script>
        const chartData = {json.dumps(chart_data, indent=2)};
        let currentSymbol = chartData.symbols[0] || '';
        let equityChart = null;
        let priceChart = null;
        let tradesGrid = null;
        
        // Enhanced ag-Grid column definitions
        const tradeColumns = [
            {{ field: 'trade_number', headerName: '#', width: 60, pinned: 'left' }},
            {{ 
                field: 'entry_time', 
                headerName: 'Entry Time (UTC)', 
                width: 170,
                cellRenderer: params => {{
                    const date = new Date(params.value);
                    return date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
                }}
            }},
            {{ 
                field: 'exit_time', 
                headerName: 'Exit Time (UTC)', 
                width: 170,
                cellRenderer: params => {{
                    const date = new Date(params.value);
                    return date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
                }}
            }},
            {{ 
                field: 'side', 
                headerName: 'Side', 
                width: 80,
                cellRenderer: params => `<span class="${{params.value.toLowerCase()}}">${{params.value}}</span>`
            }},
            {{ 
                field: 'entry_price', 
                headerName: 'Entry Price', 
                width: 120,
                cellRenderer: params => '$' + parseFloat(params.value).toFixed(4)
            }},
            {{ 
                field: 'exit_price', 
                headerName: 'Exit Price', 
                width: 120,
                cellRenderer: params => '$' + parseFloat(params.value).toFixed(4)
            }},
            {{ 
                field: 'pnl', 
                headerName: 'P&L ($)', 
                width: 100,
                cellRenderer: params => {{
                    const value = parseFloat(params.value);
                    const className = value >= 0 ? 'positive' : 'negative';
                    return `<span class="${{className}}">${{value >= 0 ? '+' : ''}}${{value.toFixed(2)}}</span>`;
                }}
            }},
            {{ 
                field: 'pnl_percent', 
                headerName: 'P&L (%)', 
                width: 100,
                cellRenderer: params => {{
                    const value = parseFloat(params.value);
                    const className = value >= 0 ? 'positive' : 'negative';
                    return `<span class="${{className}}">${{value >= 0 ? '+' : ''}}{{value.toFixed(2)}}%</span>`;
                }}
            }},
            {{ 
                field: 'duration', 
                headerName: 'Duration', 
                width: 120,
                sortable: true,
                comparator: (valueA, valueB) => {{
                    // Custom duration sorting - convert to minutes for comparison
                    const parseMinutes = (duration) => {{
                        if (!duration) return 0;
                        let minutes = 0;
                        const days = duration.match(/(\\d+)d/);
                        const hours = duration.match(/(\\d+)h/);
                        const mins = duration.match(/(\\d+)m/);
                        if (days) minutes += parseInt(days[1]) * 24 * 60;
                        if (hours) minutes += parseInt(hours[1]) * 60;
                        if (mins) minutes += parseInt(mins[1]);
                        return minutes;
                    }};
                    return parseMinutes(valueA) - parseMinutes(valueB);
                }}
            }},
            {{ field: 'exit_reason', headerName: 'Exit Reason', width: 140 }},
            {{ 
                field: 'quantity', 
                headerName: 'Quantity', 
                width: 100,
                cellRenderer: params => parseFloat(params.value).toFixed(4)
            }}
        ];
        
        // Initialize equity curves chart
        function initEquityChart() {{
            const traces = [];
            
            chartData.symbols.forEach(symbol => {{
                if (chartData.equity_curves[symbol]) {{
                    const equity = chartData.equity_curves[symbol];
                    traces.push({{
                        x: equity.timestamps,
                        y: equity.equity,
                        type: 'scatter',
                        mode: 'lines',
                        name: `${{symbol}} (${{equity.return_percent.toFixed(2)}}%)`,
                        line: {{ width: 3 }}
                    }});
                }}
            }});
            
            const layout = {{
                title: {{
                    text: 'Portfolio Equity Curves',
                    font: {{ size: 18, weight: 600 }}
                }},
                xaxis: {{ 
                    title: 'Time',
                    showgrid: true,
                    gridcolor: 'rgba(0,0,0,0.1)'
                }},
                yaxis: {{ 
                    title: 'Equity ($)',
                    showgrid: true,
                    gridcolor: 'rgba(0,0,0,0.1)'
                }},
                hovermode: 'x unified',
                showlegend: true,
                legend: {{
                    orientation: 'h',
                    y: -0.2
                }},
                margin: {{ t: 40, b: 60, l: 60, r: 40 }}
            }};
            
            const config = {{
                responsive: true,
                displayModeBar: true,
                displaylogo: false
            }};
            
            Plotly.newPlot('equity-chart', traces, layout, config);
        }}
        
        // Show symbol candlestick analysis
        function showSymbolAnalysis(symbol, tabElement) {{
            currentSymbol = symbol;
            
            // Update tab states
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            tabElement.classList.add('active');
            
            // Create candlestick chart with trade markers
            if (chartData.ohlcv_data[symbol]) {{
                const ohlcv = chartData.ohlcv_data[symbol];
                const trades = chartData.trades[symbol] || [];
                
                // Main candlestick trace with improved styling
                const candlestickTrace = {{
                    x: ohlcv.timestamps,
                    open: ohlcv.open,
                    high: ohlcv.high,
                    low: ohlcv.low,
                    close: ohlcv.close,
                    type: 'candlestick',
                    name: symbol,
                    increasing: {{ 
                        line: {{ color: '#28a745', width: 1.5 }},
                        fillcolor: 'rgba(40, 167, 69, 0.8)'
                    }},
                    decreasing: {{ 
                        line: {{ color: '#dc3545', width: 1.5 }},
                        fillcolor: 'rgba(220, 53, 69, 0.8)'
                    }},
                    whiskerwidth: 0.5,
                    line: {{ width: 1 }}
                }};
                
                // Volume trace with colored bars
                const volumeTrace = {{
                    x: ohlcv.timestamps,
                    y: ohlcv.volume,
                    type: 'bar',
                    name: 'Volume',
                    yaxis: 'y2',
                    marker: {{ 
                        color: ohlcv.close.map((close, i) => 
                            close >= ohlcv.open[i] ? 'rgba(40, 167, 69, 0.6)' : 'rgba(220, 53, 69, 0.6)'
                        )
                    }},
                    hovertemplate: '<b>Volume</b><br>%{{y:,.0f}}<br>%{{x}}<extra></extra>'
                }};
                
                const traces = [candlestickTrace, volumeTrace];
                
                // Add support and resistance lines
                addSupportResistanceLines(traces, ohlcv, ohlcv.timestamps);
                
                // Add entry/exit markers if trades exist
                if (trades.length > 0) {{
                    // Entry markers
                    const entryMarkers = {{
                        x: trades.map(t => t.entry_time),
                        y: trades.map(t => parseFloat(t.entry_price)),
                        mode: 'markers',
                        marker: {{
                            color: trades.map(t => t.side === 'LONG' ? '#28a745' : '#dc3545'),
                            size: 12,
                            symbol: trades.map(t => t.side === 'LONG' ? 'triangle-up' : 'triangle-down'),
                            line: {{ color: 'white', width: 2 }}
                        }},
                        name: 'Entry Points',
                        hovertemplate: '<b>%{{text}} Entry</b><br>%{{x}}<br>Price: $%{{y:.4f}}<extra></extra>',
                        text: trades.map(t => t.side)
                    }};
                    
                    // Exit markers
                    const exitMarkers = {{
                        x: trades.map(t => t.exit_time),
                        y: trades.map(t => parseFloat(t.exit_price)),
                        mode: 'markers',
                        marker: {{
                            color: trades.map(t => parseFloat(t.pnl) >= 0 ? '#28a745' : '#dc3545'),
                            size: 10,
                            symbol: 'x',
                            line: {{ color: 'white', width: 2 }}
                        }},
                        name: 'Exit Points',
                        hovertemplate: '<b>Exit</b><br>%{{x}}<br>Price: $%{{y:.4f}}<br>P&L: %{{customdata.pnl}}%<br>Reason: %{{customdata.reason}}<extra></extra>',
                        customdata: trades.map(t => ({{ 
                            pnl: parseFloat(t.pnl_percent).toFixed(2), 
                            reason: t.exit_reason 
                        }}))
                    }};
                    
                    traces.push(entryMarkers, exitMarkers);
                }}
                
                const layout = {{
                    title: {{
                        text: `${{symbol}} - Candlestick Chart with Trade Signals (${{trades.length}} trades)`,
                        font: {{ size: 18, weight: 600 }}
                    }},
                    xaxis: {{ 
                        title: 'Time',
                        rangeslider: {{ visible: false }},
                        showgrid: true,
                        gridcolor: 'rgba(0,0,0,0.1)',
                        type: 'date',
                        fixedrange: false
                    }},
                    yaxis: {{ 
                        title: 'Price ($)',
                        domain: [0.3, 1],
                        showgrid: true,
                        gridcolor: 'rgba(0,0,0,0.1)',
                        fixedrange: false,
                        autorange: true
                    }},
                    yaxis2: {{
                        title: 'Volume',
                        domain: [0, 0.25],
                        showgrid: false,
                        fixedrange: false
                    }},
                    hovermode: 'closest',
                    showlegend: true,
                    legend: {{
                        orientation: 'h',
                        y: -0.15,
                        x: 0.5,
                        xanchor: 'center'
                    }},
                    dragmode: 'zoom',
                    margin: {{ t: 60, b: 80, l: 80, r: 40 }}
                }};
                
                const config = {{
                    responsive: true,
                    displayModeBar: true,
                    displaylogo: false,
                    modeBarButtonsToAdd: ['select2d', 'lasso2d'],
                    modeBarButtonsToRemove: ['pan2d']
                }};
                
                Plotly.newPlot('price-chart', traces, layout, config);
                
                // Add event listeners for chart interactions
                const chartDiv = document.getElementById('price-chart');
                
                // Filter trades table when chart is zoomed/panned
                chartDiv.on('plotly_relayout', function(eventData) {{
                    if (eventData['xaxis.range[0]'] && eventData['xaxis.range[1]']) {{
                        const startTime = new Date(eventData['xaxis.range[0]']);
                        const endTime = new Date(eventData['xaxis.range[1]']);
                        filterTradesByTimeRange(symbol, startTime, endTime);
                    }} else if (eventData['xaxis.autorange'] === true) {{
                        // Reset filter when auto-range is used
                        resetTradeFilter(symbol);
                    }}
                }});
                
                // Filter trades table when area is selected
                chartDiv.on('plotly_selected', function(eventData) {{
                    if (eventData && eventData.range && eventData.range.x) {{
                        const startTime = new Date(eventData.range.x[0]);
                        const endTime = new Date(eventData.range.x[1]);
                        filterTradesByTimeRange(symbol, startTime, endTime);
                    }}
                }});
                
            }} else {{
                // Fallback to equity curve with trade markers
                const equity = chartData.equity_curves[symbol];
                const trades = chartData.trades[symbol] || [];
                
                const equityTrace = {{
                    x: equity.timestamps,
                    y: equity.equity,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${{symbol}} Equity`,
                    line: {{ width: 3, color: '#667eea' }}
                }};
                
                const traces = [equityTrace];
                
                // Add trade markers if available
                if (trades.length > 0) {{
                    // Entry markers on equity curve
                    const entryMarkers = {{
                        x: trades.map(t => t.entry_time),
                        y: trades.map(t => getEquityAtTime(equity, t.entry_time)),
                        mode: 'markers',
                        marker: {{
                            color: trades.map(t => t.side === 'LONG' ? '#28a745' : '#dc3545'),
                            size: 10,
                            symbol: trades.map(t => t.side === 'LONG' ? 'triangle-up' : 'triangle-down'),
                            line: {{ color: 'white', width: 2 }}
                        }},
                        name: 'Entries',
                        hovertemplate: '<b>%{{text}} Entry</b><br>%{{x}}<br>Equity: $%{{y:.2f}}<extra></extra>',
                        text: trades.map(t => t.side)
                    }};
                    
                    // Exit markers on equity curve
                    const exitMarkers = {{
                        x: trades.map(t => t.exit_time),
                        y: trades.map(t => getEquityAtTime(equity, t.exit_time)),
                        mode: 'markers',
                        marker: {{
                            color: trades.map(t => parseFloat(t.pnl) >= 0 ? '#28a745' : '#dc3545'),
                            size: 8,
                            symbol: 'x',
                            line: {{ color: 'white', width: 2 }}
                        }},
                        name: 'Exits',
                        hovertemplate: '<b>Exit</b><br>%{{x}}<br>Equity: $%{{y:.2f}}<br>P&L: %{{customdata.pnl}}%<extra></extra>',
                        customdata: trades.map(t => ({{ pnl: parseFloat(t.pnl_percent).toFixed(2) }}))
                    }};
                    
                    traces.push(entryMarkers, exitMarkers);
                }}
                
                const layout = {{
                    title: {{
                        text: `${{symbol}} - Equity Curve with Trade Signals (${{trades.length}} trades)`,
                        font: {{ size: 18, weight: 600 }}
                    }},
                    xaxis: {{ 
                        title: 'Time',
                        type: 'date',
                        fixedrange: false
                    }},
                    yaxis: {{ 
                        title: 'Equity ($)',
                        fixedrange: false
                    }},
                    hovermode: 'closest',
                    showlegend: true,
                    margin: {{ t: 60, b: 60, l: 80, r: 40 }}
                }};
                
                Plotly.newPlot('price-chart', traces, layout, {{ responsive: true }});
                
                // Add zoom/pan filtering for equity curve too
                const chartDiv = document.getElementById('price-chart');
                chartDiv.on('plotly_relayout', function(eventData) {{
                    if (eventData['xaxis.range[0]'] && eventData['xaxis.range[1]']) {{
                        const startTime = new Date(eventData['xaxis.range[0]']);
                        const endTime = new Date(eventData['xaxis.range[1]']);
                        filterTradesByTimeRange(symbol, startTime, endTime);
                    }} else if (eventData['xaxis.autorange'] === true) {{
                        resetTradeFilter(symbol);
                    }}
                }});
            }}
        }}
        
        // Helper function to get equity value at specific time
        function getEquityAtTime(equity, targetTime) {{
            const targetDate = new Date(targetTime);
            let closestValue = equity.equity[0];
            let minDiff = Math.abs(new Date(equity.timestamps[0]) - targetDate);
            
            for (let i = 1; i < equity.timestamps.length; i++) {{
                const diff = Math.abs(new Date(equity.timestamps[i]) - targetDate);
                if (diff < minDiff) {{
                    minDiff = diff;
                    closestValue = equity.equity[i];
                }}
            }}
            
            return closestValue;
        }}
        
        // Filter trades by time range
        function filterTradesByTimeRange(symbol, startTime, endTime) {{
            const allTrades = chartData.trades[symbol] || [];
            
            const filteredTrades = allTrades.filter(trade => {{
                const entryTime = new Date(trade.entry_time);
                return entryTime >= startTime && entryTime <= endTime;
            }});
            
            // Update the trades grid with filtered data
            if (tradesGrid) {{
                tradesGrid.setRowData(filteredTrades);
                
                // Update the section title to show filter info
                const tradesSection = document.querySelector('.trades-section h2');
                if (tradesSection) {{
                    const startStr = startTime.toLocaleDateString();
                    const endStr = endTime.toLocaleDateString();
                    tradesSection.innerHTML = `📊 Trade Analysis - ${{symbol}} <small>(${{filteredTrades.length}} of ${{allTrades.length}} trades from ${{startStr}} to ${{endStr}})</small>`;
                }}
            }}
        }}
        
        // Reset trade filter
        function resetTradeFilter(symbol) {{
            const allTrades = chartData.trades[symbol] || [];
            
            if (tradesGrid) {{
                tradesGrid.setRowData(allTrades);
                
                // Reset the section title
                const tradesSection = document.querySelector('.trades-section h2');
                if (tradesSection) {{
                    tradesSection.innerHTML = `📊 Trade Analysis - ${{symbol}} <small>(${{allTrades.length}} trades total)</small>`;
                }}
            }}
        }}
        
        // Show trade analysis
        function showTradeAnalysis(symbol, tabElement) {{
            // Update tab states
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            tabElement.classList.add('active');
            
            // Update trades grid
            if (tradesGrid) {{
                tradesGrid.destroy();
            }}
            
            const allTrades = chartData.trades[symbol] || [];
            
            const gridOptions = {{
                columnDefs: tradeColumns,
                rowData: allTrades,
                defaultColDef: {{
                    sortable: true,
                    filter: true,
                    resizable: true
                }},
                enableRangeSelection: true,
                rowSelection: 'multiple',
                animateRows: true,
                pagination: true,
                paginationPageSize: 20,
                suppressPaginationPanel: false,
                suppressRowClickSelection: true
            }};
            
            tradesGrid = new agGrid.Grid(document.querySelector('#trades-grid'), gridOptions);
            
            // Update the section title with total count
            const tradesSection = document.querySelector('.trades-section h2');
            if (tradesSection) {{
                tradesSection.innerHTML = `📊 Trade Analysis - ${{symbol}} <small>(${{allTrades.length}} trades total)</small>`;
            }}
        }}
        
        // Support and Resistance Detection Function
        function detectSupportResistance(ohlcv, lookback = 20, minTouches = 2, tolerance = 0.002) {{
            const levels = [];
            const highs = ohlcv.high;
            const lows = ohlcv.low;
            const closes = ohlcv.close;
            const timestamps = ohlcv.timestamps;
            
            // Find pivot highs and lows
            const pivotHighs = [];
            const pivotLows = [];
            
            for (let i = lookback; i < highs.length - lookback; i++) {{
                let isHigh = true;
                let isLow = true;
                
                // Check if current point is a pivot high
                for (let j = i - lookback; j <= i + lookback; j++) {{
                    if (j !== i && highs[j] >= highs[i]) {{
                        isHigh = false;
                        break;
                    }}
                }}
                
                // Check if current point is a pivot low
                for (let j = i - lookback; j <= i + lookback; j++) {{
                    if (j !== i && lows[j] <= lows[i]) {{
                        isLow = false;
                        break;
                    }}
                }}
                
                if (isHigh) {{
                    pivotHighs.push({{ index: i, price: highs[i], time: timestamps[i] }});
                }}
                if (isLow) {{
                    pivotLows.push({{ index: i, price: lows[i], time: timestamps[i] }});
                }}
            }}
            
            // Group similar price levels (resistance)
            const resistanceLevels = groupSimilarLevels(pivotHighs, tolerance, minTouches);
            // Group similar price levels (support)
            const supportLevels = groupSimilarLevels(pivotLows, tolerance, minTouches);
            
            return {{
                support: supportLevels,
                resistance: resistanceLevels
            }};
        }}
        
        function groupSimilarLevels(pivots, tolerance, minTouches) {{
            const levels = [];
            const used = new Set();
            
            for (let i = 0; i < pivots.length; i++) {{
                if (used.has(i)) continue;
                
                const currentLevel = pivots[i];
                const similarPivots = [currentLevel];
                used.add(i);
                
                // Find similar price levels within tolerance
                for (let j = i + 1; j < pivots.length; j++) {{
                    if (used.has(j)) continue;
                    
                    const priceDiff = Math.abs(pivots[j].price - currentLevel.price) / currentLevel.price;
                    if (priceDiff <= tolerance) {{
                        similarPivots.push(pivots[j]);
                        used.add(j);
                    }}
                }}
                
                // Only include levels with minimum touches
                if (similarPivots.length >= minTouches) {{
                    const avgPrice = similarPivots.reduce((sum, p) => sum + p.price, 0) / similarPivots.length;
                    const firstTime = Math.min(...similarPivots.map(p => new Date(p.time).getTime()));
                    const lastTime = Math.max(...similarPivots.map(p => new Date(p.time).getTime()));
                    
                    levels.push({{
                        price: avgPrice,
                        touches: similarPivots.length,
                        firstTime: new Date(firstTime).toISOString(),
                        lastTime: new Date(lastTime).toISOString(),
                        strength: similarPivots.length
                    }});
                }}
            }}
            
            // Sort by strength (number of touches)
            return levels.sort((a, b) => b.strength - a.strength);
        }}
        
        function addSupportResistanceLines(traces, ohlcv, timestamps) {{
            const srLevels = detectSupportResistance(ohlcv);
            
            // Add support lines
            srLevels.support.forEach((level, index) => {{
                if (index < 5) {{ // Limit to top 5 support levels
                    traces.push({{
                        x: [timestamps[0], timestamps[timestamps.length - 1]],
                        y: [level.price, level.price],
                        mode: 'lines',
                        line: {{
                            color: 'rgba(34, 139, 34, 0.8)',
                            width: 2,
                            dash: 'solid'
                        }},
                        name: `Support ${{level.price.toFixed(4)}} ({{level.touches}} touches)`,
                        hovertemplate: '<b>Support Level</b><br>Price: $%{{y:.4f}}<br>Touches: {{level.touches}}<br>Strength: {{level.strength}}<extra></extra>',
                        showlegend: true
                    }});
                }}
            }});
            
            // Add resistance lines
            srLevels.resistance.forEach((level, index) => {{
                if (index < 5) {{ // Limit to top 5 resistance levels
                    traces.push({{
                        x: [timestamps[0], timestamps[timestamps.length - 1]],
                        y: [level.price, level.price],
                        mode: 'lines',
                        line: {{
                            color: 'rgba(220, 20, 60, 0.8)',
                            width: 2,
                            dash: 'solid'
                        }},
                        name: `Resistance ${{level.price.toFixed(4)}} ({{level.touches}} touches)`,
                        hovertemplate: '<b>Resistance Level</b><br>Price: $%{{y:.4f}}<br>Touches: {{level.touches}}<br>Strength: {{level.strength}}<extra></extra>',
                        showlegend: true
                    }});
                }}
            }});
            
            return traces;
        }}
        
        // Initialize everything when page loads
        document.addEventListener('DOMContentLoaded', function() {{
            initEquityChart();
            
            // Initialize first symbol analysis
            if (chartData.symbols.length > 0) {{
                const firstSymbol = chartData.symbols[0];
                showSymbolAnalysis(firstSymbol, document.querySelector('.tab'));
                showTradeAnalysis(firstSymbol, document.querySelectorAll('.tab')[chartData.symbols.length]);
            }}
        }});
    </script>
</body>
</html>
"""
    
    # Write HTML file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    console.print(f"[green]✅ Enhanced full-width HTML report generated: {output_file}[/green]")
    console.print("[cyan]📊 Features:[/cyan]")
    console.print("  • Full-width responsive layout")  
    console.print("  • Candlestick charts with volume")
    console.print("  • Enhanced trade analysis tables")
    console.print("  • Modern UI with improved UX")
    
    return output_file 