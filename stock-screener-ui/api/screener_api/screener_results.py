from .screener_models import _to_float, PROFILE_META


def _profile_meta(screener):
    screener = screener.replace('builtin:', '') if screener.startswith('builtin:') else screener
    return PROFILE_META.get(screener, PROFILE_META['trending'])


def _build_rationale(screener, stock_data):
    gap = _to_float(stock_data.get('gap_pct'), 0)
    pre = _to_float(stock_data.get('premarket_change'), 0)
    vol = _to_float(stock_data.get('volume_m'), 0)
    rsi = _to_float(stock_data.get('rsi'), 0)
    stoch_k = _to_float(stock_data.get('stoch_k'), 0)
    day = _to_float(stock_data.get('day_change'), 0)
    impact = _to_float(stock_data.get('impact_score'), 0)
    cap_b = _to_float(stock_data.get('market_cap_b'), 0)
    score = _to_float(stock_data.get('score'), 0)
    gap52 = _to_float(stock_data.get('to_52w_high'), 0)
    ret5d = _to_float(stock_data.get('recent_return_5d'), 0)
    perfw = _to_float(stock_data.get('perf_w'), 0)

    if screener == 'market_open_gap':
        return f"Gap {gap:+.2f}% | Pre {pre:+.2f}% | Vol {vol:.2f}M"
    if screener == 'rsi_reversal':
        signal = stock_data.get('reversal_signal') or 'MIXED'
        return f"{signal} reversal | RSI {rsi:.1f} | StochK {stoch_k:.1f} | Day {day:+.2f}%"
    if screener == 'nifty_movers':
        return f"Impact {impact:+.2f} | Cap {cap_b:.1f}B | Day {day:+.2f}%"
    if screener == 'high_momentum':
        return f"Score {int(score)} | RSI {rsi:.1f} | Vol {vol:.2f}M | Day {day:+.2f}%"
    if screener == 'buyer_interest' or screener == 'buyer_interest_enhanced':
        wick = _to_float(stock_data.get('wick_close_pct'), 0)
        surge = _to_float(stock_data.get('volume_surge'), 0)
        return f"Wick {wick:.0f}% | VolSurge {surge:.2f}x | RSI {rsi:.1f} | ADX {_to_float(stock_data.get('adx'), 0):.1f}"
    if screener == 'volatility_trend':
        return f"ATR% {_to_float(stock_data.get('atr_pct'), 0):.2f}% | ADX {_to_float(stock_data.get('adx'), 0):.1f} | RSI {rsi:.1f} | PerfW {perfw:+.1f}%"
    if screener == 'nifty50_activity':
        return f"Interest {_to_float(stock_data.get('interest_score'), 0):.0f} | VolSurge {_to_float(stock_data.get('volume_surge'), 0):.2f}x | RSI {rsi:.1f} | Day {day:+.2f}%"
    if screener == 'intraday_momentum':
        move = _to_float(stock_data.get('move_pct'), 0)
        lookback = stock_data.get('lookback_minutes', 15)
        return f"Move {move:+.2f}% ({lookback}m) | VolSurge {_to_float(stock_data.get('volume_surge'), 0):.2f}x | RSI {rsi:.1f}"

    if screener == 'undervalued':
        pe = _to_float(stock_data.get('pe'), 0)
        pb = _to_float(stock_data.get('pb'), 0)
        roe = _to_float(stock_data.get('roe'), 0)
        vs = _to_float(stock_data.get('value_score'), 0)
        return f"P/E {pe:.1f} | P/B {pb:.2f} | ROE {roe:.1f}% | Score {vs:.0f}"

    return f"Score {int(score)} | 52W gap {gap52:+.2f}% | 5D {ret5d:+.1f}% | PerfW {perfw:+.1f}%"


