"""Session "verdict" blocks for ``GET /api/reports/nifty/live``.

Four small blocks answer "who is in control of today's Nifty tape?":

  - ``control``  — net call/put OI added today + ATM IV skew + GEX regime
  - ``regime``   — intraday range vs a multi-session baseline + realised vol
  - ``vix``      — India VIX level / change / day range
  - ``strength`` — EMA20/50, RSI(14) and position-in-range on today's 1-min spot

Design notes
------------
* Pure computation lives in the ``compute_*`` / ``*_verdict`` / indicator
  helpers and never touches the network (directly unit-testable).
* The only network calls are :func:`get_baseline_range` (one historical
  1-minute fetch of the last ~25 calendar days, cached once per process day),
  :func:`get_intraday_candles` (today's 1-minute spot, cached ~60s) and
  :func:`get_vix_block` (market quote, cached ~60s). All are wrapped so a
  failure degrades to ``null`` and can never break ``/live``.
* Upstox access goes through :func:`api.options.fetch_upstox` (which resolves
  the DB/file token via ``get_upstox_token``); this keeps the module
  import-light and cycle-free.
* Timestamps are always interpreted in IST via :data:`config.IST`.
"""

from __future__ import annotations

import math
import statistics
import time
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Optional

import config

# NSE index (never gate market data behind broker OAuth — the historical and
# market-quote endpoints only need the shared Upstox app credentials/token).
NIFTY_KEY = "NSE_INDEX|Nifty 50"
VIX_KEY = "NSE_INDEX|India VIX"

# Baseline window / session filters.
BASELINE_LOOKBACK_DAYS = 25
SESSION_START = "09:15"
SESSION_END = "12:30"
MIN_SESSION_BARS = 60

# Per-process-day / short-TTL caches (kept module-level so the 30s /live poll
# stays cheap even though it recomputes the report envelope every 30s).
_BASELINE_CACHE: dict[str, Any] = {"date": None, "value": None}
_INTRADAY_CACHE: dict[str, Any] = {"date": None, "ts": 0.0, "value": None}
_VIX_CACHE: dict[str, Any] = {"ts": 0.0, "value": None}

VIX_TTL_SEC = 60
INTRADAY_TTL_SEC = 60


# ---------------------------------------------------------------------------
# Safe casts
# ---------------------------------------------------------------------------

def _f(value: Any, default: Optional[float] = None) -> Optional[float]:
    """Best-effort float, else ``default`` (``None`` when unparseable)."""
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _i(value: Any, default: int = 0) -> int:
    """Best-effort int, else ``default``."""
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _null_vix() -> dict:
    return {"ltp": None, "prev_close": None, "change_pct": None,
            "day_high": None, "day_low": None}


# ---------------------------------------------------------------------------
# control block
# ---------------------------------------------------------------------------

def control_verdict(ce_doi: float, pe_doi: float) -> str:
    """Calls being written harder read bearish; puts bullish; else balanced.

    Thresholds are asymmetric by design (25% dominance), so a mild skew stays
    ``balanced``. Follows the frozen rule verbatim, including on unwinding
    days where one side's net delta goes negative.
    """
    if ce_doi > pe_doi * 1.25:
        return "call_writers"
    if pe_doi > ce_doi * 1.25:
        return "put_writers"
    return "balanced"


def atm_ivs(rows: list[dict], spot: float) -> tuple[Optional[float], Optional[float]]:
    """``(ce_iv, pe_iv)`` for the strike nearest ``spot``; ``None`` per dead leg."""
    if not rows:
        return None, None
    best: Optional[tuple[float, Optional[float], Optional[float]]] = None
    for r in rows:
        try:
            strike = _f((r or {}).get("strike"))
            if strike is None:
                continue
            ce_iv = _f(((r.get("ce") or {}).get("iv")))
            pe_iv = _f(((r.get("pe") or {}).get("iv")))
            ce_iv = ce_iv if ce_iv and ce_iv > 0 else None
            pe_iv = pe_iv if pe_iv and pe_iv > 0 else None
        except Exception:
            continue
        dist = abs(strike - spot) if spot else 0.0
        if best is None or dist < best[0]:
            best = (dist, ce_iv, pe_iv)
    if best is None:
        return None, None
    ce_iv = round(best[1], 2) if best[1] is not None else None
    pe_iv = round(best[2], 2) if best[2] is not None else None
    return ce_iv, pe_iv


