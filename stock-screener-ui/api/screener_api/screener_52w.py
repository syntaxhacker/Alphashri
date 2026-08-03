"""
52w high screener using precomputed 52w ranges (from DB/Redis, populated via Upstox or TV bulk).
Symbols + 52w high/low/close come from the ranges (accurate historical).
Volume, change, sector, market_cap, RSI and other live params are enriched via targeted
TradingView scanner query (set_tickers on the exact candidate symbols) so the screener output
has rich columns like the other TV-based screeners.
"""
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

        candidates.append(stock_data)

    # Enrich candidates with real TV data (volume etc) BEFORE the vol filter,
    # so that min_volume_m etc in 52w profile work with actual volume from TV.
    _enrich_with_tv_scanner_data(candidates)

    # re-apply passes now that volume_m etc are real (for 52w_high this mainly checks vol/turnover if min set >0)
    filtered_candidates = []
    for sd in candidates:
        if _passes_profile_filters(screener, sd, profile_filters):
            filtered_candidates.append(sd)
    candidates = filtered_candidates

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
            has_upstox = getattr(api, '_IS_BROKER_BACKED', False)
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
def _enrich_with_tv_scanner_data(stocks: list[dict]) -> None:
    """Targeted TV enrichment for volume + other params for 52w high screener candidates.

    We already have the right symbols (from 52w ranges -- "getting symbols fine").
    Now query TV scanner directly (using set_tickers on the exact list) for live volume,
    change, sector, market_cap etc. "from this tv search only".

    Normalized symbol matching (via helpers) ensures TV names/tickers line up with our
    local trading_symbols (handles NSE: prefix, BAJAJ_AUTO vs BAJAJ-AUTO, etc).
    """
    if not stocks:
        return
    syms = []
    for s in stocks:
        sym = s.get('symbol')
        if sym and sym not in syms:
            syms.append(sym)
    if not syms:
        return

    # Lazy imports: keeps surface small, works when tradingview_screener is stubbed in tests.
    try:
        from api.symbols import normalize_tv_symbol, to_tv_ticker
        from tradingview_screener import Query
    except Exception:
        return

    BATCH_SIZE = 80  # safer batch size for set_tickers to avoid empty responses or limits on large 52w candidate lists
    tv_by_sym: dict[str, dict] = {}

    for i in range(0, len(syms), BATCH_SIZE):
        batch = syms[i : i + BATCH_SIZE]
        tickers = [to_tv_ticker(sym) for sym in batch]
        if not tickers:
            continue
        try:
            q = (
                Query()
                .set_tickers(*tickers)
                .select(
                    'name', 'ticker', 'close', 'volume', 'change',
                    'sector', 'market_cap_basic', 'relative_volume_10d_calc',
                    'RSI', 'ADX', 'Perf.W'
                )
            )
            _, df = q.get_scanner_data()
            if df is None or df.empty:
                continue
            for _, row in df.iterrows():
                # Robust extraction: use iloc preferentially because set_tickers / scanner df
                # often has duplicate column names ('ticker' twice), making .get('ticker') return
                # a pandas Series (which str() makes messy). iloc[0] is typically the full ticker.
                try:
                    tkr = str(row.iloc[0]).strip() if len(row) > 0 else ''
                    nm = str(row.iloc[1]).strip() if len(row) > 1 else ''
                except Exception:
                    tkr = str(row.get('ticker', '')).strip()
                    nm = str(row.get('name', '')).strip()
                raw = tkr or nm
                bare = normalize_tv_symbol(raw)
                if bare:
                    tv_by_sym[bare] = row.to_dict() if hasattr(row, 'to_dict') else dict(row)
        except Exception:
            continue

    if not tv_by_sym:
        return

    for stock in stocks:
        sym = stock.get('symbol')
        if not sym or sym not in tv_by_sym:
            continue
        r = tv_by_sym[sym]
        vol = _to_float(r.get('volume'), 0)
        stock['volume_m'] = round(vol / 1_000_000, 2)
        price_for_turn = _to_float(
            stock.get('upstox_price') or stock.get('tv_price') or r.get('close'), 0
        )
        stock['turnover_cr'] = round(vol * price_for_turn / 10_000_000, 2) if price_for_turn > 0 else 0.0

        stock['day_change'] = round(_to_float(r.get('change'), 0), 2)
        stock['sector'] = r.get('sector') or stock.get('sector', '-')
        mc = _to_float(r.get('market_cap_basic'), 0)
        if mc:
            stock['market_cap_b'] = round(mc / 1_000_000_000, 2)

        tv_close = _to_float(r.get('close'), 0)
        if tv_close > 0:
            stock['tv_price'] = round(tv_close, 2)

        stock['rsi'] = round(_to_float(r.get('RSI'), stock.get('rsi', 0)), 1)
        stock['adx'] = round(_to_float(r.get('ADX'), stock.get('adx', 0)), 1)
        rel_vol = _to_float(r.get('relative_volume_10d_calc'), 0)
        if rel_vol:
            stock['volume_surge'] = round(rel_vol, 2)
        # also provide raw 'volume' in addition to volume_m so it's visible as "vlumn"
        stock['volume'] = vol
