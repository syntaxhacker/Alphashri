import pandas as pd
from dash import Dash, html, dcc, Input, Output, State, dash_table
import dash_bootstrap_components as dbc
from datetime import datetime
import os
from visualizations.charts import StockCharts
from utils.data_loader import load_stock_data
from layouts.dashboard import create_layout

class StockDashboard:
    def __init__(self):
        self.charts = StockCharts()
        self.data = load_stock_data()
        self.app = Dash(__name__, external_stylesheets=[dbc.themes.DARKLY])
        self.app.layout = create_layout(self.data)
        self.setup_callbacks()
    
    def setup_callbacks(self):
        @self.app.callback(
            [Output('bubble-chart', 'figure'),
             Output('metrics-comparison', 'figure'),
             Output('sector-analysis', 'figure'),
             Output('performance-metrics', 'figure'),
             Output('stock-table', 'data')],
            [Input('market-cap-slider', 'value'),
             Input('profit-margin-slider', 'value'),
             Input('metrics-dropdown', 'value'),
             Input('bubble-chart', 'selectedData'),
             Input('stock-table', 'selected_rows')],
            [State('stock-table', 'data')]
        )
        def update_charts(min_market_cap, max_profit_margin, selected_metrics, 
                         selected_points, selected_rows, table_data):
            selected_symbols = self._get_selected_symbols(
                selected_points, selected_rows, table_data)
            
            filters = {
                'market_cap_cr': (min_market_cap, None),
                'profit_margin': (None, max_profit_margin)
            }
            
            return (
                self.charts.create_bubble_chart(
                    self.data['multibagger_df'],
                    f"Multibagger Candidates (as of {self.data['multibagger_date']})",
                    selected_symbols,
                    **filters
                ),
                self.charts.create_parallel_coordinates(
                    self.data['multibagger_df'],
                    selected_metrics if selected_metrics else ['market_cap_cr', 'profit_margin', 'roe'],
                    'Multi-dimensional Analysis'
                ),
                self.charts.create_sector_analysis(
                    self.data['multibagger_df']
                ),
                self.charts.create_performance_metrics(
                    self.data['multibagger_df'],
                    selected_symbols
                ),
                self._create_table_data(selected_symbols)
            )
    
    def _get_selected_symbols(self, selected_points, selected_rows, table_data):
        if selected_points and selected_points['points']:
            return [point['hovertext'] for point in selected_points['points']]
        elif selected_rows and table_data:
            return [table_data[idx]['symbol'] for idx in selected_rows]
        return []
    
    def _create_table_data(self, selected_symbols=None):
        if self.data['multibagger_df'] is None:
            return []
            
        df = self.data['multibagger_df'].copy()
        if selected_symbols:
            df = df[df['symbol'].isin(selected_symbols)]
        
        df = df.sort_values('criteria_count', ascending=False)
        numeric_cols = ['market_cap_cr', 'profit_margin', 'roe', 'revenue_growth', 
                       'returns_6m', 'returns_1y', 'debt_to_equity']
        df[numeric_cols] = df[numeric_cols].round(2)
        
        return df.to_dict('records')
    
    def run_server(self, debug=True, port=8050):
        print("Starting dashboard server...")
        print("Open http://localhost:8050 in your browser")
        self.app.run_server(debug=debug, port=port, use_reloader=True)

if __name__ == "__main__":
    dashboard = StockDashboard()
    dashboard.run_server() 