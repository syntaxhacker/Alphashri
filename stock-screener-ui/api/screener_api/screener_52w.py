"""TV-free 52-week high screener using Upstox-computed ranges (DB/Redis)."""
import os
from datetime import datetime

import config

from trading.week52_range_lookup import load_all_52w_ranges

from .screener_models import (
    _to_float,
    gap_pct_to_52w_high,
    is_within_52w_touch_gap,
    touched_52w_gap_threshold_pct,
)
from .screener_results import _profile_meta, _build_rationale, _summary_items_for
from .screener_scan import (
    _build_stock_data,
    _passes_profile_filters,
    _enrich_with_touch_history,
    _compute_days_ago,
)


def _sync_stock_metrics(stock: dict, touched_gap_pct: float) -> None:
    """Recompute gap% and touched flag from high_52w vs LTP (upstox_price)."""
    gap = gap_pct_to_52w_high(
        _to_float(stock.get('high_52w'), 0),
        _to_float(stock.get('upstox_price'), 0),
    )
    if gap is None:
        return
    stock['to_52w_high'] = gap
    stock['touched_52w'] = is_within_52w_touch_gap(gap, touched_gap_pct)
    if stock['touched_52w'] and stock.get('days_ago') is None:
        stock['days_ago'] = 0


def _resplit_52w_buckets(data: dict, touched_gap_pct: float) -> None:
    """Re-bucket after LTP/touch-history updates using shared gap rules."""
    all_stocks = data.get('approaching', []) + data.get('touched', [])
    approaching = []
    touched = []
    for stock in all_stocks:
        _sync_stock_metrics(stock, touched_gap_pct)
        if stock.get('touched_52w'):
            touched.append(stock)
        else:
            approaching.append(stock)
    data['approaching'] = approaching
    data['touched'] = touched


def _create_upstox_api(provider: str):
    """Return (api, use_api) using same credential resolution as fetch_screener_data."""
    if provider != 'upstox':
        return None, False
    try:
        from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory
        api = TradingAPIFactory.create_from_config(provider, quiet=True)
        return api, True
    except (ValueError, ImportError):
        pass
    try:
        from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
        from upstox_trader.config_and_utils.upstox_auth import UpstoxAuthHandler

        api_key = getattr(config, 'UPSTOX_API_KEY', None)
        api_secret = getattr(config, 'UPSTOX_API_SECRET', None)
        if api_key and api_secret:
            auth = UpstoxAuthHandler(api_key, api_secret, quiet=True)
            if auth.load_token():
                api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)
                api.auth_handler.access_token = auth.access_token
                return api, True
    except Exception:
        pass
    return None, False


def _enrich_top_with_ltp(stocks: list[dict], api, top_n: int, touched_gap_pct: float) -> None:
    """Refresh LTP for top-N stocks by score (intraday 1m close)."""
    if not api or not stocks:
        return
    ranked = sorted(stocks, key=lambda s: _to_float(s.get('score'), 0), reverse=True)[:top_n]
    for stock in ranked:
        symbol = stock.get('symbol')
        if not symbol:
            continue
        high_52w = _to_float(stock.get('high_52w'), 0)
        if high_52w <= 0:
            continue
        try:
            df = api.fetch_intraday_data_v3(symbol=symbol, interval='1')
            if df is None or df.empty:
                continue
            ltp = float(df['close'].iloc[-1])
            recent_high = float(df['high'].max())
            tv_price = _to_float(stock.get('tv_price'), ltp)
            broker_diff = round(((ltp - tv_price) / tv_price) * 100, 2) if tv_price > 0 else 0.0
            stock['upstox_price'] = round(ltp, 2)
            stock['broker_diff'] = broker_diff
            near_high = (high_52w - recent_high) / high_52w < touched_gap_pct / 100
            if recent_high >= high_52w or near_high:
                stock['touched_52w'] = True
            _sync_stock_metrics(stock, touched_gap_pct)
        except Exception:
            continue


def _fill_days_ago_from_upstox(stocks: list[dict], api, use_api: bool, touched_gap_pct: float) -> None:
    """Days since price last reached ~98% of Upstox 52W high (90d daily bars)."""
    if not use_api or not api:
        return
    for stock in stocks:
        if stock.get('days_ago') is not None:
            continue
        symbol = stock.get('symbol')
        if not symbol:
            continue
        high_52w = _to_float(stock.get('high_52w'), 0)
        ltp = _to_float(stock.get('upstox_price'), 0)
        today_high = ltp if high_52w > 0 and ltp >= high_52w * 0.999 else None
        if _to_float(stock.get('to_52w_high'), 100) < touched_gap_pct:
            today_high = today_high or ltp or high_52w
        try:
            days = _compute_days_ago(api, symbol, today_high=today_high)
            if days is not None:
                stock['days_ago'] = days
        except Exception:
            continue


