"""Market dashboard endpoint: movers + unusual activity.

Data
----
Metrics come from TradingView (``tradingview_screener``) restricted to a
known universe (``chart_patterns.universes``). Sparklines come from our
disk-cached 1-minute candles (``chart_patterns.candles.fetch_for_timeframe``).

Contract
--------
``GET /api/screener/dashboard?universe=nifty500`` ->

``{universe, as_of (IST iso), total, cached, age_sec,
sections:[{id, title, panels:[...]}]}``

Each panel: ``{id, title, metric_label, qualify, rows}`` where ``qualify``
is the count of universe symbols matching the panel's condition.

Each row: ``{symbol, name, close, change, logo, sub_label, sub_value, spark,
rsi, vwap, atr, price_52_week_high, market_cap}``.

Query params: ``limit`` (rows per panel, default 8, 4..30),
``min_market_cap_cr`` (default 500, applied to ``market_cap_basic`` in
rupees before paneling).

Fail-soft: any error returns ``{sections: []}`` (never 500). A small
in-process TTL cache (60 s) keyed by (universe, limit, min_market_cap_cr)
avoids hammering TV; a background ``dashboard_prewarm_task`` (same pattern
as ``watch_snapshot_task``) keeps the default universe(s) warm every ~60 s
in market hours.
"""

from __future__ import annotations

import asyncio
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Query

from api.utils import _sanitize_for_json

router = APIRouter(prefix="/api/screener", tags=["screener"])

TV_FIELDS = [
    "name",
    "close",
    "change",
    "volume",
    "average_volume_10d_calc",
    "relative_volume_10d_calc",
    "market_cap_basic",
    "logoid",
    "gap",
    "price_52_week_high",
    "price_52_week_low",
    "ATR",
    "RSI",
    "VWAP",
    "high",
    "low",
    "Value.Traded",
    "sector",
    "industry",
]

LOGO_URL = "https://s3-symbol-logo.tradingview.com/{logoid}.svg"
_LOGOID_RE = re.compile(r"^[A-Za-z0-9-]+$")

CACHE_TTL_SECONDS = 60
SPARK_BARS = 30
SPARK_MAX_SYMBOLS = 60
SPARK_WORKERS = 6
TV_LIMIT = 3000

_cache: dict[str, tuple[float, dict]] = {}


def logo_url(logoid: Any) -> Optional[str]:
    """TradingView logo URL, or None when the logoid is not a usable slug."""
    if logoid is None:
        return None
    slug = str(logoid).strip()
    if not slug or slug in ("0", "None"):
        return None
    if not _LOGOID_RE.match(slug):
        return None
    return LOGO_URL.format(logoid=slug)


def normalize_spark(closes: list[float], limit: int = SPARK_BARS) -> list[float]:
    """Normalize the last ``limit`` closes to 0..1 (flat series -> 0.5)."""
    vals = [c for c in closes if c is not None and math.isfinite(float(c))]
    vals = [float(c) for c in vals][-limit:]
    if not vals:
        return []
    lo, hi = min(vals), max(vals)
    if hi <= lo:
        return [0.5] * len(vals)
    span = hi - lo
    return [round((c - lo) / span, 4) for c in vals]


def _finite(value: Any) -> Optional[float]:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _fmt_times(value: Optional[float], suffix: str) -> str:
    if value is None:
        return f"— {suffix}"
    return f"{value:.1f}x {suffix}"


def _cr(value_rupees: Optional[float]) -> str:
    if value_rupees is None:
        return "—"
    cr = value_rupees / 1e7
    if cr >= 1000:
        return f"\u20b9{cr / 1000:.1f}k Cr"
    return f"\u20b9{cr:.1f} Cr"


def _row_symbol(row: dict) -> str:
    """Universe-canonical symbol for a TV frame row (name or NSE:ticker)."""
    name = str(row.get("name") or "").strip().upper()
    if name:
        return name
    ticker = str(row.get("ticker") or "").strip().upper()
    if ":" in ticker:
        ticker = ticker.split(":")[-1]
    return ticker


