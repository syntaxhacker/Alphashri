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
* The realised vol is a **full-day** figure when the previous session's close
  is known (the overnight gap's variance is added to the session's), so it can
  be compared with a 24h implied vol directly. Without it the ratio is
  flagged ``rv_like_for_like: false`` and the regime verdict refuses to use
  it — a session-only realised vol is biased low and reads as "sell premium"
  on a perfectly normal session.
"""

from __future__ import annotations

import math
import statistics
import time
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Optional

import config

from api.reports_api._numeric import safe_int as _i
from api.reports_api._numeric import safe_opt_float as _f

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

def _null_vix() -> dict:
    return {"ltp": None, "prev_close": None, "change_pct": None,
            "day_high": None, "day_low": None}


# ---------------------------------------------------------------------------
# control block
# ---------------------------------------------------------------------------

#: Signed premium-flow magnitude (₹ Cr) below which the flow carries no
#: direction. Matches the absolute floor in ``nifty_positioning``: 50 Cr is
#: ~0.1 % of a 58,000 Cr book, so anything smaller is noise, not a bias.
FLOW_BIAS_EPS_CR = 50.0


def control_verdict(ce_doi: float, pe_doi: float,
                    flow_bias: Optional[float] = None) -> str:
    """Who is in control: read OI *build* together with the signed flow bias.

    ``flow_bias`` is the session's signed directional premium flow in **₹ Cr**
    (positive = net bullish / premium being bought on calls or sold on puts,
    negative = net bearish / put buying). It is the same number that drives
    ``positioning.initiated`` / ``positioning.flow_class`` — the caller must
    pass that existing figure, never recompute a second one.

    Raw OI change alone cannot tell a writer from a buyer: on a falling day
    added put OI is usually put **buyers** (bearish), yet the old OI-share rule
    called it ``put_writers`` (bullish by convention). So a writer label now
    also needs flow evidence:

    * puts dominant + flow **not clearly negative** → ``put_writers``
    * puts dominant + flow **clearly negative** → ``put_buyers`` (bearish)
    * calls dominant + flow **not clearly positive** → ``call_writers``
    * calls dominant + flow **clearly positive** → ``call_buyers`` (bullish)

    "Clearly" is :data:`FLOW_BIAS_EPS_CR` — a bias within ±50 Cr is treated as
    neutral, so a noise-level print cannot flip a label. Without a flow block
    (``flow_bias is None``) the rule refuses to assert writers and returns the
    neutral ``net_put_build`` / ``net_call_build`` instead.

    Thresholds are asymmetric by design (25 % OI dominance), so a mild skew
    stays ``balanced``.

    Both sides must be **net adding** (``ce_doi > 0`` and ``pe_doi > 0``)
    before either side may be named. A negative side means the tape is
    UNWINDING on that leg, and the old rule still named a writer there: with
    ce_doi = −5M and pe_doi = +1M the comparison ``pe_doi > ce_doi * 1.25``
    was true (1M > −6.25M) and the panel printed "PUT WRITERS IN CONTROL" on
    a day the calls were being shed.
    """
    if ce_doi <= 0 or pe_doi <= 0:
        return "balanced"
    put_dominant = pe_doi > ce_doi * 1.25
    call_dominant = ce_doi > pe_doi * 1.25
    if not put_dominant and not call_dominant:
        return "balanced"
    bias = _f(flow_bias)
    if bias is None:
        # Old snapshot / no flow block: OI build is real, but WHO built it is
        # unknown — never assert a writer without flow evidence.
        return "net_put_build" if put_dominant else "net_call_build"
    if put_dominant:
        return "put_buyers" if bias < -FLOW_BIAS_EPS_CR else "put_writers"
    return "call_buyers" if bias > FLOW_BIAS_EPS_CR else "call_writers"


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
                    gex_regime: Optional[str] = None,
                    flow_bias: Optional[float] = None) -> dict:
    """Sum today's net OI change per side, tag who is writing, add IV skew.

    ``flow_bias`` (₹ Cr, positive = bullish) is threaded into
    :func:`control_verdict` so a writer label needs flow evidence, not just the
    OI share (see that function). It is echoed back for auditability.
    """
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
    bias = _f(flow_bias)
    return {
        "verdict": control_verdict(ce_doi, pe_doi, bias),
        "ce_doi": ce_doi,
        "pe_doi": pe_doi,
        "flow_bias": round(bias, 2) if bias is not None else None,
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


def _hhmm(candle: Optional[dict]) -> Optional[str]:
    """``"HH:MM"`` of a candle's ISO timestamp, or ``None`` when absent."""
    t = (candle or {}).get("time")
    if not t:
        return None
    s = str(t)
    if len(s) >= 16 and s[10] in ("T", " "):
        return s[11:16]
    return None


