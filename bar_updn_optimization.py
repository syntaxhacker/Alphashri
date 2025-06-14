#!/usr/bin/env python3
"""
BarUpDn Strategy Parameter Optimization and Visualization
"""

import itertools
import json
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import pandas as pd
import numpy as np
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel
from pathlib import Path
import concurrent.futures
from dataclasses import asdict

from bar_updn_extreme_backtest import (
    BarUpDnStrategy, BarUpDnBacktester, DataFetcher, 
    BacktestResult, TradeResult, run_extreme_backtest
)
from enhanced_data_fetcher import EnhancedDataFetcher
from enhanced_html_generator import generate_enhanced_html_report

console = Console()

class ParameterOptimizer:
    """Parameter optimization for BarUpDn strategy"""
    
    def __init__(self, symbols: List[str], days_back: int = 14, 
                 api_key: str = None, api_secret: str = None):
        self.symbols = symbols
        self.days_back = days_back
        self.api_key = api_key
        self.api_secret = api_secret
        self.fetcher = EnhancedDataFetcher(api_key, api_secret)
        
        # Pre-fetch data for all symbols using enhanced caching
        self.data_cache = {}
        self._fetch_all_data()
    
    def _fetch_all_data(self):
        """Pre-fetch data for all symbols using enhanced caching"""
        console.print("[cyan]📊 Pre-fetching data with intelligent caching...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.days_back)
        
        # Show cache statistics first
        self.fetcher.get_cache_summary()
        
        for symbol in self.symbols:
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date)
                self.data_cache[symbol] = df
            except Exception as e:
                console.print(f"[red]✗ Failed to fetch {symbol}: {str(e)}[/red]")
                self.data_cache[symbol] = None
    
    def optimize_parameters(self, 
                          sl_range: List[float] = [2.0, 3.5, 5.0],
                          trailing_range: List[float] = [0.5, 1.0, 1.5],  # Now percentages
                          position_range: List[float] = [5.0, 10.0, 15.0],
                          loss_limit_range: List[float] = [1.5, 2.0, 2.5]) -> Dict:
        """
        Optimize strategy parameters across all combinations
        """
        
        # Generate parameter combinations
        param_combinations = list(itertools.product(
            sl_range, trailing_range, position_range, loss_limit_range
        ))
        
        console.print(f"[bold cyan]Testing {len(param_combinations)} parameter combinations across {len(self.symbols)} symbols...[/bold cyan]")
        
        all_results = []
        best_overall = None
        best_overall_score = -float('inf')
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
        ) as progress:
            
            task = progress.add_task("Optimizing parameters...", total=len(param_combinations))
            
            for sl, trailing, position, loss_limit in param_combinations:
                combo_results = []
                
                # Test this parameter combination on all symbols
                for symbol in self.symbols:
                    if self.data_cache[symbol] is None:
                        continue
                    
                    try:
                        # Create strategy with these parameters
                        strategy = BarUpDnStrategy(
                            sl_percent=sl,
                            trailing_stop_percent=trailing,  # Now percentage
                            position_size_percent=position,
                            max_intraday_loss_percent=loss_limit,
                            min_hold_minutes=15  # Add minimum hold time
                        )
                        
                        # Run backtest
                        backtester = BarUpDnBacktester(initial_capital=10000)
                        backtester.strategy = strategy
                        result = backtester.run_backtest(self.data_cache[symbol], symbol, show_progress=False)
                        
                        # Store raw OHLCV data for candlestick charts
                        result.raw_data = self.data_cache[symbol].copy()
                        
                        # Add parameter info to result
                        result.parameters = {
                            'sl_percent': sl,
                            'trailing_stop_percent': trailing,  # Updated parameter name
                            'position_size_percent': position,
                            'max_intraday_loss_percent': loss_limit
                        }
                        
                        combo_results.append(result)
                        
                    except Exception as e:
                        console.print(f"[red]Error testing {symbol} with params {sl}/{trailing}/{position}/{loss_limit}: {str(e)}[/red]")
                
                # Calculate combined score for this parameter combination
                if combo_results:
                    avg_return = np.mean([r.total_return_percent for r in combo_results])
                    avg_sharpe = np.mean([r.sharpe_ratio for r in combo_results if not np.isnan(r.sharpe_ratio)])
                    avg_win_rate = np.mean([r.win_rate for r in combo_results])
                    avg_drawdown = np.mean([r.max_drawdown for r in combo_results])
                    
                    # Combined score (return * sharpe * win_rate / drawdown)
                    combined_score = (avg_return * (1 + avg_sharpe) * avg_win_rate) / max(avg_drawdown, 1)
                    
                    combo_data = {
                        'parameters': {
                            'sl_percent': sl,
                            'trailing_stop_percent': trailing,  # Updated parameter name
                            'position_size_percent': position,
                            'max_intraday_loss_percent': loss_limit
                        },
                        'results': combo_results,
                        'metrics': {
                            'avg_return_percent': avg_return,
                            'avg_sharpe_ratio': avg_sharpe,
                            'avg_win_rate': avg_win_rate,
                            'avg_drawdown': avg_drawdown,
                            'combined_score': combined_score,
                            'total_trades': sum([r.total_trades for r in combo_results])
                        }
                    }
                    
                    all_results.append(combo_data)
                    
                    # Track best overall
                    if combined_score > best_overall_score:
                        best_overall_score = combined_score
                        best_overall = combo_data
                
                progress.update(task, advance=1)
        
        # Sort results by combined score
        all_results.sort(key=lambda x: x['metrics']['combined_score'], reverse=True)
        
        return {
            'all_results': all_results,
            'best_parameters': best_overall,
            'optimization_summary': {
                'total_combinations_tested': len(param_combinations),
                'symbols_tested': self.symbols,
                'date_range': f"{datetime.now() - timedelta(days=self.days_back)} to {datetime.now()}",
                'best_score': best_overall_score
            }
        }

