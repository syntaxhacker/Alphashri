from datetime import datetime, timedelta

import config

from .screener_models import (
    MAX_WORKERS, PROFILES_WITH_52W_BUCKETS, _to_float,
)
from .screener_results import _profile_meta, _build_rationale, _summary_items_for


def _classify_sentiment(wick_close_pct, is_bullish):
    if wick_close_pct >= 70:
        return 'bullish'
    elif wick_close_pct >= 55:
        return 'lean_bull'
    elif wick_close_pct <= 30:
        return 'bearish'
    elif wick_close_pct <= 45:
        return 'lean_bear'
    return 'neutral'


def _build_stock_data(
    symbol, tv_price, upstox_price, tv_52w_high, to_52w_high,
    recent_return_5d, perf_w, sector, touched_52w, days_ago,
    day_change, rsi, stoch_k, wick_close_pct, volume_surge,
    atr_pct, adx, interest_score, gap_pct, premarket_change,
    impact_score, market_cap_b, volume_m, reversal_signal,
    is_bullish, sentiment, score, broker_diff,
):
    return {
        'symbol': symbol,
        'score': score,
        'tv_price': round(tv_price, 2),
        'upstox_price': round(upstox_price, 2),
        'broker_diff': broker_diff,
        'high_52w': round(tv_52w_high, 2),
        'to_52w_high': round(to_52w_high, 2),
        'recent_return_5d': round(recent_return_5d, 1),
        'perf_w': round(perf_w, 1),
        'sector': sector,
        'touched_52w': touched_52w,
        'days_ago': days_ago,
        'day_change': round(day_change, 2),
        'rsi': round(rsi, 1),
        'stoch_k': round(stoch_k, 1),
        'wick_close_pct': round(wick_close_pct, 1),
        'volume_surge': round(volume_surge, 2),
        'atr_pct': round(atr_pct, 2),
        'adx': round(adx, 1),
        'interest_score': round(interest_score, 1),
        'gap_pct': round(gap_pct, 2),
        'premarket_change': round(premarket_change, 2),
        'impact_score': round(impact_score, 2),
        'market_cap_b': round(market_cap_b, 2),
        'volume_m': round(volume_m, 2),
        'reversal_signal': reversal_signal,
        'is_bullish': is_bullish,
        'sentiment': sentiment,
    }


def _passes_profile_filters(screener, stock_data, profile_filters):
    if not profile_filters:
        return True

    def num(key, default=0.0):
        return _to_float(profile_filters.get(key), default)

    if screener == 'market_open_gap':
        return abs(_to_float(stock_data.get('gap_pct'), 0)) >= num('min_gap_pct', 1) and _to_float(stock_data.get('volume_m'), 0) >= num('min_volume_m', 0)
    if screener == 'high_momentum':
        return _to_float(stock_data.get('rsi'), 0) >= num('min_rsi', 0) and _to_float(stock_data.get('volume_m'), 0) >= num('min_volume_m', 0)
    if screener == 'buyer_interest':
        return _to_float(stock_data.get('wick_close_pct'), 0) >= num('min_wick_pct', 0) and _to_float(stock_data.get('volume_surge'), 0) >= num('min_vol_surge', 0)
    if screener == 'buyer_interest_enhanced':
        direction = profile_filters.get('direction', 'both')
        wick_pct = _to_float(stock_data.get('wick_close_pct'), 50)
        is_bullish_sentiment = wick_pct >= 60
        is_bearish_sentiment = wick_pct <= 40
        if direction == 'bullish' and not is_bullish_sentiment:
            return False
        if direction == 'bearish' and not is_bearish_sentiment:
            return False
        if _to_float(stock_data.get('score'), 0) < num('min_score', 0):
            return False
        return _to_float(stock_data.get('volume_surge'), 0) >= num('min_vol_surge', 0)
    if screener == 'volatility_trend':
        if _to_float(stock_data.get('atr_pct'), 0) < num('min_atr_pct', 0):
            return False
        if _to_float(stock_data.get('rsi'), 0) < num('min_rsi', 0):
            return False
        trend = profile_filters.get('trend', 'all')
        is_bullish = stock_data.get('is_bullish', False)
        sentiment = stock_data.get('sentiment', '')
        adx = _to_float(stock_data.get('adx'), 0)
        perfw = _to_float(stock_data.get('perf_w'), 0)
        if trend == 'bullish':
            if not is_bullish:
                return False
            if sentiment not in ['bullish', 'lean_bull'] and perfw <= 0:
                return False
        elif trend == 'bearish':
            if is_bullish:
                return False
            if sentiment not in ['bearish', 'lean_bear'] and perfw >= 0:
                return False
        elif trend == 'strong_trend':
            if adx < 25:
                return False
        return True
    if screener == 'nifty50_activity':
        return _to_float(stock_data.get('interest_score'), 0) >= num('min_interest_score', 0)
    if screener == 'near_52w_breakout':
        return _to_float(stock_data.get('to_52w_high'), 100) <= num('max_52w_gap', 100)
    if screener in ('touched_52w_high', 'builtin:touched_52w_high'):
        return True  # Filter handled by TV query + approaching/touched classification
    if screener == 'rsi_reversal':
        return _to_float(stock_data.get('rsi'), 100) <= num('max_rsi', 100) and _to_float(stock_data.get('stoch_k'), 0) >= num('min_stoch_k', 0)
    if screener == 'nifty_movers':
        return abs(_to_float(stock_data.get('impact_score'), 0)) >= num('min_impact', 0) and _to_float(stock_data.get('market_cap_b'), 0) >= num('min_cap_b', 0)
    if screener == 'intraday_momentum':
        return abs(_to_float(stock_data.get('move_pct'), 0)) >= num('min_move_pct', 0)
    return True


