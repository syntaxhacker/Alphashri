#!/usr/bin/env python3
"""
Fast API server for stock screener UI.
Serves screener data as JSON.
"""
import sys
import os
import json
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading

# Add project root and scanners to path
_script_dir = Path(__file__).parent.absolute()
_project_root = _script_dir.parent
_scanners_dir = _project_root / 'scanners'
sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_scanners_dir))

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory
import trending_upside

# Cache for screener data
_cache = {'data': None, 'timestamp': None}
_cache_lock = threading.Lock()


def estimate_days_to_52w(current_price, high_52w, adx, atr, recent_return_5d, perf_w):
    """Estimate days to reach 52-week high based on trend strength and momentum."""
    if current_price >= high_52w:
        return 0, "HIGH"

    gap_pct = ((high_52w - current_price) / current_price) * 100
    if gap_pct > 15:
        return None, None

    momentum_score = (recent_return_5d + perf_w) / 2
    daily_move_pct = (atr / current_price) * 100 if atr > 0 else 0

    trend_multiplier = 1.0
    if adx >= 40:
        trend_multiplier = 1.5
    elif adx >= 25:
        trend_multiplier = 1.2
    elif adx < 20:
        trend_multiplier = 0.7

    if momentum_score > 0:
        daily_gain_pct = max(daily_move_pct * trend_multiplier, (momentum_score / 5) * trend_multiplier)
    else:
        daily_gain_pct = daily_move_pct * trend_multiplier * 0.5

    if daily_gain_pct <= 0.01:
        return None, None

    estimated_days = gap_pct / daily_gain_pct

    confidence = "LOW"
    if adx >= 35 and momentum_score > 2:
        confidence = "HIGH"
    elif adx >= 25 or (momentum_score > 1 and perf_w > 0):
        confidence = "MED"

    return round(estimated_days), confidence


def fetch_screener_data(provider='upstox', mode='historical'):
    """Fetch screener data - similar to verify_stocks() but returns JSON."""
    try:
        api = TradingAPIFactory.create_from_config(provider, quiet=True)
    except ValueError as e:
        return {'error': str(e)}

    use_intraday = (mode == 'intraday')

    if use_intraday and provider == 'upstox':
        if not api.auth_handler.access_token:
            if not api.auth_handler.authenticate():
                return {'error': 'Authentication failed'}

    tv_df = trending_upside.fetch_trending_stocks(limit=100)
    if tv_df.empty:
        return {'approaching': [], 'touched': [], 'last_updated': datetime.now().isoformat(), 'provider': provider, 'mode': mode}

    approaching = []
    touched = []
    blacklisted_symbols = set()

    for _, row in tv_df.iterrows():
        symbol = row['name']
        tv_price = row['close']

        if tv_price >= 7000:
            continue

        if symbol in blacklisted_symbols:
            continue

        instrument_key = api.get_instrument_key(symbol)
        if not instrument_key:
            blacklisted_symbols.add(symbol)
            continue

        try:
            if use_intraday:
                df_hist = api.fetch_intraday_data_v3(symbol=symbol, interval='1')
                if df_hist is None or df_hist.empty:
                    continue
            else:
                to_date = datetime.now().strftime('%Y-%m-%d')
                from_date = (datetime.now() - __import__('datetime').timedelta(days=5)).strftime('%Y-%m-%d')
                df_hist = api.fetch_historical_data_v3(
                    symbol=symbol, unit='minutes', interval=1,
                    to_date=to_date, from_date=from_date
                )

            if df_hist is not None and not df_hist.empty:
                upstox_price = float(df_hist['close'].iloc[-1])
                start_price = float(df_hist['close'].iloc[0])

                diff_pct = ((upstox_price - tv_price) / tv_price) * 100
                recent_return = ((upstox_price - start_price) / start_price) * 100

                tv_52w_high = float(row.get('price_52_week_high', 0))
                recent_high = float(df_hist['high'].max())

                high_diff_pct = ((recent_high - upstox_price) / recent_high) * 100

                adx = float(row.get('ADX', 0))
                atr = float(row.get('ATR', 0))
                perf_w = float(row.get('Perf.W', 0))

                est_days, confidence = estimate_days_to_52w(upstox_price, recent_high, adx, atr, recent_return, perf_w)

                touched_52w = False
                if tv_52w_high > 0:
                    if recent_high >= tv_52w_high:
                        touched_52w = True
                    elif (tv_52w_high - recent_high) / tv_52w_high < 0.001:
                        touched_52w = True

                stock_data = {
                    'symbol': symbol,
                    'score': int(row.get('swing_score', 0)),
                    'tv_price': round(tv_price, 2),
                    'upstox_price': round(upstox_price, 2),
                    'broker_diff': round(diff_pct, 2),
                    'to_52w_high': round(high_diff_pct, 2),
                    'recent_return_5d': round(recent_return, 1),
                    'perf_w': round(perf_w, 1),
                    'sector': str(row.get('sector', '-')),
                    'touched_52w': touched_52w
                }

                if not touched_52w and est_days is not None:
                    stock_data['time_to_52w'] = {'days': est_days, 'confidence': confidence}

                if touched_52w:
                    touched.append(stock_data)
                else:
                    approaching.append(stock_data)

        except Exception:
            pass

    return {
        'approaching': approaching,
        'touched': touched,
        'last_updated': datetime.now().isoformat(),
        'provider': provider,
        'mode': mode
    }


class ScreenerHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == '/api/screener':
            provider = params.get('provider', ['upstox'])[0]
            mode = params.get('mode', ['historical'])[0]

            # Check cache (10 second TTL)
            with _cache_lock:
                if _cache['data'] and _cache['timestamp']:
                    age = (datetime.now() - _cache['timestamp']).total_seconds()
                    if age < 10 and _cache['data'].get('provider') == provider and _cache['data'].get('mode') == mode:
                        self.send_json(_cache['data'])
                        return

            # Fetch new data
            data = fetch_screener_data(provider, mode)

            with _cache_lock:
                _cache['data'] = data
                _cache['timestamp'] = datetime.now()

            self.send_json(data)

        elif parsed.path == '/health':
            self.send_json({'status': 'ok', 'timestamp': datetime.now().isoformat()})

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not Found')

    def send_json(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        pass  # Silence logs


def run_server(port=8765):
    server = HTTPServer(('localhost', port), ScreenerHandler)
    print(f'🚀 Stock Screener API running on http://localhost:{port}')
    print(f'   API endpoint: http://localhost:{port}/api/screener')
    print(f'   UI should be served from: bun run dev')
    server.serve_forever()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    run_server(args.port)
