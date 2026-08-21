from datetime import datetime, timedelta

import config
from db.database import SessionLocal

from .screener_models import (
    MAX_WORKERS, PROFILES_WITH_52W_BUCKETS, _to_float, touched_52w_gap_threshold_pct,
)
from .screener_results import _profile_meta, _build_rationale, _summary_items_for


def _ensure_ist(dt: datetime) -> datetime:
    """Attach IST to naive datetimes (config.IST is stdlib timezone, not pytz)."""
    if hasattr(dt, 'to_pydatetime'):
        dt = dt.to_pydatetime()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=config.IST)
    return dt.astimezone(config.IST)


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
    impact_score, market_cap_b, volume_m, turnover_cr, reversal_signal,
    is_bullish, sentiment, score, broker_diff,
    move_5m=None, move_10m=None, move_15m=None,
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
        'turnover_cr': round(turnover_cr, 2),
        'reversal_signal': reversal_signal,
        'is_bullish': is_bullish,
        'sentiment': sentiment,
        'move_5m': round(move_5m, 2) if move_5m is not None else None,
        'move_10m': round(move_10m, 2) if move_10m is not None else None,
        'move_15m': round(move_15m, 2) if move_15m is not None else None,
    }


def _passes_profile_filters(screener, stock_data, profile_filters):
    if screener in ('touched_52w_high', 'builtin:touched_52w_high'):
        min_vol = _to_float(profile_filters.get('min_volume_m') if profile_filters else None, 0.1)
        if _to_float(stock_data.get('volume_m'), 0) < min_vol:
            return False
        min_turnover = _to_float(profile_filters.get('min_turnover_cr') if profile_filters else None, 60)
        if _to_float(stock_data.get('turnover_cr'), 0) < min_turnover:
            return False

    if screener in ('52w_high', 'builtin:52w_high'):
        min_vol = _to_float(profile_filters.get('min_volume_m') if profile_filters else None, 0.0)
        vol = _to_float(stock_data.get('volume_m'), 0)
        if min_vol > 0 and vol < min_vol:
            return False
        min_turnover = _to_float(profile_filters.get('min_turnover_cr') if profile_filters else None, 0.0)
        turnover = _to_float(stock_data.get('turnover_cr'), 0)
        if min_turnover > 0 and turnover < min_turnover:
            return False

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
    if screener in ('near_52w_breakout', '52w_high', 'builtin:52w_high'):
        return _to_float(stock_data.get('to_52w_high'), 100) <= num('max_52w_gap', 100)
    if screener == 'rsi_reversal':
        return _to_float(stock_data.get('rsi'), 100) <= num('max_rsi', 100) and _to_float(stock_data.get('stoch_k'), 0) >= num('min_stoch_k', 0)
    if screener == 'nifty_movers':
        return abs(_to_float(stock_data.get('impact_score'), 0)) >= num('min_impact', 0) and _to_float(stock_data.get('market_cap_b'), 0) >= num('min_cap_b', 0)
    if screener == 'price_surge':
        return abs(_to_float(stock_data.get('day_change'), 0)) >= num('min_surge_pct', 5) and _to_float(stock_data.get('volume_m'), 0) >= num('min_volume_m', 0)
    if screener in ('intraday_momentum', 'intraday_5m', 'intraday_10m', 'intraday_15m'):
        return abs(_to_float(stock_data.get('move_pct'), 0)) >= num('min_move_pct', 0)
    if screener == 'undervalued':
        pe = _to_float(stock_data.get('pe'), 0)
        roe = _to_float(stock_data.get('roe'), 0)
        if num('max_pe', 25) > 0 and pe > num('max_pe', 25):
            return False
        if num('min_roe', 6) > 0 and roe < num('min_roe', 6):
            return False
        return True
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
        last_touch_dt = _ensure_ist(last_touch_dt)
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

    # Undervalued profile: skip 52W/technical logic, return fundamental data directly
    if screener_clean == 'undervalued':
        pe = _to_float(row_data.get('price_earnings_ttm'), 0)
        pb = _to_float(row_data.get('price_book_ratio'), 0)
        roe = _to_float(row_data.get('return_on_equity'), 0)
        de = _to_float(row_data.get('debt_to_equity'), 0)
        div_yield = _to_float(row_data.get('dividend_yield_recent'), 0)
        mcap_b = _to_float(row_data.get('market_cap_basic'), 0) / 1_000_000_000
        vol_m = _to_float(row_data.get('volume'), 0) / 1_000_000
        score = _to_float(row_data.get('value_score'), 0)

        stock_data = {
            'symbol': symbol,
            'score': min(99, int(round(score * 5))),
            'tv_price': round(tv_price, 2),
            'upstox_price': round(tv_price, 2),
            'sector': str(row_data.get('sector', '-')),
            'market_cap_b': round(mcap_b, 2),
            'volume_m': round(vol_m, 2),
            'pe': round(pe, 2),
            'pb': round(pb, 2) if pb else None,
            'roe': round(roe, 2),
            'de': round(de, 2) if de else None,
            'div_yield': round(div_yield, 2),
            'value_score': round(score, 1),
            'day_change': round(_to_float(row_data.get('change'), 0), 2),
        }
        stock_data['rationale'] = f"P/E {pe:.1f} | P/B {pb:.2f} | ROE {roe:.1f}% | Score {score:.0f}"
        return (stock_data, 'approaching')

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
            score = min(99, int(adx + max(recent_return, 0) * 2 + max(rsi - 50, 0) * 0.5 + max(row_data.get('relative_volume_10d_calc', 0), 0) * 2))
            if screener_clean == 'price_surge':
                score = min(99, int(abs(day_change) * 3 + max(_to_float(row_data.get('relative_volume_10d_calc'), 1), 0) * 5))
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
            touched_gap = touched_52w_gap_threshold_pct()
            touched_52w = to_52w_high < touched_gap
            is_bullish = tv_price >= tv_open
            sentiment = _classify_sentiment(wick_close_pct, is_bullish)

            turnover_cr = round(volume_m * upstox_price / 10, 2) if upstox_price else 0.0
            stock_data = _build_stock_data(
                symbol, tv_price, upstox_price, tv_52w_high, to_52w_high,
                recent_return, perf_w, sector, touched_52w, None,
                day_change, rsi, stoch_k, wick_close_pct, volume_surge,
                atr_pct, adx_val, interest_score, gap_pct, premarket_change,
                impact_score, market_cap_b, volume_m, turnover_cr, reversal_signal,
                is_bullish, sentiment, score, broker_diff,
                move_5m=0.0, move_10m=0.0, move_15m=0.0,
            )

            stock_data['move_pct'] = 0.0
            stock_data['lookback_minutes'] = 15

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
            touched_gap = touched_52w_gap_threshold_pct()
            touched_52w = False
            if tv_52w_high > 0:
                if recent_high >= tv_52w_high:
                    touched_52w = True
                elif (tv_52w_high - recent_high) / tv_52w_high < touched_gap / 100:
                    touched_52w = True
            days_ago = None
            if screener_clean in ('touched_52w_high', '52w_high'):
                days_ago = _compute_days_ago(api, symbol, today_high=recent_high)
            c_open = _to_float(current_candle.get('open'), c_close)
            is_bullish = c_close >= c_open
            sentiment = _classify_sentiment(wick_close_pct, is_bullish)

            score = min(99, int(adx + max(recent_return, 0) * 2 + max(rsi - 50, 0) * 0.5 + max(volume_surge, 0) * 2))
            if screener_clean == 'price_surge':
                score = min(99, int(abs(day_change) * 3 + volume_surge * 5))
            broker_diff = round(diff_pct, 2)

            # Calculate all three intraday lookbacks from 1-min candles
            move_5m = 0.0
            move_10m = 0.0
            move_15m = 0.0
            if df_hist is not None and not df_hist.empty:
                closes = df_hist['close'].values
                n = len(closes)
                current_close = float(closes[-1])
                if n >= 6:
                    move_5m = ((current_close / float(closes[-6])) - 1) * 100
                if n >= 11:
                    move_10m = ((current_close / float(closes[-11])) - 1) * 100
                if n >= 16:
                    move_15m = ((current_close / float(closes[-16])) - 1) * 100

            turnover_cr = round(volume_m * upstox_price / 10, 2) if upstox_price else 0.0
            stock_data = _build_stock_data(
                symbol, tv_price, upstox_price, tv_52w_high, high_diff_pct,
                recent_return, perf_w, sector, touched_52w, days_ago,
                day_change, rsi, stoch_k, wick_close_pct, volume_surge,
                atr_pct, adx, interest_score, gap_pct, premarket_change,
                impact_score, market_cap_b, volume_m, turnover_cr, reversal_signal,
                is_bullish, sentiment, score, broker_diff,
                move_5m=move_5m, move_10m=move_10m, move_15m=move_15m,
            )

            stock_data['move_pct'] = 0.0
            stock_data['lookback_minutes'] = 15

            if screener_clean in ('intraday_5m', 'intraday_10m', 'intraday_15m', 'intraday_momentum'):
                period_map = {
                    'intraday_5m': 'move_5m',
                    'intraday_10m': 'move_10m',
                    'intraday_15m': 'move_15m',
                    'intraday_momentum': 'move_15m',
                }
                key = period_map.get(screener_clean, 'move_15m')
                move_val = _to_float(stock_data.get(key), 0.0)
                stock_data['move_pct'] = round(move_val, 2)
                stock_data['lookback_minutes'] = int(key.replace('move_', '').replace('m', ''))
                stock_data['score'] = min(99, int(
                    abs(move_val) * 15 +
                    volume_surge * 5 +
                    max(0, _to_float(row_data.get('RSI'), 50) - 50)
                ))

            stock_data['rationale'] = _build_rationale(screener, stock_data)

            if not touched_52w and est_days is not None:
                stock_data['time_to_52w'] = {'days': est_days, 'confidence': confidence}

            if _passes_profile_filters(screener, stock_data, profile_filters):
                return (stock_data, 'touched' if (use_52w_buckets and touched_52w) else 'approaching')
            return None

    except Exception:
        return None

    return None


