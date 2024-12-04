from dash import html, dcc, dash_table
import dash_bootstrap_components as dbc

def create_layout(data):
    """Create the dashboard layout"""
    return dbc.Container([
        # Header
        create_header(data),
        
        # Filters
        create_filters(data),
        
        # Charts
        *create_charts(),
        
        # Table
        create_table(),
        
        # Footer
        create_footer()
    ], fluid=True)

def create_header(data):
    return dbc.Row([
        dbc.Col([
            html.H1("Indian Stock Market Analysis Dashboard", 
                   className="text-center my-4"),
            html.Div([
                f"Multibagger Analysis Date: {data['multibagger_date']}",
                html.Br(),
                f"Undervalued Analysis Date: {data['undervalued_date']}"
            ], className="text-center text-muted")
        ])
    ])

def create_filters(data):
    return dbc.Row([
        dbc.Col([
            dbc.Card([
                dbc.CardHeader(html.H4("Filters & Controls", className="mb-0")),
                dbc.CardBody(create_filter_controls(data))
            ], className="mb-4")
        ])
    ])

def create_filter_controls(data):
    max_market_cap = (data['multibagger_df']['market_cap_cr'].max() 
                     if data['multibagger_df'] is not None else 1000)
    
    return html.Div([
        dbc.Row([
            dbc.Col([
                html.Label("Minimum Market Cap (Cr)", className="fw-bold"),
                dcc.Slider(
                    id='market-cap-slider',
                    min=0,
                    max=max_market_cap,
                    value=0,
                    marks={i: f'₹{i}' for i in range(0, int(max_market_cap), 200)},
                    step=10,
                    tooltip={"placement": "bottom", "always_visible": True}
                ),
            ], width=6),
            dbc.Col([
                html.Label("Maximum Profit Margin (%)", className="fw-bold"),
                dcc.Slider(
                    id='profit-margin-slider',
                    min=0,
                    max=100,
                    value=100,
                    marks={i: f'{i}%' for i in range(0, 101, 10)},
                    step=1,
                    tooltip={"placement": "bottom", "always_visible": True}
                ),
            ], width=6),
        ]),
        html.Hr(),
        create_metrics_dropdown()
    ])

def create_metrics_dropdown():
    return dbc.Row([
        dbc.Col([
            html.Label("Select Metrics for Comparison", className="fw-bold"),
            dcc.Dropdown(
                id='metrics-dropdown',
                options=[
                    {'label': 'Market Cap (Cr)', 'value': 'market_cap_cr'},
                    {'label': 'Profit Margin (%)', 'value': 'profit_margin'},
                    {'label': 'ROE (%)', 'value': 'roe'},
                    {'label': 'Revenue Growth (%)', 'value': 'revenue_growth'},
                    {'label': '6M Returns (%)', 'value': 'returns_6m'},
                    {'label': '1Y Returns (%)', 'value': 'returns_1y'},
                    {'label': 'Debt to Equity', 'value': 'debt_to_equity'}
                ],
                value=['market_cap_cr', 'profit_margin', 'roe'],
                multi=True,
                className="mb-3"
            )
        ])
    ])

def create_charts():
    return [
        create_chart_row('Market Performance Analysis', 'bubble-chart'),
        create_chart_row('Multi-dimensional Analysis', 'metrics-comparison'),
        create_chart_row('Sector Analysis', 'sector-analysis'),
        create_chart_row('Performance Metrics', 'performance-metrics')
    ]

def create_chart_row(title, chart_id):
    return dbc.Row([
        dbc.Col([
            dbc.Card([
                dbc.CardHeader(html.H5(title, className="mb-0")),
                dbc.CardBody([
                    dcc.Graph(id=chart_id)
                ])
            ])
        ], width=12)
    ], className="mb-4")

def create_table():
    return dbc.Row([
        dbc.Col([
            dbc.Card([
                dbc.CardHeader(html.H5("Selected Stocks Details", className="mb-0")),
                dbc.CardBody(create_data_table())
            ])
        ])
    ], className="mb-4")

def create_data_table():
    return dash_table.DataTable(
        id='stock-table',
        columns=[
            {"name": "Symbol", "id": "symbol"},
            {"name": "Market Cap (Cr)", "id": "market_cap_cr"},
            {"name": "Profit Margin (%)", "id": "profit_margin"},
            {"name": "ROE (%)", "id": "roe"},
            {"name": "Revenue Growth (%)", "id": "revenue_growth"},
            {"name": "6M Returns (%)", "id": "returns_6m"},
            {"name": "1Y Returns (%)", "id": "returns_1y"},
            {"name": "Debt/Equity", "id": "debt_to_equity"},
            {"name": "Criteria Met", "id": "criteria_met"}
        ],
        style_table={'overflowX': 'auto'},
        style_cell={
            'backgroundColor': '#303030',
            'color': 'white',
            'textAlign': 'left'
        },
        style_header={
            'backgroundColor': '#404040',
            'fontWeight': 'bold'
        },
        style_data_conditional=[
            {
                'if': {'row_index': 'odd'},
                'backgroundColor': '#353535'
            }
        ],
        page_size=10,
        sort_action='native',
        filter_action='native',
        row_selectable='multi'
    )

def create_footer():
    return dbc.Row([
        dbc.Col([
            html.Hr(),
            html.P(
                "Data is refreshed daily. Click on points in the scatter plot or select rows in the table to highlight stocks.",
                className="text-center text-muted"
            )
        ])
    ]) 