def _fetch_tv_frame() -> Any:
    from tradingview_screener import Query

    q = (
        Query()
        .select(*TV_FIELDS)
        .set_markets("india")
        .limit(TV_LIMIT)
    )
    _, df = q.get_scanner_data()
    return df


def _fetch_sparks(symbols: list[str]) -> dict[str, list[float]]:
    """Last-30-close 1m sparks, normalized; ``[]`` per symbol on failure."""
    from chart_patterns.candles import fetch_for_timeframe

    out: dict[str, list[float]] = {}

    def _one(sym: str) -> tuple[str, list[float]]:
        try:
            df = fetch_for_timeframe(sym, "1m")
            if df is None or getattr(df, "empty", True) or "close" not in df.columns:
                return sym, []
            return sym, normalize_spark(list(df["close"].tail(SPARK_BARS)))
        except Exception:
            return sym, []

    capped = list(dict.fromkeys(symbols))[:SPARK_MAX_SYMBOLS]
    if not capped:
        return out
    with ThreadPoolExecutor(max_workers=SPARK_WORKERS) as ex:
        for sym, spark in ex.map(_one, capped):
            out[sym] = spark
    return out


def _to_52w_pct(close: Optional[float], high52: Optional[float]) -> Optional[float]:
    if close is None or high52 is None or high52 <= 0:
        return None
    return (close - high52) / high52 * 100.0


def _from_52w_low_pct(close: Optional[float], low52: Optional[float]) -> Optional[float]:
    if close is None or low52 is None or low52 <= 0:
        return None
    return (close - low52) / low52 * 100.0


def _build_row(
    rec: dict, sub_label: str, sub_value: str, sparks: dict[str, list[float]]
) -> dict:
    return {
        "symbol": rec["symbol"],
        "name": rec.get("name") or rec["symbol"],
        "close": rec.get("close"),
        "change": rec.get("change"),
        "logo": logo_url(rec.get("logoid")),
        "sub_label": sub_label,
        "sub_value": sub_value,
        "spark": sparks.get(rec["symbol"], []),
        "rsi": rec.get("rsi"),
        "vwap": rec.get("vwap"),
        "atr": rec.get("atr"),
        "price_52_week_high": rec.get("high52"),
        "market_cap": rec.get("market_cap"),
    }