def display_optimization_results(optimization_results: Dict):
    """Display optimization results in a nice table"""
    
    best = optimization_results['best_parameters']
    all_results = optimization_results['all_results']
    
    # Best parameters table
    console.print(Panel.fit(
        f"[bold green]🏆 BEST PARAMETERS FOUND[/bold green]\n\n"
        f"Stop Loss: {best['parameters']['sl_percent']}%\n"
        f"Trailing Stop: {best['parameters']['trailing_stop_percent']}%\n"
        f"Position Size: {best['parameters']['position_size_percent']}%\n"
        f"Max Daily Loss: {best['parameters']['max_intraday_loss_percent']}%\n\n"
        f"[cyan]Performance:[/cyan]\n"
        f"Avg Return: {best['metrics']['avg_return_percent']:.2f}%\n"
        f"Avg Win Rate: {best['metrics']['avg_win_rate']:.1f}%\n"
        f"Avg Sharpe: {best['metrics']['avg_sharpe_ratio']:.2f}\n"
        f"Combined Score: {best['metrics']['combined_score']:.2f}",
        border_style="green"
    ))
    
    # Top 10 results table
    table = Table(title="Top 10 Parameter Combinations")
    table.add_column("Rank", style="cyan")
    table.add_column("SL%", style="yellow")
    table.add_column("Trail", style="yellow")
    table.add_column("Pos%", style="yellow")
    table.add_column("DayLoss%", style="yellow")
    table.add_column("Avg Return%", style="green")
    table.add_column("Win Rate%", style="green")
    table.add_column("Sharpe", style="green")
    table.add_column("Score", style="bold green")
    
    for i, result in enumerate(all_results[:10], 1):
        params = result['parameters']
        metrics = result['metrics']
        
        table.add_row(
            str(i),
            f"{params['sl_percent']:.1f}",
            f"{params['trailing_stop_percent']:.1f}",  # Updated parameter name
            f"{params['position_size_percent']:.1f}",
            f"{params['max_intraday_loss_percent']:.1f}",
            f"{metrics['avg_return_percent']:.2f}",
            f"{metrics['avg_win_rate']:.1f}",
            f"{metrics['avg_sharpe_ratio']:.2f}",
            f"{metrics['combined_score']:.2f}"
        )
    
    console.print(table)

