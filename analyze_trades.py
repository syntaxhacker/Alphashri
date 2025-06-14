#!/usr/bin/env python3
"""
Analyze trade patterns from optimization results
"""

import json
import pandas as pd
from datetime import datetime
import glob

def analyze_trades():
    # Load the most recent results
    files = glob.glob('optimization_results_*.json')
    if not files:
        print('No optimization results found')
        return
    
    latest_file = max(files)
    print(f'Loading: {latest_file}')
    
    with open(latest_file, 'r') as f:
        data = json.load(f)
    
    # Get the best result
    best_result = data['best_parameters']['results'][0]
    trades = best_result['trades']
    
    print(f'\nTotal trades: {len(trades)}')
    print(f'Symbol: {best_result["symbol"]}')
    print(f'Date range: {best_result["start_date"]} to {best_result["end_date"]}')
    
    # Show first 10 trades
    print('\nFirst 10 trades:')
    for i, trade in enumerate(trades[:10]):
        entry_time = pd.to_datetime(trade['entry_time'])
        exit_time = pd.to_datetime(trade['exit_time'])
        duration = exit_time - entry_time
        duration_minutes = duration.total_seconds() / 60
        print(f'{i+1:2d}. {trade["side"]} | Entry: {entry_time.strftime("%m-%d %H:%M:%S")} | Exit: {exit_time.strftime("%m-%d %H:%M:%S")} | Duration: {duration} | P&L: {trade["pnl_percent"]:.2f}% | Reason: {trade["exit_reason"]}')
    
    # Analyze trade durations
    durations = []
    rapid_trades = 0
    very_rapid_trades = 0
    
    for trade in trades:
        entry_time = pd.to_datetime(trade['entry_time'])
        exit_time = pd.to_datetime(trade['exit_time'])
        duration = exit_time - entry_time
        duration_minutes = duration.total_seconds() / 60
        durations.append(duration_minutes)
        
        if duration_minutes < 5:  # Less than 5 minutes
            rapid_trades += 1
        if duration_minutes < 1:  # Less than 1 minute (same bar)
            very_rapid_trades += 1
    
    print(f'\nTrade Duration Analysis:')
    print(f'Rapid trades (< 5 min): {rapid_trades}/{len(trades)} ({rapid_trades/len(trades)*100:.1f}%)')
    print(f'Very rapid trades (< 1 min): {very_rapid_trades}/{len(trades)} ({very_rapid_trades/len(trades)*100:.1f}%)')
    print(f'Average duration: {sum(durations)/len(durations):.1f} minutes')
    print(f'Min duration: {min(durations):.1f} minutes')
    print(f'Max duration: {max(durations):.1f} minutes')
    
    # Check exit reasons
    exit_reasons = {}
    for trade in trades:
        reason = trade['exit_reason']
        exit_reasons[reason] = exit_reasons.get(reason, 0) + 1
    
    print(f'\nExit Reasons:')
    for reason, count in exit_reasons.items():
        print(f'{reason}: {count} ({count/len(trades)*100:.1f}%)')
    
    # Check signal frequency
    print(f'\nStrategy Analysis:')
    print(f'This suggests the strategy is generating signals every minute or so,')
    print(f'which is likely too frequent for a realistic trading strategy.')

if __name__ == "__main__":
    analyze_trades() 