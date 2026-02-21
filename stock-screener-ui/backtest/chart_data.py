"""
Chart Data Formatter

Converts backtest results to ECharts-compatible format for visualization.
"""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Union
import pandas as pd


def format_candle_data(candle_data: Union[pd.DataFrame, Dict]) -> List[Dict]:
    """
    Convert DataFrame or dict to ECharts candlestick format.

    Args:
        candle_data: Either a DataFrame with open, high, low, close, volume columns,
                     or a dict with 'index', 'open', 'high', 'low', 'close', 'volume' lists

    Returns:
        List of candle data dicts
    """
    candles = []

    # Handle dict format (from JSON serialization)
    if isinstance(candle_data, dict):
        indices = candle_data.get('index', [])
        opens = candle_data.get('open', [])
        highs = candle_data.get('high', [])
        lows = candle_data.get('low', [])
        closes = candle_data.get('close', [])
        volumes = candle_data.get('volume', [])

        for i in range(len(indices)):
            try:
                dt_utc = datetime.fromisoformat(indices[i].replace('Z', '+00:00'))
                if dt_utc.tzinfo is None:
                    dt_utc = dt_utc.replace(tzinfo=timezone.utc)
            except:
                continue

            dt_ist = dt_utc + timedelta(hours=5, minutes=30)

            candles.append({
                'time': dt_ist.isoformat(),
                'date': dt_ist.strftime('%Y-%m-%d'),
                'time_str': dt_ist.strftime('%H:%M'),
                'open': float(opens[i]) if i < len(opens) else 0,
                'high': float(highs[i]) if i < len(highs) else 0,
                'low': float(lows[i]) if i < len(lows) else 0,
                'close': float(closes[i]) if i < len(closes) else 0,
                'volume': int(volumes[i]) if i < len(volumes) else 0,
            })

        return candles

    # Handle DataFrame format
    for idx, row in candle_data.iterrows():
        # Convert to IST
        if idx.tz is None:
            dt_utc = idx.tz_localize('UTC')
        else:
            dt_utc = idx.tz_convert('UTC')
        dt_ist = dt_utc + timedelta(hours=5, minutes=30)

        candles.append({
            'time': dt_ist.isoformat(),
            'date': dt_ist.strftime('%Y-%m-%d'),
            'time_str': dt_ist.strftime('%H:%M'),
            'open': float(row['open']),
            'high': float(row['high']),
            'low': float(row['low']),
            'close': float(row['close']),
            'volume': int(row.get('volume', 0)),
        })

    return candles


def format_orb_zones(candles: List[Dict], or_minutes: int = 45) -> List[Dict]:
    """
    Calculate ORB zones for each trading day.

    Args:
        candles: List of candle data
        or_minutes: Opening range period in minutes

    Returns:
        List of ORB zone dicts per day
    """
    zones = []
    current_date = None
    or_candles = []

    market_open_minutes = 9 * 60 + 15  # 9:15 AM
    or_end_minutes = market_open_minutes + or_minutes

    for candle in candles:
        candle_date = candle['date']
        time_parts = candle['time_str'].split(':')
        candle_minutes = int(time_parts[0]) * 60 + int(time_parts[1])

        # New day
        if candle_date != current_date:
            # Process previous day's OR
            if or_candles and current_date:
                or_high = max(c['high'] for c in or_candles)
                or_low = min(c['low'] for c in or_candles)
                zones.append({
                    'date': current_date,
                    'or_high': round(or_high, 2),
                    'or_low': round(or_low, 2),
                    'or_end_time': f"{or_end_minutes // 60:02d}:{or_end_minutes % 60:02d}",
                })

            # Reset for new day
            current_date = candle_date
            or_candles = []

        # Collect OR candles
        if candle_minutes < or_end_minutes:
            or_candles.append(candle)

    # Process last day
    if or_candles and current_date:
        or_high = max(c['high'] for c in or_candles)
        or_low = min(c['low'] for c in or_candles)
        zones.append({
            'date': current_date,
            'or_high': round(or_high, 2),
            'or_low': round(or_low, 2),
            'or_end_time': f"{or_end_minutes // 60:02d}:{or_end_minutes % 60:02d}",
        })

    return zones


def format_trade_markers(trades: List[Dict]) -> List[Dict]:
    """
    Format trade data for chart markers.

    Args:
        trades: List of trade dicts from backtest

    Returns:
        List of formatted trade marker dicts
    """
    markers = []

    for idx, trade in enumerate(trades):
        # Entry marker
        markers.append({
            'trade_id': idx + 1,
            'type': 'entry',
            'time': trade.get('entry_time'),
            'date': trade.get('date'),
            'price': trade['entry_price'],
            'marker': {
                'symbol': 'triangle',
                'color': '#2196F3',  # Blue
                'size': 12,
            },
            'trade': {
                'entry_price': trade['entry_price'],
                'exit_price': trade['exit_price'],
                'quantity': trade['quantity'],
                'gross_pnl': trade['gross_pnl'],
                'trading_costs': trade['trading_costs'],
                'net_pnl': trade['net_pnl'],
                'net_pnl_pct': trade['net_pnl_pct'],
                'exit_reason': trade['exit_reason'],
                'hold_duration_minutes': trade.get('hold_duration_minutes', 0),
                'or_high': trade.get('or_high'),
                'or_low': trade.get('or_low'),
            }
        })

        # Exit marker
        exit_color = {
            'TP': '#4CAF50',  # Green
            'SL': '#F44336',  # Red
            'EOD': '#FFC107',  # Yellow
        }.get(trade['exit_reason'], '#FFC107')

        markers.append({
            'trade_id': idx + 1,
            'type': 'exit',
            'time': trade.get('exit_time'),
            'date': trade.get('date'),
            'price': trade['exit_price'],
            'marker': {
                'symbol': 'circle',
                'color': exit_color,
                'size': 10,
            },
            'trade': {
                'entry_price': trade['entry_price'],
                'exit_price': trade['exit_price'],
                'quantity': trade['quantity'],
                'gross_pnl': trade['gross_pnl'],
                'trading_costs': trade['trading_costs'],
                'net_pnl': trade['net_pnl'],
                'net_pnl_pct': trade['net_pnl_pct'],
                'exit_reason': trade['exit_reason'],
                'hold_duration_minutes': trade.get('hold_duration_minutes', 0),
                'or_high': trade.get('or_high'),
                'or_low': trade.get('or_low'),
            }
        })

    return markers