def _build_payload(universe: str, records: list[dict], limit: int = 8) -> dict:
    try:
        import config as _cfg

        now = datetime.now(_cfg.IST)
    except Exception:
        now = datetime.now().astimezone()

    if not records:
        return {
            "universe": universe,
            "as_of": now.isoformat(),
            "total": 0,
            "cached": False,
            "age_sec": 0.0,
            "sections": [],
        }

    # ---- movers ----
    by_change = sorted(
        [r for r in records if r.get("change") is not None],
        key=lambda r: r["change"],
        reverse=True,
    )
    losers = sorted(
        [r for r in records if r.get("change") is not None],
        key=lambda r: r["change"],
    )
    # Within 5% *below* the 52W high (a hair above allowed for fresh breakouts).
    near_high = [
        r
        for r in records
        if (t := _to_52w_pct(r.get("close"), r.get("high52"))) is not None
        and -5.0 <= t <= 0.5
        and r.get("close") is not None
    ]
    near_high.sort(
        key=lambda r: _to_52w_pct(r.get("close"), r.get("high52")) or -math.inf,
        reverse=True,
    )
    # Within 5% *above* the 52W low (a hair below allowed).
    near_low = [
        r
        for r in records
        if (t := _from_52w_low_pct(r.get("close"), r.get("low52"))) is not None
        and -0.5 <= t <= 5.0
        and r.get("close") is not None
    ]
    near_low.sort(
        key=lambda r: _from_52w_low_pct(r.get("close"), r.get("low52")) or math.inf
    )
    by_vol = sorted(
        [r for r in records if r.get("volume") is not None],
        key=lambda r: r["volume"],
        reverse=True,
    )
    by_turnover = sorted(
        [r for r in records if r.get("turnover") is not None],
        key=lambda r: r["turnover"],
        reverse=True,
    )

    # ---- unusual ----
    vol_surge = sorted(
        [r for r in records if r.get("relvol") is not None and r["relvol"] >= 3],
        key=lambda r: r["relvol"],
        reverse=True,
    )
    gap_up = sorted(
        [r for r in records if r.get("gap") is not None and r["gap"] >= 3],
        key=lambda r: r["gap"],
        reverse=True,
    )
    gap_down = sorted(
        [r for r in records if r.get("gap") is not None and r["gap"] <= -3],
        key=lambda r: r["gap"],
    )
    range_rows = []
    for r in records:
        atr = r.get("atr")
        hi, lo = r.get("high"), r.get("low")
        if atr is None or atr <= 0 or hi is None or lo is None:
            continue
        range_rows.append((r, (hi - lo) / atr))
    range_rows.sort(key=lambda t: t[1], reverse=True)

    panels_spec: list[dict] = [
        {
            "id": "gainers",
            "title": "Top Gainers",
            "metric_label": "Change %",
            "qualify": len(by_change),
            "picks": by_change[:limit],
            "sub": lambda r: (
                "Vol vs avg",
                _fmt_times(
                    (r["volume"] / r["avgvol"])
                    if r.get("avgvol")
                    else None,
                    "avg",
                ),
            ),
        },
        {
            "id": "losers",
            "title": "Top Losers",
            "metric_label": "Change %",
            "qualify": len(losers),
            "picks": losers[:limit],
            "sub": lambda r: (
                "Vol vs avg",
                _fmt_times(
                    (r["volume"] / r["avgvol"])
                    if r.get("avgvol")
                    else None,
                    "avg",
                ),
            ),
        },
        {
            "id": "near_52w_high",
            "title": "Near 52W High",
            "metric_label": "To 52W high %",
            "qualify": len(near_high),
            "picks": near_high[:limit],
            "sub": lambda r: (
                "To 52W high",
                (
                    lambda _to: "at level"
                    if _to is not None and _to >= -0.5
                    else f"{(_to or 0.0):.1f}% to high"
                )(_to_52w_pct(r.get("close"), r.get("high52"))),
            ),
        },
        {
            "id": "near_52w_low",
            "title": "Near 52W Low",
            "metric_label": "From 52W low %",
            "qualify": len(near_low),
            "picks": near_low[:limit],
            "sub": lambda r: (
                "From 52W low",
                (
                    lambda _to: "at level"
                    if _to is not None and _to <= 0.5
                    else f"{(_to or 0.0):.1f}% above low"
                )(_from_52w_low_pct(r.get("close"), r.get("low52"))),
            ),
        },
        {
            "id": "most_active",
            "title": "Most Active",
            "metric_label": "Volume",
            "qualify": len(by_vol),
            "picks": by_vol[:limit],
            "sub": lambda r: (
                "Volume",
                f"{_cr((r.get('volume') or 0) * (r.get('close') or 0))}"
                f" \u00b7 {_fmt_times((r['volume'] / r['avgvol']) if r.get('avgvol') else None, 'avg')}",
            ),
        },
        {
            "id": "turnover",
            "title": "Top Turnover",
            "metric_label": "Value traded",
            "qualify": len(by_turnover),
            "picks": by_turnover[:limit],
            # TV Value.Traded for NSE is in INR (verified live: BHARTIARTL
            # ~2.55e10 ~= Rs.2550 Cr daily turnover).
            "sub": lambda r: ("Turnover", _cr(r.get("turnover"))),
        },
        {
            "id": "volume_surge",
            "title": "Volume Surge",
            "metric_label": "Rel. volume",
            "qualify": len(vol_surge),
            "picks": vol_surge[:limit],
            "sub": lambda r: ("Rel. volume", _fmt_times(r.get("relvol"), "rel. volume")),
        },
        {
            "id": "gap_up",
            "title": "Gap Up",
            "metric_label": "Gap %",
            "qualify": len(gap_up),
            "picks": gap_up[:limit],
            "sub": lambda r: ("Gap", f"{(r.get('gap') or 0.0):+.1f}% gap at open"),
        },
        {
            "id": "gap_down",
            "title": "Gap Down",
            "metric_label": "Gap %",
            "qualify": len(gap_down),
            "picks": gap_down[:limit],
            "sub": lambda r: ("Gap", f"{(r.get('gap') or 0.0):+.1f}% gap at open"),
        },
        {
            "id": "range_expansion",
            "title": "Range Expansion",
            "metric_label": "Range \u00f7 ATR",
            "qualify": len(range_rows),
            "picks": [t[0] for t in range_rows[:limit]],
            "sub": lambda r: (
                "Range vs ATR",
                f"{(((r.get('high') or 0) - (r.get('low') or 0)) / (r.get('atr') or math.inf)):.1f}x range \u00f7 ATR",
            ),
        },
    ]

    wanted: list[str] = []
    for spec in panels_spec:
        for r in spec["picks"]:
            if r["symbol"] not in wanted:
                wanted.append(r["symbol"])
    sparks = _fetch_sparks(wanted)

    movers_panels: list[dict] = []
    unusual_panels: list[dict] = []
    for spec in panels_spec:
        rows = [
            _build_row(r, *spec["sub"](r), sparks) for r in spec["picks"]
        ]
        panel = {
            "id": spec["id"],
            "title": spec["title"],
            "metric_label": spec["metric_label"],
            "qualify": spec["qualify"],
            "rows": rows,
        }
        if spec["id"] in (
            "gainers",
            "losers",
            "near_52w_high",
            "near_52w_low",
            "most_active",
            "turnover",
        ):
            movers_panels.append(panel)
        else:
            unusual_panels.append(panel)
    return {
        "universe": universe,
        "as_of": now.isoformat(),
        "total": len(records),
        "cached": False,
        "age_sec": 0.0,
        "sections": [
            {"id": "movers", "title": "Movers", "panels": movers_panels},
            {"id": "unusual", "title": "Unusual Activity", "panels": unusual_panels},
        ],
    }