def compute_control(rows: list[dict], spot: float,
                    gex_regime: Optional[str] = None) -> dict:
    """Sum today's net OI change per side, tag who is writing, add IV skew."""
    ce_doi = 0
    pe_doi = 0
    for r in rows or []:
        ce = (r or {}).get("ce") or {}
        pe = (r or {}).get("pe") or {}
        ce_doi += _i(ce.get("oi")) - _i(ce.get("prev_oi"))
        pe_doi += _i(pe.get("oi")) - _i(pe.get("prev_oi"))
    atm_ce_iv, atm_pe_iv = atm_ivs(rows or [], _f(spot, 0.0) or 0.0)
    skew = None
    if atm_ce_iv is not None and atm_pe_iv is not None:
        skew = round(atm_pe_iv - atm_ce_iv, 2)
    regime = gex_regime if gex_regime in ("long", "short", "flat") else "flat"
    return {
        "verdict": control_verdict(ce_doi, pe_doi),
        "ce_doi": ce_doi,
        "pe_doi": pe_doi,
        "atm_ce_iv": atm_ce_iv,
        "atm_pe_iv": atm_pe_iv,
        "skew": skew,
        "gex_regime": regime,
    }


def _avg_iv(control: dict) -> Optional[float]:
    """Mean of the available ATM IVs (used as the regime block's ``iv``)."""
    vals = [control.get("atm_ce_iv"), control.get("atm_pe_iv")]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 2)


# ---------------------------------------------------------------------------
# Indicators (pure)
# ---------------------------------------------------------------------------

def ema(values: list[float], period: int) -> Optional[float]:
    """Exponential moving average seeded with the first ``period`` mean."""
    if period <= 0 or len(values) < period:
        return None
    k = 2.0 / (period + 1.0)
    e = sum(values[:period]) / period
    for v in values[period:]:
        e = v * k + e * (1.0 - k)
    return e


def ema_series(values: list, period: int) -> list[Optional[float]]:
    """Per-bar EMA aligned index-wise to ``values`` (same length).

    Same seeding as :func:`ema` (first value = mean of the first ``period``
    valid closes, then recursive). Entries before the seed — and any gap
    where the close is missing/``None`` — are ``None``; the tail equals
    ``ema(values, period)`` when every close is present.
    """
    n = len(values or [])
    out: list[Optional[float]] = [None] * n
    if period <= 0 or n == 0:
        return out
    valid_idx: list[int] = []
    valid_vals: list[float] = []
    for i, v in enumerate(values):
        if v is None:
            continue
        try:
            valid_vals.append(float(v))
        except (TypeError, ValueError):
            continue
        else:
            valid_idx.append(i)
    if len(valid_vals) < period:
        return out
    k = 2.0 / (period + 1.0)
    e = sum(valid_vals[:period]) / period
    seq: list[Optional[float]] = [None] * (period - 1) + [e]
    for v in valid_vals[period:]:
        e = v * k + e * (1.0 - k)
        seq.append(e)
    for j, idx in enumerate(valid_idx):
        out[idx] = seq[j]
    return out


def rsi_wilder(closes: list[float], period: int = 14) -> Optional[float]:
    """Wilder's RSI over ``closes``; ``None`` until ``period + 1`` bars exist.

    A flat/rising series with zero average loss pins RSI at 100.
    """
    if period <= 0 or len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    avg_gain = sum(max(d, 0.0) for d in deltas[:period]) / period
    avg_loss = sum(max(-d, 0.0) for d in deltas[:period]) / period
    for d in deltas[period:]:
        avg_gain = (avg_gain * (period - 1) + max(d, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0.0)) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


def _closes(candles: Optional[list[dict]]) -> list[float]:
    out: list[float] = []
    for c in candles or []:
        v = _f((c or {}).get("close"))
        if v is not None and v > 0:
            out.append(v)
    return out


def _day_high_low(candles: Optional[list[dict]]) -> tuple[Optional[float], Optional[float]]:
    highs = [h for h in (_f((c or {}).get("high")) for c in candles or []) if h is not None]
    lows = [l for l in (_f((c or {}).get("low")) for c in candles or []) if l is not None]
    if not highs or not lows:
        return None, None
    return max(highs), min(lows)


