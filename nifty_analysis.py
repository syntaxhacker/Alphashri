#!/usr/bin/env python
"""
Nifty 50 Technical Analysis Dashboard

This script performs a detailed technical analysis of the Nifty 50 index
for the current week, generating interactive HTML visualizations and a summary report.

Usage:
    python nifty_analysis.py [--days DAYS]

Options:
    --days DAYS    Number of days to analyze (default: 7)
"""

import argparse
import os
from datetime import datetime, timedelta
import eda
from unittest.mock import patch

def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='Nifty 50 Technical Analysis Dashboard')
    parser.add_argument('--days', type=int, default=7, help='Number of days to analyze')
    parser.add_argument('--no-filter', action='store_true', help='Do not filter to current week')
    parser.add_argument('--output-dir', type=str, default='nifty_analysis', 
                        help='Directory to save analysis results')
    parser.add_argument('--small-dataset', action='store_true', 
                        help='Adjust analysis for very small datasets (< 10 data points)')
    return parser.parse_args()

def create_output_dirs(output_dir):
    """Create output directories for figures and reports"""
    os.makedirs(os.path.join(output_dir, 'figures'), exist_ok=True)
    os.makedirs(os.path.join(output_dir, 'reports'), exist_ok=True)
    return os.path.join(output_dir, 'figures'), os.path.join(output_dir, 'reports')

