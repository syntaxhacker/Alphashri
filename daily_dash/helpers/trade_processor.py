from typing import List, Dict, Any
from datetime import datetime

def process_trades(raw_trades: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Process raw trades to create entry/exit pairs.
    
    Args:
        raw_trades: List of raw trade dictionaries from log parser
        
    Returns:
        List of processed trade dictionaries with entry/exit pairs
    """
    processed_trades = []
    open_trades = {}  # Dictionary to track open trades by symbol
    
    for trade in raw_trades:
        if trade['action'].startswith('ENTRY'):
            # Open a new trade
            open_trades[trade['symbol']] = {
                'symbol': trade['symbol'],
                'entry_time': trade['timestamp'],
                'entry_price': trade['price'],
                'qty': trade['qty'],
                'symbol_name': trade['symbol'].replace('NSE:', ''),
                'exit_time': None,
                'exit_price': None,
                'exit_reason': None,
                'pl_amount': trade['pl_amount'],
                'pl_percent': trade['pl_percent'],
                'pl_class': trade['pl_class'],
                'pl_symbol': trade['pl_symbol'],
                'action': trade['action']
            }
        elif trade['action'].startswith('EXIT'):
            # Close the open trade for this symbol
            if trade['symbol'] in open_trades:
                entry_trade = open_trades[trade['symbol']]
                entry_trade['exit_time'] = trade['timestamp']
                entry_trade['exit_price'] = trade['price']
                entry_trade['exit_reason'] = trade['alert_type'].split(':')[0].strip()
                entry_trade['pl_amount'] = trade['pl_amount']
                entry_trade['pl_percent'] = trade['pl_percent']
                entry_trade['pl_class'] = trade['pl_class']
                entry_trade['pl_symbol'] = trade['pl_symbol']
                entry_trade['action'] = trade['action']
                
                processed_trades.append(entry_trade)
                del open_trades[trade['symbol']]
    
    # Sort by entry time (most recent first)
    return sorted(processed_trades, key=lambda x: x['entry_time'], reverse=True)

def calculate_summary_stats(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Calculate summary statistics for the trades.
    
    Args:
        trades: List of processed trades
        
    Returns:
        Dictionary containing summary statistics
    """
    if not trades:
        return {
            'total_pnl': 0,
            'total_trades': 0,
            'win_rate': 0,
            'top_wins': [],
            'top_losses': []
        }
    
    # Calculate total P&L
    total_pnl = sum(trade['pl_amount'] for trade in trades)
    
    # Calculate total trades
    total_trades = len(trades)
    
    # Calculate win rate
    winning_trades = [trade for trade in trades if trade['pl_amount'] > 0]
    win_rate = (len(winning_trades) / total_trades) * 100 if total_trades > 0 else 0
    
    # Get top wins and losses
    sorted_by_pnl = sorted(trades, key=lambda x: x['pl_amount'], reverse=True)
    top_wins = [trade for trade in sorted_by_pnl if trade['pl_amount'] > 0][:10]
    top_losses = [trade for trade in sorted_by_pnl if trade['pl_amount'] < 0][:10]
    
    return {
        'total_pnl': total_pnl,
        'total_trades': total_trades,
        'win_rate': win_rate,
        'top_wins': top_wins,
        'top_losses': top_losses
    }

def generate_time_labels() -> List[str]:
    """
    Generate time labels for trading day (9:15 AM to 3:30 PM).
    
    Returns:
        List of time labels as strings
    """
    time_labels = []
    
    # Generate time labels for current trading day (9:15 AM to 3:30 PM)
    start_hour = 9
    start_minute = 15
    end_hour = 15
    end_minute = 30
    
    for hour in range(start_hour, end_hour + 1):
        start_min = start_minute if hour == start_hour else 0
        end_min = end_minute if hour == end_hour else 59
        
        for minute in range(start_min, end_min + 1, 15):  # 15-minute intervals
            time_str = f"{hour:02d}:{minute:02d}"
            time_labels.append(time_str)
    
    return time_labels

def calculate_cumulative_pnl(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Calculate cumulative P&L and generate chart data.
    
    Args:
        trades: List of processed trades
        
    Returns:
        Dictionary containing chart data and markers
    """
    # Sort trades by entry time (chronological order)
    sorted_trades = sorted(trades, key=lambda x: x['entry_time'])
    
    # Initialize P&L data with actual trade timeline
    pnl_data = []
    cumulative_pnl = 0
    
    # Create array to track all P&L events (entry and exit)
    pnl_events = []
    
    # Process each trade and create events
    for trade in sorted_trades:
        # Entry event (no P&L change, just tracking)
        pnl_events.append({
            'time': trade['entry_time'],
            'type': 'ENTRY',
            'trade': trade,
            'cumulative_pnl': cumulative_pnl,
            'amount': 0
        })
        
        # Exit event (actual P&L realization)
        cumulative_pnl += trade['pl_amount']
        pnl_events.append({
            'time': trade['exit_time'],
            'type': 'EXIT',
            'trade': trade,
            'cumulative_pnl': cumulative_pnl,
            'amount': trade['pl_amount']
        })
    
    # Sort events by time
    pnl_events.sort(key=lambda x: x['time'])
    
    # Generate time labels based on actual trade events
    all_times = list(set(event['time'] for event in pnl_events))
    all_times.sort()
    
    # Create P&L data points for each event
    for time in all_times:
        event = next((e for e in pnl_events if e['time'] == time), None)
        pnl_data.append({
            'time': time,
            'cumulative_pnl': event['cumulative_pnl'] if event else 0,
            'event': event
        })
    
    # Prepare markers for chart
    exit_markers = [event for event in pnl_events if event['type'] == 'EXIT']
    entry_markers = [event for event in pnl_events if event['type'] == 'ENTRY']
    
    return {
        'pnl_data': pnl_data,
        'entry_markers': entry_markers,
        'exit_markers': exit_markers,
        'time_labels': [time.strftime('%H:%M:%S') for time in all_times],
        'all_times': all_times
    }