def fetch_52w_high_data(provider='upstox', mode='historical', profile_filters=None):
    screener = '52w_high'
    warning = None
    touched_gap_pct = touched_52w_gap_threshold_pct()

    ranges = load_all_52w_ranges()
    if not ranges:
        return {
            'approaching': [],
            'touched': [],
            'last_updated': datetime.now().isoformat(),
            'provider': provider,
            'mode': mode,
            'screener': screener,
            'profile_meta': _profile_meta(screener),
            'summary': [],
            'warning': 'No 52-week range data. Run scripts/compute_52w_ranges_upstox.py --redis.',
        }

    max_gap = _to_float(
        profile_filters.get('max_52w_gap') if profile_filters else None,
        10,
    )

    candidates = []

    for symbol, info in ranges.items():
        high = _to_float(info.get('high'), 0)
        low = _to_float(info.get('low'), 0)
        close = _to_float(info.get('close'), 0)
        if high <= 0 or close <= 0:
            continue
        if close >= 7000:
            continue

        to_52w_high = gap_pct_to_52w_high(high, close)
        if to_52w_high is None:
            continue
        touched_52w = is_within_52w_touch_gap(to_52w_high, touched_gap_pct)
        stored_days = info.get('days_ago')
        if stored_days is not None:
            try:
                days_ago = max(0, int(stored_days))
            except (TypeError, ValueError):
                days_ago = 0 if touched_52w else None
        elif touched_52w:
            days_ago = 0
        else:
            days_ago = None

        if to_52w_high > max_gap and not touched_52w:
            continue

        volume_m = 0.0
        turnover_cr = 0.0
        proximity_score = max(0.0, min(99.0, 100.0 - to_52w_high))
        score = min(99, int(proximity_score + volume_m * 2))

        stock_data = _build_stock_data(
            symbol,
            close,
            close,
            high,
            to_52w_high,
            0.0,
            0.0,
            '-',
            touched_52w,
            days_ago,
            0.0,
            0.0,
            0.0,
            50.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            volume_m,
            turnover_cr,
            '',
            False,
            'neutral',
            score,
            0.0,
        )
        stock_data['low_52w'] = round(low, 2)
        stock_data['rationale'] = _build_rationale(screener, stock_data)

        if not _passes_profile_filters(screener, stock_data, profile_filters):
            continue

        candidates.append(stock_data)

    approaching = []
    touched = []
    for stock_data in candidates:
        _sync_stock_metrics(stock_data, touched_gap_pct)
        if stock_data.get('touched_52w'):
            touched.append(stock_data)
        else:
            approaching.append(stock_data)

    api, use_api = _create_upstox_api(provider)
    if not use_api:
        warning = (
            "Upstox credentials not configured. Set UPSTOX_API_KEY/UPSTOX_API_SECRET "
            "or connect via Settings > Brokers for live LTP and Days Ago (from daily bars). "
            "Days Ago uses batch OHLC when stored, else touch history in DB."
        )
    else:
        try:
            from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
            has_upstox = isinstance(api, UpstoxAPI)
        except ImportError:
            has_upstox = False
        if has_upstox:
            top_n = int(os.environ.get('SCREENER_52W_ENRICH_TOP', '80'))
            all_rows = approaching + touched
            _enrich_top_with_ltp(all_rows, api, top_n, touched_gap_pct)

    data = {
        'approaching': approaching,
        'touched': touched,
        'last_updated': datetime.now().isoformat(),
        'provider': provider,
        'mode': mode,
        'screener': screener,
        'profile_meta': _profile_meta(screener),
        'summary': _summary_items_for(screener, approaching, touched),
        'warning': warning,
        'touched_gap_pct': touched_gap_pct,
    }
    _enrich_with_touch_history(data, screener)
    _resplit_52w_buckets(data, touched_gap_pct)

    all_rows = data['approaching'] + data['touched']
    _fill_days_ago_from_upstox(data['touched'], api, use_api, touched_gap_pct)
    if use_api:
        near = [s for s in data['approaching'] if _to_float(s.get('to_52w_high'), 100) <= 3.0]
        _fill_days_ago_from_upstox(near[:120], api, use_api, touched_gap_pct)

    data['summary'] = _summary_items_for(screener, data['approaching'], data['touched'])
    return data