def intraday_range_pts(candles: Optional[list[dict]]) -> Optional[float]:
    """Today's spot high-low so far, or ``None`` when no candles."""
    hi, lo = _day_high_low(candles)
    if hi is None or lo is None:
        return None
    return round(hi - lo, 2)


def _infer_bar_minutes(candles: Optional[list[dict]], default: float = 1.0) -> float:
    """Median spacing (minutes) of candle timestamps, for RV annualisation."""
    times = []
    for c in candles or []:
        t = (c or {}).get("time")
        if not t:
            continue
        try:
            times.append(datetime.fromisoformat(str(t).replace("Z", "+00:00")))
        except (TypeError, ValueError):
            continue
    if len(times) < 3:
        return default
    times.sort()
    deltas = [d for d in ((times[i] - times[i - 1]).total_seconds() / 60.0
                          for i in range(1, len(times))) if d > 0]
    if not deltas:
        return default
    return max(1.0, float(statistics.median(deltas)))


def realized_vol_pct(candles: Optional[list[dict]]) -> Optional[float]:
    """Annualised realised vol % from log returns of the candle closes.

    Bar size is inferred from the timestamps so the same function works on
    1-minute and 15-minute series (NSE session = 375 minutes, 252 sessions).
    """
    closes = _closes(candles)
    if len(closes) < 3:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    if not rets:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    if var <= 0:
        return 0.0
    bar_min = _infer_bar_minutes(candles)
    periods_per_year = 252.0 * (375.0 / bar_min)
    return round(math.sqrt(var) * math.sqrt(periods_per_year) * 100.0, 2)


# ---------------------------------------------------------------------------
# regime block
# ---------------------------------------------------------------------------

#: Below this share of a normal session range the tape is compressing.
RANGE_SELL_BELOW_PCT = 75.0
#: Above this it is expanding unambiguously — a trend regardless of vol ratio.
RANGE_TREND_ABOVE_PCT = 130.0
#: Realised/implied vol ratios that are far enough from 1.0 to mean something.
RV_IV_TREND = 1.15
RV_IV_SELL = 0.60
#: An ATM straddle down this much says long premium paid for nothing today.
STRADDLE_BLEED_PCT = -15.0
#: Annualising fewer than this many intraday bars makes RV unreliable — a
#: 12-bar sample at the open routinely prints 2-3x the day's true RV, which
#: fired a false "buy premium" at 09:27 on 2026-10-16. Below it the RV/IV ratio
#: is ignored and the verdict falls back to range / straddle / neutral.
REGIME_MIN_BARS = 30


def regime_verdict(range_pct: Optional[float], rv: Optional[float],
                   iv: Optional[float],
                   straddle_pct: Optional[float] = None,
                   bars: Optional[int] = None) -> str:
    """Is this a tape worth BUYING premium on? First match wins.

    These are VOL regimes, not direction: ``trend_buy`` means "long premium"
    (realised > implied), ``range_sell_premium`` means "short premium".

    ``bars`` is the number of intraday candles backing ``rv``. When it is below
    :data:`REGIME_MIN_BARS` the RV/IV ratio is not trusted (early-session RV is
    inflated by the tiny sample); ``None`` skips the guard so the pure function
    stays easy to unit-test.
    """
    if range_pct is not None and range_pct < RANGE_SELL_BELOW_PCT:
        return "range_sell_premium"

    # A bleeding ATM straddle is direct evidence that long premium LOST money
    # today, so it vetoes "buy premium" BEFORE the range-expansion rule. On
    # 2026-10-16 a 157%-range tape with a −22.65% straddle was labelled
    # "BUY PREMIUM" by the range branch even though premium buyers were down
    # 22% — the bleed is the stronger signal.
    if straddle_pct is not None and straddle_pct <= STRADDLE_BLEED_PCT:
        return "range_sell_premium"

    ratio = (rv / iv) if (rv is not None and iv) else None
    if range_pct is not None and range_pct > RANGE_TREND_ABOVE_PCT:
        return "trend_buy"
    if ratio is not None and (bars is None or bars >= REGIME_MIN_BARS):
        if ratio >= RV_IV_TREND:
            return "trend_buy"
        if ratio <= RV_IV_SELL:
            return "range_sell_premium"
    return "neutral"