def intraday_range_pts(candles: Optional[list[dict]],
                       start: str = SESSION_START,
                       end: str = SESSION_END) -> Optional[float]:
    """Today's spot high-low over the **baseline window** (09:15-12:30).

    The baseline is the median of prior sessions' 09:15-12:30 range, so today's
    range must be measured over the SAME window. Comparing a full session
    (to 15:30) against a morning baseline overstated the ratio: on 2026-10-21
    the full session read 199.5% of the baseline where the like-for-like
    morning window read 177.1%.

    Candles without a usable timestamp are kept (they cannot be placed in the
    window); when NO candle carries a timestamp the whole set is used, so a
    series without times still produces a range.
    """
    usable = [c for c in (candles or []) if isinstance(c, dict)]
    if not usable:
        return None
    stamped = [c for c in usable if _hhmm(c) is not None]
    if stamped:
        in_window = [c for c in stamped
                     if start <= (_hhmm(c) or "") <= end]
    else:
        in_window = usable
    if not in_window:
        return None
    hi, lo = _day_high_low(in_window)
    if hi is None or lo is None:
        return None
    return round(hi - lo, 2)


def session_range_pts(candles: Optional[list[dict]]) -> Optional[float]:
    """Today's FULL-session high-low so far (no window cut) — or ``None``."""
    hi, lo = _day_high_low(candles or [])
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


#: Minutes in one NSE session (09:15-15:30).
SESSION_MINUTES = 375.0
#: Trading days per year — the annualisation factor for a daily variance.
TRADING_DAYS = 252.0


def _first_open(candles: Optional[list[dict]]) -> Optional[float]:
    """The first candle's OPEN (the session's opening print), or ``None``."""
    for c in candles or []:
        if not isinstance(c, dict):
            continue
        v = _f(c.get("open"))
        if v is not None and v > 0:
            return v
    return None


