#!/usr/bin/env python3
"""
Sector Contributors API

Flask API that dynamically fetches which stocks contributed to a sector's
performance using Upstox historical data.

Run with: python sector_contributors_api.py
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import sys
from pathlib import Path

# Add project root
_project_root = Path(__file__).parent.parent
sys.path.insert(0, str(_project_root))

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Sector to stocks mapping
SECTOR_REPRESENTATIVES = {
    'Finance': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK'],
    'Technology': ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LTIM'],
    'Energy': ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'TATAPOWER'],
    'Automotive': ['TATAMOTORS', 'MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT'],
    'Pharma': ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'AUROPHARMA', 'DIVISLAB'],
    'Consumer': ['TITAN', 'WHIRLPOOL', 'VOLTAS', 'BLUESTAR', 'HAVELLS'],
    'Infrastructure': ['LT', 'DLF', 'ADANIPORTS', 'BHARTIARTL', 'ABB'],
    'Metals': ['TATASTEEL', 'HINDALCO', 'JSWSTEEL', 'COALINDIA', 'NMDC'],
    'FMCG': ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR'],
    'Healthcare': ['APOLLOHOSP', 'MAXHEALTH', 'FORTIS', 'GLENMARK'],
    'Telecom': ['RELIANCE', 'BHARTIARTL', 'VODAFONEIDEA'],
    'Chemicals': ['PIIND', 'SRF', 'DEEPAKNTR', 'TATACHEM'],
    'Oil & Gas': ['RELIANCE', 'ONGC', 'GAIL', 'BPCL', 'IOC'],
    'Power': ['NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIPOWER', 'JSWENERGY'],
    'Real Estate': ['DLF', 'GODREJPROP', 'BRIGADE', 'OBEROIRLTY', 'PHOENIXLTD']
}

# Cache for API instance
_api_instance = None

def get_api():
    """Get or create API instance."""
    global _api_instance
    if _api_instance is None:
        try:
            _api_instance = TradingAPIFactory.create_from_config('upstox', quiet=True)
            print("✅ Upstox API initialized")
        except Exception as e:
            print(f"⚠️ Failed to initialize Upstox API: {e}")
            _api_instance = False  # Mark as failed
    return _api_instance if _api_instance is not False else None

def calculate_period_start_date(range_str):
    """Calculate start date from range string (e.g., '1m', '3m', '6m', 'ytd')."""
    import re
    now = datetime.now()

    if range_str == 'ytd':
        return datetime(now.year, 1, 1)

    if isinstance(range_str, str):
        match = re.match(r'^(\d+)([dwmy])$', range_str)
        if match:
            value = int(match.group(1))
            unit = match.group(2)

            if unit == 'd':
                return now - timedelta(days=value)
            elif unit == 'w':
                return now - timedelta(weeks=value)
            elif unit == 'm':
                new_month = now.month - value
                new_year = now.year
                while new_month <= 0:
                    new_month += 12
                    new_year -= 1
                return datetime(new_year, new_month, now.day)
            elif unit == 'y':
                return datetime(now.year - value, now.month, now.day)

    # Default to 3 months
    new_month = now.month - 3
    new_year = now.year
    while new_month <= 0:
        new_month += 12
        new_year -= 1
    return datetime(new_year, new_month, now.day)

def fetch_stock_contributors(sector_name, range_str='3m'):
    """
    Fetch individual stock contributions for a sector.

    Returns:
        List of stocks with their contribution data (percentage, change, etc.)
    """
    api = get_api()
    if not api:
        return []

    symbols = SECTOR_REPRESENTATIVES.get(sector_name, [])
    if not symbols:
        return []

    # Calculate date range
    to_date = datetime.now()
    from_date = calculate_period_start_date(range_str)
    from_date_str = from_date.strftime('%Y-%m-%d')
    to_date_str = to_date.strftime('%Y-%m-%d')

    contributors = []

    for symbol in symbols:
        try:
            df = api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                from_date=from_date_str,
                to_date=to_date_str
            )

            if df is not None and not df.empty and len(df) > 10:
                start_price = df['close'].iloc[0]
                end_price = df['close'].iloc[-1]
                period_return = ((end_price / start_price) - 1) * 100

                # Calculate momentum for different periods
                # 1M momentum
                m1_start_idx = max(0, len(df) - 22)
                m1_return = ((df['close'].iloc[-1] / df['close'].iloc[m1_start_idx]) - 1) * 100 if len(df) > 22 else period_return

                # 3M momentum
                m3_start_idx = max(0, len(df) - 66)
                m3_return = ((df['close'].iloc[-1] / df['close'].iloc[m3_start_idx]) - 1) * 100 if len(df) > 66 else period_return

                # Calculate average volume
                avg_volume = df['volume'].mean() if 'volume' in df.columns else 0

                contributors.append({
                    'symbol': symbol,
                    'startPrice': round(start_price, 2),
                    'endPrice': round(end_price, 2),
                    'periodReturn': round(period_return, 2),
                    'm1Return': round(m1_return, 2),
                    'm3Return': round(m3_return, 2),
                    'avgVolume': int(avg_volume) if avg_volume > 0 else 0,
                    'dataPoints': len(df)
                })
        except Exception as e:
            print(f"Error fetching {symbol}: {e}")
            continue

    # Sort by period return
    contributors.sort(key=lambda x: x['periodReturn'], reverse=True)

    return contributors

def fetch_sector_volume_data(sector_name, range_str='2y'):
    """
    Fetch daily volume data for a sector (aggregated from all stocks).

    Returns:
        List of daily volume data with date and total volume
    """
    api = get_api()
    if not api:
        return []

    symbols = SECTOR_REPRESENTATIVES.get(sector_name, [])
    if not symbols:
        return []

    # Calculate date range - default to 2 years for better historical analysis
    to_date = datetime.now()
    from_date = calculate_period_start_date(range_str)
    from_date_str = from_date.strftime('%Y-%m-%d')
    to_date_str = to_date.strftime('%Y-%m-%d')

    # Dictionary to store volumes by date
    volume_by_date = {}

    for symbol in symbols:
        try:
            df = api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                from_date=from_date_str,
                to_date=to_date_str
            )

            if df is not None and not df.empty and 'volume' in df.columns:
                for idx, row in df.iterrows():
                    # Extract date from index if it's a DatetimeIndex
                    if isinstance(idx, pd.Timestamp):
                        date_key = idx.strftime('%Y-%m-%d')
                    else:
                        date_key = str(idx).split(' ')[0] if ' ' in str(idx) else str(idx)

                    if date_key not in volume_by_date:
                        volume_by_date[date_key] = {
                            'date': date_key,
                            'volume': 0,
                            'stocks': 0
                        }

                    volume_by_date[date_key]['volume'] += int(row['volume'])
                    volume_by_date[date_key]['stocks'] += 1
        except Exception as e:
            print(f"Error fetching volume for {symbol}: {e}")
            continue

    # Convert to list and calculate average volume for normalization
    volume_list = list(volume_by_date.values())

    if volume_list:
        avg_volume = sum(v['volume'] for v in volume_list) / len(volume_list)

        # Normalize volume as percentage of average
        for v in volume_list:
            v['normalizedVolume'] = round((v['volume'] / avg_volume) * 100, 1) if avg_volume > 0 else 100

    # Sort by date
    volume_list.sort(key=lambda x: x['date'])

    return volume_list

@app.route('/api/sector-contributors', methods=['GET'])
def get_sector_contributors():
    """
    Get stock contributors for a sector.

    Query params:
        - sector: Sector name (required)
        - range: Time range like '1m', '3m', '6m', 'ytd' (default: '3m')
    """
    sector = request.args.get('sector')
    range_str = request.args.get('range', '3m')

    if not sector:
        return jsonify({'error': 'Sector parameter is required'}), 400

    print(f"Fetching contributors for {sector} (range: {range_str})...")

    contributors = fetch_stock_contributors(sector, range_str)

    return jsonify({
        'sector': sector,
        'range': range_str,
        'contributors': contributors,
        'totalStocks': len(contributors),
        'fetchedAt': datetime.now().isoformat()
    })

@app.route('/api/sectors', methods=['GET'])
def get_sectors():
    """Get list of all available sectors."""
    return jsonify({
        'sectors': list(SECTOR_REPRESENTATIVES.keys()),
        'count': len(SECTOR_REPRESENTATIVES)
    })

@app.route('/api/sector-volume', methods=['GET'])
def get_sector_volume():
    """
    Get daily volume data for a sector (aggregated from all stocks).

    Query params:
        - sector: Sector name (required)
        - range: Time range like '1m', '3m', '6m', '1y', '2y', '3y', '5y' (default: '2y')
    """
    sector = request.args.get('sector')
    range_str = request.args.get('range', '2y')

    if not sector:
        return jsonify({'error': 'Sector parameter is required'}), 400

    print(f"Fetching volume data for {sector} (range: {range_str})...")

    volume_data = fetch_sector_volume_data(sector, range_str)

    # Calculate statistics
    if volume_data:
        volumes = [v['volume'] for v in volume_data]
        avg_volume = sum(volumes) / len(volumes)
        max_volume = max(volumes)
        min_volume = min(volumes)

        # Count high volume days (> 1.5x average)
        high_volume_days = [v for v in volume_data if v['volume'] > avg_volume * 1.5]
    else:
        avg_volume = max_volume = min_volume = 0
        high_volume_days = []

    return jsonify({
        'sector': sector,
        'range': range_str,
        'volumeData': volume_data,
        'statistics': {
            'avgVolume': int(avg_volume),
            'maxVolume': int(max_volume),
            'minVolume': int(min_volume),
            'highVolumeDays': len(high_volume_days),
            'totalDays': len(volume_data)
        },
        'fetchedAt': datetime.now().isoformat()
    })

@app.route('/api/all-sectors-volume', methods=['GET'])
def get_all_sectors_volume():
    """
    Get volume data for all sectors.

    Query params:
        - range: Time range like '1m', '3m', '6m', '1y', 'ytd' (default: '3m')
    """
    range_str = request.args.get('range', '3m')

    print(f"Fetching volume data for all sectors (range: {range_str})...")

    all_volume_data = {}
    for sector in SECTOR_REPRESENTATIVES.keys():
        try:
            volume_data = fetch_sector_volume_data(sector, range_str)
            all_volume_data[sector] = {
                'data': volume_data,
                'avgVolume': sum(v['volume'] for v in volume_data) / len(volume_data) if volume_data else 0
            }
        except Exception as e:
            print(f"Error fetching volume for {sector}: {e}")
            all_volume_data[sector] = {'data': [], 'avgVolume': 0}

    return jsonify({
        'range': range_str,
        'sectors': all_volume_data,
        'fetchedAt': datetime.now().isoformat()
    })

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    api = get_api()
    return jsonify({
        'status': 'healthy',
        'api_initialized': api is not None,
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("=" * 70)
    print("  SECTOR CONTRIBUTORS API")
    print("  Fetching dynamic stock contributions from Upstox")
    print("=" * 70)
    print("\nEndpoints:")
    print("  GET /api/health              - Health check")
    print("  GET /api/sectors             - List all sectors")
    print("  GET /api/sector-contributors - Get stock contributors for a sector")
    print("                                Query: ?sector=Technology&range=3m")
    print("\nStarting server on http://localhost:5555")
    print("=" * 70)

    app.run(host='0.0.0.0', port=5555, debug=True)