def estimate_days_to_52w(current_price, high_52w, adx, atr, recent_return_5d, perf_w):
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


def _compute_days_ago(api, symbol, today_high=None):
    """Fetch 90 days of daily data, find the period high, and return days since it was last touched."""
    try:
        to_date = datetime.now(config.IST).strftime('%Y-%m-%d')
        from_date = (datetime.now(config.IST) - timedelta(days=90)).strftime('%Y-%m-%d')
        df = api.fetch_historical_data_v3(symbol=symbol, unit='days', interval=1, to_date=to_date, from_date=from_date)
        if df is None or df.empty:
            return 0 if today_high is not None else None

        # Use Upstox's own period high (avoids TV vs Upstox data mismatch)
        period_high = df['high'].max()
        if today_high is not None:
            period_high = max(period_high, today_high)

        threshold = period_high * 0.98

        # If today's intraday high meets threshold, return 0 immediately
        if today_high is not None and today_high >= threshold:
            return 0

        touched = df[df['high'] >= threshold]
        if touched.empty:
            return None
        last_touch = touched.index[-1]
        if hasattr(last_touch, 'to_pydatetime'):
            last_touch_dt = last_touch.to_pydatetime()
        else:
            last_touch_dt = last_touch
        if last_touch_dt.tzinfo is None:
            last_touch_dt = config.IST.localize(last_touch_dt)
        days_ago = (datetime.now(config.IST) - last_touch_dt).days
        return max(0, days_ago)
    except Exception:
        return None


