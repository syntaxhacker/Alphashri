#!/usr/bin/env python3
"""Read-only Upstox market-intel desk block.

Pulls Upstox's official market-information + news APIs (OI, change-in-OI,
max pain, PCR, FII/DII, news) and prints a compact desk block. Useful as a
cross-check against the proxy values we compute locally from the option chain.

Read-only by construction: only HTTP GETs, no orders, no DB writes
(instruments are read through a ``mode=ro`` SQLite handle).

Usage
-----
    .venv/bin/python scripts/upstox_intel.py
    .venv/bin/python scripts/upstox_intel.py --date 2026-10-21 --expiry 2026-10-28
    .venv/bin/python scripts/upstox_intel.py --json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import desk_common  # noqa: E402
from scripts import upstox_common  # noqa: E402
from scripts.upstox_common import as_float as _as_float  # noqa: E402
from scripts.upstox_common import data as _data  # noqa: E402

BASE_URL = upstox_common.BASE_V2
NIFTY_KEY = "NSE_INDEX|Nifty 50"

# Top-10 NIFTY constituents (by weight) used for the news lookup.
TOP10_SYMBOLS = (
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "INFY",
    "TCS",
    "BHARTIARTL",
    "ITC",
    "SBIN",
    "AXISBANK",
    "KOTAKBANK",
)

# Fallback instrument keys (ISIN-based) when the local DB lookup fails.
FALLBACK_NEWS_KEYS = (
    "NSE_EQ|INE002A01018",  # RELIANCE
    "NSE_EQ|INE040A01034",  # HDFCBANK
    "NSE_EQ|INE090A01021",  # ICICIBANK
    "NSE_EQ|INE009A01021",  # INFY
    "NSE_EQ|INE467B01029",  # TCS
    "NSE_EQ|INE397D01024",  # BHARTIARTL
    "NSE_EQ|INE154A01025",  # ITC
    "NSE_EQ|INE062A01020",  # SBIN
    "NSE_EQ|INE238A01034",  # AXISBANK
    "NSE_EQ|INE237A01028",  # KOTAKBANK
)


# ---------------------------------------------------------------------------
# pure parsing helpers (unit-tested, no network)
# ---------------------------------------------------------------------------
def parse_oi_payload(payload) -> dict:
    """Normalise the ``GET /market/oi`` response.

    Returns ``{"total_call_oi", "total_put_oi"}`` (None when missing).
    Tolerates both enveloped and bare payloads plus a few key aliases
    (Upstox uses ``total_calls`` / ``total_puts``).
    """
    data = _data(payload)
    if not isinstance(data, dict):
        return {"total_call_oi": None, "total_put_oi": None}
    call = _as_float(
        data.get(
            "total_call_oi",
            data.get("total_calls", data.get("totalCallOi", data.get("call_oi"))),
        )
    )
    put = _as_float(
        data.get(
            "total_put_oi",
            data.get("total_puts", data.get("totalPutOi", data.get("put_oi"))),
        )
    )
    return {"total_call_oi": call, "total_put_oi": put}


def parse_change_oi_payload(payload) -> dict:
    """Normalise the ``GET /market/change-oi`` response.

    Returns ``{"total_call_change_oi", "total_put_change_oi", "rows"}`` where
    each row is ``{"strike", "call", "put", "total", "side"}``. Malformed rows
    are skipped; missing totals become None.
    """
    data = _data(payload)
    if not isinstance(data, dict):
        return {
            "total_call_change_oi": None,
            "total_put_change_oi": None,
            "rows": [],
        }
    total_call = _as_float(data.get("total_call_change_oi"))
    total_put = _as_float(data.get("total_put_change_oi"))
    raw_rows = data.get("call_put_oi_data_list") or data.get("data_list") or []
    rows: list[dict] = []
    for entry in raw_rows or []:
        if not isinstance(entry, dict):
            continue
        strike = _as_float(entry.get("strike_price", entry.get("strike")))
        if strike is None:
            continue
        call = _as_float(entry.get("call_change_oi")) or 0.0
        put = _as_float(entry.get("put_change_oi")) or 0.0
        total = call + put
        side = "call" if abs(call) >= abs(put) else "put"
        rows.append(
            {"strike": strike, "call": call, "put": put, "total": total, "side": side}
        )
    return {
        "total_call_change_oi": total_call,
        "total_put_change_oi": total_put,
        "rows": rows,
    }


def top_change_oi(rows, n: int = 5) -> list[dict]:
    """Top-``n`` strikes by absolute combined change in OI, strongest first."""
    ranked = sorted(
        (r for r in rows or [] if isinstance(r, dict) and r.get("strike") is not None),
        key=lambda r: abs(_as_float(r.get("total")) or 0.0)
        + abs(_as_float(r.get("call")) or 0.0)
        + abs(_as_float(r.get("put")) or 0.0),
        reverse=True,
    )
    return ranked[: max(n, 0)]


def parse_max_pain_payload(payload) -> dict:
    """Normalise ``GET /market/max-pain`` → ``{"max_pain", "spot"}``.

    Spot prefers ``spot_closing_price``, falling back to the last intraday
    insight's ``spot_price``.
    """
    data = _data(payload)
    if not isinstance(data, dict):
        return {"max_pain": None, "spot": None}
    max_pain = _as_float(
        data.get("max_pain_strike", data.get("max_pain", data.get("maxPain")))
    )
    spot = _as_float(
        data.get("spot_price", data.get("spot", data.get("spot_closing_price")))
    )
    if spot is None:
        insights = data.get("insights") or []
        if isinstance(insights, list) and insights:
            last = next(
                (i for i in reversed(insights) if isinstance(i, dict)), None
            )
            if last is not None:
                spot = _as_float(last.get("spot_price"))
    return {"max_pain": max_pain, "spot": spot}


def parse_pcr_payload(payload):
    """Normalise ``GET /market/pcr`` → float or None."""
    data = _data(payload)
    if isinstance(data, (int, float)):
        return _as_float(data)
    if not isinstance(data, dict):
        return None
    return _as_float(
        data.get("pcr", data.get("pcr_oi", data.get("pcr_value", data.get("value"))))
    )


def parse_fii_dii_payload(payload, prefer: str = "NSE_EQ|CASH") -> dict:
    """Normalise ``GET /market/fii`` (or ``/dii``) → ``{"buy","sell","net"}``.

    The endpoint returns a map of segment → record list; the ``prefer``red
    segment (cash market by default) wins, otherwise the first segment. The
    latest record by ``time_stamp`` is used. Amounts are ₹ crores as returned
    by Upstox. Net is derived as buy − sell when absent.
    """
    data = _data(payload)
    rows: list[dict] | None = None
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        seg_map = {
            k: v for k, v in data.items() if isinstance(v, list)
        }
        if seg_map:
            key = prefer if prefer in seg_map else next(iter(seg_map))
            rows = seg_map[key]
        else:
            rows = [data]
    if not rows:
        return {"buy": None, "sell": None, "net": None}

    def _ts(record: dict) -> float:
        try:
            return float(record.get("time_stamp") or 0)
        except (TypeError, ValueError):
            return 0.0

    valid = [r for r in rows if isinstance(r, dict)]
    if not valid:
        return {"buy": None, "sell": None, "net": None}
    latest = max(valid, key=_ts)
    buy = _as_float(
        latest.get("buy_amount", latest.get("buy_value", latest.get("buy", latest.get("gross_buy"))))
    )
    sell = _as_float(
        latest.get(
            "sell_amount", latest.get("sell_value", latest.get("sell", latest.get("gross_sell")))
        )
    )
    net = _as_float(latest.get("net_value", latest.get("net", latest.get("net_buy"))))
    if net is None and buy is not None and sell is not None:
        net = buy - sell
    return {"buy": buy, "sell": sell, "net": net}


def _to_ist(moment):
    """Parse ``published_time`` into an IST-aware datetime, or None.

    Accepts epoch milliseconds (int/float or numeric string, as returned by
    ``GET /news``) as well as ISO-8601 strings.
    """
    import config

    if moment is None:
        return None
    if isinstance(moment, bool):
        return None
    if isinstance(moment, (int, float)):
        try:
            return dt.datetime.fromtimestamp(float(moment) / 1000, tz=dt.timezone.utc).astimezone(
                config.IST
            )
        except (OverflowError, OSError, ValueError):
            return None
    text = str(moment).strip()
    if not text:
        return None
    if text.lstrip("+-").isdigit():
        try:
            return dt.datetime.fromtimestamp(float(text) / 1000, tz=dt.timezone.utc).astimezone(
                config.IST
            )
        except (OverflowError, OSError, ValueError):
            return None
    try:
        if text.endswith("Z"):
            parsed = dt.datetime.fromisoformat(text[:-1] + "+00:00")
        else:
            parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(config.IST)


def parse_news_items(payload, limit: int = 5) -> list[dict]:
    """Normalise ``GET /news`` → ``[{published_ist, heading, link}]`` newest first.

    Handles both the documented map shape (``{key: [items]}``) and a bare
    list, tagging each row with its instrument ``key``.
    """
    data = _data(payload)
    entries: list[tuple[str, dict]] = []
    if isinstance(data, dict):
        for key, items in data.items():
            if isinstance(items, list):
                entries.extend((str(key), i) for i in items)
            elif isinstance(items, dict):
                entries.append((str(key), items))
        if not entries and any(k in data for k in ("heading", "title")):
            entries = [("", data)]
    elif isinstance(data, list):
        entries = [("", i) for i in data]
    out: list[dict] = []
    for key, entry in entries:
        if not isinstance(entry, dict):
            continue
        heading = entry.get("heading") or entry.get("title") or ""
        link = entry.get("article_link") or entry.get("url") or ""
        if not heading:
            continue
        moment = _to_ist(entry.get("published_time") or entry.get("published_at") or "")
        out.append(
            {
                "published_ist": moment.strftime("%m-%d %H:%M IST") if moment else "—",
                "_sort": moment.timestamp() if moment else float("-inf"),
                "heading": str(heading).strip(),
                "link": str(link or "").strip(),
                "key": key,
            }
        )
    out.sort(key=lambda r: r["_sort"], reverse=True)
    trimmed = out[: max(limit, 0)]
    for row in trimmed:
        row.pop("_sort", None)
    return trimmed


# ---------------------------------------------------------------------------
# live sources (network, degrading)
# ---------------------------------------------------------------------------
def _get(path: str, params: dict, timeout: float) -> dict:
    # rate_limit=False: the API caller (``api/reports_api/nifty_intel.py``)
    # acquires the shared limiter itself — acquiring it twice would burn the
    # account-wide budget at double rate.
    return upstox_common.get(path, params, timeout, rate_limit=False)


def resolve_news_keys() -> list[str]:
    """Top-10 NIFTY constituent ``NSE_EQ|…`` keys from the local instruments table.

    Read-only (``mode=ro``). Falls back to :data:`FALLBACK_NEWS_KEYS` when the
    DB is missing or a symbol has no row.
    """
    found: dict[str, str] = {}
    try:
        db = desk_common.db_path()
        if db.exists():
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            try:
                placeholders = ",".join("?" for _ in TOP10_SYMBOLS)
                rows = con.execute(
                    f"select trading_symbol, instrument_key from instruments "
                    f"where trading_symbol in ({placeholders})",
                    tuple(TOP10_SYMBOLS),
                ).fetchall()
            finally:
                con.close()
            for symbol, key in rows:
                if symbol and key and str(key).startswith("NSE_EQ|"):
                    found.setdefault(str(symbol).upper(), str(key))
    except Exception:
        found = {}
    keys = [found[s] for s in TOP10_SYMBOLS if s in found]
    if len(keys) < len(TOP10_SYMBOLS):
        keys = list(FALLBACK_NEWS_KEYS)
    return keys[:10]


def _expiry_param(expiry: str | None) -> dict:
    """Expiry query param — passes Upstox keywords (``current_week`` …) or a date straight through."""
    if not expiry or not str(expiry).strip():
        return {"expiry": "current_week"}
    return {"expiry": str(expiry).strip()}


def _current_week_tuesday(date_str: str) -> str:
    """Upcoming Tuesday on/after ``date_str`` (NSE Nifty weekly expiry weekday).

    Pure date arithmetic used as a fallback when Upstox returns ``data: null``
    for a relative expiry keyword.
    """
    day = dt.date.fromisoformat(date_str)
    days_ahead = (1 - day.weekday()) % 7  # Tuesday == 1
    return (day + dt.timedelta(days=days_ahead)).isoformat()


def build_payload(args) -> dict:
    errors: list[str] = []
    payload: dict = {
        "date": args.date,
        "expiry": args.expiry,
        "instrument": NIFTY_KEY,
        "oi": None,
        "change_oi": None,
        "max_pain": None,
        "pcr": None,
        "fii": None,
        "dii": None,
        "news": None,
        "errors": errors,
    }

    def fail(source: str, exc: BaseException) -> None:
        msg = f"{type(exc).__name__}: {exc}".strip()
        if len(msg) > 90:
            msg = type(exc).__name__
        errors.append(f"unavailable: {source} ({msg})")

    expiry_params = _expiry_param(args.expiry)
    base_params = {"instrument_key": NIFTY_KEY, **expiry_params}
    # The relative expiry keywords sometimes yield `data: null`; retry once
    # with the concrete Tuesday of the current week before giving up.
    retry_expiry = (
        _current_week_tuesday(args.date) if args.expiry == "current_week" else None
    )

    def _oi_get(path: str, params: dict) -> dict:
        raw = _get(path, params, args.timeout)
        if (
            retry_expiry is not None
            and _data(raw) is None
            and params.get("expiry") != retry_expiry
        ):
            raw = _get(path, {**params, "expiry": retry_expiry}, args.timeout)
        return raw

    try:
        oi_raw = _oi_get("/market/oi", {**base_params, "date": args.date})
        payload["oi"] = parse_oi_payload(oi_raw)
        oi_data = _data(oi_raw)
        if isinstance(oi_data, dict) and oi_data.get("expiry"):
            payload["resolved_expiry"] = oi_data["expiry"]
    except Exception as exc:  # noqa: BLE001
        fail("oi", exc)

    try:
        payload["change_oi"] = parse_change_oi_payload(
            _oi_get(
                "/market/change-oi",
                {**base_params, "date": args.date, "interval": 1},
            )
        )
    except Exception as exc:  # noqa: BLE001
        fail("change-oi", exc)

    try:
        payload["max_pain"] = parse_max_pain_payload(
            _oi_get(
                "/market/max-pain",
                {**base_params, "date": args.date, "bucket_interval": 60},
            )
        )
    except Exception as exc:  # noqa: BLE001
        fail("max-pain", exc)

    try:
        payload["pcr"] = parse_pcr_payload(
            _oi_get(
                "/market/pcr",
                {**base_params, "date": args.date, "bucket_interval": 60},
            )
        )
    except Exception as exc:  # noqa: BLE001
        fail("pcr", exc)

    try:
        payload["fii"] = parse_fii_dii_payload(
            _get(
                "/market/fii",
                {"data_type": "NSE_EQ|CASH", "interval": "1D"},
                args.timeout,
            )
        )
    except Exception as exc:  # noqa: BLE001
        fail("fii", exc)

    try:
        payload["dii"] = parse_fii_dii_payload(
            _get(
                "/market/dii",
                {"data_type": "NSE_EQ|CASH", "interval": "1D"},
                args.timeout,
            )
        )
    except Exception as exc:  # noqa: BLE001
        fail("dii", exc)

    try:
        keys = resolve_news_keys()
        raw = _get(
            "/news",
            {
                "category": "instrument_keys",
                "instrument_keys": ",".join(keys),
            },
            args.timeout,
        )
        payload["news"] = parse_news_items(raw, args.news_limit)
    except Exception as exc:  # noqa: BLE001
        fail("news", exc)

    return payload


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------
def _fmt(value, dec: int = 2, dash: str = "—") -> str:
    try:
        if value is None:
            return dash
        return f"{float(value):,.{dec}f}"
    except (TypeError, ValueError):
        return dash


def _fmt_signed(value, dec: int = 0, dash: str = "—") -> str:
    try:
        if value is None:
            return dash
        return f"{float(value):+,.{dec}f}"
    except (TypeError, ValueError):
        return dash


def render(payload: dict) -> str:
    lines: list[str] = []
    expiry = payload.get("resolved_expiry") or payload.get("expiry")
    lines.append(
        f"UPSTOX INTEL  {payload.get('date')}  expiry {expiry}  |  {NIFTY_KEY}"
    )

    oi = payload.get("oi") or {}
    if oi.get("total_call_oi") is None and oi.get("total_put_oi") is None:
        lines.append("OI  unavailable: oi")
    else:
        lines.append(
            f"OI  call {_fmt(oi.get('total_call_oi'), 0)}  "
            f"put {_fmt(oi.get('total_put_oi'), 0)}"
        )

    change = payload.get("change_oi") or {}
    rows = change.get("rows") or []
    if not rows:
        lines.append("ΔOI  unavailable: change-oi")
    else:
        lines.append(
            f"ΔOI totals  call {_fmt_signed(change.get('total_call_change_oi'))}  "
            f"put {_fmt_signed(change.get('total_put_change_oi'))}"
        )
        lines.append("  top 5 strikes by |ΔOI|:")
        for row in top_change_oi(rows, 5):
            lines.append(
                f"    {_fmt(row.get('strike'), 0):>7}  "
                f"call {_fmt_signed(row.get('call')):>9}  "
                f"put {_fmt_signed(row.get('put')):>9}  [{row.get('side')}]"
            )

    mp = payload.get("max_pain") or {}
    if mp.get("max_pain") is None and mp.get("spot") is None:
        lines.append("MAX-PAIN  unavailable: max-pain")
    else:
        lines.append(
            f"MAX-PAIN {_fmt(mp.get('max_pain'), 0)}  SPOT {_fmt(mp.get('spot'))}"
        )

    if payload.get("pcr") is None:
        lines.append("PCR  unavailable: pcr")
    else:
        lines.append(f"PCR {_fmt(payload.get('pcr'), 2)}")

    for name in ("fii", "dii"):
        flow = payload.get(name) or {}
        if flow.get("net") is None and flow.get("buy") is None:
            lines.append(f"{name.upper()}  unavailable: {name}")
        else:
            lines.append(
                f"{name.upper()} net ₹{_fmt_signed(flow.get('net'), 0)} cr  "
                f"(buy {_fmt(flow.get('buy'), 0)} / sell {_fmt(flow.get('sell'), 0)})"
            )

    news = payload.get("news")
    if not news:
        lines.append("NEWS  unavailable: news")
    else:
        lines.append(f"NEWS ({len(news)} latest):")
        for item in news:
            head = item.get("heading", "")
            if len(head) > 110:
                head = head[:107] + "…"
            lines.append(f"  [{item.get('published_ist')}] {head}")
            if item.get("link"):
                lines.append(f"    {item['link']}")

    for err in payload.get("errors") or []:
        lines.append(err)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="upstox_intel",
        description="Read-only Upstox market-intel desk block (no orders).",
    )
    ap.add_argument("--date", default=None, help="session date YYYY-MM-DD (default today IST)")
    ap.add_argument(
        "--expiry",
        default="current_week",
        help="expiry date YYYY-MM-DD (default current_week = Upstox default)",
    )
    ap.add_argument("--json", action="store_true", help="dump the assembled payload as JSON")
    ap.add_argument("--news-limit", type=int, default=5, help="max headlines to show (default 5)")
    ap.add_argument("--timeout", type=float, default=10.0, help="HTTP timeout in seconds (default 10)")
    args = ap.parse_args(argv)

    args.date = args.date or desk_common.today_ist()
    try:
        dt.date.fromisoformat(args.date)
    except ValueError:
        ap.error("--date must be YYYY-MM-DD")

    payload = build_payload(args)
    if args.json:
        print(json.dumps(payload, indent=2, default=str))
    else:
        print(render(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