def _enrich_with_touch_history(data, screener):
    """Enrich screener results with historical 52w touch information."""
    from datetime import timedelta
    from db.models.stock_52w_touch import Stock52WeekTouch

    approaching = data.get('approaching', [])
    touched = data.get('touched', [])
    all_stocks = approaching + touched
    if not all_stocks:
        return

    symbols = [s['symbol'] for s in all_stocks if s.get('symbol')]
    if not symbols:
        return

    cutoff_date = datetime.now(config.IST) - timedelta(days=7)
    touch_map = {}
    try:
        db = SessionLocal()
        try:
            recent_touches = (
                db.query(Stock52WeekTouch)
                .filter(
                    Stock52WeekTouch.symbol.in_(symbols),
                    Stock52WeekTouch.touched_date >= cutoff_date,
                    Stock52WeekTouch.is_high == True,
                )
                .order_by(Stock52WeekTouch.symbol, Stock52WeekTouch.touched_date.desc())
                .all()
            )
            for touch in recent_touches:
                if touch.symbol not in touch_map:
                    touch_map[touch.symbol] = touch
        finally:
            db.close()
    except Exception:
        pass

    last_touched_info = {}
    try:
        from sqlalchemy import func

        db = SessionLocal()
        try:
            subq = (
                db.query(
                    Stock52WeekTouch.symbol,
                    func.max(Stock52WeekTouch.touched_date).label('max_date'),
                )
                .filter(Stock52WeekTouch.symbol.in_(symbols))
                .group_by(Stock52WeekTouch.symbol)
                .subquery()
            )
            latest_touches = (
                db.query(Stock52WeekTouch)
                .join(
                    subq,
                    (Stock52WeekTouch.symbol == subq.c.symbol)
                    & (Stock52WeekTouch.touched_date == subq.c.max_date),
                )
                .all()
            )
            for touch in latest_touches:
                last_touched_info[touch.symbol] = {
                    'date': touch.touched_date,
                    'price': touch.touched_price,
                }
        finally:
            db.close()
    except Exception:
        pass

    new_approaching = []
    new_touched = []
    moved_count = 0

    for stock in all_stocks:
        symbol = stock.get('symbol')
        touch = touch_map.get(symbol)
        last_info = last_touched_info.get(symbol)

        if last_info:
            touch_dt = last_info['date']
            stock['last_touched'] = touch_dt.isoformat()
            stock['last_touched_price'] = last_info['price']
            if stock.get('days_ago') is None:
                if hasattr(touch_dt, 'to_pydatetime'):
                    touch_dt = touch_dt.to_pydatetime()
                touch_dt = _ensure_ist(touch_dt)
                stock['days_ago'] = max(
                    0,
                    (datetime.now(config.IST) - touch_dt).days,
                )
        else:
            stock['last_touched'] = None
            stock['last_touched_price'] = None

        was_touched_today = stock.get('touched_52w', False)
        touched_recently = touch is not None

        if was_touched_today or touched_recently:
            stock['touched_52w'] = True
            if not was_touched_today:
                moved_count += 1
            new_touched.append(stock)
        else:
            new_approaching.append(stock)

    data['approaching'] = new_approaching
    data['touched'] = new_touched
    if moved_count > 0:
        data['_debug_moved_by_history'] = moved_count


