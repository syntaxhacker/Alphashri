#!/usr/bin/env python3
"""Read-only NIFTY futures volume / RVOL probe.

The NIFTY index itself has no volume, so this script resolves the **current
month NIFTY futures** contract and uses its 1-minute volume as the RVOL proxy
for the desk's speed filter:

1. resolve the futures ``instrument_key`` — read-only from the local
   ``instruments`` table (``segment='NSE_FO'``, ``trading_symbol LIKE '%FUT%'``,
   earliest expiry on/after today), falling back to
   ``GET /v2/instruments/search`` (``query=NIFTY``, ``segments=FO``,
   ``instrument_types=FUT``);
2. fetch ``GET /v3/historical-candle/intraday/{key}/minutes/1`` (volume + OI);
3. print ``RVOL = last-<minutes>-min volume / median of prior <minutes>-min
   windows`` plus the last 5 bars' volume.

Read-only by construction: only HTTP GETs, DB handle is ``mode=ro``.

Usage:
    .venv/bin/python scripts/futures_volume.py --minutes 5
    .venv/bin/python scripts/futures_volume.py --minutes 5 --json
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

BASE_V2 = "https://api.upstox.com/v2"
BASE_V3 = "https://api.upstox.com"
NIFTY_FUT_PREFIX = "NIFTY"

#: Index futures whose symbol ALSO starts with "NIFTY" but are a different
#: contract (and a different lot size). They must never be used as the NIFTY
#: futures proxy: ``"BANKNIFTY" in "NIFTY..."`` used to be true, so a
#: BANKNIFTY row could win the "earliest expiry" pick and silently proxy the
#: wrong index.
NON_NIFTY_INDEX_PREFIXES = (
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY",
    "NIFTYNXT50",
)


def is_nifty_futures_symbol(symbol) -> bool:
    """True for a NIFTY futures symbol only.

    Requires the symbol to START with ``NIFTY`` (so BANKNIFTY / FINNIFTY /
    MIDCPNIFTY / NIFTYNXT50 are rejected) and to carry the ``FUT`` marker (so
    an option row is rejected too).
    """
    sym = str(symbol or "").strip().upper()
    if not sym.startswith(NIFTY_FUT_PREFIX):
        return False
    if any(sym.startswith(p) for p in NON_NIFTY_INDEX_PREFIXES):
        return False
    return "FUT" in sym


# ---------------------------------------------------------------------------
# pure helpers (unit-tested, no network)
# ---------------------------------------------------------------------------
def parse_search_payload(payload) -> list[dict]:
    """Normalise ``GET /v2/instruments/search`` → ``[{instrument_key, trading_symbol, expiry}]``.

    Keeps only futures rows (``instrument_type == "FUT"`` or ``FUT`` in the
    segment). Malformed rows are skipped.
    """
    data = _data(payload)
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        key = row.get("instrument_key")
        itype = str(row.get("instrument_type", "")).upper()
        seg = str(row.get("segment", "")).upper()
        if not key or not ("FUT" in itype or "FUT" in seg):
            continue
        out.append(
            {
                "instrument_key": str(key),
                "trading_symbol": str(row.get("trading_symbol", "")),
                "expiry": str(row.get("expiry", "") or ""),
            }
        )
    return out


def pick_current_month(rows: list[dict], today: str) -> dict | None:
    """Earliest-expiry row with ``expiry >= today`` (both ``YYYY-MM-DD``).

    ``""`` expiries sort last; unparseable rows are skipped. Returns None
    when nothing qualifies.
    """
    best: dict | None = None
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        expiry = str(row.get("expiry", "") or "")
        try:
            dt.date.fromisoformat(expiry)
        except ValueError:
            continue
        if expiry < today:
            continue
        if best is None or expiry < str(best.get("expiry", "")):
            best = row
    return best


def parse_candles(payload) -> list[dict]:
    """Normalise V3 intraday candles → ``[{ts, volume}]`` oldest-first.

    V3 rows are ``[ts, o, h, l, c, volume, oi]``; Upstox returns newest-first,
    so the output is reversed into chronological order. Rows with unparseable
    volume are skipped.
    """
    data = _data(payload)
    candles = data.get("candles") if isinstance(data, dict) else None
    if not isinstance(candles, list):
        return []
    out: list[dict] = []
    for row in candles:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            continue
        vol = _as_float(row[5])
        if vol is None:
            continue
        out.append({"ts": str(row[0]), "volume": vol})
    out.reverse()  # newest-first → oldest-first
    return out


def window_volumes(volumes: list[float], window: int) -> list[float]:
    """Sum consecutive non-overlapping ``window``-sized chunks (full only)."""
    if window <= 0:
        raise ValueError("window must be positive")
    vals = [v for v in (volumes or []) if _as_float(v) is not None]
    n_full = len(vals) // window
    return [sum(vals[i * window:(i + 1) * window]) for i in range(n_full)]


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def compute_rvol(volumes: list[float], window: int = 5) -> dict:
    """RVOL over ``window``-minute buckets: last bucket vs median of priors.

    Returns ``{"rvol", "last", "baseline", "windows"}``; ``rvol`` is None when
    fewer than 2 full windows exist or the baseline median is 0.
    """
    wins = window_volumes(volumes, window)
    if len(wins) < 2:
        return {"rvol": None, "last": wins[-1] if wins else None, "baseline": None, "windows": wins}
    last = wins[-1]
    baseline = _median(wins[:-1])
    rvol = (last / baseline) if baseline else None
    return {"rvol": rvol, "last": last, "baseline": baseline, "windows": wins}


# ---------------------------------------------------------------------------
# live sources (network, read-only)
# ---------------------------------------------------------------------------
def _get_v2(path: str, params: dict, timeout: float):
    return upstox_common.get(path, params, timeout, base=BASE_V2)


def _get_v3(path: str, timeout: float):
    return upstox_common.get(path, None, timeout, base=BASE_V3)


def resolve_futures_from_db(today: str) -> dict | None:
    """Current-month NIFTY futures row from the local instruments table (``mode=ro``).

    The table has no instrument-type column, so futures are ``segment='NSE_FO'``
    rows with ``FUT`` in the trading symbol and a NULL strike. None when the
    DB is missing or holds no qualifying row (e.g. 0 rows for this expiry).
    """
    try:
        db = desk_common.db_path()
        if not db.exists():
            return None
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = con.execute(
                "select instrument_key, trading_symbol, expiry from instruments "
                "where segment = 'NSE_FO' and trading_symbol like '%FUT%' "
                "and (strike_price is null or strike_price = 0)"
            ).fetchall()
        finally:
            con.close()
    except Exception:
        return None
    cands = [
        {"instrument_key": k, "trading_symbol": s or "", "expiry": (e or "")}
        for k, s, e in rows
        if k and is_nifty_futures_symbol(s)
    ]
    norm = []
    for row in cands:
        expiry = str(row["expiry"] or "")
        if len(expiry) > 10:  # stored as datetime — keep the date part
            expiry = expiry[:10]
        norm.append({**row, "expiry": expiry})
    return pick_current_month(norm, today)


def resolve_futures_from_search(today: str, timeout: float) -> dict | None:
    """Current-month NIFTY futures row via ``GET /v2/instruments/search``."""
    raw = _get_v2(
        "/instruments/search",
        {"query": "NIFTY", "exchanges": "NSE", "segments": "FO",
         "instrument_types": "FUT", "expiry": "current_month", "records": 30},
        timeout,
    )
    rows = [r for r in parse_search_payload(raw) if is_nifty_futures_symbol(r["trading_symbol"])]
    return pick_current_month(rows, today)


def resolve_futures_key(today: str, timeout: float) -> tuple[dict | None, str]:
    """``(row, source)`` — DB first (``"db"``), then search API (``"search"``)."""
    row = resolve_futures_from_db(today)
    if row is not None:
        return row, "db"
    try:
        row = resolve_futures_from_search(today, timeout)
    except Exception:
        row = None
    return row, "search"


def fetch_minute_candles(instrument_key: str, timeout: float) -> list[dict]:
    """GET V3 intraday 1-minute candles (with volume) → oldest-first ``[{ts, volume}]``."""
    import urllib.parse

    quoted = urllib.parse.quote(instrument_key, safe="")
    raw = _get_v3(f"/v3/historical-candle/intraday/{quoted}/minutes/1", timeout)
    return parse_candles(raw)


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="futures_volume",
        description="NIFTY futures volume RVOL proxy (read-only; index has no volume).",
    )
    ap.add_argument("--minutes", type=int, default=5, help="RVOL window in minutes (default 5)")
    ap.add_argument("--date", default=None, help="reference date YYYY-MM-DD (default today IST)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--timeout", type=float, default=10.0)
    args = ap.parse_args(argv)

    if args.minutes <= 0:
        ap.error("--minutes must be positive")
    today = args.date or desk_common.today_ist()
    try:
        dt.date.fromisoformat(today)
    except ValueError:
        ap.error("--date must be YYYY-MM-DD")

    try:
        row, source = resolve_futures_key(today, args.timeout)
        if row is None:
            print("error: no current-month NIFTY futures contract found (db + search)")
            return 1
        candles = fetch_minute_candles(row["instrument_key"], args.timeout)
    except Exception as exc:  # noqa: BLE001 — CLI reports, never tracebacks
        print(f"error: {type(exc).__name__}: {exc}")
        return 2

    volumes = [c["volume"] for c in candles]
    stats = compute_rvol(volumes, args.minutes)
    last_bars = volumes[-5:]
    if args.json:
        print(json.dumps({
            "instrument_key": row["instrument_key"],
            "trading_symbol": row["trading_symbol"],
            "expiry": row["expiry"],
            "source": source,
            "minutes": args.minutes,
            **stats,
            "last_bars_volume": last_bars,
            "n_bars": len(volumes),
        }, default=str))
    else:
        print(f"FUT {row['trading_symbol']}  {row['instrument_key']}  expiry {row['expiry']}  (via {source})")
        print(f"bars={len(volumes)} window={args.minutes}min windows={len(stats['windows'])}")
        base = stats["baseline"]
        rvol = stats["rvol"]
        print(f"RVOL {rvol:.2f}" if rvol is not None else "RVOL — (need >= 2 full windows)",
              end="")
        print(f"  last={stats['last']:.0f}" if stats["last"] is not None else "  last=—", end="")
        print(f"  baseline(median)={base:.0f}" if base else "  baseline=—")
        print("last 5 bars volume: " + (" ".join(f"{v:.0f}" for v in last_bars) if last_bars else "—"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
