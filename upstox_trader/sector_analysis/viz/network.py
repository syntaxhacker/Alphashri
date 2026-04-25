import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import networkx as nx
import json
import tempfile
import webbrowser
from datetime import datetime
from typing import Dict, List

from rich.console import Console
from rich.panel import Panel

from .formatting import (
    console,
    NETWORK_COLORS,
    get_network_node_color,
    get_edge_color,
)


class NetworkMixin:
    def create_sector_network_graph(self, correlation_matrix: pd.DataFrame, filename: str = None):
        if filename is None:
            filename = f"visualizations/sector_network_graph_{datetime.now().strftime('%Y%m%d_%H%M')}.png"

        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(18, 14))

        sectors = correlation_matrix.columns.tolist()
        significant_corr = correlation_matrix.where(np.abs(correlation_matrix) >= 0.3)

        pos = nx.spring_layout(nx.from_pandas_adjacency(significant_corr.fillna(0)),
                              k=2, iterations=50, seed=42)

        node_sizes = []
        node_colors = []

        for sector in sectors:
            connections = significant_corr[sector].count()
            node_sizes.append(800 + connections * 200)

            avg_corr = significant_corr[sector].mean()
            node_colors.append(get_network_node_color(avg_corr))

        nx.draw_networkx_nodes(nx.from_pandas_adjacency(significant_corr.fillna(0)),
                              pos, node_size=node_sizes, node_color=node_colors,
                              alpha=0.8, ax=ax)

        edges = []
        edge_colors = []
        edge_widths = []

        for i, sector1 in enumerate(sectors):
            for j, sector2 in enumerate(sectors):
                if i < j and pd.notna(significant_corr.loc[sector1, sector2]):
                    corr_val = significant_corr.loc[sector1, sector2]
                    edges.append((sector1, sector2))
                    edge_colors.append(get_edge_color(corr_val))
                    edge_widths.append(abs(corr_val) * 3)

        nx.draw_networkx_edges(nx.from_pandas_adjacency(significant_corr.fillna(0)),
                              pos, edgelist=edges, edge_color=edge_colors,
                              width=edge_widths, alpha=0.6, ax=ax)

        nx.draw_networkx_labels(nx.from_pandas_adjacency(significant_corr.fillna(0)),
                               pos, font_size=9, font_weight='bold',
                               font_color='white', ax=ax)

        ax.set_title('🔗 Sector Correlation Network Graph\n(Node size = Connectivity, Line thickness = Correlation strength)',
                    fontsize=16, fontweight='bold', pad=20)
        ax.axis('off')

        legend_elements = [
            plt.Line2D([0], [0], color=NETWORK_COLORS['positive'], lw=3, label='Positive Correlation'),
            plt.Line2D([0], [0], color=NETWORK_COLORS['negative'], lw=3, label='Negative Correlation'),
            plt.scatter([0], [0], s=100, color=NETWORK_COLORS['neutral'], label='Neutral Sector')
        ]
        ax.legend(handles=legend_elements, loc='upper right', bbox_to_anchor=(1.0, 1.0))

        plt.tight_layout()
        plt.savefig(filename, dpi=300, bbox_inches='tight', facecolor='#2d2d2d')
        plt.close()

        console.print(f"[green]✅ Sector network graph saved: {filename}[/green]")
        return filename

    def create_stock_network_html(self, sector: str, sector_correlations: Dict) -> str:
        if sector not in sector_correlations:
            return "<p>No correlation data available for this sector</p>"

        corr_matrix = sector_correlations[sector]
        stocks = list(corr_matrix.index)

        nodes = []
        links = []

        for stock in stocks:
            nodes.append({
                'id': stock,
                'name': stock,
                'symbolSize': 30,
                'itemStyle': {'color': NETWORK_COLORS['neutral']}
            })

        for i, stock1 in enumerate(stocks):
            for j, stock2 in enumerate(stocks[i+1:], i+1):
                corr = corr_matrix.loc[stock1, stock2]
                if abs(corr) >= 0.5:
                    links.append({
                        'source': stock1,
                        'target': stock2,
                        'value': abs(corr),
                        'lineStyle': {
                            'color': get_edge_color(corr),
                            'width': abs(corr) * 4
                        }
                    })

        html = f"""
        <div id="stock-network-{sector.replace(' ', '-')}" style="height: 400px;"></div>
        <script>
            var stockChart = echarts.init(document.getElementById('stock-network-{sector.replace(' ', '-')}'));
            stockChart.setOption({{
                title: {{ text: '{sector} - Stock Correlations', left: 'center' }},
                series: [{{
                    type: 'graph',
                    layout: 'force',
                    data: {json.dumps(nodes)},
                    links: {json.dumps(links)},
                    roam: true,
                    label: {{ show: true, position: 'inside' }},
                    force: {{ repulsion: 500 }}
                }}]
            }});
        </script>
        """
        return html

    def generate_echarts_html(self, correlation_matrix: pd.DataFrame,
                             sector_stocks: Dict[str, List[Dict]],
                             predictions: Dict[str, Dict] = None,
                             lookback_days: int = 365) -> str:

        sector_correlations = {}

        network_nodes = []
        network_links = []

        sectors = list(correlation_matrix.index)
        for i, sector in enumerate(sectors):
            sector_market_cap = sum(stock.get('market_cap', 0) for stock in sector_stocks.get(sector, []))
            node_size = max(20, min(100, sector_market_cap / 1e11))

            node_color = NETWORK_COLORS['neutral']
            if predictions and sector in predictions:
                move = predictions[sector]['predicted_movement']
                if move > 0:
                    node_color = NETWORK_COLORS['positive']
                elif move < 0:
                    node_color = NETWORK_COLORS['negative']

            network_nodes.append({
                'id': sector,
                'name': sector,
                'symbolSize': node_size,
                'itemStyle': {'color': node_color},
                'category': 0
            })

        for i, sector1 in enumerate(sectors):
            for j, sector2 in enumerate(sectors[i+1:], i+1):
                corr = correlation_matrix.loc[sector1, sector2]
                if abs(corr) >= 0.3:
                    network_links.append({
                        'source': sector1,
                        'target': sector2,
                        'value': abs(corr),
                        'lineStyle': {
                            'color': NETWORK_COLORS['positive'] if corr > 0 else NETWORK_COLORS['negative'],
                            'width': abs(corr) * 5,
                            'opacity': abs(corr) * 0.8
                        }
                    })

        heatmap_data = []
        for i, sector1 in enumerate(sectors):
            for j, sector2 in enumerate(sectors):
                corr = correlation_matrix.loc[sector1, sector2]
                heatmap_data.append([j, i, round(corr, 3)])

        stock_networks = {}
        for sector in sectors:
            if sector in sector_stocks and sector in sector_correlations:
                stocks = sector_stocks[sector][:8]
                stock_nodes = []
                stock_links = []
                corr_matrix = sector_correlations[sector]

                for stock in stocks:
                    symbol = stock['symbol']
                    stock_nodes.append({
                        'id': symbol,
                        'name': symbol,
                        'symbolSize': max(15, min(40, stock.get('market_cap', 0) / 1e10)),
                        'itemStyle': {'color': '#64b5f6'},
                        'label': {'show': True, 'fontSize': 8},
                        'tooltip': {
                            'formatter': f"{symbol}<br/>Price: ₹{stock.get('close', 0):.1f}<br/>Market Cap: ₹{stock.get('market_cap', 0)/1e9:.1f}B"
                        }
                    })

                stock_symbols = [s['symbol'] for s in stocks]
                for i, stock1 in enumerate(stock_symbols):
                    for j, stock2 in enumerate(stock_symbols[i+1:], i+1):
                        if stock1 in corr_matrix.index and stock2 in corr_matrix.columns:
                            try:
                                corr = corr_matrix.loc[stock1, stock2]
                                if pd.notna(corr) and abs(corr) >= 0.3:
                                    stock_links.append({
                                        'source': stock1,
                                        'target': stock2,
                                        'value': abs(corr),
                                        'lineStyle': {
                                            'color': '#81c784' if corr > 0 else '#e57373',
                                            'width': abs(corr) * 4,
                                            'opacity': 0.7
                                        }
                                    })
                            except (KeyError, IndexError):
                                continue

                stock_networks[sector] = {'nodes': stock_nodes, 'links': stock_links}

        css_styles = """
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: #1a1a1a;
            color: #e0e0e0;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            color: #ffffff;
        }
        .chart-container {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
        }
        .chart {
            background: #2d2d2d;
            border-radius: 12px;
            box-shadow: 0 8px 16px rgba(0,0,0,0.3);
            border: 1px solid #404040;
        }
        .chart-large { width: 100%; height: 650px; }
        .chart-medium { width: 48%; height: 500px; }
        .chart-small { width: 100%; height: 500px; min-height: 500px; }
        .stats {
            background: #2d2d2d;
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 20px;
            border: 1px solid #404040;
        }
        .stats h3 {
            margin-top: 0;
            color: #64b5f6;
            font-size: 1.4em;
        }
        .legend {
            margin: 20px 0;
            text-align: center;
            background: #2d2d2d;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #404040;
        }
        .legend span {
            margin: 0 20px;
            font-weight: bold;
            font-size: 1.1em;
        }
        .positive { color: #81c784; }
        .negative { color: #e57373; }
        .neutral { color: #64b5f6; }
        .stock-panel {
            background: #2d2d2d;
            border-radius: 12px;
            border: 1px solid #404040;
            margin-top: 20px;
            padding: 20px;
        }
        .stock-title {
            color: #64b5f6;
            font-size: 1.3em;
            margin-bottom: 15px;
        }
        .back-btn {
            background: #64b5f6;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            margin-bottom: 15px;
            font-size: 14px;
        }
        .back-btn:hover {
            background: #42a5f5;
        }
        h1 { color: #64b5f6; }
        h2 { color: #81c784; }
        p { color: #b0b0b0; }
        .controls-panel {
            background: #2d2d2d;
            border-radius: 8px;
            border: 1px solid #404040;
            padding: 15px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 20px;
            flex-wrap: wrap;
        }
        .control-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .control-group label {
            color: #e0e0e0;
            font-size: 14px;
            white-space: nowrap;
        }
        .control-slider {
            width: 120px;
            height: 6px;
            background: #404040;
            border-radius: 3px;
            outline: none;
            -webkit-appearance: none;
        }
        .control-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            background: #64b5f6;
            border-radius: 50%;
            cursor: pointer;
        }
        .control-slider::-moz-range-thumb {
            width: 16px;
            height: 16px;
            background: #64b5f6;
            border-radius: 50%;
            cursor: pointer;
            border: none;
        }
        .control-value {
            color: #64b5f6;
            font-weight: bold;
            min-width: 40px;
            text-align: right;
        }
        """

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Sector Correlation Analysis Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        {css_styles}
    </style>