def _summary_items_for(screener, approaching, touched):
    rows = approaching + touched
    if not rows:
        return []

    def avg(key):
        vals = [_to_float(r.get(key), 0) for r in rows]
        return sum(vals) / len(vals) if vals else 0.0

    if screener == 'market_open_gap':
        gap_up = sum(1 for r in rows if _to_float(r.get('gap_pct'), 0) >= 0)
        gap_down = len(rows) - gap_up
        max_gap = max((_to_float(r.get('gap_pct'), 0) for r in rows), default=0.0)
        return [
            {'label': 'Avg Gap', 'value': f"{avg('gap_pct'):+.2f}%"},
            {'label': 'Max Gap', 'value': f"{max_gap:+.2f}%"},
            {'label': 'Gap Up/Down', 'value': f"{gap_up}/{gap_down}"}
        ]

    if screener == 'rsi_reversal':
        bullish = sum(1 for r in rows if str(r.get('reversal_signal', '')).upper() == 'BULLISH')
        bearish = sum(1 for r in rows if str(r.get('reversal_signal', '')).upper() == 'BEARISH')
        return [
            {'label': 'Bullish', 'value': str(bullish)},
            {'label': 'Bearish', 'value': str(bearish)},
            {'label': 'Avg RSI', 'value': f"{avg('rsi'):.1f}"}
        ]

    if screener == 'nifty_movers':
        net_impact = sum(_to_float(r.get('impact_score'), 0) for r in rows)
        top_sector = '-'
        sector_scores = {}
        for r in rows:
            sector = str(r.get('sector', '-'))
            sector_scores[sector] = sector_scores.get(sector, 0.0) + abs(_to_float(r.get('impact_score'), 0))
        if sector_scores:
            top_sector = max(sector_scores.items(), key=lambda x: x[1])[0]
        return [
            {'label': 'Net Impact', 'value': f"{net_impact:+.2f}"},
            {'label': 'Top Sector', 'value': top_sector},
            {'label': 'Avg Impact', 'value': f"{avg('impact_score'):.2f}"}
        ]

    if screener == 'high_momentum':
        return [
            {'label': 'Avg Score', 'value': f"{avg('score'):.1f}"},
            {'label': 'Avg RSI', 'value': f"{avg('rsi'):.1f}"},
            {'label': 'Avg Vol M', 'value': f"{avg('volume_m'):.2f}"}
        ]

    if screener == 'buyer_interest' or screener == 'buyer_interest_enhanced':
        return [
            {'label': 'Avg Wick', 'value': f"{avg('wick_close_pct'):.1f}%"},
            {'label': 'Avg Vol Surge', 'value': f"{avg('volume_surge'):.2f}x"},
            {'label': 'Avg RSI', 'value': f"{avg('rsi'):.1f}"}
        ]

    if screener == 'volatility_trend':
        return [
            {'label': 'Avg ATR%', 'value': f"{avg('atr_pct'):.2f}%"},
            {'label': 'Avg ADX', 'value': f"{avg('adx'):.1f}"},
            {'label': 'Avg Perf.W', 'value': f"{avg('perf_w'):+.1f}%"}
        ]

    if screener == 'nifty50_activity':
        return [
            {'label': 'Avg Interest', 'value': f"{avg('interest_score'):.1f}"},
            {'label': 'Avg Vol Surge', 'value': f"{avg('volume_surge'):.2f}x"},
            {'label': 'Avg Day %', 'value': f"{avg('day_change'):+.2f}%"}
        ]

    if screener == 'intraday_momentum':
        max_move = max((_to_float(r.get('move_pct'), 0) for r in rows), default=0.0)
        return [
            {'label': 'Avg Move', 'value': f"{avg('move_pct'):+.2f}%"},
            {'label': 'Max Move', 'value': f"{max_move:+.2f}%"},
            {'label': 'Avg Vol Surge', 'value': f"{avg('volume_surge'):.2f}x"}
        ]

    if screener == 'undervalued':
        return [
            {'label': 'Avg P/E', 'value': f"{avg('pe'):.1f}"},
            {'label': 'Avg ROE', 'value': f"{avg('roe'):.1f}%"},
            {'label': 'Stocks', 'value': str(len(rows))}
        ]

    return [
        {'label': 'Avg Score', 'value': f"{avg('score'):.1f}"},
        {'label': 'Avg 52W Gap', 'value': f"{avg('to_52w_high'):+.2f}%"},
        {'label': 'Rows', 'value': str(len(rows))}
    ]