def straddle_from_tape(tape_rows: Optional[list[dict]]) -> tuple[
        Optional[float], Optional[float], Optional[float]]:
    """``(open, now, pct)`` ATM straddle premium from the first/last usable tape row.

    A row is usable only when BOTH legs carry a positive ATM LTP (expiry-day
    tape can have one dead leg). ``pct`` is the intraday change in premium.
    """
    usable: list[float] = []
    for r in tape_rows or []:
        ce = _f((r or {}).get("atm_ce_ltp"))
        pe = _f((r or {}).get("atm_pe_ltp"))
        if ce is not None and pe is not None and ce > 0 and pe > 0:
            usable.append(ce + pe)
    if not usable:
        return None, None, None
    start = usable[0]
    now = usable[-1]
    pct = round((now / start - 1.0) * 100.0, 2) if start else None
    return round(start, 2), round(now, 2), pct


def compute_regime(candles: Optional[list[dict]], baseline: Optional[float],
                   iv: Optional[float] = None,
                   tape_rows: Optional[list[dict]] = None) -> dict:
    """Range-vs-trend read from today's spot candles + baseline + ATM straddle."""
    range_pts = intraday_range_pts(candles)
    range_pct = None
    if range_pts is not None and baseline:
        range_pct = round(range_pts / baseline * 100.0, 2)
    rv = realized_vol_pct(candles)
    bars = len(_closes(candles))
    straddle_open, straddle_now, straddle_pct = straddle_from_tape(tape_rows)
    return {
        "verdict": regime_verdict(range_pct, rv, iv, straddle_pct, bars=bars),
        "range_pts": range_pts,
        "range_baseline_pts": baseline,
        "range_pct": range_pct,
        "rv": rv,
        "iv": iv,
        "bars": bars,
        "warmup": bars < REGIME_MIN_BARS,
        "straddle_open": straddle_open,
        "straddle_now": straddle_now,
        "straddle_pct": straddle_pct,
    }


# ---------------------------------------------------------------------------
# strength block
# ---------------------------------------------------------------------------

def strength_verdict(score: int) -> str:
    if score >= 65:
        return "strong"
    if score <= 35:
        return "weak"
    return "neutral"


def compute_strength(candles: Optional[list[dict]],
                     spot: Optional[float] = None) -> dict:
    """EMA9/20/50 + Wilder RSI(14) + position-in-range, blended into a 0-100 score."""
    closes = _closes(candles)
    ema9 = ema(closes, 9) if len(closes) >= 9 else None
    ema20 = ema(closes, 20) if len(closes) >= 20 else None
    ema50 = ema(closes, 50) if len(closes) >= 50 else None
    rsi = rsi_wilder(closes, 14)
    hi, lo = _day_high_low(candles)
    last = _f(spot) if _f(spot) is not None else (closes[-1] if closes else None)
    pos = None
    if last is not None and hi is not None and lo is not None and hi > lo:
        pos = min(1.0, max(0.0, (last - lo) / (hi - lo)))

    b1 = 1 if (last is not None and ema20 is not None and last > ema20) else 0
    b2 = 1 if (ema20 is not None and ema50 is not None and ema20 > ema50) else 0
    b3 = 1 if (rsi is not None and rsi > 55) else 0
    score = int(round(35 * b1 + 25 * b2 + 20 * b3 + 20 * (pos or 0.0)))
    score = max(0, min(100, score))
    return {
        "verdict": strength_verdict(score),
        "score": score,
        "ema9": round(ema9, 2) if ema9 is not None else None,
        "ema20": round(ema20, 2) if ema20 is not None else None,
        "ema50": round(ema50, 2) if ema50 is not None else None,
        "rsi": round(rsi, 2) if rsi is not None else None,
        "pos_in_range": round(pos, 4) if pos is not None else None,
    }


# ---------------------------------------------------------------------------
# Baseline (median of prior sessions' 09:15-12:30 range)
# ---------------------------------------------------------------------------

