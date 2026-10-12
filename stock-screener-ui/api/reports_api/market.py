"""Daily Report market endpoint: unusual moves across the full universe.

One wide TradingView query (``tradingview_screener``) restricted to a known
universe (``chart_patterns.universes``); sparklines from disk-cached 1m
candles (``chart_patterns.candles.fetch_for_timeframe``).

``GET /api/reports/daily?date=YYYY-MM-DD&universe=nifty500`` ->
``{date, universe, as_of, cached, age_sec, breadth, moves,
sector_leaders, theme_leaders, index}``.

- ``sector_leaders`` / ``theme_leaders``: ``{top: [...5], bottom: [...5]}``
  of ``{name, change, stock_count, advances, declines}`` with
  market-cap-weighted ``change`` over the same TV frame (no second
  query). Fail-soft ``{"top": [], "bottom": []}``.
- ``index``: ``{name: "NIFTY 50", change, close}`` reused from the TV
  frame when an index symbol is present, else yfinance ``^NSEI``,
  else ``None``. Never fails the response.

Fail-soft: any error returns ``{moves: {}, breadth: None}`` (never 500).
Today's payload has a 60 s in-process TTL; past dates are immutable on-disk
JSON at ``experiments/data/reports/market/{date}_{universe}.json``.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from statistics import mean, median
from typing import Any, Optional

from fastapi import APIRouter, Query

from api.utils import _sanitize_for_json

router = APIRouter(prefix="/api/reports", tags=["reports"])

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
    "high",
    "low",
    "open",
    "Value.Traded",
    "RSI",
    "VWAP",
    "sector",
    "industry",
]

LOGO_URL = "https://s3-symbol-logo.tradingview.com/{logoid}.svg"
_LOGOID_RE = re.compile(r"^[A-Za-z0-9-]+$")

CACHE_TTL_SECONDS = 60
SPARK_BARS = 30
SPARK_MAX_SYMBOLS = 80
SPARK_WORKERS = 6
TV_LIMIT = 3000
PANEL_LIMIT = 25

_cache: dict[str, tuple[float, dict]] = {}

REPORTS_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "experiments"
    / "data"
    / "reports"
    / "market"
)


def logo_url(logoid: Any) -> Optional[str]:
    if logoid is None:
        return None
    slug = str(logoid).strip()
    if not slug or slug in ("0", "None"):
        return None
    if not _LOGOID_RE.match(slug):
        return None
    return LOGO_URL.format(logoid=slug)


def normalize_spark(closes: list[float], limit: int = SPARK_BARS) -> list[float]:
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
        return f"\u2014 {suffix}"
    return f"{value:.1f}x {suffix}"


def _cr(value_rupees: Optional[float]) -> str:
    if value_rupees is None:
        return "\u2014"
    cr = value_rupees / 1e7
    if cr >= 1000:
        return f"\u20b9{cr / 1000:.1f}k Cr"
    return f"\u20b9{cr:.1f} Cr"


def _today_str() -> str:
    try:
        import config as _cfg

        return datetime.now(_cfg.IST).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().astimezone().strftime("%Y-%m-%d")


def _now_iso() -> str:
    try:
        import config as _cfg

        return datetime.now(_cfg.IST).isoformat()
    except Exception:
        return datetime.now().astimezone().isoformat()


def _parse_date(value: Optional[str]) -> str:
    text = (value or "").strip()
    if not text:
        return _today_str()
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return _today_str()


def _row_symbol(row: dict) -> str:
    name = str(row.get("name") or "").strip().upper()
    if name:
        return name
    ticker = str(row.get("ticker") or "").strip().upper()
    if ":" in ticker:
        ticker = ticker.split(":")[-1]
    return ticker


def _fetch_tv_frame() -> Any:
    from tradingview_screener import Query

    q = Query().select(*TV_FIELDS).set_markets("india").limit(TV_LIMIT)
    _, df = q.get_scanner_data()
    return df


def _fetch_sparks(symbols: list[str]) -> dict[str, list[float]]:
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
    with ThreadPoolExecutor(max_workers=min(SPARK_WORKERS, 6)) as ex:
        for sym, spark in ex.map(_one, capped):
            out[sym] = spark
    return out


def _frame_to_records(df: Any, allowed: set[str]) -> list[dict]:
    if df is None or getattr(df, "empty", True):
        return []
    try:
        rows = df.to_dict(orient="records")
    except Exception:
        return []
    records: list[dict] = []
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
                    "open": _finite(row.get("open")),
                    "turnover": _finite(row.get("Value.Traded")),
                    "sector": (str(row.get("sector") or "").strip() or None),
                    "industry": (str(row.get("industry") or "").strip() or None),
                }
            )
        except Exception:
            continue
    return records


def _build_row(rec: dict, sub_label: str, sub_value: str, sparks: dict[str, list[float]]) -> dict:
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


def _disk_path(date: str, universe: str) -> Path:
    safe_u = re.sub(r"[^A-Za-z0-9_-]", "_", universe)
    return REPORTS_DIR / f"{date}_{safe_u}.json"


def _read_disk(date: str, universe: str) -> Optional[dict]:
    try:
        path = _disk_path(date, universe)
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, dict):
            return None
        payload["cached"] = True
        return payload
    except Exception:
        return None


def _write_disk(date: str, universe: str, payload: dict) -> None:
    try:
        path = _disk_path(date, universe)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_sanitize_for_json(payload), f)
    except Exception:
        pass


def _weighted_change(members: list[dict]) -> float:
    """Market-cap-weighted mean of finite ``change`` (mirrors sector.py).

    Falls back to the simple mean when no usable market-cap weight
    exists; 0.0 when nothing valid. Fail-soft: never raises.
    """
    try:
        vals = [r.get("change") for r in members]
        wts = [r.get("market_cap") for r in members]
        num, den = 0.0, 0.0
        plain: list[float] = []
        for v, w in zip(vals, wts):
            fv = _finite(v)
            if fv is None:
                continue
            plain.append(fv)
            fw = _finite(w)
            if fw is not None and fw > 0:
                num += fv * fw
                den += fw
        if den > 0:
            return round(num / den, 2)
        if plain:
            return round(sum(plain) / len(plain), 2)
        return 0.0
    except Exception:
        return 0.0


def _leader_entry(name: str, members: list[dict]) -> dict:
    try:
        advances = sum(1 for r in members if _finite(r.get("change")) is not None and float(r["change"]) > 0)
        declines = sum(1 for r in members if _finite(r.get("change")) is not None and float(r["change"]) < 0)
    except Exception:
        advances, declines = 0, 0
    return {
        "name": name,
        "change": _weighted_change(members),
        "stock_count": len(members),
        "advances": advances,
        "declines": declines,
    }


def _split_top_bottom(ranked: list[dict], n: int = 5) -> dict:
    try:
        return {"top": ranked[:n], "bottom": ranked[::-1][:n]}
    except Exception:
        return {"top": [], "bottom": []}


def _build_sector_leaders(records: list[dict]) -> dict:
    """Top/bottom-5 sectors by market-cap-weighted avg change. Fail-soft."""
    try:
        groups: dict[str, list[dict]] = {}
        for r in records or []:
            name = (r.get("sector") or "").strip() if isinstance(r.get("sector"), str) else r.get("sector")
            name = str(name or "").strip()
            if not name:
                continue
            groups.setdefault(name, []).append(r)
        ranked = sorted(
            (_leader_entry(name, members) for name, members in groups.items()),
            key=lambda e: (e["change"] is None, e["change"]),
            reverse=True,
        )
        return _split_top_bottom(ranked)
    except Exception:
        return {"top": [], "bottom": []}


def _load_theme_membership() -> tuple[dict, dict]:
    """Read-only theme membership via api.sector (fail-soft ({}, {}))."""
    try:
        from api.sector import _load_theme_membership as _ltm

        return _ltm()
    except Exception:
        return {}, {}


def _build_theme_leaders(records: list[dict]) -> dict:
    """Top/bottom-5 themes by market-cap-weighted avg change. Fail-soft.

    A stock may belong to several themes, so membership comes from the
    DB taxonomy (Theme/ThemeConstituent) and each theme aggregates over
    the members present in the TV frame. DB missing -> empty lists.
    """
    try:
        info, slug_to_members = _load_theme_membership()
        if not slug_to_members:
            return {"top": [], "bottom": []}
        by_sym: dict[str, dict] = {}
        for r in records or []:
            sym = str(r.get("symbol") or "").strip().upper()
            if sym:
                by_sym[sym] = r
        entries: list[dict] = []
        for slug, members in slug_to_members.items():
            wanted = {str(s).strip().upper() for s in (members or set()) if str(s).strip()}
            if not wanted:
                continue
            present = [by_sym[s] for s in wanted if s in by_sym]
            if not present:
                continue
            display = str((info or {}).get(slug, {}).get("name") or slug)
            entries.append(_leader_entry(display, present))
        entries.sort(key=lambda e: (e["change"] is None, e["change"]), reverse=True)
        return _split_top_bottom(entries)
    except Exception:
        return {"top": [], "bottom": []}


_INDEX_SYMBOLS = {"NIFTY", "NIFTY50", "NIFTY_50", "^NSEI", "NIFTY 50"}


def _fetch_index(records: list[dict] | None = None) -> Optional[dict]:
    """``{name: 'NIFTY 50', change, close}`` for the day, else None.

    1. Reuse the same TV frame when an index symbol is present.
    2. Else yfinance ``^NSEI`` (day change % + last close).
    Never raises.
    """
    try:
        for r in records or []:
            sym = str(r.get("symbol") or "").strip().upper().replace(" ", "")
            if sym in {s.replace(" ", "") for s in _INDEX_SYMBOLS}:
                if _finite(r.get("close")) is None:
                    continue
                return {
                    "name": "NIFTY 50",
                    "change": _finite(r.get("change")),
                    "close": _finite(r.get("close")),
                }
        try:
            import yfinance as yf  # type: ignore
        except Exception:
            return None
        hist = yf.Ticker("^NSEI").history(period="2d", interval="1d")
        if hist is None or getattr(hist, "empty", True):
            return None
        closes = list(hist["Close"].dropna()) if "Close" in hist.columns else []
        if not closes:
            return None
        last = _finite(float(closes[-1]))
        if last is None:
            return None
        prev = _finite(float(closes[-2])) if len(closes) >= 2 else None
        change = round((last / prev - 1) * 100, 2) if prev else None
        return {"name": "NIFTY 50", "change": change, "close": round(last, 2)}
    except Exception:
        return None


def _build_payload(date: str, universe: str, records: list[dict]) -> dict:
    now_iso = _now_iso()
    if not records:
        return {
            "date": date,
            "universe": universe,
            "as_of": now_iso,
            "cached": False,
            "age_sec": 0,
            "breadth": {
                "total": 0,
                "advances": 0,
                "declines": 0,
                "unchanged": 0,
                "new_highs": 0,
                "new_lows": 0,
                "avg_change": 0.0,
                "median_change": 0.0,
                "up_volume": 0,
                "down_volume": 0,
            },
            "moves": {k: [] for k in (
                "gainers", "losers", "volume_surge", "gap_up", "gap_down",
                "range_expansion", "new_52w_high", "new_52w_low", "turnover",
            )},
            "sector_leaders": {"top": [], "bottom": []},
            "theme_leaders": {"top": [], "bottom": []},
            "index": None,
        }

    with_change = [r for r in records if r.get("change") is not None]
    gainers = sorted(with_change, key=lambda r: r["change"], reverse=True)[:PANEL_LIMIT]
    losers = sorted(with_change, key=lambda r: r["change"])[:PANEL_LIMIT]
    vol_surge = sorted(
        [r for r in records if r.get("relvol") is not None and r["relvol"] >= 3],
        key=lambda r: r["relvol"],
        reverse=True,
    )[:PANEL_LIMIT]
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
        atr, hi, lo = r.get("atr"), r.get("high"), r.get("low")
        if atr is None or atr <= 0 or hi is None or lo is None:
            continue
        range_rows.append((r, (hi - lo) / atr))
    range_rows.sort(key=lambda t: t[1], reverse=True)
    new_high = sorted(
        [
            r
            for r in records
            if r.get("close") is not None
            and r.get("high52") is not None
            and r["close"] >= r["high52"]
        ],
        key=lambda r: (r.get("volume") if r.get("volume") is not None else -1),
        reverse=True,
    )[:PANEL_LIMIT]
    new_low = sorted(
        [
            r
            for r in records
            if r.get("close") is not None
            and r.get("low52") is not None
            and r["close"] <= r["low52"]
        ],
        key=lambda r: (r.get("volume") if r.get("volume") is not None else -1),
        reverse=True,
    )[:PANEL_LIMIT]
    turnover = sorted(
        [r for r in records if r.get("turnover") is not None],
        key=lambda r: r["turnover"],
        reverse=True,
    )[:PANEL_LIMIT]

    panels: dict[str, tuple[list[dict], Any]] = {
        "gainers": (gainers, lambda r: ("Change", f"{(r.get('change') or 0.0):+.2f}%")),
        "losers": (losers, lambda r: ("Change", f"{(r.get('change') or 0.0):+.2f}%")),
        "volume_surge": (vol_surge, lambda r: ("Rel. volume", _fmt_times(r.get("relvol"), "rel. volume"))),
        "gap_up": (gap_up, lambda r: ("Gap", f"{(r.get('gap') or 0.0):+.1f}% gap at open")),
        "gap_down": (gap_down, lambda r: ("Gap", f"{(r.get('gap') or 0.0):+.1f}% gap at open")),
        "range_expansion": (
            [t[0] for t in range_rows[:PANEL_LIMIT]],
            lambda r: (
                "Range vs ATR",
                f"{(((r.get('high') or 0) - (r.get('low') or 0)) / (r.get('atr') or math.inf)):.1f}x range \u00f7 ATR",
            ),
        ),
        "new_52w_high": (new_high, lambda r: ("52W high", f"At high \u20b9{(r.get('close') or 0.0):.2f}")),
        "new_52w_low": (new_low, lambda r: ("52W low", f"At low \u20b9{(r.get('close') or 0.0):.2f}")),
        # TV Value.Traded for NSE is in INR (verified live: BHARTIARTL
        # ~2.55e10 ~= Rs.2550 Cr daily turnover).
        "turnover": (turnover, lambda r: ("Turnover", _cr(r.get("turnover")))),
    }

    # Largest panels first so the ~80-symbol spark cap covers what matters.
    wanted: list[str] = []
    for _pid, (picks, _sub) in sorted(panels.items(), key=lambda kv: -len(kv[1][0])):
        for r in picks:
            if r["symbol"] not in wanted:
                wanted.append(r["symbol"])
    sparks = _fetch_sparks(wanted)

    moves: dict[str, list[dict]] = {}
    for pid, (picks, sub) in panels.items():
        moves[pid] = [_build_row(r, *sub(r), sparks) for r in picks]

    changes = [r["change"] for r in with_change]
    advances = sum(1 for c in changes if c > 0)
    declines = sum(1 for c in changes if c < 0)
    unchanged = len(records) - advances - declines
    up_volume = sum(
        1
        for r in records
        if (r.get("change") or 0) > 0
        and r.get("volume") is not None
        and r.get("avgvol") is not None
        and r["volume"] >= r["avgvol"]
    )
    down_volume = sum(
        1
        for r in records
        if (r.get("change") or 0) < 0
        and r.get("volume") is not None
        and r.get("avgvol") is not None
        and r["volume"] >= r["avgvol"]
    )
    breadth = {
        "total": len(records),
        "advances": advances,
        "declines": declines,
        "unchanged": unchanged,
        "new_highs": len(new_high),
        "new_lows": len(new_low),
        "avg_change": round(mean(changes), 4) if changes else 0.0,
        "median_change": round(median(changes), 4) if changes else 0.0,
        "up_volume": up_volume,
        "down_volume": down_volume,
    }
    try:
        index = _fetch_index(records)
    except Exception:
        index = None
    return {
        "date": date,
        "universe": universe,
        "as_of": now_iso,
        "cached": False,
        "age_sec": 0,
        "breadth": breadth,
        "moves": moves,
        "sector_leaders": _build_sector_leaders(records),
        "theme_leaders": _build_theme_leaders(records),
        "index": index,
    }


def _fail_soft(date: str, universe: str) -> dict:
    return {
        "date": date,
        "universe": universe,
        "as_of": _now_iso(),
        "cached": False,
        "age_sec": 0,
        "breadth": None,
        "moves": {},
        "sector_leaders": {"top": [], "bottom": []},
        "theme_leaders": {"top": [], "bottom": []},
        "index": None,
    }


def clear_cache() -> None:
    _cache.clear()


@router.get("/daily")
async def daily_report(
    date: Optional[str] = Query(default=None),
    universe: str = Query(default="nifty500"),
) -> dict:
    uid = (universe or "nifty500").strip().lower() or "nifty500"
    day = _parse_date(date)
    today = _today_str()
    is_today = day == today

    if not is_today:
        hit = _read_disk(day, uid)
        if hit is not None:
            return _sanitize_for_json(hit)
    else:
        key = f"{day}|{uid}"
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
            ts, payload = hit
            out = dict(payload)
            out["cached"] = True
            out["age_sec"] = round(time.time() - ts, 1)
            return _sanitize_for_json(out)

    try:
        from chart_patterns.universes import get_universe

        allowed = {str(s).upper() for s in get_universe(uid)}
        df = await asyncio.to_thread(_fetch_tv_frame)
        records = _frame_to_records(df, allowed)
        payload = _build_payload(day, uid, records)
        payload = _sanitize_for_json(payload)
        if is_today:
            _cache[f"{day}|{uid}"] = (time.time(), payload)
        else:
            _write_disk(day, uid, payload)
            payload = dict(payload)
            payload["cached"] = False
            payload["age_sec"] = 0
        return payload
    except Exception:
        return _sanitize_for_json(_fail_soft(day, uid))