</head>
<body>
    <div class="header">
        <h1>🌐 Sector Correlation Analysis Dashboard</h1>
        <p>Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Click on sectors to explore stocks</p>
    </div>

    <div class="stats">
        <h3>📊 Analysis Summary</h3>
        <p><strong>Total Sectors:</strong> {len(sectors)}</p>
        <p><strong>Total Correlations:</strong> {len(network_links)} significant (|r| ≥ 0.3)</p>
        <p><strong>Data Period:</strong> {lookback_days} days</p>
        {f'<p><strong>Predictions:</strong> {len(predictions)} sector movements predicted</p>' if predictions else ''}
    </div>

    <div class="legend">
        <span class="positive">● Positive Correlation/Movement</span>
        <span class="negative">● Negative Correlation/Movement</span>
        <span class="neutral">● Neutral/No Prediction</span>
    </div>

    <div class="controls-panel">
        <div class="control-group">
            <label>Node Spacing:</label>
            <input type="range" id="repulsion-slider" class="control-slider"
                   min="500" max="3000" value="1200" step="100">
            <span id="repulsion-value" class="control-value">1200</span>
        </div>
        <div class="control-group">
            <label>Connection Length:</label>
            <input type="range" id="edge-length-slider" class="control-slider"
                   min="100" max="500" value="220" step="20">
            <span id="edge-length-value" class="control-value">220</span>
        </div>
        <div class="control-group">
            <label>Layout Strength:</label>
            <input type="range" id="gravity-slider" class="control-slider"
                   min="0.1" max="1.0" value="0.2" step="0.1">
            <span id="gravity-value" class="control-value">0.2</span>
        </div>
        <button id="reset-layout" class="back-btn" style="margin-bottom: 0;">Reset Layout</button>
    </div>

    <div class="chart-container">
        <div id="network-chart" class="chart chart-large"></div>
        <div id="heatmap-chart" class="chart chart-medium"></div>
        <div id="correlation-distribution" class="chart chart-medium"></div>
    </div>

    <div id="stock-detail-panel" class="stock-panel" style="display: none;">
        <button class="back-btn" onclick="showMainDashboard()">← Back to Sectors</button>
        <div class="stock-title" id="stock-sector-title">Sector Stocks</div>
        <div id="stock-network-chart" class="chart chart-small"></div>
    </div>

    <script>
        var stockNetworks = {json.dumps(stock_networks)};
        var currentView = 'main';

        var networkChart = echarts.init(document.getElementById('network-chart'), 'dark');

        var layoutParams = {{
            repulsion: 1200,
            edgeLength: 220,
            gravity: 0.2
        }};

        var networkOption = {{
            backgroundColor: '#2d2d2d',
            title: {{
                text: 'Sector Correlation Network',
                subtext: 'Node size = Market Cap, Line thickness = Correlation strength | Click sectors to explore stocks',
                left: 'center',
                textStyle: {{ fontSize: 18, color: '#e0e0e0' }},
                subtextStyle: {{ color: '#b0b0b0' }}
            }},
            tooltip: {{
                backgroundColor: '#1a1a1a',
                borderColor: '#404040',
                textStyle: {{ color: '#e0e0e0' }},
                formatter: function(params) {{
                    if (params.dataType === 'node') {{
                        return '<strong>' + params.name + '</strong><br/>Click to explore stocks<br/>Market Cap Weighted';
                    }} else {{
                        return params.data.source + ' ↔ ' + params.data.target +
                               '<br/>Correlation: ' + params.data.value.toFixed(3);
                    }}
                }}
            }},
            series: [{{
                type: 'graph',
                layout: 'force',
                data: {json.dumps(network_nodes)},
                links: {json.dumps(network_links)},
                roam: true,
                force: {{
                    repulsion: layoutParams.repulsion,
                    edgeLength: layoutParams.edgeLength,
                    gravity: layoutParams.gravity
                }},
                label: {{
                    show: true,
                    position: 'inside',
                    fontSize: 10,
                    color: '#ffffff',
                    formatter: function(params) {{
                        return params.name.split(' ')[0];
                    }}
                }},
                emphasis: {{
                    focus: 'adjacency',
                    itemStyle: {{
                        borderColor: '#64b5f6',
                        borderWidth: 3
                    }}
                }}
            }}]
        }};
        networkChart.setOption(networkOption);

        networkChart.on('click', function(params) {{
            if (params.dataType === 'node') {{
                showStockDetail(params.name);
            }}
        }});

        function updateNetworkLayout() {{
            networkOption.series[0].force.repulsion = layoutParams.repulsion;
            networkOption.series[0].force.edgeLength = layoutParams.edgeLength;
            networkOption.series[0].force.gravity = layoutParams.gravity;
            networkChart.setOption(networkOption, true);
        }}

        document.getElementById('repulsion-slider').addEventListener('input', function(e) {{
            layoutParams.repulsion = parseInt(e.target.value);
            document.getElementById('repulsion-value').textContent = e.target.value;
            updateNetworkLayout();
        }});

        document.getElementById('edge-length-slider').addEventListener('input', function(e) {{
            layoutParams.edgeLength = parseInt(e.target.value);
            document.getElementById('edge-length-value').textContent = e.target.value;
            updateNetworkLayout();
        }});

        document.getElementById('gravity-slider').addEventListener('input', function(e) {{
            layoutParams.gravity = parseFloat(e.target.value);
            document.getElementById('gravity-value').textContent = e.target.value;
            updateNetworkLayout();
        }});

        document.getElementById('reset-layout').addEventListener('click', function() {{
            layoutParams.repulsion = 1200;
            layoutParams.edgeLength = 220;
            layoutParams.gravity = 0.2;

            document.getElementById('repulsion-slider').value = 1200;
            document.getElementById('repulsion-value').textContent = '1200';
            document.getElementById('edge-length-slider').value = 220;
            document.getElementById('edge-length-value').textContent = '220';
            document.getElementById('gravity-slider').value = 0.2;
            document.getElementById('gravity-value').textContent = '0.2';

            updateNetworkLayout();
        }});

        var heatmapChart = echarts.init(document.getElementById('heatmap-chart'), 'dark');
        var heatmapOption = {{
            backgroundColor: '#2d2d2d',
            title: {{
                text: 'Correlation Matrix',
                left: 'center',
                textStyle: {{ color: '#e0e0e0' }}
            }},
            tooltip: {{
                backgroundColor: '#1a1a1a',
                borderColor: '#404040',
                textStyle: {{ color: '#e0e0e0' }},
                formatter: function(params) {{
                    var sectors = {json.dumps([s.split()[0] for s in sectors])};
                    return sectors[params.data[1]] + ' vs ' + sectors[params.data[0]] + '<br/>Correlation: ' + params.data[2];
                }}
            }},
            xAxis: {{
                type: 'category',
                data: {json.dumps([s.split()[0] for s in sectors])},
                axisLabel: {{ rotate: 45, fontSize: 10, color: '#e0e0e0' }},
                axisLine: {{ lineStyle: {{ color: '#404040' }} }}
            }},
            yAxis: {{
                type: 'category',
                data: {json.dumps([s.split()[0] for s in sectors])},
                axisLabel: {{ fontSize: 10, color: '#e0e0e0' }},
                axisLine: {{ lineStyle: {{ color: '#404040' }} }}
            }},
            visualMap: {{
                min: -1,
                max: 1,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: '10%',
                textStyle: {{ color: '#e0e0e0' }},
                inRange: {{
                    color: ['#e57373', '#424242', '#81c784']
                }}
            }},
            series: [{{
                type: 'heatmap',
                data: {json.dumps(heatmap_data)},
                label: {{
                    show: true,
                    fontSize: 8
                }},
                emphasis: {{
                    itemStyle: {{
                        shadowBlur: 10,
                        shadowColor: 'rgba(0, 0, 0, 0.5)'
                    }}
                }}
            }}]
        }};
        heatmapChart.setOption(heatmapOption);

        var correlations = {json.dumps([round(link['value'], 2) for link in network_links])};
        var bins = {{}};
        correlations.forEach(function(corr) {{
            var bin = Math.floor(corr * 10) / 10;
            bins[bin] = (bins[bin] || 0) + 1;
        }});

        var histData = Object.keys(bins).map(function(bin) {{
            return [parseFloat(bin), bins[bin]];
        }}).sort(function(a, b) {{ return a[0] - b[0]; }});

        var distChart = echarts.init(document.getElementById('correlation-distribution'), 'dark');
        var distOption = {{
            backgroundColor: '#2d2d2d',
            title: {{
                text: 'Correlation Strength Distribution',
                left: 'center',
                textStyle: {{ color: '#e0e0e0' }}
            }},
            xAxis: {{
                type: 'value',
                name: 'Correlation Strength',
                nameTextStyle: {{ color: '#e0e0e0' }},
                axisLabel: {{ color: '#e0e0e0' }},
                axisLine: {{ lineStyle: {{ color: '#404040' }} }},
                min: 0.3,
                max: 1
            }},
            yAxis: {{
                type: 'value',
                name: 'Frequency',
                nameTextStyle: {{ color: '#e0e0e0' }},
                axisLabel: {{ color: '#e0e0e0' }},
                axisLine: {{ lineStyle: {{ color: '#404040' }} }}
            }},
            grid: {{
                borderColor: '#404040'
            }},
            series: [{{
                type: 'bar',
                data: histData,
                barWidth: '60%',
                itemStyle: {{
                    color: '#64b5f6'
                }}
            }}]
        }};
        distChart.setOption(distOption);

        function showStockDetail(sectorName) {{
            if (!stockNetworks[sectorName]) {{
                console.log('No stock data for sector:', sectorName);
                return;
            }}

            currentView = 'stocks';
            document.querySelector('.chart-container').style.display = 'none';
            document.querySelector('.controls-panel').style.display = 'none';
            document.getElementById('stock-detail-panel').style.display = 'block';
            document.getElementById('stock-sector-title').textContent = sectorName + ' - Stock Correlations';

            var chartContainer = document.getElementById('stock-network-chart');
            chartContainer.style.width = '100%';
            chartContainer.style.height = '500px';
            chartContainer.style.display = 'block';

            var stockChart = echarts.init(chartContainer, 'dark');
            var stockData = stockNetworks[sectorName];

            var stockOption = {{
                backgroundColor: '#2d2d2d',
                title: {{
                    text: sectorName + ' Stocks',
                    subtext: 'Stock correlation network within sector',
                    left: 'center',
                    textStyle: {{ fontSize: 16, color: '#e0e0e0' }},
                    subtextStyle: {{ color: '#b0b0b0' }}
                }},
                tooltip: {{
                    backgroundColor: '#1a1a1a',
                    borderColor: '#404040',
                    textStyle: {{ color: '#e0e0e0' }},
                    formatter: function(params) {{
                        if (params.dataType === 'node') {{
                            return '<strong>' + params.name + '</strong><br/>Stock in ' + sectorName;
                        }} else {{
                            return params.data.source + ' ↔ ' + params.data.target +
                                   '<br/>Correlation: ' + params.data.value.toFixed(3);
                        }}
                    }}
                }},
                series: [{{
                    type: 'graph',
                    layout: 'force',
                    data: stockData.nodes,
                    links: stockData.links,
                    roam: true,
                    force: {{
                        repulsion: 800,
                        edgeLength: 150
                    }},
                    label: {{
                        show: true,
                        position: 'inside',
                        fontSize: 9,
                        color: '#ffffff'
                    }},
                    emphasis: {{
                        focus: 'adjacency',
                        itemStyle: {{
                            borderColor: '#64b5f6',
                            borderWidth: 2
                        }}
                    }}
                }}]
            }};

            stockChart.setOption(stockOption);
            document.getElementById('stock-network-chart').style.display = 'block';

            setTimeout(function() {{
                stockChart.resize();
            }}, 100);
        }}

        function showMainDashboard() {{
            currentView = 'main';
            document.querySelector('.chart-container').style.display = 'flex';
            document.querySelector('.controls-panel').style.display = 'flex';
            document.getElementById('stock-detail-panel').style.display = 'none';
        }}

        window.addEventListener('resize', function() {{
            networkChart.resize();
            heatmapChart.resize();
            distChart.resize();
        }});
    </script>
</body>
</html>
        """

        return html_content

    def save_and_open_visualization(self, correlation_matrix: pd.DataFrame,
                                   sector_stocks: Dict[str, List[Dict]],
                                   predictions: Dict[str, Dict] = None,
                                   lookback_days: int = 365):
        console.print(Panel.fit("🎨 Generating Interactive ECharts Dashboard", style="bold cyan"))

        html_content = self.generate_echarts_html(correlation_matrix, sector_stocks, predictions, lookback_days)

        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False) as f:
            f.write(html_content)
            temp_path = f.name

        console.print(f"[green]✅ Dashboard saved to: {temp_path}[/green]")
        console.print("[cyan]🌐 Opening in browser...[/cyan]")

        try:
            webbrowser.open(f'file://{temp_path}')
            console.print("[green]✅ Dashboard opened in default browser[/green]")
        except Exception as e:
            console.print(f"[red]❌ Could not open browser automatically: {e}[/red]")
            console.print(f"[yellow]Manual: Open {temp_path} in your browser[/yellow]")

        return temp_path