def median_session_range(candles: Optional[list[dict]], exclude_date: str,
                         start: str = SESSION_START, end: str = SESSION_END,
                         min_bars: int = MIN_SESSION_BARS) -> Optional[float]:
    """Median 09:15-12:30 high-low across qualifying prior sessions.

    Raw Upstox candles are ``[ts, open, high, low, close, volume, oi]``; only
    sessions with at least ``min_bars`` in-window bars are kept so half-days /
    sparse fetches do not poison the median. ``exclude_date`` (today) is
    always dropped.
    """
    by_day: dict[str, list[tuple[float, float]]] = {}
    for row in candles or []:
        try:
            ts = str(row[0])
            day, hhmm = ts[:10], ts[11:16]
            if not (start <= hhmm <= end):
                continue
            hi = _f(row[2])
            lo = _f(row[3])
        except (IndexError, TypeError, ValueError):
            continue
        if hi is None or lo is None:
            continue
        by_day.setdefault(day, []).append((hi, lo))
    ranges: list[float] = []
    for day, bars in by_day.items():
        if day == exclude_date or len(bars) < min_bars:
            continue
        ranges.append(max(b[0] for b in bars) - min(b[1] for b in bars))
    if not ranges:
        return None
    return round(float(statistics.median(ranges)), 2)


def normalize_candles(raw: Optional[list]) -> list[dict]:
    """Map raw Upstox candle rows to ``{time, open, high, low, close}``, ascending."""
    out: list[dict] = []
    for row in raw or []:
        try:
            out.append({
                "time": str(row[0]),
                "open": _f(row[1]),
                "high": _f(row[2]),
                "low": _f(row[3]),
                "close": _f(row[4]),
            })
        except (IndexError, TypeError):
            continue
    out.sort(key=lambda c: c["time"])
    return out


# ---------------------------------------------------------------------------
# Network fetchers (cached, never raise)
# ---------------------------------------------------------------------------

async def _fetch(path: str, params: Optional[dict] = None) -> dict:
    from api.options import fetch_upstox
    return await fetch_upstox(path, params)


def _extract_candles(payload: Any) -> list:
    try:
        data = (payload or {}).get("data") or {}
        candles = data.get("candles") or []
        return candles if isinstance(candles, list) else []
    except Exception:
        return []


async def get_baseline_range(today_str: str) -> Optional[float]:
    """Median prior-session 09:15-12:30 range; fetched once per process day.

    One historical call covers ``BASELINE_LOOKBACK_DAYS`` calendar days. The
    result (including a ``None`` failure) is memoised per date so the 30s
    ``/live`` poll never re-fetches history.
    """
    if _BASELINE_CACHE["date"] == today_str:
        return _BASELINE_CACHE["value"]
    value: Optional[float] = None
    try:
        value = await _fetch_baseline(today_str)
    except Exception:
        value = None
    _BASELINE_CACHE["date"] = today_str
    _BASELINE_CACHE["value"] = value
    return value