def overnight_gap_pct(candles: Optional[list[dict]],
                      prev_close: Optional[float]) -> Optional[float]:
    """Overnight gap % (previous close → today's opening print), or ``None``.

    ``None`` when the previous close is unknown or the candles carry no open —
    the caller then knows the realised vol it computed is **session-only** and
    therefore NOT comparable with a 24h implied vol.
    """
    pc = _f(prev_close)
    if pc is None or pc <= 0:
        return None
    op = _first_open(candles)
    if op is None or op <= 0:
        return None
    try:
        return round((op / pc - 1.0) * 100.0, 3)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def realized_vol_pct(candles: Optional[list[dict]],
                     prev_close: Optional[float] = None) -> Optional[float]:
    """Annualised realised vol % from the log returns of the candle closes.

    Bar size is inferred from the timestamps so the same function works on
    1-minute and 15-minute series (NSE session = 375 minutes, 252 sessions).

    ``prev_close`` (the previous session's close) makes the figure
    **like-for-like with an implied vol**. An ATM IV prices the whole
    1440-minute day, while a session-only realised vol only sees the 375
    traded minutes, so the raw ratio is biased low and the two numbers are not
    the same measure. With the previous close known, the overnight gap's
    variance is added to the session's:

        daily_var = session_var + gap_var
        rv_ann    = sqrt(daily_var * 252)

    Measured on the 2026-10-21 tape (373 one-minute bars, ATM IV 14.25):
    the session-only figure was **11.45 %** (ratio 0.80 — a session that
    looked 20 % CHEAP against its own implied vol), while the full-day figure
    with the overnight gap is **14.43 %** (ratio **1.01** — parity, which is
    what an implied vol actually prices). Scaling the session figure by
    ``sqrt(1440 / 375)`` instead would read 1.57: it assumes the 16 closed
    hours move as much per minute as the open session, and they do not (a
    Nifty overnight gap is ~0.6 % against a ~0.9 % daily move).

    Without ``prev_close`` the session-only figure is returned and the caller
    must treat the RV/IV comparison as unreliable (see
    :func:`regime_verdict`'s ``rv_like_for_like``).
    """
    closes = _closes(candles)
    if len(closes) < 3:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    if not rets:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    bar_min = _infer_bar_minutes(candles)
    # Variance of the session's cumulative move (the per-bar variance scaled
    # to the number of bars in a session).
    daily_var = var * (SESSION_MINUTES / bar_min)
    gap = overnight_gap_pct(candles, prev_close)
    if gap is not None:
        try:
            daily_var += (math.log(1.0 + gap / 100.0)) ** 2
        except (TypeError, ValueError):
            pass
    if daily_var <= 0:
        return 0.0
    return round(math.sqrt(daily_var) * math.sqrt(TRADING_DAYS) * 100.0, 2)


# ---------------------------------------------------------------------------
# regime block
# ---------------------------------------------------------------------------

#: Below this share of a normal session range the tape is compressing.
RANGE_SELL_BELOW_PCT = 75.0
#: Above this it is expanding unambiguously — a trend, whatever the vol ratio.
RANGE_TREND_ABOVE_PCT = 130.0
#: Realised/implied vol ratios that are far enough from 1.0 to mean something.
#:
#: Re-checked against the like-for-like ratio (both sides now a full-day
#: measure, so parity sits at ~1.0 again — 1.01 on the 2026-10-21 tape):
#:
#: * ``RV_IV_TREND`` 1.15 → realised vol at least 15 % ABOVE implied → the
#:   long-premium (buy vol) side.
#: * ``RV_IV_SELL`` 0.60 → realised vol at least 40 % BELOW implied → the
#:   short-premium (sell vol) side.
#:
#: Both keep their original meaning ("far enough from 1.0 to mean
#: something"), which is only true again because the ratio is now
#: like-for-like — before the overnight gap was added the parity point of the
#: raw ratio was ~0.96 and every verdict was shifted towards "sell premium".
RV_IV_TREND = 1.15
RV_IV_SELL = 0.60
#: An ATM straddle down this much says long premium paid for nothing today.
STRADDLE_BLEED_PCT = -15.0
#: Annualising fewer than this many intraday bars makes RV unreliable — a
#: 12-bar sample at the open routinely prints 2-3x the day's true RV, which
#: fired a false "buy premium" at 09:27 on 2026-10-16. Below it the RV/IV ratio
#: is ignored and the verdict falls back to range / straddle / neutral.
REGIME_MIN_BARS = 30