def _process_single_stock(row_data, screener, use_api, api, use_intraday, use_52w_buckets, profile_filters):
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import random

    symbol = row_data['name']
    screener_clean = screener.replace('builtin:', '') if screener.startswith('builtin:') else screener
    tv_price = row_data['close']

    if tv_price >= 7000:
        return None

    # Common row_data lookups used by both paths
    sector = str(row_data.get('sector', '-'))
    day_change = _to_float(row_data.get('change'), 0)
    rsi = _to_float(row_data.get('RSI'), 0)
    stoch_k = _to_float(row_data.get('Stoch.K'), 0)
    gap_pct = _to_float(row_data.get('gap'), 0)
    premarket_change = _to_float(row_data.get('premarket_change'), 0)
    impact_score = _to_float(row_data.get('impact_score'), 0)
    market_cap_b = _to_float(row_data.get('market_cap_basic'), 0) / 1_000_000_000
    volume_m = _to_float(row_data.get('volume'), 0) / 1_000_000
    reversal_signal = str(row_data.get('reversal_signal', ''))

    if not use_api:
        try:
            tv_52w_high = float(row_data.get('price_52_week_high', tv_price * 1.1))
            adx = float(row_data.get('ADX', 25))
            atr = _to_float(row_data.get('ATR'), 0.0)
            perf_w = float(row_data.get('Perf.W', 2))
            recent_return = float(row_data.get('change', 0))
            score = min(99, int(adx + (recent_return if recent_return > 0 else 0) * 2))
            broker_diff = round(random.uniform(-0.5, 0.5), 2)
            upstox_price = tv_price * (1 + broker_diff / 100)

            tv_open = _to_float(row_data.get('open'), tv_price)
            tv_high = _to_float(row_data.get('high'), max(tv_price, tv_open))
            tv_low = _to_float(row_data.get('low'), min(tv_price, tv_open))
            day_range = tv_high - tv_low
            wick_close_pct = (((tv_price - tv_low) / day_range) * 100) if day_range > 0 else 50.0

            volume_surge = _to_float(row_data.get('relative_volume_10d_calc'), 1.0)
            atr_pct = (atr / tv_price * 100) if tv_price > 0 else 0.0
            adx_val = _to_float(row_data.get('ADX'), adx)
            interest_score = _to_float(row_data.get('interest_score'), row_data.get('swing_score', adx))
            to_52w_high = ((tv_52w_high - upstox_price) / tv_52w_high) * 100

            est_days, confidence = estimate_days_to_52w(upstox_price, tv_52w_high, adx, atr, recent_return, perf_w)
            touched_52w = to_52w_high < 0.1
            is_bullish = tv_price >= tv_open
            sentiment = _classify_sentiment(wick_close_pct, is_bullish)

            stock_data = _build_stock_data(
                symbol, tv_price, upstox_price, tv_52w_high, to_52w_high,
                recent_return, perf_w, sector, touched_52w, None,
                day_change, rsi, stoch_k, wick_close_pct, volume_surge,
                atr_pct, adx_val, interest_score, gap_pct, premarket_change,
                impact_score, market_cap_b, volume_m, reversal_signal,
                is_bullish, sentiment, score, broker_diff,
            )

            stock_data['rationale'] = _build_rationale(screener, stock_data)

            if not touched_52w and est_days is not None:
                stock_data['time_to_52w'] = {'days': est_days, 'confidence': confidence}

            if _passes_profile_filters(screener, stock_data, profile_filters):
                return (stock_data, 'touched' if (use_52w_buckets and touched_52w) else 'approaching')
            return None

        except Exception:
            return None

    instrument_key = api.get_instrument_key(symbol)
    if not instrument_key:
        return ('blacklist', symbol)

    try:
        if use_intraday:
            df_hist = api.fetch_intraday_data_v3(symbol=symbol, interval='1')
            if df_hist is None or df_hist.empty:
                return None
        else:
            to_date = datetime.now(config.IST).strftime('%Y-%m-%d')
            from_date = (datetime.now(config.IST) - timedelta(days=5)).strftime('%Y-%m-%d')
            df_hist = api.fetch_historical_data_v3(
                symbol=symbol, unit='minutes', interval=1,
                to_date=to_date, from_date=from_date
            )

        if df_hist is not None and not df_hist.empty:
            upstox_price = float(df_hist['close'].iloc[-1])
            start_price = float(df_hist['close'].iloc[0])
            current_candle = df_hist.iloc[-1]
            c_high = _to_float(current_candle.get('high'), upstox_price)
            c_low = _to_float(current_candle.get('low'), upstox_price)
            c_close = _to_float(current_candle.get('close'), upstox_price)
            c_range = c_high - c_low
            wick_close_pct = (((c_close - c_low) / c_range) * 100) if c_range > 0 else 50.0
            avg_vol = _to_float(df_hist['volume'].tail(10).mean(), 0)
            cur_vol = _to_float(current_candle.get('volume'), 0)
            volume_surge = (cur_vol / avg_vol) if avg_vol > 0 else 1.0
            diff_pct = ((upstox_price - tv_price) / tv_price) * 100
            recent_return = ((upstox_price - start_price) / start_price) * 100
            tv_52w_high = float(row_data.get('price_52_week_high', 0))
            recent_high = float(df_hist['high'].max())
            high_diff_pct = ((recent_high - upstox_price) / recent_high) * 100
            adx = float(row_data.get('ADX', 0))
            atr = float(row_data.get('ATR', 0))
            atr_pct = (atr / tv_price * 100) if tv_price > 0 else 0.0
            perf_w = float(row_data.get('Perf.W', 0))
            interest_score = _to_float(row_data.get('interest_score'), row_data.get('swing_score', 0))
            est_days, confidence = estimate_days_to_52w(upstox_price, recent_high, adx, atr, recent_return, perf_w)
            touched_52w = False
            if tv_52w_high > 0:
                if recent_high >= tv_52w_high:
                    touched_52w = True
                elif (tv_52w_high - recent_high) / tv_52w_high < 0.001:
                    touched_52w = True
            days_ago = None
            if screener_clean == 'touched_52w_high':
                days_ago = _compute_days_ago(api, symbol, today_high=recent_high)
            c_open = _to_float(current_candle.get('open'), c_close)
            is_bullish = c_close >= c_open
            sentiment = _classify_sentiment(wick_close_pct, is_bullish)

            score = min(99, int(adx + (recent_return if recent_return > 0 else 0) * 2))
            broker_diff = round(diff_pct, 2)

            stock_data = _build_stock_data(
                symbol, tv_price, upstox_price, tv_52w_high, high_diff_pct,
                recent_return, perf_w, sector, touched_52w, days_ago,
                day_change, rsi, stoch_k, wick_close_pct, volume_surge,
                atr_pct, adx, interest_score, gap_pct, premarket_change,
                impact_score, market_cap_b, volume_m, reversal_signal,
                is_bullish, sentiment, score, broker_diff,
            )

            stock_data['move_pct'] = 0.0
            stock_data['lookback_minutes'] = 15

            if screener == 'intraday_momentum':
                lookback_minutes = int(profile_filters.get('lookback_minutes', 15)) if profile_filters else 15
                stock_data['lookback_minutes'] = lookback_minutes
                try:
                    df_5m = api.fetch_intraday_data_v3(symbol=symbol, interval='5')
                    if df_5m is not None and len(df_5m) >= 2:
                        candles_back = max(1, lookback_minutes // 5)
                        if len(df_5m) > candles_back:
                            current = float(df_5m['close'].iloc[-1])
                            past = float(df_5m['close'].iloc[-(candles_back + 1)])
                            move_pct = ((current - past) / past) * 100 if past > 0 else 0.0
                            stock_data['move_pct'] = round(move_pct, 2)
                            stock_data['score'] = min(99, int(
                                abs(move_pct) * 15 +
                                volume_surge * 5 +
                                max(0, _to_float(row_data.get('RSI'), 50) - 50)
                            ))
                except Exception:
                    pass

            stock_data['rationale'] = _build_rationale(screener, stock_data)

            if not touched_52w and est_days is not None:
                stock_data['time_to_52w'] = {'days': est_days, 'confidence': confidence}

            if _passes_profile_filters(screener, stock_data, profile_filters):
                return (stock_data, 'touched' if (use_52w_buckets and touched_52w) else 'approaching')
            return None

    except Exception:
        return None

    return None


def fetch_screener_data(provider='upstox', mode='historical', screener='trending', profile_filters=None, _retry_api=True):
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import trending_upside

    screener = screener.replace('builtin:', '') if screener.startswith('builtin:') else screener

    api = None
    use_api = False
    warning = None

    if _retry_api:
        try:
            from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory
            api = TradingAPIFactory.create_from_config(provider, quiet=True)
            use_api = True
        except (ValueError, ImportError):
            try:
                from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
                from upstox_trader.config_and_utils.upstox_auth import UpstoxAuthHandler
                import config
                api_key = getattr(config, 'UPSTOX_API_KEY', None)
                api_secret = getattr(config, 'UPSTOX_API_SECRET', None)
                if api_key and api_secret:
                    auth = UpstoxAuthHandler(api_key, api_secret, quiet=True)
                    if auth.load_token():
                        api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)
                        api.auth_handler.access_token = auth.access_token
                        use_api = True
            except Exception:
                pass

    if not use_api and _retry_api:
        warning = "Upstox credentials not configured. Set UPSTOX_API_KEY/UPSTOX_API_SECRET or connect via Settings > Brokers to enable live price lookups and 'days_ago' calculation."

    use_intraday = (mode == 'intraday')
    use_52w_buckets = screener in PROFILES_WITH_52W_BUCKETS

    tv_df = trending_upside.fetch_trending_stocks(limit=120, profile=screener)
    if tv_df.empty:
        return {
            'approaching': [],
            'touched': [],
            'last_updated': datetime.now().isoformat(),
            'provider': provider,
            'mode': mode,
            'screener': screener,
            'profile_meta': _profile_meta(screener),
            'summary': [],
            'warning': warning,
        }

    approaching = []
    touched = []
    blacklisted_symbols = set()
    rows_data = [row.to_dict() for _, row in tv_df.iterrows()]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(
                _process_single_stock,
                row_data, screener, use_api, api, use_intraday, use_52w_buckets, profile_filters
            ): row_data
            for row_data in rows_data
        }

        for future in as_completed(futures):
            try:
                result = future.result()
                if result is None:
                    continue
                elif isinstance(result, tuple):
                    if result[0] == 'blacklist':
                        blacklisted_symbols.add(result[1])
                    elif result[1] == 'touched':
                        touched.append(result[0])
                    elif result[1] == 'approaching':
                        approaching.append(result[0])
            except Exception:
                pass

    # If Upstox API returned no data (market closed, expired token), fall back to TV prices
    if use_api and _retry_api and len(approaching) + len(touched) == 0:
        return fetch_screener_data(provider, mode, screener, profile_filters, _retry_api=False)

    return {
        'approaching': approaching,
        'touched': touched,
        'last_updated': datetime.now().isoformat(),
        'provider': provider,
        'mode': mode,
        'screener': screener,
        'profile_meta': _profile_meta(screener),
        'summary': _summary_items_for(screener, approaching, touched),
        'warning': warning,
    }
