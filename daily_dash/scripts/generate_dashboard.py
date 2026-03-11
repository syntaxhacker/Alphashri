#!/usr/bin/env python3
"""
Trading Dashboard Generator

This script reads a log file, processes trade data, and generates a 
standalone HTML dashboard using Jinja2 templating.
"""

import json
import sys
import os
from datetime import datetime
from jinja2 import Environment, FileSystemLoader, select_autoescape

# Add the project root to the Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from helpers.log_parser import parse_log_file
from helpers.trade_processor import process_trades, calculate_summary_stats, calculate_cumulative_pnl

def get_alert_class(exit_reason):
    """Get CSS class for alert type based on exit reason."""
    if not exit_reason:
        return 'alert-price-move'
    
    exit_reason_lower = exit_reason.lower()
    
    if 'stop loss' in exit_reason_lower:
        return 'alert-stop-loss'
    elif 'trailing stop' in exit_reason_lower:
        return 'alert-trailing-stop'
    elif 'script_stopped' in exit_reason_lower or 'bulk exit' in exit_reason_lower:
        return 'alert-script-stopped'
    elif 'target achieved' in exit_reason_lower:
        return 'alert-target-achieved'
    else:
        return 'alert-price-move'

def fix_javascript_issues(html_content):
    """Fix JavaScript syntax issues in the rendered HTML"""
    # Fix the quote encoding issue - replace &#34; with regular quotes
    html_content = html_content.replace('&#34;', '"')
    
    # Fix the chartData scope issue by ensuring proper variable declaration
    # The template should use chartData as a global variable
    if 'const chartData =' in html_content:
        # Replace const with var to ensure proper hoisting
        html_content = html_content.replace('const chartData =', 'var chartData =')
    
    return html_content

def main():
    """Main function to generate the dashboard."""
    print("Starting dashboard generation...")
    
    # Ensure directories exist
    Config.ensure_directories()
    
    # Step 1: Parse the log file
    print(f"Parsing log file: {Config.LOG_FILE_PATH}")
    raw_trades = parse_log_file(Config.LOG_FILE_PATH)
    
    if not raw_trades:
        print("No trades found in the log file.")
        return
    
    print(f"Found {len(raw_trades)} raw trade entries")
    
    # Step 2: Process trades to create entry/exit pairs
    print("Processing trades...")
    processed_trades = process_trades(raw_trades)
    
    # Add alert_class to each trade for AG Grid
    for trade in processed_trades:
        trade['alert_class'] = get_alert_class(trade.get('exit_reason'))
        
    if not processed_trades:
        print("No processed trades found.")
        return
    
    print(f"Processed {len(processed_trades)} complete trades")
    
    # Step 3: Calculate summary statistics
    print("Calculating summary statistics...")
    summary_stats = calculate_summary_stats(processed_trades)
    
    # Step 4: Calculate cumulative P&L for chart
    print("Calculating cumulative P&L...")
    chart_data = calculate_cumulative_pnl(processed_trades)
    
    # Convert datetime objects to strings for JSON serialization
    def convert_datetime_to_str(obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        elif isinstance(obj, dict):
            return {k: convert_datetime_to_str(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_datetime_to_str(item) for item in obj]
        else:
            return obj
    
    # Convert chart data for JSON serialization
    chart_data_serializable = convert_datetime_to_str(chart_data)
    chart_data_json = json.dumps(chart_data_serializable, indent=2)

    # Convert trades data for JSON serialization
    trades_data_serializable = convert_datetime_to_str(processed_trades)
    trades_json = json.dumps(trades_data_serializable, indent=2)
    
    # Convert summary stats for JSON serialization
    summary_stats_serializable = {
        'total_pnl': summary_stats['total_pnl'],
        'total_trades': summary_stats['total_trades'],
        'win_rate': summary_stats['win_rate'],
        'top_wins': convert_datetime_to_str(summary_stats['top_wins']),
        'top_losses': convert_datetime_to_str(summary_stats['top_losses'])
    }

    # Step 5: Prepare template data
    template_data = {
        'trades': processed_trades,
        'summary_stats': summary_stats_serializable,
        'chart_data_json': chart_data_json,
        'trades_json': trades_json,
        'get_alert_class': get_alert_class,
        'generation_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }
    
    # Step 6: Render the template
    print("Rendering template...")
    
    # Set up Jinja2 environment with custom functions
    env = Environment(
        loader=FileSystemLoader('template'),
        autoescape=select_autoescape(['html', 'xml']),
        extensions=['jinja2.ext.do']
    )
    
    # Add custom functions
    env.globals['abs'] = abs
    
    # Load and render the template
    template = env.get_template('index.html')
    rendered_html = template.render(**template_data)
    
    # Fix JavaScript issues in the rendered HTML
    rendered_html = fix_javascript_issues(rendered_html)
    
    # Step 7: Save the rendered HTML
    print(f"Saving dashboard to: {Config.OUTPUT_PATH}")
    os.makedirs(os.path.dirname(Config.OUTPUT_PATH), exist_ok=True)
    
    with open(Config.OUTPUT_PATH, 'w', encoding='utf-8') as f:
        f.write(rendered_html)
    
    print(f"Dashboard generated successfully!")
    print(f"Open {Config.OUTPUT_PATH} in your browser to view the dashboard.")
    
    # Print summary
    print("\n" + "="*50)
    print("DASHBOARD SUMMARY")
    print("="*50)
    print(f"Total Trades: {summary_stats['total_trades']}")
    print(f"Total P&L: ₹{summary_stats['total_pnl']:.2f}")
    print(f"Win Rate: {summary_stats['win_rate']:.1f}%")
    print(f"Winning Trades: {len(summary_stats['top_wins'])}")
    print(f"Losing Trades: {len(summary_stats['top_losses'])}")
    print("="*50)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error generating dashboard: {e}")
        sys.exit(1)