def rv_iv_ratio(rv: Optional[float], iv: Optional[float]) -> Optional[float]:
    """Realised/implied vol ratio, both sides on a full-day (24h) basis.

    ``rv`` must be the **full-day** realised vol (see
    :func:`realized_vol_pct` with ``prev_close``) for this to be meaningful —
    a session-only realised vol is not comparable with an implied vol and is
    systematically low. ``None`` when either side is missing.
    """
    if rv is None or not iv:
        return None
    try:
        return rv / iv
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def regime_verdict(range_pct: Optional[float], rv: Optional[float],
                   iv: Optional[float],
                   straddle_pct: Optional[float] = None,
                   bars: Optional[int] = None,
                   rv_like_for_like: bool = True) -> str:
    """Is this a tape worth BUYING premium on? First match wins.

    These are VOL regimes, not direction: ``trend_buy`` means "long premium"
    (realised > implied) and it is only ever returned on **RV/IV evidence** —
    a wide range alone is not enough. The range branch returns ``trend``
    (the tape is expanding; direction-agnostic) so a 199%-range day with a
    dead vol ratio can never be read as "buy premium" again.

    ``bars`` is the number of intraday candles backing ``rv``. When it is below
    :data:`REGIME_MIN_BARS` the RV/IV ratio is not trusted (early-session RV is
    inflated by the tiny sample); ``None`` skips the guard so the pure function
    stays easy to unit-test.

    ``rv_like_for_like`` says whether ``rv`` already includes the overnight
    gap (i.e. it is a full-day figure comparable with a 24h implied vol). When
    it is ``False`` the RV branch is skipped entirely: a session-only realised
    vol is biased low and would read as "sell premium" on a perfectly normal
    session.
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

    ratio = rv_iv_ratio(rv, iv)
    trusted = (ratio is not None and rv_like_for_like
               and (bars is None or bars >= REGIME_MIN_BARS))
    if trusted:
        if ratio >= RV_IV_TREND:
            return "trend_buy"
        if ratio <= RV_IV_SELL:
            return "range_sell_premium"
    # Range expansion WITHOUT vol confirmation: a trend, not a premium verdict.
    if range_pct is not None and range_pct > RANGE_TREND_ABOVE_PCT:
        return "trend"
    return "neutral"


def straddle_from_tape(tape_rows: Optional[list[dict]]) -> tuple[
        Optional[float], Optional[float], Optional[float]]:
    """``(open, now, pct)`` ATM straddle premium change, within ONE instrument.

    The ATM strike rolls as spot moves, so a naive first-row/last-row diff
    compares two DIFFERENT contracts: on 2026-10-21 the tape's first row was
    the 23,000 straddle at 346.75 and the last row the 22,650 straddle at
    334.05 — a −4.41% "straddle change" that described nothing. Rows are
    therefore grouped by ``atm_strike`` and only rows of the SAME strike are
    ever compared.

    The group used is the one the LAST row belongs to (the strike that is ATM
    now). When that group holds a single observation the strike has just
    rolled and there is nothing to compare against → ``(None, None, None)``.

    Rows without an ``atm_strike`` share one group (old tapes recorded before
    the field existed), so the classic first/last read still works for them.
    """
    groups: dict[Optional[float], list[float]] = {}
    order: list[Optional[float]] = []
    for r in tape_rows or []:
        if not isinstance(r, dict):
            continue
        ce = _f((r or {}).get("atm_ce_ltp"))
        pe = _f((r or {}).get("atm_pe_ltp"))
        if ce is None or pe is None or ce <= 0 or pe <= 0:
            continue
        strike = _f((r or {}).get("atm_strike"))
        if strike is None or strike <= 0:
            strike = None
        if strike not in groups:
            groups[strike] = []
            order.append(strike)
        groups[strike].append(ce + pe)
    if not order:
        return None, None, None
    series = groups[order[-1]]
    if len(series) < 2:
        # The ATM strike just rolled — a single observation is not a change.
        return None, None, None
    start = series[0]
    now = series[-1]
    pct = round((now / start - 1.0) * 100.0, 2) if start else None
    return round(start, 2), round(now, 2), pct


def straddle_from_reference(reference: Optional[dict]) -> tuple[
        Optional[float], Optional[float], Optional[float]]:
    """``(open, now, pct)`` for the PINNED ATM strike (see ``compute_reference``).

    The pinned strike is the day's FIRST ATM strike, so the comparison is
    always one contract against itself: its open premium (from the tape's
    first row) against its current price (from the chain). This is the only
    day-level straddle read that survives a strike roll — on 2026-10-21 it
    reads +16.86% where the naive first/last diff read −4.41%.

    ``(None, None, None)`` when the reference is missing or incomplete (a
    strike that is no longer in the chain, or no tape row to anchor the open).
    """
    if not isinstance(reference, dict):
        return None, None, None
    ce_open = _f(reference.get("ce_open"))
    pe_open = _f(reference.get("pe_open"))
    ce_ltp = _f(reference.get("ce_ltp"))
    pe_ltp = _f(reference.get("pe_ltp"))
    if None in (ce_open, pe_open, ce_ltp, pe_ltp):
        return None, None, None
    if ce_open <= 0 or pe_open <= 0 or ce_ltp <= 0 or pe_ltp <= 0:
        return None, None, None
    start = ce_open + pe_open
    now = ce_ltp + pe_ltp
    pct = round((now / start - 1.0) * 100.0, 2) if start else None
    return round(start, 2), round(now, 2), pct


def compute_regime(candles: Optional[list[dict]], baseline: Optional[float],
                   iv: Optional[float] = None,
                   tape_rows: Optional[list[dict]] = None,
                   reference: Optional[dict] = None,
                   prev_close: Optional[float] = None) -> dict:
    """Range-vs-trend read from today's spot candles + baseline + ATM straddle.

    ``range_pts`` is measured over the SAME window as the baseline
    (09:15-12:30) so the ratio is like-for-like; the full-session range is
    emitted alongside as ``session_range_pts``.

    The straddle read prefers the PINNED-strike reference (one contract
    against itself) and falls back to the tape's ATM groups.

    ``prev_close`` (the previous session's close) makes the realised vol a
    full-day figure, so the RV/IV comparison is like-for-like with a 24h
    implied vol (see :func:`realized_vol_pct`). Without it the realised vol is
    session-only, the ratio is flagged ``rv_like_for_like: false`` and the
    verdict refuses to use it.
    """
    range_pts = intraday_range_pts(candles)
    full_range_pts = session_range_pts(candles)
    range_pct = None
    if range_pts is not None and baseline:
        range_pct = round(range_pts / baseline * 100.0, 2)
    rv = realized_vol_pct(candles, prev_close)
    bars = len(_closes(candles))
    gap_pct = overnight_gap_pct(candles, prev_close)
    like_for_like = gap_pct is not None
    straddle_open, straddle_now, straddle_pct = straddle_from_reference(reference)
    if straddle_pct is None:
        straddle_open, straddle_now, straddle_pct = straddle_from_tape(tape_rows)
    ratio = rv_iv_ratio(rv, iv)
    return {
        "verdict": regime_verdict(range_pct, rv, iv, straddle_pct, bars=bars,
                                   rv_like_for_like=like_for_like),
        "range_pts": range_pts,
        "range_baseline_pts": baseline,
        "range_pct": range_pct,
        "session_range_pts": full_range_pts,
        "rv": rv,
        "iv": iv,
        "rv_iv_ratio": (round(ratio, 3) if ratio is not None else None),
        # False when the overnight gap could not be added, i.e. the realised
        # vol is a session-only figure and NOT comparable with a 24h IV.
        "rv_like_for_like": like_for_like,
        "overnight_gap_pct": gap_pct,
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
    spot_f = _f(spot)
    last = spot_f if spot_f is not None else (closes[-1] if closes else None)
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
                   vix: Optional[dict] = None,
                   reference: Optional[dict] = None,
                   prev_close: Optional[float] = None,
                   flow_bias: Optional[float] = None) -> dict:
    """Return the four frozen blocks. Pure — all I/O happens in the fetchers.

    ``flow_bias`` is the signed session premium flow (₹ Cr, positive =
    bullish) that already backs ``positioning.initiated``; it is threaded into
    the control block so writer labels require flow evidence.
    """
    control = compute_control(rows or [], _f(spot, 0.0) or 0.0,
                              gex_regime=(gex or {}).get("regime"),
                              flow_bias=flow_bias)
    regime = compute_regime(candles=candles, baseline=baseline,
                            iv=_avg_iv(control), tape_rows=tape_rows,
                            reference=reference, prev_close=prev_close)
    strength = compute_strength(candles, spot=_f(spot))
    return {
        "control": control,
        "regime": regime,
        "vix": vix if vix is not None else _null_vix(),
        "strength": strength,
    }