async def _fetch_baseline(today_str: str) -> Optional[float]:
    try:
        today = datetime.strptime(today_str, "%Y-%m-%d")
    except ValueError:
        return None
    from_date = (today - timedelta(days=BASELINE_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    enc = urllib.parse.quote(NIFTY_KEY, safe="")
    payload = await _fetch(
        f"/historical-candle/{enc}/1minute/{today_str}/{from_date}")
    return median_session_range(_extract_candles(payload), exclude_date=today_str)


async def get_intraday_candles(today_str: str,
                               ttl: int = INTRADAY_TTL_SEC) -> Optional[list[dict]]:
    """Today's 1-minute Nifty spot candles, cached ~``ttl`` seconds.

    The yfinance candles already in the report are 15-minute; the strength and
    regime blocks call for 1-minute granularity, which the Upstox intraday
    endpoint provides for the NSE index. Failure returns ``None`` (the caller
    falls back to the report's own candles).
    """
    now = time.time()
    if (_INTRADAY_CACHE["date"] == today_str
            and now - _INTRADAY_CACHE["ts"] < ttl
            and _INTRADAY_CACHE["value"]):
        return _INTRADAY_CACHE["value"]
    value: Optional[list[dict]] = None
    try:
        enc = urllib.parse.quote(NIFTY_KEY, safe="")
        payload = await _fetch(f"/historical-candle/intraday/{enc}/1minute")
        rows = normalize_candles(_extract_candles(payload))
        value = rows or None
    except Exception:
        value = None
    if value:
        _INTRADAY_CACHE.update(date=today_str, ts=now, value=value)
    return value


async def get_vix_block() -> Optional[dict]:
    """India VIX OHLC + change; cached ~``VIX_TTL_SEC`` seconds."""
    now = time.time()
    if _VIX_CACHE["value"] is not None and now - _VIX_CACHE["ts"] < VIX_TTL_SEC:
        return _VIX_CACHE["value"]
    value: Optional[dict] = None
    try:
        value = await _fetch_vix()
    except Exception:
        value = None
    if value is not None:
        _VIX_CACHE["ts"] = now
        _VIX_CACHE["value"] = value
    return value


async def _fetch_vix() -> Optional[dict]:
    payload = await _fetch("/market-quote/ohlc",
                           {"instrument_key": VIX_KEY, "interval": "1d"})
    data = (payload or {}).get("data")
    if not isinstance(data, dict) or not data:
        return None
    row = data.get("NSE_INDEX:India VIX")
    if row is None:
        row = next(iter(data.values()), None)
    if not isinstance(row, dict):
        return None
    ohlc = row.get("ohlc") or {}
    ltp = _f(row.get("last_price"))
    # `ohlc.close` is the CURRENT day's close — intraday it equals last_price, so
    # using it as the previous close made change_pct a structural 0.00%. Take the
    # prior session's close from the daily series instead, and if we still end up
    # with "prev == ltp" report no change at all rather than a fake flat 0.00%.
    close = await _fetch_vix_prev_close()
    if close is None:
        candidate = _f(ohlc.get("close"))
        close = candidate if (candidate and ltp and candidate != ltp) else None
    change = round((ltp / close - 1.0) * 100.0, 2) if ltp and close else None
    return {
        "ltp": round(ltp, 2) if ltp is not None else None,
        "prev_close": round(close, 2) if close is not None else None,
        "change_pct": change,
        "day_high": round(h, 2) if (h := _f(ohlc.get("high"))) is not None else None,
        "day_low": round(l, 2) if (l := _f(ohlc.get("low"))) is not None else None,
    }


async def _fetch_vix_prev_close() -> Optional[float]:
    """Previous session's India VIX close.

    The market-quote OHLC endpoint cannot supply it (its ``close`` is today's).
    Daily candles come newest-first, so ``candles[1]`` is the prior session.
    """
    enc = urllib.parse.quote(VIX_KEY, safe="")
    today = datetime.now(config.IST).strftime("%Y-%m-%d")
    from_date = (datetime.now(config.IST) - timedelta(days=10)).strftime("%Y-%m-%d")
    # Upstox v2 daily is `/historical-candle/{key}/day/{to}/{from}` — no unit
    # segment (the `day/1` and `days/1` spellings both 404 with UDAPI100060).
    for interval in ("day", "days/1", "day/1"):
        try:
            payload = await _fetch(
                f"/historical-candle/{enc}/{interval}/{today}/{from_date}")
        except Exception:
            continue
        candles = _extract_candles(payload)
        if len(candles) >= 2:
            try:
                value = _f(candles[1][4])
            except (IndexError, TypeError):
                value = None
            if value:
                return value
    return None


def clear_caches() -> None:
    """Reset the module-level caches (used by tests)."""
    _BASELINE_CACHE.update(date=None, value=None)
    _INTRADAY_CACHE.update(date=None, ts=0.0, value=None)
    _VIX_CACHE.update(ts=0.0, value=None)


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def build_verdicts(*, rows: list[dict], spot: float, gex: Optional[dict],
                   candles: Optional[list[dict]],
                   tape_rows: Optional[list[dict]] = None,
                   baseline: Optional[float] = None,
                   vix: Optional[dict] = None) -> dict:
    """Return the four frozen blocks. Pure — all I/O happens in the fetchers."""
    control = compute_control(rows or [], _f(spot, 0.0) or 0.0,
                              gex_regime=(gex or {}).get("regime"))
    regime = compute_regime(candles=candles, baseline=baseline,
                            iv=_avg_iv(control), tape_rows=tape_rows)
    strength = compute_strength(candles, spot=_f(spot))
    return {
        "control": control,
        "regime": regime,
        "vix": vix if vix is not None else _null_vix(),
        "strength": strength,
    }