def run_nifty_analysis(days=7, filter_current_week=True, output_dir='nifty_analysis', small_dataset=False):
    """Run the Nifty 50 analysis with specified parameters"""
    
    print(f"{'='*80}")
    print(f"NIFTY 50 TECHNICAL ANALYSIS - {datetime.now().strftime('%Y-%m-%d')}")
    print(f"{'='*80}")
    
    # Create output directories
    fig_dir, report_dir = create_output_dirs(output_dir)
    
    # Adjust the load_data and plot functions to use custom output directories
    orig_makedirs = os.makedirs
    def patched_makedirs(name, *args, **kwargs):
        if name == 'figures':
            orig_makedirs(fig_dir, *args, **kwargs)
        elif name == 'reports':
            orig_makedirs(report_dir, *args, **kwargs)
        else:
            orig_makedirs(name, *args, **kwargs)
    
    # Monkey patch os.makedirs
    os.makedirs = patched_makedirs
    
    # Monkey patch the figure saving
    orig_write_html = eda.go.Figure.write_html
    def patched_write_html(self, file, *args, **kwargs):
        if file.startswith('figures/'):
            return orig_write_html(self, os.path.join(fig_dir, os.path.basename(file)), *args, **kwargs)
        return orig_write_html(self, file, *args, **kwargs)
    
    # Apply the patch
    eda.go.Figure.write_html = patched_write_html
    
    # Patch for small datasets if needed
    if small_dataset:
        # Keep reference to original function
        orig_plot_candlestick = eda.plot_candlestick_volume
        
        # Define a safer version for small datasets
        def safe_plot_candlestick(df, save_fig=True, fig_name='nifty_price_action.html'):
            # Copy the dataframe
            df_copy = df.copy()
            
            # Add a safer daily_return calculation if it doesn't exist
            if 'daily_return' not in df_copy.columns:
                df_copy['daily_return'] = df_copy['close'].pct_change() * 100
            
            # Create a basic candlestick chart without the annotations that need larger datasets
            import plotly.graph_objects as go
            from plotly.subplots import make_subplots
            
            # Create figure with secondary y-axis
            fig = make_subplots(rows=2, cols=1, shared_xaxes=True, 
                               vertical_spacing=0.03, subplot_titles=('Price', 'Volume'), 
                               row_heights=[0.7, 0.3])
            
            # Add price candlestick
            fig.add_trace(go.Candlestick(
                x=df_copy.index,
                open=df_copy['open'], high=df_copy['high'],
                low=df_copy['low'], close=df_copy['close'],
                increasing_line_color='#26a69a', decreasing_line_color='#ef5350',
                name='Price'
            ), row=1, col=1)
            
            # Add volume bar chart
            colors = ['#26a69a' if row['close'] >= row['open'] else '#ef5350' for _, row in df_copy.iterrows()]
            fig.add_trace(go.Bar(
                x=df_copy.index,
                y=df_copy['volume'],
                marker_color=colors,
                name='Volume'
            ), row=2, col=1)
            
            # Add Bollinger Bands if available
            if all(col in df_copy.columns for col in ['BB_upper', 'BB_middle', 'BB_lower']):
                fig.add_trace(go.Scatter(
                    x=df_copy.index, y=df_copy['BB_upper'],
                    line=dict(color='rgba(250, 128, 114, 0.7)', width=1),
                    name='Upper BB'
                ), row=1, col=1)
                
                fig.add_trace(go.Scatter(
                    x=df_copy.index, y=df_copy['BB_middle'],
                    line=dict(color='rgba(128, 128, 128, 0.7)', width=1),
                    name='Middle BB'
                ), row=1, col=1)
                
                fig.add_trace(go.Scatter(
                    x=df_copy.index, y=df_copy['BB_lower'],
                    line=dict(color='rgba(144, 238, 144, 0.7)', width=1),
                    name='Lower BB',
                    fill='tonexty', fillcolor='rgba(242, 242, 242, 0.1)'
                ), row=1, col=1)
            
            # Add moving averages if available
            if 'SMA_20' in df_copy.columns:
                fig.add_trace(go.Scatter(
                    x=df_copy.index, y=df_copy['SMA_20'],
                    line=dict(color='rgba(255, 165, 0, 0.7)', width=1),
                    name='SMA 20'
                ), row=1, col=1)
            
            if 'SMA_50' in df_copy.columns:
                fig.add_trace(go.Scatter(
                    x=df_copy.index, y=df_copy['SMA_50'],
                    line=dict(color='rgba(148, 0, 211, 0.7)', width=1),
                    name='SMA 50'
                ), row=1, col=1)
            
            # Update layout
            fig.update_layout(
                title='Nifty 50 - Price Action Analysis (Small Dataset)',
                yaxis_title='Price',
                yaxis2_title='Volume',
                xaxis_rangeslider_visible=False,
                height=800,
                legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                shapes=[],
                annotations=[],
                template='plotly_white'
            )
            
            fig.update_yaxes(title_text="Price", row=1, col=1)
            fig.update_yaxes(title_text="Volume", row=2, col=1)
            
            if save_fig:
                os.makedirs('figures', exist_ok=True)
                fig.write_html(f'figures/{fig_name}')
                print(f"Saved figure to figures/{fig_name}")
            else:
                fig.show()
            
            return fig
        
        # Replace the original function with our safe version
        eda.plot_candlestick_volume = safe_plot_candlestick
        
        print("\nRunning in small dataset mode - using simplified charts for small datasets")
    
    try:
        # Load data for the specified period
        print(f"\nLoading Nifty 50 data for the past {days} days...")
        start_date = datetime.now() - timedelta(days=days)
        
        # Load data
        df = eda.load_data(symbol='NIFTY50', filter_current_week=filter_current_week)
        
        # Check if we have very limited data and set a minimum sample size
        if len(df) < 10 and not small_dataset:
            print(f"\nWarning: Very small dataset detected with only {len(df)} data points.")
            print("Consider using the --small-dataset flag for better results with limited data.")
        
        # Generate analysis
        print("\nGenerating analysis charts...")
        try:
            eda.plot_candlestick_volume(df)
        except Exception as e:
            print(f"Error in candlestick chart: {e}")
            
        try:
            eda.plot_technical_indicators(df)
        except Exception as e:
            print(f"Error in technical indicators chart: {e}")
            
        try:
            eda.plot_volatility_analysis(df)
        except Exception as e:
            print(f"Error in volatility analysis chart: {e}")
            
        try:
            eda.plot_market_regimes(df)
        except Exception as e:
            print(f"Error in market regimes chart: {e}")
        
        # Generate summary report
        try:
            summary = eda.generate_summary_report(df)
        except Exception as e:
            print(f"Error in summary report: {e}")
        
        # Move the summary file to the output directory
        if os.path.exists('reports/nifty_weekly_summary.md'):
            import shutil
            os.makedirs(report_dir, exist_ok=True)
            shutil.copy('reports/nifty_weekly_summary.md', os.path.join(report_dir, 'nifty_weekly_summary.md'))
        
        print(f"\nAnalysis complete!")
        print(f"Figures saved to: {fig_dir}")
        print(f"Summary report saved to: {report_dir}/nifty_weekly_summary.md")
        
        # Create index.html to easily navigate all charts
        create_index_html(fig_dir, report_dir, output_dir)
        
        return True
    except Exception as e:
        print(f"Error in analysis: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # Restore original functions
        os.makedirs = orig_makedirs
        eda.go.Figure.write_html = orig_write_html
        if small_dataset:
            eda.plot_candlestick_volume = orig_plot_candlestick

def create_index_html(fig_dir, report_dir, output_dir):
    """Create an enhanced single-page HTML dashboard with all analysis components"""
    # Read the summary report
    with open(os.path.join(report_dir, 'nifty_weekly_summary.md'), 'r') as f:
        summary_content = f.read()
    
    # Get list of figures
    figure_files = [f for f in os.listdir(fig_dir) if f.endswith('.html')]
    
    # Create the HTML file with a modern design
    index_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nifty 50 Advanced Technical Analysis</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --primary: #2c3e50;
            --secondary: #3498db;
            --accent: #2ecc71;
            --warning: #e74c3c;
            --neutral: #ecf0f1;
            --dark: #2c3e50;
            --light: #f9f9f9;
            --shadow: rgba(0, 0, 0, 0.1);
        }}
        
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: 'Roboto', sans-serif;
            background-color: var(--light);
            color: var(--dark);
            line-height: 1.6;
        }}
        
        .dashboard {{
            display: grid;
            grid-template-rows: auto auto 1fr;
            height: 100vh;
            max-width: 100%;
            margin: 0 auto;
            overflow: hidden;
        }}
        
        header {{
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 10px var(--shadow);
        }}
        
        .header-title {{
            display: flex;
            flex-direction: column;
        }}
        
        .header-title h1 {{
            font-size: 1.8rem;
            font-weight: 700;
            margin: 0;
        }}
        
        .header-title .subtitle {{
            font-size: 0.9rem;
            opacity: 0.9;
        }}
        
        .timestamp {{
            font-size: 0.8rem;
            opacity: 0.8;
        }}
        
        .tabs {{
            display: flex;
            background-color: white;
            box-shadow: 0 2px 5px var(--shadow);
            position: relative;
            z-index: 10;
        }}
        
        .tab-button {{
            padding: 0.75rem 1.5rem;
            border: none;
            background: none;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 500;
            color: var(--dark);
            position: relative;
            transition: all 0.3s ease;
        }}
        
        .tab-button:hover {{
            color: var(--secondary);
        }}
        
        .tab-button.active {{
            color: var(--secondary);
        }}
        
        .tab-button.active::after {{
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 3px;
            background-color: var(--secondary);
        }}
        
        .content {{
            padding: 0;
            overflow: hidden;
            position: relative;
            display: flex;
            flex-direction: column;
        }}
        
        .tab-content {{
            display: none;
            height: calc(100vh - 120px);
            overflow: auto;
            padding: 1rem;
        }}
        
        .tab-content.active {{
            display: block;
        }}
        
        .grid-layout {{
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            grid-template-rows: repeat(2, 1fr);
            gap: 1rem;
            height: 100%;
        }}
        
        .chart-container {{
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px var(--shadow);
            overflow: hidden;
            height: 100%;
            position: relative;
        }}
        
        .chart-container iframe {{
            border: none;
            width: 100%;
            height: 100%;
        }}
        
        .chart-title {{
            background-color: var(--primary);
            color: white;
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
            font-weight: 500;
        }}
        
        .summary-container {{
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px var(--shadow);
            overflow: auto;
            padding: 1.5rem;
        }}
        
        .summary {{
            background-color: var(--light);
            border-left: 4px solid var(--secondary);
            padding: 1rem;
            margin-bottom: 1rem;
            border-radius: 4px;
        }}
        
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1rem;
            margin-bottom: 1rem;
        }}
        
        .stat-card {{
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px var(--shadow);
            padding: 1rem;
            display: flex;
            flex-direction: column;
        }}
        
        .stat-title {{
            font-size: 0.8rem;
            color: #666;
            margin-bottom: 0.5rem;
        }}
        
        .stat-value {{
            font-size: 1.5rem;
            font-weight: 700;
        }}
        
        .stat-positive {{
            color: var(--accent);
        }}
        
        .stat-negative {{
            color: var(--warning);
        }}
        
        .insights {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1rem;
        }}
        
        .insight-card {{
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px var(--shadow);
            padding: 1rem;
        }}
        
        .insight-title {{
            display: flex;
            align-items: center;
            margin-bottom: 0.5rem;
            font-weight: 500;
        }}
        
        .insight-title span {{
            margin-left: 0.5rem;
        }}
        
        .indicator {{
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }}
        
        .indicator.bullish {{
            background-color: var(--accent);
        }}
        
        .indicator.bearish {{
            background-color: var(--warning);
        }}
        
        .indicator.neutral {{
            background-color: #f39c12;
        }}
        
        @media (max-width: 768px) {{
            .grid-layout {{
                grid-template-columns: 1fr;
                grid-template-rows: repeat(4, 400px);
            }}
            
            .stats-grid {{
                grid-template-columns: repeat(2, 1fr);
            }}
        }}
    </style>