def generate_comprehensive_html_chart(optimization_results: Dict, output_file: str = "bar_updn_analysis.html"):
    """
    Generate a comprehensive HTML chart with ag-Grid for performance and combined trade view
    """
    
    console.print("[cyan]Generating comprehensive HTML visualization with ag-Grid...[/cyan]")
    
    # Get best results for visualization
    best_params = optimization_results['best_parameters']
    best_results = best_params['results']
    
    # Prepare data for charts
    chart_data = {
        'symbols': [],
        'equity_curves': {},
        'trades': {},
        'parameters': best_params['parameters'],
        'summary': best_params['metrics']
    }
    
    def format_trades_for_table(trades_list):
        """Format trades for TradingView-style table"""
        if not trades_list:
            return []
        
        formatted_trades = []
        for i, trade in enumerate(trades_list, 1):
            # Calculate duration
            entry_time = pd.to_datetime(trade['entry_time'])
            exit_time = pd.to_datetime(trade['exit_time'])
            duration = exit_time - entry_time
            
            # Format duration nicely
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
    
    for result in best_results:
        symbol = result.symbol
        chart_data['symbols'].append(symbol)
        
        # Equity curve data
        equity_df = result.equity_curve.reset_index()
        chart_data['equity_curves'][symbol] = {
            'timestamps': equity_df['timestamp'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist(),
            'equity': equity_df['equity'].tolist(),
            'initial_capital': result.initial_capital,
            'final_capital': result.final_capital,
            'return_percent': result.total_return_percent
        }
        
        # Trades data (individual)
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
        
        chart_data['trades'][symbol] = format_trades_for_table(trades_data)
    
    # Generate HTML with ag-Grid
    html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BarUpDn Strategy Analysis - Enhanced Performance</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/dist/ag-grid-community.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-grid.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-theme-alpine.css">
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
        }}
        .container {{
            max-width: 1600px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }}
        .header {{
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 10px;
        }}
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }}
        .metric-card {{
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            border-left: 4px solid #667eea;
        }}
        .metric-value {{
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
        }}
        .metric-label {{
            font-size: 14px;
            color: #666;
            margin-top: 5px;
        }}
        .chart-container {{
            margin: 30px 0;
            background: #fafafa;
            padding: 20px;
            border-radius: 10px;
        }}
        .symbol-tabs {{
            display: flex;
            margin-bottom: 20px;
            border-bottom: 2px solid #eee;
        }}
        .tab {{
            padding: 10px 20px;
            cursor: pointer;
            border: none;
            background: none;
            font-size: 16px;
            color: #666;
            border-bottom: 3px solid transparent;
            transition: all 0.3s;
        }}
        .tab.active {{
            color: #667eea;
            border-bottom-color: #667eea;
            font-weight: bold;
        }}
        .tab:hover {{
            color: #667eea;
            background: #f0f0f0;
        }}
        .ag-theme-alpine {{
            height: 400px;
            width: 100%;
        }}
        .positive {{ color: #28a745; font-weight: bold; }}
        .negative {{ color: #dc3545; font-weight: bold; }}
        .long {{ color: #28a745; }}
        .short {{ color: #dc3545; }}

        .trade-details {{
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 BarUpDn Strategy - Enhanced Analysis</h1>
            <p>Optimized Parameters & High-Performance Visualization</p>
            <p><small>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</small></p>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value">{best_params['parameters']['sl_percent']}%</div>
                <div class="metric-label">Stop Loss</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{best_params['parameters']['trailing_stop_percent']:.1f}%</div>
                <div class="metric-label">Trailing Stop %</div>
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
                <div class="metric-label">Average Win Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{best_params['metrics']['avg_sharpe_ratio']:.2f}</div>
                <div class="metric-label">Average Sharpe</div>
            </div>
        </div>

        <div class="chart-container">
            <h2>📈 Equity Curves Comparison</h2>
            <div id="equity-chart" style="height: 500px;"></div>
        </div>

        <div class="chart-container">
            <h2>📊 Individual Symbol Analysis</h2>
            <div class="symbol-tabs">
                {' '.join([f'<button class="tab" onclick="showSymbol(\'{symbol}\', this)">{symbol}</button>' for symbol in chart_data['symbols']])}
            </div>
            
            <div id="symbol-content">
                <!-- Will be populated by JavaScript -->
            </div>
        </div>
    </div>

    <script>
        const chartData = {json.dumps(chart_data, indent=2)};
        let currentSymbol = '';
        
        // ag-Grid column definitions for TradingView-style trades
        const tradeColumns = [
            {{ field: 'trade_number', headerName: '#', width: 60, 
               cellStyle: {{ textAlign: 'center', fontWeight: 'bold' }} }},
            {{ field: 'entry_time', headerName: 'Entry Time', width: 160, 
               cellRenderer: params => new Date(params.value).toLocaleString() }},
            {{ field: 'exit_time', headerName: 'Exit Time', width: 160,
               cellRenderer: params => new Date(params.value).toLocaleString() }},
            {{ field: 'side', headerName: 'Side', width: 80,
               cellStyle: params => params.value === 'LONG' ? {{color: '#28a745', fontWeight: 'bold'}} : {{color: '#dc3545', fontWeight: 'bold'}} }},
            {{ field: 'entry_price', headerName: 'Entry Price', width: 120,
               cellRenderer: params => '$' + params.value.toFixed(4) }},
            {{ field: 'exit_price', headerName: 'Exit Price', width: 120,
               cellRenderer: params => '$' + params.value.toFixed(4) }},
            {{ field: 'pnl', headerName: 'P&L', width: 100,
               cellRenderer: params => {{
                   const value = params.value;
                   const color = value >= 0 ? '#28a745' : '#dc3545';
                   return `<span style="color: ${{color}}; font-weight: bold;">$${{value.toFixed(2)}}</span>`;
               }} }},
            {{ field: 'pnl_percent', headerName: 'P&L %', width: 90,
               cellRenderer: params => {{
                   const value = params.value;
                   const color = value >= 0 ? '#28a745' : '#dc3545';
                   return `<span style="color: ${{color}}; font-weight: bold;">${{value.toFixed(2)}}%</span>`;
               }} }},
            {{ field: 'duration', headerName: 'Duration', width: 100,
               cellStyle: {{ textAlign: 'center' }} }},
            {{ field: 'exit_reason', headerName: 'Exit Reason', width: 140 }}
        ];
        
        let tradesGrid = null;
        
        // Draw main equity curves comparison
        function drawEquityCurves() {{
            const traces = [];
            
            chartData.symbols.forEach(symbol => {{
                const data = chartData.equity_curves[symbol];
                traces.push({{
                    x: data.timestamps,
                    y: data.equity,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${{symbol}} (${{data.return_percent.toFixed(2)}}%)`,
                    line: {{ width: 2 }}
                }});
            }});
            
            const layout = {{
                title: 'Equity Curves - All Symbols',
                xaxis: {{ title: 'Time' }},
                yaxis: {{ title: 'Equity ($)' }},
                hovermode: 'x unified',
                showlegend: true,
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: {{ family: 'Segoe UI, sans-serif' }}
            }};
            
            Plotly.newPlot('equity-chart', traces, layout, {{responsive: true}});
        }}
        
        // Update trades grid
        function updateTradesGrid(symbol) {{
            const gridDiv = document.getElementById('trades-grid');
            const rowData = chartData.trades[symbol];
            
            if (tradesGrid) {{
                tradesGrid.destroy();
            }}
            
            const gridOptions = {{
                columnDefs: tradeColumns,
                rowData: rowData,
                defaultColDef: {{
                    sortable: true,
                    filter: true,
                    resizable: true
                }},
                pagination: false,
                enableRangeSelection: true,
                animateRows: true,
                rowHeight: 40
            }};
            
            tradesGrid = agGrid.createGrid(gridDiv, gridOptions);
        }}
        
        // Show individual symbol analysis
        function showSymbol(symbol, targetElement = null) {{
            currentSymbol = symbol;
            
            // Update active tab
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            if (targetElement && targetElement.classList) {{
                targetElement.classList.add('active');
            }} else if (typeof event !== 'undefined' && event.target && event.target.classList) {{
                event.target.classList.add('active');
            }} else {{
                // Find the tab for this symbol and activate it
                const tabs = document.querySelectorAll('.tab');
                tabs.forEach(tab => {{
                    if (tab.textContent.trim() === symbol) {{
                        tab.classList.add('active');
                    }}
                }});
            }}
            
            const equityData = chartData.equity_curves[symbol];
            const tradesData = chartData.trades[symbol];
            
            // Create symbol-specific chart
            const trace = {{
                x: equityData.timestamps,
                y: equityData.equity,
                type: 'scatter',
                mode: 'lines',
                name: 'Equity',
                line: {{ color: '#667eea', width: 3 }}
            }};
            
            // Helper function to find closest equity value for a timestamp
            function getEquityAtTime(timestamp) {{
                const idx = equityData.timestamps.findIndex(t => t >= timestamp);
                return idx >= 0 ? equityData.equity[idx] : equityData.equity[equityData.equity.length - 1];
            }}
            
            // Add entry markers
            const entryMarkers = {{
                x: tradesData.map(t => t.entry_time),
                y: tradesData.map(t => getEquityAtTime(t.entry_time)),
                mode: 'markers',
                marker: {{
                    color: tradesData.map(t => t.side === 'LONG' ? '#28a745' : '#dc3545'),
                    size: 16,
                    symbol: tradesData.map(t => t.side === 'LONG' ? 'triangle-up' : 'triangle-down'),
                    line: {{ color: 'white', width: 2 }}
                }},
                name: 'Entries',
                hovertemplate: '<b>Entry</b><br>%{{x}}<br>Side: %{{customdata.side}}<br>Price: $%{{customdata.price}}<extra></extra>',
                customdata: tradesData.map(t => ({{ side: t.side, price: t.entry_price }}))
            }};
            
            // Add exit markers
            const exitMarkers = {{
                x: tradesData.map(t => t.exit_time),
                y: tradesData.map(t => getEquityAtTime(t.exit_time)),
                mode: 'markers',
                marker: {{
                    color: tradesData.map(t => t.pnl >= 0 ? '#28a745' : '#dc3545'),
                    size: 12,
                    symbol: 'x',
                    line: {{ color: 'white', width: 2 }}
                }},
                name: 'Exits',
                hovertemplate: '<b>Exit</b><br>%{{x}}<br>P&L: %{{customdata.pnl}}%<br>Price: $%{{customdata.price}}<br>Reason: %{{customdata.reason}}<extra></extra>',
                customdata: tradesData.map(t => ({{ 
                    pnl: t.pnl_percent.toFixed(2), 
                    price: t.exit_price, 
                    reason: t.exit_reason 
                }}))
            }};
            
            const layout = {{
                title: `${{symbol}} - Equity Curve & Trade Signals`,
                xaxis: {{ title: 'Time' }},
                yaxis: {{ title: 'Equity ($)' }},
                showlegend: true,
                height: 450,
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)'
            }};
            
            // Create content HTML
            const contentHTML = `
                <div style="margin-top: 20px;">
                    <div id="symbol-chart-${{symbol}}" style="height: 450px;"></div>
                    <div style="margin: 20px 0;">
                        <h3>📋 Trade History for ${{symbol}} (${{chartData.trades[symbol].length}} trades)</h3>
                    </div>
                    <div id="trades-grid" class="ag-theme-alpine"></div>
                </div>
            `;
            
            document.getElementById('symbol-content').innerHTML = contentHTML;
            
            // Draw the chart with both entry and exit markers
            Plotly.newPlot(`symbol-chart-${{symbol}}`, [trace, entryMarkers, exitMarkers], layout, {{responsive: true}});
            
            // Initialize trades grid
            updateTradesGrid(symbol);
        }}
        
        // Initialize
        window.onload = function() {{
            drawEquityCurves();
            if (chartData.symbols.length > 0) {{
                document.querySelector('.tab').classList.add('active');
                showSymbol(chartData.symbols[0]);
            }}
        }};
    </script>
</body>
</html>
"""
    
    # Save HTML file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    console.print(f"[green]✓ Enhanced HTML chart with ag-Grid saved to {output_file}[/green]")
    console.print(f"[yellow]📊 Features: ag-Grid performance, combined trade view, no duplicate positions[/yellow]")

def run_complete_optimization(symbols: List[str] = ["BTCUSDT", "ETHUSDT"], 
                             api_key: str = None, api_secret: str = None,
                             days_back: int = 14):
    """Run complete optimization and generate visualization"""
    
    console.print(Panel.fit(
        f"[bold cyan]🔍 BarUpDn Strategy Complete Optimization[/bold cyan]\n"
        f"Symbols: {', '.join(symbols)}\n"
        f"Days Back: {days_back}\n"
        f"Analysis: Parameter optimization + Comprehensive visualization",
        border_style="cyan"
    ))
    
    # Initialize optimizer
    optimizer = ParameterOptimizer(symbols, days_back, api_key, api_secret)
    
    # Run optimization
    console.print("\n[bold yellow]🚀 Starting Parameter Optimization...[/bold yellow]")
    results = optimizer.optimize_parameters()
    
    # Display results
    console.print("\n[bold green]📊 Optimization Complete![/bold green]")
    display_optimization_results(results)
    
    # Generate enhanced HTML visualization
    console.print("\n[bold cyan]🎨 Generating Enhanced Full-Width Visualization...[/bold cyan]")
    generate_enhanced_html_report(results)
    
    # Save optimization results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"optimization_results_{timestamp}.json"
    
    # Convert results to JSON-serializable format
    def serialize_for_json(obj):
        """Custom serialization function for complex objects"""
        if hasattr(obj, 'isoformat'):  # datetime objects
            return obj.isoformat()
        elif hasattr(obj, 'to_dict'):  # pandas objects
            return obj.to_dict()
        elif isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        else:
            return str(obj)
    
    json_results = results.copy()
    for combo in json_results['all_results']:
        # Convert BacktestResult objects to dictionaries
        serialized_results = []
        for result in combo['results']:
            # Convert the result to a serializable format
            result_dict = {
                'symbol': result.symbol,
                'start_date': result.start_date.isoformat() if hasattr(result.start_date, 'isoformat') else str(result.start_date),
                'end_date': result.end_date.isoformat() if hasattr(result.end_date, 'isoformat') else str(result.end_date),
                'initial_capital': float(result.initial_capital),
                'final_capital': float(result.final_capital),
                'total_return': float(result.total_return),
                'total_return_percent': float(result.total_return_percent),
                'total_trades': int(result.total_trades),
                'winning_trades': int(result.winning_trades),
                'losing_trades': int(result.losing_trades),
                'win_rate': float(result.win_rate),
                'avg_win': float(result.avg_win),
                'avg_loss': float(result.avg_loss),
                'max_drawdown': float(result.max_drawdown),
                'max_drawdown_percent': float(result.max_drawdown_percent),
                'sharpe_ratio': float(result.sharpe_ratio) if not np.isnan(result.sharpe_ratio) else None,
                'trades': [
                    {
                        'entry_time': trade.entry_time.isoformat(),
                        'exit_time': trade.exit_time.isoformat(),
                        'entry_price': float(trade.entry_price),
                        'exit_price': float(trade.exit_price),
                        'side': str(trade.side),
                        'quantity': float(trade.quantity),
                        'pnl': float(trade.pnl),
                        'pnl_percent': float(trade.pnl_percent),
                        'stop_loss': float(trade.stop_loss),
                        'exit_reason': str(trade.exit_reason)
                    }
                    for trade in result.trades
                ],
                # Convert equity curve to simple format
                'equity_curve': {
                    'timestamps': [ts.isoformat() if hasattr(ts, 'isoformat') else str(ts) 
                                 for ts in result.equity_curve.index],
                    'equity': [float(val) for val in result.equity_curve['equity']],
                    'position': [str(val) for val in result.equity_curve['position']]
                },
                # Convert daily returns
                'daily_returns': {
                    str(k): float(v) if not np.isnan(v) else None 
                    for k, v in result.daily_returns.items()
                }
            }
            
            # Add parameters if they exist
            if hasattr(result, 'parameters'):
                result_dict['parameters'] = result.parameters
                
            serialized_results.append(result_dict)
        
        combo['results'] = serialized_results
    
    with open(results_file, 'w') as f:
        json.dump(json_results, f, indent=2, default=serialize_for_json)
    
    console.print(f"[green]✓ Optimization results saved to {results_file}[/green]")
    
    return results

if __name__ == "__main__":
    # Run with Binance API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    symbols = ["BTCUSDT", "ETHUSDT"]
    
    results = run_complete_optimization(
        symbols=symbols,
        api_key=API_KEY,
        api_secret=API_SECRET,
        days_back=7  # Start with shorter period for testing
    )