def _frame_to_records(df: Any, allowed: set[str]) -> list[dict]:
    if df is None or getattr(df, "empty", True):
        return []
    records: list[dict] = []
    try:
        rows = df.to_dict(orient="records")
    except Exception:
        return []
    for row in rows:
        try:
            sym = _row_symbol(row)
            if not sym or sym not in allowed:
                continue
            records.append(
                {
                    "symbol": sym,
                    "name": str(row.get("name") or sym).strip() or sym,
                    "close": _finite(row.get("close")),
                    "change": _finite(row.get("change")),
                    "volume": _finite(row.get("volume")),
                    "avgvol": _finite(row.get("average_volume_10d_calc")),
                    "relvol": _finite(row.get("relative_volume_10d_calc")),
                    "logoid": row.get("logoid"),
                    "gap": _finite(row.get("gap")),
                    "high52": _finite(row.get("price_52_week_high")),
                    "low52": _finite(row.get("price_52_week_low")),
                    "atr": _finite(row.get("ATR")),
                    "rsi": _finite(row.get("RSI")),
                    "vwap": _finite(row.get("VWAP")),
                    "market_cap": _finite(row.get("market_cap_basic")),
                    "high": _finite(row.get("high")),
                    "low": _finite(row.get("low")),
                    "turnover": _finite(row.get("Value.Traded")),
                }
            )
        except Exception:
            continue
    return records


def _empty(universe: str) -> dict:
    try:
        import config as _cfg

        as_of = datetime.now(_cfg.IST).isoformat()
    except Exception:
        as_of = datetime.now().astimezone().isoformat()
    return {
        "universe": universe,
        "as_of": as_of,
        "total": 0,
        "cached": False,
        "age_sec": 0.0,
        "sections": [],
    }


def _cache_key(universe: str, limit: int, min_market_cap_cr: float) -> str:
    return f"{universe}|limit={limit}|mincap={min_market_cap_cr}"


def _market_hours_open() -> bool:
    """Local market-hours gate for the prewarm task (mirrors api_server_fastapi)."""
    try:
        from trading.utils import is_market_open

        return bool(is_market_open())
    except Exception:
        try:
            import config as _cfg

            hour = datetime.now(_cfg.IST).hour
        except Exception:
            from datetime import timezone as _tz

            hour = datetime.now(_tz.utc).hour + 5  # approx IST
        return 8 <= hour <= 16


PREWARM_UNIVERSES = ("nifty500", "nifty50")
PREWARM_INTERVAL_SEC = 60


