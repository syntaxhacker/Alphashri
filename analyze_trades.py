#!/usr/bin/env python3
"""
Analyze trades from optimization results
"""

import json
import pandas as pd
from datetime import datetime

def analyze_trades():
    # Load the optimization results
    with open('optimization_results_20250614_183501.json', 'r') as f:
        data = json.load(f)
    
    # Get the best results
    best_results = data['best_parameters']['results'][0]  # First symbol (ETHUSDT)
    trades = best_results['trades']
    
    print(f"📊 Trade Analysis for {best_results['symbol']}")
    print(f"Total trades: {len(trades)}")
    print(f"Total return: {best_results['total_return_percent']:.2f}%")
    print(f"Win rate: {best_results['win_rate']:.1f}%")
    print()
    
    # Analyze P&L distribution
    pnls = [trade['pnl'] for trade in trades]
    print("💰 P&L Analysis:")
    print(f"Max P&L: ${max(pnls):.2f}")
    print(f"Min P&L: ${min(pnls):.2f}")
    print(f"Average P&L: ${sum(pnls)/len(pnls):.2f}")
    print(f"Total P&L: ${sum(pnls):.2f}")
    print()
    
    # Find high P&L trades (> $50)
    high_pnl_trades = [trade for trade in trades if abs(trade['pnl']) > 50]
    print(f"🔥 High P&L trades (>$50): {len(high_pnl_trades)}")
    
    if high_pnl_trades:
        print("\nDetailed High P&L Trades:")
        for i, trade in enumerate(high_pnl_trades[:10]):  # Show top 10
            entry_time = pd.to_datetime(trade['entry_time'])
            exit_time = pd.to_datetime(trade['exit_time'])
            duration = exit_time - entry_time
            
            print(f"\n🎯 Trade {i+1}:")
            print(f"  Entry: {trade['entry_time']} at ${trade['entry_price']:.4f}")
            print(f"  Exit:  {trade['exit_time']} at ${trade['exit_price']:.4f}")
            print(f"  Side: {trade['side']}")
            print(f"  P&L: ${trade['pnl']:.2f} ({trade['pnl_percent']:.2f}%)")
            print(f"  Exit Reason: {trade['exit_reason']}")
            print(f"  Duration: {duration}")
            
            # Calculate price movement
            if trade['side'] == 'LONG':
                price_change = ((trade['exit_price'] - trade['entry_price']) / trade['entry_price']) * 100
            else:
                price_change = ((trade['entry_price'] - trade['exit_price']) / trade['entry_price']) * 100
            
            print(f"  Price Movement: {price_change:.2f}%")
    
    # Analyze exit reasons
    print("\n📋 Exit Reasons Analysis:")
    exit_reasons = {}
    for trade in trades:
        reason = trade['exit_reason']
        if reason not in exit_reasons:
            exit_reasons[reason] = {'count': 0, 'total_pnl': 0}
        exit_reasons[reason]['count'] += 1
        exit_reasons[reason]['total_pnl'] += trade['pnl']
    
    for reason, stats in exit_reasons.items():
        avg_pnl = stats['total_pnl'] / stats['count']
        print(f"  {reason}: {stats['count']} trades, Avg P&L: ${avg_pnl:.2f}")
    
    # Find potential issues
    print("\n⚠️  Potential Issues:")
    
    # Large losses
    large_losses = [t for t in trades if t['pnl'] < -100]
    if large_losses:
        print(f"  Large losses (>$100): {len(large_losses)} trades")
        for trade in large_losses[:3]:
            print(f"    Loss: ${trade['pnl']:.2f}, Reason: {trade['exit_reason']}")
    
    # Long duration trades
    long_trades = []
    for trade in trades:
        duration = pd.to_datetime(trade['exit_time']) - pd.to_datetime(trade['entry_time'])
        if duration.total_seconds() > 3600:  # > 1 hour
            long_trades.append((trade, duration))
    
    if long_trades:
        print(f"  Long duration trades (>1h): {len(long_trades)} trades")
        for trade, duration in sorted(long_trades, key=lambda x: x[1], reverse=True)[:3]:
            print(f"    Duration: {duration}, P&L: ${trade['pnl']:.2f}, Reason: {trade['exit_reason']}")

if __name__ == "__main__":
    analyze_trades() 