def fetch_screener_data(provider='upstox', mode='historical', screener='trending', profile_filters=None, _retry_api=True):
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import trending_upside

    screener_raw = screener
    screener = screener.replace('builtin:', '') if screener.startswith('builtin:') else screener

    if screener == '52w_high' or screener_raw in ('52w_high', 'builtin:52w_high'):
        from .screener_52w import fetch_52w_high_data
        return fetch_52w_high_data(provider, mode, profile_filters)

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


def fetch_all_52w_ranges_from_tv() -> dict:
    """Fetch 52-week high/low for all NSE stocks from TradingView.

    Uses paginated queries (1000 rows per page) sorted by market cap descending.
    Returns dict of {symbol: {high, low, close}}.
    """
    from tradingview_screener import Query

    fields = ['name', 'close', 'price_52_week_high', 'price_52_week_low', 'volume']
    all_stocks = {}
    offset = 0
    page_size = 1000

    while True:
        q = (Query()
            .select(*fields)
            .set_markets('india')
            .order_by('market_cap_basic', ascending=False)
            .offset(offset).limit(offset + page_size))
        _, df = q.get_scanner_data()
        if df is None or df.empty:
            break
        for _, row in df.iterrows():
            symbol = str(row.get('ticker', '')).replace('NSE:', '')
            if not symbol:
                continue
            high = row.get('price_52_week_high')
            low = row.get('price_52_week_low')
            close = row.get('close')
            if high and low and close:
                all_stocks[symbol] = {
                    'high': float(high),
                    'low': float(low),
                    'close': float(close),
                }
        offset += page_size
        if len(df) < page_size:
            break

    return all_stocks