def _build_and_sanitize(uid: str, records: list[dict], limit: int) -> dict:
    """Build the dashboard payload and make it JSON-safe (blocking).

    ``_build_payload`` fans out to the spark fetchers (up to
    ``SPARK_MAX_SYMBOLS`` 1m candle reads); measured at 8-13s for nifty500.
    It used to run directly in the prewarm coroutine, which froze the event
    loop for that whole window — the cause of the multi-second /api/health
    timeouts and the 2-5 minute tape gaps. Call it via ``asyncio.to_thread``.
    """
    return _sanitize_for_json(_build_payload(uid, records, limit))


async def run_dashboard_prewarm_once(
    universes: tuple[str, ...] = PREWARM_UNIVERSES,
    limit: int = 8,
    min_market_cap_cr: float = 500.0,
) -> int:
    """Build + cache the dashboard payload for the default universe(s).

    Shares the endpoint's fetch/panel path (off the event loop). Never raises;
    returns the number of universes warmed. Keeps the first UI load instant
    while the on-demand endpoint path stays intact.
    """
    warmed = 0
    for uid in universes:
        try:
            from chart_patterns.universes import get_universe

            allowed = {str(s).upper() for s in get_universe(uid)}
            df = await asyncio.to_thread(_fetch_tv_frame)
            records = _frame_to_records(df, allowed)
            floor = float(min_market_cap_cr) * 1e7
            records = [
                r
                for r in records
                if r.get("market_cap") is not None and r["market_cap"] >= floor
            ]
            payload = await asyncio.to_thread(
                _build_and_sanitize, uid, records, limit)
            _cache[_cache_key(uid, limit, float(min_market_cap_cr))] = (
                time.time(),
                payload,
            )
            warmed += 1
        except Exception:
            continue
    return warmed


async def dashboard_prewarm_task(
    universes: tuple[str, ...] = PREWARM_UNIVERSES,
    interval_sec: int = PREWARM_INTERVAL_SEC,
) -> None:
    """Background warmer: refresh the dashboard cache every ~60 s in market hours.

    Mirrors the ``watch_snapshot_task`` pattern in ``api_server_fastapi.py``:
    prompt first run shortly after startup, then the regular interval, gated
    to market hours, never blocking startup, never raising.
    """
    import os

    interval = int(os.environ.get("DASHBOARD_PREWARM_INTERVAL_SEC", str(interval_sec)))
    first = True
    while True:
        try:
            if first:
                await asyncio.sleep(5)
                first = False
            else:
                await asyncio.sleep(interval)
            if not _market_hours_open():
                continue
            n = await run_dashboard_prewarm_once(universes)
            print(f"[Dashboard] Prewarm refreshed ({n} universe(s))")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Dashboard] Prewarm task error: {e}")
            await asyncio.sleep(60)


@router.get("/dashboard")
async def screener_dashboard(
    universe: str = Query(default="nifty500"),
    limit: int = Query(default=8, ge=4, le=30),
    min_market_cap_cr: float = Query(default=500.0, ge=0.0),
) -> dict:
    """Movers + unusual-activity dashboard for a universe (TV metrics, 1m sparks)."""
    uid = (universe or "nifty500").strip().lower() or "nifty500"
    key = _cache_key(uid, limit, float(min_market_cap_cr))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
        ts, payload = hit
        out = dict(payload)
        out["cached"] = True
        out["age_sec"] = round(time.time() - ts, 1)
        return out
    try:
        from chart_patterns.universes import get_universe

        allowed = {str(s).upper() for s in get_universe(uid)}
        df = await asyncio.to_thread(_fetch_tv_frame)
        records = _frame_to_records(df, allowed)
        floor = float(min_market_cap_cr) * 1e7
        records = [
            r
            for r in records
            if r.get("market_cap") is not None and r["market_cap"] >= floor
        ]
        payload = await asyncio.to_thread(
            _build_and_sanitize, uid, records, limit)
        _cache[key] = (time.time(), payload)
        return payload
    except Exception:
        return _sanitize_for_json(_empty(uid))


def clear_cache() -> None:
    """Test hook: drop the in-process TTL cache."""
    _cache.clear()