def build_chart_data_for_symbol(
    symbol: str,
    candles_df: pd.DataFrame,
    trades: List[Dict],
    or_minutes: int = 45
) -> Dict:
    """
    Build complete chart data for a single symbol.

    Args:
        symbol: Stock symbol
        candles_df: DataFrame with OHLCV data
        trades: List of trade dicts
        or_minutes: OR period in minutes

    Returns:
        Dict with candles, orb_zones, and trades for charting
    """
    candles = format_candle_data(candles_df)
    orb_zones = format_orb_zones(candles, or_minutes)
    trade_markers = format_trade_markers(trades)

    # Determine date range
    if candles:
        start_date = candles[0]['date']
        end_date = candles[-1]['date']
    else:
        start_date = None
        end_date = None

    return {
        'symbol': symbol,
        'candles': candles,
        'orb_zones': orb_zones,
        'trades': trade_markers,
        'date_range': {
            'start': start_date,
            'end': end_date,
        },
        'total_candles': len(candles),
        'total_trades': len(trades),
    }


def build_echarts_series(chart_data: Dict) -> Dict:
    """
    Build ECharts series configuration from chart data.

    Args:
        chart_data: Output from build_chart_data_for_symbol

    Returns:
        Dict with series configuration for ECharts
    """
    candles = chart_data['candles']
    orb_zones = chart_data['orb_zones']
    trades = chart_data['trades']

    # Candlestick data [open, close, low, high]
    candlestick_data = [
        [c['open'], c['close'], c['low'], c['high']]
        for c in candles
    ]

    # Time axis data
    time_data = [c['time'] for c in candles]

    # Entry markers
    entry_markers = [
        {
            'value': [t['time'], t['price']],
            'itemStyle': {'color': t['marker']['color']},
            'symbol': t['marker']['symbol'],
            'symbolSize': t['marker']['size'],
            'trade': t['trade'],
        }
        for t in trades if t['type'] == 'entry'
    ]

    # Exit markers by type
    tp_markers = [
        {
            'value': [t['time'], t['price']],
            'itemStyle': {'color': t['marker']['color']},
            'symbol': t['marker']['symbol'],
            'symbolSize': t['marker']['size'],
            'trade': t['trade'],
        }
        for t in trades if t['type'] == 'exit' and t['trade']['exit_reason'] == 'TP'
    ]

    sl_markers = [
        {
            'value': [t['time'], t['price']],
            'itemStyle': {'color': t['marker']['color']},
            'symbol': t['marker']['symbol'],
            'symbolSize': t['marker']['size'],
            'trade': t['trade'],
        }
        for t in trades if t['type'] == 'exit' and t['trade']['exit_reason'] == 'SL'
    ]

    eod_markers = [
        {
            'value': [t['time'], t['price']],
            'itemStyle': {'color': t['marker']['color']},
            'symbol': t['marker']['symbol'],
            'symbolSize': t['marker']['size'],
            'trade': t['trade'],
        }
        for t in trades if t['type'] == 'exit' and t['trade']['exit_reason'] == 'EOD'
    ]

    # ORB zone lines (markLine data)
    orb_high_lines = []
    orb_low_lines = []

    for zone in orb_zones:
        # Find candles for this date
        day_candles = [c for c in candles if c['date'] == zone['date']]
        if day_candles:
            # ORB High line from OR end to last candle of day
            orb_high_lines.append({
                'coord': [day_candles[0]['time'], zone['or_high']],
                'lineStyle': {'type': 'dashed', 'color': '#4CAF50', 'width': 1},
            })
            # ORB Low line
            orb_low_lines.append({
                'coord': [day_candles[0]['time'], zone['or_low']],
                'lineStyle': {'type': 'dashed', 'color': '#F44336', 'width': 1},
            })

    return {
        'xAxisData': time_data,
        'candlestick': candlestick_data,
        'series': {
            'candlestick': {
                'name': 'Price',
                'type': 'candlestick',
                'data': candlestick_data,
                'itemStyle': {
                    'color': '#4CAF50',
                    'color0': '#F44336',
                    'borderColor': '#4CAF50',
                    'borderColor0': '#F44336',
                }
            },
            'entry': {
                'name': 'Entry',
                'type': 'scatter',
                'data': entry_markers,
            },
            'tp_exit': {
                'name': 'TP Exit',
                'type': 'scatter',
                'data': tp_markers,
            },
            'sl_exit': {
                'name': 'SL Exit',
                'type': 'scatter',
                'data': sl_markers,
            },
            'eod_exit': {
                'name': 'EOD Exit',
                'type': 'scatter',
                'data': eod_markers,
            },
        },
        'orb_zones': orb_zones,
    }