</head>
<body>
    <div class="dashboard">
        <header>
            <div class="header-title">
                <h1>Nifty 50</h1>
                <span class="subtitle">Advanced Technical Analysis Dashboard</span>
            </div>
            <div class="timestamp">Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
        </header>
        
        <div class="tabs">
            <button class="tab-button active" onclick="openTab('dashboard')">Dashboard</button>
            <button class="tab-button" onclick="openTab('details')">Detailed Charts</button>
            <button class="tab-button" onclick="openTab('summary')">Technical Summary</button>
        </div>
        
        <div class="content">
            <!-- Dashboard Tab -->
            <div id="dashboard" class="tab-content active">
                <div class="grid-layout">
                    <div class="chart-container">
                        <div class="chart-title">Price Action & Volume</div>
                        <iframe src="figures/nifty_price_action.html"></iframe>
                    </div>
                    <div class="chart-container">
                        <div class="chart-title">Key Technical Indicators</div>
                        <iframe src="figures/nifty_technical_indicators.html"></iframe>
                    </div>
                    <div class="chart-container">
                        <div class="chart-title">Volatility Analysis</div>
                        <iframe src="figures/nifty_volatility.html"></iframe>
                    </div>
                    <div class="chart-container">
                        <div class="chart-title">Market Regimes</div>
                        <iframe src="figures/nifty_regimes.html"></iframe>
                    </div>
                </div>
            </div>
            
            <!-- Details Tab -->
            <div id="details" class="tab-content">
                <h2>Individual Charts</h2>
                <p>Click on any chart to open in full screen:</p>
                <div class="chart-links" style="display: flex; flex-wrap: wrap; gap: 10px; margin: 1rem 0;">
                    {"".join([f'<a href="figures/{file}" class="chart-link" target="_blank" style="padding: 10px 15px; background-color: white; border-radius: 4px; box-shadow: 0 2px 5px var(--shadow); text-decoration: none; color: var(--dark);">{file.replace(".html", "").replace("nifty_", "").title()}</a>' for file in figure_files])}
                </div>
                
                <div class="summary-container">
                    <h2>Technical Analysis</h2>
                    <pre style="white-space: pre-wrap;">{summary_content}</pre>
                </div>
            </div>
            
            <!-- Summary Tab -->
            <div id="summary" class="tab-content">
                <!-- Parse summary content to extract key metrics -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-title">Weekly Return</div>
                        <div class="stat-value" id="weekly-return">--</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-title">Current Price</div>
                        <div class="stat-value" id="current-price">--</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-title">RSI (14)</div>
                        <div class="stat-value" id="rsi-value">--</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-title">Sentiment</div>
                        <div class="stat-value" id="sentiment">--</div>
                    </div>
                </div>
                
                <div class="summary">
                    <pre style="white-space: pre-wrap; font-family: inherit;">{summary_content}</pre>
                </div>
                
                <h2>Key Insights</h2>
                <div class="insights">
                    <div class="insight-card">
                        <div class="insight-title">
                            <div class="indicator" id="trend-indicator"></div>
                            <span>Price Trend</span>
                        </div>
                        <p id="trend-insight">Loading trend analysis...</p>
                    </div>
                    <div class="insight-card">
                        <div class="insight-title">
                            <div class="indicator" id="momentum-indicator"></div>
                            <span>Momentum</span>
                        </div>
                        <p id="momentum-insight">Loading momentum analysis...</p>
                    </div>
                    <div class="insight-card">
                        <div class="insight-title">
                            <div class="indicator" id="volatility-indicator"></div>
                            <span>Volatility</span>
                        </div>
                        <p id="volatility-insight">Loading volatility analysis...</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Tab functionality
        function openTab(tabName) {{
            const tabContents = document.getElementsByClassName('tab-content');
            for (let i = 0; i < tabContents.length; i++) {{
                tabContents[i].classList.remove('active');
            }}
            
            const tabButtons = document.getElementsByClassName('tab-button');
            for (let i = 0; i < tabButtons.length; i++) {{
                tabButtons[i].classList.remove('active');
            }}
            
            document.getElementById(tabName).classList.add('active');
            event.currentTarget.classList.add('active');
        }}
        
        // Extract values from summary
        window.onload = function() {{
            const summaryText = document.querySelector('.summary pre').textContent;
            
            // Extract weekly return
            const weeklyReturnMatch = summaryText.match(/Weekly Return.*?([+-]?\\d+\\.\\d+)%/);
            if (weeklyReturnMatch && weeklyReturnMatch[1]) {{
                const weeklyReturn = parseFloat(weeklyReturnMatch[1]);
                const weeklyReturnEl = document.getElementById('weekly-return');
                weeklyReturnEl.textContent = weeklyReturn.toFixed(2) + '%';
                if (weeklyReturn > 0) {{
                    weeklyReturnEl.classList.add('stat-positive');
                }} else if (weeklyReturn < 0) {{
                    weeklyReturnEl.classList.add('stat-negative');
                }}
            }}
            
            // Extract current price
            const currentPriceMatch = summaryText.match(/Current Price.*?(\\d+\\.\\d+)/);
            if (currentPriceMatch && currentPriceMatch[1]) {{
                document.getElementById('current-price').textContent = currentPriceMatch[1];
            }}
            
            // Extract RSI
            const rsiMatch = summaryText.match(/RSI \\(14\\).*?(\\d+\\.\\d+)/);
            if (rsiMatch && rsiMatch[1]) {{
                const rsi = parseFloat(rsiMatch[1]);
                const rsiEl = document.getElementById('rsi-value');
                rsiEl.textContent = rsi.toFixed(2);
                if (rsi > 70) {{
                    rsiEl.classList.add('stat-negative');
                }} else if (rsi < 30) {{
                    rsiEl.classList.add('stat-positive');
                }}
            }}
            
            // Extract sentiment
            if (summaryText.includes('Bullish')) {{
                document.getElementById('sentiment').textContent = 'Bullish';
                document.getElementById('sentiment').classList.add('stat-positive');
            }} else if (summaryText.includes('Bearish')) {{
                document.getElementById('sentiment').textContent = 'Bearish';
                document.getElementById('sentiment').classList.add('stat-negative');
            }} else {{
                document.getElementById('sentiment').textContent = 'Neutral';
            }}
            
            // Set trend insights
            if (summaryText.includes('Bullish')) {{
                document.getElementById('trend-indicator').classList.add('bullish');
                document.getElementById('trend-insight').textContent = 'The price is showing a bullish trend. Support levels are holding well.';
            }} else if (summaryText.includes('Bearish')) {{
                document.getElementById('trend-indicator').classList.add('bearish');
                document.getElementById('trend-insight').textContent = 'The price is in a bearish trend. Watch key support levels for potential breakdowns.';
            }} else {{
                document.getElementById('trend-indicator').classList.add('neutral');
                document.getElementById('trend-insight').textContent = 'The price is showing a sideways trend with no clear direction.';
            }}
            
            // Set momentum insights based on RSI and MACD
            if (summaryText.includes('RSI') && summaryText.includes('MACD')) {{
                if (summaryText.includes('Overbought') || (summaryText.includes('RSI') && summaryText.includes('> 70'))) {{
                    document.getElementById('momentum-indicator').classList.add('bearish');
                    document.getElementById('momentum-insight').textContent = 'Momentum is extremely high with overbought conditions. Watch for potential reversal.';
                }} else if (summaryText.includes('Oversold') || (summaryText.includes('RSI') && summaryText.includes('< 30'))) {{
                    document.getElementById('momentum-indicator').classList.add('bullish');
                    document.getElementById('momentum-insight').textContent = 'Momentum is extremely low with oversold conditions. Watch for potential bounce.';
                }} else if (summaryText.includes('MACD') && summaryText.includes('Bullish')) {{
                    document.getElementById('momentum-indicator').classList.add('bullish');
                    document.getElementById('momentum-insight').textContent = 'Momentum is positive with MACD showing bullish signals.';
                }} else if (summaryText.includes('MACD') && summaryText.includes('Bearish')) {{
                    document.getElementById('momentum-indicator').classList.add('bearish');
                    document.getElementById('momentum-insight').textContent = 'Momentum is negative with MACD showing bearish signals.';
                }} else {{
                    document.getElementById('momentum-indicator').classList.add('neutral');
                    document.getElementById('momentum-insight').textContent = 'Momentum indicators are showing mixed signals.';
                }}
            }}
            
            // Set volatility insights
            if (summaryText.includes('BB ')) {{
                if (summaryText.includes('Above upper band')) {{
                    document.getElementById('volatility-indicator').classList.add('bearish');
                    document.getElementById('volatility-insight').textContent = 'Volatility is high with price above upper Bollinger Band. Expect potential reversion to mean.';
                }} else if (summaryText.includes('Below lower band')) {{
                    document.getElementById('volatility-indicator').classList.add('bullish');
                    document.getElementById('volatility-insight').textContent = 'Volatility is high with price below lower Bollinger Band. Expect potential reversion to mean.';
                }} else if (summaryText.includes('Within bands')) {{
                    document.getElementById('volatility-indicator').classList.add('neutral');
                    document.getElementById('volatility-insight').textContent = 'Volatility is moderate with price contained within Bollinger Bands.';
                }}
            }}
        }};
    </script>
</body>
</html>
"""
    
    # Write the index file
    with open(os.path.join(output_dir, 'index.html'), 'w') as f:
        f.write(index_html)
    
    print(f"Created enhanced dashboard at: {output_dir}/index.html")

if __name__ == "__main__":
    args = parse_args()
    run_nifty_analysis(
        days=args.days,
        filter_current_week=not args.no_filter,
        output_dir=args.output_dir,
        small_dataset=args.small_dataset
    ) 