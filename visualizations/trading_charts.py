import plotly.graph_objects as go
from plotly.subplots import make_subplots
import pandas as pd
import numpy as np
from datetime import datetime
import os
import json

class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, (pd.Timestamp, datetime)):
            return obj.strftime('%Y-%m-%d %H:%M:%S')
        return super().default(obj)

class TradingCharts:
    def __init__(self):
        """Initialize TradingCharts with default settings"""
        self.colors = {
            'background': '#1e1e1e',
            'text': '#ffffff',
            'buy': '#00ff00',
            'sell': '#ff0000',
            'profit': '#00ff00',
            'loss': '#ff0000',
            'line': '#00ffff'
        }
        
        # Create visualizations directory if it doesn't exist
        self.viz_dir = 'visualizations/html'
        if not os.path.exists(self.viz_dir):
            os.makedirs(self.viz_dir)

    def create_combined_dashboard(self, all_results: dict) -> str:
        """Create a combined dashboard with strategy selector"""
        # Create the HTML template with dropdown
        html_content = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Trading Analysis Dashboard</title>
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body { 
                    background-color: #1e1e1e; 
                    color: white; 
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                }
                .container {
                    max-width: 1800px;
                    margin: 0 auto;
                }
                .header {
                    text-align: center;
                    margin-bottom: 20px;
                }
                select {
                    background-color: #2e2e2e;
                    color: white;
                    padding: 8px;
                    border: 1px solid #3e3e3e;
                    border-radius: 4px;
                    font-size: 16px;
                    margin-bottom: 20px;
                }
                .chart-container {
                    margin-bottom: 40px;
                    height: 800px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Trading Analysis Dashboard</h1>
                    <select id="strategySelect" onchange="updateCharts()">
                        $OPTIONS
                    </select>
                </div>
                <div id="tradingDashboard" class="chart-container"></div>
                <div id="tradingMetrics" class="chart-container"></div>
            </div>
            
            <script>
                const allData = $DATA;
                
                function updateCharts() {
                    const strategy = document.getElementById('strategySelect').value;
                    const data = allData[strategy];
                    
                    const dashboardConfig = {
                        responsive: true,
                        displayModeBar: true,
                        scrollZoom: true
                    };
                    
                    const metricsConfig = {
                        responsive: true,
                        displayModeBar: true
                    };
                    
                    Plotly.newPlot('tradingDashboard', data.dashboard.data, data.dashboard.layout, dashboardConfig);
                    Plotly.newPlot('tradingMetrics', data.metrics.data, data.metrics.layout, metricsConfig);
                }
                
                // Initial load
                document.addEventListener('DOMContentLoaded', function() {
                    const firstStrategy = document.getElementById('strategySelect').value;
                    if (firstStrategy) {
                        updateCharts();
                    }
                });
            </script>
        </body>
        </html>
        """
        
        # Generate options for dropdown
        options = []
        data = {}
        
        for strategy_name, (trades_df, price_data) in all_results.items():
            options.append(f'<option value="{strategy_name}">{strategy_name}</option>')
            
            # Ensure datetime index
            if not isinstance(trades_df.index, pd.DatetimeIndex):
                trades_df.index = pd.to_datetime(trades_df.index)
            if not isinstance(price_data.index, pd.DatetimeIndex):
                price_data.index = pd.to_datetime(price_data.index)
            
            # Create charts for this strategy
            dashboard = self.create_trading_dashboard(trades_df, price_data, strategy_name)
            metrics = self.create_trade_metrics(trades_df, strategy_name)
            
            # Convert figures to JSON-serializable format
            dashboard_data = [self._clean_figure_data(trace.to_plotly_json()) for trace in dashboard.data]
            dashboard_layout = self._clean_figure_data(dashboard.layout.to_plotly_json())
            metrics_data = [self._clean_figure_data(trace.to_plotly_json()) for trace in metrics.data]
            metrics_layout = self._clean_figure_data(metrics.layout.to_plotly_json())
            
            data[strategy_name] = {
                'dashboard': {
                    'data': dashboard_data,
                    'layout': dashboard_layout
                },
                'metrics': {
                    'data': metrics_data,
                    'layout': metrics_layout
                }
            }
        
        try:
            # Replace placeholders in template
            html_content = html_content.replace('$OPTIONS', '\n'.join(options))
            json_data = json.dumps(data, cls=NumpyEncoder)
            html_content = html_content.replace('$DATA', json_data)
            
            # Generate filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(self.viz_dir, f"trading_dashboard_{timestamp}.html")
            
            # Save the HTML file
            with open(filename, 'w') as f:
                f.write(html_content)
                
            return filename
            
        except Exception as e:
            print(f"Error creating dashboard: {str(e)}")
            raise

    def _clean_figure_data(self, data):
        """Clean figure data to ensure JSON serialization"""
        if isinstance(data, dict):
            return {k: self._clean_figure_data(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self._clean_figure_data(item) for item in data]
        elif isinstance(data, (np.integer, np.floating)):
            return float(data)
        elif isinstance(data, np.ndarray):
            return data.tolist()
        elif isinstance(data, (pd.Timestamp, datetime)):
            return data.strftime('%Y-%m-%d %H:%M:%S')
        return data

    def create_trading_dashboard(self, trades_df: pd.DataFrame, price_data: pd.DataFrame, strategy_name: str = None) -> go.Figure:
        """Create a comprehensive trading dashboard"""
        # Create figure with secondary y-axis
        fig = make_subplots(
            rows=3, cols=1,
            shared_xaxes=True,
            vertical_spacing=0.05,
            subplot_titles=('Price Action & Trades', 'Portfolio Value', 'Volume'),
            row_heights=[0.5, 0.3, 0.2]
        )

        # Add candlestick chart
        fig.add_trace(
            go.Candlestick(
                x=price_data.index,
                open=price_data['open'],
                high=price_data['high'],
                low=price_data['low'],
                close=price_data['close'],
                name='Price',
                hoverlabel=dict(
                    bgcolor='rgba(0,0,0,0.8)',
                    font=dict(color='white')
                ),
                hoverinfo='x+y',
                text=[
                    f"Open: ${o:.2f}<br>" +
                    f"High: ${h:.2f}<br>" +
                    f"Low: ${l:.2f}<br>" +
                    f"Close: ${c:.2f}"
                    for o, h, l, c in zip(
                        price_data['open'],
                        price_data['high'],
                        price_data['low'],
                        price_data['close']
                    )
                ]
            ),
            row=1, col=1
        )

        # Add buy points with hover template
        buy_trades = trades_df[trades_df['action'] == 'BUY']
        fig.add_trace(
            go.Scatter(
                x=buy_trades.index,
                y=buy_trades['price'],
                mode='markers',
                name='Buy',
                marker=dict(
                    symbol='triangle-up',
                    size=12,
                    color=self.colors['buy'],
                    line=dict(width=2)
                ),
                hovertemplate="<b>%{x|%Y-%m-%d %H:%M}</b><br>" +
                             "Buy Price: $%{y:.2f}<extra></extra>"
            ),
            row=1, col=1
        )

        # Add sell points with hover template
        sell_trades = trades_df[trades_df['action'] == 'SELL']
        fig.add_trace(
            go.Scatter(
                x=sell_trades.index,
                y=sell_trades['price'],
                mode='markers',
                name='Sell',
                marker=dict(
                    symbol='triangle-down',
                    size=12,
                    color=self.colors['sell'],
                    line=dict(width=2)
                ),
                hovertemplate="<b>%{x|%Y-%m-%d %H:%M}</b><br>" +
                             "Sell Price: $%{y:.2f}<br>" +
                             "P&L: $%{customdata[0]:.2f} (%{customdata[1]:.2f}%)<extra></extra>",
                customdata=list(zip(sell_trades['pnl'], sell_trades['return']))
            ),
            row=1, col=1
        )

        # Add portfolio value with hover template
        fig.add_trace(
            go.Scatter(
                x=trades_df.index,
                y=trades_df['balance'],
                mode='lines',
                name='Portfolio Value',
                line=dict(color=self.colors['line']),
                hovertemplate="<b>%{x|%Y-%m-%d %H:%M}</b><br>" +
                             "Balance: $%{y:.2f}<extra></extra>"
            ),
            row=2, col=1
        )

        # Add volume bars with hover template
        fig.add_trace(
            go.Bar(
                x=price_data.index,
                y=price_data['volume'],
                name='Volume',
                hovertemplate="<b>%{x|%Y-%m-%d %H:%M}</b><br>" +
                             "Volume: %{y:,.0f}<extra></extra>"
            ),
            row=3, col=1
        )

        # Update layout
        title = 'Trading Dashboard'
        if strategy_name:
            title = f'Trading Dashboard - {strategy_name}'
            
        fig.update_layout(
            title=title,
            xaxis_title='Date',
            yaxis_title='Price',
            template='plotly_dark',
            height=1200,  # Increased height
            showlegend=True,
            # Enable zooming and drawing tools
            dragmode='zoom',
            modebar=dict(
                add=['drawline', 'drawopenpath', 'drawclosedpath', 'drawcircle', 'drawrect', 'eraseshape']
            ),
            # Adjust spacing between subplots
            bargap=0.2,
            bargroupgap=0.1,
            margin=dict(t=100, b=50),
            grid=dict(rows=3, columns=1, pattern='independent'),
            yaxis=dict(title='Price ($)', showgrid=True, gridwidth=1, gridcolor='rgba(128,128,128,0.2)'),
            yaxis2=dict(title='Portfolio Value ($)', showgrid=True, gridwidth=1, gridcolor='rgba(128,128,128,0.2)'),
            yaxis3=dict(title='Volume', showgrid=True, gridwidth=1, gridcolor='rgba(128,128,128,0.2)')
        )

        return fig

    def create_trade_metrics(self, trades_df: pd.DataFrame, strategy_name: str = None) -> go.Figure:
        """Create a figure showing key trading metrics"""
        # Calculate metrics
        total_trades = len(trades_df)
        profitable_trades = len(trades_df[trades_df['pnl'] > 0])
        win_rate = (profitable_trades / total_trades) * 100 if total_trades > 0 else 0
        
        avg_profit = trades_df[trades_df['pnl'] > 0]['pnl'].mean() if profitable_trades > 0 else 0
        avg_loss = trades_df[trades_df['pnl'] < 0]['pnl'].mean() if len(trades_df[trades_df['pnl'] < 0]) > 0 else 0
        
        profit_factor = abs(trades_df[trades_df['pnl'] > 0]['pnl'].sum() / trades_df[trades_df['pnl'] < 0]['pnl'].sum()) if len(trades_df[trades_df['pnl'] < 0]) > 0 else float('inf')
        
        # Create metrics visualization with proper subplot types
        title = 'Trading Metrics'
        if strategy_name:
            title = f'Trading Metrics - {strategy_name}'
            
        fig = make_subplots(
            rows=2, cols=2,
            specs=[
                [{"type": "domain"}, {"type": "xy"}],
                [{"type": "xy"}, {"type": "xy"}]
            ],
            subplot_titles=('Trade Outcomes', 'P&L Distribution', 'Cumulative Returns', 'Monthly Returns')
        )

        # Trade outcomes pie chart
        fig.add_trace(
            go.Pie(
                labels=['Profitable', 'Unprofitable'],
                values=[profitable_trades, total_trades - profitable_trades],
                name='Trade Outcomes',
                marker=dict(colors=[self.colors['profit'], self.colors['loss']])
            ),
            row=1, col=1
        )

        # P&L distribution histogram
        fig.add_trace(
            go.Histogram(
                x=trades_df['pnl'],
                name='P&L Distribution',
                nbinsx=20,
                marker_color=self.colors['line']
            ),
            row=1, col=2
        )

        # Cumulative returns line
        trades_df['cumulative_return'] = trades_df['return'].fillna(0).cumsum()
        fig.add_trace(
            go.Scatter(
                x=trades_df.index,
                y=trades_df['cumulative_return'],
                mode='lines',
                name='Cumulative Returns',
                line=dict(color=self.colors['line'])
            ),
            row=2, col=1
        )

        # Monthly returns bar
        if isinstance(trades_df.index, pd.DatetimeIndex):
            monthly_returns = trades_df.resample('M')['return'].sum()
        else:
            # Convert index to datetime if it's not already
            trades_df_temp = trades_df.copy()
            trades_df_temp.index = pd.to_datetime(trades_df_temp.index)
            monthly_returns = trades_df_temp.resample('M')['return'].sum()
            
        colors = [self.colors['profit'] if x >= 0 else self.colors['loss'] for x in monthly_returns.values]
        fig.add_trace(
            go.Bar(
                x=monthly_returns.index,
                y=monthly_returns.values,
                name='Monthly Returns',
                marker_color=colors,
                hovertemplate="%{x|%Y-%m-%d}<br>Monthly Return: %{y:.2f}%<extra></extra>"
            ),
            row=2, col=2
        )

        # Update layout
        fig.update_layout(
            title=title,
            template='plotly_dark',
            height=800,
            showlegend=True,
            annotations=[
                dict(
                    text=f"Win Rate: {win_rate:.1f}%<br>Profit Factor: {profit_factor:.2f}<br>" +
                         f"Avg Win: ${avg_profit:.2f}<br>Avg Loss: ${avg_loss:.2f}",
                    align='left',
                    showarrow=False,
                    xref='paper',
                    yref='paper',
                    x=0,
                    y=1.1,
                    bordercolor='white',
                    borderwidth=1,
                    bgcolor='rgba(0,0,0,0.5)'
                )
            ]
        )

        # Update axes labels and hover templates
        fig.update_xaxes(title_text="P&L ($)", row=1, col=2)
        fig.update_yaxes(title_text="Frequency", row=1, col=2)
        
        fig.update_xaxes(title_text="Date", row=2, col=1)
        fig.update_yaxes(title_text="Cumulative Return (%)", row=2, col=1)
        
        fig.update_xaxes(title_text="Month", row=2, col=2)
        fig.update_yaxes(title_text="Monthly Return (%)", row=2, col=2)
        
        # Update hover templates for different chart types
        fig.update_traces(
            hovertemplate="%{x|%Y-%m-%d}<br>Return: %{y:.2f}%<extra></extra>",
            selector=dict(type='scatter')
        )
        
        # Update hover template for P&L distribution
        fig.update_traces(
            hovertemplate="P&L: $%{x:.2f}<br>Count: %{y}<extra></extra>",
            selector=dict(type='histogram')
        )
        
        # Update hover template for pie chart
        fig.update_traces(
            hovertemplate="%{label}<br>%{value} trades (%{percent})<extra></extra>",
            selector=dict(type='pie')
        )

        return fig 